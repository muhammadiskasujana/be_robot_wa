import { Op } from "sequelize";
import { LinkedPT, WaGroup } from "../../models/index.js";

function toInt(v, def = 0) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : def;
}

function buildMeta({ q = "", page = 1, limit = 20, total = 0 }) {
    const totalPages = Math.max(1, Math.ceil(total / limit));
    return {
        q,
        page,
        limit,
        total,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
    };
}

// =====================
// LIST
// =====================
export async function list(req, res) {
    try {
        const page = Math.max(toInt(req.query.page, 1), 1);
        const limit = Math.min(Math.max(toInt(req.query.limit, 20), 1), 200);
        const offset = (page - 1) * limit;

        const q = String(req.query.q || "").trim();
        const is_active =
            req.query.is_active === undefined
                ? null
                : req.query.is_active === "true";

        const where = {};

        if (q) {
            where[Op.or] = [
                { name: { [Op.iLike]: `%${q}%` } },
                { code: { [Op.iLike]: `%${q}%` } },
            ];
        }

        if (is_active !== null) where.is_active = is_active;

        const { rows, count } = await LinkedPT.findAndCountAll({
            where,
            order: [["name", "ASC"]],
            limit,
            offset,
        });

        res.json({
            ok: true,
            data: rows,
            meta: buildMeta({ q, page, limit, total: count }),
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
}

// =====================
// GET BY ID
// =====================
export async function getById(req, res) {
    try {
        const row = await LinkedPT.findByPk(req.params.id);

        if (!row) {
            return res.status(404).json({
                ok: false,
                error: "PT tidak ditemukan",
            });
        }

        res.json({ ok: true, data: row });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
}

// =====================
// CREATE
// =====================
export async function create(req, res) {
    try {
        const { name, code } = req.body;

        if (!name || !code) {
            return res.status(400).json({
                ok: false,
                error: "name dan code wajib",
            });
        }

        const exists = await LinkedPT.findOne({
            where: {
                [Op.or]: [
                    { name: String(name).trim().toUpperCase() },
                    { code: String(code).trim().toLowerCase() },
                ],
            },
        });

        if (exists) {
            return res.status(409).json({
                ok: false,
                error: "Nama atau kode PT sudah digunakan",
            });
        }

        const row = await LinkedPT.create({
            name,
            code,
        });

        res.status(201).json({
            ok: true,
            message: "✅ PT berhasil ditambahkan",
            data: row,
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
}

// =====================
// UPDATE
// =====================
export async function update(req, res) {
    try {
        const row = await LinkedPT.findByPk(req.params.id);

        if (!row) {
            return res.status(404).json({
                ok: false,
                error: "PT tidak ditemukan",
            });
        }

        const nextName =
            req.body.name !== undefined ? String(req.body.name).trim().toUpperCase() : row.name;

        const nextCode =
            req.body.code !== undefined ? String(req.body.code).trim().toLowerCase() : row.code;

        const conflict = await LinkedPT.findOne({
            where: {
                id: { [Op.ne]: row.id },
                [Op.or]: [{ name: nextName }, { code: nextCode }],
            },
        });

        if (conflict) {
            return res.status(409).json({
                ok: false,
                error: "Nama atau kode PT sudah digunakan",
            });
        }

        if (req.body.name !== undefined) row.name = req.body.name;
        if (req.body.code !== undefined) row.code = req.body.code;
        if (req.body.is_active !== undefined) row.is_active = !!req.body.is_active;

        row.updated_at = new Date();
        await row.save();

        res.json({
            ok: true,
            message: "✅ PT berhasil diupdate",
            data: row,
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
}

// =====================
// DELETE
// =====================
export async function remove(req, res) {
    try {
        const row = await LinkedPT.findByPk(req.params.id);

        if (!row) {
            return res.status(404).json({
                ok: false,
                error: "PT tidak ditemukan",
            });
        }

        await row.destroy();

        res.json({
            ok: true,
            message: "✅ PT berhasil dihapus",
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
}

// =====================
// SET PT KE GROUP
// =====================
export async function setGroupLinkedPT(req, res) {
    try {
        const { id } = req.params;
        const { linked_pt_id } = req.body;

        const group = await WaGroup.findByPk(id);
        if (!group) {
            return res.status(404).json({ ok: false, error: "Group tidak ditemukan" });
        }

        const pt = await LinkedPT.findByPk(linked_pt_id);
        if (!pt) {
            return res.status(404).json({ ok: false, error: "PT tidak ditemukan" });
        }

        group.linked_pt_id = pt.id;
        await group.save();

        res.json({
            ok: true,
            message: `✅ PT berhasil diset ke ${pt.name}`,
            data: {
                group_id: group.id,
                linked_pt_id: pt.id,
            },
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
}

// =====================
// UNSET
// =====================
export async function unsetGroupLinkedPT(req, res) {
    try {
        const { id } = req.params;

        const group = await WaGroup.findByPk(id);
        if (!group) {
            return res.status(404).json({ ok: false, error: "Group tidak ditemukan" });
        }

        group.linked_pt_id = null;
        await group.save();

        res.json({
            ok: true,
            message: "✅ PT dilepas dari group",
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
}