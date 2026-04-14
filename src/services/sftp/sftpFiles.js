import axios from "axios";

const SFTP_API_BASE = process.env.SFTP_API_BASE || "https://sftp.digitalmanager.id";
const VPN_API_BASE = SFTP_API_BASE; // default: satu host yg sama

// ===== SFTP helpers =====

// dir aman: huruf/angka/_/-
function sanitizeDir(dir) {
    const d = String(dir || "").trim();
    if (!d) return null;
    if (!/^[a-zA-Z0-9_-]+$/.test(d)) return null;
    return d;
}

export async function listSftpFiles({ dir }) {
    const safeDir = sanitizeDir(dir);
    if (!safeDir) throw new Error("Dir tidak valid. Gunakan huruf/angka/_/- saja.");

    const url = `${SFTP_API_BASE}/api/sftp/list`;

    const res = await axios.get(url, {
        params: { dir: safeDir },
        timeout: 60000,
        validateStatus: () => true,
    });

    if (res.status < 200 || res.status >= 300) {
        const msg =
            (typeof res.data === "string" && res.data) ||
            (res.data?.error ? String(res.data.error) : "");
        throw new Error(msg || `List file gagal (${res.status})`);
    }

    if (!res.data?.ok) {
        throw new Error(res.data?.error || "List file gagal (response tidak ok)");
    }

    return res.data; // { ok, dir, path, files: [{name,type,size,modifyTime}] }
}

// file aman: tidak boleh ada slash/backslash, tidak boleh ".."
function sanitizeFileName(name) {
    const s = String(name || "").trim();
    if (!s) return null;
    if (s.includes("/") || s.includes("\\") || s.includes("..")) return null;
    // longgarin: izinkan spasi & tanda baca umum, tapi jangan kontrol chars
    if (/[\x00-\x1F\x7F]/.test(s)) return null;
    return s;
}

export async function downloadSftpFileXlsx({ dir, file }) {
    const safeDir = sanitizeDir(dir);
    if (!safeDir) throw new Error("Dir tidak valid. Gunakan huruf/angka/_/- saja.");

    const safeFile = sanitizeFileName(file);
    if (!safeFile) throw new Error("Nama file tidak valid.");

    const url = `${SFTP_API_BASE}/api/sftp/download`;

    const res = await axios.get(url, {
        params: { dir: safeDir, file: safeFile },
        responseType: "arraybuffer",
        timeout: 60000,
        validateStatus: () => true,
    });

    if (res.status < 200 || res.status >= 300) {
        const msg = (() => {
            try {
                return Buffer.from(res.data || "").toString("utf8");
            } catch {
                return "";
            }
        })();
        throw new Error(msg || `Download file gagal (${res.status})`);
    }

    const buf = Buffer.from(res.data);
    if (!buf?.length) throw new Error("File kosong dari server");
    return { buffer: buf, filename: safeFile, dir: safeDir };
}

// ===== VPN functions =====

function pickErrMsg(res) {
    if (!res) return "Request gagal";
    if (typeof res.data === "string" && res.data.trim()) return res.data.trim();
    if (res.data?.detail) return String(res.data.detail);
    if (res.data?.error) return String(res.data.error);
    return `Request gagal (${res.status || "no-status"})`;
}

export async function vpnUp() {
    const url = `${VPN_API_BASE}/api/vpn/up`;
    const res = await axios.post(url, null, {
        timeout: 90000,
        validateStatus: () => true,
    });

    if (res.status < 200 || res.status >= 300 || !res.data?.ok) {
        throw new Error(pickErrMsg(res) || `VPN up gagal (${res.status})`);
    }
    // { ok:true, message, output }
    return res.data;
}

export async function vpnDown() {
    const url = `${VPN_API_BASE}/api/vpn/down`;
    const res = await axios.post(url, null, {
        timeout: 90000,
        validateStatus: () => true,
    });

    if (res.status < 200 || res.status >= 300 || !res.data?.ok) {
        throw new Error(pickErrMsg(res) || `VPN down gagal (${res.status})`);
    }
    return res.data;
}

export async function vpnStatus() {
    const url = `${VPN_API_BASE}/api/vpn/status`;
    const res = await axios.get(url, {
        timeout: 60000,
        validateStatus: () => true,
    });

    if (res.status < 200 || res.status >= 300 || !res.data?.ok) {
        throw new Error(pickErrMsg(res) || `VPN status gagal (${res.status})`);
    }
    // { ok:true, output }
    return res.data;
}