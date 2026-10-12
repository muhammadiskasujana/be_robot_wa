# Kartu piutang

Command dari grup WhatsApp: `cetak hispay {nopol/noka/nosin/nokontrak}`.

Contoh: `cetak hispay 740010058091` atau `cetak hispay DA4321BB`. Nopol dengan spasi, seperti `cetak hispay DA 4321 BB`, juga diterima.

Persiapan mengikuti cetak surat kuasa: leasing grup wajib diset dan aktif, cabang aktif dari grup digunakan bila tersedia. Dokumen dikirim langsung ke chat pribadi pengirim melalui transport WhatsApp yang sedang digunakan (Green API atau gateway Baileys).

Service melakukan GET ke `https://api-piutang.digitalmanager.id/schedule/{identifier}` dan mengunggah response biner sebagai dokumen. Response gagal, JSON, HTML, atau file kosong menghasilkan pesan kegagalan. Tidak memerlukan tenant atau token cetak surat.

Opsional: set `KARTU_PIUTANG_API_BASE` untuk mengganti base URL.

Saat deployment, jalankan migration `20261012_000001_add_cetak_hispay_command.cjs` melalui Sequelize CLI proyek, lalu restart proses bot/worker. Migration mendaftarkan `cetak_hispay` dengan scope GROUP dan pengaturan yang sama seperti `cetak_surat`.
