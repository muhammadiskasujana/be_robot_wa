// Public API retained for robot.js. Each pending conversation now has its own Redis TTL.
import { redis } from '../../queues/redis.js';
const TTL_MS_DEFAULT = 5 * 60 * 1000;
export function makePendingKey({ chatId, sender }) {
    return `${String(chatId || '').trim()}:${String(sender || '').trim()}`;
}
export function makeQuotedKey({ chatId, sender, quotedMsgId }) {
    return `${makePendingKey({ chatId, sender })}:${String(quotedMsgId || '').trim()}`;
}
export function createPendingStore(filename, ttlMs = TTL_MS_DEFAULT) {
    const prefix = `wa:command:pending:${filename}:`;
    return {
        async get(key) {
            const value = await redis.get(prefix + key);
            return value ? JSON.parse(value) : null;
        },
        async set(key, value, customTtlMs) {
            const ttl = Number(customTtlMs || ttlMs);
            const now = Date.now();
            await redis.set(prefix + key, JSON.stringify({ ...value, createdAt: now, expiresAt: now + ttl }), 'PX', ttl);
            return true;
        },
        async del(key) { return Boolean(await redis.del(prefix + key)); },
        async purge() { return 0; },
    };
}
export function startPendingCleaner() { return null; }
