import { WaGroupMode, WaGroupLeasingBranch, LeasingCompany, LeasingBranch, PtCompany } from '../models/index.js';

export async function resolveAiScope(record) {
  if (!record) return null;
  const mode = record.mode_id ? await WaGroupMode.findByPk(record.mode_id, { attributes: ['key', 'is_active'] }) : null;
  if (mode?.is_active && String(mode.key).toLowerCase() === 'management') return { mode: 'management', pts: [], leasings: [], branches: [] };
  const pt = record.pt_company_id ? await PtCompany.findByPk(record.pt_company_id, { attributes: ['name', 'is_active'] }) : null;
  const leasing = record.leasing_id ? await LeasingCompany.findByPk(record.leasing_id, { attributes: ['name', 'is_active'] }) : null;
  if ((record.pt_company_id && !pt?.is_active) || (record.leasing_id && !leasing?.is_active)) return null;
  const pts = pt?.is_active ? [pt.name] : [];
  const leasings = leasing?.is_active ? [leasing.name] : [];
  if (!pts.length && !leasings.length) return null;
  let branches = [];
  if (leasings.length && ['CABANG', 'AREA'].includes(String(record.leasing_level || '').toUpperCase())) {
    const links = await WaGroupLeasingBranch.findAll({ where: { group_id: record.id, is_active: true }, attributes: ['leasing_branch_id'] });
    const rows = await LeasingBranch.findAll({ where: { id: links.map(link => link.leasing_branch_id), leasing_id: record.leasing_id, is_active: true }, attributes: ['name'] });
    branches = rows.map(branch => branch.name);
    if (!branches.length) return null;
  }
  return { mode: 'group', pts, leasings, branches };
}
