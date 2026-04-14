import { Op } from "sequelize";
import { WaDeleteHistory } from "../../models/index.js";
import { parsePagination, buildMeta } from "../../utils/pagination.js";

function verifyNotifyToken(req) {
    const expected = process.env.NOTIFY_API_TOKEN;
    if (!expected) return true; // fallback kalau env belum diset

    // support:
    // Authorization: Bearer xxx
    // Authorization: xxx
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ")
        ? auth.slice(7).trim()
        : auth.trim();

    return token === expected;
}
export async function list(req, res) {
    const { limit, page, offset } = parsePagination(req.query);
    const q = String(req.query.q || "").trim();
    const status = String(req.query.status || "").trim().toUpperCase();
    const leasingCode = String(req.query.leasing_code || "").trim().toUpperCase();
    const sender = String(req.query.sender || "").trim();
    const chatId = String(req.query.chat_id || "").trim();

    const where = {};

    if (q) {
        where[Op.or] = [
            { chat_id: { [Op.iLike]: `%${q}%` } },
            { nopol: { [Op.iLike]: `%${q}%` } },
            { sender: { [Op.iLike]: `%${q}%` } },
            { leasing_code: { [Op.iLike]: `%${q}%` } },
            { delete_reason: { [Op.iLike]: `%${q}%` } },
        ];
    }

    if (status) where.status = status;
    if (leasingCode) where.leasing_code = leasingCode;
    if (sender) where.sender = sender;
    if (chatId) where.chat_id = chatId;

    const { rows, count } = await WaDeleteHistory.findAndCountAll({
        where,
        limit,
        offset,
        order: [["requested_at", "DESC"]],
    });

    res.json({
        ok: true,
        data: rows,
        meta: buildMeta({ page, limit, total: count }),
    });
}

export async function getById(req, res) {
    const row = await WaDeleteHistory.findByPk(req.params.id);
    if (!row) {
        return res.status(404).json({ ok: false, error: "Not found" });
    }

    res.json({ ok: true, data: row });
}

/**
 * POST /wa-delete-histories
 * Body:
 * {
 *   "chat_id": "1203630xxxx@g.us",
 *   "nopol": "DA1234BC",
 *   "sender": "62812xxxxxxx",
 *   "leasing_code": "FIF",
 *   "delete_reason": "duplikat",
 *   "status": "DONE", // optional, default DONE
 *   "confirmed_at": "2026-04-10T10:00:00.000Z", // optional
 *   "meta": {
 *     "source_detail": "manual api",
 *     "requested_by": "admin panel"
 *   }
 * }
 */
export async function createFromApi(req, res) {
    if (!verifyNotifyToken(req)) {
        return res.status(401).json({
            ok: false,
            error: "invalid notify token",
        });
    }
    const chat_id = String(req.body.chat_id || "").trim();
    const nopol = String(req.body.nopol || "").trim().toUpperCase();
    const sender = String(req.body.sender || "").trim();
    const leasing_code = String(req.body.leasing_code || "").trim().toUpperCase();
    const delete_reason = String(req.body.delete_reason || "").trim().toLowerCase();
    const statusInput = String(req.body.status || "DONE").trim().toUpperCase();
    const confirmed_at = req.body.confirmed_at ? new Date(req.body.confirmed_at) : new Date();
    const metaInput =
        req.body.meta && typeof req.body.meta === "object" && !Array.isArray(req.body.meta)
            ? req.body.meta
            : {};

    if (!chat_id) {
        return res.status(400).json({ ok: false, error: "chat_id wajib" });
    }

    if (!nopol) {
        return res.status(400).json({ ok: false, error: "nopol wajib" });
    }

    if (!sender) {
        return res.status(400).json({ ok: false, error: "sender wajib" });
    }

    if (!leasing_code) {
        return res.status(400).json({ ok: false, error: "leasing_code wajib" });
    }

    if (!delete_reason) {
        return res.status(400).json({ ok: false, error: "delete_reason wajib" });
    }

    const allowedStatuses = ["PENDING", "DONE", "FAILED", "CANCELLED", "EXPIRED"];
    const status = allowedStatuses.includes(statusInput) ? statusInput : "DONE";

    const row = await WaDeleteHistory.create({
        chat_id,
        nopol,
        sender,
        leasing_code,
        delete_reason,
        status,
        requested_at: new Date(),
        confirmed_at: status === "PENDING" ? null : confirmed_at,
        meta: {
            source: "external_api",
            ...metaInput,
        },
    });

    res.status(201).json({
        ok: true,
        data: row,
    });
}

/**
 * PUT /wa-delete-histories/:id/status
 * Body:
 * {
 *   "status": "DONE",
 *   "delete_reason": "duplikat",
 *   "meta": {
 *     "updated_by": "admin"
 *   }
 * }
 */
export async function updateStatus(req, res) {
    const row = await WaDeleteHistory.findByPk(req.params.id);
    if (!row) {
        return res.status(404).json({ ok: false, error: "Not found" });
    }

    const statusInput = String(req.body.status || "").trim().toUpperCase();
    const deleteReason =
        req.body.delete_reason !== undefined
            ? String(req.body.delete_reason || "").trim().toLowerCase()
            : undefined;

    const metaInput =
        req.body.meta && typeof req.body.meta === "object" && !Array.isArray(req.body.meta)
            ? req.body.meta
            : {};

    const allowedStatuses = ["PENDING", "DONE", "FAILED", "CANCELLED", "EXPIRED"];
    if (!allowedStatuses.includes(statusInput)) {
        return res.status(400).json({ ok: false, error: "status invalid" });
    }

    row.status = statusInput;

    if (deleteReason !== undefined) {
        row.delete_reason = deleteReason;
    }

    row.confirmed_at = statusInput === "PENDING" ? null : new Date();
    row.meta = {
        ...(row.meta || {}),
        ...metaInput,
    };

    await row.save();

    res.json({ ok: true, data: row });
}