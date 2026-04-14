import moment from "moment-timezone";
const TZ = process.env.TZ || "Asia/Jakarta";

const MONTHS_ID = {
    januari: 1, february: 2, februari: 2, maret: 3, april: 4, mei: 5, june: 6, juni: 6,
    july: 7, juli: 7, agustus: 8, august: 8, september: 9, oktober: 10, october: 10,
    november: 11, desember: 12, december: 12,
};

function up(s) { return String(s || "").trim().toUpperCase(); }

function extractCabangOverride(text = "") {
    // cari "cabang <nama...>" sampai ketemu kata waktu umum atau akhir
    // contoh: "cabang banjarmasin hari ini" -> cabang="BANJARMASIN", rest="hari ini"
    const t = String(text || "").trim();
    if (!t) return { cabang: "", rest: "" };

    const m = t.match(/\bcabang\s+(.+?)(?=\b(hari ini|minggu ini|to|sampai|\d{4}|januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\b|$)/i);
    if (!m) return { cabang: "", rest: t };

    const cabang = up(m[1]).replace(/\s+/g, " ").trim();
    const rest = (t.replace(m[0], "").replace(/\s+/g, " ").trim());
    return { cabang, rest };
}

function parseDayMonthYear(s) {
    // "2 februari 2026"
    const parts = String(s || "").trim().split(/\s+/);
    if (parts.length < 3) return null;

    const day = parseInt(parts[0], 10);
    const monthKey = parts[1]?.toLowerCase();
    const year = parseInt(parts[2], 10);

    const month = MONTHS_ID[monthKey];
    if (!Number.isFinite(day) || !month || !Number.isFinite(year)) return null;

    const m = moment.tz({ year, month: month - 1, day }, TZ);
    if (!m.isValid()) return null;

    return { year, month, day };
}

function parseMonthYear(s) {
    // "februari 2026"
    const parts = String(s || "").trim().split(/\s+/);
    if (parts.length < 2) return null;

    const monthKey = parts[0]?.toLowerCase();
    const year = parseInt(parts[1], 10);
    const month = MONTHS_ID[monthKey];
    if (!month || !Number.isFinite(year)) return null;

    return { year, month };
}

function parseYearOnly(s) {
    const y = parseInt(String(s || "").trim(), 10);
    if (!Number.isFinite(y) || y < 1900 || y > 2100) return null;
    return { year: y };
}

// output: { ok, year, month, day, start, end, label, error }
export function parseStatistikQuery(rawText = "") {
    const raw = String(rawText || "").trim().toLowerCase();

    // default kosong = no time params (pakai behavior server default)
    if (!raw) return { ok: true, year: "", month: "", day: "", start: "", end: "", label: "default" };

    // range "X to Y"
    // contoh: "2 februari 2026 to 6 februari 2026"
    if (raw.includes(" to ") || raw.includes(" sampai ")) {
        const sep = raw.includes(" to ") ? " to " : " sampai ";
        const [a, b] = raw.split(sep).map(x => x.trim()).filter(Boolean);
        const A = parseDayMonthYear(a);
        const B = parseDayMonthYear(b);
        if (!A || !B) return { ok: false, error: "Format range salah. Contoh: 2 februari 2026 to 6 februari 2026" };

        const startM = moment.tz({ year: A.year, month: A.month - 1, day: A.day }, TZ).startOf("day");
        const endM = moment.tz({ year: B.year, month: B.month - 1, day: B.day }, TZ).endOf("day");

        if (!startM.isValid() || !endM.isValid() || endM.isBefore(startM)) {
            return { ok: false, error: "Range tanggal tidak valid (end harus >= start)." };
        }

        // params range (server kamu pakai apa? kamu contohkan start=&end= di URL)
        return {
            ok: true,
            year: "",
            month: "",
            day: "",
            start: startM.format("YYYY-MM-DD"),
            end: endM.format("YYYY-MM-DD"),
            label: `${startM.format("D MMM YYYY")} - ${endM.format("D MMM YYYY")}`,
        };
    }

    if (raw === "hari ini") {
        const m = moment.tz(TZ).startOf("day");
        return {
            ok: true,
            year: String(m.year()),
            month: String(m.month() + 1),
            day: String(m.date()),
            start: "",
            end: "",
            label: `hari ini (${m.format("D MMM YYYY")})`,
        };
    }

    if (raw === "minggu ini") {
        const end = moment.tz(TZ).endOf("day");
        const start = moment.tz(TZ).subtract(7, "days").startOf("day");
        return {
            ok: true,
            year: "",
            month: "",
            day: "",
            start: start.format("YYYY-MM-DD"),
            end: end.format("YYYY-MM-DD"),
            label: `7 hari terakhir (${start.format("D MMM")} - ${end.format("D MMM")})`,
        };
    }

    // day month year
    const dmy = parseDayMonthYear(raw);
    if (dmy) {
        return {
            ok: true,
            year: String(dmy.year),
            month: String(dmy.month),
            day: String(dmy.day),
            start: "",
            end: "",
            label: `${dmy.day} ${raw.split(/\s+/)[1]} ${dmy.year}`,
        };
    }

    // month year
    const my = parseMonthYear(raw);
    if (my) {
        return {
            ok: true,
            year: String(my.year),
            month: String(my.month),
            day: "",
            start: "",
            end: "",
            label: `${raw.split(/\s+/)[0]} ${my.year}`,
        };
    }

    // year only
    const yo = parseYearOnly(raw);
    if (yo) {
        return {
            ok: true,
            year: String(yo.year),
            month: "",
            day: "",
            start: "",
            end: "",
            label: `tahun ${yo.year}`,
        };
    }

    return { ok: false, error: "Format waktu tidak dikenali. Contoh: 2026 | februari 2026 | 2 februari 2026 | hari ini | minggu ini | 2 februari 2026 to 6 februari 2026" };
}

// gabungan: cabang override + time parsing
export function parseStatistikArgs(argsText = "") {
    const { cabang, rest } = extractCabangOverride(argsText);
    const time = parseStatistikQuery(rest);
    if (!time.ok) return { ok: false, error: time.error };
    return { ok: true, cabangOverride: cabang, ...time };
}
