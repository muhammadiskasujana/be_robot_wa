function formatRupiah(n) {
    const x = Number(String(n ?? "").replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(x)) return String(n ?? "-");
    return x.toLocaleString("id-ID");
}

function safeStr(v, fallback = "-") {
    const s = String(v ?? "").trim();
    return s ? s : fallback;
}

function bold(v, fallback = "-") {
    const s = safeStr(v, fallback);
    return `*${s}*`;
}

export function buildManagementMessage(p = {}) {
    const type = String(p.event_key || p.event_type || p.type || "").trim().toUpperCase();

    // field umum
    const namaUser = safeStr(p.nama_user);
    const hpUser = safeStr(p.no_hp_user || p.hp_user || p.phone_user);
    const namaAdmin = safeStr(p.nama_admin);
    const wilayah = safeStr(p.wilayah, "-");
    const tanggal = safeStr(p.tanggal || p.tanggal_aktivasi || p.tanggal_registrasi);

    // activation specific
    const hari = Number(p.jumlah_hari_aktivasi || p.hari_aktivasi || 0);
    const kuota = p.jumlah_kuota_akses_data == null ? null : Number(p.jumlah_kuota_akses_data);
    const harga = formatRupiah(p.harga);

    // event-specific extras
    const alasan = safeStr(p.alasan, "-");
    const durasiSuspend = Number(p.durasi_suspend_hari || p.suspend_hari || 0);
    const sumber = safeStr(p.sumber, "-");

    switch (type) {
        case "AKTIVASI":
        case "AKTIVASI_AKUN":
        case "MANAGEMENT_AKTIVASI": {
            const lines = [];
            lines.push(`*AKTIVASI HUNTER*`);
            lines.push(`Admin : ${bold(namaAdmin)}`);
            lines.push(`User : ${bold(namaUser)}`);
            lines.push(`HP User : ${hpUser}`);
            lines.push(`Wilayah : ${wilayah}`);
            lines.push(`Aktivasi : ${bold(`${hari} hari`)}`);
            if (Number.isFinite(kuota)) lines.push(`Kuota : ${bold(String(kuota))}`);
            lines.push(`Tanggal : ${tanggal}`);
            lines.push(`Biaya : Rp. ${harga}`);
            lines.push(`*Aktivasi berhasil, masa aktif : ${hari} hari 0 jam 0 menit*`);
            return lines.join("\n");
        }

        case "REGISTRASI": {
            const lines = [];
            lines.push(`*REGISTRASI HUNTER*`);
            lines.push(`User : ${bold(namaUser)}`);
            lines.push(`HP User : ${hpUser}`);
            lines.push(`Wilayah : ${wilayah}`);
            lines.push(`Tanggal Registrasi : ${tanggal}`);
            lines.push(`Sumber : ${sumber}`);
            lines.push(`*User berhasil terdaftar*`);
            return lines.join("\n");
        }

        case "MATIKAN_AKUN": {
            const lines = [];
            lines.push(`*MATIKAN AKUN HUNTER*`);
            lines.push(`Admin : ${bold(namaAdmin)}`);
            lines.push(`User : ${bold(namaUser)}`);
            lines.push(`HP User : ${hpUser}`);
            lines.push(`Wilayah : ${wilayah}`);
            lines.push(`Alasan : ${alasan}`);
            lines.push(`Tanggal : ${tanggal}`);
            lines.push(`*Akun berhasil dimatikan*`);
            return lines.join("\n");
        }

        case "SUSPEND_AKUN": {
            const lines = [];
            lines.push(`*SUSPEND AKUN HUNTER*`);
            lines.push(`Admin : ${bold(namaAdmin)}`);
            lines.push(`User : ${bold(namaUser)}`);
            lines.push(`HP User : ${hpUser}`);
            lines.push(`Wilayah : ${wilayah}`);
            lines.push(`Durasi Suspend : ${bold(`${durasiSuspend} hari`)}`);
            lines.push(`Alasan : ${alasan}`);
            lines.push(`Tanggal : ${tanggal}`);
            lines.push(`*Akun disuspend sementara*`);
            return lines.join("\n");
        }

        case "HAPUS_AKUN": {
            const lines = [];
            lines.push(`*HAPUS AKUN HUNTER*`);
            lines.push(`Admin : ${bold(namaAdmin)}`);
            lines.push(`User : ${bold(namaUser)}`);
            lines.push(`HP User : ${hpUser}`);
            lines.push(`Wilayah : ${wilayah}`);
            lines.push(`Alasan : ${alasan}`);
            lines.push(`Tanggal : ${tanggal}`);
            lines.push(`*Akun telah dihapus permanen*`);
            return lines.join("\n");
        }

        default: {
            // fallback universal biar tidak blank kalau event baru muncul
            const lines = [];
            lines.push(`*MANAGEMENT EVENT*`);
            lines.push(`Type : ${bold(type || "-")}`);
            if (namaAdmin !== "-") lines.push(`Admin : ${bold(namaAdmin)}`);
            if (namaUser !== "-") lines.push(`User : ${bold(namaUser)}`);
            if (hpUser !== "-") lines.push(`HP User : ${hpUser}`);
            lines.push(`Wilayah : ${wilayah}`);
            if (tanggal !== "-") lines.push(`Tanggal : ${tanggal}`);
            return lines.join("\n");
        }
    }
}
