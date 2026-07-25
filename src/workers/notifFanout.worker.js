import "dotenv/config";
import { Worker } from "bullmq";
import { Op } from "sequelize";

import {
    WaGroup,
    WaGroupMode,
    WaGroupMatel,
    LeasingCompany,
    LeasingBranch,
    WaGroupLeasingBranch,
    PtCompany,
} from "../models/index.js";

import { notifySendQueue } from "../queues/notifySendQueue.js";

console.log("[NOTIF_FANOUT] boot", {
    pid: process.pid,
    REDIS_URL: process.env.REDIS_URL,
});

const redisConnection = {
    url:
        process.env.REDIS_URL ||
        "redis://127.0.0.1:6380",

    maxRetriesPerRequest: null,
    enableReadyCheck: false,
};

// ======================================================
// Helpers
// ======================================================

function up(value) {
    return String(value || "")
        .trim()
        .toUpperCase();
}

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

/**
 * Nomor matel/pengakses.
 *
 * Sebaiknya controller pengirim payload memakai:
 * payload.matel_phone
 *
 * Field lain dipertahankan sebagai fallback.
 */
function getMatelPhone(payload = {}) {
    return normalizePhone62(
        payload.matel_phone ||
        payload.matelPhone ||
        payload.no_hp ||
        payload.hp ||
        payload.phone ||
        payload.user_phone ||
        payload.userPhone ||
        ""
    );
}

// ======================================================
// Target parsing management
// ======================================================

// manage_target contoh:
// "AKTIVASI,HAPUS_AKUN"
function parseTargets(value) {
    return String(value || "")
        .split(",")
        .map((item) =>
            item.trim().toUpperCase()
        )
        .filter(Boolean);
}

function hasTarget(groupManageTarget, wanted) {
    const target = up(wanted);

    if (!target) return false;

    const targets = new Set(
        parseTargets(groupManageTarget)
    );

    return targets.has(target);
}

// ======================================================
// Leasing helpers
// ======================================================

function normalizeLeasingName(raw) {
    const input = String(raw || "").trim();

    if (!input) return "";

    const cleaned = input
        .replace(/\s+/g, " ")
        .toUpperCase();

    const parts = cleaned
        .split(" ")
        .filter(Boolean);

    if (!parts.length) return "";

    const first = String(parts[0] || "")
        .replace(/[^A-Z0-9-]/g, "");

    const second = String(parts[1] || "")
        .replace(/[^A-Z0-9-]/g, "");

    const secondIsNumeric =
        second &&
        /^[0-9]+$/.test(second);

    const name =
        second && !secondIsNumeric
            ? `${first}-${second}`
            : first;

    return name.replace(/-+/g, "-");
}

// ======================================================
// Management helpers
// ======================================================

function getMgmtEventKey(payload = {}) {
    /*
     * Payload akses memiliki nopol.
     * Jangan dianggap sebagai event management,
     * walaupun payload memiliki field type.
     */
    if (payload.nopol) return "";

    return up(
        payload.event_key ||
        payload.event_type ||
        payload.type
    );
}

function getMgmtUniqDate(payload = {}) {
    return String(
        payload.tanggal ||
        payload.tanggal_aktivasi ||
        payload.tanggal_registrasi ||
        ""
    ).trim();
}

// ======================================================
// Leasing filter untuk group PT
// ======================================================

function normalizeLeasingList(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => up(item))
            .filter(Boolean);
    }

    if (typeof value === "string") {
        return value
            .split(",")
            .map((item) => up(item))
            .filter(Boolean);
    }

    return [];
}

function getGroupLeasingFilter(meta = {}) {
    const filter =
        meta?.leasing_filter ||
        meta?.leasingFilter ||
        null;

    if (!filter) return null;

    const mode = String(
        filter.mode ||
        filter.type ||
        ""
    )
        .trim()
        .toLowerCase();

    const leasingList =
        normalizeLeasingList(
            filter.leasing ||
            filter.leasings ||
            filter.list
        );

    if (
        !["only", "except"].includes(mode)
    ) {
        return null;
    }

    if (!leasingList.length) {
        return null;
    }

    return {
        mode,
        leasingList,
    };
}

function passesGroupLeasingFilter(
    groupMeta,
    leasingCode
) {
    const code = up(leasingCode);

    if (!code) return true;

    const filter =
        getGroupLeasingFilter(groupMeta);

    if (!filter) return true;

    const matched =
        filter.leasingList.includes(code);

    if (filter.mode === "only") {
        return matched;
    }

    if (filter.mode === "except") {
        return !matched;
    }

    return true;
}

// ======================================================
// PT filter untuk group leasing
// ======================================================

function normalizePtList(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => up(item))
            .filter(Boolean);
    }

    if (typeof value === "string") {
        return value
            .split(",")
            .map((item) => up(item))
            .filter(Boolean);
    }

    return [];
}

function getGroupPtFilter(meta = {}) {
    const filter =
        meta?.pt_filter ||
        meta?.ptFilter ||
        null;

    if (!filter) return null;

    const mode = String(
        filter.mode ||
        filter.type ||
        ""
    )
        .trim()
        .toLowerCase();

    const ptList =
        normalizePtList(
            filter.pt ||
            filter.pts ||
            filter.list
        );

    if (
        !["only", "except"].includes(mode)
    ) {
        return null;
    }

    if (!ptList.length) {
        return null;
    }

    return {
        mode,
        ptList,
    };
}

function passesGroupPtFilter(
    groupMeta,
    ptName
) {
    const pt = up(ptName);

    if (!pt) return true;

    const filter =
        getGroupPtFilter(groupMeta);

    if (!filter) return true;

    const matched =
        filter.ptList.includes(pt);

    if (filter.mode === "only") {
        return matched;
    }

    if (filter.mode === "except") {
        return !matched;
    }

    return true;
}

// ======================================================
// Resolve targets
// ======================================================

async function resolveTargetsForPayload(
    payload = {}
) {
    const leasingCode =
        up(payload.leasing_code) ||
        normalizeLeasingName(
            payload.leasing
        );

    const branchName = up(
        payload.cabang
    );

    const ptName = up(
        payload.pt
    );

    const matelPhone =
        getMatelPhone(payload);

    const managementEventKey =
        getMgmtEventKey(payload);

    const [
        modeLeasing,
        modePt,
        modeManagement,
        modeKorlap,
    ] = await Promise.all([
        WaGroupMode.findOne({
            where: {
                key: "leasing",
                is_active: true,
            },
            attributes: ["id"],
        }),

        WaGroupMode.findOne({
            where: {
                key: "pt",
                is_active: true,
            },
            attributes: ["id"],
        }),

        WaGroupMode.findOne({
            where: {
                key: "management",
                is_active: true,
            },
            attributes: ["id"],
        }),

        WaGroupMode.findOne({
            where: {
                key: "korlap",
                is_active: true,
            },
            attributes: ["id"],
        }),
    ]);

    const targets = [];

    // ==================================================
    // MANAGEMENT MODE ONLY
    // ==================================================

    if (
        modeManagement?.id &&
        managementEventKey
    ) {
        const managementGroups =
            await WaGroup.findAll({
                where: {
                    mode_id:
                    modeManagement.id,

                    notif_data_access_enabled:
                        true,

                    is_bot_enabled:
                        true,
                },

                attributes: [
                    "id",
                    "chat_id",
                    "mode_id",
                    "manage_target",
                    "leasing_id",
                    "pt_company_id",
                ],
            });

        for (
            const group
            of managementGroups
            ) {
            if (
                !hasTarget(
                    group.manage_target,
                    managementEventKey
                )
            ) {
                continue;
            }

            targets.push({
                group,
                reason:
                    `management:${managementEventKey}`,
            });
        }

        /*
         * Event management tidak diteruskan
         * ke leasing, PT, atau korlap.
         */
        return targets;
    }

    // ==================================================
    // LEASING MODE
    // ==================================================

    if (
        modeLeasing?.id &&
        leasingCode
    ) {
        const leasing =
            await LeasingCompany.findOne({
                where: {
                    code: leasingCode,
                    is_active: true,
                },
                attributes: [
                    "id",
                    "code",
                ],
            });

        if (leasing) {
            const groups =
                await WaGroup.findAll({
                    where: {
                        mode_id:
                        modeLeasing.id,

                        leasing_id:
                        leasing.id,

                        notif_data_access_enabled:
                            true,

                        is_bot_enabled:
                            true,
                    },

                    attributes: [
                        "id",
                        "chat_id",
                        "leasing_id",
                        "pt_company_id",
                        "leasing_level",
                        "meta",
                    ],
                });

            let branch = null;

            /*
             * Branch hanya dicari jika
             * ada grup leasing.
             */
            if (
                groups.length &&
                branchName
            ) {
                branch =
                    await LeasingBranch.findOne({
                        where: {
                            leasing_id:
                            leasing.id,

                            is_active:
                                true,

                            [Op.or]: [
                                {
                                    name:
                                    branchName,
                                },
                                {
                                    code:
                                    branchName,
                                },
                            ],
                        },

                        attributes: [
                            "id",
                            "name",
                            "code",
                        ],
                    });
            }

            for (const group of groups) {
                /*
                 * Filter PT opsional pada
                 * grup mode leasing.
                 */
                if (
                    !passesGroupPtFilter(
                        group.meta || {},
                        ptName
                    )
                ) {
                    continue;
                }

                const level = up(
                    group.leasing_level
                );

                if (level === "HO") {
                    targets.push({
                        group,
                        reason:
                            "leasing:HO",
                    });

                    continue;
                }

                if (!branch?.id) {
                    continue;
                }

                const allowed =
                    await WaGroupLeasingBranch.findOne(
                        {
                            where: {
                                group_id:
                                group.id,

                                leasing_branch_id:
                                branch.id,

                                is_active:
                                    true,
                            },

                            attributes: [
                                "id",
                            ],
                        }
                    );

                if (allowed) {
                    targets.push({
                        group,
                        reason:
                            `leasing:${level}`,
                    });
                }
            }
        }
    }

    // ==================================================
    // PT MODE
    // ==================================================

    if (
        modePt?.id &&
        ptName
    ) {
        const pt =
            await PtCompany.findOne({
                where: {
                    is_active: true,

                    [Op.or]: [
                        {
                            code:
                            ptName,
                        },
                        {
                            name:
                            ptName,
                        },
                    ],
                },

                attributes: [
                    "id",
                ],
            });

        if (pt) {
            const ptGroups =
                await WaGroup.findAll({
                    where: {
                        mode_id:
                        modePt.id,

                        pt_company_id:
                        pt.id,

                        notif_data_access_enabled:
                            true,

                        is_bot_enabled:
                            true,
                    },

                    attributes: [
                        "id",
                        "chat_id",
                        "leasing_id",
                        "pt_company_id",
                        "meta",
                    ],
                });

            for (
                const group
                of ptGroups
                ) {
                /*
                 * Filter leasing opsional
                 * pada group mode PT.
                 */
                if (
                    !passesGroupLeasingFilter(
                        group.meta || {},
                        leasingCode
                    )
                ) {
                    continue;
                }

                targets.push({
                    group,
                    reason: "pt",
                });
            }
        }
    }

    // ==================================================
    // KORLAP MODE
    // ==================================================
    /*
     * Mode korlap tidak terikat leasing.
     *
     * Grup menerima notifikasi ketika
     * nomor pengakses/matel terdaftar
     * pada wa_group_matels.
     */

    if (
        modeKorlap?.id &&
        matelPhone
    ) {
        /*
         * Query pivot terlebih dahulu.
         * Cara ini tidak bergantung pada
         * association include Sequelize.
         */
        const assignments =
            await WaGroupMatel.findAll({
                where: {
                    phone_e164:
                    matelPhone,

                    is_active:
                        true,
                },

                attributes: [
                    "group_id",
                ],

                raw: true,
            });

        const groupIds = [
            ...new Set(
                assignments
                    .map(
                        (item) =>
                            item.group_id
                    )
                    .filter(Boolean)
            ),
        ];

        if (groupIds.length) {
            const korlapGroups =
                await WaGroup.findAll({
                    where: {
                        id: {
                            [Op.in]:
                            groupIds,
                        },

                        mode_id:
                        modeKorlap.id,

                        notif_data_access_enabled:
                            true,

                        is_bot_enabled:
                            true,
                    },

                    attributes: [
                        "id",
                        "chat_id",
                        "leasing_id",
                        "pt_company_id",
                    ],
                });

            for (
                const group
                of korlapGroups
                ) {
                targets.push({
                    group,
                    reason:
                        `korlap:matel:${matelPhone}`,
                });
            }
        }
    }

    // ==================================================
    // Deduplicate targets
    // ==================================================

    const seen = new Set();

    return targets.filter(
        (target) => {
            const groupId =
                target.group?.id;

            if (!groupId) {
                return false;
            }

            if (
                seen.has(groupId)
            ) {
                return false;
            }

            seen.add(groupId);

            return true;
        }
    );
}

// ======================================================
// Worker FANOUT
// ======================================================

export const worker = new Worker(
    "wa_notify",

    async (job) => {
        console.log(
            "[NOTIF_FANOUT] processing",
            job.id,
            job.name
        );

        const payload =
            job.data || {};

        const targets =
            await resolveTargetsForPayload(
                payload
            );

        if (!targets.length) {
            return {
                ok: true,
                fanout: 0,
                note: "no targets",
                matel_phone:
                    getMatelPhone(
                        payload
                    ) || null,
            };
        }

        const managementEventKey =
            getMgmtEventKey(payload);

        /*
         * Management jika:
         * - payload memiliki event management; atau
         * - job lama memakai nama notify_management.
         */
        const isManagement =
            Boolean(
                managementEventKey
            ) ||
            job.name ===
            "notify_management" ||
            String(
                job.name || ""
            ).startsWith(
                "notify_management_"
            );

        const matelPhone =
            getMatelPhone(payload);

        const bulk = targets.map(
            (target) => {
                const group =
                    target.group;

                const managementKey =
                    up(
                        managementEventKey ||
                        payload.event_key ||
                        payload.event_type ||
                        payload.type ||
                        "MGMT"
                    );

                /*
                 * Deterministic unique key.
                 */
                const uniqueKey =
                    isManagement
                        ? [
                            "mgmt",
                            managementKey,
                            normalizePhone62(
                                payload.no_hp_user ||
                                payload.hp_user ||
                                ""
                            ),
                            getMgmtUniqDate(
                                payload
                            ),
                            group.id,
                        ].join("|")
                        : (() => {
                            const leasingKey =
                                up(
                                    payload.leasing_code
                                ) ||
                                normalizeLeasingName(
                                    payload.leasing
                                ) ||
                                up(
                                    payload.leasing
                                ).split(
                                    " "
                                )[0] ||
                                "NO_LEASING";

                            return [
                                "access",
                                leasingKey,
                                payload.nopol ||
                                "",
                                matelPhone ||
                                "",
                                group.id,
                                payload.accessDate ||
                                payload.waktu_akses ||
                                payload.access_at ||
                                "",
                            ].join("|");
                        })();

                return {
                    name:
                        isManagement
                            ? "management_event_send"
                            : "notify_access_group",

                    data: {
                        payload,

                        group: {
                            id:
                            group.id,

                            chat_id:
                            group.chat_id,

                            leasing_id:
                                group.leasing_id ||
                                null,

                            pt_company_id:
                                group.pt_company_id ||
                                null,
                        },

                        reason:
                        target.reason,

                        parent_job_id:
                        job.id,
                    },

                    opts: {
                        jobId:
                            "send_" +
                            Buffer.from(
                                uniqueKey
                            )
                                .toString(
                                    "base64url"
                                )
                                .slice(
                                    0,
                                    100
                                ),

                        removeOnComplete: {
                            count: 30000,
                        },

                        removeOnFail: {
                            count: 20000,
                        },

                        attempts: 5,

                        backoff: {
                            type:
                                "exponential",

                            delay: 1000,
                        },
                    },
                };
            }
        );

        await notifySendQueue.addBulk(
            bulk
        );

        console.log(
            "[NOTIF_FANOUT] job",
            job.id,
            "fanout =",
            bulk.length,
            {
                matelPhone:
                    matelPhone ||
                    null,
            }
        );

        return {
            ok: true,
            fanout:
            bulk.length,
            isMgmt:
            isManagement,
            event_key:
                managementEventKey ||
                null,
            matel_phone:
                matelPhone ||
                null,
        };
    },

    {
        connection:
        redisConnection,

        concurrency: Number(
            process.env
                .NOTIF_FANOUT_CONCURRENCY ||
            10
        ),

        limiter: {
            max: Number(
                process.env
                    .NOTIF_FANOUT_RATE_MAX ||
                50
            ),

            duration: Number(
                process.env
                    .NOTIF_FANOUT_RATE_MS ||
                1000
            ),
        },
    }
);

worker.on(
    "active",
    (job) => {
        console.log(
            "[NOTIF_FANOUT] active",
            job.id,
            job.name
        );
    }
);

worker.on(
    "completed",
    (job, result) => {
        console.log(
            "[NOTIF_FANOUT] completed",
            job.id,
            result
        );
    }
);

worker.on(
    "failed",
    (job, error) => {
        console.error(
            "[NOTIF_FANOUT] failed",
            job?.id,
            error?.message,
            error?.stack
        );
    }
);

worker.on(
    "error",
    (error) => {
        console.error(
            "[NOTIF_FANOUT] worker error",
            error?.message,
            error?.stack
        );
    }
);