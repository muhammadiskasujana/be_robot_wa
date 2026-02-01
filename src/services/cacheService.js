// services/cacheService.js
import { LRUCache } from "lru-cache";

export const cache = new LRUCache({
    max: 1000,
    ttl: 10 * 60 * 1000,
});

export const TTL = {
    AUTH_SHORT: 2 * 60 * 1000,      // master/whitelist
    INSTANCE: 5 * 60 * 1000,        // WaInstance token
    GROUP_MODE: 60 * 60 * 1000,     // mode key jarang berubah
    JSON: 10 * 60 * 1000,
};

export const CacheKeys = {
    masterPhone: (phone) => `master:${phone}`,
    whitelistPhone: (phone) => `wl:${phone}`,
    modeKey: (modeId) => `mode:${modeId}`,
    waInstance: (idInstance) => `instance:${idInstance}`,
};

// ===== anti-stampede (dedupe concurrent miss) =====
const inflight = new Map();

async function fetchWithDedupe(key, ttl, fetchMethod) {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;

    if (inflight.has(key)) return inflight.get(key);

    const p = (async () => {
        const val = await fetchMethod();
        cache.set(key, val, { ttl });
        return val;
    })().finally(() => inflight.delete(key));

    inflight.set(key, p);
    return p;
}

export async function fetchBool(key, fetchMethod, ttl = TTL.AUTH_SHORT) {
    const v = await fetchWithDedupe(key, ttl, fetchMethod);
    return !!v;
}

export async function fetchString(key, fetchMethod, ttl = TTL.GROUP_MODE) {
    const v = await fetchWithDedupe(key, ttl, fetchMethod);
    return v == null ? "" : String(v);
}

export async function fetchJson(key, fetchMethod, ttl = TTL.JSON) {
    return fetchWithDedupe(key, ttl, fetchMethod);
}

// ===== invalidation =====
export function invalidateKey(key) {
    cache.delete(key);
}

export function invalidateByPrefix(prefix) {
    for (const k of cache.keys()) {
        if (String(k).startsWith(prefix)) cache.delete(k);
    }
}

export const CacheInvalidate = {
    masterPhone: (phone) => invalidateKey(CacheKeys.masterPhone(phone)),
    whitelistPhone: (phone) => invalidateKey(CacheKeys.whitelistPhone(phone)),
    modeKey: (modeId) => invalidateKey(CacheKeys.modeKey(modeId)),
    waInstance: (idInstance) => invalidateKey(CacheKeys.waInstance(idInstance)),
    allModes: () => invalidateByPrefix("mode:"),
    allInstances: () => invalidateByPrefix("instance:"),
};
