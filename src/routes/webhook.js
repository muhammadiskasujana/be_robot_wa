import express from "express";
import { WaInstance, WaMessageLog } from "../models/index.js";
import { handleIncoming } from "../services/robot.js";

const router = express.Router();

function verifySecret(req) {
    const need = process.env.WEBHOOK_SECRET;
    if (!need) return true;
    return req.query.secret === need;
}


function buildSlimWebhook(body) {
    const typeMessage = body?.messageData?.typeMessage;

    const text =
        body?.messageData?.textMessageData?.textMessage ||
        body?.messageData?.extendedTextMessageData?.text ||
        body?.messageData?.quotedMessage?.textMessage ||
        null;

    // kalau gambar/dokumen, simpan info file minimal (bukan base64 / payload besar)
    const file =
        body?.messageData?.fileMessageData
            ? {
                fileName: body?.messageData?.fileMessageData?.fileName || null,
                mimeType: body?.messageData?.fileMessageData?.mimeType || null,
                caption: body?.messageData?.fileMessageData?.caption || null,
            }
            : null;

    return {
        // meta utama
        typeWebhook: body?.typeWebhook || null,
        idMessage: body?.idMessage || null,
        timestamp: body?.timestamp || null,

        // instance
        idInstance: body?.instanceData?.idInstance || null,

        // sender
        chatId: body?.senderData?.chatId || null,
        sender: body?.senderData?.sender || null,
        chatName: body?.senderData?.chatName || null,

        // message
        typeMessage: typeMessage || null,
        text,
        file,
    };
}

router.post("/greenapi", async (req, res) => {
    try {
        if (!verifySecret(req)) return res.status(401).json({ ok: false, error: "invalid secret" });

        const body = req.body;

        if (body?.typeWebhook !== "incomingMessageReceived") {
            return res.json({ ok: true, ignored: true });
        }

        const idInstance = Number(body?.instanceData?.idInstance);
        const idMessage = body?.idMessage;
        if (!idInstance || !idMessage) return res.json({ ok: true, ignored: true, reason: "missing fields" });

        // ✅ ACK CEPAT (paling penting)
        res.json({ ok: true, accepted: true });

        // ==== proses di belakang (tidak block webhook) ====
        (async () => {
            // ambil instance token
            const instance = await WaInstance.findOne({ where: { id_instance: idInstance, is_active: true } });
            if (!instance) return;

            const slimBody = buildSlimWebhook(body);

            try {
                await WaMessageLog.create({
                    id_instance: idInstance,
                    id_message: idMessage,
                    chat_id: slimBody.chatId,
                    sender: slimBody.sender,
                    type_webhook: slimBody.typeWebhook,
                    type_message: slimBody.typeMessage,
                    body: slimBody, // ✅ slim saja
                });
            } catch (e) {
                return; // duplicate => stop
            }

            await handleIncoming({ instance, webhook: body });
        })().catch((err) => console.error("BG webhook error:", err?.message || err));
    } catch (err) {
        console.error("Webhook error:", err?.message || err);
        // tetap 200 agar ga retry spam
        return res.status(200).json({ ok: false, error: "handled" });
    }
});

export default router;
