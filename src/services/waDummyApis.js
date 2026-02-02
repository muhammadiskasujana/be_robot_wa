// services/waDummyApis.js
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function dummyCekNopol(nopol) {
    await sleep(150);
    return {
        ok: true,
        nopol,
        status: "DUMMY_OK",
        kendaraan: { merk: "TOYOTA", tipe: "AVANZA", tahun: 2020 },
        catatan: "Dummy response (belum connect API).",
    };
}

export async function dummyHistory(nopol) {
    await sleep(150);
    return {
        ok: true,
        nopol,
        items: [
            { at: new Date(Date.now() - 86400000).toISOString(), action: "CEK", by: "bot" },
            { at: new Date(Date.now() - 3600000).toISOString(), action: "CEK", by: "bot" },
        ],
        catatan: "Dummy history (belum connect API).",
    };
}

export async function dummyRequestLokasi(phone62) {
    await sleep(150);
    return {
        ok: true,
        phone: phone62,
        status: "REQUEST_SENT",
        catatan: "Dummy request lokasi (nanti dihubungkan API provider).",
    };
}
