// src/controllers/admin/subscriptions.js
import { Op } from "sequelize";
import { WaGroupSubscription, WaGroup, LeasingCompany, PtCompany, WaCommand } from "../../models/index.js";

function toBool(v, def = true) {
    if (v === undefined) return def;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v === 1;
    const s = String(v).toLowerCase().trim();
    return ["1", "true", "yes", "y", "on"].includes(s);
}

function up(v) {
    return String(v || "").trim().toUpperCase();
}

function toInt(v, def = 0) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : def;
}

function addDays(baseDate, days) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + days);
    return d;
}

async function resolveCommandId(command_key, command_id) {
    if (command_id) return String(command_id);
    const key = String(command_key || "").trim().toLowerCase();
    if (!key) return "";
    const cmd = await WaCommand.findOne({ where: { key }, attributes: ["id"] });
    return cmd?.id || "";
}

function buildScopeWhere({ scope_type, group_id, leasing_id, pt_company_id }) {
    const st = up(scope_type);
    if (!["GROUP", "LEASING", "PT"].includes(st)) {
        return { ok: false, error: "scope_type harus GROUP|LEASING|PT" };
    }

    if (st === "GROUP") {
        if (!group_id) return { ok: false, error: "scope GROUP butuh group_id" };
        return { ok: true, scope_type: "GROUP", group_id, leasing_id: null, pt_company_id: null };
    }

    if (st === "LEASING") {
        if (!leasing_id) return { ok: false, error: "scope LEASING butuh leasing_id" };
        return { ok: true, scope_type: "LEASING", group_id: null, leasing_id, pt_company_id: null };
    }

    // PT
    if (!pt_company_id) return { ok: false, error: "scope PT butuh pt_company_id" };
    return { ok: true, scope_type: "PT", group_id: null, leasing_id: null, pt_company_id };
}

/**
 * GET /admin/subscriptions?q=&page=&limit=&scope_type=&group_id=&leasing_id=&pt_company_id=&is_active=
 */
export async function list(req, res) {
    const q = String(req.query.q || "").trim();
    const page = Math.max(parseInt(req.query.page || "1", 10) || 1, 1);
    const limitRaw = parseInt(req.query.limit || "20", 10) || 20;
    const limit = Math.min(Math.max(limitRaw, 1), 100);
    const offset = (page - 1) * limit;

    const where = {};

    if (req.query.scope_type) where.scope_type = up(req.query.scope_type);
    if (req.query.group_id) where.group_id = req.query.group_id;
    if (req.query.leasing_id) where.leasing_id = req.query.leasing_id;
    if (req.query.pt_company_id) where.pt_company_id = req.query.pt_company_id;
    if (req.query.is_active !== undefined) where.is_active = toBool(req.query.is_active);

    // optional q filter (tanpa join berat)
    // jika kamu mau q ke join fields, nanti kita upgrade.
    if (q) {
        // cari by command_id langsung tidak praktis, jadi simple:
        // match scope_type / ids
        where[Op.or] = [
            { scope_type: { [Op.iLike]: `%${q}%` } },
            { group_id: { [Op.eq]: q } },
            { leasing_id: { [Op.eq]: q } },
            { pt_company_id: { [Op.eq]: q } },
        ];
    }

    const { rows, count } = await WaGroupSubscription.findAndCountAll({
        where,
        order: [["created_at", "DESC"]],
        limit,
        offset,
        include: [
            { model: WaCommand, as: "command", attributes: ["id", "key", "name"] },
            { model: WaGroup, as: "group", attributes: ["id", "chat_id", "title"] },
            { model: LeasingCompany, as: "leasing", attributes: ["id", "code", "name"] },
            { model: PtCompany, as: "pt_company", attributes: ["id", "code", "name"] },
        ],
    });

    const totalPages = Math.max(1, Math.ceil(count / limit));

    res.json({
        ok: true,
        data: rows,
        meta: {
            q,
            page,
            limit,
            total: count,
            totalPages,
            hasPrev: page > 1,
            hasNext: page < totalPages,
        },
    });
}

/**
 * POST /admin/subscriptions
 * body:
 * {
 *   scope_type: "GROUP"|"LEASING"|"PT",
 *   group_id?, leasing_id?, pt_company_id?,
 *   command_key? OR command_id,
 *   days: 30,
 *   mode: "extend" | "set"   // default extend
 *   starts_at? (optional)    // kalau mau set custom start
 * }
 */
export async function createOrExtend(req, res) {
    const scope_type = up(req.body.scope_type);
    const days = toInt(req.body.days, 30);
    const mode = String(req.body.mode || "extend").toLowerCase(); // extend | set

    if (!scope_type) return res.status(400).json({ ok: false, error: "scope_type wajib" });
    if (!days || days <= 0) return res.status(400).json({ ok: false, error: "days harus > 0" });

    const cmdId = await resolveCommandId(req.body.command_key, req.body.command_id);
    if (!cmdId) return res.status(400).json({ ok: false, error: "command_key/command_id wajib & valid" });

    const scope = buildScopeWhere({
        scope_type,
        group_id: req.body.group_id || null,
        leasing_id: req.body.leasing_id || null,
        pt_company_id: req.body.pt_company_id || null,
    });
    if (!scope.ok) return res.status(400).json({ ok: false, error: scope.error });

    const whereUnique = {
        scope_type: scope.scope_type,
        group_id: scope.group_id,
        leasing_id: scope.leasing_id,
        pt_company_id: scope.pt_company_id,
        command_id: cmdId,
    };

    const now = new Date();
    const startsAtBody = req.body.starts_at ? new Date(req.body.starts_at) : null;
    const startsAt = startsAtBody && !Number.isNaN(startsAtBody.getTime()) ? startsAtBody : now;

    let row = await WaGroupSubscription.findOne({ where: whereUnique });

    if (!row) {
        row = await WaGroupSubscription.create({
            ...whereUnique,
            starts_at: startsAt,
            expires_at: addDays(startsAt, days),
            is_active: true,
            meta: req.body.meta ?? null,
        });
        return res.json({ ok: true, data: row, action: "created" });
    }

    // extend/set
    let base = startsAt;

    if (mode === "extend") {
        // extend dari expires_at kalau masih aktif dan belum expired
        if (row.is_active && row.expires_at && new Date(row.expires_at) > now) {
            base = new Date(row.expires_at);
        } else {
            base = now; // kalau sudah expired, extend dari now
        }
    } else {
        // set: reset dari startsAt (default now)
        base = startsAt;
        await row.update({ starts_at: startsAt });
    }

    await row.update({
        is_active: true,
        expires_at: addDays(base, days),
        meta: req.body.meta !== undefined ? (req.body.meta ?? null) : row.meta,
    });

    return res.json({ ok: true, data: row, action: "extended" });
}

/**
 * POST /admin/subscriptions/:id/disable
 */
export async function disable(req, res) {
    const row = await WaGroupSubscription.findByPk(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });

    await row.update({ is_active: false });
    res.json({ ok: true, data: row });
}
