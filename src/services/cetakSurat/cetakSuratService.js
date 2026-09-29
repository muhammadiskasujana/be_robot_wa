import axios from "axios";
import Sequelize from "sequelize";
import { WaCommand, WaCommandPolicy } from "../../models/index.js";

const { Op } = Sequelize;
const COMMAND_KEY = "cetak_surat";
const DOCUMENT_TYPES = new Set(["bastk", "penugasan", "kuasa", "paket"]);
const BUNDLE_LETTER_TYPES = new Set(["penugasan", "kuasa"]);
const VEHICLE_TYPES = new Set(["R2", "R4"]);

function clean(value) {
    return String(value ?? "").trim();
}

function normalizePhone(value) {
    const digits = clean(value).replace(/[^\d]/g, "");
    if (!digits) return "";
    return digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
}

function normalizePlate(value) {
    return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function safeFilename(value, fallback) {
    const name = clean(value).replace(/[\r\n]/g, "").replace(/[^\w.\-]+/g, "_");
    return name || fallback;
}

function filenameFromDisposition(value) {
    const header = clean(value);
    const utf = header.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf?.[1]) {
        try { return decodeURIComponent(utf[1]); } catch {}
    }
    return header.match(/filename="?([^";]+)"?/i)?.[1] || "";
}

function readJsonError(buffer) {
    try {
        const parsed = JSON.parse(Buffer.from(buffer || "").toString("utf8"));
        return { message: clean(parsed?.error || parsed?.message), code: clean(parsed?.code) };
    } catch {
        return { message: "", code: "" };
    }
}

function policyBranch(meta) {
    const value = meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {};
    const legacyCabang = Array.isArray(value.cabang) ? value.cabang[0] : value.cabang;
    return {
        code: clean(value.branch_code || value.cabang_code),
        name: clean(value.branch_name || value.cabang_name || legacyCabang),
    };
}

export async function resolveCetakSuratPersonalPolicy({ phoneE164, group }) {
    const phone = normalizePhone(phoneE164);
    if (!phone || !group?.id) return null;

    const command = await WaCommand.findOne({
        where: { key: COMMAND_KEY, is_active: true },
        attributes: ["id"],
    });
    if (!command) return null;

    const and = [{ group_id: group.id }];
    if (group.leasing_id) {
        and.push({ [Op.or]: [{ leasing_id: null }, { leasing_id: group.leasing_id }] });
    }

    const policy = await WaCommandPolicy.findOne({
        where: {
            scope_type: "PERSONAL",
            phone_e164: phone,
            command_id: command.id,
            is_enabled: true,
            [Op.and]: and,
        },
        attributes: ["id", "group_id", "leasing_id", "phone_e164", "meta"],
        order: [["created_at", "ASC"]],
    });

    if (!policy) return null;
    return { ...policy.toJSON(), branch: policyBranch(policy.meta) };
}

export async function generateWhatsAppDocument({
    documentType, bundleLetterType, vehicleType, tenant, matelPhone, nopol,
    requestedByPhone, requestedByName, leasing, branch,
}) {
    const document_type = clean(documentType).toLowerCase();
    const bundle_letter_type = clean(bundleLetterType || "penugasan").toLowerCase() === "tugas"
        ? "penugasan"
        : clean(bundleLetterType || "penugasan").toLowerCase();
    const vehicle_type = clean(vehicleType).toUpperCase();
    const tenantCode = clean(tenant).toLowerCase();
    const matel_phone = normalizePhone(matelPhone);
    const plate = normalizePlate(nopol);

    if (!DOCUMENT_TYPES.has(document_type)) throw new Error("Jenis dokumen harus bastk, penugasan, kuasa, atau paket.");
    if (document_type === "paket" && !BUNDLE_LETTER_TYPES.has(bundle_letter_type)) {
        throw new Error("Jenis surat paket harus tugas/penugasan atau kuasa.");
    }
    if (!VEHICLE_TYPES.has(vehicle_type)) throw new Error("Jenis kendaraan harus R2 atau R4.");
    if (!tenantCode) throw new Error("Slug tenant wajib diisi.");
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(tenantCode)) throw new Error("Slug tenant tidak valid.");
    if (!matel_phone) throw new Error("Nomor HP matel tidak valid.");
    if (!plate) throw new Error("Nopol tidak valid.");

    const baseUrl = clean(process.env.CETAK_SURAT_API_BASE || "https://api-pt.digitalmanager.id").replace(/\/$/, "");
    const token = clean(process.env.CETAK_SURAT_EXTERNAL_TOKEN || process.env.EXTERNAL_TENANT_TOKEN);
    if (!token) throw new Error("CETAK_SURAT_EXTERNAL_TOKEN belum diset.");

    const requestMetadata = {
        leasing_code: clean(leasing?.code).toUpperCase() || null,
        leasing_name: clean(leasing?.name).toUpperCase() || null,
        branch_code: clean(branch?.code).toUpperCase() || null,
        branch_name: clean(branch?.name).toUpperCase() || null,
    };

    const response = await axios.post(
        `${baseUrl}/api/tarikan-documents-external/whatsapp/generate`,
        {
            document_type,
            ...(document_type === "paket" ? { bundle_letter_type } : {}),
            vehicle_type,
            tenant: tenantCode,
            matel_phone,
            nopol: plate,
            requested_by_phone: normalizePhone(requestedByPhone) || matel_phone,
            requested_by_name: clean(requestedByName) || "BOT WHATSAPP",
            request_metadata: requestMetadata,
        },
        {
            headers: {
                "X-External-Token": token,
                "X-Tenant": tenantCode,
                "Content-Type": "application/json",
            },
            responseType: "arraybuffer",
            timeout: 120000,
            validateStatus: () => true,
        }
    );

    if (response.status < 200 || response.status >= 300) {
        const apiError = readJsonError(response.data);
        const suffix = apiError.code ? ` (${apiError.code})` : "";
        throw new Error(`${apiError.message || `API cetak surat gagal, HTTP ${response.status}`}${suffix}`);
    }

    const buffer = Buffer.from(response.data || "");
    if (!buffer.length) throw new Error("API cetak surat mengembalikan file kosong.");

    const fallback = `${document_type}-${tenantCode}-${plate}-${vehicle_type}.pdf`;
    return {
        buffer,
        filename: safeFilename(filenameFromDisposition(response.headers?.["content-disposition"]), fallback),
        contentType: clean(response.headers?.["content-type"]) || "application/pdf",
        documentId: clean(response.headers?.["x-document-id"]),
        documentNumber: clean(response.headers?.["x-document-number"]),
        documentCount: clean(response.headers?.["x-document-count"]),
        assignmentBasis: clean(response.headers?.["x-assignment-basis"]),
        financeIdentitySource: clean(response.headers?.["x-finance-identity-source"]),
        bundleLetterType: document_type === "paket" ? bundle_letter_type : "",
        requestMetadata,
    };
}
