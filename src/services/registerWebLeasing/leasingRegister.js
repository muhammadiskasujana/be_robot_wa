// services/leasingRegister.js
import axios from "axios";

// ===== helpers =====
function up(s) {
    return String(s || "").trim().toUpperCase();
}

function normLineKey(s) {
    return up(s).replace(/\s+/g, "_"); // "Kelola Bahan" -> "KELOLA_BAHAN"
}

function toHp08(phone) {
    const p = String(phone || "").replace(/[^\d]/g, "");
    if (p.startsWith("62")) return "0" + p.slice(2);
    return p; // asumsi sudah 08xxxx
}

// ===== 1) build template =====
export function buildRegisterTemplate() {
    return (
        `INPUT DATA LOGIN\n` +
        `Nama : \n` +
        `Jabatan : \n` +
        `Kelola_Bahan : \n`
    ).trim();
}

// ===== 2) parse template submission =====
export function parseRegisterTemplate(textRaw) {
    const text = String(textRaw || "").replace(/\r/g, "").trim();
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) return null;

    if (up(lines[0]) !== "INPUT DATA LOGIN") return null;

    const data = {};
    for (const line of lines.slice(1)) {
        const idx = line.indexOf(":");
        if (idx === -1) continue;

        const k = normLineKey(line.slice(0, idx));
        const v = line.slice(idx + 1).trim();
        if (!v) continue;

        if (k === "NAMA") data.nama = v.trim();
        else if (k === "JABATAN") data.jabatan = String(v).trim(); // "1"/"2"/"3"
        else if (k === "KELOLA_BAHAN") data.kelola_bahan = String(v).trim(); // "1"/"2"/"3"
    }

    // minimal
    if (!data.nama || !data.jabatan || !data.kelola_bahan) return { ok: false, data, error: "incomplete" };

    const jab = Number(data.jabatan);
    const kb = Number(data.kelola_bahan);

    if (![1, 2, 3].includes(jab)) return { ok: false, data, error: "invalid_jabatan" };
    if (![1, 2, 3].includes(kb)) return { ok: false, data, error: "invalid_kelola_bahan" };

    // mapping sesuai spec endpoint register
    // role: PUSAT=1, AREA=2, CABANG=3, MASTER=4 (default CABANG)
    const role = jab === 1 ? 1 : jab === 2 ? 2 : 3;

    // handling: R2=1, R4=2, MIX=3 (default MIX)
    const handling = kb === 1 ? 1 : kb === 2 ? 2 : 3;

    return {
        ok: true,
        data: {
            nama: data.nama,
            jabatan: jab,
            kelola_bahan: kb,
            role,
            handling,
        },
    };
}

// ===== 3) fetch list cabang =====
// services/leasingRegister.js
export async function fetchCabangList({ leasingCode }) {
    const url = "https://api.digitalmanager.id/api/list/cabang";
    const res = await axios.get(url, {
        params: { leasing: leasingCode, format: "json" },
        timeout: 60000,
        validateStatus: () => true,
    });

    if (res.status < 200 || res.status >= 300) {
        throw new Error(`list cabang gagal: ${res.status} ${JSON.stringify(res.data || {})}`);
    }

    const data = res.data;
    const arr = Array.isArray(data?.data) ? data.data : [];

    // biarkan "-" ikut masuk supaya nomor sama dengan HTML
    const cabang = arr
        .map(x => String(x || "").trim())
        .filter(Boolean);

    return { ok: true, leasing: data?.leasing || leasingCode, cabang };
}

// ===== 4) submit register =====
export async function registerLeasingUser({ nama, phone, leasing, cabang, handling = 3, role = 3 }) {
    const url = "https://finance.digitalmanager.id/api/user/register";
    const body = {
        nama,
        phone: toHp08(phone),
        leasing,          // string
        cabang,           // array string
        handling,         // 1/2/3
        role,             // 1/2/3/4
    };

    const res = await axios.post(url, body, {
        timeout: 60000,
        validateStatus: () => true,
        headers: { "Content-Type": "application/json" },
    });

    // endpoint kamu katanya return {message,status}
    if (res.status >= 200 && res.status < 300) return { ok: true, data: res.data };

    return {
        ok: false,
        status: res.status,
        data: res.data,
        error: (res.data?.message || res.data?.error || "register gagal"),
    };
}
