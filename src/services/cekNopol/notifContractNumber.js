import { cekNopolFromApi } from "./newhunterCekNopol.js";

function leasingCode(value) {
    return String(value || "").trim().toUpperCase().split(/\s+/)[0];
}

function plate(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Default SJM; gunakan CSV NOTIF_CONTRACT_LEASINGS=SJM,FIF untuk menambah leasing.
export async function lookupNotifContractNumber(
    payload,
    { leasingCodes = process.env.NOTIF_CONTRACT_LEASINGS ?? "SJM", lookup = cekNopolFromApi } = {}
) {
    const expectedLeasing = leasingCode(payload?.leasing_code || payload?.leasing);
    const enabled = new Set(String(leasingCodes).split(",").map(leasingCode).filter(Boolean));
    if (!enabled.has(expectedLeasing) || !plate(payload?.nopol)) return "";

    try {
        const result = await lookup(payload.nopol, { timeoutMs: 5000 });
        if (!result?.ok || leasingCode(result.leasing_code || result.leasing) !== expectedLeasing) return "";
        if (plate(result.nopol) !== plate(payload.nopol)) return "";
        const number = String(result.raw?.nokontrak ?? "").trim();
        return number && number !== "-" ? number : "";
    } catch (error) {
        console.warn("[NOTIF_SENDER] nomor kontrak tidak tersedia:", error?.message || error);
        return "";
    }
}
