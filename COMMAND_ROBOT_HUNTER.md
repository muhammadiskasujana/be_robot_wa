# Daftar Command Robot Hunter

Dokumen ini merangkum command WhatsApp yang dikenali oleh Robot Hunter berdasarkan implementasi saat ini. Semua command ditulis **tanpa karakter `/`**, tidak peka huruf besar/kecil, dan umumnya dijalankan di grup yang sudah terdaftar.

## Ketentuan umum

- Pengirim harus masuk whitelist. Di chat pribadi, selain `ping`, pesan biasa hanya dibalas sebagai pesan uji.
- `help`, `aktifkan robot`, dan `matikan robot` tetap dapat diproses ketika robot grup sedang mati.
- **Master** berarti nomor yang terdaftar sebagai master sistem.
- Command bertanda **fitur/policy** hanya berjalan jika fitur grup aktif. Sebagian command juga melakukan pemeriksaan langganan/saldo dan dapat mendebit kredit.
- Jika `izin_group` diset ke `ADMIN`, command umum yang dijaga izin hanya dapat dipakai admin grup atau master.
- Beberapa command membutuhkan mode, leasing, PT, cabang, provider eksternal, atau environment server yang sudah dikonfigurasi.
- Link file/gambar sementara yang dihasilkan bot berlaku sekitar **5 menit**.

## 1. Command dasar dan pengaturan grup

| Command dan variasi | Akses/prasyarat | Tujuan | Hasil yang diharapkan |
|---|---|---|---|
| `help` | Semua pengguna terdaftar | Menampilkan bantuan singkat bawaan bot. | Bot mengirim beberapa command dasar dan contoh penggunaannya. |
| `fitur-robot` | Robot aktif | Membuka katalog fitur lengkap. | Bot mengirim tautan halaman informasi Robot Digital Manager. |
| `ping` | Semua pengguna terdaftar | Memeriksa apakah bot merespons. | Balasan `pong ✅`. |
| `aktifkan robot` | Master | Mengaktifkan bot pada grup. | Status grup aktif dan muncul konfirmasi berhasil. |
| `matikan robot` | Master | Mematikan bot pada grup. | Status grup nonaktif; command biasa selanjutnya diabaikan. |
| `set izin umum` | Master | Mengizinkan command umum dipakai semua anggota. | `izin_group` menjadi `UMUM`. |
| `set izin admin` | Master | Membatasi command umum untuk admin grup/master. | `izin_group` menjadi `ADMIN`. |
| `set mode leasing` | Master | Mengubah grup ke mode leasing. | Konfirmasi mode leasing. |
| `set mode input data` atau `set mode input_data` | Master | Mengubah grup ke mode input data. | Konfirmasi mode input data. |
| `set mode pt` | Master | Mengubah grup ke mode PT. | Konfirmasi mode PT. |
| `set mode korlap` | Master | Mengubah grup ke mode koordinator lapangan. | Grup menerima notifikasi berdasarkan daftar matel. |
| `set mode management`, `set mode manage`, atau `set mode mgmt` | Master | Mengubah grup ke mode management. | Konfirmasi mode management. |
| `set mode gateway` | Master | Mengubah grup ke mode gateway. | Konfirmasi mode gateway; alias `cek <nopol>` menjadi tersedia. |
| `start group` | Master | Mengaktifkan notifikasi data untuk grup. | Konfirmasi notifikasi aktif. |
| `stop group` | Master | Menonaktifkan notifikasi data untuk grup. | Konfirmasi notifikasi mati. |

## 2. Konfigurasi leasing, cabang, PT, dan filter

| Command dan variasi | Akses/prasyarat | Tujuan | Hasil yang diharapkan |
|---|---|---|---|
| `set leasing <kode>` | Master | Mengaitkan grup ke leasing, misalnya `set leasing ADIRA`. | Leasing ditemukan/dibuat lalu disimpan pada grup. |
| `unset leasing` | Master | Melepas leasing dari grup. | Leasing, level, dan cabang grup di-reset. |
| `tambah cabang <nama/kode>` | Master; leasing sudah diset | Menambah cakupan cabang. Bisa dipisah koma atau ditulis per baris. | Cabang ditambahkan dan level grup otomatis diperbarui. |
| `tambah cabang nasional` | Master; leasing sudah diset | Mengatur cakupan semua cabang/HO. | Cakupan menjadi `ALL (HO)`. |
| `hapus cabang <nama/kode>` | Master | Menghapus satu atau beberapa cabang; mendukung koma/multiline. | Jumlah yang dihapus, level, dan sisa cabang ditampilkan. |
| `list cabang` | Leasing sudah diset | Melihat konfigurasi leasing, level, dan cabang grup. | Daftar cabang atau status nasional ditampilkan. |
| `set pt <kode/nama PT>` | Master | Mengaitkan grup ke perusahaan/PT. Bisa juga multiline setelah `set pt`. | PT ditemukan/dibuat lalu disimpan. |
| `unset pt` atau `hapus pt` | Master | Melepas PT dari grup. | PT grup dihapus. |
| `set filter only <daftar>` | Master; mode PT/leasing | Hanya menerima notifikasi dari daftar leasing/PT. Daftar dapat dipisah koma atau multiline. | Filter `ONLY` tersimpan dan ringkasannya ditampilkan. |
| `set filter except <daftar>` | Master; mode PT/leasing | Menerima semua kecuali daftar leasing/PT. | Filter `EXCEPT` tersimpan dan ringkasannya ditampilkan. |
| `reset filter` atau `hapus filter` | Master; mode PT/leasing | Menghapus filter notifikasi. | Grup kembali menerima semua leasing/PT sesuai mode. |

Contoh multiline:

```text
tambah cabang
banjarmasin
jakarta
```

## 3. Konfigurasi matel dan management

| Command dan variasi | Akses/prasyarat | Tujuan | Hasil yang diharapkan |
|---|---|---|---|
| `tambah matel <nomor> [nama]` | Master | Menambah matel ke grup korlap. Mendukung beberapa nomor dipisah koma atau multiline. | Ringkasan data berhasil, duplikat, dan data gagal. |
| `hapus matel <nomor>` | Master | Menghapus matel; mendukung koma atau multiline. | Ringkasan nomor yang berhasil/tidak ditemukan. |
| `list matel` | Grup korlap | Melihat matel aktif pada grup. | Daftar matel ditampilkan; daftar panjang dapat diberikan sebagai file/link. |
| `set target <target>` | Master; mode management | Menentukan jenis notifikasi management. Mendukung koma, spasi, atau multiline. | Daftar target yang berhasil diset ditampilkan. |
| `unset target` | Master; mode management | Menghapus seluruh target management. | Grup berhenti menerima notifikasi management. |
| `set input tarikan all` | Master; mode management | Mengaktifkan seluruh notifikasi input tarikan. | Status aktif dengan filter `ALL`. |
| `set input tarikan leasing FIF, BFI` | Master; mode management | Memfilter input tarikan berdasarkan leasing. | Status aktif dan detail filter leasing. |
| `set input tarikan tenant hsn` | Master; mode management | Memfilter berdasarkan tenant. | Status aktif dan detail tenant. |
| `set input tarikan leasing FIF, BFI tenant hsn` | Master; mode management | Menggabungkan filter leasing dan tenant. | Status aktif dan detail kedua filter. |
| `status input tarikan` | Mode management disarankan | Melihat status dan filter input tarikan. | Status aktif/nonaktif beserta detail filter. |
| `unset input tarikan` atau `hapus input tarikan` | Master; mode management | Mematikan input tarikan tanpa mengubah target lain. | Konfirmasi bahwa notifikasi input tarikan dinonaktifkan. |

Nilai target management yang valid mengikuti konfigurasi aplikasi/server. Jika target tidak dikenal, bot akan mengirim pesan kesalahan.

## 4. Data kendaraan dan pengguna

| Command dan variasi | Akses/prasyarat | Tujuan | Hasil yang diharapkan |
|---|---|---|---|
| `cek nopol <nopol>` | Fitur aktif; policy/saldo mencukupi | Mencari data kendaraan berdasarkan nopol. | Ringkasan di grup dan detail dikirim ke chat pribadi pengirim. |
| `cek <nopol>` | Khusus mode gateway | Bentuk singkat dari `cek nopol`. | Hasil sama seperti `cek nopol`. |
| `history <nopol>` | Fitur aktif; policy/saldo mencukupi | Mencari riwayat kendaraan. | Riwayat ditemukan dan hasil/detail dikirim oleh bot. |
| `request lokasi <nomor HP atau nama>` | Fitur aktif; policy/saldo mencukupi | Meminta lokasi terbaru pengguna/matel. | Ringkasan di grup dan detail lokasi dikirim ke chat pribadi. |
| `input data motor` atau `input data r2` | Fitur aktif | Memulai input data kendaraan roda dua. | Bot mengirim template R2 untuk disalin, diisi, dan dikirim kembali. |
| `input data mobil` atau `input data r4` | Fitur aktif | Memulai input data kendaraan roda empat. | Bot mengirim template R4 untuk disalin, diisi, dan dikirim kembali. |
| Kirim kembali template input yang telah diisi | Mode leasing/input data; field wajib lengkap | Menyimpan data kendaraan tanpa command tambahan. | Data divalidasi, diproses, lalu bot mengirim status berhasil/gagal. |
| `hapus nopol <nopol>` | Fitur aktif; mode leasing/input data | Memulai penghapusan satu/beberapa nopol. Di mode input data, leasing perlu dicantumkan sesuai petunjuk bot. | Bot mengecek data lalu mengirim daftar alasan penghapusan untuk dikonfirmasi lewat reply. |
| Reply/quote notifikasi kendaraan lalu kirim `hapus` | Fitur aktif; mode leasing/input data | Mengambil nopol dan leasing dari pesan yang di-quote. | Bot meminta konfirmasi alasan penghapusan. |
| Reply/quote permintaan alasan lalu kirim nomor alasan, misalnya `1` | Ada proses hapus yang masih aktif | Menyelesaikan penghapusan. | Ringkasan nopol yang berhasil dan gagal dihapus. |
| `delete user <nomor HP>` | Master | Menghapus akun pengguna leasing. | Proses penghapusan dijalankan dan nomor yang dihapus dikonfirmasi. |

## 5. Akun dan anggota PT

| Command dan variasi | Akses/prasyarat | Tujuan | Hasil yang diharapkan |
|---|---|---|---|
| `buat akun`, `daftar akun`, atau `register akun` | Fitur aktif; leasing grup sudah diset | Memulai pendaftaran akun web leasing. | Bot mengirim template `INPUT DATA LOGIN` dan petunjuk pengisian. |
| Kirim template `INPUT DATA LOGIN` yang sudah diisi | Leasing grup valid | Mendaftarkan akun. Jabatan `1` menangani nasional, `2` beberapa cabang, `3` satu cabang; Kelola Bahan `1` R2, `2` R4, `3` MIX. | Jabatan nasional langsung diproses; jabatan 2/3 menerima menu cabang. |
| Reply/quote menu cabang lalu kirim `1` atau `1,3,7` | Ada proses registrasi aktif (TTL sekitar 5 menit) | Memilih cabang untuk akun baru. Jabatan 3 hanya boleh satu pilihan. | Akun didaftarkan dan ringkasan nama, cabang, handling, serta role ditampilkan. |
| `list anggota` | Mode PT; PT sudah diset | Menampilkan seluruh anggota PT. | Daftar anggota dikirim bertahap. |
| `list anggota aktif` atau `list anggota active` | Mode PT; PT sudah diset | Menampilkan anggota aktif. | Daftar anggota aktif dikirim bertahap. |
| `list anggota nonaktif`, `list anggota non active`, atau `list anggota inactive` | Mode PT; PT sudah diset | Menampilkan anggota nonaktif. | Daftar anggota nonaktif dikirim bertahap. |

## 6. Laporan, rekap, dan statistik

| Command dan variasi | Akses/prasyarat | Tujuan | Hasil yang diharapkan |
|---|---|---|---|
| `tarik report <periode>` | Fitur aktif; leasing grup sudah diset | Membuat report akses Excel. Contoh: `tarik report juli 2025`, `tarik report 11 juli 2025`, `tarik report hari ini`. | Link unduh Excel beserta leasing, cabang, dan periode. |
| `report pengguna` | Master; mode management | Membuat report seluruh pengguna. | Link unduh Excel report pengguna. |
| `rekap jumlah data` | Fitur aktif; leasing grup sudah diset | Merekap jumlah data sesuai cakupan grup. | Hasil teks untuk cakupan kecil; Excel untuk nasional atau lebih dari 20 cabang. |
| `get statistik` | Fitur aktif; leasing grup sudah diset | Statistik default. | Link gambar PNG statistik. |
| `get statistik 2026` | Sama | Statistik satu tahun. | PNG sesuai tahun. |
| `get statistik februari 2026` | Sama | Statistik satu bulan. | PNG sesuai bulan. |
| `get statistik 2 februari 2026` | Sama | Statistik satu tanggal. | PNG sesuai tanggal. |
| `get statistik hari ini` atau `get statistik minggu ini` | Sama | Statistik periode relatif. | PNG sesuai periode. |
| `get statistik 2 februari 2026 to 6 februari 2026` | Sama | Statistik rentang tanggal. | PNG sesuai rentang. |
| `get statistik cabang banjarmasin hari ini` | Sama | Mengganti cakupan cabang hanya untuk permintaan ini. | PNG untuk cabang dan periode tersebut. |

## 7. Pembuatan dokumen

| Command dan variasi | Akses/prasyarat | Tujuan | Hasil yang diharapkan |
|---|---|---|---|
| `hispay <nopol/noka/nosin/no kontrak>` | Leasing grup aktif; fitur/policy dokumen tersedia | Membuat kartu piutang berdasarkan satu identitas kendaraan/kontrak. Nopol dengan spasi didukung, misalnya `hispay DA 4321 BB`. | Dokumen dikirim langsung ke chat pribadi dan grup menerima konfirmasi. |
| `cetak penugasan <R2/R4> <tenant> <HP matel> <nopol>` | Leasing grup aktif | Membuat PDF surat penugasan. | PDF dan metadata dokumen dikirim ke chat pribadi. |
| `cetak kuasa <R2/R4> <tenant> <HP matel> <nopol>` | Leasing grup aktif | Membuat PDF surat kuasa. | PDF dikirim ke chat pribadi. |
| `cetak bastk <R2/R4> <tenant> <HP matel> <nopol>` | Leasing grup aktif | Membuat PDF BASTK. | PDF dikirim ke chat pribadi. |
| `cetak paket <R2/R4> <tenant> <HP matel> <nopol>` | Leasing grup aktif | Membuat paket dokumen dengan tipe surat default. | Paket PDF dikirim ke chat pribadi. |
| `cetak paket tugas ...`, `cetak paket penugasan ...`, atau `cetak paket kuasa ...` | Leasing grup aktif | Membuat paket dengan tipe surat yang dipilih. | Paket PDF dan nomor dokumen (jika ada) dikirim ke chat pribadi. |

Contoh:

```text
cetak paket kuasa R4 hsn 085212345678 DA4321BB
hispay 740010058091
```

## 8. File SFTP dan VPN

| Command dan variasi | Akses/prasyarat | Tujuan | Hasil yang diharapkan |
|---|---|---|---|
| `list file <dir>` | SFTP server terkonfigurasi | Menampilkan maksimal 20 file terbaru pada direktori, misalnya `list file front`. Nama direktori juga bisa ditulis di baris berikutnya. | Nama, ukuran, waktu modifikasi, serta petunjuk mengambil file. |
| `get file <dir> <nama file>` | SFTP dan URL publik terkonfigurasi | Mengambil file `.xlsx`; nama file boleh mengandung spasi atau ditulis di baris berikutnya. | Link unduh sementara. |
| `connect vpn` atau `vpn up` | Host memiliki konfigurasi/IPsec yang diperlukan | Menghubungkan VPN `myvpn`. | Status sukses beserta output sistem, atau detail kegagalan. |
| `vpn status` atau `status vpn` | Konfigurasi VPN tersedia | Memeriksa koneksi VPN. | `ESTABLISHED (CONNECTED)` atau `NOT CONNECTED`. |

## Respons gagal yang umum

Robot dapat menolak command dengan respons seperti berikut:

- nomor belum di-whitelist;
- hanya master/admin yang boleh menjalankan command;
- robot grup sedang mati;
- mode grup tidak sesuai;
- leasing, PT, cabang, atau fitur belum diset;
- format/argumen command tidak valid;
- fitur dinonaktifkan atau subscription/policy tidak tersedia;
- kredit tidak cukup;
- data tidak ditemukan;
- API, SFTP, VPN, provider WhatsApp, atau konfigurasi environment sedang bermasalah.

## Catatan pemeliharaan

Sumber utama daftar ini adalah parser `src/services/parser.js` dan handler `src/services/robot.js`. Perbarui dokumen ini setiap kali command, alias, permission, mode, atau bentuk respons pada kedua file tersebut berubah.
