// src/controllers/admin/ptCompanies.js
import { Op } from "sequelize";
import { PtCompany, WaGroup } from "../../models/index.js";

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

export async function list(req, res) {
    const q = String(req.query.q || "").trim();
    const page = Math.max(parseInt(req.query.page || "1", 10) || 1, 1);
    const limitRaw = parseInt(req.query.limit || "20", 10) || 20;
    const limit = Math.min(Math.max(limitRaw, 1), 100);
    const offset = (page - 1) * limit;

    const where = q
        ? {
            [Op.or]: [
                { code: { [Op.iLike]: `%${q}%` } },
                { name: { [Op.iLike]: `%${q}%` } },
            ],
        }
        : undefined;

    const { rows, count } = await PtCompany.findAndCountAll({
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
    const code = up(req.body.code);
    const name = up(req.body.name || code);
    const is_active = toBool(req.body.is_active, true);

    if (!code) return res.status(400).json({ ok: false, error: "code wajib" });
    if (!name) return res.status(400).json({ ok: false, error: "name wajib" });

    const row = await PtCompany.create({ code, name, is_active });
    res.json({ ok: true, data: row });
}

export async function update(req, res) {
    const row = await PtCompany.findByPk(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });

    const patch = {};

    if (req.body.code !== undefined) patch.code = up(req.body.code);
    if (req.body.name !== undefined) patch.name = up(req.body.name);
    if (req.body.is_active !== undefined) patch.is_active = toBool(req.body.is_active, row.is_active);

    if (patch.code !== undefined && !patch.code) return res.status(400).json({ ok: false, error: "code wajib" });
    if (patch.name !== undefined && !patch.name) return res.status(400).json({ ok: false, error: "name wajib" });

    await row.update(patch);
    res.json({ ok: true, data: row });
}

export async function remove(req, res) {
    const row = await PtCompany.findByPk(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });
    await row.destroy();
    res.json({ ok: true });
}

/**
 * Admin set PT ke group (mirip leasing setting)
 * PUT /admin/groups/:id/pt
 * body: { pt_company_id } atau { pt_code }
 */
export async function setGroupPt(req, res) {
    const group = await WaGroup.findByPk(req.params.id);
    if (!group) return res.status(404).json({ ok: false, error: "Group not found" });

    let pt = null;

    if (req.body.pt_company_id) {
        pt = await PtCompany.findByPk(req.body.pt_company_id);
        if (!pt) return res.status(400).json({ ok: false, error: "pt_company_id tidak valid" });
    } else if (req.body.pt_code) {
        const code = up(req.body.pt_code);
        if (!code) return res.status(400).json({ ok: false, error: "pt_code wajib" });

        const [row] = await PtCompany.findOrCreate({
            where: { code },
            defaults: { code, name: code, is_active: true },
        });
        pt = row;

        if (!pt.is_active) await pt.update({ is_active: true });
    } else {
        return res.status(400).json({ ok: false, error: "Kirim pt_company_id atau pt_code" });
    }

    await group.update({ pt_company_id: pt.id });
    res.json({ ok: true, data: group, pt_company: pt });
}

/**
 * DELETE /admin/groups/:id/pt
 */
export async function unsetGroupPt(req, res) {
    const group = await WaGroup.findByPk(req.params.id);
    if (!group) return res.status(404).json({ ok: false, error: "Group not found" });

    await group.update({ pt_company_id: null });
    res.json({ ok: true, data: group });
}
