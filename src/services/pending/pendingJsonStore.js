import fs from "fs/promises";
import path from "path";

const BASE_DIR = process.env.WA_PENDING_DIR || path.resolve(process.cwd(), "data_pending");
const TTL_MS_DEFAULT = 5 * 60 * 1000; // 5 menit

async function ensureDir() {
    await fs.mkdir(BASE_DIR, { recursive: true });
}

async function readJson(filePath) {
    try {
        const txt = await fs.readFile(filePath, "utf8");
        const obj = JSON.parse(txt);
        if (!obj || typeof obj !== "object") return { version: 1, items: {} };
        if (!obj.items) obj.items = {};
        if (!obj.version) obj.version = 1;
        return obj;
    } catch (e) {
        // file belum ada / rusak -> reset
        return { version: 1, items: {} };
    }
}

async function writeJsonAtomic(filePath, obj) {
    const tmp = filePath + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(obj, null, 2), "utf8");
    await fs.rename(tmp, filePath);
}

function now() {
    return Date.now();
}

function purgeExpired(obj) {
    const t = now();
    const items = obj.items || {};
    let changed = false;

    for (const [k, v] of Object.entries(items)) {
        const exp = Number(v?.expiresAt || 0);
        if (!exp || exp <= t) {
            delete items[k];
            changed = true;
        }
    }
    if (changed) obj.items = items;
    return changed;
}

export function makePendingKey({ chatId, sender }) {
    return `${String(chatId || "").trim()}:${String(sender || "").trim()}`;
}

export function makeQuotedKey({ chatId, sender, quotedMsgId }) {
    // kunci lebih aman: per quote-message
    return `${String(chatId || "").trim()}:${String(sender || "").trim()}:${String(quotedMsgId || "").trim()}`;
}

/**
 * Create store instance per file.
 * Example:
 *   const pendingRegStore = createPendingStore("pending_register.json")
 *   const pendingDelStore = createPendingStore("pending_delete.json")
 */
export function createPendingStore(filename, ttlMs = TTL_MS_DEFAULT) {
    const filePath = path.join(BASE_DIR, filename);

    async function _load() {
        await ensureDir();
        const obj = await readJson(filePath);
        const changed = purgeExpired(obj);
        if (changed) await writeJsonAtomic(filePath, obj);
        return obj;
    }

    async function _save(obj) {
        await ensureDir();
        purgeExpired(obj);
        await writeJsonAtomic(filePath, obj);
    }

    return {
        filePath,

        async get(key) {
            const obj = await _load();
            return obj.items[key] || null;
        },

        async set(key, value, customTtlMs) {
            const obj = await _load();
            obj.items[key] = {
                ...value,
                createdAt: now(),
                expiresAt: now() + Number(customTtlMs || ttlMs),
            };
            await _save(obj);
            return true;
        },

        async del(key) {
            const obj = await _load();
            if (obj.items[key]) {
                delete obj.items[key];
                await _save(obj);
                return true;
            }
            return false;
        },

        async purge() {
            const obj = await _load();
            // purge dilakukan di _load
            return Object.keys(obj.items).length;
        },
    };
}

/**
 * Optional: jalankan cleaner interval (kalau mau).
 * Aman walau tanpa interval karena get/set juga auto purge.
 */
export function startPendingCleaner(stores, intervalMs = 60 * 1000) {
    const t = setInterval(async () => {
        try {
            for (const s of stores) await s.purge();
        } catch {}
    }, intervalMs);
    t.unref?.();
    return t;
}