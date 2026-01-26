import { WaPrivateWhitelist } from "../../models/index.js";

export async function list(req, res) {
    const rows = await WaPrivateWhitelist.findAll({ order: [["created_at", "DESC"]] });
    res.json({ ok: true, data: rows });
}

export async function create(req, res) {
    const { phone_e164, label, notes, is_active = true, allowed_instances } = req.body;
    const row = await WaPrivateWhitelist.create({ phone_e164, label, notes, is_active, allowed_instances });
    res.json({ ok: true, data: row });
}

export async function update(req, res) {
    const row = await WaPrivateWhitelist.findByPk(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });

    const { phone_e164, label, notes, is_active, allowed_instances } = req.body;
    await row.update({ phone_e164, label, notes, is_active, allowed_instances });
    res.json({ ok: true, data: row });
}

export async function remove(req, res) {
    const row = await WaPrivateWhitelist.findByPk(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });
    await row.destroy();
    res.json({ ok: true });
}
