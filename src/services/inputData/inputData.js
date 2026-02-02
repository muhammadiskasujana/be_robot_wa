import axios from "axios";

function up(s) {
    return String(s || "").trim().toUpperCase();
}

export function buildInputTemplate({ modeKey, type }) {
    const isLeasingMode = modeKey === "leasing";
    const t = String(type || "").toUpperCase(); // R2 / R4

    return (
        `INPUT DATA ${t}\n` +
        `NOPOL:\n` +
        `NOSIN:\n` +
        `NOKA:\n` +
        `TIPE:\n` +
        (isLeasingMode ? `` : `LEASING:\n`) +
        `CABANG:\n` +
        `OVD:\n` +
        `KETERANGAN:\n`
    ).trim();
}

/**
 * Parse pesan template yang sudah diisi.
 * Accept format:
 * INPUT DATA R2
 * NOPOL: DA1234XX
 * NOSIN: ...
 * ...
 */
export function parseFilledTemplate(textRaw) {
    const text = String(textRaw || "").replace(/\r/g, "").trim();
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return null;

    const header = up(lines[0]);
    if (!header.startsWith("INPUT DATA")) return null;

    const type = header.includes("R4") ? "R4" : header.includes("R2") ? "R2" : null;
    if (!type) return null;

    const data = {};
    for (const line of lines.slice(1)) {
        const idx = line.indexOf(":");
        if (idx === -1) continue;
        const k = up(line.slice(0, idx));
        const v = line.slice(idx + 1).trim();
        if (!v) continue;

        if (k === "NOPOL") data.nopol = up(v);
        else if (k === "NOSIN") data.nosin = up(v);
        else if (k === "NOKA") data.noka = up(v);
        else if (k === "TIPE") data.tipe = up(v);
        else if (k === "LEASING") data.leasing = up(v);
        else if (k === "CABANG") data.cabang = up(v);
        else if (k === "OVD") data.ovd = up(v);
        else if (k === "KETERANGAN") data.keterangan = v;
    }

    return { type, data };
}

function toHp08(phone) {
    const p = String(phone || "").replace(/[^\d]/g, "");
    if (p.startsWith("62")) return "0" + p.slice(2);
    return p;
}

export async function sendToNewHunter({ phone, senderId, payload }) {
    const baseURL = process.env.NEWHUNTER_API_BASE || "https://api-1.newhunter.id";
    const token = process.env.NEWHUNTER_API_TOKEN;

    if (!token) throw new Error("NEWHUNTER_API_TOKEN belum diset di .env");

    const url = `${baseURL}/v1/bot/sendData`;
    const params = {
        hp: toHp08(phone),        // contoh: 6285xxxx (atau 085.. sesuai normalize kamu)
        senderId: senderId, // chatId group
    };

    console.log("[SEND DATA]", {
        url,
        params,
        payload,
        authPrefix: String(token).slice(0, 12),
    });

    const res = await axios.post(url, payload, {
        params,
        headers: {
            "Content-Type": "application/json",
            Authorization: token, // kalau token kamu butuh "Bearer xxx", isi env-nya pakai "Bearer ..."
        },
        timeout: 60000,
    });

    return res.data;
}
