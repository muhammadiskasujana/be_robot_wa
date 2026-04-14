import { WaGroupFeature, WaGroup } from "../../models/index.js";
import { fetchJSON, CacheKeys, CacheInvalidate, TTL } from "../cacheService.js";

/**
 * Cek apakah fitur aktif untuk group
 * Return: { ok, allowed, message, messageMode }
 */
export async function checkFeatureEnabled({
  groupId,
  featureKey,
}) {
  if (!groupId || !featureKey) {
    return { ok: false, allowed: true, message: "" };
  }

  const cacheKey = `feat:${groupId}:${featureKey}`;

  const cached = await fetchJSON(
    cacheKey,
    async () => {
      const row = await WaGroupFeature.findOne({
        where: { group_id: groupId, feature_key: featureKey },
        attributes: ["is_enabled", "message_mode", "disabled_message"],
      });
      return row ? row.toJSON() : null;
    },
    TTL.sm // cache 10 detik
  );

  // Jika tidak ada entry -> default ENABLED
  if (!cached) {
    return { ok: true, allowed: true, message: "", messageMode: "DEFAULT" };
  }

  // Jika enabled -> pass
  if (cached.is_enabled) {
    return { ok: true, allowed: true, message: "", messageMode: cached.message_mode };
  }

  // ❌ NONAKTIF -> return message sesuai mode
  const mode = String(cached.message_mode || "DEFAULT").toUpperCase();

  if (mode === "SILENT") {
    // Diam, jangan kirim apapun
    return { ok: true, allowed: false, message: "", messageMode: "SILENT" };
  }

  if (mode === "CUSTOM" && cached.disabled_message) {
    // Kirim custom message
    return {
      ok: true,
      allowed: false,
      message: cached.disabled_message,
      messageMode: "CUSTOM",
    };
  }

  // DEFAULT: Kirim pesan default
  const defaultMsg = `❌ Fitur *${featureKey}* sedang nonaktif untuk group ini.`;
  return {
    ok: true,
    allowed: false,
    message: defaultMsg,
    messageMode: "DEFAULT",
  };
}

/**
 * Enable/Disable fitur untuk group
 */
export async function setFeatureStatus({
  groupId,
  featureKey,
  isEnabled = true,
}) {
  if (!groupId || !featureKey) {
    return { ok: false, error: "groupId dan featureKey wajib" };
  }

  const group = await WaGroup.findByPk(groupId);
  if (!group) return { ok: false, error: "Group tidak ditemukan" };

  const [feature, created] = await WaGroupFeature.findOrCreate({
    where: { group_id: groupId, feature_key: featureKey },
    defaults: {
      group_id: groupId,
      feature_key: featureKey,
      is_enabled: isEnabled,
      message_mode: "DEFAULT",
      disabled_message: null,
    },
  });

  if (!created) {
    feature.is_enabled = isEnabled;
    await feature.save();
  }

  // Invalidate cache
  CacheInvalidate.featureStatus(groupId, featureKey);

  return { ok: true, feature };
}

/**
 * Set pesan custom fitur nonaktif
 */
export async function setFeatureMessage({
  groupId,
  featureKey,
  messageMode = "DEFAULT", // SILENT | DEFAULT | CUSTOM
  customMessage = null,
}) {
  if (!groupId || !featureKey) {
    return { ok: false, error: "groupId dan featureKey wajib" };
  }

  const mode = String(messageMode || "DEFAULT").toUpperCase();
  if (!["SILENT", "DEFAULT", "CUSTOM"].includes(mode)) {
    return { ok: false, error: "messageMode harus: SILENT, DEFAULT, atau CUSTOM" };
  }

  if (mode === "CUSTOM" && !customMessage) {
    return { ok: false, error: "Mode CUSTOM memerlukan custom message" };
  }

  const [feature, created] = await WaGroupFeature.findOrCreate({
    where: { group_id: groupId, feature_key: featureKey },
    defaults: {
      group_id: groupId,
      feature_key: featureKey,
      is_enabled: true,
      message_mode: mode,
      disabled_message: customMessage,
    },
  });

  if (!created) {
    feature.message_mode = mode;
    feature.disabled_message = mode === "CUSTOM" ? customMessage : null;
    await feature.save();
  }

  // Invalidate cache
  CacheInvalidate.featureMessage(groupId, featureKey);

  return { ok: true, feature };
}

/**
 * List semua fitur untuk group
 */
export async function listGroupFeatures(groupId) {
  if (!groupId) return { ok: false, error: "groupId wajib" };

  const features = await WaGroupFeature.findAll({
    where: { group_id: groupId },
    attributes: ["id", "feature_key", "is_enabled", "message_mode", "disabled_message"],
    order: [["feature_key", "ASC"]],
  });

  return { ok: true, features };
}

/**
 * Delete fitur dari group (reset ke default)
 */
export async function deleteGroupFeature(groupId, featureKey) {
  if (!groupId || !featureKey) {
    return { ok: false, error: "groupId dan featureKey wajib" };
  }

  const deleted = await WaGroupFeature.destroy({
    where: { group_id: groupId, feature_key: featureKey },
  });

  if (!deleted) {
    return { ok: false, error: "Fitur tidak ditemukan untuk group ini" };
  }

  // Invalidate cache
  CacheInvalidate.featureStatus(groupId, featureKey);
  CacheInvalidate.featureMessage(groupId, featureKey);

  return { ok: true, deleted };
}