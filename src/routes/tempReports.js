import express from "express";
import fs from "fs";
import { getTempFileMeta } from "../services/tempReportStore.js";

const router = express.Router();

router.get("/dl/:token", (req, res) => {
    const meta = getTempFileMeta(req.params.token);
    if (!meta) return res.status(404).send("Token expired / not found");

    const ct = meta.contentType || "application/octet-stream";
    res.setHeader("Content-Type", ct);

    const isInline = ct.startsWith("image/") || ct === "application/pdf";
    res.setHeader(
        "Content-Disposition",
        `${isInline ? "inline" : "attachment"}; filename="${meta.filename}"`
    );

    const stream = fs.createReadStream(meta.filePath);
    stream.on("error", () => res.status(500).send("Read error"));
    stream.pipe(res);
});

export default router;
