import { fetchJson, fetchString, TTL, CacheKeys } from "./cacheService.js";

// ===== util timeout fetch =====
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const r = await fetch(url, { ...options, signal: controller.signal });
        return r;
    } finally {
        clearTimeout(t);
    }
}

// ===== normalisasi sender jid ke beberapa kandidat =====
function senderCandidates(senderJid = "") {
    const s = String(senderJid || "").trim();
    if (!s) return [];

    // buang device suffix: "628xxx:12@s.whatsapp.net" -> "628xxx@s.whatsapp.net"
    const [left, server = ""] = s.split("@");
    const noDevice = left.split(":")[0];
    const digits = noDevice.replace(/\D/g, "");

    const out = new Set();
    out.add(s);

    // normalisasi server umum
    if (server) out.add(`${noDevice}@${server}`);

    // GreenAPI participant id biasanya "@c.us" atau "lid"
    if (digits) {
        let phone = digits;
        if (phone.startsWith("0")) phone = "62" + phone.slice(1);
        if (phone.startsWith("8")) phone = "62" + phone;

        out.add(`${phone}@c.us`);
        out.add(`${phone}@lid`);
        out.add(`${phone}@s.whatsapp.net`);
    }

    // juga jika input server @s.whatsapp.net, coba map ke @c.us
    if (s.endsWith("@s.whatsapp.net")) {
        out.add(`${noDevice}@c.us`);
    }

    return [...out].map(x => String(x).trim()).filter(Boolean);
}

// GreenAPI: POST /getGroupData/{token}
export async function greenapiGetGroupData({ idInstance, apiToken, groupId }) {
    // ✅ URL stabil
    const url = `https://7105.api.greenapi.com/waInstance${idInstance}/getGroupData/${apiToken}`;

    const r = await fetchWithTimeout(
        url,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ groupId }),
        },
        15000
    );

    if (!r.ok) {
        const text = await r.text().catch(() => "");
        throw new Error(`GreenAPI getGroupData failed: ${r.status} ${text}`.trim());
    }

    return r.json();
}

/**
 * Return { admins: [] } (array of "@c.us" and/or "@lid")
 * Disimpan cache per group chatId.
 */
export async function getGroupAdminsCached({ ctx, groupChatId }) {
    const key = CacheKeys.groupAdmins(groupChatId);

    return fetchJson(
        key,
        async () => {
            const data = await greenapiGetGroupData({
                idInstance: ctx.idInstance,
                apiToken: ctx.apiToken,
                groupId: groupChatId,
            });

            const parts = Array.isArray(data?.participants) ? data.participants : [];
            const admins = parts
                .filter(p => p?.isAdmin || p?.isSuperAdmin)
                .flatMap(p => [p?.id, p?.lid])
                .filter(Boolean)
                .map(s => String(s).trim());

            return { admins };
        },
        // cache agak lama biar gak sering hit API
        TTL.GROUP_ADMINS || 300
    );
}

/**
 * ✅ Tidak throw. Kalau gagal ambil data -> return false.
 * ✅ Support senderJid format @c.us / @lid / @s.whatsapp.net + device suffix
 */
export async function isSenderAdminGroup({ ctx, groupChatId, senderJid }) {
    if (!groupChatId || !senderJid) return false;

    try {
        const cached = await getGroupAdminsCached({ ctx, groupChatId });
        const admins = new Set((cached?.admins || []).map(s => String(s).trim()));

        const candidates = senderCandidates(senderJid);
        return candidates.some(c => admins.has(c));
    } catch (e) {
        console.error("[isSenderAdminGroup] failed:", e?.message);
        // fail-closed: anggap bukan admin
        return false;
    }
}
