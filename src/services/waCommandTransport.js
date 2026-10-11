import axios from "axios";
import { randomUUID } from "node:crypto";
import { commandExecution } from "./waCommandExecution.js";
import { WaCommandEvent } from "../models/index.js";
import { redis } from "../queues/redis.js";
import { commandConfig } from "./waCommandConfig.js";
import { sendText as greenText, sendFileByUpload as greenFile } from "./greenapi.js";

export { commandExecution };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function gatewayRequest(path, body) {
    const c = commandConfig();
    const response = await axios.post(`${c.baseURL}/api/external/whatsapp/command/${path}`, {
        ...body, session_id: c.sessionId,
    }, { headers: { Authorization: `Bearer ${c.token}`, "X-Tenant": c.tenant }, timeout: 120000 });
    return response.data;
}

// Shared across command processes. No second persistent transport queue for Green API.
async function greenSerial(instanceId, send) {
    const key = `wa:command:green-send:${instanceId}`;
    const owner = randomUUID();
    const keys = [key + ":waiters", key + ":leases", key + ":sequence"];
    // Transient FIFO mutex tickets: payloads stay in the application/Green API, not Redis.
    await redis.eval("local n=redis.call('INCR',KEYS[3]); redis.call('ZADD',KEYS[1],n,ARGV[1]); redis.call('HSET',KEYS[2],ARGV[1],ARGV[2]); for i=1,3 do redis.call('PEXPIRE',KEYS[i],600000) end return n", 3, ...keys, owner, String(Date.now() + 150000));
    const renewal = setInterval(() => redis.hset(keys[1], owner, String(Date.now() + 150000)).catch(e => console.error("[command lock]", e.message)), 30000);
    try {
        const until = Date.now() + 180000;
        while (true) {
            const head = await redis.eval("while true do local h=redis.call('ZRANGE',KEYS[1],0,0)[1]; if not h then return 0 end; local exp=tonumber(redis.call('HGET',KEYS[2],h) or '0'); if exp <= tonumber(ARGV[2]) then redis.call('ZREM',KEYS[1],h); redis.call('HDEL',KEYS[2],h); else return h==ARGV[1] and 1 or 0 end end", 2, keys[0], keys[1], owner, String(Date.now()));
            if (head === 1) break;
            if (Date.now() > until) throw new Error("Green API command send lock timeout");
            await sleep(100);
        }
        return await send();
    }
    finally {
        clearInterval(renewal);
        await redis.eval("redis.call('ZREM',KEYS[1],ARGV[1]); return redis.call('HDEL',KEYS[2],ARGV[1])", 2, keys[0], keys[1], owner);
    }
}

async function sendGateway(kind, ctx) {
    const c = commandConfig();
    const execution = commandExecution.getStore();
    const eventKey = execution ? `reply-${execution.id}-${++execution.sequence}` : `reply-${randomUUID()}`;
    const payload = kind === "text" ? {
        kind, to: ctx.chatId, message: ctx.message, quoted_message_id: ctx.quotedMessageId, mentions: ctx.mentions || [],
    } : {
        kind, to: ctx.chatId, base64: Buffer.from(ctx.buffer).toString("base64"),
        filename: ctx.filename, mimetype: ctx.contentType || "application/pdf", caption: ctx.caption || "",
    };
    const [event] = await WaCommandEvent.findOrCreate({ where: { event_key: eventKey }, defaults: {
        direction: "out", provider: "baileys", instance_key: c.sessionId,
        chat_id: ctx.chatId, payload,
    } });
    const deadline = Date.now() + Number(process.env.WA_COMMAND_SEND_WAIT_MS || 300000);
    while (Date.now() < deadline) {
        await event.reload({ attributes: ["id", "status", "result", "error"] });
        if (event.status === "sent") return event.result;
        if (["failed", "unknown"].includes(event.status)) throw new Error(event.error || `Command send ${event.status}`);
        await sleep(200);
    }
    throw new Error(`Command send still queued: ${event.id}; do not resubmit command`);
}

export async function sendText(ctx) {
    return commandConfig().provider === "baileys" ? sendGateway("text", ctx)
        : greenSerial(ctx.idInstance, () => greenText(ctx));
}
export async function sendFileByUpload(ctx) {
    if (!ctx.buffer?.length) throw new Error("File WhatsApp kosong");
    return commandConfig().provider === "baileys" ? sendGateway("document", ctx)
        : greenSerial(ctx.idInstance, () => greenFile(ctx));
}
