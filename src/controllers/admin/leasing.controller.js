import { LeasingCompany, LeasingBranch } from "../../models/index.js";

export async function listCompanies(req, res) {
    const rows = await LeasingCompany.findAll({ order: [["name", "ASC"]] });
    res.json({ ok: true, data: rows });
}

export async function createCompany(req, res) {
    const { code, name, is_active = true, meta } = req.body;
    const row = await LeasingCompany.create({ code: code.toUpperCase(), name, is_active, meta });
    res.json({ ok: true, data: row });
}

export async function updateCompany(req, res) {
    const row = await LeasingCompany.findByPk(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });
    const { code, name, is_active, meta } = req.body;
    await row.update({ code: code?.toUpperCase(), name, is_active, meta });
    res.json({ ok: true, data: row });
}

export async function removeCompany(req, res) {
    const row = await LeasingCompany.findByPk(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });
    await row.destroy();
    res.json({ ok: true });
}

export async function listBranches(req, res) {
    const rows = await LeasingBranch.findAll({
        where: { leasing_id: req.params.companyId },
        order: [["level", "ASC"], ["name", "ASC"]],
    });
    res.json({ ok: true, data: rows });
}

export async function createBranch(req, res) {
    const { code, name, level = "CABANG", parent_id = null, is_active = true, meta } = req.body;
    const row = await LeasingBranch.create({
        leasing_id: req.params.companyId,
        code,
        name,
        level: String(level).toUpperCase(),
        parent_id,
        is_active,
        meta,
    });
    res.json({ ok: true, data: row });
}

/**
 * Bulk upsert branches
 * Body:
 * {
 *   branches: [
 *     { code: "BJM", name: "Banjarmasin", level:"CABANG", parent_code:"AREA_KALSEL" },
 *     ...
 *   ]
 * }
 *
 * Note: kita resolve parent_id berdasarkan parent_code atau parent_name (jika ada).
 */
export async function bulkUpsertBranches(req, res) {
    const leasing_id = req.params.companyId;
    const { branches = [] } = req.body;

    if (!Array.isArray(branches) || branches.length === 0) {
        return res.status(400).json({ ok: false, error: "branches[] required" });
    }

    // load existing to resolve parent
    const existing = await LeasingBranch.findAll({ where: { leasing_id } });
    const map = new Map();
    for (const b of existing) {
        if (b.code) map.set(String(b.code).toUpperCase(), b);
        map.set(String(b.name).toUpperCase(), b);
    }

    const rows = branches.map((x) => {
        const level = String(x.level || "CABANG").toUpperCase();
        const parentKey = x.parent_code ? String(x.parent_code).toUpperCase() : null;
        const parent = parentKey ? map.get(parentKey) : null;

        return {
            leasing_id,
            code: x.code || null,
            name: x.name,
            level,
            parent_id: parent ? parent.id : null,
            is_active: x.is_active ?? true,
            meta: x.meta ?? null,
            created_at: new Date(),
            updated_at: new Date(),
        };
    });

    // bulkCreate ignoreDuplicates => untuk upsert "setengah"
    // kalau kamu mau full UPSERT update, nanti kita pakai ON CONFLICT ... DO UPDATE (raw query) atau sequelize upsert per row.
    await LeasingBranch.bulkCreate(rows, { ignoreDuplicates: true });

    const after = await LeasingBranch.findAll({ where: { leasing_id }, order: [["name", "ASC"]] });
    res.json({ ok: true, insertedOrIgnored: rows.length, data: after });
}

export async function updateBranch(req, res) {
    const row = await LeasingBranch.findByPk(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });

    const { code, name, level, parent_id, is_active, meta } = req.body;
    await row.update({
        code,
        name,
        level: level ? String(level).toUpperCase() : row.level,
        parent_id,
        is_active,
        meta,
    });
    res.json({ ok: true, data: row });
}

export async function removeBranch(req, res) {
    const row = await LeasingBranch.findByPk(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });
    await row.destroy();
    res.json({ ok: true });
}
