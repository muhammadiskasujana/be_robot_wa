import { Op } from "sequelize";
import { WaPrivateWhitelist } from "../../models/index.js";
import { CacheInvalidate } from "../../services/cacheService.js";

function normalize62(v) {
    let s = String(v || "").trim();

    // buang spasi, dash, dll
    s = s.replace(/[^\d]/g, "");

    // kalau diawali 0 -> 62
    if (s.startsWith("0")) s = "62" + s.slice(1);

    // kalau diawali 8 -> 628...
    if (s.startsWith("8")) s = "62" + s;

    return s; // contoh: "628123456789"
}

function toBool(v, def = true) {
    if (v === undefined) return def;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v === 1;
    const s = String(v).toLowerCase().trim();
    return ["1", "true", "yes", "y", "on"].includes(s);
}

function normalizeAllowedInstances(v) {
    // JSONB: kita simpankan array of string unik
    if (!v) return [];
    const arr = Array.isArray(v) ? v : [v];
    const clean = arr
        .map((x) => String(x ?? "").trim())
        .filter(Boolean);
    return Array.from(new Set(clean));
}

export async function list(req, res) {
    const q = String(req.query.q || "").trim();
    const page = Math.max(parseInt(req.query.page || "1", 10) || 1, 1);
    const limitRaw = parseInt(req.query.limit || "20", 10) || 20;
    const limit = Math.min(Math.max(limitRaw, 1), 100);
    const offset = (page - 1) * limit;

    const where = q
        ? {
            [Op.or]: [
                { phone_e164: { [Op.iLike]: `%${q}%` } },
                { label: { [Op.iLike]: `%${q}%` } },
                { notes: { [Op.iLike]: `%${q}%` } },
            ],
        }
        : undefined;

    const { rows, count } = await WaPrivateWhitelist.findAndCountAll({
        where,
        order: [["created_at", "DESC"]],
        limit,
        offset,
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

export async function create(req, res) {
    const phone_e164 = normalize62(req.body.phone_e164);
    const label = req.body.label ? String(req.body.label).trim() : null;
    const notes = req.body.notes ? String(req.body.notes).trim() : null;
    const is_active = toBool(req.body.is_active, true);
    const allowed_instances = normalizeAllowedInstances(req.body.allowed_instances);

    if (!phone_e164 || !phone_e164.startsWith("62")) {
        return res.status(400).json({ ok: false, error: "phone wajib format 62..., contoh: 628123..." });
    }

    const row = await WaPrivateWhitelist.create({
        phone_e164,
        label,
        notes,
        is_active,
        allowed_instances,
    });

    CacheInvalidate.whitelistPhone(phone_e164);
    res.json({ ok: true, data: row });

}

export async function update(req, res) {
    const row = await WaPrivateWhitelist.findByPk(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });

    const oldPhone = row.phone_e164;

    const phone_e164 = normalize62(req.body.phone_e164);
    const label = req.body.label !== undefined ? (req.body.label ? String(req.body.label).trim() : null) : row.label;
    const notes = req.body.notes !== undefined ? (req.body.notes ? String(req.body.notes).trim() : null) : row.notes;
    const is_active = req.body.is_active !== undefined ? toBool(req.body.is_active, row.is_active) : row.is_active;

    // kalau field tidak dikirim, pertahankan yg lama (biar aman)
    const allowed_instances =
        req.body.allowed_instances !== undefined
            ? normalizeAllowedInstances(req.body.allowed_instances)
            : (Array.isArray(row.allowed_instances) ? row.allowed_instances : []);

    if (!phone_e164 || !phone_e164.startsWith("62")) {
        return res.status(400).json({ ok: false, error: "phone wajib format 62..., contoh: 628123..." });
    }

    await row.update({
        phone_e164,
        label,
        notes,
        is_active,
        allowed_instances,
    });
    // ✅ invalidate cache whitelist (old & new)
    if (oldPhone) CacheInvalidate.whitelistPhone(oldPhone);
    if (phone_e164 && phone_e164 !== oldPhone) CacheInvalidate.whitelistPhone(phone_e164);


    res.json({ ok: true, data: row });
}

export async function remove(req, res) {
    const row = await WaPrivateWhitelist.findByPk(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });

    const phone_e164 = row.phone_e164; // ✅ simpan sebelum destroy
    await row.destroy();

    if (phone_e164) CacheInvalidate.whitelistPhone(phone_e164);
    res.json({ ok: true });
}
