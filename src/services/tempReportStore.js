import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const TEMP_DIR = process.env.TEMP_FILES_DIR || "/tmp/wa_files";
const TTL_MS = 5 * 60 * 1000;

const memIndex = new Map(); // token -> { filePath, filename, contentType, expiresAt }

async function ensureDir() {
    await fs.mkdir(TEMP_DIR, { recursive: true });
}

async function cleanupToken(token) {
    const meta = memIndex.get(token);
    memIndex.delete(token);
    if (!meta) return;
    try { await fs.unlink(meta.filePath); } catch {}
}

setInterval(async () => {
    const now = Date.now();
    for (const [token, meta] of memIndex.entries()) {
        if (meta.expiresAt <= now) await cleanupToken(token);
    }
}, 30_000).unref();

function safeName(name = "file.bin") {
    return String(name).replace(/[^\w.\-]+/g, "_");
}

export async function saveTempFile(buffer, filename, contentType = "application/octet-stream") {
    await ensureDir();

    const token = crypto.randomBytes(18).toString("hex");
    const fn = safeName(filename || "file.bin");
    const filePath = path.join(TEMP_DIR, `${token}__${fn}`);

    await fs.writeFile(filePath, buffer);

    const expiresAt = Date.now() + TTL_MS;
    memIndex.set(token, { filePath, filename: fn, contentType, expiresAt });

    setTimeout(() => cleanupToken(token), TTL_MS).unref();

    return { token, filename: fn, expiresAt, contentType };
}

export function getTempFileMeta(token) {
    const meta = memIndex.get(token);
    if (!meta) return null;
    if (meta.expiresAt <= Date.now()) {
        cleanupToken(token);
        return null;
    }
    return meta;
}
