import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const TEMP_DIR = process.env.REPORT_TMP_DIR || "/tmp/wa_reports";
const TTL_MS = 5 * 60 * 1000; // 5 menit

// token -> { filePath, filename, expiresAt }
const memIndex = new Map();

// pastikan folder ada
async function ensureDir() {
    await fs.mkdir(TEMP_DIR, { recursive: true });
}

// hapus fisik + index
async function cleanupToken(token) {
    const meta = memIndex.get(token);
    memIndex.delete(token);
    if (!meta) return;
    try { await fs.unlink(meta.filePath); } catch {}
}

// optional: interval sapu-sapu (kalau process restart / timer miss)
setInterval(async () => {
    const now = Date.now();
    for (const [token, meta] of memIndex.entries()) {
        if (meta.expiresAt <= now) {
            await cleanupToken(token);
        }
    }
}, 30 * 1000).unref();

export async function saveTempXlsx(buffer, filename = "report.xlsx") {
    await ensureDir();

    const token = crypto.randomBytes(18).toString("hex"); // 36 chars
    const safeName = filename.replace(/[^\w.\-]+/g, "_");
    const filePath = path.join(TEMP_DIR, `${token}__${safeName}`);

    await fs.writeFile(filePath, buffer);

    const expiresAt = Date.now() + TTL_MS;
    memIndex.set(token, { filePath, filename: safeName, expiresAt });

    // delete tepat 5 menit (best effort)
    setTimeout(() => cleanupToken(token), TTL_MS).unref();

    return { token, filename: safeName, expiresAt };
}

export function getTempMeta(token) {
    const meta = memIndex.get(token);
    if (!meta) return null;
    if (meta.expiresAt <= Date.now()) {
        // expired, cleanup async
        cleanupToken(token);
        return null;
    }
    return meta;
}
