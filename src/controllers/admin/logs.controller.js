import { WaMessageLog } from "../../models/index.js";

export async function listMessages(req, res) {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Number(req.query.offset || 0);

    const rows = await WaMessageLog.findAll({
        limit,
        offset,
        order: [["created_at", "DESC"]],
    });

    res.json({ ok: true, data: rows, limit, offset });
}
