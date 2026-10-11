import { WaMessageLog, WaCommandEvent } from "../../models/index.js";
import { commandConfig } from "../../services/waCommandConfig.js";

export async function listMessages(req, res) {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Number(req.query.offset || 0);

    if (commandConfig().provider === "baileys") {
        // Exclude document bytes from admin responses.
        const events = await WaCommandEvent.findAll({ where: { provider: "baileys" }, limit, offset, order: [["id", "DESC"]] });
        const data = events.map(row => ({
            id: row.id, id_instance: null, provider: row.provider, session_id: row.instance_key,
            id_message: row.result?.idMessage || row.payload?.idMessage || null,
            chat_id: row.chat_id, sender: row.payload?.senderData?.sender || null,
            type_webhook: row.payload?.typeWebhook || "outgoingCommandMessage", type_message: row.payload?.kind || row.payload?.messageData?.typeMessage,
            created_at: row.createdAt, updated_at: row.updatedAt,
            body: { status: row.status, deliveryStatus: row.payload?.status, error: row.error },
        }));
        return res.json({ ok: true, data, limit, offset });
    }
    const rows = await WaMessageLog.findAll({
        limit,
        offset,
        order: [["created_at", "DESC"]],
    });

    res.json({ ok: true, data: rows, limit, offset });
}
