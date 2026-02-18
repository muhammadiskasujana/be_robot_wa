function safe(s, fb = "-") {
    const t = String(s ?? "").trim();
    return t ? t : fb;
}

function toInt(v, fb = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
}

export function formatRekapJumlahDataText(j) {
    const leasing = safe(j?.leasing).toUpperCase();
    const source = safe(j?.source, "all");
    const cabangList = Array.isArray(j?.cabang) ? j.cabang : [];
    const totalJumlah = toInt(j?.totalJumlah, 0);

    const notFound = Array.isArray(j?.notFoundCabang) ? j.notFoundCabang : [];
    const notFoundLine = notFound.length
        ? `\n⚠️ Cabang tidak ditemukan: *${notFound.map(safe).map(s => s.toUpperCase()).join(", ")}*`
        : "";

    const header =
        `*REKAP JUMLAH DATA*\n` +
        `Leasing: *${leasing}*\n` +
        `Source: *${source}*\n` +
        `Cabang: ${cabangList.length ? cabangList.map(safe).map(s => s.toUpperCase()).join(", ") : "NASIONAL"}\n` +
        `Total: *${totalJumlah}*` +
        notFoundLine +
        `\n*================*`;

    const rows = Array.isArray(j?.data) ? j.data : [];

    // kalau data kosong, tetap tampilkan notFoundCabang (kalau ada) + info kosong
    if (!rows.length) {
        return (
            `${header}\n` +
            `❗ Tidak ada data rekap untuk cabang yang diminta.`
        ).trim();
    }

    const blocks = rows.map((row) => {
        const cab = safe(row?.cabang).toUpperCase();
        const totalCab = toInt(row?.totalJumlahCabang, 0);

        const items = Array.isArray(row?.items) ? row.items : [];
        // optional: sort kode_bulan desc biar enak dibaca
        items.sort((a, b) => String(b?.kode_bulan || "").localeCompare(String(a?.kode_bulan || "")));

        const lines = items.length
            ? items.map((it) => `• ${safe(it?.kode_bulan)} : ${toInt(it?.jumlah)}`).join("\n")
            : "-";

        return `*${cab}* (Total: *${totalCab}*)\n${lines}`;
    });

    return `${header}\n${blocks.join("\n*----------------*\n")}`.trim();
}
