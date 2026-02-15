// services/newhunterHistory.js (NEW - DigitalManager)
import axios from "axios";
import { fetchJson } from "../cacheService.js";

function normInput(s = "") {
    return String(s).trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeLeasingCode(s = "") {
    const up = String(s || "").trim().toUpperCase();
    if (!up) return "";
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

/**
 * Ambil riwayat akses berdasarkan param (bisa nosin/noka/nopol/...)
 * API: https://api.digitalmanager.id/api/history/access?param=...
 */
export async function getAccessHistoryByParam(param) {
    const input = normInput(param);
    if (!input) throw new Error("Param kosong");

    const baseURL = process.env.DIGITALMANAGER_API_BASE || "https://api.digitalmanager.id";
    const cacheKey = `dm:history:${input}`;

    return fetchJson(
        cacheKey,
        async () => {
            const url = `${baseURL}/api/history/access`;

            const res = await axios.get(url, {
                params: { param: input },
                timeout: 20000,
            });

            const data = res?.data || {};
            const items = Array.isArray(data?.data) ? data.data : [];

            // normalisasi output biar mirip response lama yang kamu pakai di robot.js
            const resolvedNopol = String(data?.resolvedNopol || "").trim().toUpperCase();

            return {
                ok: Boolean(data?.ok),
                input,
                nopol: resolvedNopol || "",     // penting: hasil resolved
                resolvedNopol: resolvedNopol || "",
                resolvedFrom: data?.resolvedFrom || "",
                count: Number(data?.count ?? items.length ?? 0),
                items,
                leasing: items.length ? resolveLeasingFromItem(items[0]) : "",
                raw: data,
            };
        },
        30 * 1000
    );
}

// kompat: kalau ada pemanggilan lama
export async function getAccessHistoryByNopol(nopolOrParam) {
    return getAccessHistoryByParam(nopolOrParam);
}

export function extractLeasingFromHistoryResponse(historyRes) {
    const items = historyRes?.items || [];
    if (!items.length) return "";
    return normalizeLeasingCode(items[0]?.leasing) || "";
}
