import { Op } from "sequelize";

import {
    WaGroup,
    WaGroupMatel,
    WaGroupMode,
} from "../../models/index.js";

import {
    parsePagination,
    buildMeta,
} from "../../utils/pagination.js";

function normalizePhone62(value = "") {
    let phone = String(value || "")
        .replace(/[^\d]/g, "")
        .trim();

    if (!phone) return "";

    if (phone.startsWith("0")) {
        phone = `62${phone.slice(1)}`;
    } else if (phone.startsWith("8")) {
        phone = `62${phone}`;
    }

    return phone;
}

function isValidPhone62(value = "") {
    return /^62\d{8,15}$/.test(value);
}

async function getKorlapMode() {
    return WaGroupMode.findOne({
        where: {
            key: "korlap",
            is_active: true,
        },
    });
}

async function getKorlapGroup(groupId) {
    const group = await WaGroup.findByPk(groupId, {
        include: [
            {
                model: WaGroupMode,
                as: "mode",
                attributes: ["id", "key"],
            },
        ],
    });

    if (!group) {
        return {
            ok: false,
            status: 404,
            error: "Group not found",
        };
    }

    const modeKey = String(
        group.mode?.key || ""
    ).toLowerCase();

    if (modeKey !== "korlap") {
        return {
            ok: false,
            status: 400,
            error:
                "Group bukan mode korlap. " +
                "Set mode group menjadi korlap terlebih dahulu.",
        };
    }

    return {
        ok: true,
        group,
    };
}

/**
 * GET /group-matels
 *
 * Query:
 * - page
 * - limit
 * - q
 * - group_id
 * - phone_e164
 * - is_active
 */
export async function list(req, res) {
    const {
        limit,
        page,
        offset,
    } = parsePagination(req.query);

    const q = String(req.query.q || "").trim();
    const groupId = String(
        req.query.group_id || ""
    ).trim();

    const phone = normalizePhone62(
        req.query.phone_e164 || ""
    );

    const where = {};

    if (groupId) {
        where.group_id = groupId;
    }

    if (phone) {
        where.phone_e164 = phone;
    }

    if (
        req.query.is_active !== undefined &&
        req.query.is_active !== ""
    ) {
        where.is_active =
            String(req.query.is_active).toLowerCase() === "true";
    }

    if (q) {
        where[Op.or] = [
            {
                phone_e164: {
                    [Op.iLike]: `%${q}%`,
                },
            },
            {
                matel_name: {
                    [Op.iLike]: `%${q}%`,
                },
            },
            {
                created_by_phone: {
                    [Op.iLike]: `%${q}%`,
                },
            },
        ];
    }

    const {
        rows,
        count,
    } = await WaGroupMatel.findAndCountAll({
        where,
        limit,
        offset,
        distinct: true,
        order: [
            ["updated_at", "DESC"],
        ],
        include: [
            {
                model: WaGroup,
                as: "group",
                attributes: [
                    "id",
                    "chat_id",
                    "title",
                    "mode_id",
                    "is_bot_enabled",
                    "notif_data_access_enabled",
                ],
                include: [
                    {
                        model: WaGroupMode,
                        as: "mode",
                        attributes: [
                            "id",
                            "key",
                        ],
                    },
                ],
            },
        ],
    });

    res.json({
        ok: true,
        data: rows,
        meta: buildMeta({
            page,
            limit,
            total: count,
        }),
    });
}

/**
 * GET /groups/:groupId/matels
 */
export async function listByGroup(req, res) {
    const groupResult = await getKorlapGroup(
        req.params.groupId
    );

    if (!groupResult.ok) {
        return res.status(groupResult.status).json({
            ok: false,
            error: groupResult.error,
        });
    }

    const rows = await WaGroupMatel.findAll({
        where: {
            group_id: groupResult.group.id,
        },
        order: [
            ["is_active", "DESC"],
            ["matel_name", "ASC"],
            ["phone_e164", "ASC"],
        ],
    });

    res.json({
        ok: true,
        data: {
            group: groupResult.group,
            matels: rows,
            total: rows.length,
        },
    });
}

/**
 * GET /group-matels/:id
 */
export async function getById(req, res) {
    const row = await WaGroupMatel.findByPk(
        req.params.id,
        {
            include: [
                {
                    model: WaGroup,
                    as: "group",
                    include: [
                        {
                            model: WaGroupMode,
                            as: "mode",
                        },
                    ],
                },
            ],
        }
    );

    if (!row) {
        return res.status(404).json({
            ok: false,
            error: "Matel not found",
        });
    }

    res.json({
        ok: true,
        data: row,
    });
}

/**
 * POST /groups/:groupId/matels
 *
 * Body:
 * {
 *   "phone_e164": "081234567890",
 *   "matel_name": "Ahmad",
 *   "is_active": true,
 *   "created_by_phone": "628xxxx",
 *   "meta": {}
 * }
 */
export async function create(req, res) {
    const groupResult = await getKorlapGroup(
        req.params.groupId
    );

    if (!groupResult.ok) {
        return res.status(groupResult.status).json({
            ok: false,
            error: groupResult.error,
        });
    }

    const phone = normalizePhone62(
        req.body.phone_e164
    );

    if (!phone) {
        return res.status(400).json({
            ok: false,
            error: "phone_e164 wajib",
        });
    }

    if (!isValidPhone62(phone)) {
        return res.status(400).json({
            ok: false,
            error:
                "Nomor telepon tidak valid. " +
                "Gunakan format 08xxx atau 628xxx.",
        });
    }

    const matelName = String(
        req.body.matel_name || ""
    ).trim();

    const createdByPhone = normalizePhone62(
        req.body.created_by_phone || ""
    );

    const existing = await WaGroupMatel.findOne({
        where: {
            group_id: groupResult.group.id,
            phone_e164: phone,
        },
    });

    if (existing) {
        if (existing.is_active) {
            return res.status(409).json({
                ok: false,
                error:
                    "Nomor matel sudah terdaftar " +
                    "di grup ini.",
                data: existing,
            });
        }

        await existing.update({
            matel_name:
                matelName ||
                existing.matel_name ||
                null,

            is_active:
                req.body.is_active !== undefined
                    ? Boolean(req.body.is_active)
                    : true,

            created_by_phone:
                createdByPhone ||
                existing.created_by_phone ||
                null,

            meta:
                req.body.meta !== undefined
                    ? req.body.meta
                    : existing.meta,
        });

        return res.json({
            ok: true,
            reactivated: true,
            data: existing,
        });
    }

    const row = await WaGroupMatel.create({
        group_id: groupResult.group.id,
        phone_e164: phone,
        matel_name: matelName || null,

        is_active:
            req.body.is_active !== undefined
                ? Boolean(req.body.is_active)
                : true,

        created_by_phone:
            createdByPhone || null,

        meta:
            req.body.meta &&
            typeof req.body.meta === "object"
                ? req.body.meta
                : null,
    });

    res.status(201).json({
        ok: true,
        data: row,
    });
}

/**
 * PUT /group-matels/:id
 *
 * Body:
 * {
 *   "phone_e164": "0812...",
 *   "matel_name": "Nama",
 *   "is_active": true,
 *   "meta": {}
 * }
 */
export async function update(req, res) {
    const row = await WaGroupMatel.findByPk(
        req.params.id
    );

    if (!row) {
        return res.status(404).json({
            ok: false,
            error: "Matel not found",
        });
    }

    const updates = {};

    if (req.body.phone_e164 !== undefined) {
        const phone = normalizePhone62(
            req.body.phone_e164
        );

        if (!isValidPhone62(phone)) {
            return res.status(400).json({
                ok: false,
                error:
                    "Nomor telepon tidak valid. " +
                    "Gunakan format 08xxx atau 628xxx.",
            });
        }

        const duplicate = await WaGroupMatel.findOne({
            where: {
                group_id: row.group_id,
                phone_e164: phone,
                id: {
                    [Op.ne]: row.id,
                },
            },
        });

        if (duplicate) {
            return res.status(409).json({
                ok: false,
                error:
                    "Nomor matel sudah terdaftar " +
                    "di grup ini.",
            });
        }

        updates.phone_e164 = phone;
    }

    if (req.body.matel_name !== undefined) {
        const matelName = String(
            req.body.matel_name || ""
        ).trim();

        updates.matel_name =
            matelName || null;
    }

    if (req.body.is_active !== undefined) {
        updates.is_active = Boolean(
            req.body.is_active
        );
    }

    if (req.body.created_by_phone !== undefined) {
        updates.created_by_phone =
            normalizePhone62(
                req.body.created_by_phone
            ) || null;
    }

    if (req.body.meta !== undefined) {
        updates.meta =
            req.body.meta &&
            typeof req.body.meta === "object"
                ? req.body.meta
                : null;
    }

    await row.update(updates);

    res.json({
        ok: true,
        data: row,
    });
}

/**
 * PATCH /group-matels/:id/status
 *
 * Body:
 * {
 *   "is_active": true
 * }
 */
export async function updateStatus(req, res) {
    const row = await WaGroupMatel.findByPk(
        req.params.id
    );

    if (!row) {
        return res.status(404).json({
            ok: false,
            error: "Matel not found",
        });
    }

    if (typeof req.body.is_active !== "boolean") {
        return res.status(400).json({
            ok: false,
            error: "is_active harus boolean",
        });
    }

    await row.update({
        is_active: req.body.is_active,
    });

    res.json({
        ok: true,
        data: row,
    });
}

/**
 * DELETE /group-matels/:id
 *
 * Hard delete.
 */
export async function remove(req, res) {
    const row = await WaGroupMatel.findByPk(
        req.params.id
    );

    if (!row) {
        return res.status(404).json({
            ok: false,
            error: "Matel not found",
        });
    }

    await row.destroy();

    res.json({
        ok: true,
        deleted_id: req.params.id,
    });
}

/**
 * DELETE /groups/:groupId/matels/:phone
 *
 * Hapus berdasarkan group dan nomor.
 */
export async function removeByPhone(req, res) {
    const group = await WaGroup.findByPk(
        req.params.groupId
    );

    if (!group) {
        return res.status(404).json({
            ok: false,
            error: "Group not found",
        });
    }

    const phone = normalizePhone62(
        req.params.phone
    );

    if (!isValidPhone62(phone)) {
        return res.status(400).json({
            ok: false,
            error: "Nomor telepon tidak valid",
        });
    }

    const deleted = await WaGroupMatel.destroy({
        where: {
            group_id: group.id,
            phone_e164: phone,
        },
    });

    if (!deleted) {
        return res.status(404).json({
            ok: false,
            error:
                "Nomor matel tidak ditemukan " +
                "di grup ini.",
        });
    }

    res.json({
        ok: true,
        group_id: group.id,
        phone_e164: phone,
    });
}