// routes/tempLinks.js
import express from "express";
import { getTempLink } from "../services/tempLink/tempLinkService.js";

const router = express.Router();

router.get("/temp-links/:token", (req, res) => {
    const token = req.params.token;
    const meta = getTempLink(token);

    if (!meta) {
        return res
            .status(410)
            .send("Link sudah expired. Silakan minta link cabang lagi di WhatsApp.");
    }

    // redirect ke halaman HTML API
    return res.redirect(302, meta.targetUrl);
});

export default router;