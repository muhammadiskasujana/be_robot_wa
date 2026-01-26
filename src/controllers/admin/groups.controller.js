import {
    WaGroup,
    WaGroupMode,
    LeasingCompany,
    LeasingBranch,
    WaGroupLeasingBranch,
} from "../../models/index.js";
import {parsePagination} from "../../utils/pagination.js";

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

    const {
        title,
        is_bot_enabled,
        notif_data_access_enabled,
        mode_id,
    } = req.body;

    // validasi mode_id kalau dikirim
    if (mode_id) {
        const mode = await WaGroupMode.findByPk(mode_id);
        if (!mode) return res.status(400).json({ ok: false, error: "mode_id invalid" });
    }

    await row.update({ title, is_bot_enabled, notif_data_access_enabled, mode_id });
    res.json({ ok: true, data: row });
}

/**
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

    const { leasing_code, leasing_level, branch_ids = [] } = req.body;

    const leasing = await LeasingCompany.findOne({ where: { code: leasing_code } });
    if (!leasing) return res.status(400).json({ ok: false, error: "leasing_code not found" });

    const lvl = String(leasing_level || "").toUpperCase();
    if (!["HO", "AREA", "CABANG"].includes(lvl)) {
        return res.status(400).json({ ok: false, error: "leasing_level must be HO/AREA/CABANG" });
    }

    // replace pivot branches
    await WaGroupLeasingBranch.destroy({ where: { group_id: group.id } });

    group.leasing_id = leasing.id;
    group.leasing_level = lvl;
    group.leasing_branch_id = null;

    if (lvl === "HO") {
        await group.save();
        return res.json({ ok: true, data: { group, allowedBranches: "ALL" } });
    }

    if (!Array.isArray(branch_ids) || branch_ids.length === 0) {
        return res.status(400).json({ ok: false, error: "branch_ids required for AREA/CABANG" });
    }

    const finalBranchIds = lvl === "CABANG" ? [branch_ids[0]] : branch_ids;

    // validate branches belong to leasing
    const branches = await LeasingBranch.findAll({
        where: { id: finalBranchIds, leasing_id: leasing.id, is_active: true },
    });

    if (branches.length === 0) {
        return res.status(400).json({ ok: false, error: "No valid branches found for this leasing" });
    }

    // insert pivot
    await WaGroupLeasingBranch.bulkCreate(
        branches.map((b) => ({
            group_id: group.id,
            leasing_branch_id: b.id,
            is_active: true,
        })),
        { ignoreDuplicates: true }
    );

    // shortcut for CABANG
    if (lvl === "CABANG") group.leasing_branch_id = branches[0].id;

    await group.save();

    res.json({ ok: true, data: { group, allowedBranches: branches } });
}
