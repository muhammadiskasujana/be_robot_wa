import { Op } from "sequelize";
import {
    WaGroup,
    WaGroupMode,
    LeasingCompany,
    LeasingBranch,
    WaGroupLeasingBranch,
} from "../../models/index.js";
import { parsePagination, buildMeta } from "../../utils/pagination.js";

export async function list(req, res) {
    const { limit, page, offset } = parsePagination(req.query);
    const q = String(req.query.q || "").trim();

    const where = q
        ? {
            [Op.or]: [
                { chat_id: { [Op.iLike]: `%${q}%` } },
                { title: { [Op.iLike]: `%${q}%` } },
            ],
        }
        : {};

    const { rows, count } = await WaGroup.findAndCountAll({
        where,
        limit,
        offset,
        order: [["updated_at", "DESC"]],
        include: [{ model: WaGroupMode, as: "mode" }],
    });

    res.json({ ok: true, data: rows, meta: buildMeta({ page, limit, total: count }) });
}

export async function getById(req, res) {
    const row = await WaGroup.findByPk(req.params.id, {
        include: [
            { model: WaGroupMode, as: "mode" },
            { model: LeasingCompany, as: "leasing" },
            { model: LeasingBranch, as: "leasingBranch" },
        ],
    });
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });

    const branches = await WaGroupLeasingBranch.findAll({
        where: { group_id: row.id, is_active: true },
        include: [{ model: LeasingBranch, as: "branch" }],
    });

    res.json({ ok: true, data: { group: row, allowedBranches: branches } });
}

export async function updateBasic(req, res) {
    const row = await WaGroup.findByPk(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });

    const { title, is_bot_enabled, notif_data_access_enabled, mode_id } = req.body;

    if (mode_id) {
        const mode = await WaGroupMode.findByPk(mode_id);
        if (!mode) return res.status(400).json({ ok: false, error: "mode_id invalid" });
    }

    await row.update({ title, is_bot_enabled, notif_data_access_enabled, mode_id });
    res.json({ ok: true, data: row });
}

/**
 * PUT /groups/:id/leasing
 * Body:
 * {
 *   leasing_code: "ADIRA",
 *   leasing_level: "HO" | "AREA" | "CABANG",
 *   branch_ids: ["uuid", "uuid"] // required for AREA/CABANG (CABANG only 1)
 * }
 */
export async function setLeasingConfig(req, res) {
    const group = await WaGroup.findByPk(req.params.id);
    if (!group) return res.status(404).json({ ok: false, error: "Group not found" });

    const leasing_code = String(req.body.leasing_code || "").trim().toUpperCase();
    const lvl = String(req.body.leasing_level || "").trim().toUpperCase();
    const branch_ids = Array.isArray(req.body.branch_ids) ? req.body.branch_ids : [];

    if (!leasing_code) return res.status(400).json({ ok: false, error: "leasing_code wajib" });

    const leasing = await LeasingCompany.findOne({ where: { code: leasing_code } });
    if (!leasing) return res.status(400).json({ ok: false, error: "leasing_code not found" });

    if (!["HO", "AREA", "CABANG"].includes(lvl)) {
        return res.status(400).json({ ok: false, error: "leasing_level must be HO/AREA/CABANG" });
    }

    // replace pivot branches (reset dulu)
    await WaGroupLeasingBranch.destroy({ where: { group_id: group.id } });

    group.leasing_id = leasing.id;
    group.leasing_level = lvl;
    group.leasing_branch_id = null;

    // HO = nasional, tidak butuh branch_ids
    if (lvl === "HO") {
        await group.save();
        return res.json({ ok: true, data: { group, allowedBranches: "ALL" } });
    }

    if (!branch_ids.length) {
        return res.status(400).json({ ok: false, error: "branch_ids required for AREA/CABANG" });
    }

    const finalBranchIds = lvl === "CABANG" ? [branch_ids[0]] : branch_ids;

    const branches = await LeasingBranch.findAll({
        where: { id: finalBranchIds, leasing_id: leasing.id, is_active: true },
    });

    if (!branches.length) {
        return res.status(400).json({ ok: false, error: "No valid branches found for this leasing" });
    }

    await WaGroupLeasingBranch.bulkCreate(
        branches.map((b) => ({
            group_id: group.id,
            leasing_branch_id: b.id,
            is_active: true,
        })),
        { ignoreDuplicates: true }
    );

    if (lvl === "CABANG") group.leasing_branch_id = branches[0].id;

    await group.save();

    res.json({ ok: true, data: { group, allowedBranches: branches } });
}

/**
 * DELETE /groups/:id/leasing
 * Unset leasing untuk group:
 * - leasing_id=null
 * - leasing_level=null
 * - leasing_branch_id=null
 * - hapus pivot wa_group_leasing_branches
 */
export async function unsetLeasing(req, res) {
    const group = await WaGroup.findByPk(req.params.id);
    if (!group) return res.status(404).json({ ok: false, error: "Group not found" });

    await WaGroupLeasingBranch.destroy({ where: { group_id: group.id } });

    await group.update({
        leasing_id: null,
        leasing_level: null,
        leasing_branch_id: null,
    });

    res.json({ ok: true, data: group });
}
