// services/newhunterCekNopol.js
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

export async function cekNopolFromApi(q) {
    const query = normQ(q);
    if (!query) throw new Error("param kosong");

    const baseURL = process.env.NEWHUNTER_API_BASE || "https://api-1.newhunter.id";
    const token = process.env.NEWHUNTER_API_TOKEN;
    if (!token) throw new Error("NEWHUNTER_API_TOKEN belum diset");

    const cacheKey = `nh:ceknopol:${query}`;

    return fetchJsonAdvanced(
        cacheKey,
        async () => {
            const url = `${baseURL}/v1/bot/cekNopol`;

            const res = await axios.get(url, {
                params: { nopol: query },
                headers: { Authorization: token },
                timeout: 20000,
                validateStatus: () => true,
            });

            if (res.status < 200 || res.status >= 300) {
                const msg = extractApiMessage(res.data);

                if (res.status === 404) {
                    // ⬇️ return ok:false (bisa di-negative-cache TTL pendek)
                    return { ok: false, error: "Data tidak ditemukan", query, status: 404 };
                }

                if (res.status === 401 || res.status === 403) {
                    const e = new Error(msg || "Unauthorized (token salah/expired)");
                    e.status = res.status;
                    e.code = "UNAUTHORIZED";
                    throw e;
                }

                if (res.status === 429) {
                    const e = new Error(msg || "Rate limit, coba lagi nanti");
                    e.status = 429;
                    e.code = "RATE_LIMIT";
                    throw e;
                }

                if (res.status >= 500) {
                    const e = new Error(msg || `Server error (${res.status})`);
                    e.status = res.status;
                    e.code = "UPSTREAM_5XX";
                    throw e;
                }

                const e = new Error(msg || `Request gagal (${res.status})`);
                e.status = res.status;
                e.code = "UPSTREAM_4XX";
                throw e;
            }

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

            const hasAny = out.nopol || out.noka || out.nosin;
            if (!hasAny) return { ok: false, error: "Data tidak ditemukan", query, status: 404 };

            return out;
        },
        {
            ttl: 30 * 1000, // cache sukses 30 detik
            shouldCache: (val) => {
                // cache success selalu
                if (val?.ok === true) return true;

                // optional: cache "not found" sebentar agar gak spam API
                if (val?.ok === false && val?.status === 404) return true;

                // selain itu jangan cache
                return false;
            },
            getTTL: (val) => {
                if (val?.ok === true) return 30 * 1000;
                if (val?.ok === false && val?.status === 404) return TTL.NEGATIVE_SHORT; // 10 detik
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
