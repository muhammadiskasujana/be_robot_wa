import axios from "axios";

export async function bulkDeleteNopol({ leasingCode, nopolList }) {
    const baseURL = process.env.NEWHUNTER_API_BASE || "https://api-1.newhunter.id";
    const token = process.env.NEWHUNTER_API_TOKEN;

    if (!token) throw new Error("NEWHUNTER_API_TOKEN belum diset");

    const url = `${baseURL}/v1/bot/bulkDelete/${leasingCode}`;

    const res = await axios.post(url, nopolList, {
        headers: {
            "Content-Type": "application/json",
            Authorization: token,
        },
        timeout: 20000,
    });

    return res.data;
}
