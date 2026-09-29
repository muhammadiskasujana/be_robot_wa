# API Notifikasi Input Tarikan

Dokumen ini menjelaskan cara Website PT atau modul `tarikan-matel` mengirim notifikasi input tarikan ke Robot WhatsApp.

API hanya memasukkan event ke antrean. Proses pencarian grup tujuan dan pengiriman WhatsApp dilakukan secara asynchronous oleh worker.

## Endpoint

```http
POST /api/notify/tarikan
Authorization: Bearer <NOTIFY_API_TOKEN>
Content-Type: application/json
```

Contoh URL production:

```text
https://hook.digitalmanager.id/api/notify/tarikan
```

Token pada header `Authorization` harus sama dengan environment `NOTIFY_API_TOKEN` pada Robot WhatsApp.

Jika `NOTIFY_API_TOKEN` belum dikonfigurasi pada robot, endpoint akan menolak request.

## Kapan API Dipanggil

Panggil endpoint setelah record tarikan berhasil disimpan ke database Website PT atau `tarikan-matel`.

Jangan memanggil endpoint sebelum transaksi database berhasil karena notifikasi dapat terkirim untuk record yang akhirnya gagal disimpan.

Alur yang disarankan:

```text
Validasi input
    ↓
Simpan tarikan ke database
    ↓
Commit transaksi database
    ↓
Hit API notifikasi
    ↓
Catat hasil enqueue untuk observability
```

Kegagalan mengirim notifikasi tidak disarankan membatalkan record tarikan yang sudah berhasil disimpan. Simpan error dan lakukan retry dengan `event_id` yang sama.

## Payload

Contoh payload lengkap:

```json
{
  "event_id": "3e154d9d-a16a-43a6-932e-f654df64798f",
  "source": "WEBSITE_PT",
  "input_at": "2026-09-28T10:30:00+08:00",
  "input_by": "628123456789",
  "input_by_name": "ADMIN HSN",

  "tenant": "hsn",
  "pt": "PT HUNTER SOLUTION NETWORK",

  "leasing": "FIFGROUP",
  "leasing_code": "FIF",
  "cabang": "BANJARMASIN",

  "nopol": "DA1234AB",
  "nosin": "ABC123",
  "noka": "MH123456",
  "tipe": "HONDA BEAT",
  "tahun": "2022",
  "warna": "HITAM",

  "nama_debitur": "NAMA DEBITUR",
  "no_kontrak": "123456789",
  "ovd": "90 HARI",
  "keterangan": "Input tarikan baru"
}
```

## Daftar Field

| Field           | Wajib      | Keterangan                                                                      |
| --------------- | ---------- | ------------------------------------------------------------------------------- |
| `event_id`      | Ya         | ID unik dan stabil untuk event. Disarankan memakai UUID/ID record tarikan.      |
| `source`        | Tidak      | Sumber input, misalnya `WEBSITE_PT` atau `TARIKAN_MATEL`. Default `WEBSITE_PT`. |
| `input_at`      | Tidak      | Waktu input dalam format ISO 8601. Default waktu server robot.                  |
| `input_by`      | Tidak      | Nomor HP atau ID user yang melakukan input.                                     |
| `input_by_name` | Tidak      | Nama user/admin yang melakukan input.                                           |
| `tenant`        | Disarankan | Slug tenant Website PT; wajib agar cocok jika grup memakai filter tenant.       |
| `pt`            | Tidak      | Nama PT untuk ditampilkan pada pesan.                                           |
| `leasing`       | Tidak      | Nama leasing untuk tampilan, misalnya `FIFGROUP`.                               |
| `leasing_code`  | Disarankan | Kode leasing yang dipakai untuk filter grup, misalnya `FIF`.                    |
| `cabang`        | Tidak      | Nama atau kode cabang.                                                          |
| `nopol`         | Ya         | Nomor polisi kendaraan.                                                         |
| `nosin`         | Tidak      | Nomor mesin kendaraan.                                                          |
| `noka`          | Tidak      | Nomor rangka kendaraan.                                                         |
| `tipe`          | Tidak      | Tipe kendaraan.                                                                 |
| `tahun`         | Tidak      | Tahun kendaraan.                                                                |
| `warna`         | Tidak      | Warna kendaraan.                                                                |
| `nama_debitur`  | Tidak      | Nama debitur.                                                                   |
| `no_kontrak`    | Tidak      | Nomor kontrak/perjanjian.                                                       |
| `ovd`           | Tidak      | Informasi overdue, boleh berupa angka atau teks.                                |
| `keterangan`    | Tidak      | Catatan tambahan.                                                               |

Field yang kosong tidak ditampilkan dalam pesan WhatsApp.

## Alias Field yang Didukung

Untuk memudahkan integrasi dengan payload lama, API juga menerima alias berikut:

| Field utama     | Alias                           |
| --------------- | ------------------------------- |
| `event_id`      | `tarikan_id`, `id`              |
| `input_at`      | `created_at`, `tanggal_input`   |
| `input_by`      | `created_by_phone`, `no_hp`     |
| `input_by_name` | `created_by_name`, `created_by` |
| `tenant`        | `tenant_slug`                   |
| `pt`            | `nama_pt`                       |
| `leasing`       | `nama_leasing`                  |
| `leasing_code`  | `kode_leasing`                  |
| `cabang`        | `branch`                        |
| `nopol`         | `nomor_polisi`                  |
| `nosin`         | `nomor_mesin`                   |
| `noka`          | `nomor_rangka`                  |
| `tipe`          | `tipe_kendaraan`                |
| `nama_debitur`  | `debitur`                       |
| `no_kontrak`    | `nomor_kontrak`                 |
| `keterangan`    | `catatan`                       |

## Normalisasi Data

Robot melakukan normalisasi berikut:

- `nopol` diubah menjadi huruf besar dan karakter selain huruf/angka dihapus.
- `leasing_code`, `leasing`, `cabang`, `pt`, `tipe`, dan `warna` diubah menjadi huruf besar.
- `tenant` diubah menjadi huruf kecil.
- Nama leasing seperti `ADIRA WO` dinormalisasi menjadi kode `ADIRA-WO` jika `leasing_code` tidak dikirim.

Walaupun tersedia fallback, Website PT tetap disarankan mengirim `leasing_code` secara eksplisit agar filter grup akurat.

## Contoh cURL

```bash
curl --location 'https://domain-robot.example.com/api/notify/tarikan' \
  --header 'Authorization: Bearer YOUR_NOTIFY_API_TOKEN' \
  --header 'Content-Type: application/json' \
  --data '{
    "event_id": "3e154d9d-a16a-43a6-932e-f654df64798f",
    "source": "WEBSITE_PT",
    "input_at": "2026-09-28T10:30:00+08:00",
    "input_by_name": "ADMIN HSN",
    "tenant": "hsn",
    "pt": "PT HUNTER SOLUTION NETWORK",
    "leasing": "FIFGROUP",
    "leasing_code": "FIF",
    "cabang": "BANJARMASIN",
    "nopol": "DA1234AB",
    "tipe": "HONDA BEAT",
    "nama_debitur": "NAMA DEBITUR",
    "no_kontrak": "123456789",
    "ovd": "90 HARI"
  }'
```

## Contoh Axios

```js
import axios from "axios";

export async function sendTarikanNotification(tarikan) {
  const url = `${process.env.ROBOT_API_BASE_URL}/api/notify/tarikan`;

  const payload = {
    event_id: tarikan.uuid,
    source: "WEBSITE_PT",
    input_at: tarikan.created_at,
    input_by: tarikan.created_by_phone,
    input_by_name: tarikan.created_by_name,
    tenant: tarikan.tenant_slug,
    pt: tarikan.pt_name,
    leasing: tarikan.leasing_name,
    leasing_code: tarikan.leasing_code,
    cabang: tarikan.branch_name,
    nopol: tarikan.nopol,
    nosin: tarikan.nosin,
    noka: tarikan.noka,
    tipe: tarikan.tipe,
    tahun: tarikan.tahun,
    warna: tarikan.warna,
    nama_debitur: tarikan.nama_debitur,
    no_kontrak: tarikan.no_kontrak,
    ovd: tarikan.ovd,
    keterangan: tarikan.keterangan,
  };

  const response = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${process.env.ROBOT_NOTIFY_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    timeout: 10000,
  });

  return response.data;
}
```

Environment Website PT:

```env
ROBOT_API_BASE_URL=https://domain-robot.example.com
ROBOT_NOTIFY_API_TOKEN=token-yang-sama-dengan-NOTIFY_API_TOKEN-robot
```

## Contoh Integrasi Setelah Create

```js
const tarikan = await Tarikan.create(input, { transaction });
await transaction.commit();

try {
  await sendTarikanNotification(tarikan);
} catch (error) {
  console.error("NOTIFIKASI_TARIKAN_GAGAL", {
    tarikan_id: tarikan.uuid,
    status: error.response?.status,
    response: error.response?.data,
    message: error.message,
  });
}
```

Untuk sistem dengan trafik tinggi, disarankan menggunakan outbox/retry job pada Website PT supaya kegagalan jaringan tidak menyebabkan event hilang.

## Response Berhasil

HTTP `200`:

```json
{
  "ok": true,
  "queued": true,
  "jobId": "tarikan_..."
}
```

Response ini berarti event berhasil masuk antrean. Response ini belum menjamin pesan sudah sampai ke WhatsApp.

## Response Duplikat

HTTP `200`:

```json
{
  "ok": true,
  "queued": false,
  "skipped": true,
  "reason": "duplicate_event"
}
```

Robot melakukan deduplikasi berdasarkan `event_id` selama 24 jam. Retry dengan `event_id` yang sama tidak membuat notifikasi ganda.

Karena itu, jangan membuat `event_id` baru setiap kali melakukan retry untuk record tarikan yang sama.

## Error Autentikasi

HTTP `401`:

```json
{
  "ok": false,
  "error": "invalid notify token"
}
```

Periksa nilai `Authorization` dan pastikan token sama dengan `NOTIFY_API_TOKEN` pada Robot WhatsApp.

## Error Validasi

HTTP `400`:

```json
{
  "ok": false,
  "error": "event_id/tarikan_id wajib, nopol wajib"
}
```

Request tidak dimasukkan ke antrean sebelum validasi berhasil.

## Error Server

HTTP `500`:

```json
{
  "ok": false,
  "error": "Internal Server Error"
}
```

Website PT dapat melakukan retry dengan `event_id` yang sama. Gunakan exponential backoff dan batasi jumlah percobaan.

Contoh jadwal retry:

```text
Percobaan 1: langsung
Percobaan 2: 5 detik
Percobaan 3: 30 detik
Percobaan 4: 2 menit
Percobaan 5: 10 menit
```

## Penentuan Grup Tujuan

Website PT tidak perlu mengirim ID grup WhatsApp. Robot menentukan target berdasarkan konfigurasi grup.

Grup menerima notifikasi apabila:

1. Mode grup adalah `management`.
2. Robot grup aktif.
3. Notifikasi grup aktif.
4. Target management mengandung `INPUT_TARIKAN`.
5. `leasing_code` sesuai dengan filter grup, atau grup memakai filter `ALL`.
6. `tenant` sesuai dengan filter tenant grup, atau grup memakai semua tenant.

Konfigurasi dilakukan dari WhatsApp oleh master:

```text
set mode management
start group
set input tarikan all
```

Atau untuk leasing tertentu:

```text
set input tarikan leasing FIF, BFI, ADIRA WO
```

Untuk menerima semua leasing tetapi hanya dari Website PT dengan slug tertentu:

```text
set input tarikan tenant hsn
```

Untuk membatasi leasing dan tenant sekaligus:

```text
set input tarikan leasing FIF, BFI tenant hsn
```

Beberapa tenant dapat dipisahkan dengan koma:

```text
set input tarikan all tenant hsn, pt-bintang
```

Filter leasing dan tenant digabung dengan aturan `AND`. Contohnya, konfigurasi
`leasing FIF tenant hsn` hanya menerima data dengan `leasing_code` `FIF` dan
`tenant` `hsn`. Konfigurasi lama yang tidak menyebut tenant tetap menerima data
dari semua tenant.

Jika grup memakai filter tenant tetapi payload tidak membawa `tenant`, grup
tersebut tidak menerima notifikasi. Gunakan slug yang sama dengan slug Website
PT; pencocokan tidak membedakan huruf besar dan kecil.

## Catatan Keamanan

- Jangan menaruh `ROBOT_NOTIFY_API_TOKEN` pada frontend/browser.
- Request harus dikirim dari backend Website PT.
- Jangan mencatat token pada log.
- Gunakan HTTPS untuk URL Robot API.
- Gunakan `event_id` dari record database, bukan nilai acak baru pada setiap retry.
