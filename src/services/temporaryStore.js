import crypto from "node:crypto";

const TTL_MS = 5 * 60 * 1000;
const PREFIX = "wa:temporary:v1";
const safeName = name => String(name || "file.bin").replace(/[^\w.\-]+/g, "_");

function encode(meta, data = Buffer.alloc(0)) {
    const header = Buffer.from(JSON.stringify(meta), "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(header.length);
    return Buffer.concat([length, header, data]);
}
function decode(value) {
    if (!Buffer.isBuffer(value) || value.length < 4) return null;
    const length = value.readUInt32BE(0);
    if (length < 2 || length > value.length - 4) return null;
    try {
        return { meta: JSON.parse(value.subarray(4, 4 + length).toString("utf8")), data: value.subarray(4 + length) };
    } catch { return null; }
}

// Metadata and bytes share one expiring Redis key, accessible from server and worker.
export function createTemporaryStore(redis, { now = Date.now, timeoutMs = 10000 } = {}) {
    async function request(operation) {
        let timer;
        try {
            return await Promise.race([
                Promise.resolve().then(operation),
                new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Temporary storage timeout")), timeoutMs); }),
            ]);
        } finally { clearTimeout(timer); }
    }
    async function put(kind, meta, data, ttlMs = TTL_MS) {
        const ttl = Math.ceil(Number(ttlMs));
        if (!Number.isFinite(ttl) || ttl <= 0) throw new Error("Invalid temporary item TTL");
        const token = crypto.randomBytes(18).toString("hex");
        const expiresAt = now() + ttl;
        await request(() => redis.set(`${PREFIX}:${kind}:${token}`, encode({ ...meta, expiresAt }, data), "PX", ttl));
        return { token, ...meta, expiresAt };
    }
    async function get(kind, token) {
        if (!/^[a-f0-9]{36}$/.test(String(token || ""))) return null;
        const result = decode(await request(() => redis.getBuffer(`${PREFIX}:${kind}:${token}`)));
        if (!result || !Number.isFinite(result.meta.expiresAt) || result.meta.expiresAt <= now()) return null;
        return result;
    }
    return {
        async saveTempFile(buffer, filename, contentType = "application/octet-stream") {
            const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
            return put("file", { filename: safeName(filename), contentType }, data);
        },
        async getTempFileMeta(token) {
            const item = await get("file", token);
            return item ? { ...item.meta, buffer: item.data } : null;
        },
        async createTempLink(targetUrl, ttlMs = TTL_MS) {
            return put("link", { targetUrl: String(targetUrl) }, undefined, ttlMs);
        },
        async getTempLink(token) {
            return (await get("link", token))?.meta || null;
        },
    };
}
