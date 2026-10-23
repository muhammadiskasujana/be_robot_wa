# Rancangan Backend LLM + Baileys untuk Robot Hunter

## 1. Tujuan

Membuat **Robot Hunter baru yang mandiri** dan terhubung langsung ke **Baileys Gateway**. Backend menerima pesan WhatsApp, menentukan apakah pesan merupakan command atau percakapan biasa, memanggil API LLM buatan sendiri, lalu mengirim respons melalui gateway Baileys yang sama.

Backend ini hanya mendukung **Baileys**. Tidak perlu membawa abstraksi atau konfigurasi Green API dari proyek Robot Hunter saat ini.

Target utama:

- menjawab chat biasa menggunakan LLM;
- menjalankan command yang dibuat langsung di backend baru;
- menyimpan konteks percakapan per pengguna/grup;
- mendukung balasan teks dan dokumen;
- aman terhadap webhook duplikat dan pengiriman ganda;
- dapat mengatur model, prompt, tools, limit, dan akses dari backend;
- mudah dikembangkan sebagai service baru tanpa mengganggu Robot Hunter yang sedang berjalan.

## 2. Prinsip desain

1. **Baileys hanya sebagai transport WhatsApp.** Logika LLM dan command berada di backend baru.
2. **Command tidak diputuskan oleh LLM.** Gunakan parser eksplisit/allowlist agar tindakan bisnis tidak terjadi karena halusinasi model.
3. **LLM boleh memakai tools yang diizinkan.** Tool harus memiliki schema input, validasi akses, timeout, audit, dan idempotency key.
4. **Simpan pesan sebelum memberi ACK.** Gateway boleh retry jika backend gagal menyimpan pesan.
5. **Proses pesan secara asynchronous.** Endpoint webhook harus cepat; proses LLM dan command dikerjakan worker.
6. **Urutan dijaga per chat.** Dua pesan dari chat yang sama tidak boleh diproses terbalik, tetapi chat berbeda boleh diproses paralel.
7. **Balasan idempoten.** Retry worker tidak boleh menghasilkan balasan WhatsApp yang sama dua kali.
8. **Pisahkan session command/LLM dari session notifikasi** jika masih ada worker notifikasi lain.

## 3. Arsitektur yang disarankan

```text
Pengguna WhatsApp
       │
       ▼
Baileys Gateway
       │ callback webhook
       ▼
LLM Backend API
       │ simpan event + ACK
       ▼
PostgreSQL ──► Redis/BullMQ ──► Inbound Worker
                                      │
                         ┌────────────┴────────────┐
                         ▼                         ▼
                  Command Router              LLM Router
                         │                         │
                  Command Handlers         API LLM Anda
                         │                  + Tools/RAG
                         └────────────┬────────────┘
                                      ▼
                                Outbox Worker
                                      │
                                      ▼
                               Baileys Gateway
                                      │
                                      ▼
                              Balasan WhatsApp
```

Komponen minimum:

- **API server**: menerima webhook dan menyediakan endpoint admin.
- **PostgreSQL**: pesan, percakapan, konfigurasi model, audit, dan outbox.
- **Redis + BullMQ**: antrean inbound/outbound dan lock per chat.
- **Inbound worker**: routing command atau LLM.
- **Outbox worker**: mengirim balasan ke Baileys secara berurutan.
- **LLM API adapter**: menembak endpoint model yang Anda buat dan menormalisasi responsnya.
- **Command handlers**: menjalankan command lokal yang memang dibutuhkan Robot Hunter baru.

Untuk MVP satu server, API dan worker boleh berada dalam satu repository tetapi tetap dijalankan sebagai proses berbeda.

## 4. Alur pesan masuk

1. Baileys mengirim callback ke `POST /webhooks/baileys`.
2. Backend memvalidasi secret, tenant, dan session.
3. Backend menormalisasi payload dan membuat `event_key` unik:

   ```text
   baileys:{session_id}:{idMessage}
   ```

4. Event disimpan menggunakan unique constraint.
5. Backend segera membalas HTTP `200`:

   ```json
   {
     "ok": true,
     "accepted": true,
     "duplicate": false,
     "event_id": "01J..."
   }
   ```

6. Dispatcher memasukkan event ke queue berdasarkan hash `chat_id`.
7. Worker mengambil lock/antrean per `chat_id` agar urutan pesan terjaga.
8. Pesan dari akun bot sendiri, broadcast/status, atau tipe yang belum didukung diabaikan secara tercatat.
9. Router menentukan jalur command atau LLM.
10. Hasil dimasukkan ke outbox, bukan langsung dikirim dari handler.
11. Outbox worker mengirim ke Baileys menggunakan `request_id` unik dan menyimpan `idMessage` hasil pengiriman.

## 5. Kontrak webhook Baileys

Endpoint:

```http
POST /webhooks/baileys
Content-Type: application/json
X-Webhook-Secret: <shared-secret>
```

Payload minimum yang kompatibel dengan pola Robot Hunter saat ini:

```json
{
  "session_id": "uuid-session-llm",
  "tenant": "robot-hunter-llm",
  "webhook": {
    "typeWebhook": "incomingMessageReceived",
    "idMessage": "3EB0ABC123",
    "timestamp": 1792720800,
    "senderData": {
      "chatId": "120363000000000000@g.us",
      "sender": "628123456789@c.us",
      "chatName": "Group Hunter"
    },
    "messageData": {
      "typeMessage": "textMessage",
      "textMessageData": {
        "textMessage": "cek nopol DA1234BB"
      }
    }
  }
}
```

Validasi wajib:

- `X-Webhook-Secret` dibandingkan secara timing-safe;
- `session_id` harus sama dengan session yang diizinkan;
- `tenant` harus sama dengan tenant backend;
- `idMessage`, `chatId`, dan `sender` wajib ada untuk pesan masuk;
- ukuran body dibatasi;
- timestamp terlalu lama dapat ditolak atau ditandai sebagai delayed;
- webhook duplikat harus mendapat HTTP `200`, tetapi tidak diproses ulang.

Status delivery dapat diterima melalui endpoint yang sama dan disimpan sebagai event `direction = status`.

## 6. Kontrak kirim ke Baileys

Backend memanggil gateway:

```http
POST {BAILEYS_GATEWAY_URL}/api/external/whatsapp/command/send
Authorization: Bearer <gateway-token>
X-Tenant: robot-hunter-llm
Content-Type: application/json
```

Balasan teks:

```json
{
  "session_id": "uuid-session-llm",
  "request_id": "outbox-01J...",
  "kind": "text",
  "to": "120363000000000000@g.us",
  "message": "Data ditemukan.",
  "quoted_message_id": "3EB0ABC123",
  "mentions": []
}
```

Balasan dokumen:

```json
{
  "session_id": "uuid-session-llm",
  "request_id": "outbox-01J...",
  "kind": "document",
  "to": "628123456789@c.us",
  "base64": "<base64-file>",
  "filename": "report.xlsx",
  "mimetype": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "caption": "Report berhasil dibuat."
}
```

Ketentuan:

- `request_id` harus unik dan stabil untuk satu record outbox;
- gateway harus mengembalikan `idMessage` dan melakukan deduplikasi `request_id`;
- retry otomatis hanya dilakukan jika gateway memastikan pesan **belum terkirim**, misalnya `SESSION_NOT_CONNECTED`;
- timeout setelah request dikirim dianggap `unknown`, bukan langsung dikirim ulang;
- beri jeda antarpengiriman untuk mengurangi risiko rate limit atau urutan terbalik.

## 7. Routing command dan chat LLM

Urutan keputusan yang disarankan:

```text
pesan masuk
  ├─ callback interaktif aktif? ──► lanjutkan flow pending
  ├─ cocok parser command? ───────► Command Router
  ├─ grup tidak mengizinkan AI? ─► abaikan / kirim petunjuk
  ├─ grup: bot disebut/reply? ────► LLM Router
  ├─ private chat? ───────────────► LLM Router
  └─ lainnya ─────────────────────► abaikan
```

Aturan awal yang aman:

- private chat terdaftar: semua pesan teks masuk ke LLM, kecuali command;
- grup: LLM hanya menjawab jika bot di-mention, pesannya me-reply bot, atau memakai prefix seperti `ai `;
- command backend baru dapat dipakai tanpa prefix `/`; daftar dari project lama boleh dijadikan referensi, tetapi implementasinya tetap baru dan independen;
- pesan biasa di grup tidak dikirim ke LLM agar bot tidak membalas semua percakapan;
- allowlist pengguna/grup diperiksa sebelum routing;
- callback angka seperti pilihan cabang atau alasan hapus diperiksa sebelum dianggap chat biasa.

Contoh:

```text
cek nopol DA1234BB       -> command handler lokal
history DA1234BB         -> command handler lokal
ai ringkas percakapan ini -> LLM
@bot apa tugas saya?     -> LLM
```

## 8. Implementasi command di Robot Hunter baru

Command dibuat sebagai modul lokal. Router mencocokkan teks dengan parser eksplisit, memeriksa akses, lalu memanggil handler. Handler mengembalikan **action** dan tidak mengirim WhatsApp secara langsung; semua hasil tetap melewati outbox Baileys.

Contoh kontrak handler:

```ts
type CommandContext = {
  eventId: string;
  sessionId: string;
  chatId: string;
  senderJid: string;
  senderPhone: string;
  messageId: string;
  text: string;
  quotedMessage?: unknown;
};

type OutboundAction =
  | { kind: "text"; to: string; message: string; quotedMessageId?: string }
  | { kind: "document"; to: string; buffer: Buffer; filename: string; mimetype: string; caption?: string };

interface CommandHandler {
  key: string;
  aliases: string[];
  execute(context: CommandContext, args: string[]): Promise<OutboundAction[]>;
}
```

Contoh registry:

```ts
const commands = new Map<string, CommandHandler>([
  ["ping", pingCommand],
  ["help", helpCommand],
  ["reset", resetConversationCommand],
  ["model", modelCommand],
  ["status", statusCommand],
]);
```

Command MVP yang disarankan:

| Command | Akses | Tujuan | Hasil |
|---|---|---|---|
| `ping` | Pengguna aktif | Mengecek bot dan koneksi worker. | Balasan `pong` dan waktu respons. |
| `help` | Pengguna aktif | Menampilkan command yang tersedia. | Daftar command sesuai hak pengguna. |
| `ai <pertanyaan>` | Pengguna aktif | Mengirim pertanyaan eksplisit ke LLM. | Jawaban model melalui Baileys. |
| `reset chat` | Pemilik percakapan/admin grup | Menghapus atau menutup konteks aktif. | Konfirmasi memory percakapan di-reset. |
| `status ai` | Pengguna aktif | Melihat model dan status layanan tanpa menampilkan secret. | Nama model, status, dan mode percakapan. |
| `set model <alias>` | Admin/master | Mengganti model untuk grup/conversation. | Model aktif diperbarui. |
| `aktifkan ai` | Admin/master | Mengaktifkan jawaban LLM di grup. | `llm_enabled = true`. |
| `matikan ai` | Admin/master | Menonaktifkan jawaban LLM di grup. | `llm_enabled = false`. |

Command bisnis seperti `cek nopol`, `history`, laporan, atau pembuatan dokumen dapat ditambahkan satu per satu sebagai handler baru apabila API sumber datanya sudah tersedia. Daftar pada `COMMAND_ROBOT_HUNTER.md` hanya menjadi inspirasi cakupan, bukan dependency runtime.

Aturan penting:

- parser command berjalan sebelum LLM;
- permission diperiksa di kode backend;
- handler write memakai transaction dan idempotency key dari `eventId`;
- tindakan sensitif meminta konfirmasi eksplisit;
- kegagalan handler menghasilkan pesan aman dan audit log;
- model tidak boleh mengarang atau mengeksekusi nama command yang tidak terdaftar.

## 9. LLM Router

LLM Router bertanggung jawab atas:

- memilih model aktif;
- membangun system prompt;
- mengambil riwayat percakapan;
- menerapkan batas token dan panjang konteks;
- menjalankan RAG jika diperlukan;
- menawarkan tools yang diizinkan untuk tenant/grup/pengguna;
- memoderasi input/output jika diperlukan;
- menyimpan usage, latency, status, dan error;
- menghasilkan satu atau beberapa action untuk outbox.

Contoh interface provider:

```ts
interface LlmProvider {
  chat(input: {
    model: string;
    systemPrompt: string;
    messages: ChatMessage[];
    tools?: ToolDefinition[];
    maxOutputTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
  }): Promise<LlmResult>;
}
```

Contoh hasil normalisasi:

```ts
type LlmResult = {
  text: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  finishReason: string;
};
```

### Kontrak HTTP ke API LLM Anda

Backend cukup menembak API model melalui adapter. Kontrak paling sederhana:

```http
POST {LLM_BASE_URL}/v1/chat
Authorization: Bearer <llm-api-key>
Content-Type: application/json
X-Request-Id: llm-run-01J...
```

```json
{
  "model": "robot-hunter-assistant",
  "conversation_id": "01J...",
  "messages": [
    {
      "role": "system",
      "content": "Anda adalah asisten Robot Hunter."
    },
    {
      "role": "user",
      "content": "Tolong jelaskan status pekerjaan saya."
    }
  ],
  "temperature": 0.2,
  "max_output_tokens": 1200,
  "metadata": {
    "channel": "whatsapp",
    "chat_type": "private",
    "sender_phone": "628123456789"
  }
}
```

Respons API LLM:

```json
{
  "id": "generation-01J...",
  "text": "Berikut status pekerjaan Anda...",
  "finish_reason": "stop",
  "usage": {
    "input_tokens": 245,
    "output_tokens": 87
  }
}
```

Jika API LLM Anda sudah kompatibel dengan format OpenAI `/v1/chat/completions` atau `/v1/responses`, adapter cukup mengubah request dan response ke tipe internal `LlmResult`. Kontrak internal backend jangan mengikuti bentuk provider secara langsung agar API model dapat diganti tanpa mengubah routing WhatsApp.

Timeout LLM tidak boleh membuat webhook Baileys menunggu. Webhook sudah di-ACK setelah event tersimpan; jika model lambat, worker dapat mengirim indikator `⏳ Sedang diproses...` lalu mengirim jawaban melalui outbox ketika selesai.

## 10. Tools untuk LLM

Tools adalah fungsi terbatas yang boleh dipanggil LLM. Contoh:

- pencarian knowledge base;
- membaca profil pengguna;
- melihat status command/event;
- mengambil dokumentasi internal;
- membuat tiket bantuan.

Command yang mengubah data, menghapus data, mendebit kredit, mengelola pengguna, atau menghasilkan dokumen tidak boleh otomatis tersedia sebagai tool LLM pada MVP.

Setiap tool wajib memiliki:

- nama dan deskripsi yang jelas;
- JSON Schema untuk input;
- validasi permission di server, bukan di prompt;
- timeout;
- audit log;
- batas hasil;
- idempotency key untuk operasi write;
- opsi konfirmasi pengguna untuk aksi berisiko.

## 11. Konteks dan memori percakapan

Gunakan kunci percakapan berikut:

```text
tenant + session_id + chat_id
```

Di grup, simpan juga `sender_jid` pada setiap message agar model mengetahui siapa yang berbicara.

Strategi konteks:

- ambil 10–30 pesan relevan terakhir;
- jangan memasukkan event status atau payload mentah ke prompt;
- lakukan summarization ketika konteks melewati batas;
- pisahkan memory grup dan private;
- sediakan command/admin action untuk menghapus memory;
- jangan menyimpan secret, token, isi file sensitif, atau data pribadi yang tidak diperlukan;
- tetapkan retention, misalnya pesan mentah 30 hari dan usage/audit 90 hari, sesuai kebutuhan bisnis.

## 12. Data model minimum

### `wa_sessions`

```text
id, tenant_id, session_id, name, is_active,
gateway_url, encrypted_gateway_token, webhook_secret_hash,
created_at, updated_at
```

### `wa_events`

```text
id, event_key UNIQUE, session_id, direction,
chat_id, sender_jid, message_id, event_type,
payload JSONB, status, error, received_at, processed_at
```

Status inbound:

```text
pending -> queued -> processing -> done
                              └-> failed
                              └-> unknown
```

### `conversations`

```text
id, tenant_id, session_id, chat_id UNIQUE,
type, title, llm_enabled, model_config_id,
system_prompt_id, last_message_at, metadata JSONB
```

### `messages`

```text
id, conversation_id, wa_event_id, sender_jid,
role, content, content_type, quoted_message_id,
token_count, created_at
```

### `model_configs`

```text
id, tenant_id, name, provider, model,
encrypted_api_key, base_url, temperature,
max_output_tokens, timeout_ms, is_active, metadata JSONB
```

### `prompt_versions`

```text
id, tenant_id, name, version, system_prompt,
is_active, created_by, created_at
```

### `tool_configs`

```text
id, tenant_id, key, is_enabled,
allowed_scopes, timeout_ms, config JSONB
```

### `llm_runs`

```text
id, conversation_id, inbound_message_id,
model_config_id, prompt_version_id, status,
input_tokens, output_tokens, latency_ms,
tool_calls JSONB, error, started_at, completed_at
```

### `outbox_messages`

```text
id, request_id UNIQUE, source_event_id,
session_id, chat_id, kind, payload JSONB,
status, provider_message_id, attempts,
error, created_at, sent_at
```

## 13. Endpoint backend

### Public/internal gateway

```text
POST /webhooks/baileys
GET  /health
GET  /ready
```

### Admin session dan routing

```text
GET   /api/admin/sessions
POST  /api/admin/sessions
PATCH /api/admin/sessions/:id
GET   /api/admin/conversations
PATCH /api/admin/conversations/:id
POST  /api/admin/conversations/:id/reset-memory
```

### Admin LLM

```text
GET    /api/admin/models
POST   /api/admin/models
PATCH  /api/admin/models/:id
POST   /api/admin/models/:id/test
GET    /api/admin/prompts
POST   /api/admin/prompts
POST   /api/admin/prompts/:id/activate
GET    /api/admin/tools
PATCH  /api/admin/tools/:id
```

### Observability

```text
GET /api/admin/events
GET /api/admin/llm-runs
GET /api/admin/outbox
GET /api/admin/usage
POST /api/admin/outbox/:id/retry
```

Retry manual hanya boleh dilakukan setelah status dan efek pengiriman sebelumnya diperiksa.

## 14. Struktur repository yang disarankan

```text
llm-whatsapp-backend/
├─ src/
│  ├─ app.ts
│  ├─ config/
│  ├─ routes/
│  │  ├─ webhook.routes.ts
│  │  └─ admin.routes.ts
│  ├─ controllers/
│  ├─ services/
│  │  ├─ baileys/
│  │  │  ├─ baileys.client.ts
│  │  │  ├─ webhook.normalizer.ts
│  │  │  └─ outbox.service.ts
│  │  ├─ routing/
│  │  │  ├─ message.router.ts
│  │  │  └─ command.detector.ts
│  │  ├─ llm/
│  │  │  ├─ llm.provider.ts
│  │  │  ├─ llm.orchestrator.ts
│  │  │  ├─ context.service.ts
│  │  │  └─ prompt.service.ts
│  │  ├─ tools/
│  │  └─ commands/
│  │     ├─ command.registry.ts
│  │     ├─ command.parser.ts
│  │     └─ handlers/
│  ├─ workers/
│  │  ├─ inbound.worker.ts
│  │  └─ outbox.worker.ts
│  ├─ queues/
│  ├─ models/
│  └─ middleware/
├─ migrations/
├─ test/
├─ .env.example
├─ Dockerfile
└─ package.json
```

TypeScript disarankan agar schema webhook, tool calls, dan action output lebih mudah dijaga. Express/Fastify, PostgreSQL, Sequelize/Prisma, Redis, dan BullMQ dapat mengikuti stack yang sudah dikenal tim.

## 15. Environment variables

```dotenv
NODE_ENV=production
PORT=3000

DATABASE_URL=postgresql://user:password@postgres:5432/llm_backend
REDIS_URL=redis://redis:6379

BAILEYS_GATEWAY_URL=https://gateway.example.com
BAILEYS_GATEWAY_TOKEN=replace-me
BAILEYS_TENANT=robot-hunter-llm
BAILEYS_SESSION_ID=replace-with-dedicated-session-uuid
BAILEYS_WEBHOOK_SECRET=replace-with-long-random-secret
BAILEYS_SEND_INTERVAL_MS=1000

LLM_PROVIDER=custom
LLM_BASE_URL=https://llm.example.com
LLM_API_KEY=replace-me
LLM_MODEL=robot-hunter-assistant
LLM_TIMEOUT_MS=120000
LLM_MAX_OUTPUT_TOKENS=1200
LLM_MAX_HISTORY_MESSAGES=20

ADMIN_JWT_SECRET=replace-with-long-random-secret
ENCRYPTION_KEY=replace-with-32-byte-key
LOG_LEVEL=info
```

Secret tidak boleh dicetak ke log atau disimpan sebagai plaintext di database. Jika model buatan sendiri tidak membutuhkan API key, variabel terkait dapat dihilangkan.

## 16. Keamanan dan permission

- Gunakan HTTPS untuk gateway dan model server.
- Gunakan token berbeda untuk gateway, model, dan admin.
- Enkripsi credential yang harus disimpan di database.
- Terapkan allowlist session, tenant, grup, dan pengguna.
- Permission command tetap diperiksa Robot Hunter.
- Jangan percaya `sender` atau role admin yang dikirim klien lain tanpa verifikasi.
- Batasi ukuran teks, file, base64, jumlah tool call, dan output LLM.
- Sanitasi nama file dan jangan menerima path dari LLM.
- Hindari memasukkan token, environment, stack trace, atau raw database record ke konteks model.
- Lindungi dari prompt injection: output model tidak pernah menjadi izin untuk melewati policy server.
- Catat siapa menjalankan command/tool, input terstruktur, hasil, durasi, dan biaya/token.
- Sediakan kill switch global dan per conversation untuk LLM.

## 17. Error handling

Gunakan kategori error yang konsisten:

```text
INVALID_WEBHOOK
UNAUTHORIZED_SESSION
DUPLICATE_EVENT
UNSUPPORTED_MESSAGE
USER_NOT_ALLOWED
COMMAND_REJECTED
LLM_TIMEOUT
LLM_PROVIDER_ERROR
TOOL_VALIDATION_ERROR
TOOL_TIMEOUT
SESSION_NOT_CONNECTED
SEND_UNKNOWN
```

Respons WhatsApp sebaiknya ramah dan tidak membocorkan detail internal:

```text
Maaf, saya belum bisa memproses pesan ini. Silakan coba kembali beberapa saat lagi.
Ref: 01J...
```

Detail teknis hanya masuk log/audit berdasarkan reference ID.

## 18. Observability

Metric minimum:

- jumlah webhook diterima dan duplikat;
- panjang antrean serta umur job tertua;
- waktu respons LLM;
- token input/output dan estimasi biaya;
- keberhasilan/gagal tool call;
- keberhasilan/gagal/unknown pengiriman WhatsApp;
- jumlah conversation aktif;
- rate limit per user/grup;
- error berdasarkan model, session, dan tenant.

Gunakan structured logging dengan field `event_id`, `conversation_id`, `llm_run_id`, `outbox_id`, `chat_id_hash`, dan `request_id`. Hindari log isi chat penuh pada production kecuali benar-benar dibutuhkan dan disetujui.

## 19. Tahapan implementasi

### Tahap 1 — Transport Baileys

- webhook terautentikasi;
- normalisasi pesan teks;
- deduplikasi event;
- inbound queue dan outbox;
- kirim teks dengan `request_id` idempoten;
- health/readiness check.

### Tahap 2 — LLM dasar

- adapter model custom;
- konfigurasi model dan prompt;
- private chat dan mention/reply di grup;
- penyimpanan history;
- timeout, limit, dan usage log.

### Tahap 3 — Command lokal

- parser/detector command;
- registry dan handler command di backend baru;
- permission, validasi, dan mapping hasil menjadi outbox action;
- dukungan reply/quote dan flow pending;
- dukungan dokumen.

### Tahap 4 — Tools dan admin

- tool registry dan permission;
- RAG/knowledge base bila dibutuhkan;
- dashboard konfigurasi model/prompt;
- usage, audit, retry, dan kill switch.

### Tahap 5 — Hardening

- load test;
- chaos/restart test;
- backup dan retention;
- alerting;
- secret rotation;
- deployment rolling tanpa mengeksekusi ulang event `processing` secara buta.

## 20. Acceptance criteria MVP

- Webhook yang sama dikirim dua kali hanya menghasilkan satu proses dan satu balasan.
- Dua pesan cepat dalam chat yang sama diproses berurutan.
- Chat berbeda dapat diproses paralel.
- Private chat yang diizinkan mendapat jawaban LLM.
- Grup hanya mendapat jawaban LLM saat bot di-mention, di-reply, atau prefix `ai` digunakan.
- `ping` dan command lokal dapat berjalan tanpa melewati LLM.
- Permission command diperiksa oleh backend baru.
- Restart API tidak menghilangkan pesan yang sudah tersimpan.
- Restart worker memulihkan job queued; event yang terputus saat processing ditandai untuk pemeriksaan.
- Timeout pengiriman tidak menyebabkan pengiriman ulang otomatis yang berisiko duplikat.
- Token dan secret tidak muncul pada log.
- Admin dapat menonaktifkan LLM global atau per conversation.

## 21. Skenario pengujian penting

1. Kirim pesan private biasa dan pastikan jawaban LLM kembali ke chat yang sama.
2. Kirim chat biasa di grup tanpa mention; bot harus diam.
3. Mention bot di grup; bot harus menjawab dengan konteks grup yang benar.
4. Kirim command terdaftar; pastikan pesan masuk ke handler lokal, bukan LLM.
5. Kirim webhook identik dua kali; hanya satu `wa_event`, `llm_run`/command run, dan outbox.
6. Kirim dua pesan dalam satu chat secara cepat; urutan balasan tetap benar.
7. Matikan koneksi Baileys; event outbound tetap tersimpan dan statusnya jelas.
8. Simulasikan timeout setelah gateway menerima request; status menjadi `unknown` dan tidak dikirim ulang otomatis.
9. Uji prompt injection yang meminta model membocorkan secret atau melewati permission; request harus ditolak oleh policy server.
10. Uji model timeout, tool timeout, output kosong, dan output terlalu panjang.
11. Uji reply/quote untuk konfirmasi hapus serta pemilihan cabang.
12. Uji pembuatan dokumen dan pengiriman ke chat pribadi.

## 22. Keputusan awal yang direkomendasikan

- Buat repository/service baru bernama sementara `robot-hunter-llm`.
- Gunakan satu session Baileys khusus untuk backend ini.
- Gunakan PostgreSQL + Redis/BullMQ sejak MVP agar deduplikasi dan recovery jelas.
- Backend baru menjadi pemilik command, permission, transport Baileys, percakapan LLM, prompt, tools, memory, dan outbox.
- API LLM Anda cukup diakses melalui adapter HTTP; backend tidak perlu menyimpan atau menjalankan engine modelnya.
- Semua handler dan hasil LLM mengembalikan action ke outbox agar hanya satu komponen yang mengirim melalui Baileys.
- Mulai dari pesan teks, lalu tambahkan dokumen, image, audio/transkripsi, dan RAG secara bertahap.

Dokumen `COMMAND_ROBOT_HUNTER.md` dapat dipakai sebagai referensi jika sebagian command lama ingin dibuat ulang. Backend baru tidak bergantung pada source code atau database Robot Hunter lama.
