// services/historyFormatter.js

function safe(s, fallback = "-") {
    const t = String(s ?? "").trim();
    return t ? t : fallback;
}

function normalizeLeasingCode(s = "") {
    const up = String(s || "").trim().toUpperCase();
    if (!up) return "";
    return up.split(/\s+/)[0] || up;
}

function getLatLon(item) {
    const lat = Number(item?.accessLoc?.latitude || 0);
    const lon = Number(item?.accessLoc?.longitude || 0);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (Math.abs(lat) < 0.000001 && Math.abs(lon) < 0.000001) return null;
    return { lat, lon };
}

function resolveLeasing(item) {
    const a = normalizeLeasingCode(item?.leasing || "");
    if (a) return a;

    const v = item?.vehicleData || {};
    const b = normalizeLeasingCode(v["Leasing:"] || v["Leasing"] || "");
    return b;
}

export function formatHistoryMessage({ nopol, leasing, items, page = 1, perPage = 10 }) {
    const total = Array.isArray(items) ? items.length : 0;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const p = Math.min(Math.max(page, 1), totalPages);

    const start = (p - 1) * perPage;
    const slice = (items || []).slice(start, start + perPage);

    const header =
        `*HISTORY NOPOL ${safe(nopol, "").toUpperCase()}*\n` +
        `*================*\n` +
        `Leasing: *${safe(leasing, "-")}*\n` +
        `Total pengguna yang mengakses : ${total}\n` +
        `_Page ${p}/${totalPages}_\n` +
        `*================*`;

    const body = slice
        .map((x) => {
            const name = safe(x?.userName, "Tanpa Nama");
            const hp = safe(x?.userPhone, "-");
            const pt = safe(x?.userPt, "Tanpa PT");
            const waktu = safe(x?.accessDate, "-");

            // reportAwal / reportAkhir kadang null, kadang string, kadang object
            const awal =
                typeof x?.reportAwal === "string"
                    ? x.reportAwal
                    : (x?.reportAwal?.notes || x?.reportAwal?.kronologis || "");
            const akhir =
                typeof x?.reportAkhir === "string"
                    ? x.reportAkhir
                    : (x?.reportAkhir?.notes || x?.reportAkhir?.kronologis || "");

            const loc = getLatLon(x);
            const mapsLink = loc ? `https://maps.google.com/?q=${loc.lat},${loc.lon}` : null;

            let out =
                `*Nama: ${name}*\n` +
                `*HP : (${hp})*\n` +
                `PT : ${pt}\n` +
                `Waktu Akses : ${waktu}`;

            if (awal) out += `\nKronologis Awal : ${awal}`;
            if (akhir) out += `\nKronologis Akhir : ${akhir}`;

            if (mapsLink) {
                out += `\nLokasi : ${mapsLink}`;
                // Address belum ada (nanti kalau ada API reverse geocode kita isi)
            }

            out += `\n*================*`;
            return out;
        })
        .join("\n");

    return `${header}\n${body}`.trim();
}

export function resolveLeasingFromItems(items = []) {
    if (!Array.isArray(items) || !items.length) return "";
    return resolveLeasing(items[0]);
}
