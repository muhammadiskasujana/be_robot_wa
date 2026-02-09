import "dotenv/config";
import { Worker } from "bullmq";
import { Op } from "sequelize";
import Sequelize from "sequelize";

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
function up(v) { return String(v || "").trim().toUpperCase(); }

function normalizeLeasingName(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";

    const cleaned = s.replace(/\s+/g, " ").toUpperCase();
    const parts = cleaned.split(" ").filter(Boolean);
    if (!parts.length) return "";

    const p1 = (parts[0] || "").replace(/[^A-Z0-9-]/g, "");
    const p2 = (parts[1] || "").replace(/[^A-Z0-9-]/g, "");

    // "FIF 0226" -> FIF
    // "ADIRA-WO 1225" -> ADIRA-WO
    // "ADIRA WO 1225" -> ADIRA-WO
    const isP2Numeric = p2 && /^[0-9]+$/.test(p2);
    const name = p2 && !isP2Numeric ? `${p1}-${p2}` : p1;

    return name.replace(/-+/g, "-");
}


// ============ target resolver (punyamu) ============
    async function resolveTargetsForPayload(payload) {
        const leasingCode = up(payload.leasing_code) || normalizeLeasingName(payload.leasing);
        const cabangName = up(payload.cabang);
        const ptName = up(payload.pt);
    
        const [modeLeasing, modePt] = await Promise.all([
            WaGroupMode.findOne({ where: { key: "leasing", is_active: true }, attributes: ["id"] }),
            WaGroupMode.findOne({ where: { key: "pt", is_active: true }, attributes: ["id"] }),
        ]);
    
        const targets = [];
    
        // ------- LEASING mode -------
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
                    attributes: ["id", "chat_id", "leasing_id", "pt_company_id", "leasing_level"], // penting: kecilin payload
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
    
        // ------- PT mode -------
        if (modePt?.id && ptName) {
            const pt = await PtCompany.findOne({
                where: {
                    is_active: true,
                    [Op.or]: [{ code: ptName }, { name: ptName }],
                },
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

        // addBulk: 1 group = 1 job send
        const bulk = targets.map((t) => {
            const g = t.group;

            // jobId deterministic biar idempotent (job yang sama tidak dobel)
            // gabung leasing+nopol+groupId+accessDate (kalau ada)
            const leasingKey = up(payload.leasing_code) || normalizeLeasingName(payload.leasing) || up(payload.leasing).split(" ")[0];
            const uniq = `${leasingKey}|${payload.nopol}|${g.id}|${payload.accessDate || ""}`;

            return {
                name: "notify_access_group",
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
        return { ok: true, fanout: bulk.length };
    },
    {
        connection: redisConnection,
        concurrency: Number(process.env.NOTIF_FANOUT_CONCURRENCY || 10),
        // limiter job fanout boleh agak tinggi (ini bukan pesan)
        limiter: {
            max: Number(process.env.NOTIF_FANOUT_RATE_MAX || 50),
            duration: Number(process.env.NOTIF_FANOUT_RATE_MS || 1000),
        },
    }
);
