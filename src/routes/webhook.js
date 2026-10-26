import express from "express";
import { timingSafeEqual } from "node:crypto";
import { WaInstance, WaMessageLog, WaCommandEvent } from "../models/index.js";
import { commandConfig } from "../services/waCommandConfig.js";
import { aiConfig } from "../services/aiConfig.js";
const router = express.Router();
function matchesSecret(actual, expected) {
  if (!expected || typeof actual !== "string") return false;
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function saveIncoming(provider, instanceKey, body) {
  const [row, created] = await WaCommandEvent.findOrCreate({
    where: { event_key: `${provider}:${instanceKey}:${body.idMessage}` },
    defaults: {
      direction: "in",
      provider,
      instance_key: String(instanceKey),
      chat_id: body.senderData.chatId,
      payload: body,
    },
  });
  return { ok: true, accepted: true, duplicate: !created, eventId: row.id };
}
async function logGreen(instanceKey, body) {
  const slim = {
    typeWebhook: body.typeWebhook,
    idMessage: body.idMessage,
    timestamp: body.timestamp,
    idInstance: instanceKey,
    chatId:
      body.chatId ||
      body.senderData?.chatId ||
      body.destinationData?.chatId ||
      null,
    sender: body.senderData?.sender || null,
    chatName:
      body.senderData?.chatName || body.destinationData?.chatName || null,
    typeMessage: body.messageData?.typeMessage || null,
    status: body.status || null,
    statusReason: body.reason || body.error || body.errorDescription || null,
  };
  try {
    await WaMessageLog.findOrCreate({
      where: { id_instance: instanceKey, id_message: body.idMessage },
      defaults: {
        chat_id: slim.chatId,
        sender: slim.sender,
        type_webhook: slim.typeWebhook,
        type_message: slim.typeMessage,
        body: slim,
      },
    });
  } catch (error) {
    console.error("[WA log]", error.message);
  }
}
router.post("/greenapi", async (req, res) => {
  try {
    const secret = process.env.WEBHOOK_SECRET;
    if (secret && !matchesSecret(req.query.secret, secret))
      return res.status(401).json({ ok: false });
    if (commandConfig().provider !== "greenapi")
      return res.json({ ok: true, ignored: "inactive_provider" });
    const body = req.body || {};
    const instanceKey = String(body.instanceData?.idInstance || "");
    if (!/^\d+$/.test(instanceKey) || !body.idMessage)
      return res.json({ ok: true, ignored: "not_message" });
    if (body.typeWebhook !== "incomingMessageReceived") {
      // Persist status events independently of incoming message deduplication.
      const key = `greenapi:${instanceKey}:${body.idMessage}:${body.typeWebhook}:${body.status || ""}`;
      await WaCommandEvent.findOrCreate({
        where: { event_key: key },
        defaults: {
          direction: "status",
          provider: "greenapi",
          instance_key: instanceKey,
          chat_id:
            body.chatId ||
            body.senderData?.chatId ||
            body.destinationData?.chatId ||
            "",
          status: "done",
          payload: body,
        },
      });
      await logGreen(instanceKey, body);
      return res.json({ ok: true });
    }
    if (!body.senderData?.chatId || !body.senderData?.sender)
      return res.status(400).json({ ok: false, error: "missing sender" });
    const instance = await WaInstance.findOne({
      where: { id_instance: instanceKey, is_active: true },
    });
    if (!instance?.api_token || !instance.meta?.roles?.includes("BOT"))
      return res.json({ ok: true, ignored: "inactive_instance" });
    const result = await saveIncoming("greenapi", instanceKey, body);
    // Retain existing admin message history, but command dedup lives in wa_command_events.
    await logGreen(instanceKey, body);
    return res.json(result);
  } catch (error) {
    console.error("[command webhook]", error.message);
    return res
      .status(503)
      .json({ ok: false, error: "Unable to persist incoming message" });
  }
});
router.post("/gateway", async (req, res) => {
  try {
    const c = commandConfig();
    if (
      !matchesSecret(
        req.headers["x-command-secret"],
        process.env.WA_COMMAND_GATEWAY_WEBHOOK_SECRET,
      )
    )
      return res.status(401).json({ ok: false });
    if (c.provider !== "baileys")
      return res.json({ ok: true, ignored: "inactive_provider" });
    const { session_id, tenant, webhook: body } = req.body || {};
    if (session_id !== c.sessionId || tenant !== c.tenant)
      return res
        .status(403)
        .json({ ok: false, error: "wrong command session/tenant" });
    if (!body?.idMessage)
      return res.status(400).json({ ok: false, error: "missing message ID" });
    if (body.typeWebhook !== "incomingMessageReceived") {
      await WaCommandEvent.findOrCreate({
        where: {
          event_key: `baileys:${session_id}:${body.idMessage}:${body.status}`,
        },
        defaults: {
          direction: "status",
          provider: "baileys",
          instance_key: session_id,
          chat_id: body.chatId || "",
          status: "done",
          payload: body,
        },
      });
      return res.json({ ok: true });
    }
    if (!body.senderData?.chatId || !body.senderData?.sender)
      return res.status(400).json({ ok: false, error: "missing sender" });
    return res.json(await saveIncoming("baileys", session_id, body));
  } catch (error) {
    console.error("[gateway webhook]", error.message);
    return res
      .status(503)
      .json({ ok: false, error: "Unable to persist incoming message" });
  }
});
router.post('/gateway/ai', async (req, res) => {
  try {
    const c = aiConfig();
    if (!matchesSecret(req.headers['x-command-secret'], c.secret)) return res.status(401).json({ ok: false });
    const { session_id, tenant, webhook: body } = req.body || {};
    if (!c.sessionId || session_id !== c.sessionId || tenant !== c.tenant) return res.status(403).json({ ok: false });
    if (!body?.idMessage) return res.status(400).json({ ok: false });
    if (body.typeWebhook !== 'incomingMessageReceived') return res.json({ ok: true, ignored: 'status' });
    if (!body.senderData?.chatId || !body.senderData?.sender) return res.status(400).json({ ok: false });
    const result = await saveIncoming('ai', session_id, body);
    console.info('[WA_AI webhook]', result.eventId, result.duplicate ? 'duplicate' : 'accepted');
    return res.json(result);
  } catch (error) {
    console.error('[AI webhook]', error.message);
    return res.status(503).json({ ok: false });
  }
});
export default router;
