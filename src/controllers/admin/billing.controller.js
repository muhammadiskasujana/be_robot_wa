// src/controllers/admin/billing.controller.js
import { Op } from "sequelize";
import {
    sequelize,
    WaGroup,
    WaCommand,
    LeasingCompany,
    WaCommandPolicy,
    WaCreditWallet,
    WaCreditTransaction,
} from "../../models/index.js";

import { invalidatePolicyCache, invalidateCommandCache } from "../../services/billingService.js";

/* =========================
 * helpers
 * ========================= */
function up(v) {
    return String(v || "").trim().toUpperCase();
}
function toInt(v, def = 0) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : def;
}
function toBool(v, def = true) {
    if (v === undefined) return def;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v === 1;
    const s = String(v).toLowerCase().trim();
    return ["1", "true", "yes", "y", "on"].includes(s);
}
function buildMeta({ q, page, limit, total }) {
    const totalPages = Math.max(1, Math.ceil(total / limit));
    return { q, page, limit, total, totalPages, hasPrev: page > 1, hasNext: page < totalPages };
}

// billing_mode is source of truth, tapi legacy use_credit tetap diterima
function normalizeBillingMode(input = {}, current = "FREE") {
    if (input.billing_mode !== undefined && input.billing_mode !== null && input.billing_mode !== "") {
        const bm = up(input.billing_mode);
        return ["FREE", "CREDIT", "SUBSCRIPTION"].includes(bm) ? bm : "FREE";
    }
    if (input.use_credit !== undefined) {
        return toBool(input.use_credit, false) ? "CREDIT" : "FREE";
    }
    return ["FREE", "CREDIT", "SUBSCRIPTION"].includes(up(current)) ? up(current) : "FREE";
}

/**
 * Normalize scope_type + target
 * - GROUP: butuh group_id
 * - LEASING: butuh leasing_id
 * - PERSONAL: butuh phone_e164
 */
function normalizeScope(input = {}) {
    const scope_type = up(input.scope_type);
    const group_id = input.group_id || null;
    const leasing_id = input.leasing_id || null;
    const phone_e164 = input.phone_e164 || input.phone || null;

    if (!["GROUP", "LEASING", "PERSONAL"].includes(scope_type)) {
        return { ok: false, error: "scope_type harus GROUP, LEASING, atau PERSONAL" };
    }

    if (scope_type === "GROUP") {
        if (!group_id) return { ok: false, error: "group_id wajib untuk scope GROUP" };
        return { ok: true, scope_type: "GROUP", group_id, leasing_id: null, phone_e164: null };
    }

    if (scope_type === "LEASING") {
        if (!leasing_id) return { ok: false, error: "leasing_id wajib untuk scope LEASING" };
        return { ok: true, scope_type: "LEASING", group_id: null, leasing_id, phone_e164: null };
    }

    if (!phone_e164) return { ok: false, error: "phone_e164 wajib untuk scope PERSONAL" };
    return { ok: true, scope_type: "PERSONAL", group_id: null, leasing_id: null, phone_e164 };
}

function normalizeWalletWhere(norm) {
    if (norm.scope_type === "PERSONAL") {
        return { scope_type: "PERSONAL", phone_e164: norm.phone_e164, group_id: null, leasing_id: null };
    }
    if (norm.scope_type === "LEASING") {
        return { scope_type: "LEASING", leasing_id: norm.leasing_id, group_id: null, phone_e164: null };
    }
    return { scope_type: "GROUP", group_id: norm.group_id, leasing_id: null, phone_e164: null };
}

/* ============================================================
 * 1) COMMANDS (picker)
 * GET /admin/wa-commands?q=
 * ============================================================ */
export async function listCommands(req, res) {
    const q = String(req.query.q || "").trim();
    const page = Math.max(toInt(req.query.page, 1), 1);
    const limit = Math.min(Math.max(toInt(req.query.limit, 50), 1), 200);
    const offset = (page - 1) * limit;

    const where = q
        ? { [Op.or]: [{ key: { [Op.iLike]: `%${q}%` } }, { name: { [Op.iLike]: `%${q}%` } }] }
        : undefined;

    const { rows, count } = await WaCommand.findAndCountAll({
        where,
        order: [["key", "ASC"]],
        limit,
        offset,
    });

    res.json({ ok: true, data: rows, meta: buildMeta({ q, page, limit, total: count }) });
}

/* ============================================================
 * 2) POLICIES CRUD
 * ============================================================ */

/**
 * GET /admin/wa-policies?q=&scope_type=&group_id=&leasing_id=&phone_e164=&command_id=
 */
export async function listPolicies(req, res) {
    const q = String(req.query.q || "").trim();
    const page = Math.max(toInt(req.query.page, 1), 1);
    const limit = Math.min(Math.max(toInt(req.query.limit, 20), 1), 200);
    const offset = (page - 1) * limit;

    const scope_type = req.query.scope_type ? up(req.query.scope_type) : "";
    const group_id = req.query.group_id || null;
    const leasing_id = req.query.leasing_id || null;
    const phone_e164 = req.query.phone_e164 || null;
    const command_id = req.query.command_id || null;

    const where = {};
    if (scope_type) where.scope_type = scope_type;
    if (group_id) where.group_id = group_id;
    if (leasing_id) where.leasing_id = leasing_id;
    if (phone_e164) where.phone_e164 = phone_e164;
    if (command_id) where.command_id = command_id;

    const include = [
        { model: WaCommand, as: "command", attributes: ["id", "key", "name"] },
        { model: WaGroup, as: "group", attributes: ["id", "chat_id", "title"] },
        { model: LeasingCompany, as: "leasing", attributes: ["id", "code", "name"] },
    ];

    if (q) {
        where[Op.or] = [
            { scope_type: { [Op.iLike]: `%${q}%` } },
            { wallet_scope: { [Op.iLike]: `%${q}%` } },
            { billing_mode: { [Op.iLike]: `%${q}%` } },
            { phone_e164: { [Op.iLike]: `%${q}%` } },
            { "$command.key$": { [Op.iLike]: `%${q}%` } },
            { "$command.name$": { [Op.iLike]: `%${q}%` } },
            { "$group.title$": { [Op.iLike]: `%${q}%` } },
            { "$leasing.code$": { [Op.iLike]: `%${q}%` } },
            { "$leasing.name$": { [Op.iLike]: `%${q}%` } },
        ];
    }

    const { rows, count } = await WaCommandPolicy.findAndCountAll({
        where,
        include,
        order: [["created_at", "DESC"]],
        limit,
        offset,
        distinct: true,
    });

    res.json({ ok: true, data: rows, meta: buildMeta({ q, page, limit, total: count }) });
}

/**
 * POST /admin/wa-policies
 * body:
 * { scope_type, group_id?, leasing_id?, phone_e164?, command_id,
 *   is_enabled?, billing_mode?, use_credit?, credit_cost?, wallet_scope?, meta? }
 */
export async function createPolicy(req, res) {
    const norm = normalizeScope(req.body || {});
    if (!norm.ok) return res.status(400).json({ ok: false, error: norm.error });

    const command_id = req.body.command_id;
    if (!command_id) return res.status(400).json({ ok: false, error: "command_id wajib" });

    const is_enabled = toBool(req.body.is_enabled, true);

    const billing_mode = normalizeBillingMode(req.body, "FREE");
    const credit_cost = Math.max(1, toInt(req.body.credit_cost, 1));

    const wallet_scope = up(req.body.wallet_scope || norm.scope_type);
    if (!["GROUP", "LEASING", "PERSONAL"].includes(wallet_scope)) {
        return res.status(400).json({ ok: false, error: "wallet_scope harus GROUP, LEASING, atau PERSONAL" });
    }

    try {
        const row = await WaCommandPolicy.create({
            ...norm,
            command_id,
            is_enabled,
            billing_mode,
            credit_cost,
            wallet_scope,
            meta: req.body.meta || null,
        });

        await row.reload();

        invalidatePolicyCache({
            scope_type: row.scope_type,
            group_id: row.group_id,
            leasing_id: row.leasing_id,
            phone_e164: row.phone_e164,
            command_id: row.command_id,
        });

        res.json({ ok: true, data: row });
    } catch (e) {
        if (String(e?.name || "").includes("SequelizeUniqueConstraintError")) {
            return res.status(400).json({ ok: false, error: "Policy sudah ada untuk scope+target+command ini." });
        }
        throw e;
    }
}

/**
 * PUT /admin/wa-policies/:id
 */
export async function updatePolicy(req, res) {
    const row = await WaCommandPolicy.findByPk(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });

    const is_enabled =
        req.body.is_enabled !== undefined ? toBool(req.body.is_enabled, row.is_enabled) : row.is_enabled;

    const billing_mode = normalizeBillingMode(req.body, row.billing_mode);

    const credit_cost =
        req.body.credit_cost !== undefined ? Math.max(1, toInt(req.body.credit_cost, row.credit_cost)) : row.credit_cost;

    const wallet_scope = req.body.wallet_scope !== undefined ? up(req.body.wallet_scope) : row.wallet_scope;
    if (!["GROUP", "LEASING", "PERSONAL"].includes(wallet_scope)) {
        return res.status(400).json({ ok: false, error: "wallet_scope harus GROUP, LEASING, atau PERSONAL" });
    }

    await row.update({
        is_enabled,
        billing_mode,
        credit_cost,
        wallet_scope,
        meta: req.body.meta !== undefined ? (req.body.meta || null) : row.meta,
    });

    await row.reload();

    invalidatePolicyCache({
        scope_type: row.scope_type,
        group_id: row.group_id,
        leasing_id: row.leasing_id,
        phone_e164: row.phone_e164,
        command_id: row.command_id,
    });

    res.json({ ok: true, data: row });
}

/**
 * DELETE /admin/wa-policies/:id
 */
export async function removePolicy(req, res) {
    const row = await WaCommandPolicy.findByPk(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });

    await row.destroy();

    invalidatePolicyCache({
        scope_type: row.scope_type,
        group_id: row.group_id,
        leasing_id: row.leasing_id,
        phone_e164: row.phone_e164,
        command_id: row.command_id,
    });

    res.json({ ok: true });
}

/* ============================================================
 * 3) WALLETS CRUD + TOPUP/DEBIT
 * ============================================================ */

/**
 * GET /admin/wa-wallets?q=&scope_type=&group_id=&leasing_id=&phone_e164=
 */
export async function listWallets(req, res) {
    const q = String(req.query.q || "").trim();
    const page = Math.max(toInt(req.query.page, 1), 1);
    const limit = Math.min(Math.max(toInt(req.query.limit, 20), 1), 200);
    const offset = (page - 1) * limit;

    const scope_type = req.query.scope_type ? up(req.query.scope_type) : "";
    const group_id = req.query.group_id || null;
    const leasing_id = req.query.leasing_id || null;
    const phone_e164 = req.query.phone_e164 || null;

    const where = {};
    if (scope_type) where.scope_type = scope_type;
    if (group_id) where.group_id = group_id;
    if (leasing_id) where.leasing_id = leasing_id;
    if (phone_e164) where.phone_e164 = phone_e164;

    const include = [
        { model: WaGroup, as: "group", attributes: ["id", "chat_id", "title"] },
        { model: LeasingCompany, as: "leasing", attributes: ["id", "code", "name"] },
    ];

    if (q) {
        where[Op.or] = [
            { scope_type: { [Op.iLike]: `%${q}%` } },
            { phone_e164: { [Op.iLike]: `%${q}%` } },
            { "$group.title$": { [Op.iLike]: `%${q}%` } },
            { "$group.chat_id$": { [Op.iLike]: `%${q}%` } },
            { "$leasing.code$": { [Op.iLike]: `%${q}%` } },
            { "$leasing.name$": { [Op.iLike]: `%${q}%` } },
        ];
    }

    const { rows, count } = await WaCreditWallet.findAndCountAll({
        where,
        include,
        order: [["updated_at", "DESC"]],
        limit,
        offset,
        distinct: true,
    });

    res.json({ ok: true, data: rows, meta: buildMeta({ q, page, limit, total: count }) });
}

/**
 * POST /admin/wa-wallets
 * body: { scope_type, group_id? / leasing_id? / phone_e164?, balance?, is_active?, meta? }
 */
export async function createWallet(req, res) {
    const norm = normalizeScope(req.body || {});
    if (!norm.ok) return res.status(400).json({ ok: false, error: norm.error });

    const balance = Math.max(0, toInt(req.body.balance, 0));
    const is_active = toBool(req.body.is_active, true);

    try {
        const row = await WaCreditWallet.create({
            ...norm,
            balance,
            is_active,
            meta: req.body.meta || null,
        });

        res.json({ ok: true, data: row });
    } catch (e) {
        if (String(e?.name || "").includes("SequelizeUniqueConstraintError")) {
            return res.status(400).json({ ok: false, error: "Wallet sudah ada untuk scope+target ini." });
        }
        throw e;
    }
}

/**
 * PUT /admin/wa-wallets/:id
 */
export async function updateWallet(req, res) {
    const row = await WaCreditWallet.findByPk(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });

    const is_active = req.body.is_active !== undefined ? toBool(req.body.is_active, row.is_active) : row.is_active;

    await row.update({
        is_active,
        meta: req.body.meta !== undefined ? (req.body.meta || null) : row.meta,
    });

    res.json({ ok: true, data: row });
}

/**
 * POST /admin/wa-wallets/:id/topup
 */
export async function topupWallet(req, res) {
    const wallet = await WaCreditWallet.findByPk(req.params.id);
    if (!wallet) return res.status(404).json({ ok: false, error: "Wallet not found" });

    const amount = Math.max(1, toInt(req.body.amount, 0));
    const notes = req.body.notes ? String(req.body.notes).trim() : null;
    const ref_type = req.body.ref_type ? String(req.body.ref_type).trim() : "ADMIN_TOPUP";
    const ref_id = req.body.ref_id ? String(req.body.ref_id).trim() : null;

    try {
        const out = await sequelize.transaction(async (t) => {
            const w = await WaCreditWallet.findByPk(wallet.id, { transaction: t, lock: t.LOCK.UPDATE });
            if (!w.is_active) throw new Error("Wallet nonaktif");

            const before = toInt(w.balance, 0);
            const after = before + amount;

            await w.update({ balance: after }, { transaction: t });

            const tx = await WaCreditTransaction.create(
                {
                    wallet_id: w.id,
                    tx_type: "CREDIT",
                    amount,
                    balance_before: before,
                    balance_after: after,
                    command_id: null,
                    group_id: w.group_id || null,
                    leasing_id: w.leasing_id || null,
                    phone_e164: w.phone_e164 || null,
                    ref_type,
                    ref_id,
                    notes,
                },
                { transaction: t }
            );

            return { wallet: w, tx };
        });

        res.json({ ok: true, data: out });
    } catch (e) {
        res.status(400).json({ ok: false, error: e?.message || "Topup failed" });
    }
}

/**
 * POST /admin/wa-wallets/:id/debit
 */
export async function debitWallet(req, res) {
    const wallet = await WaCreditWallet.findByPk(req.params.id);
    if (!wallet) return res.status(404).json({ ok: false, error: "Wallet not found" });

    const amount = Math.max(1, toInt(req.body.amount, 0));
    const notes = req.body.notes ? String(req.body.notes).trim() : null;
    const ref_type = req.body.ref_type ? String(req.body.ref_type).trim() : "ADMIN_DEBIT";
    const ref_id = req.body.ref_id ? String(req.body.ref_id).trim() : null;

    try {
        const out = await sequelize.transaction(async (t) => {
            const w = await WaCreditWallet.findByPk(wallet.id, { transaction: t, lock: t.LOCK.UPDATE });
            if (!w.is_active) throw new Error("Wallet nonaktif");

            const before = toInt(w.balance, 0);
            if (before < amount) throw new Error("Saldo tidak cukup");

            const after = before - amount;
            await w.update({ balance: after }, { transaction: t });

            const tx = await WaCreditTransaction.create(
                {
                    wallet_id: w.id,
                    tx_type: "DEBIT",
                    amount,
                    balance_before: before,
                    balance_after: after,
                    command_id: null,
                    group_id: w.group_id || null,
                    leasing_id: w.leasing_id || null,
                    phone_e164: w.phone_e164 || null,
                    ref_type,
                    ref_id,
                    notes,
                },
                { transaction: t }
            );

            return { wallet: w, tx };
        });

        res.json({ ok: true, data: out });
    } catch (e) {
        res.status(400).json({ ok: false, error: e?.message || "Debit failed" });
    }
}

/**
 * POST /admin/wa-wallets/topup
 * body: { scope_type, group_id?, leasing_id?, phone_e164?, amount, notes?, ref_type?, ref_id? }
 */
export async function topupByScope(req, res) {
    const norm = normalizeScope(req.body || {});
    if (!norm.ok) return res.status(400).json({ ok: false, error: norm.error });

    const amount = Math.max(1, toInt(req.body.amount, 0));
    const notes = req.body.notes ? String(req.body.notes).trim() : null;
    const ref_type = req.body.ref_type ? String(req.body.ref_type).trim() : "ADMIN_TOPUP";
    const ref_id = req.body.ref_id ? String(req.body.ref_id).trim() : null;

    const whereWallet = normalizeWalletWhere(norm);

    try {
        const out = await sequelize.transaction(async (t) => {
            let wallet = await WaCreditWallet.findOne({ where: whereWallet, transaction: t, lock: t.LOCK.UPDATE });

            if (!wallet) {
                wallet = await WaCreditWallet.create({ ...whereWallet, balance: 0, is_active: true, meta: null }, { transaction: t });
            }

            const w = await WaCreditWallet.findByPk(wallet.id, { transaction: t, lock: t.LOCK.UPDATE });
            if (!w.is_active) throw new Error("Wallet nonaktif");

            const before = toInt(w.balance, 0);
            const after = before + amount;

            await w.update({ balance: after }, { transaction: t });

            const tx = await WaCreditTransaction.create(
                {
                    wallet_id: w.id,
                    tx_type: "CREDIT",
                    amount,
                    balance_before: before,
                    balance_after: after,
                    command_id: null,
                    group_id: w.group_id || null,
                    leasing_id: w.leasing_id || null,
                    phone_e164: w.phone_e164 || null,
                    ref_type,
                    ref_id,
                    notes,
                },
                { transaction: t }
            );

            return { wallet: w, tx };
        });

        res.json({ ok: true, data: out });
    } catch (e) {
        res.status(400).json({ ok: false, error: e?.message || "Topup failed" });
    }
}

/* ============================================================
 * 4) LEDGER
 * GET /admin/wa-ledger?q=&wallet_id=&group_id=&leasing_id=&phone_e164=&command_id=&tx_type=
 * ============================================================ */
export async function listLedger(req, res) {
    const q = String(req.query.q || "").trim();
    const page = Math.max(toInt(req.query.page, 1), 1);
    const limit = Math.min(Math.max(toInt(req.query.limit, 50), 1), 200);
    const offset = (page - 1) * limit;

    const wallet_id = req.query.wallet_id || null;
    const group_id = req.query.group_id || null;
    const leasing_id = req.query.leasing_id || null;
    const phone_e164 = req.query.phone_e164 || null;
    const command_id = req.query.command_id || null;
    const tx_type = req.query.tx_type ? up(req.query.tx_type) : "";

    const where = {};
    if (wallet_id) where.wallet_id = wallet_id;
    if (group_id) where.group_id = group_id;
    if (leasing_id) where.leasing_id = leasing_id;
    if (phone_e164) where.phone_e164 = phone_e164;
    if (command_id) where.command_id = command_id;
    if (tx_type) where.tx_type = tx_type;

    const include = [
        { model: WaCreditWallet, as: "wallet", attributes: ["id", "scope_type", "balance", "group_id", "leasing_id", "phone_e164"] },
        { model: WaCommand, as: "command", attributes: ["id", "key", "name"] },
    ];

    if (q) {
        where[Op.or] = [
            { ref_type: { [Op.iLike]: `%${q}%` } },
            { ref_id: { [Op.iLike]: `%${q}%` } },
            { notes: { [Op.iLike]: `%${q}%` } },
            { tx_type: { [Op.iLike]: `%${q}%` } },
            { phone_e164: { [Op.iLike]: `%${q}%` } },
            { "$command.key$": { [Op.iLike]: `%${q}%` } },
            { "$command.name$": { [Op.iLike]: `%${q}%` } },
        ];
    }

    const { rows, count } = await WaCreditTransaction.findAndCountAll({
        where,
        include,
        order: [["created_at", "DESC"]],
        limit,
        offset,
        distinct: true,
    });

    res.json({ ok: true, data: rows, meta: buildMeta({ q, page, limit, total: count }) });
}
