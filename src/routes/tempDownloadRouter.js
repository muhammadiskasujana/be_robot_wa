import express from "express";

export function createTempReportsRouter(getMeta) {
    const router = express.Router();
    router.get("/dl/:token", async (req, res) => {
        try {
            const meta = await getMeta(req.params.token);
            if (!meta) return res.status(404).send("Token expired / not found");
            const contentType = meta.contentType || "application/octet-stream";
            const inline = contentType.startsWith("image/") || contentType === "application/pdf";
            res.setHeader("Content-Type", contentType);
            res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${meta.filename}"`);
            res.setHeader("Cache-Control", "private, no-store");
            return res.send(meta.buffer);
        } catch (error) {
            console.error("[temp report download]", error.message);
            return res.status(503).send("Download sementara tidak tersedia. Silakan coba lagi.");
        }
    });
    return router;
}

export function createTempLinksRouter(getLink) {
    const router = express.Router();
    router.get("/temp-links/:token", async (req, res) => {
        try {
            const meta = await getLink(req.params.token);
            if (!meta) return res.status(410).send("Link sudah expired. Silakan minta link cabang lagi di WhatsApp.");
            res.setHeader("Cache-Control", "private, no-store");
            return res.redirect(302, meta.targetUrl);
        } catch (error) {
            console.error("[temp link redirect]", error.message);
            return res.status(503).send("Link sementara tidak tersedia. Silakan coba lagi.");
        }
    });
    return router;
}
