export function parsePagination(query) {
    const limit = Math.min(Math.max(Number(query.limit || 20), 1), 200);
    const page = Math.max(Number(query.page || 1), 1);
    const offset = (page - 1) * limit;
    return { limit, page, offset };
}

export function buildMeta({ page, limit, total }) {
    const totalPages = Math.max(Math.ceil(total / limit), 1);
    return { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 };
}
