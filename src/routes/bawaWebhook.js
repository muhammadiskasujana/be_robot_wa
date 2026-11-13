import express from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { WaCommandEvent } from "../models/index.js";
import { commandConfig } from "../services/waCommandConfig.js";
import { aiConfig } from "../services/aiConfig.js";

const router = express.Router();

export function normalizeBawaIncoming(event) {
    const data = event.data || {};
    return {
        typeWebhook: "incomingMessageReceived",
        idMessage: data.id,
        timestamp: data.timestamp || event.timestamp,
        senderData: { chatId: data.chat, sender: data.sender, chatName: data.push_name || "" },
        messageData: {
            typeMessage: data.type,
            textMessageData: { textMessage: data.text || "" },
            ...(data.quoted ? {
                quotedMessageId: data.quoted.id,
                quotedMessage: {
                    idMessage: data.quoted.id,
                    stanzaId: data.quoted.id,
                    sender: data.quoted.sender,
                    textMessage: data.quoted.text || "",
                },
            } : {}),
            mentioned: data.mentioned || [],
        },
    };
}

export function validBawaSignature(rawBody, signature, secret) {
    if (!Buffer.isBuffer(rawBody) || !secret || typeof signature !== "string") return false;
    const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    const actual = Buffer.from(signature);
    const wanted = Buffer.from(expected);
    return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

router.post("/", express.raw({ type: "application/json", limit: "2mb" }), async (req, res) => {
    try {
        if (!Buffer.isBuffer(req.body)) return res.status(400).json({ ok: false });
        const event = JSON.parse(req.body.toString("utf8"));
        const command = process.env.WA_COMMAND_PROVIDER === "bawa" ? commandConfig() : null;
        const ai = aiConfig();
        const source = event.instance_id === command?.sessionId ? { provider: "bawa", secret: command.secret }
            : ai.provider === "bawa" && event.instance_id === ai.sessionId ? { provider: "ai", secret: ai.secret }
                : null;
        if (!source) return res.status(403).json({ ok: false, error: "unknown instance" });
        if (!validBawaSignature(req.body, req.headers["x-bawa-signature"], source.secret)) {
            return res.status(401).json({ ok: false });
        }
        if (event.event === "message.status") {
            if (!event.data?.id) return res.json({ ok: true, ignored: "missing_message_id" });
            await WaCommandEvent.findOrCreate({
                where: { event_key: `bawa:${event.instance_id}:${event.data.id}:status:${event.data.status || req.headers["x-bawa-delivery"] || ""}` },
                defaults: { direction: "status", provider: source.provider, instance_key: event.instance_id,
                    chat_id: event.data.chat || "", status: "done", payload: event },
            });
            return res.json({ ok: true });
        }
        if (event.event !== "message.received") return res.json({ ok: true, ignored: event.event });
        const data = event.data || {};
        if (data.from_me || data.type !== "text") return res.json({ ok: true, ignored: "not_incoming_text" });
        if (!data.id || !data.chat || !data.sender) return res.status(400).json({ ok: false, error: "missing message fields" });
        const [row, created] = await WaCommandEvent.findOrCreate({
            where: { event_key: `bawa:${event.instance_id}:${data.id}` },
            defaults: { direction: "in", provider: source.provider, instance_key: event.instance_id,
                chat_id: data.chat, payload: normalizeBawaIncoming(event) },
        });
        return res.json({ ok: true, accepted: true, duplicate: !created, eventId: row.id });
    } catch (error) {
        if (error instanceof SyntaxError) return res.status(400).json({ ok: false, error: "invalid JSON" });
        console.error("[bawa webhook]", error.message);
        return res.status(503).json({ ok: false, error: "Unable to persist webhook" });
    }
});

export default router;
