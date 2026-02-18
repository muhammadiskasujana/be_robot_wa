import axios from "axios";

function isJsonResponse(contentType = "") {
    return String(contentType).toLowerCase().includes("application/json");
}

export async function fetchRekapDataXlsx({ baseUrl, leasing, cabang, source = "all" }) {
    const url = `${baseUrl}/api/rekap/data.xlsx`;

    // Kalau cabang kosong -> yakin excel
    // Kalau cabang ada -> bisa JSON atau excel tergantung backend
    const res = await axios.get(url, {
        params: { leasing, cabang: cabang ?? "", source },
        responseType: "arraybuffer",        // aman untuk dua-duanya
        timeout: 60000,
        validateStatus: () => true,
    });

    if (res.status < 200 || res.status >= 300) {
        const msg = (() => {
            try { return Buffer.from(res.data || "").toString("utf8"); } catch { return ""; }
        })();
        throw new Error(msg || `Rekap gagal (${res.status})`);
    }

    const ct = res.headers?.["content-type"] || "";
    const buf = Buffer.from(res.data || "");

    // Deteksi JSON dari header atau dari isi
    const looksJson = isJsonResponse(ct) || (() => {
        const s = buf.slice(0, 60).toString("utf8").trim();
        return s.startsWith("{") || s.startsWith("[");
    })();

    if (looksJson) {
        const txt = buf.toString("utf8");
        const json = JSON.parse(txt);
        return { kind: "json", json };
    }

    if (!buf.length) throw new Error("File kosong dari server");
    return { kind: "xlsx", buffer: buf };
}
