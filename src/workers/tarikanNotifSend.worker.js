import "dotenv/config";
import IORedis from "ioredis";
import { Worker } from "bullmq";
import { buildTarikanInputMessage } from "../services/notifTarikan/tarikanMessage.js";
import { bawaSend } from "../services/bawaClient.js";

const BAWA_BASE_URL = (process.env.TARIKAN_NOTIF_BAWA_BASE_URL || "https://api-gateway.intelixstudio.tech").replace(/\/$/, "");
const BAWA_INSTANCE_ID = process.env.TARIKAN_NOTIF_BAWA_INSTANCE_ID;
const BAWA_TOKEN = process.env.TARIKAN_NOTIF_BAWA_TOKEN;
if (!BAWA_INSTANCE_ID || !BAWA_TOKEN) throw new Error("TARIKAN_NOTIF_BAWA_INSTANCE_ID dan TARIKAN_NOTIF_BAWA_TOKEN wajib diisi");

const connection = {
    url: process.env.REDIS_URL || "redis://127.0.0.1:6380",
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
};
const redis = new IORedis(connection.url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});

async function takeRateToken(sessionId) {
    const max = Number(process.env.TARIKAN_NOTIF_RATE_MAX || 10);
    const windowMs = Number(process.env.TARIKAN_NOTIF_RATE_MS || 1000);
    const ttl = Math.max(1, Math.ceil(windowMs / 1000));
    const key = `rl:tarikan_notif_session:${sessionId}`;
    const lua = `
        local value = redis.call("INCR", KEYS[1])
        if value == 1 then redis.call("EXPIRE", KEYS[1], ARGV[2]) end
        if value > tonumber(ARGV[1]) then return 0 end
        return 1
    `;
    while (true) {
        const allowed = await redis.eval(lua, 1, key, String(max), String(ttl));
        if (allowed === 1) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

export const worker = new Worker(
    "wa_tarikan_notify_send",
    async (job) => {
        if (job.name !== "tarikan_input_send") return { ok: true, skipped: "unsupported_job" };
        const { payload, group } = job.data || {};
        if (!payload?.event_id || !group?.id || !group?.chat_id) throw new Error("invalid tarikan send job");
        const message = buildTarikanInputMessage(payload);
        await takeRateToken(BAWA_INSTANCE_ID);
        await bawaSend({ baseURL: BAWA_BASE_URL, instanceId: BAWA_INSTANCE_ID,
            token: BAWA_TOKEN, to: group.chat_id, message, requestId: `tarikan-notif-${job.id}` });
        return { ok: true, sent: true, group_id: group.id, instance_id: BAWA_INSTANCE_ID, event_id: payload.event_id };
    },
    {
        connection,
        concurrency: Number(process.env.TARIKAN_NOTIF_SEND_CONCURRENCY || 10),
    }
);

console.log("[TARIKAN_NOTIF_SEND] active", { pid: process.pid, instance_id: BAWA_INSTANCE_ID });
worker.on("failed", (job, error) => console.error("[TARIKAN_NOTIF_SEND] failed", job?.id, error?.message));
worker.on("error", (error) => console.error("[TARIKAN_NOTIF_SEND] error", error?.message));
