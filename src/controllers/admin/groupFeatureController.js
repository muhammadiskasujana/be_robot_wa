import { WaGroupFeature, WaGroup } from "../../models/index.js";
import { CacheInvalidate } from "../../services/cacheService.js";

function toInt(v, def = 0) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : def;
}

function buildMeta({ q = "", page = 1, limit = 20, total = 0 }) {
    const totalPages = Math.max(1, Math.ceil(total / limit));
    return {
        q,
        page,
        limit,
        total,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
    };
}

/**
 * GET /admin/group-features?group_id=&feature_key=&is_enabled=&page=&limit=
 */
export async function listFeatures(req, res) {
    try {
        const page = Math.max(toInt(req.query.page, 1), 1);
        const limit = Math.min(Math.max(toInt(req.query.limit, 20), 1), 200);
        const offset = (page - 1) * limit;

        const group_id = req.query.group_id || null;
        const feature_key = req.query.feature_key || null;
        const is_enabled = req.query.is_enabled
            ? req.query.is_enabled === "true"
            : null;

        const where = {};
        if (group_id) where.group_id = group_id;
        if (feature_key) where.feature_key = feature_key;
        if (is_enabled !== null) where.is_enabled = is_enabled;

        const { rows, count } = await WaGroupFeature.findAndCountAll({
            where,
            include: [
                {
                    model: WaGroup,
                    as: "group",
                    attributes: ["id", "chat_id", "title"],
                },
            ],
            order: [["group_id", "ASC"], ["feature_key", "ASC"]],
            limit,
            offset,
            distinct: true,
        });

        res.json({
            ok: true,
            data: rows,
            meta: buildMeta({ page, limit, total: count }),
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
}

/**
 * POST /admin/group-features/:groupId/:featureKey
 */
export async function createOrUpdateFeature(req, res) {
    try {
        const { groupId, featureKey } = req.params;
        const { is_enabled, message_mode, disabled_message } = req.body;

        if (!groupId || !featureKey) {
            return res
                .status(400)
                .json({ ok: false, error: "groupId dan featureKey wajib" });
        }

        const [feature, created] = await WaGroupFeature.findOrCreate({
            where: { group_id: groupId, feature_key: featureKey },
            defaults: {
                group_id: groupId,
                feature_key: featureKey,
                is_enabled: is_enabled !== false,
                message_mode: message_mode || "DEFAULT",
                disabled_message: disabled_message || null,
            },
        });

        if (!created) {
            feature.is_enabled = is_enabled !== false;
            feature.message_mode = message_mode || "DEFAULT";
            feature.disabled_message = disabled_message || null;
            await feature.save();
        }

        // ✅ INVALIDATE CACHE
        CacheInvalidate.featureStatus(groupId, featureKey);

        res.json({
            ok: true,
            message: `✅ Feature ${featureKey} berhasil ${created ? "ditambahkan" : "diupdate"}`,
            feature,
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
}

/**
 * POST /admin/group-features/:groupId/enable
 */
export async function enableFeature(req, res) {
    try {
        const { groupId } = req.params;
        const { featureKey } = req.body;

        if (!groupId || !featureKey) {
            return res.status(400).json({ ok: false, error: "featureKey wajib" });
        }

        const feature = await WaGroupFeature.findOne({
            where: { group_id: groupId, feature_key: featureKey },
        });

        if (!feature) {
            return res.status(404).json({ ok: false, error: "Feature tidak ditemukan" });
        }

        feature.is_enabled = true;
        await feature.save();

        // ✅ INVALIDATE CACHE
        CacheInvalidate.featureStatus(groupId, featureKey);

        res.json({
            ok: true,
            message: `✅ Fitur ${featureKey} diaktifkan`,
            feature,
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
}

/**
 * POST /admin/group-features/:groupId/disable
 */
export async function disableFeature(req, res) {
    try {
        const { groupId } = req.params;
        const { featureKey } = req.body;

        if (!groupId || !featureKey) {
            return res.status(400).json({ ok: false, error: "featureKey wajib" });
        }

        const feature = await WaGroupFeature.findOne({
            where: { group_id: groupId, feature_key: featureKey },
        });

        if (!feature) {
            return res.status(404).json({ ok: false, error: "Feature tidak ditemukan" });
        }

        feature.is_enabled = false;
        await feature.save();

        // ✅ INVALIDATE CACHE
        CacheInvalidate.featureStatus(groupId, featureKey);

        res.json({
            ok: true,
            message: `⛔ Fitur ${featureKey} dinonaktifkan`,
            feature,
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
}

/**
 * PUT /admin/group-features/:groupId/:featureKey
 */
export async function updateFeature(req, res) {
    try {
        const { groupId, featureKey } = req.params;
        const { is_enabled, message_mode, disabled_message } = req.body;

        const feature = await WaGroupFeature.findOne({
            where: { group_id: groupId, feature_key: featureKey },
        });

        if (!feature) {
            return res.status(404).json({ ok: false, error: "Feature tidak ditemukan" });
        }

        feature.is_enabled = is_enabled !== false;
        feature.message_mode = message_mode || "DEFAULT";
        feature.disabled_message = disabled_message || null;
        await feature.save();

        // ✅ INVALIDATE CACHE
        CacheInvalidate.featureStatus(groupId, featureKey);

        res.json({
            ok: true,
            message: "✅ Feature berhasil diupdate",
            feature,
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
}

/**
 * DELETE /admin/group-features/:groupId/:featureKey
 */
export async function deleteFeature(req, res) {
    try {
        const { groupId, featureKey } = req.params;

        const deleted = await WaGroupFeature.destroy({
            where: { group_id: groupId, feature_key: featureKey },
        });

        if (!deleted) {
            return res.status(404).json({ ok: false, error: "Feature tidak ditemukan" });
        }

        // ✅ INVALIDATE CACHE
        CacheInvalidate.featureStatus(groupId, featureKey);

        res.json({
            ok: true,
            message: `✅ Feature ${featureKey} dihapus (reset ke default)`,
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
}