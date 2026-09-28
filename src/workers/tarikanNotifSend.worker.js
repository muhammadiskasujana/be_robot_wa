import "dotenv/config";
import axios from "axios";
import https from "https";
import IORedis from "ioredis";
import { Worker } from "bullmq";
import { buildTarikanInputMessage } from "../services/notifTarikan/tarikanMessage.js";

const WA_SEND_URL = "https://wa-gateway.ridjstudio.cloud/api/external/whatsapp/send/text";
const WA_BEARER = process.env.WA_EXT_BEARER || "whatsapp_ext_9f8a2b7c6d5e4a3b";
const WA_TENANT = process.env.WA_EXT_TENANT || "gateway";

// Isi di Coolify sebagai CSV: session-id-1,session-id-2
const NOTIF_SESSIONS = String(process.env.TARIKAN_NOTIF_SESSIONS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

const connection = {
    url: process.env.REDIS_URL || "redis://127.0.0.1:6380",
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
};
const redis = new IORedis(connection.url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});
const httpsAgent = new https.Agent({ keepAlive: true });

function hashIndex(value, size) {
    let hash = 0;
    for (const char of String(value || "")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return size ? hash % size : 0;
}

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

async function sendViaGateway({ sessionId, to, message }) {
    const response = await axios.post(
        WA_SEND_URL,
        { session_id: sessionId, to, message, mentions: [] },
        {
            httpsAgent,
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${WA_BEARER}`,
                "X-Tenant": WA_TENANT,
            },
            timeout: 15000,
        }
    );
    return response.data;
}

async function sendWithFallback({ to, message }) {
    if (!NOTIF_SESSIONS.length) throw new Error("TARIKAN_NOTIF_SESSIONS kosong");
    const start = hashIndex(to, NOTIF_SESSIONS.length);
    let lastError;
    for (let index = 0; index < NOTIF_SESSIONS.length; index++) {
        const sessionId = NOTIF_SESSIONS[(start + index) % NOTIF_SESSIONS.length];
        try {
            await takeRateToken(sessionId);
            await sendViaGateway({ sessionId, to, message });
            return sessionId;
        } catch (error) {
            lastError = error;
            console.error("[TARIKAN_NOTIF_SEND] session failed", sessionId, error?.response?.data || error?.message);
        }
    }
    throw lastError || new Error("Semua session input tarikan gagal");
}

export const worker = new Worker(
    "wa_tarikan_notify_send",
    async (job) => {
        if (job.name !== "tarikan_input_send") return { ok: true, skipped: "unsupported_job" };
        const { payload, group } = job.data || {};
        if (!payload?.event_id || !group?.id || !group?.chat_id) throw new Error("invalid tarikan send job");
        const message = buildTarikanInputMessage(payload);
        const sessionId = await sendWithFallback({ to: group.chat_id, message });
        return { ok: true, sent: true, group_id: group.id, session_id: sessionId, event_id: payload.event_id };
    },
    {
        connection,
        concurrency: Number(process.env.TARIKAN_NOTIF_SEND_CONCURRENCY || 10),
    }
);

console.log("[TARIKAN_NOTIF_SEND] active", { pid: process.pid, sessions: NOTIF_SESSIONS.length });
worker.on("failed", (job, error) => console.error("[TARIKAN_NOTIF_SEND] failed", job?.id, error?.message));
worker.on("error", (error) => console.error("[TARIKAN_NOTIF_SEND] error", error?.message));
