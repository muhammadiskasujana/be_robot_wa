import "dotenv/config";
import crypto from "crypto";
import { Worker } from "bullmq";
import { WaGroup, WaGroupMode } from "../models/index.js";
import { tarikanNotifySendQueue } from "../queues/tarikanNotifySendQueue.js";

const connection = {
    url: process.env.REDIS_URL || "redis://127.0.0.1:6380",
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
};

function upper(value) {
    return String(value ?? "").trim().toUpperCase();
}

function targets(value) {
    return String(value || "").split(",").map(upper).filter(Boolean);
}

function leasingCode(value) {
    const parts = upper(value).split(/\s+/).filter(Boolean);
    const first = (parts[0] || "").replace(/[^A-Z0-9-]/g, "");
    const second = (parts[1] || "").replace(/[^A-Z0-9-]/g, "");
    return second && !/^\d+$/.test(second) ? `${first}-${second}` : first;
}

function inputFilter(meta) {
    const raw = meta?.input_tarikan_filter || meta?.inputTarikanFilter || null;
    if (!raw) return { mode: "ALL", leasingCodes: [] };
    const mode = upper(raw.mode || raw.type || "ALL");
    const source = raw.leasing_codes || raw.leasingCodes || raw.leasing || raw.list || [];
    const leasingCodes = (Array.isArray(source) ? source : String(source).split(","))
        .map(leasingCode)
        .filter(Boolean);
    return { mode: mode === "ONLY" ? "ONLY" : "ALL", leasingCodes };
}

function accepts(group, payloadLeasingCode) {
    const filter = inputFilter(group.meta || {});
    if (filter.mode === "ALL") return true;
    const normalized = leasingCode(payloadLeasingCode);
    return Boolean(normalized) && filter.leasingCodes.includes(normalized);
}

export const worker = new Worker(
    "wa_tarikan_notify",
    async (job) => {
        if (job.name !== "notify_tarikan_input") return { ok: true, skipped: "unsupported_job" };

        const payload = job.data || {};
        const mode = await WaGroupMode.findOne({
            where: { key: "management", is_active: true },
            attributes: ["id"],
        });
        if (!mode) return { ok: true, fanout: 0, skipped: "management_mode_not_found" };

        const groups = await WaGroup.findAll({
            where: {
                mode_id: mode.id,
                notif_data_access_enabled: true,
                is_bot_enabled: true,
            },
            attributes: ["id", "chat_id", "manage_target", "meta"],
        });

        const selected = groups.filter((group) =>
            targets(group.manage_target).includes("INPUT_TARIKAN") &&
            accepts(group, payload.leasing_code)
        );

        const jobs = selected.map((group) => {
            const unique = crypto
                .createHash("sha256")
                .update(`${payload.event_id}|${group.id}`)
                .digest("hex");
            return {
                name: "tarikan_input_send",
                data: {
                    payload,
                    group: { id: group.id, chat_id: group.chat_id },
                    parent_job_id: job.id,
                },
                opts: {
                    jobId: `tarikan_send_${unique}`,
                    attempts: 5,
                    backoff: { type: "exponential", delay: 1000 },
                    removeOnComplete: { count: 30000 },
                    removeOnFail: { count: 20000 },
                },
            };
        });

        if (jobs.length) await tarikanNotifySendQueue.addBulk(jobs);
        return {
            ok: true,
            fanout: jobs.length,
            leasing_code: payload.leasing_code || null,
            event_id: payload.event_id,
        };
    },
    {
        connection,
        concurrency: Number(process.env.TARIKAN_NOTIF_FANOUT_CONCURRENCY || 10),
        limiter: {
            max: Number(process.env.TARIKAN_NOTIF_FANOUT_RATE_MAX || 50),
            duration: Number(process.env.TARIKAN_NOTIF_FANOUT_RATE_MS || 1000),
        },
    }
);

console.log("[TARIKAN_NOTIF_FANOUT] active", { pid: process.pid });
worker.on("failed", (job, error) => console.error("[TARIKAN_NOTIF_FANOUT] failed", job?.id, error?.message));
worker.on("error", (error) => console.error("[TARIKAN_NOTIF_FANOUT] error", error?.message));
