// src/controllers/admin/billing.controller.js
import { Op } from "sequelize";
import {
    WaGroup,
    WaCommand,
    LeasingCompany,
    WaCommandPolicy,
    WaCreditWallet,
    WaCreditTransaction,
    sequelize,
} from "../../models/index.js";
import { invalidatePolicyCache, invalidateCommandCache } from "../../services/billingService.js";

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

function normalizeBillingInput({ billing_mode, use_credit }, currentBillingMode = "FREE") {
    // prioritas billing_mode kalau ada
    if (billing_mode !== undefined && billing_mode !== null && billing_mode !== "") {
        const bm = up(billing_mode);
        if (["FREE", "CREDIT", "SUBSCRIPTION"].includes(bm)) return bm;
        return "FREE";
    }

    // fallback legacy: use_credit -> billing_mode
    if (use_credit !== undefined) {
        const uc = toBool(use_credit, false);
        return uc ? "CREDIT" : "FREE";
    }

    return up(currentBillingMode || "FREE");
}

/**
 * scope_type: GROUP | LEASING
 * - GROUP requires group_id
 * - LEASING requires leasing_id
 */
function normalizeScope({ scope_type, group_id, leasing_id }) {
    const st = up(scope_type);
    if (st !== "GROUP" && st !== "LEASING") {
        return { ok: false, error: "scope_type harus GROUP atau LEASING" };
    }
    if (st === "GROUP") {
        if (!group_id) return { ok: false, error: "group_id wajib untuk scope GROUP" };
        return { ok: true, scope_type: "GROUP", group_id, leasing_id: null };
    }
    if (!leasing_id) return { ok: false, error: "leasing_id wajib untuk scope LEASING" };
    return { ok: true, scope_type: "LEASING", group_id: null, leasing_id };
}

function normalizeWalletWhere({ scope_type, group_id, leasing_id }) {
    const st = up(scope_type);
    if (st === "LEASING") return { scope_type: "LEASING", leasing_id, group_id: null };
    return { scope_type: "GROUP", group_id, leasing_id: null };
}

/* ============================================================
 * COMMANDS: list (buat picker admin)
 * GET /admin/billing/commands?q=
 * ============================================================ */
export async function listCommands(req, res) {
    const q = String(req.query.q || "").trim();
    const where = q
        ? { [Op.or]: [{ key: { [Op.iLike]: `%${q}%` } }, { name: { [Op.iLike]: `%${q}%` } }] }
        : undefined;

    const rows = await WaCommand.findAll({
        where,
        order: [["key", "ASC"]],
        limit: 300,
    });

    res.json({ ok: true, data: rows });
}

/* ============================================================
 * POLICIES CRUD (optional tapi aku sekalian taruh biar 1 paket)
 * ============================================================ */

/**
 * GET /admin/billing/policies?scope_type=&group_id=&leasing_id=&command_id=&page=&limit=
 */
export async function listPolicies(req, res) {
    const scope_type = req.query.scope_type ? up(req.query.scope_type) : "";
    const group_id = req.query.group_id || null;
    const leasing_id = req.query.leasing_id || null;
    const command_id = req.query.command_id || null;

    const page = Math.max(toInt(req.query.page, 1), 1);
    const limit = Math.min(Math.max(toInt(req.query.limit, 50), 1), 200);
    const offset = (page - 1) * limit;

    const where = {};
    if (scope_type) where.scope_type = scope_type;
    if (group_id) where.group_id = group_id;
    if (leasing_id) where.leasing_id = leasing_id;
    if (command_id) where.command_id = command_id;

    const { rows, count } = await WaCommandPolicy.findAndCountAll({
        where,
        include: [
            { model: WaCommand, as: "command", attributes: ["id", "key", "name"] },
            { model: WaGroup, as: "group", attributes: ["id", "chat_id", "title"] },
            { model: LeasingCompany, as: "leasing", attributes: ["id", "code", "name"] },
        ],
        order: [["created_at", "DESC"]],
        limit,
        offset,
    });

    res.json({
        ok: true,
        data: rows,
        meta: {
            page,
            limit,
            total: count,
            totalPages: Math.max(1, Math.ceil(count / limit)),
            hasPrev: page > 1,
            hasNext: page * limit < count,
        },
    });
}

/**
 * POST /admin/billing/policies
 * body:
 * { scope_type, group_id?, leasing_id?, command_id, is_enabled, use_credit, credit_cost, wallet_scope, meta? }
 */
export async function createPolicy(req, res) {
    const norm = normalizeScope(req.body || {});
    if (!norm.ok) return res.status(400).json({ ok: false, error: norm.error });

    const command_id = req.body.command_id;
    if (!command_id) return res.status(400).json({ ok: false, error: "command_id wajib" });

    const is_enabled = toBool(req.body.is_enabled, true);

    // ✅ billing_mode jadi source of truth (support legacy use_credit)
    const billing_mode = normalizeBillingInput(req.body, "FREE");

    // cost hanya relevan untuk CREDIT, tapi tetap boleh disimpan (hook akan handle use_credit)
    const credit_cost = Math.max(1, toInt(req.body.credit_cost, 1));

    const wallet_scope = up(req.body.wallet_scope || (norm.scope_type === "LEASING" ? "LEASING" : "GROUP"));
    if (!["GROUP", "LEASING"].includes(wallet_scope)) {
        return res.status(400).json({ ok: false, error: "wallet_scope harus GROUP atau LEASING" });
    }

    const row = await WaCommandPolicy.create({
        ...norm,
        command_id,
        is_enabled,
        billing_mode,          // ✅ penting
        credit_cost,
        wallet_scope,
        meta: req.body.meta || null,
    });

    // ✅ pastikan response reflect hook beforeValidate/beforeSave
    await row.reload();

    invalidatePolicyCache({
        scope_type: row.scope_type,
        group_id: row.group_id,
        leasing_id: row.leasing_id,
        command_id: row.command_id,
    });

    res.json({ ok: true, data: row });
}

/**
 * PUT /admin/billing/policies/:id
 */
export async function updatePolicy(req, res) {
    const row = await WaCommandPolicy.findByPk(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });

    const is_enabled =
        req.body.is_enabled !== undefined ? toBool(req.body.is_enabled, row.is_enabled) : row.is_enabled;

    const credit_cost =
        req.body.credit_cost !== undefined
            ? Math.max(1, toInt(req.body.credit_cost, row.credit_cost))
            : row.credit_cost;

    const wallet_scope =
        req.body.wallet_scope !== undefined ? up(req.body.wallet_scope) : row.wallet_scope;

    if (!["GROUP", "LEASING"].includes(wallet_scope)) {
        return res.status(400).json({ ok: false, error: "wallet_scope harus GROUP atau LEASING" });
    }

    // ✅ billing_mode source of truth, support legacy use_credit
    const billing_mode = normalizeBillingInput(req.body, row.billing_mode);

    await row.update({
        is_enabled,
        billing_mode,     // ✅ penting
        credit_cost,
        wallet_scope,
        meta: req.body.meta !== undefined ? (req.body.meta || null) : row.meta,
    });

    // ✅ wajib supaya response yang keluar adalah nilai setelah hook normalisasi
    await row.reload();

    invalidatePolicyCache({
        scope_type: row.scope_type,
        group_id: row.group_id,
        leasing_id: row.leasing_id,
        command_id: row.command_id,
    });

    res.json({ ok: true, data: row });
}

/**
 * DELETE /admin/billing/policies/:id
 */
export async function removePolicy(req, res) {
    const row = await WaCommandPolicy.findByPk(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });

    await row.destroy();

    invalidatePolicyCache({ scope_type: row.scope_type, group_id: row.group_id, leasing_id: row.leasing_id, command_id: row.command_id });

    res.json({ ok: true });
}

/* ============================================================
 * WALLETS: list + topup (admin-only) + ledger
 * ============================================================ */

/**
 * GET /admin/billing/wallets?scope_type=&group_id=&leasing_id=&page=&limit=
 */
export async function listWallets(req, res) {
    const scope_type = req.query.scope_type ? up(req.query.scope_type) : "";
    const group_id = req.query.group_id || null;
    const leasing_id = req.query.leasing_id || null;

    const page = Math.max(toInt(req.query.page, 1), 1);
    const limit = Math.min(Math.max(toInt(req.query.limit, 50), 1), 200);
    const offset = (page - 1) * limit;

    const where = {};
    if (scope_type) where.scope_type = scope_type;
    if (group_id) where.group_id = group_id;
    if (leasing_id) where.leasing_id = leasing_id;

    const { rows, count } = await WaCreditWallet.findAndCountAll({
        where,
        include: [
            { model: WaGroup, as: "group", attributes: ["id", "chat_id", "title"] },
            { model: LeasingCompany, as: "leasing", attributes: ["id", "code", "name"] },
        ],
        order: [["updated_at", "DESC"]],
        limit,
        offset,
    });

    res.json({
        ok: true,
        data: rows,
        meta: {
            page,
            limit,
            total: count,
            totalPages: Math.max(1, Math.ceil(count / limit)),
            hasPrev: page > 1,
            hasNext: page * limit < count,
        },
    });
}

/**
 * POST /admin/billing/wallets
 * buat create wallet manual (optional)
 * body: { scope_type, group_id?, leasing_id?, balance?, is_active?, meta? }
 */
export async function createWallet(req, res) {
    const norm = normalizeScope(req.body || {});
    if (!norm.ok) return res.status(400).json({ ok: false, error: norm.error });

    const balance = Math.max(0, toInt(req.body.balance, 0));
    const is_active = toBool(req.body.is_active, true);

    // unique per scope target
    const where = normalizeWalletWhere(norm);
    const exist = await WaCreditWallet.findOne({ where });
    if (exist) return res.status(409).json({ ok: false, error: "Wallet sudah ada untuk target ini" });

    const row = await WaCreditWallet.create({
        ...where,
        balance,
        is_active,
        meta: req.body.meta || null,
    });

    res.json({ ok: true, data: row });
}

/**
 * PUT /admin/billing/wallets/:id
 * hanya toggle is_active/meta (balance jangan langsung)
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
 * POST /admin/billing/wallets/:id/topup
 * body: { amount, notes?, ref_type?, ref_id? }
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
        res.status(400).json({ ok: false, error: e.message || "Topup failed" });
    }
}

/**
 * (optional) POST /admin/billing/wallets/:id/debit
 * body: { amount, notes?, ref_type?, ref_id? }
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
        res.status(400).json({ ok: false, error: e.message || "Debit failed" });
    }
}

/**
 * GET /admin/billing/ledger?wallet_id=&group_id=&leasing_id=&page=&limit=
 */
export async function listLedger(req, res) {
    const wallet_id = req.query.wallet_id || null;
    const group_id = req.query.group_id || null;
    const leasing_id = req.query.leasing_id || null;

    const page = Math.max(toInt(req.query.page, 1), 1);
    const limit = Math.min(Math.max(toInt(req.query.limit, 50), 1), 200);
    const offset = (page - 1) * limit;

    const where = {};
    if (wallet_id) where.wallet_id = wallet_id;
    if (group_id) where.group_id = group_id;
    if (leasing_id) where.leasing_id = leasing_id;

    const { rows, count } = await WaCreditTransaction.findAndCountAll({
        where,
        include: [
            { model: WaCreditWallet, as: "wallet", attributes: ["id", "scope_type", "balance", "group_id", "leasing_id"] },
            { model: WaCommand, as: "command", attributes: ["id", "key", "name"] },
        ],
        order: [["created_at", "DESC"]],
        limit,
        offset,
    });

    res.json({
        ok: true,
        data: rows,
        meta: {
            page,
            limit,
            total: count,
            totalPages: Math.max(1, Math.ceil(count / limit)),
            hasPrev: page > 1,
            hasNext: page * limit < count,
        },
    });
}

// POST /admin/billing/topup
// body: { scope_type:"GROUP"|"LEASING", group_id?, leasing_id?, amount, notes?, ref_type?, ref_id? }
export async function topupByScope(req, res) {
    const norm = normalizeScope(req.body || {});
    if (!norm.ok) return res.status(400).json({ ok: false, error: norm.error });

    const amount = Math.max(1, toInt(req.body.amount, 0));
    const notes = req.body.notes ? String(req.body.notes).trim() : null;
    const ref_type = req.body.ref_type ? String(req.body.ref_type).trim() : "ADMIN_TOPUP";
    const ref_id = req.body.ref_id ? String(req.body.ref_id).trim() : null;

    const whereWallet =
        norm.scope_type === "LEASING"
            ? { scope_type: "LEASING", leasing_id: norm.leasing_id, group_id: null }
            : { scope_type: "GROUP", group_id: norm.group_id, leasing_id: null };

    try {
        const out = await sequelize.transaction(async (t) => {
            // 1) ensure wallet (unique constraint handle)
            let wallet = await WaCreditWallet.findOne({ where: whereWallet, transaction: t, lock: t.LOCK.UPDATE });

            if (!wallet) {
                // create wallet kalau belum ada
                wallet = await WaCreditWallet.create(
                    { ...whereWallet, balance: 0, is_active: true, meta: null },
                    { transaction: t }
                );
            }

            // 2) lock lagi by pk (lebih aman) lalu topup
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
        res.status(400).json({ ok: false, error: e.message || "Topup failed" });
    }
}
