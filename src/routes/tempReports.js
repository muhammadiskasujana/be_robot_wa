import express from "express";
import fs from "fs";
import { getTempMeta } from "../services/tempReportStore.js";

const router = express.Router();

// GET /dl/report/:token
router.get("/dl/report/:token", (req, res) => {
    const token = String(req.params.token || "").trim();
    if (!token) return res.status(400).send("Bad token");

    const meta = getTempMeta(token);
    if (!meta) return res.status(404).send("Link expired / not found");

    res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${meta.filename}"`);

    const stream = fs.createReadStream(meta.filePath);
    stream.on("error", () => res.status(500).send("Failed to read file"));
    stream.pipe(res);
});

export default router;
