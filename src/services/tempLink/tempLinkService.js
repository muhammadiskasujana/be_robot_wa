// services/tempLinkService.js
import crypto from "crypto";

const TTL_MS = 5 * 60 * 1000;
const memIndex = new Map(); // token -> { targetUrl, expiresAt }

async function cleanupToken(token) {
    memIndex.delete(token);
}

setInterval(() => {
    const now = Date.now();
    for (const [token, meta] of memIndex.entries()) {
        if (meta.expiresAt <= now) cleanupToken(token);
    }
}, 30_000).unref();

export function createTempLink(targetUrl, ttlMs = TTL_MS) {
    const token = crypto.randomBytes(18).toString("hex");
    const expiresAt = Date.now() + Number(ttlMs || TTL_MS);
    memIndex.set(token, { targetUrl: String(targetUrl), expiresAt });
    setTimeout(() => cleanupToken(token), ttlMs).unref();
    return { token, expiresAt };
}

export function getTempLink(token) {
    const meta = memIndex.get(String(token || ""));
    if (!meta) return null;
    if (meta.expiresAt <= Date.now()) {
        cleanupToken(token);
        return null;
    }
    return meta;
}