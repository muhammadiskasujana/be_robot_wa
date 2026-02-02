// services/newhunterCekNopol.js
import axios from "axios";
import { fetchJson } from "../cacheService.js";

function normQ(s = "") {
    return String(s).trim().toUpperCase().replace(/\s+/g, "");
}
function normalizeLeasingCode(s = "") {
    const up = String(s || "").trim().toUpperCase();
    if (!up) return "";
    // "FIF 1125" => "FIF"
    return up.split(/\s+/)[0] || up;
}

export async function cekNopolFromApi(q) {
    const query = normQ(q);
    if (!query) throw new Error("param kosong");

    const baseURL = process.env.NEWHUNTER_API_BASE || "https://api-1.newhunter.id";
    const token = process.env.NEWHUNTER_API_TOKEN;
    if (!token) throw new Error("NEWHUNTER_API_TOKEN belum diset");

    const cacheKey = `nh:ceknopol:${query}`;

    return fetchJson(
        cacheKey,
        async () => {
            const url = `${baseURL}/v1/bot/cekNopol`;

            const res = await axios.get(url, {
                params: { nopol: query },
                headers: { Authorization: token },
                timeout: 20000,
            });

            // response contoh: object
            const d = res.data || {};
            const out = {
                ok: true,
                nopol: d.nopol ? String(d.nopol).toUpperCase() : "",
                nosin: d.nosin ? String(d.nosin).toUpperCase() : "",
                noka: d.noka ? String(d.noka).toUpperCase() : "",
                tipe: d.tipe ? String(d.tipe).trim() : "",
                leasing: d.leasing ? String(d.leasing).trim().toUpperCase() : "",
                cabang: d.cabang ? String(d.cabang).trim().toUpperCase() : "",
                ovd: d.ovd != null ? String(d.ovd).trim() : "",
                contactPerson: d.contactPerson ?? "-",
                keterangan: d.keterangan ?? "",
                leasing_code: normalizeLeasingCode(d.leasing),
                raw: d,
            };

            // validasi minimal: kalau kosong semua, anggap tidak ketemu
            const hasAny = out.nopol || out.noka || out.nosin;
            if (!hasAny) return { ok: false, error: "Data tidak ditemukan", query };

            return out;
        },
        30 * 1000 // TTL 30 detik (boleh ubah)
    );
}

export function formatCekNopolMessage({ data, checkedByPhone }) {
    const nopol = data?.nopol || "-";
    const nosin = data?.nosin || "-";
    const noka = data?.noka || "-";
    const tipe = data?.tipe || "-";
    const leasing = data?.leasing || "-";
    const cabang = data?.cabang || "-";
    const ovd = data?.ovd || "-";

    return (
        `*CEK NOPOL HUNTER*\n` +
        `*====================*\n` +
        `Nopol : ${nopol}\n` +
        `Nosin : ${nosin}\n` +
        `Noka : ${noka}\n` +
        `Tipe : ${tipe}\n` +
        `Leasing : ${leasing}\n` +
        `Cabang : ${cabang}\n` +
        `OVD : ${ovd}\n` +
        `*Data dicek oleh ${checkedByPhone || "-"}.*`
    ).trim();
}
