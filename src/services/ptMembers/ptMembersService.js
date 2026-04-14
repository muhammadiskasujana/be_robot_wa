// src/services/ptMembers/ptMembersService.js
import axios from "axios";

function reqStr(v) {
    return String(v ?? "").trim();
}

function normalizePhonePretty(p) {
    const digits = String(p || "").replace(/[^\d]/g, "");
    if (!digits) return "-";
    if (digits.startsWith("62")) return "0" + digits.slice(2);
    return digits;
}

function fmtDateWIB(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return "";
    try {
        return new Intl.DateTimeFormat("id-ID", {
            timeZone: "Asia/Jakarta",
            year: "numeric",
            month: "short",
            day: "2-digit",
        }).format(new Date(n));
    } catch {
        return "";
    }
}

export function buildPtMembersMessages({ pt, mode, items, count }) {
    const title =
        mode === "active"
            ? "LIST ANGGOTA AKTIF"
            : mode === "inactive"
                ? "LIST ANGGOTA NONAKTIF"
                : "LIST ANGGOTA";

    const list = Array.isArray(items) ? items : [];
    const total = Number(count ?? list.length) || list.length;

    if (!list.length) {
        return [
            `*${title}*\n` +
            `PT: *${pt}*\n` +
            `Total: *${total}*\n` +
            `====================\n` +
            `Tidak ada data.`
        ];
    }

    const MAX = 70;
    const chunks = [];

    for (let start = 0; start < list.length; start += MAX) {
        const slice = list.slice(start, start + MAX);

        const lines = slice.map((u, i) => {
            const index = start + i + 1;

            const nama = reqStr(u?.name || u?.nama || u?.full_name || "-");
            const phone = normalizePhonePretty(u?.phone || u?.nohp || u?.no_hp || u?.hp || "");

            const isActive =
                u?.isActive != null ? Boolean(u.isActive) :
                    u?.is_active != null ? Boolean(u.is_active) :
                        u?.active != null ? Boolean(u.active) :
                            null;

            const until = fmtDateWIB(u?.active_until);
            const badge = isActive === true ? "✅" : isActive === false ? "❌" : "";
            const untilTxt = until ? ` (s/d ${until})` : "";

            return `${index}. ${nama} ${badge}\n   ${phone}${untilTxt}`.trim();
        });

        const header =
            `*${title}*\n` +
            `PT: *${pt}*\n` +
            `Total: *${total}*\n` +
            `====================\n`;

        const footer =
            `\n\nHalaman ${Math.floor(start / MAX) + 1} dari ${Math.ceil(total / MAX)}`;

        chunks.push(header + lines.join("\n") + footer);
    }

    return chunks;
}

function pickItemsFromSplit(body, wantedMode) {
    const data = body?.data;
    const counts = body?.counts || {};

    if (!data || typeof data !== "object") {
        return { items: [], count: 0 };
    }

    if (wantedMode === "active") {
        const items = Array.isArray(data?.active) ? data.active : [];
        const count = Number(counts?.active ?? items.length) || items.length;
        return { items, count };
    }

    if (wantedMode === "inactive") {
        const items = Array.isArray(data?.inactive) ? data.inactive : [];
        const count = Number(counts?.inactive ?? items.length) || items.length;
        return { items, count };
    }

    // all: gabung active+inactive
    const a = Array.isArray(data?.active) ? data.active : [];
    const b = Array.isArray(data?.inactive) ? data.inactive : [];
    const items = [...a, ...b];
    const count = Number(counts?.all ?? items.length) || items.length;
    return { items, count };
}

export async function fetchPtMembers({ ptName, mode }) {
    const pt = reqStr(ptName);
    if (!pt) throw new Error("PT kosong");

    const wantedMode = mode === "active" || mode === "inactive" ? mode : "all";

    const baseUrl = process.env.DIGITALMANAGER_API_BASE || "https://api.digitalmanager.id";
    const url = `${baseUrl}/api/users/pt`;

    // IMPORTANT:
    // - kalau API kamu bisa mode=active/inactive, kita kirim
    // - tapi tetap aman kalau server balas "split" (seperti log kamu)
    const params = { pt };
    if (wantedMode !== "all") params.mode = wantedMode;

    console.log("========== PT MEMBERS REQUEST ==========");
    console.log("URL:", url);
    console.log("Params:", params);
    console.log("========================================");

    const res = await axios.get(url, { params, timeout: 60000 });
    const body = res?.data || {};

    console.log("========== PT MEMBERS RESPONSE ==========");
    console.log("Status:", res?.status);
    console.log("Data keys:", Object.keys(body || {}));
    console.log("mode:", body?.mode);
    console.log("counts:", body?.counts);
    console.log("========================================");

    // case 1: split response (mode: split)
    if (body?.mode === "split" && body?.data && typeof body.data === "object") {
        const { items, count } = pickItemsFromSplit(body, wantedMode);

        console.log("Items length (split):", items.length, "Count:", count);

        return {
            ok: Boolean(body?.ok ?? true),
            pt: reqStr(body?.pt) || pt,
            mode: wantedMode,
            count,
            items,
            raw: body,
        };
    }

    // case 2: old response: data = []
    const items =
        Array.isArray(body?.data) ? body.data :
            Array.isArray(body?.items) ? body.items :
                Array.isArray(body?.data?.data) ? body.data.data :
                    [];

    const count = Number(body?.count ?? items.length) || items.length;

    console.log("Items length (array):", items.length, "Count:", count);

    return {
        ok: Boolean(body?.ok ?? true),
        pt: reqStr(body?.pt) || pt,
        mode: reqStr(body?.mode) || wantedMode,
        count,
        items,
        raw: body,
    };
}

export function formatPtMembersMessage({ pt, mode, items, count }) {
    const title =
        mode === "active"
            ? "LIST ANGGOTA AKTIF"
            : mode === "inactive"
                ? "LIST ANGGOTA NONAKTIF"
                : "LIST ANGGOTA";

    const list = Array.isArray(items) ? items : [];
    const total = Number(count ?? list.length) || list.length;

    if (!list.length) {
        return (
            `*${title}*\n` +
            `PT: *${pt}*\n` +
            `Total: *${total}*\n` +
            `====================\n` +
            `Tidak ada data.`
        );
    }

    // tampilkan max 70 biar aman (WA panjang)
    const MAX = 70;

    const lines = list.slice(0, MAX).map((u, i) => {
        const nama = reqStr(u?.name || u?.nama || u?.full_name || "-");
        const phone = normalizePhonePretty(u?.phone || u?.nohp || u?.no_hp || u?.hp || "");
        const isActive =
            u?.isActive != null ? Boolean(u.isActive) :
                u?.is_active != null ? Boolean(u.is_active) :
                    u?.active != null ? Boolean(u.active) :
                        null;

        const until = fmtDateWIB(u?.active_until);
        const badge = isActive === true ? "✅" : isActive === false ? "❌" : "";
        const untilTxt = until ? ` (s/d ${until})` : "";

        return `${i + 1}. ${nama} ${badge}\n   ${phone}${untilTxt}`.trim();
    });

    const more = total > MAX ? `\n\n…dan ${total - MAX} anggota lainnya.` : "";

    return (
        `*${title}*\n` +
        `PT: *${pt}*\n` +
        `Total: *${total}*\n` +
        `====================\n` +
        lines.join("\n") +
        more
    );
}