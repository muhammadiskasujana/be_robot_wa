import axios from "axios";

export function normalizePiutangIdentifier(value) {
    const identifier = String(value ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]+(?:[ -][A-Z0-9]+)*$/.test(identifier)) {
        throw new Error("Nopol, noka, nosin, atau nomor kontrak tidak valid.");
    }
    return identifier.replace(/ /g, "");
}

export async function fetchKartuPiutangDocument({ identifier }) {
    const query = normalizePiutangIdentifier(identifier);
    const baseUrl = String(process.env.KARTU_PIUTANG_API_BASE || "https://api-piutang.digitalmanager.id").trim().replace(/\/+$/, "");
    const response = await axios.get(`${baseUrl}/schedule/${encodeURIComponent(query)}`, {
        responseType: "arraybuffer",
        timeout: 120000,
        validateStatus: () => true,
    });
    const buffer = Buffer.from(response.data || "");
    const contentType = String(response.headers?.["content-type"] || "application/pdf").trim();
    const isJson = /json/i.test(contentType) || /^[\s]*[\[{]/.test(buffer.subarray(0, 32).toString("utf8"));
    if (response.status < 200 || response.status >= 300 || isJson || /text\/html/i.test(contentType)) {
        let message = "";
        if (isJson) {
            try {
                const data = JSON.parse(buffer.toString("utf8"));
                message = typeof data.message === "string" ? data.message : typeof data.error === "string" ? data.error : "";
            } catch {}
        }
        throw new Error(message || `API kartu piutang gagal mengembalikan dokumen (HTTP ${response.status}).`);
    }
    if (!buffer.length) throw new Error("API kartu piutang mengembalikan file kosong.");
    const disposition = String(response.headers?.["content-disposition"] || "");
    let filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || "";
    const utf = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    if (utf) {
        try { filename = decodeURIComponent(utf); } catch {}
    }
    filename = filename.trim().replace(/[^\w.\-]+/g, "_") || `kartu-piutang-${query}.pdf`;
    return { buffer, filename, contentType };
}
