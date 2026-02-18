import "dotenv/config";
import { Worker } from "bullmq";
import { Op } from "sequelize";

import {
    WaGroup,
    WaGroupMode,
    LeasingCompany,
    LeasingBranch,
    WaGroupLeasingBranch,
    PtCompany,
} from "../models/index.js";

import { notifySendQueue } from "../queues/notifySendQueue.js";

console.log("[NOTIF_FANOUT] boot", { pid: process.pid, REDIS_URL: process.env.REDIS_URL });

const redisConnection = {
    url: process.env.REDIS_URL || "redis://127.0.0.1:6380",
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
};

// ============ helpers ============
function up(v) {
    return String(v || "").trim().toUpperCase();
}

// ===== target parsing (management) =====
// manage_target format: "AKTIVASI,HAPUS_AKUN"
function parseTargets(s) {
    return String(s || "")
        .split(",")
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean);
}
function hasTarget(groupManageTarget, want) {
    const w = up(want);
    if (!w) return false;
    const set = new Set(parseTargets(groupManageTarget));
    return set.has(w);
}

// leasing name normalizer
function normalizeLeasingName(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";

    const cleaned = s.replace(/\s+/g, " ").toUpperCase();
    const parts = cleaned.split(" ").filter(Boolean);
    if (!parts.length) return "";

    const p1 = (parts[0] || "").replace(/[^A-Z0-9-]/g, "");
    const p2 = (parts[1] || "").replace(/[^A-Z0-9-]/g, "");

    const isP2Numeric = p2 && /^[0-9]+$/.test(p2);
    const name = p2 && !isP2Numeric ? `${p1}-${p2}` : p1;

    return name.replace(/-+/g, "-");
}

// ===== helper untuk management event key =====
function getMgmtEventKey(payload) {
    // kalau payload akses (ada nopol), jangan dianggap management walau ada field "type"
    if (payload?.nopol) return "";

    return up(payload?.event_key || payload?.event_type || payload?.type);
}

function getMgmtUniqDate(payload) {
    // pakai tanggal umum bila ada
    return (
        String(payload?.tanggal || payload?.tanggal_aktivasi || payload?.tanggal_registrasi || "").trim() ||
        ""
    );
}

// ====== resolveTargetsForPayload(payload) ======
async function resolveTargetsForPayload(payload) {
    const leasingCode = up(payload.leasing_code) || normalizeLeasingName(payload.leasing);
    const cabangName = up(payload.cabang);
    const ptName = up(payload.pt);

    const wantEventKey = getMgmtEventKey(payload);

    const [modeLeasing, modePt, modeMgmt] = await Promise.all([
        WaGroupMode.findOne({ where: { key: "leasing", is_active: true }, attributes: ["id"] }),
        WaGroupMode.findOne({ where: { key: "pt", is_active: true }, attributes: ["id"] }),
        WaGroupMode.findOne({ where: { key: "management", is_active: true }, attributes: ["id"] }),
    ]);

    const targets = [];

    // ------- MANAGEMENT mode (GENERIC events) -------
    if (modeMgmt?.id && wantEventKey) {
        const groupsMgmt = await WaGroup.findAll({
            where: {
                mode_id: modeMgmt.id,
                notif_data_access_enabled: true, // ✅ sementara pakai flag yang sama (bisa dipisah nanti)
                is_bot_enabled: true,
            },
            attributes: ["id", "chat_id", "mode_id", "manage_target", "leasing_id", "pt_company_id"],
        });

        for (const g of groupsMgmt) {
            if (!hasTarget(g.manage_target, wantEventKey)) continue;
            targets.push({ group: g, reason: `management:${wantEventKey}` });
        }
    }

    // ------- LEASING mode (existing) -------
    if (modeLeasing?.id && leasingCode) {
        const leasing = await LeasingCompany.findOne({ where: { code: leasingCode, is_active: true } });
        if (leasing) {
            const groups = await WaGroup.findAll({
                where: {
                    mode_id: modeLeasing.id,
                    leasing_id: leasing.id,
                    notif_data_access_enabled: true,
                    is_bot_enabled: true,
                },
                attributes: ["id", "chat_id", "leasing_id", "pt_company_id", "leasing_level"],
            });

            if (groups.length) {
                const branch = await LeasingBranch.findOne({
                    where: {
                        leasing_id: leasing.id,
                        is_active: true,
                        [Op.or]: [{ name: cabangName }, { code: cabangName }],
                    },
                    attributes: ["id", "name", "code"],
                });

                for (const g of groups) {
                    const lvl = up(g.leasing_level);

                    if (lvl === "HO") {
                        targets.push({ group: g, reason: "leasing:HO" });
                        continue;
                    }

                    if (!branch?.id) continue;

                    const allowed = await WaGroupLeasingBranch.findOne({
                        where: { group_id: g.id, leasing_branch_id: branch.id, is_active: true },
                        attributes: ["id"],
                    });

                    if (allowed) targets.push({ group: g, reason: `leasing:${lvl}` });
                }
            }
        }
    }

    // ------- PT mode (existing) -------
    if (modePt?.id && ptName) {
        const pt = await PtCompany.findOne({
            where: { is_active: true, [Op.or]: [{ code: ptName }, { name: ptName }] },
            attributes: ["id"],
        });

        if (pt) {
            const groupsPt = await WaGroup.findAll({
                where: {
                    mode_id: modePt.id,
                    pt_company_id: pt.id,
                    notif_data_access_enabled: true,
                    is_bot_enabled: true,
                },
                attributes: ["id", "chat_id", "leasing_id", "pt_company_id"],
            });

            for (const g of groupsPt) targets.push({ group: g, reason: "pt" });
        }
    }

    // dedupe by group.id
    const seen = new Set();
    return targets.filter((t) => {
        if (seen.has(t.group.id)) return false;
        seen.add(t.group.id);
        return true;
    });
}

// ============ Worker: FANOUT ============
export const worker = new Worker(
    "wa_notify",
    async (job) => {
        console.log("[NOTIF_FANOUT] processing", job.id, job.name);

        const payload = job.data || {};
        const targets = await resolveTargetsForPayload(payload);

        if (!targets.length) return { ok: true, fanout: 0, note: "no targets" };

        // ✅ generic management detect:
        const wantEventKey = getMgmtEventKey(payload);

// management hanya kalau:
// - event_key ada (setelah filter nopol), ATAU
// - job.name memang mgmt dari controller lama
        const isMgmt = Boolean(wantEventKey) || job.name === "notify_management" || String(job.name || "").startsWith("notify_management_");
        const bulk = targets.map((t) => {
            const g = t.group;
            const mgmtKey = up(wantEventKey || payload?.event_key || payload?.event_type || payload?.type || "MGMT");
            // deterministic uniq (include event_key if management)
            const uniq = isMgmt
                ?  `mgmt|${mgmtKey}|${payload.no_hp_user || payload.hp_user || ""}|${getMgmtUniqDate(payload)}|${g.id}`
                : (() => {
                    const leasingKey =
                        up(payload.leasing_code) ||
                        normalizeLeasingName(payload.leasing) ||
                        up(payload.leasing).split(" ")[0];
                    return `${leasingKey}|${payload.nopol}|${g.id}|${payload.accessDate || ""}`;
                })();

            return {
                // ✅ send job name:
                name: isMgmt ? "management_event_send" : "notify_access_group",
                data: {
                    payload,
                    group: {
                        id: g.id,
                        chat_id: g.chat_id,
                        leasing_id: g.leasing_id || null,
                        pt_company_id: g.pt_company_id || null,
                    },
                    reason: t.reason,
                    parent_job_id: job.id,
                },
                opts: {
                    jobId: "send_" + Buffer.from(uniq).toString("base64url").slice(0, 80),
                    removeOnComplete: { count: 30000 },
                    removeOnFail: { count: 20000 },
                    attempts: 5,
                    backoff: { type: "exponential", delay: 1000 },
                },
            };
        });

        await notifySendQueue.addBulk(bulk);

        console.log("[NOTIF_FANOUT] job", job.id, "fanout =", bulk.length);
        return { ok: true, fanout: bulk.length, isMgmt, event_key: wantEventKey || null };
    },
    {
        connection: redisConnection,
        concurrency: Number(process.env.NOTIF_FANOUT_CONCURRENCY || 10),
        limiter: {
            max: Number(process.env.NOTIF_FANOUT_RATE_MAX || 50),
            duration: Number(process.env.NOTIF_FANOUT_RATE_MS || 1000),
        },
    }
);
