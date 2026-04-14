export async function resolveCabangParamFromGroup({
                                                      group,
                                                      LeasingBranch,
                                                      WaGroupLeasingBranch,
                                                  }) {
    let cabangParam = "";
    const lvl = String(group?.leasing_level || "").toUpperCase();

    if (lvl === "CABANG" && group?.leasing_branch_id) {
        const b = await LeasingBranch.findByPk(group.leasing_branch_id, {
            attributes: ["name", "code"],
        });
        cabangParam = String(b?.name || b?.code || "").trim().toUpperCase();
    } else if (lvl === "AREA") {
        const rows = await WaGroupLeasingBranch.findAll({
            where: { group_id: group.id, is_active: true },
            include: [{ model: LeasingBranch, as: "branch" }],
            order: [["created_at", "ASC"]],
        });

        const names = rows
            .map((r) => r.branch?.name || r.branch?.code)
            .filter(Boolean)
            .map((s) => String(s).trim().toUpperCase());

        cabangParam = names.join(",");
    } else {
        cabangParam = ""; // HO / unset => NASIONAL
    }

    return cabangParam;
}