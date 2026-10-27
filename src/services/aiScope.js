import { WaGroupMode, WaGroupLeasingBranch, LeasingCompany, LeasingBranch, PtCompany } from '../models/index.js';

export async function resolveAiScope(record, { isMaster = false } = {}) {
  if (isMaster) return { mode: 'management', pts: [], leasings: [], branches: [] };
  if (!record) return null;
  const mode = record.mode_id ? await WaGroupMode.findByPk(record.mode_id, { attributes: ['key', 'is_active'] }) : null;
  if (record.mode_id && !mode?.is_active) return null;
  const modeKey = String(mode?.key || '').toLowerCase();
  if (modeKey === 'management') return { mode: 'management', pts: [], leasings: [], branches: [] };
  const ptId = modeKey === 'leasing' ? null : record.pt_company_id;
  const leasingId = modeKey === 'pt' ? null : record.leasing_id;
  const pt = ptId ? await PtCompany.findByPk(ptId, { attributes: ['name', 'is_active'] }) : null;
  const leasing = leasingId ? await LeasingCompany.findByPk(leasingId, { attributes: ['name', 'is_active'] }) : null;
  if ((ptId && !pt?.is_active) || (leasingId && !leasing?.is_active)) return null;
  const pts = pt?.is_active ? [pt.name] : [];
  const leasings = leasing?.is_active ? [leasing.name] : [];
  if (!pts.length && !leasings.length) return null;
  let branches = [];
  if (leasings.length && ['CABANG', 'AREA'].includes(String(record.leasing_level || '').toUpperCase())) {
    const links = await WaGroupLeasingBranch.findAll({ where: { group_id: record.id, is_active: true }, attributes: ['leasing_branch_id'] });
    const rows = await LeasingBranch.findAll({ where: { id: links.map(link => link.leasing_branch_id), leasing_id: leasingId, is_active: true }, attributes: ['name'] });
    branches = rows.map(branch => branch.name);
    if (!branches.length) return null;
  }
  return { mode: 'group', pts, leasings, branches };
}
