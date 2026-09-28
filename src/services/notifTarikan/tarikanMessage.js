function text(value) {
    return String(value ?? "").trim();
}

function bold(value) {
    const valueText = text(value);
    return valueText ? `*${valueText}*` : "";
}

function line(lines, label, value) {
    const formatted = bold(value);
    if (formatted) lines.push(`${label}: ${formatted}`);
}

function formatDate(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return text(value);
    return new Intl.DateTimeFormat("id-ID", {
        timeZone: "Asia/Makassar",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(date).replace(".", ":") + " WITA";
}

export function buildTarikanInputMessage(payload = {}) {
    const lines = ["🚘 *INPUT TARIKAN BARU*", ""];

    line(lines, "Sumber", payload.source);
    line(lines, "Tenant", payload.tenant);
    line(lines, "PT", payload.pt);
    line(lines, "Leasing", [payload.leasing, payload.leasing_code ? `(${payload.leasing_code})` : ""].filter(Boolean).join(" "));
    line(lines, "Cabang", payload.cabang);

    lines.push("");
    line(lines, "Nopol", payload.nopol);
    line(lines, "Tipe", payload.tipe);
    line(lines, "Tahun", payload.tahun);
    line(lines, "Warna", payload.warna);
    line(lines, "No. Rangka", payload.noka);
    line(lines, "No. Mesin", payload.nosin);

    if (payload.nama_debitur || payload.no_kontrak || payload.ovd) lines.push("");
    line(lines, "Debitur", payload.nama_debitur);
    line(lines, "No. Kontrak", payload.no_kontrak);
    line(lines, "OVD", payload.ovd);

    lines.push("");
    line(lines, "Diinput oleh", payload.input_by_name || payload.input_by);
    line(lines, "Waktu", formatDate(payload.input_at));
    line(lines, "Keterangan", payload.keterangan);

    return lines.filter((value, index, values) => value !== "" || values[index - 1] !== "").join("\n").trim();
}
