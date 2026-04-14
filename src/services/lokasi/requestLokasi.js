import axios from "axios";
import { fetchJsonAdvanced, TTL } from "../cacheService.js";

function cleanPhone(s = "") {
    return String(s || "").replace(/[^\d]/g, "");
}

function normName(s = "") {
    return String(s || "").trim().replace(/\s+/g, " ");
}

function extractApiMessage(data) {
    if (!data) return "";
    if (typeof data === "string") return data;
    return data?.error || data?.message || data?.msg || "";
}

function buildMapsLink(lat, lng) {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

function buildReadableAddress(reverseGeocode) {
    if (!reverseGeocode) return "";

    if (reverseGeocode.display_name) {
        return String(reverseGeocode.display_name).trim();
    }

    const a = reverseGeocode.address || {};
    const parts = [
        a.road,
        a.suburb,
        a.village,
        a.city || a.town || a.county,
        a.state,
        a.postcode,
        a.country,
    ].filter(Boolean);

    return parts.join(", ");
}

export function parseRequestLokasiInput(raw = "") {
    const text = String(raw || "").trim();
    if (!text) return { phone: "", name: "" };

    const digits = text.replace(/[^\d]/g, "");
    const isMostlyPhone = digits.length >= 8 && /^[\d+\s().-]+$/.test(text);

    if (isMostlyPhone) {
        return { phone: digits, name: "" };
    }

    return { phone: "", name: text };
}

/**
 * Request lokasi terbaru by phone or name
 * params:
 * - { phone: "08123..." }
 * - { name: "Andilau Soares" }
 */
export async function requestLokasiTerbaru({ phone, name }) {
    const phoneClean = cleanPhone(phone);
    const nameClean = normName(name);

    if (!phoneClean && !nameClean) {
        throw new Error("phone atau name wajib diisi");
    }

    const baseURL = process.env.DIGITALMANAGER_API_BASE || "https://api.digitalmanager.id";
    const queryKey = phoneClean ? `phone:${phoneClean}` : `name:${nameClean.toUpperCase()}`;
    const cacheKey = `dm:userloc:latest:${queryKey}`;

    return fetchJsonAdvanced(
        cacheKey,
        async () => {
            const url = `${baseURL}/api/user/location/latest`;

            const res = await axios.get(url, {
                params: phoneClean ? { phone: phoneClean } : { name: nameClean },
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

            if (body?.ok !== true || !body?.user || !body?.location) {
                return {
                    ok: false,
                    error: body?.message || "Lokasi tidak ditemukan",
                    status: 404,
                    query: { phone: phoneClean, name: nameClean },
                };
            }

            const lat = body?.location?.latitude;
            const lng = body?.location?.longitude;

            if (lat == null || lng == null) {
                return {
                    ok: false,
                    error: "Koordinat tidak tersedia",
                    status: 404,
                    query: { phone: phoneClean, name: nameClean },
                };
            }

            return {
                ok: true,
                source: body?.source || "",
                comparedSources: Array.isArray(body?.comparedSources) ? body.comparedSources : [],
                user: {
                    uuid: body?.user?.uuid || "",
                    name: body?.user?.name || "-",
                    phone: body?.user?.phone || "-",
                    pt: body?.user?.pt || "-",
                    nik: body?.user?.nik || "-",
                    active_until: body?.user?.active_until || null,
                },
                location: {
                    latitude: Number(lat),
                    longitude: Number(lng),
                    accuracy: body?.location?.accuracy ?? null,
                    speed: body?.location?.speed ?? null,
                    bearing: body?.location?.bearing ?? null,
                },
                timestamp: body?.timestamp || null,
                timestampText: body?.timestampText || "",
                timeAgo: body?.timeAgo || "",
                mapsUrl: buildMapsLink(lat, lng),
                reverse_geocode: body?.reverse_geocode || null,
                raw: body,
            };
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

export function formatRequestLokasiMessage(data) {
    const userName = data?.user?.name || "-";
    const userPhone = data?.user?.phone || "-";
    const mapsUrl = data?.mapsUrl || buildMapsLink(
        data?.location?.latitude,
        data?.location?.longitude
    );
    const timeAgo = data?.timeAgo || "Waktu tidak diketahui";

    const detailAddress = buildReadableAddress(data?.reverse_geocode);
    const addressBlock = detailAddress ? `Alamat: ${detailAddress}\n` : "";

    return (
        `🗞️ Lokasi terbaru dari *${userName} (${userPhone})*:\n` +
        `🔗 ${mapsUrl}\n` +
        `📍 ${addressBlock}` +
        `🕑 Lokasi ${timeAgo}`
    ).trim();
}