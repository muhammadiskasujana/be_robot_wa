import express from "express";
import { WaInstance, WaMessageLog } from "../models/index.js";
import { handleIncoming } from "../services/robot.js";

const router = express.Router();

function verifySecret(req) {
    const need = process.env.WEBHOOK_SECRET;
    if (!need) return true;
    return req.query.secret === need;
}

router.post("/greenapi", async (req, res) => {
    try {
        if (!verifySecret(req)) return res.status(401).json({ ok: false, error: "invalid secret" });

        const body = req.body;

        // hanya proses pesan masuk
        if (body?.typeWebhook !== "incomingMessageReceived") {
            return res.json({ ok: true, ignored: true });
        }

        const idInstance = Number(body?.instanceData?.idInstance);
        const idMessage = body?.idMessage;

        if (!idInstance || !idMessage) return res.json({ ok: true, ignored: true, reason: "missing fields" });

        // ambil instance token
        const instance = await WaInstance.findOne({ where: { id_instance: idInstance, is_active: true } });
        if (!instance) return res.json({ ok: true, ignored: true, reason: "unknown instance", idInstance });

        // dedup (unique index)
        try {
            await WaMessageLog.create({
                id_instance: idInstance,
                id_message: idMessage,
                chat_id: body?.senderData?.chatId,
                sender: body?.senderData?.sender,
                type_webhook: body?.typeWebhook,
                type_message: body?.messageData?.typeMessage,
                body,
            });
        } catch (e) {
            // duplicate unique => sudah diproses
            return res.json({ ok: true, dedup: true });
        }

        await handleIncoming({ instance, webhook: body });

        return res.json({ ok: true });
    } catch (err) {
        console.error("Webhook error:", err?.message || err);
        // 200 biar tidak retry spam
        return res.status(200).json({ ok: false, error: "handled" });
    }
});

export default router;
