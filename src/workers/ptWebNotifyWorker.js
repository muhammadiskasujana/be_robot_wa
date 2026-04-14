import "dotenv/config";
import { Worker } from "bullmq";
import { Op } from "sequelize";
import { LinkedPT, LeasingCompany } from "../models/index.js";

console.log("[PT_WEB_NOTIFY] boot", {
    pid: process.pid,
    REDIS_URL: process.env.REDIS_URL,
});

const redisConnection = {
    url: process.env.REDIS_URL || "redis://127.0.0.1:6380",
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
};

const PT_WEB_BASE_URL = process.env.PT_WEB_BASE_URL || "";

function up(v) {
    return String(v || "").trim().toUpperCase();
}

function low(v) {
    return String(v || "").trim().toLowerCase();
}

function cleanBaseUrl(v) {
    return String(v || "").replace(/\/+$/, "");
}

function normalizeLeasingCode(raw) {
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

function isNotifPtActive(meta) {
    const v = meta?.notif_pt;

    if (v === true) return true;
    if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        return ["aktif", "active", "true", "1", "yes", "ya"].includes(s);
    }

    return false;
}

async function sendToPtWeb({ tenantCode, payload }) {
    if (!PT_WEB_BASE_URL) {
        throw new Error("[PT_WEB_NOTIFY] PT_WEB_BASE_URL belum diset");
    }

    const url = `${cleanBaseUrl(PT_WEB_BASE_URL)}/api/notifikasi/access-unit`;

    const r = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Tenant": tenantCode,
        },
        body: JSON.stringify(payload),
    });

    const text = await r.text().catch(() => "");

    if (!r.ok) {
        throw new Error(
            `[PT_WEB_NOTIFY] ${r.status} ${r.statusText} ${text}`.trim()
        );
    }

    try {
        return JSON.parse(text);
    } catch {
        return { ok: true, raw: text };
    }
}

function normalizePayload(payload = {}) {
    return {
        nopol: payload.nopol || "",
        nosin: payload.nosin || "",
        noka: payload.noka || "",
        tipe: payload.tipe || "",
        leasing: payload.leasing || "",
        cabang: payload.cabang || "",
        ovd: payload.ovd || "",
        contactPerson: payload.contactPerson || payload.contact_person || "",
        keterangan: payload.keterangan || "",
        user: payload.user || payload.nama_user || "",
        no_hp: payload.no_hp || payload.hp || payload.phone || "",
        pt: payload.pt || payload.pt_name || "",
        accessLoc: payload.accessLoc || payload.access_loc || payload.location || null,
        accessDate: payload.accessDate || payload.access_at || "",
        pic_pt: payload.pic_pt || payload.picPt || "",
        no_hp_pic_pt:
            payload.no_hp_pic_pt || payload.hp_pic_pt || payload.pic_phone || "",
        reportDate: payload.reportDate || payload.tanggal_report || "",
        reportMessage: payload.reportMessage || "",
    };
}

/**
 * Flow lama + tambahan:
 * 1) target dari payload.pt -> linked_pt.name
 * 2) target tambahan dari leasing, jika leasing_company.meta.notif_pt aktif
 *    lalu cari linked_pt.meta.leasing == leasingCode
 */
async function resolveLinkedPtTargets(payload = {}) {
    const targets = [];
    const seen = new Set();

    const ptName = up(payload?.pt);
    const leasingCode = up(payload?.leasing_code) || normalizeLeasingCode(payload?.leasing);

    // ===== 1) FLOW LAMA: by payload.pt =====
    if (ptName) {
        const directPt = await LinkedPT.findOne({
            where: {
                name: ptName,
                is_active: true,
            },
            attributes: ["id", "name", "code", "meta", "is_active"],
        });

        if (directPt?.code) {
            const key = low(directPt.code);
            if (!seen.has(key)) {
                seen.add(key);
                targets.push({
                    source: "payload.pt",
                    linked: directPt,
                });
            }
        }
    }

    // ===== 2) FLOW BARU: by leasing mapping =====
    if (leasingCode) {
        const leasing = await LeasingCompany.findOne({
            where: {
                code: leasingCode,
                is_active: true,
            },
            attributes: ["id", "code", "name", "meta", "is_active"],
        });

        if (leasing && isNotifPtActive(leasing.meta)) {
            const linkedByLeasing = await LinkedPT.findAll({
                where: {
                    is_active: true,
                    meta: {
                        leasing: leasingCode,
                    },
                },
                attributes: ["id", "name", "code", "meta", "is_active"],
            });

            for (const row of linkedByLeasing) {
                if (!row?.code) continue;

                const key = low(row.code);
                if (seen.has(key)) continue;

                seen.add(key);
                targets.push({
                    source: `leasing:${leasingCode}`,
                    linked: row,
                });
            }
        }
    }

    return targets;
}

export const worker = new Worker(
    "pt_web_notify",
    async (job) => {
        console.log("[PT_WEB_NOTIFY] processing", {
            id: job.id,
            name: job.name,
        });

        const { payload, source } = job.data || {};

        if (!payload?.nopol) {
            return {
                ok: false,
                skipped: "invalid_payload",
                error: "payload.nopol kosong",
            };
        }

        const finalPayload = normalizePayload(payload);
        const targets = await resolveLinkedPtTargets(payload);

        if (!targets.length) {
            return {
                ok: true,
                skipped: "no_linked_pt_target",
                pt: up(payload?.pt),
                leasing_code: up(payload?.leasing_code) || normalizeLeasingCode(payload?.leasing),
                note: "Tidak ada target linked_pt yang cocok",
            };
        }

        const results = [];

        for (const target of targets) {
            const tenantCode = low(target.linked.code);

            try {
                const result = await sendToPtWeb({
                    tenantCode,
                    payload: finalPayload,
                });

                results.push({
                    ok: true,
                    source: target.source,
                    tenant_code: tenantCode,
                    linked_pt_id: target.linked.id,
                    pt: target.linked.name,
                    result,
                });
            } catch (err) {
                results.push({
                    ok: false,
                    source: target.source,
                    tenant_code: tenantCode,
                    linked_pt_id: target.linked.id,
                    pt: target.linked.name,
                    error: err.message,
                });
            }
        }

        const sentCount = results.filter((x) => x.ok).length;
        const failCount = results.filter((x) => !x.ok).length;

        return {
            ok: true,
            sent: sentCount > 0,
            source: source || "access-unit",
            total_targets: targets.length,
            sent_count: sentCount,
            fail_count: failCount,
            results,
        };
    },
    {
        connection: redisConnection,
        concurrency: Number(process.env.PT_WEB_NOTIFY_CONCURRENCY || 10),
        limiter: {
            max: Number(process.env.PT_WEB_NOTIFY_RATE_MAX || 30),
            duration: Number(process.env.PT_WEB_NOTIFY_RATE_MS || 1000),
        },
    }
);

worker.on("active", (job) =>
    console.log("[PT_WEB_NOTIFY] active", job.id, job.name)
);

worker.on("completed", (job, res) =>
    console.log("[PT_WEB_NOTIFY] completed", job.id, res)
);

worker.on("failed", (job, err) =>
    console.error("[PT_WEB_NOTIFY] failed", job?.id, err?.message, err?.stack)
);

worker.on("error", (err) =>
    console.error("[PT_WEB_NOTIFY] worker error", err?.message, err?.stack)
);

process.on("unhandledRejection", (e) =>
    console.error("[PT_WEB_NOTIFY] unhandledRejection", e)
);

process.on("uncaughtException", (e) =>
    console.error("[PT_WEB_NOTIFY] uncaughtException", e)
);