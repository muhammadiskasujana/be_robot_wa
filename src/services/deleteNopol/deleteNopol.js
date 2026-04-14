import axios from "axios";

export async function bulkDeleteNopol({ leasingCode, nopolList }) {
    const baseURL = process.env.DIGITALMANAGER_API_BASE || "https://api.digitalmanager.id";
    const code = String(leasingCode || "").trim().toUpperCase();
    if (!code) throw new Error("leasingCode kosong");

    const url = `${baseURL}/api/titipan/bulkDelete/${encodeURIComponent(code)}`;

    const res = await axios.post(url, nopolList, {
        headers: { "Content-Type": "application/json" },
        timeout: 20000,
        validateStatus: () => true,
    });

    const data = res?.data;

    // invalid body
    if (!data || typeof data !== "object") {
        const e = new Error(`Invalid response (${res.status})`);
        e.status = res.status;
        e.response = { status: res.status, data };
        throw e;
    }

    // leasing mismatch (API mengembalikan ok:false)
    if (data.ok === false) {
        const e = new Error(data.message || data.error || "Gagal bulk delete");
        e.status = res.status || 400;
        e.code = "LEASING_MISMATCH";
        e.response = { status: res.status, data };
        throw e;
    }

    // ok:true (bisa sukses / bisa notFound semua)
    return data;
}