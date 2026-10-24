export const INTERNAL_REPORTS = ["CETAK SK", "JB INTERNAL", "SALAH UNIT", "TIDAK TERKEJAR", "SUDAH BAYAR", "SUDAH TARIK"];

export function parseInternalNotification(text) {
    const source = String(text || "");
    if (!source.includes("HUNTER INFO")) return null;
    const field = (label) => source.match(new RegExp(`(?:^|\\n)\\s*[^\\n]*?${label}:\\s*\\*?([^\\n*]+)`, "i"))?.[1]?.trim() || "";
    const nopol = field("Nopol").replace(/\s+/g, "").toUpperCase();
    const leasing = field("Leasing").toUpperCase().replace(/\s+\d{4}$/, "");
    const accessAt = field("Tanggal Akses").replace(/\s+WIB$/i, "");
    const reportAt = field("Tanggal Report").replace(/\s+WIB$/i, "");
    const userLine = field("User");
    const userMatch = userLine.match(/^(.*?)\s*\((\d+)\)$/);
    if (!nopol || !leasing || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(accessAt) || !reportAt || !userMatch) return null;
    const rawPhone = userMatch[2];
    const accessPhone = rawPhone.startsWith("0") ? `62${rawPhone.slice(1)}` : rawPhone.startsWith("8") ? `62${rawPhone}` : rawPhone;
    return { nopol, leasing, access_at: accessAt, report_at: reportAt, access_user: userMatch[1].trim().toUpperCase(), access_phone: accessPhone };
}
