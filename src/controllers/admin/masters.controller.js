import { WaMaster } from "../../models/index.js";

export async function list(req, res) {
    const rows = await WaMaster.findAll({ order: [["created_at", "DESC"]] });
    res.json({ ok: true, data: rows });
}

export async function create(req, res) {
    const { phone_e164, role = "admin", is_active = true } = req.body;
    const row = await WaMaster.create({ phone_e164, role, is_active });
    res.json({ ok: true, data: row });
}

export async function update(req, res) {
    const row = await WaMaster.findByPk(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });

    const { phone_e164, role, is_active } = req.body;
    await row.update({ phone_e164, role, is_active });
    res.json({ ok: true, data: row });
}

export async function remove(req, res) {
    const row = await WaMaster.findByPk(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });
    await row.destroy();
    res.json({ ok: true });
}
