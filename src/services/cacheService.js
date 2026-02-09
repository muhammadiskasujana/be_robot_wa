// services/cacheService.js
import { LRUCache } from "lru-cache";

export const cache = new LRUCache({
    max: 1000,
    ttl: 10 * 60 * 1000,
});

export const TTL = {
    AUTH_SHORT: 2 * 60 * 1000,
    INSTANCE: 5 * 60 * 1000,
    GROUP_MODE: 60 * 60 * 1000,
    JSON: 10 * 60 * 1000,
    GROUP_SHORT: 10 * 1000,
    LEASING_CODE: 60 * 60 * 1000,

    // ✅ optional
    NEGATIVE_SHORT: 10 * 1000, // cache "not found" 10 detik (opsional)
};

export const CacheKeys = {
    masterPhone: (phone) => `master:${phone}`,
    whitelistPhone: (phone) => `wl:${phone}`,
    modeKey: (modeId) => `mode:${modeId}`,
    waInstance: (idInstance) => `instance:${idInstance}`,
    cmdId: (key) => `cmd:id:${key}`,
    policyGroup: (groupId, cmdId) => `policy:g:${groupId}:c:${cmdId}`,
    policyLeasing: (leasingId, cmdId) => `policy:l:${leasingId}:c:${cmdId}`,
    group: (chatId) => `group:${chatId}`,
    leasingCode: (leasingId) => `leasing:code:${leasingId}`,
    policyPersonal: (phone, commandId) => `policy:personal:${phone}:cmd:${commandId}`,
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

/**
 * ✅ Advanced: cache conditional (mis. hanya cache ok:true),
 * bisa negative cache (mis. ok:false / NOT_FOUND) dengan TTL berbeda,
 * dan bisa skip cache sama sekali.
 */
export async function fetchJsonAdvanced(
    key,
    fetchMethod,
    {
        ttl = TTL.JSON,
        shouldCache = (val) => val !== undefined, // default sama seperti lama
        getTTL = () => ttl,                       // bisa beda TTL tergantung val
    } = {}
) {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;

    if (inflight.has(key)) return inflight.get(key);

    const p = (async () => {
        const val = await fetchMethod();

        // tentukan apakah boleh cache
        if (shouldCache(val)) {
            const ttl2 = getTTL(val);
            if (ttl2 && ttl2 > 0) {
                cache.set(key, val, { ttl: ttl2 });
            }
        }
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

// existing
export async function fetchJson(key, fetchMethod, ttl = TTL.JSON) {
    return fetchWithDedupe(key, ttl, fetchMethod);
}

export async function fetchJSON(key, getter, ttlSec) {
    const raw = await fetchString(key, async () => JSON.stringify(await getter()), ttlSec);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
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

    cmdId: (key) => invalidateKey(CacheKeys.cmdId(key)),
    policyGroup: (groupId, cmdId) => invalidateKey(CacheKeys.policyGroup(groupId, cmdId)),
    policyLeasing: (leasingId, cmdId) => invalidateKey(CacheKeys.policyLeasing(leasingId, cmdId)),

    group: (chatId) => invalidateKey(CacheKeys.group(chatId)),
    leasingCode: (leasingId) => invalidateKey(CacheKeys.leasingCode(leasingId)),
    policyPersonal: (phone, commandId) => cache.delete(CacheKeys.policyPersonal(phone, commandId)),
};
