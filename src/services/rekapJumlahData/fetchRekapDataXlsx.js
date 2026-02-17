import axios from "axios";

export async function fetchRekapDataXlsx({ baseUrl, leasing }) {
    const url = `${baseUrl}/api/rekap/data.xlsx`;

    const res = await axios.get(url, {
        params: { leasing },
        responseType: "arraybuffer",
        timeout: 60000,
        validateStatus: () => true,
    });

    if (res.status < 200 || res.status >= 300) {
        const msg = (() => {
            try { return Buffer.from(res.data || "").toString("utf8"); } catch { return ""; }
        })();
        throw new Error(msg || `Tarik rekap gagal (${res.status})`);
    }

    const buf = Buffer.from(res.data);
    if (!buf?.length) throw new Error("File kosong dari server");
    return buf;
}
