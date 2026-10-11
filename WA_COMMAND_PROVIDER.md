# Uji coba provider WhatsApp untuk command

Command mempunyai jalur terpisah dari `notifSend.worker.js` dan `tarikanNotifSend.worker.js`. Dua worker tersebut beserta endpoint `/send/text`, antrean, fallback, dan daftar session-nya tetap seperti sebelumnya. `notifyAccess.worker.js` juga tetap memakai Green API seperti sebelumnya.

`WA_COMMAND_PROVIDER` hanya mengatur command di `robot.js`. Default `greenapi`: instance, token, status aktif, dan role BOT tetap dibaca dari `wa_instances`. Mode `baileys` menggunakan satu session gateway dari env; tidak perlu record gateway di `wa_instances`.

## Persiapan

1. Gabungkan konfigurasi `.env.command.example` dengan env robot-hunter yang sudah ada. Jangan mengganti seluruh `.env`. Server dan worker command harus memakai env, PostgreSQL, dan Redis yang sama. Redis dibutuhkan pada kedua mode; gunakan storage persisten Redis/AOF di deployment.
2. Jalankan `npm run migrate:command` satu kali sebelum mengganti server. Script hanya menyiapkan tabel `wa_command_events` dan indeksnya; tidak menjalankan semua migrasi atau mengubah tabel instance. Migration CJS yang sama dapat digunakan oleh runner migrasi proyek. Jangan mengandalkan `sync({alter:true})` untuk deployment produksi.
3. Jalankan server seperti biasanya, dan tambahkan proses khusus `npm run worker:command`. Pada deployment Docker/Coolify yang memakai `START_FILE`, buat service worker tambahan dengan `START_FILE=src/workers/waCommand.worker.js`. Dua service worker notifikasi yang ada tetap berjalan seperti sebelumnya.

## Mode Baileys

1. Buat/pair session command di gateway melalui pengelolaan session yang sudah ada. Konfigurasi env di robot-hunter menunjuk session ini; database session internal gateway tetap diperlukan untuk pairing dan resume. Yang tidak diperlukan adalah pendaftaran instance gateway di database robot-hunter.
2. Gabungkan `gateway/.env.command.example` dengan env gateway. Samakan session UUID, tenant, dan secret kedua project. `ROBOT_HUNTER_COMMAND_SCHEMA` adalah schema asli gateway, misalnya `tenant_gateway`; tenant callback harus sama persis dengan `WA_COMMAND_GATEWAY_TENANT`.
3. `WA_COMMAND_GATEWAY_TOKEN` harus cocok dengan `WHATSAPP_EXTERNAL_TOKEN` gateway. Callback memakai header `X-Command-Secret`, bukan query secret Green API.
4. Gunakan session berbeda dari session notifikasi management dan tarikan. Validator menolak session management yang saat ini hardcoded di `notifSend.worker.js`, serta session pada `TARIKAN_NOTIF_SESSIONS`. Jika deployment worker notifikasi memiliki env terpisah, isi UUID tersebut pada `WA_COMMAND_RESERVED_SESSIONS` di server/worker command juga.
5. Mount `ROBOT_HUNTER_COMMAND_STORE_DIR` ke volume persisten. Direktori ini menyimpan callback yang belum terkirim, konteks quote, dan receipt idempotensi. Gunakan satu proses gateway untuk session command tersebut; jangan menjalankan replica yang berbagi session/auth yang sama.
6. Restart gateway, set `WA_COMMAND_PROVIDER=baileys` di server dan worker command, lalu jalankan keduanya. Session command memakai bridge robot-hunter; handler command lokal gateway tidak dipasang pada session tersebut. Session lain tetap menggunakan handler lama.

## Cara antrean bekerja

- Pesan masuk disimpan di PostgreSQL sebelum ACK. Identitas provider + instance/session + ID pesan mencegah command duplikat. Dispatcher worker menerbitkan job persisten ke BullMQ.
- Chat yang sama selalu masuk shard antrean yang sama. Setiap shard memakai global concurrency 1, termasuk ketika ada beberapa replica worker. Shard berbeda berjalan paralel; grup yang kebetulan masuk shard yang sama saling menunggu. Jangan mengganti jumlah shard ketika antrean masih berisi pekerjaan.
- Green API: tidak dibuat antrean transport persisten kedua. Pengajuan kiriman command menggunakan mutex FIFO Redis per instance, lalu masuk antrean Green API. Sukses API berarti diterima provider, belum tentu delivered.
- Baileys: semua kiriman command, termasuk private result dan PDF, masuk `wa_command_baileys_out`. Global concurrency 1 dan jeda antarkiriman menjaga urutan. Dua worker notifikasi tidak memakai antrean ini.
- Command menunggu hasil pengiriman agar ID pesan tersedia untuk alur reply. Worker masuk dan keluar terpisah sehingga menunggu hasil tidak mengunci antrean keluar.
- Pending cabang/konfirmasi hapus menggunakan Redis TTL. Pending JSON lama tidak dimigrasikan; selesaikan percakapan yang sedang berjalan sebelum deployment.
- Token download report beserta isi file, dan link sementara cabang, menggunakan Redis TTL lima menit. Server dan worker harus memakai `REDIS_URL` yang sama (termasuk database Redis). Tidak perlu shared volume `/tmp/wa_files`. Link yang dibuat oleh versi lama perlu dibuat ulang setelah deployment karena token sebelumnya hanya ada di memori proses pembuat.
- Receipt gateway mencegah request pengiriman dengan ID yang sama terkirim ulang. Hanya kegagalan pasti sebelum send (`SESSION_NOT_CONNECTED`) yang retry otomatis, maksimal tiga percobaan dalam job yang sama. Timeout ambigu dan command yang terputus ditandai `unknown`, tidak menjalankan ulang command atau debit. Ini sengaja tidak mengklaim exactly-once untuk API eksternal.
- Debit command memiliki referensi `WA_COMMAND_EVENT` dan pemeriksaan idempotensi di bawah lock wallet. Billing worker notifikasi tetap menggunakan referensi seperti sebelumnya.
- Nomor dengan device suffix dinormalisasi; LID harus dipetakan ke nomor asli. LID yang belum berhasil dipetakan disimpan untuk audit dan tidak diberi akses berdasarkan digit LID.
- Callback hanya meneruskan pesan baru (`notify`), bukan history (`append`) atau pesan dari diri sendiri. Seluruh batch diproses. Callback yang gagal dikirim disimpan di disk dan dicoba ulang sesuai urutan.

## Skenario uji

Jalankan `npm test` di robot-hunter dan `node --test test/commandBridge.test.js` di gateway untuk tes offline. Tes ini tidak menghubungi WhatsApp, PostgreSQL, atau Redis asli.

Kemudian uji pada environment percobaan dengan PostgreSQL, Redis, dan session WhatsApp:

1. Green API: `ping`, cek nopol/history, command admin, pilihan cabang via reply, konfirmasi hapus, dan cetak PDF. Pastikan instance tetap dari database dan ada worker command aktif.
2. Baileys: ulangi skenario yang sama. Pastikan nomor sender, admin grup, ID kutipan, pesan personal, dan PDF sesuai.
3. Kirim dua command cepat di grup yang sama; command kedua harus menunggu command pertama. Uji dua grup yang masuk shard berbeda untuk melihat proses paralel.
4. Kirim webhook identik dua kali; hanya satu record command dan satu eksekusi/debit. Kirim ulang request `/command/send` dengan `request_id` sama; hasil ID sama tanpa send baru.
5. Putus session sebelum send; tiga percobaan tetap mendahului pesan berikutnya. Simulasikan timeout setelah send; status `unknown` harus muncul, tanpa fallback ke session notifikasi.
6. Restart worker saat job antre; pending/queued dipulihkan. Restart saat command sedang melakukan aksi; periksa status `unknown` dan efek di API tujuan sebelum replay apa pun.
7. Pastikan notifikasi management dan input tarikan tetap dikirim dari session dan worker masing-masing pada kedua mode command.
8. Kirim callback dari session/tenant salah atau tanpa secret: harus ditolak. Callback dari provider nonaktif tidak boleh menjalankan command.

Untuk memeriksa antrean:

```sql
SELECT id, direction, provider, instance_key, chat_id, status, error, created_at
FROM wa_command_events
ORDER BY id DESC LIMIT 100;

SELECT direction, status, count(*)
FROM wa_command_events
GROUP BY direction, status;
```

Status `done` berarti handler command selesai; tidak berarti setiap aksi bisnis berhasil. Pesan yang dilaporkan gagal oleh handler tetap perlu dilihat. `sent` berarti gateway mengembalikan ID WhatsApp. Status delivery terpisah berada pada event `direction='status'`. Admin message logs juga membaca event gateway ketika provider command Baileys aktif.

## Berpindah provider

Hentikan sumber pesan baru, tunggu semua `pending`, `queued`, dan `processing` selesai, lalu periksa `unknown`. Pastikan antrean Green API juga sudah selesai bila meninggalkan Green API. Ubah env pada server dan worker command, restart keduanya, lalu aktifkan sumber pesan baru. Kedua worker notifikasi tidak perlu ikut berganti provider. Job menyimpan provider/session asal dan tidak dialihkan otomatis.

Jangan replay command `unknown` tanpa memeriksa debit, perubahan data di API eksternal, dan receipt gateway. Simpan volume gateway serta audit PostgreSQL saat restart. Receipt/context quote bertambah seiring penggunaan; siapkan retensi setelah periode deduplikasi/quote yang dibutuhkan, dan jangan menghapus receipt yang masih terkait job aktif.
