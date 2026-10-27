import test from 'node:test';
import assert from 'node:assert/strict';
import { WaGroupMode, WaGroupLeasingBranch, LeasingCompany, LeasingBranch, PtCompany } from '../src/models/index.js';
import { resolveAiScope } from '../src/services/aiScope.js';

test('AI scope follows management, leasing, PT and active branch links', async () => {
  const originals = [
    [WaGroupMode, 'findByPk'], [WaGroupLeasingBranch, 'findAll'],
    [LeasingCompany, 'findByPk'], [LeasingBranch, 'findAll'], [PtCompany, 'findByPk'],
  ].map(([model, method]) => [model, method, model[method]]);
  try {
    WaGroupMode.findByPk = async () => ({ key: 'management', is_active: true });
    assert.deepEqual(await resolveAiScope({ mode_id: 'mode-1' }),
      { mode: 'management', pts: [], leasings: [], branches: [] });
    assert.deepEqual(await resolveAiScope(null, { isMaster: true }),
      { mode: 'management', pts: [], leasings: [], branches: [] });
    WaGroupMode.findByPk = async () => ({ key: 'leasing', is_active: true });
    LeasingCompany.findByPk = async () => ({ name: 'LEASING A', is_active: true });
    PtCompany.findByPk = async () => ({ name: 'PT A', is_active: true });
    WaGroupLeasingBranch.findAll = async () => [{ leasing_branch_id: 'branch-1' }];
    LeasingBranch.findAll = async () => [{ name: 'CABANG A' }];
    assert.deepEqual(await resolveAiScope({ id: 'group-1', mode_id: 'mode-2', leasing_id: 'lease-1',
      pt_company_id: 'pt-1', leasing_level: 'CABANG' }),
    { mode: 'group', pts: [], leasings: ['LEASING A'], branches: ['CABANG A'] });
    WaGroupMode.findByPk = async () => ({ key: 'pt', is_active: true });
    assert.deepEqual(await resolveAiScope({ mode_id: 'mode-3', pt_company_id: 'pt-1', leasing_id: 'lease-1' }),
      { mode: 'group', pts: ['PT A'], leasings: [], branches: [] });
    WaGroupMode.findByPk = async () => ({ key: 'leasing', is_active: true });
    LeasingBranch.findAll = async () => [];
    assert.equal(await resolveAiScope({ id: 'group-1', leasing_id: 'lease-1', leasing_level: 'AREA' }), null);
    assert.equal(await resolveAiScope({}), null);
    WaGroupMode.findByPk = async () => ({ key: 'leasing', is_active: false });
    assert.equal(await resolveAiScope({ mode_id: 'inactive', leasing_id: 'lease-1' }), null);
  } finally {
    for (const [model, method, original] of originals) model[method] = original;
  }
});
