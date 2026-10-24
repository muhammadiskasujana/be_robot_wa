import { Router } from "express";
import crypto from "crypto";
import { Op } from "sequelize";
import { WaInternalReport } from "../models/index.js";

const router = Router();
router.post("/lookup", async (req, res, next) => {
    try {
        const expected = process.env.INTERNAL_REPORT_API_KEY;
        const supplied = req.get("x-internal-report-key") || "";
        if (!expected || supplied.length !== expected.length ||
            !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        const keys = req.body?.keys;
        if (!Array.isArray(keys) || keys.length > 1000 || keys.some(k => !k || typeof k.nopol !== "string" || typeof k.leasing !== "string" || typeof k.access_at !== "string" || typeof k.access_user !== "string" || typeof k.access_phone !== "string")) {
            return res.status(400).json({ error: "Invalid keys" });
        }
        if (!keys.length) return res.json({ rows: [] });
        const rows = await WaInternalReport.findAll({
            where: { [Op.or]: keys.map(k => ({ nopol: k.nopol, leasing: k.leasing, access_at: k.access_at, access_user: k.access_user, access_phone: k.access_phone })) },
            attributes: ["nopol", "leasing", "access_at", "access_user", "access_phone", "report_internal", "internal_phone"],
            raw: true,
        });
        res.json({ rows });
    } catch (error) { next(error); }
});
export default router;
