import { WaMaster } from "../../models/index.js";
import { Op } from "sequelize";

export async function list(req, res) {
    const q = String(req.query.q || "").trim();
    const page = Math.max(parseInt(req.query.page || "1", 10) || 1, 1);
    const limitRaw = parseInt(req.query.limit || "20", 10) || 20;
    const limit = Math.min(Math.max(limitRaw, 1), 100); // clamp 1..100
    const offset = (page - 1) * limit;

    const where = q
        ? {
            [Op.or]: [
                { phone_e164: { [Op.iLike]: `%${q}%` } },
                { role: { [Op.iLike]: `%${q}%` } },
            ],
        }
        : undefined;

    const { rows, count } = await WaMaster.findAndCountAll({
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
    const { phone_e164, role = "admin", is_active = true } = req.body;
    const row = await WaMaster.create({ phone_e164, role, is_active });
    res.json({ ok: true, data: row });
}

export async function update(req, res) {
    const row = await WaMaster.findByPk(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });

    const { phone_e164, role, is_active } = req.body;
    await row.update({ phone_e164, role, is_active });
    res.json({ ok: true, data: row });
}

export async function remove(req, res) {
    const row = await WaMaster.findByPk(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });
    await row.destroy();
    res.json({ ok: true });
}
