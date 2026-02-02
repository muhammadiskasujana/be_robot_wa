// services/newhunterHistory.js
import axios from "axios";
import { fetchJson, TTL } from "../cacheService.js";

function normPlate(s = "") {
    return String(s).trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeLeasingCode(s = "") {
    const up = String(s || "").trim().toUpperCase();
    if (!up) return "";
    // ambil token pertama biar "KREDITPLUS 1225" => "KREDITPLUS"
    return up.split(/\s+/)[0] || up;
}

function resolveLeasingFromItem(item) {
    // prioritas: item.leasing, fallback: vehicleData["Leasing:"]
    const a = normalizeLeasingCode(item?.leasing || "");
    if (a) return a;

    const v = item?.vehicleData || {};
    const b = normalizeLeasingCode(v["Leasing:"] || v["Leasing"] || "");
    return b;
}

export async function getAccessHistoryByNopol(nopol) {
    const plate = normPlate(nopol);
    if (!plate) throw new Error("NOPOL kosong");

    const baseURL = process.env.NEWHUNTER_API_BASE || "https://api-1.newhunter.id";
    const token = process.env.NEWHUNTER_API_TOKEN;
    if (!token) throw new Error("NEWHUNTER_API_TOKEN belum diset");

    // cache key khusus nopol (TTL pendek biar aman)
    const cacheKey = `nh:history:${plate}`;

    return fetchJson(
        cacheKey,
        async () => {
            const url = `${baseURL}/v1/tracker/getAccessHistory`;

            const res = await axios.get(url, {
                params: {
                    historyFilter: "NOPOL",
                    param: plate,
                },
                headers: {
                    Authorization: token, // sesuai contoh kamu (Bearer sudah termasuk atau token mentah)
                },
                timeout: 20000,
            });

            const arr = Array.isArray(res.data) ? res.data : [];
            return {
                ok: true,
                nopol: plate,
                items: arr,
                leasing: arr.length ? resolveLeasingFromItem(arr[0]) : "",
                raw: arr,
            };
        },
        30 * 1000 // TTL 30 detik (bisa kamu ubah)
    );
}

export function extractLeasingFromHistoryResponse(historyRes) {
    const items = historyRes?.items || [];
    if (!items.length) return "";
    return normalizeLeasingCode(items[0]?.leasing) || "";
}
