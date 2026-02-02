// services/waCommandPolicyService.js
import { WaCommand, WaCommandPolicy } from "../models/index.js";
import { fetchString, fetchJSON, TTL, CacheKeys } from "./cacheService.js";

const TTL_CMD_ID = 6 * 60 * 60;      // 6 jam
const TTL_POLICY = 2 * 60;           // 2 menit

async function getCommandIdByKey(commandKey) {
    const key = String(commandKey || "").trim();
    if (!key) return null;

    const id = await fetchString(
        CacheKeys.cmdId(key),
        async () => {
            const row = await WaCommand.findOne({
                where: { key, is_active: true },
                attributes: ["id"],
            });
            return row?.id || "";
        },
        TTL_CMD_ID
    );

    return id || null;
}

/**
 * Default GRATIS:
 * - kalau tidak ada policy => enabled=true, use_credit=false
 * - policy group menang atas policy leasing
 */
export async function resolvePolicy({ groupId, leasingId, commandKey }) {
    const command_id = await getCommandIdByKey(commandKey);
    if (!command_id) {
        return { ok: false, error: `Command "${commandKey}" belum terdaftar di wa_commands` };
    }

    // 1) policy GROUP
    if (groupId) {
        const polG = await fetchJSON(
            CacheKeys.policyGroup(groupId, command_id),
            async () => {
                const row = await WaCommandPolicy.findOne({
                    where: { scope_type: "GROUP", group_id: groupId, command_id, is_enabled: true },
                    attributes: ["use_credit", "credit_cost", "wallet_scope"],
                });
                return row ? row.toJSON() : null;
            },
            TTL_POLICY
        );

        if (polG) {
            return {
                ok: true,
                command_id,
                is_enabled: true,
                use_credit: !!polG.use_credit,
                credit_cost: Math.max(1, Number(polG.credit_cost || 1)),
                wallet_scope: polG.wallet_scope || "GROUP",
                scope_hit: "GROUP",
            };
        }
    }

    // 2) policy LEASING (fallback)
    if (leasingId) {
        const polL = await fetchJSON(
            CacheKeys.policyLeasing(leasingId, command_id),
            async () => {
                const row = await WaCommandPolicy.findOne({
                    where: { scope_type: "LEASING", leasing_id: leasingId, command_id, is_enabled: true },
                    attributes: ["use_credit", "credit_cost", "wallet_scope"],
                });
                return row ? row.toJSON() : null;
            },
            TTL_POLICY
        );

        if (polL) {
            return {
                ok: true,
                command_id,
                is_enabled: true,
                use_credit: !!polL.use_credit,
                credit_cost: Math.max(1, Number(polL.credit_cost || 1)),
                wallet_scope: polL.wallet_scope || "LEASING",
                scope_hit: "LEASING",
            };
        }
    }

    // 3) default GRATIS & enabled
    return {
        ok: true,
        command_id,
        is_enabled: true,
        use_credit: false,
        credit_cost: 0,
        wallet_scope: "GROUP",
        scope_hit: "DEFAULT_FREE",
    };
}
