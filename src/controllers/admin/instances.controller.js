import { WaInstance } from "../../models/index.js";

export async function list(req, res) {
    const rows = await WaInstance.findAll({ order: [["created_at", "DESC"]] });
    res.json({ ok: true, data: rows });
}

export async function create(req, res) {
    const { id_instance, api_token, name, is_active = true, meta } = req.body;
    const row = await WaInstance.create({ id_instance, api_token, name, is_active, meta });
    res.json({ ok: true, data: row });
}

export async function update(req, res) {
    const row = await WaInstance.findByPk(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });

    const { id_instance, api_token, name, is_active, meta } = req.body;
    await row.update({ id_instance, api_token, name, is_active, meta });
    res.json({ ok: true, data: row });
}

export async function remove(req, res) {
    const row = await WaInstance.findByPk(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });
    await row.destroy();
    res.json({ ok: true });
}
