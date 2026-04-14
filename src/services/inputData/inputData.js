import axios from "axios";

function up(s) {
    return String(s || "").trim().toUpperCase();
}

function cleanIdValue(v = "") {
    return String(v || "")
        .toUpperCase()
        .replace(/\s+/g, "")
        .replace(/[^A-Z0-9]/g, "");
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

export function parseFilledTemplate(textRaw) {
    const text = String(textRaw || "").replace(/\r/g, "").trim();
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
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
        const rawV = line.slice(idx + 1).trim();
        if (!rawV) continue;

        if (k === "NOPOL") data.nopol = cleanIdValue(rawV);
        else if (k === "NOSIN") data.nosin = cleanIdValue(rawV);
        else if (k === "NOKA") data.noka = cleanIdValue(rawV);
        else if (k === "TIPE") data.tipe = up(rawV);
        else if (k === "LEASING") data.leasing = up(rawV);
        else if (k === "CABANG") data.cabang = up(rawV);
        else if (k === "OVD") data.ovd = up(rawV);
        else if (k === "KETERANGAN") data.keterangan = rawV; // biarkan apa adanya
    }

    return { type, data };
}

function toHp08(phone) {
    const p = String(phone || "").replace(/[^\d]/g, "");
    if (p.startsWith("62")) return "0" + p.slice(2);
    return p;
}

/**
 * NEW: kirim ke DigitalManager titipan insert/update/exists
 * Endpoint:
 *  POST https://api.digitalmanager.id/api/titipan/insert/data?hp=08...&senderId=...@g.us
 *
 * payload: sama seperti sebelumnya
 * response:
 *  - ok true, action: insert|update|exists, message, kode_bulan, data, updatedFields?
 *  - ok false, error: "nosin wajib"
 */
export async function sendToTitipanInsert({ phone, senderId, payload }) {
    const baseURL = process.env.DIGITALMANAGER_API_BASE || "https://api.digitalmanager.id";
    const url = `${baseURL}/api/titipan/insert/data`;

    const params = {
        hp: toHp08(phone),
        senderId,
    };

    console.log("[TITIPAN INSERT]", {
        url,
        params,
        payload,
    });

    const res = await axios.post(url, payload, {
        params,
        headers: { "Content-Type": "application/json" },
        timeout: 60000,
        validateStatus: () => true, // biar bisa handle ok:false tanpa throw axios
    });

    // Normalisasi error
    const data = res?.data;
    if (!data || typeof data !== "object") {
        const bodyText = typeof data === "string" ? data : "";
        throw new Error(`Invalid response (${res.status}) ${bodyText}`.trim());
    }

    if (data.ok === false) {
        // server sudah kasih error message yang jelas
        const errMsg = data.error || data.message || "Gagal insert data";
        const e = new Error(errMsg);
        e.response = { status: res.status, data };
        throw e;
    }

    // ok true
    return data;
}