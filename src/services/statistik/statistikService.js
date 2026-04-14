import axios from "axios";

const STAT_API_BASE = process.env.STATISTIK_API_BASE || "https://statistik.digitalmanager.id";

export async function fetchAccessStatPng({
                                             leasing,
                                             cabang = "",
                                             year = "",
                                             month = "",
                                             day = "",
                                             start = "",
                                             end = "",
                                         }) {
    const url = `${STAT_API_BASE}/viz/access.png`;

    const res = await axios.get(url, {
        params: { leasing, cabang, year, month, day, start, end },
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
        throw new Error(msg || `Tarik statistik gagal (${res.status})`);
    }

    const buf = Buffer.from(res.data);
    if (!buf?.length) throw new Error("Gambar kosong dari server");
    return buf;
}
