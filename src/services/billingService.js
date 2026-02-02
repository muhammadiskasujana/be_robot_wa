// src/services/billingService.js
import { WaCommand, WaCommandPolicy, WaCreditWallet, WaCreditTransaction, sequelize } from "../models/index.js";
import { fetchString, fetchJSON, TTL, CacheKeys, CacheInvalidate } from "./cacheService.js";

function up(v) {
    return String(v || "").trim().toUpperCase();
}
function toInt(v, def = 0) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : def;
}
function clampMin(n, min = 1) {
    const x = Number(n);
    if (!Number.isFinite(x)) return min;
    return Math.max(min, x);
}

/**
 * =========================
 * Command (cache)
 * =========================
 * cache yang disimpan: cmdId by key
 */
export async function getCommandIdByKeyCached(commandKey) {
    const key = String(commandKey || "").trim().toLowerCase();
    if (!key) return "";

    return fetchString(
        CacheKeys.cmdId(key),
        async () => {
            const row = await WaCommand.findOne({ where: { key }, attributes: ["id"] });
            return row?.id || "";
        },
        TTL.JSON // boleh 10m
    );
}

/**
 * =========================
 * Policy resolve (cache)
 * priority:
 * - GROUP policy
 * - LEASING policy (kalau group punya leasing)
 * - DEFAULT (gratis)
 */
export async function resolvePolicyCached({ group, commandKey }) {
    if (!group?.id) return { ok: false, error: "group wajib" };

    const command_id = await getCommandIdByKeyCached(commandKey);
    if (!command_id) return { ok: false, error: `command "${commandKey}" belum terdaftar` };

    // 1) GROUP policy
    const pg = await fetchJSON(
        CacheKeys.policyGroup(group.id, command_id),
        async () => {
            const row = await WaCommandPolicy.findOne({
                where: { scope_type: "GROUP", group_id: group.id, command_id },
            });
            return row ? row.toJSON() : null;
        },
        60 * 1000 // 1 menit (policy bisa berubah)
    );
    if (pg) {
        return { ok: true, scope_hit: "GROUP", command_id, ...pg };
    }

    // 2) LEASING policy (kalau group punya leasing)
    if (group.leasing_id) {
        const pl = await fetchJSON(
            CacheKeys.policyLeasing(group.leasing_id, command_id),
            async () => {
                const row = await WaCommandPolicy.findOne({
                    where: { scope_type: "LEASING", leasing_id: group.leasing_id, command_id },
                });
                return row ? row.toJSON() : null;
            },
            60 * 1000
        );

        if (pl) {
            return { ok: true, scope_hit: "LEASING", command_id, ...pl };
        }
    }

    // 3) DEFAULT: gratis
    return {
        ok: true,
        scope_hit: "DEFAULT",
        command_id,
        is_enabled: true,
        use_credit: false,
        credit_cost: 0,
        wallet_scope: "GROUP",
        meta: null,
    };
}

/**
 * =========================
 * Wallet target
 * wallet_scope:
 * - GROUP  => wallet target group.id
 * - LEASING => wallet target group.leasing_id
 */
function resolveWalletTarget({ group, wallet_scope }) {
    const ws = up(wallet_scope || "GROUP");

    if (ws === "LEASING") {
        if (!group.leasing_id) return { ok: false, error: "wallet_scope LEASING tapi group belum punya leasing" };
        return { ok: true, scope_type: "LEASING", group_id: null, leasing_id: group.leasing_id };
    }

    return { ok: true, scope_type: "GROUP", group_id: group.id, leasing_id: null };
}

async function ensureWallet(target, t) {
    const where =
        target.scope_type === "LEASING"
            ? { scope_type: "LEASING", leasing_id: target.leasing_id, group_id: null }
            : { scope_type: "GROUP", group_id: target.group_id, leasing_id: null };

    let wallet = await WaCreditWallet.findOne({ where, transaction: t, lock: t.LOCK.UPDATE });
    if (!wallet) {
        wallet = await WaCreditWallet.create(
            { ...where, balance: 0, is_active: true, meta: null },
            { transaction: t }
        );
    }
    return wallet;
}

/**
 * =========================
 * checkAndDebit (single entry)
 * - default gratis kalau policy tidak ada
 * - debit pakai transaction + row lock
 */
export async function checkAndDebit({
                                        commandKey,
                                        group,
                                        webhook = null,
                                        ref_type = "WA_MESSAGE",
                                        ref_id = null,
                                        notes = null,
                                    }) {
    const pol = await resolvePolicyCached({ group, commandKey });
    if (!pol.ok) {
        return { ok: false, allowed: false, error: pol.error };
    }

    if (pol.is_enabled === false) {
        return { ok: true, allowed: false, charged: false, use_credit: false, credit_cost: 0, policy: pol };
    }

    // gratis
    if (!pol.use_credit) {
        return { ok: true, allowed: true, charged: false, use_credit: false, credit_cost: 0, policy: pol };
    }

    const cost = clampMin(pol.credit_cost || 1, 1);
    const tgt = resolveWalletTarget({ group, wallet_scope: pol.wallet_scope });
    if (!tgt.ok) {
        return { ok: false, allowed: false, error: tgt.error, policy: pol };
    }

    const refId = ref_id || webhook?.idMessage || null;

    try {
        const out = await sequelize.transaction(async (t) => {
            const wallet0 = await ensureWallet(tgt, t);

            // lock by PK (paling aman)
            const wallet = await WaCreditWallet.findByPk(wallet0.id, { transaction: t, lock: t.LOCK.UPDATE });
            if (!wallet.is_active) throw new Error("Wallet nonaktif");

            const before = toInt(wallet.balance, 0);
            if (before < cost) {
                return {
                    allowed: false,
                    charged: false,
                    balance_before: before,
                    balance_after: before,
                };
            }

            const after = before - cost;
            await wallet.update({ balance: after }, { transaction: t });

            const tx = await WaCreditTransaction.create(
                {
                    wallet_id: wallet.id,
                    tx_type: "DEBIT",
                    amount: cost,
                    balance_before: before,
                    balance_after: after,
                    command_id: pol.command_id,
                    group_id: wallet.group_id || group.id || null,
                    leasing_id: wallet.leasing_id || group.leasing_id || null,
                    ref_type,
                    ref_id: refId,
                    notes: notes || commandKey,
                },
                { transaction: t }
            );

            return {
                allowed: true,
                charged: true,
                balance_before: before,
                balance_after: after,
                wallet_id: wallet.id,
                tx_id: tx.id,
            };
        });

        if (!out.allowed) {
            return {
                ok: true,
                allowed: false,
                charged: false,
                error: `Kredit habis. Saldo: ${out.balance_before}, biaya: ${cost}`,
                policy: pol,
                credit_cost: cost,
            };
        }

        return {
            ok: true,
            allowed: true,
            charged: true,
            policy: pol,
            credit_cost: cost,
            balance_after: out.balance_after,
        };
    } catch (e) {
        return { ok: false, allowed: false, error: e.message, policy: pol };
    }
}

/**
 * =========================
 * Invalidation helpers (dipanggil dari CRUD admin policy/wallet)
 * =========================
 */
export function invalidatePolicyCache({ scope_type, group_id, leasing_id, command_id }) {
    const st = up(scope_type);
    if (st === "GROUP" && group_id && command_id) CacheInvalidate.policyGroup(group_id, command_id);
    if (st === "LEASING" && leasing_id && command_id) CacheInvalidate.policyLeasing(leasing_id, command_id);
}

export function invalidateCommandCache(commandKey) {
    const key = String(commandKey || "").trim().toLowerCase();
    if (!key) return;
    CacheInvalidate.cmdId(key);
}
