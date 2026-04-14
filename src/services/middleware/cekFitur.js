import { checkFeatureEnabled } from "../fiturmanajemen/fiturManajemen.js";

/**
 * Guard function untuk check feature sebelum execute command
 * Jika nonaktif, kirim pesan dan return false
 */
export async function guardFeature({
  groupId,
  featureKey,
  ctx,
  sendText,
}) {
  const check = await checkFeatureEnabled({
    groupId,
    featureKey,
  });

  // Jika allowed, lanjut
  if (check.allowed) {
    return true;
  }

  // Jika SILENT, jangan kirim apapun
  if (check.messageMode === "SILENT") {
    return false;
  }

  // Jika ada pesan (DEFAULT atau CUSTOM), kirim
  if (check.message) {
    await sendText({ ...ctx, message: check.message });
  }

  return false;
}