// src/services/billingService.js
import {
    WaCommand,
    WaCommandPolicy,
    WaCreditWallet,
    WaCreditTransaction,
    // WAJIB: pastikan model ini ada setelah migration + model dibuat
    WaGroupSubscription,
    sequelize,
} from "../models/index.js";

import {
    fetchString,
    fetchJSON,
    fetchBool,
    TTL,
    CacheKeys,
    CacheInvalidate,
} from "./cacheService.js";

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

function nowDate() {
    return new Date();
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
            const row = await WaCommand.findOne({
                where: { key },
                attributes: ["id"],
            });
            return row?.id || "";
        },
        TTL.JSON // 10 menit ok
    );
}

/**
 * =========================
 * Subscription check (cache)
 * =========================
 * SUBSCRIPTION berlaku di level GROUP (sesuai rencana kamu).
 *
 * asumsi table:
 * - group_id
 * - is_active
 * - expires_at
 * - (opsional) command_id / feature_key -> kalau kamu mau granular.
 *
 * Di sini: kalau ada command_id kolom, kita dukung:
 * - subscription command-specific (command_id = pol.command_id)
 * - atau global per group (command_id null)
 */
async function isGroupSubscribedCached({ group_id, command_id }) {
    if (!group_id) return false;

    const k = `sub:g:${group_id}:c:${command_id || "any"}`;

    return fetchBool(
        k,
        async () => {
            // NOTE: query dibuat ringan, ambil 1 row saja
            const where = {
                group_id,
                is_active: true,
                // expires_at > now
                expires_at: { [sequelize.Sequelize.Op.gt]: nowDate() },
            };

            // kalau kamu bikin subscription per-command,
            // maka aktif bila command_id = command_id OR command_id is null (global)
            if (command_id) {
                where[sequelize.Sequelize.Op.or] = [
                    { command_id },
                    { command_id: null },
                ];
            }

            const row = await WaGroupSubscription.findOne({
                where,
                attributes: ["id"],
            });
            return !!row;
        },
        20 * 1000 // 20 detik (trafik tinggi, cukup aman)
    );
}

/**
 * =========================
 * Policy resolve (cache)
 * priority:
 * - GROUP policy
 * - LEASING policy (kalau group punya leasing)
 * - DEFAULT (FREE)
 */
export async function resolvePolicyCached({ group, commandKey }) {
    if (!group?.id) return { ok: false, error: "group wajib" };

    const command_id = await getCommandIdByKeyCached(commandKey);
    if (!command_id) return { ok: false, error: `command "${commandKey}" belum terdaftar` };

    // helper normalize policy -> selalu punya billing_mode
    const normalizePolicy = (raw) => {
        const p = raw || {};
        const billing_mode = up(p.billing_mode || (p.use_credit ? "CREDIT" : "FREE"));

        return {
            ...p,
            billing_mode: ["FREE", "CREDIT", "SUBSCRIPTION"].includes(billing_mode) ? billing_mode : "FREE",
            // legacy compatibility:
            // - kalau billing_mode CREDIT -> use_credit true (biar consistent)
            // - kalau bukan CREDIT -> use_credit false
            use_credit: billing_mode === "CREDIT" ? true : false,
            credit_cost: billing_mode === "CREDIT" ? clampMin(p.credit_cost || 1, 1) : 0,
            wallet_scope: up(p.wallet_scope || "GROUP") || "GROUP",
        };
    };

    // 1) GROUP policy
    const pg = await fetchJSON(
        CacheKeys.policyGroup(group.id, command_id),
        async () => {
            const row = await WaCommandPolicy.findOne({
                where: { scope_type: "GROUP", group_id: group.id, command_id },
            });
            return row ? row.toJSON() : null;
        },
        60 * 1000 // 1 menit
    );

    if (pg) {
        const p = normalizePolicy(pg);
        return { ok: true, scope_hit: "GROUP", command_id, ...p };
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
            const p = normalizePolicy(pl);
            return { ok: true, scope_hit: "LEASING", command_id, ...p };
        }
    }

    // 3) DEFAULT: FREE
    return {
        ok: true,
        scope_hit: "DEFAULT",
        command_id,
        is_enabled: true,
        billing_mode: "FREE",
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
        if (!group.leasing_id) {
            return { ok: false, error: "wallet_scope LEASING tapi group belum punya leasing" };
        }
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
 * billing_mode:
 * - FREE => allow
 * - CREDIT => debit wallet
 * - SUBSCRIPTION => cek wa_group_subscriptions
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
        return {
            ok: true,
            allowed: false,
            charged: false,
            billing_mode: pol.billing_mode || "FREE",
            policy: pol,
        };
    }

    const billing_mode = up(pol.billing_mode || (pol.use_credit ? "CREDIT" : "FREE"));

    // ======================
    // FREE
    // ======================
    if (billing_mode === "FREE") {
        return {
            ok: true,
            allowed: true,
            charged: false,
            billing_mode: "FREE",
            policy: pol,
            credit_cost: 0,
        };
    }

    // ======================
    // SUBSCRIPTION
    // ======================
    if (billing_mode === "SUBSCRIPTION") {
        // kalau belum ada model / belum jadi, return error informatif
        if (!WaGroupSubscription) {
            return {
                ok: false,
                allowed: false,
                error: "Model WaGroupSubscription belum tersedia (cek migration + model).",
                policy: pol,
            };
        }

        const subscribed = await isGroupSubscribedCached({
            group_id: group.id,
            command_id: pol.command_id,
        });

        if (!subscribed) {
            return {
                ok: true,
                allowed: false,
                charged: false,
                billing_mode: "SUBSCRIPTION",
                error: "Langganan belum aktif / sudah expired.",
                policy: pol,
            };
        }

        return {
            ok: true,
            allowed: true,
            charged: false,
            billing_mode: "SUBSCRIPTION",
            policy: pol,
        };
    }

    // ======================
    // CREDIT
    // ======================
    // backward compatible: kalau billing_mode gak valid tapi use_credit true -> tetap debit
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
                billing_mode: "CREDIT",
                error: `Kredit habis. Saldo: ${out.balance_before}, biaya: ${cost}`,
                policy: pol,
                credit_cost: cost,
            };
        }

        return {
            ok: true,
            allowed: true,
            charged: true,
            billing_mode: "CREDIT",
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
