// services/newhunterCekNopol.js  (drop-in replacement, endpoint titipan)
import axios from "axios";
import { fetchJsonAdvanced, TTL } from "../cacheService.js";

function normQ(s = "") {
    return String(s).trim().toUpperCase().replace(/\s+/g, "");
}
function normalizeLeasingCode(s = "") {
    const up = String(s || "").trim().toUpperCase();
    if (!up) return "";
    return up.split(/\s+/)[0] || up;
}
function extractApiMessage(data) {
    if (!data) return "";
    if (typeof data === "string") return data;
    return data?.error || data?.message || data?.msg || "";
}

/**
 * NEW: cek nopol dari DigitalManager titipan
 * GET /api/titipan/cek/data?input=...
 *
 * Response:
 * - ok true, found true, data:{...}
 * - ok true, found false, message:"Data tidak ditemukan"
 */
export async function cekNopolFromApi(q) {
    const query = normQ(q);
    if (!query) throw new Error("param kosong");

    const baseURL = process.env.DIGITALMANAGER_API_BASE || "https://api.digitalmanager.id";
    const cacheKey = `dm:titipan:cek:${query}`;

    return fetchJsonAdvanced(
        cacheKey,
        async () => {
            const url = `${baseURL}/api/titipan/cek/data`;

            const res = await axios.get(url, {
                params: { input: query },
                timeout: 20000,
                validateStatus: () => true,
            });

            if (res.status < 200 || res.status >= 300) {
                const msg = extractApiMessage(res.data);
                const e = new Error(msg || `Request gagal (${res.status})`);
                e.status = res.status;
                e.code = res.status >= 500 ? "UPSTREAM_5XX" : "UPSTREAM_4XX";
                throw e;
            }

            const body = res.data || {};
            // bentuk not found di API ini: ok true, found false
            if (body?.ok === true && body?.found === false) {
                return { ok: false, error: body?.message || "Data tidak ditemukan", query, status: 404 };
            }

            // bentuk found: ok true, found true, data: {...}
            if (body?.ok !== true || body?.found !== true || !body?.data) {
                return { ok: false, error: body?.message || "Data tidak ditemukan", query, status: 404 };
            }

            const d = body.data || {};

            // Normalisasi output agar handler kamu TIDAK perlu diubah
            const out = {
                ok: true,
                nopol: d.nopol ? String(d.nopol).toUpperCase() : "",
                nosin: d.nosin ? String(d.nosin).toUpperCase() : "",
                noka: d.noka ? String(d.noka).toUpperCase() : "",
                tipe: d.tipe ? String(d.tipe).trim() : "",
                leasing: d.leasing ? String(d.leasing).trim().toUpperCase() : "",
                cabang: d.cabang ? String(d.cabang).trim().toUpperCase() : "",
                ovd: d.ovd != null ? String(d.ovd).trim() : "",
                contactPerson: d.contact_person ?? "-",
                keterangan: d.keterangan ?? "",
                leasing_code: normalizeLeasingCode(d.leasing),
                raw: d,
                source: body.source || "titipan",
                matchedBy: body.matchedBy || "nopol",
            };

            const hasAny = out.nopol || out.noka || out.nosin;
            if (!hasAny) return { ok: false, error: "Data tidak ditemukan", query, status: 404 };

            return out;
        },
        {
            ttl: 30 * 1000,
            shouldCache: (val) => {
                if (val?.ok === true) return true;
                if (val?.ok === false && val?.status === 404) return true;
                return false;
            },
            getTTL: (val) => {
                if (val?.ok === true) return 30 * 1000;
                if (val?.ok === false && val?.status === 404) return TTL.NEGATIVE_SHORT;
                return 0;
            },
        }
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