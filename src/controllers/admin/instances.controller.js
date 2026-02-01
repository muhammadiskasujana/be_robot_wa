import { Op } from "sequelize";
import { WaInstance } from "../../models/index.js";

function toBool(v, def = true) {
    if (v === undefined) return def;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v === 1;
    const s = String(v).toLowerCase().trim();
    return ["1", "true", "yes", "y", "on"].includes(s);
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
                { name: { [Op.iLike]: `%${q}%` } },
                { id_instance: { [Op.iLike]: `%${q}%` } },
            ],
        }
        : undefined;

    const { rows, count } = await WaInstance.findAndCountAll({
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
    const id_instance = String(req.body.id_instance || "").trim();
    const api_token = String(req.body.api_token || "").trim();
    const name = String(req.body.name || "").trim();
    const is_active = toBool(req.body.is_active, true);
    const meta = req.body.meta ?? {};

    if (!id_instance) return res.status(400).json({ ok: false, error: "id_instance wajib" });
    if (!api_token) return res.status(400).json({ ok: false, error: "api_token wajib" });
    if (!name) return res.status(400).json({ ok: false, error: "name wajib" });

    const row = await WaInstance.create({ id_instance, api_token, name, is_active, meta });
    res.json({ ok: true, data: row });
}

export async function update(req, res) {
    const row = await WaInstance.findByPk(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });

    const patch = {};

    if (req.body.id_instance !== undefined) patch.id_instance = String(req.body.id_instance || "").trim();
    if (req.body.name !== undefined) patch.name = String(req.body.name || "").trim();
    if (req.body.is_active !== undefined) patch.is_active = toBool(req.body.is_active, row.is_active);
    if (req.body.meta !== undefined) patch.meta = req.body.meta ?? {};

    // ini yang penting: hanya update token kalau benar-benar dikirim & tidak kosong
    if (req.body.api_token !== undefined) {
        const t = String(req.body.api_token || "").trim();
        if (t) patch.api_token = t;
    }

    await row.update(patch);
    res.json({ ok: true, data: row });
}

export async function remove(req, res) {
    const row = await WaInstance.findByPk(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });
    await row.destroy();
    res.json({ ok: true });
}
