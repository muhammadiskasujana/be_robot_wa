# Konfigurasi Bawa untuk Robot Hunter

Robot command dan Smith AI menerima pesan melalui `POST /webhook/bawa` pada backend ini. Keduanya mengirim balasan lewat API Bawa. Dua worker notifikasi hanya memakai API kirim pesan, sehingga tidak memerlukan webhook.

## Variabel env

Isi variabel berikut pada service yang bersangkutan. Gunakan token dan instance sesuai service; jangan menyalin token ke kode atau repository.

```dotenv
# Backend API dan worker command
WA_COMMAND_PROVIDER=bawa
WA_COMMAND_BAWA_BASE_URL=https://api-gateway.intelixstudio.tech
WA_COMMAND_BAWA_INSTANCE_ID=<instance-command>
WA_COMMAND_BAWA_TOKEN=<token-command>
WA_COMMAND_BAWA_WEBHOOK_SECRET=<secret-webhook-command>

# Backend API dan worker Smith AI
WA_AI_PROVIDER=bawa
WA_AI_BAWA_BASE_URL=https://api-gateway.intelixstudio.tech
WA_AI_BAWA_INSTANCE_ID=<instance-smith>
WA_AI_BAWA_TOKEN=<token-smith>
WA_AI_BAWA_WEBHOOK_SECRET=<secret-webhook-smith>
LLM_AGENT_BASE_URL=<url-llm-yang-sudah-dipakai>
LLM_AGENT_API_KEY=<kunci-llm-yang-sudah-dipakai>

# Hanya worker notifSend.worker.js
NOTIF_BAWA_BASE_URL=https://api-gateway.intelixstudio.tech
NOTIF_BAWA_INSTANCE_ID=<instance-notif>
NOTIF_BAWA_TOKEN=<token-notif>

# Hanya worker tarikanNotifSend.worker.js
TARIKAN_NOTIF_BAWA_BASE_URL=https://api-gateway.intelixstudio.tech
TARIKAN_NOTIF_BAWA_INSTANCE_ID=<instance-tarikan-notif>
TARIKAN_NOTIF_BAWA_TOKEN=<token-tarikan-notif>
```

`*_BASE_URL` boleh dihilangkan jika memakai URL Bawa di atas. Instance command, Smith AI, dan notifikasi harus berbeda agar pesan masuk tidak diproses oleh service yang salah. Kedua worker notifikasi boleh memakai instance yang sama jika memang dikehendaki, tetapi kredensial env tetap terpisah.

## Pengaturan webhook di Bawa

Atur webhook instance command dan instance Smith AI ke `https://<domain-backend>/webhook/bawa`. Secret setiap webhook harus sama dengan env `*_WEBHOOK_SECRET` milik instancenya. Endpoint memverifikasi header `X-Bawa-Signature` terhadap body mentah dan hanya menerima pesan teks dari pengguna. Bawa dapat mengirim ulang webhook; event disimpan dengan ID pesan agar tidak diproses dua kali.

## Pengiriman dan perpindahan

Command memakai antrean `wa_command_bawa_out`; Smith AI mengirim jawaban dan dokumen lewat Bawa. Kedua worker notifikasi memakai `request_id` yang tetap per job untuk mengurangi pengiriman ganda saat retry. Pesan ke grup menggunakan JID `@g.us`; pesan pribadi dikirim sebagai nomor telepon.

Saat mengganti gateway, isi env di setiap proses terkait, atur webhook, lalu restart backend API dan seluruh worker terkait. Pastikan antrean outbound gateway lama sudah selesai sebelum mematikan worker lama. Tes satu command, satu pertanyaan Smith AI, satu notifikasi akses, dan satu notifikasi tarikan pada instance yang telah dipasangkan. Variabel lama `WA_EXT_*`, `NOTIF_SESSIONS`, dan `TARIKAN_NOTIF_SESSIONS` tidak dipakai lagi oleh kedua worker notifikasi.

Rujukan API: [Dokumentasi Bawa](https://bawa.intelixstudio.tech/docs).
