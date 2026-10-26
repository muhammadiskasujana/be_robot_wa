# Session AI WhatsApp

Jalankan migrasi `npm run migrate:ai` sebelum menguji chat pribadi dan worker `npm run worker:ai` terpisah dari `npm run worker:command`. Perintah migrasi aman dijalankan ulang; kini juga memperbarui constraint policy agar menerima scope `PERSONAL`.

Gateway Baileys menggunakan kontrak command yang sudah ada. Daftarkan session AI tersendiri dengan callback `POST /webhook/gateway/ai` dan header `X-Command-Secret`. Tidak ada perubahan kode gateway. Session ini harus berbeda dari `WA_COMMAND_GATEWAY_SESSION_ID` dan session notifikasi.

Variabel Robot Hunter: `WA_AI_GATEWAY_SESSION_ID`, `WA_AI_GATEWAY_TENANT`, `WA_AI_GATEWAY_WEBHOOK_SECRET`, `WA_AI_GATEWAY_BASE_URL`, `WA_AI_GATEWAY_TOKEN`, `LLM_AGENT_BASE_URL`, `LLM_AGENT_API_KEY`. `LLM_AGENT_API_KEY` harus sama dengan `LOCAL_API_KEY` pada llm-agent.

Perintah grup `aktifkan ai` dan `matikan ai` hanya untuk master. Grup baru menonaktifkan AI secara default. Pertanyaan diawali `smith `; grup tidak menyimpan memori. `izin_group=ADMIN` membatasi penanya ke master/admin grup, diperiksa melalui session AI. Mode `management` memakai seluruh cakupan yang diizinkan policy tenant agent-backend. Mode lain membaca PT, leasing, dan cabang aktif dari database Robot Hunter pada setiap pertanyaan. Cabang `CABANG`/`AREA` dibatasi ke tautan cabang aktif; `HO` mencakup seluruh cabang leasing. Konfigurasi yang kosong atau tidak cocok dengan policy tenant ditutup, bukan diberi akses luas.

Untuk chat pribadi, buat policy `PERSONAL` aktif bagi nomor dan command `ai_chat`, lalu isi `group_id` agar cakupannya mengikuti grup tersebut, atau `leasing_id` untuk cakupan leasing saja. Setiap nomor memakai memori terpisah. Policy tanpa sumber cakupan data tidak menjalankan AI. Pesan tanpa izin diabaikan.

### Uji chat pribadi

1. Temukan UUID command `ai_chat` melalui `GET /admin/credit/commands?q=ai_chat` dan UUID grup melalui `GET /admin/groups` (keduanya memakai token admin Robot Hunter).
2. Buat policy melalui `POST /admin/credit/policies` dengan body `{"scope_type":"PERSONAL","phone_e164":"628xxxxxxxxxx","command_id":"<uuid-ai-chat>","group_id":"<uuid-grup>","is_enabled":true,"billing_mode":"FREE","wallet_scope":"PERSONAL"}`. Nomor memakai format `62` tanpa `+` dan tanpa spasi. Alternatifnya gunakan `leasing_id` sebagai sumber cakupan, tanpa `group_id`.
3. Dari nomor yang didaftarkan, kirim `smith halo` ke nomor WhatsApp session **AI**, bukan session command. Lanjutkan dengan `smith apa yang saya tanyakan tadi?` untuk memeriksa memori pribadi, lalu pertanyaan data yang berada dalam cakupan policy tenant.

Jika pesan tidak dibalas, periksa `wa_command_events` untuk `provider='ai'` dan log `[WA_AI event]`. Pesan tanpa izin atau tanpa cakupan data memang diabaikan oleh worker AI.

Agent-backend menerima `LOCAL_BACKEND_TOKEN` tetap bila `SERVICE_TENANT` menunjuk tenant dalam `TENANT_POLICIES_FILE`. Nilai token minimal 32 karakter dan harus sama dengan `LOCAL_BACKEND_TOKEN` pada llm-agent. Rotasi dilakukan dengan mengganti env di kedua layanan dan restart. Policy tenant menjadi batas maksimum. Untuk mode `management`, masukkan semua PT/leasing yang memang boleh dibaca AI ke policy tenant. Nama PT/leasing di policy harus sama dengan nilai pada database agent-backend dan nama konfigurasi Robot Hunter. `LOCAL_API_KEY` melindungi endpoint llm-agent dari pemanggil lain.
