import axios from "axios";

export async function fetchAccessReportByPhoneXlsx({ baseUrl, phone, tahun, bulan, tanggal }) {
    const url = `${baseUrl}/api/reports/access-by-phone.xlsx`;

    const res = await axios.get(url, {
        params: { phone, tahun, bulan, tanggal: tanggal ?? "" },
        responseType: "arraybuffer",
        timeout: 60000,
        validateStatus: () => true,
    });

    if (res.status < 200 || res.status >= 300) {
        const msg = (() => {
            try { return Buffer.from(res.data || "").toString("utf8"); } catch { return ""; }
        })();
        throw new Error(msg || `Tarik report nomor HP gagal (${res.status})`);
    }

    const buf = Buffer.from(res.data);
    if (!buf?.length) throw new Error("File kosong dari server");
    return buf;
}
