import 'dotenv/config';
import { sequelize, PtCompany, LeasingCompany } from '../src/models/index.js';

const scopes = [
  'master:vehicles:read', 'master:access:read', 'master:users:read',
  'master:locations:read', 'master:master-data:read',
  'master:exports:create', 'master:exports:read', 'master:capabilities:read',
];

try {
  const tenant = process.argv[2] || process.env.SERVICE_TENANT || 'robot-hunter-ai';
  if (!tenant.trim()) throw new Error('Tenant name is required');
  await sequelize.authenticate();
  const [ptRows, leasingRows] = await Promise.all([
    PtCompany.findAll({ where: { is_active: true }, attributes: ['name'], raw: true }),
    LeasingCompany.findAll({ where: { is_active: true }, attributes: ['name'], raw: true }),
  ]);
  const names = rows => [...new Set(rows.map(row => String(row.name || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const pts = names(ptRows);
  const leasings = names(leasingRows);
  if (!pts.length || !leasings.length) throw new Error('At least one active PT and leasing are required by agent-backend policy');
  console.log(`TENANT_POLICIES_JSON=${JSON.stringify({ [tenant]: { pts, leasings, roles: ['master'], scopes } })}`);
} catch (error) {
  console.error(`Unable to generate AI tenant policy: ${error.message}`);
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
