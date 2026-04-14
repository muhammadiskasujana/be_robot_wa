import axios from "axios";

export async function fetchUsersReportXlsx({ baseUrl }) {
    const url = `${baseUrl}/api/reports/users.xlsx`;

    const res = await axios.get(url, {
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

        throw new Error(msg || `Tarik report pengguna gagal (${res.status})`);
    }

    const buf = Buffer.from(res.data);
    if (!buf?.length) throw new Error("File report pengguna kosong dari server");

    return buf;
}