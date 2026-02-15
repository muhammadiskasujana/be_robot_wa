import express from "express";
import { WaInstance, WaMessageLog } from "../models/index.js";
import { handleIncoming } from "../services/robot.js";

import { fetchJson, TTL, CacheKeys } from "../services/cacheService.js";
import { Op } from "sequelize";
import Sequelize from "sequelize";

async function getWaInstanceCached(idInstance) {
    return fetchJson(
        CacheKeys.waInstance(idInstance),
        async () => {
            const instance = await WaInstance.findOne({
                where: {
                    id_instance: idInstance,
                    is_active: true,
                    [Op.and]: [Sequelize.literal(`(meta->'roles') @> '["BOT"]'::jsonb`)],
                },
                attributes: ["id_instance", "api_token", "meta"],
            });
            return instance ? instance.toJSON() : null;
        },
        TTL.INSTANCE
    );
}

const router = express.Router();

function verifySecret(req) {
    const need = process.env.WEBHOOK_SECRET;
    if (!need) return true;
    return req.query.secret === need;
}

function pickChatId(body) {
    return (
        body?.senderData?.chatId ||
        body?.destinationData?.chatId ||
        body?.destinationData?.chatId || // keep
        body?.destinationData?.to ||      // kadang di sini
        body?.destinationData?.recipientId ||
        body?.chatId ||
        body?.messageData?.chatId ||
        null
    );
}

function pickSender(body) {
    return body?.senderData?.sender || body?.senderData?.from || null;
}

function buildSlimWebhook(body) {
    const typeWebhook = body?.typeWebhook || null;

    const status =
        body?.status ||
        body?.messageData?.statusMessage ||
        body?.messageData?.status ||
        body?.state ||
        null;

    const statusReason =
        body?.reason ||
        body?.statusReason ||
        body?.error ||
        body?.errorDescription ||
        body?.message ||
        body?.description ||
        body?.messageData?.error ||
        body?.messageData?.errorMessage ||
        body?.messageData?.statusReason ||
        body?.messageData?.reason ||
        body?.messageData?.message ||
        body?.messageData?.description ||
        body?.notificationData?.error ||
        body?.notificationData?.description ||
        null;

    return {
        typeWebhook,
        idMessage: body?.idMessage || null,
        timestamp: body?.timestamp || null,
        idInstance: body?.instanceData?.idInstance || null,

        chatId: pickChatId(body),
        // outgoing biasanya ga punya sender, jadi aman null
        sender: body?.senderData?.sender || null,
        chatName: body?.senderData?.chatName || body?.destinationData?.chatName || null,

        typeMessage: body?.messageData?.typeMessage || null,

        status,
        statusReason,

        // simpan potongan destinationData untuk debug
        destination: body?.destinationData
            ? {
                chatId: body.destinationData.chatId || null,
                to: body.destinationData.to || null,
                recipientId: body.destinationData.recipientId || null,
            }
            : null,
    };
}

router.post("/greenapi", async (req, res) => {
    try {
        if (!verifySecret(req)) return res.status(401).json({ ok: false, error: "invalid secret" });

        const body = req.body || {};
        const type = body?.typeWebhook;

        const idInstance = Number(body?.instanceData?.idInstance);
        const idMessage = body?.idMessage;

        // ✅ ACK cepat untuk SEMUA webhook supaya GreenAPI tidak retry
        res.json({ ok: true, accepted: true });

        // ==== proses background ====
        (async () => {
            if (!idInstance || !idMessage) return;

            const slimBody = buildSlimWebhook(body);

            // Simpan semua webhook (incoming + outgoing) agar bisa trace delivery
            try {
                await WaMessageLog.create({
                    id_instance: idInstance,
                    id_message: idMessage,
                    chat_id: slimBody.chatId,
                    sender: slimBody.sender,
                    type_webhook: slimBody.typeWebhook,
                    type_message: slimBody.typeMessage,
                    body: slimBody,
                });
            } catch (e) {
                // duplicate -> skip
            }

            // ====== INCOMING saja yang diproses bot ======
            if (type === "incomingMessageReceived") {
                const instance = await getWaInstanceCached(idInstance);
                if (!instance?.id_instance || !instance?.api_token) return;

                await handleIncoming({
                    instance: { id_instance: instance.id_instance, api_token: instance.api_token },
                    webhook: body,
                });
                return;
            }

            // ====== OUTGOING status: log untuk debug ======
            if (type === "outgoingMessageStatus" || type === "outgoingAPIMessageReceived") {
                console.log("[GREENAPI OUTGOING]", {
                    idInstance,
                    idMessage,
                    chatId: slimBody.chatId,
                    status: slimBody.status,
                    reason: slimBody.statusReason,
                    destination: slimBody.destination,
                    keys: Object.keys(body || {}),
                    messageDataKeys: Object.keys(body?.messageData || {}),
                });
            }
        })().catch((err) => console.error("BG webhook error:", err?.message || err));
    } catch (err) {
        console.error("Webhook error:", err?.message || err);
        // tetap 200 agar ga retry spam
        return res.status(200).json({ ok: false, error: "handled" });
    }
});

export default router;
