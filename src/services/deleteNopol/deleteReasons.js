export const DELETE_REASONS = [
    "lunas",
    "lelang",
    "sudah ditarik",
    "janji bayar",
    "settle",
    "rollback",
    "back to current",
];

export function getDeleteReasonByNumber(n) {
    const idx = Number(n) - 1;
    return DELETE_REASONS[idx] || null;
}