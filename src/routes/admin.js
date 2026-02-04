import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { asyncWrap } from "../middleware/asyncWrap.js";

import * as Instances from "../controllers/admin/instances.controller.js";
import * as Masters from "../controllers/admin/masters.controller.js";
import * as Whitelist from "../controllers/admin/whitelist.controller.js";
import * as Groups from "../controllers/admin/groups.controller.js";
import * as Modes from "../controllers/admin/modes.controller.js";
import * as Commands from "../controllers/admin/commands.controller.js";
import * as Leasing from "../controllers/admin/leasing.controller.js";
import * as Logs from "../controllers/admin/logs.controller.js";
import * as Credit from "../controllers/admin/waCreditController.js";
import * as Billing from "../controllers/admin/billing.controller.js";
import * as Pt from "../controllers/admin/ptCompanyController.js";
import * as Subs from "../controllers/admin/subscriptionController.js";

const router = Router();
router.use(requireAuth);

// Instances
router.get("/instances", asyncWrap(Instances.list));
router.post("/instances", asyncWrap(Instances.create));
router.put("/instances/:id", asyncWrap(Instances.update));
router.delete("/instances/:id", asyncWrap(Instances.remove));

// Masters
router.get("/masters", asyncWrap(Masters.list));
router.post("/masters", asyncWrap(Masters.create));
router.put("/masters/:id", asyncWrap(Masters.update));
router.delete("/masters/:id", asyncWrap(Masters.remove));

// Private whitelist
router.get("/whitelist", asyncWrap(Whitelist.list));
router.post("/whitelist", asyncWrap(Whitelist.create));
router.put("/whitelist/:id", asyncWrap(Whitelist.update));
router.delete("/whitelist/:id", asyncWrap(Whitelist.remove));

// Modes
router.get("/modes", asyncWrap(Modes.list));
router.post("/modes", asyncWrap(Modes.create));
router.put("/modes/:id", asyncWrap(Modes.update));
router.delete("/modes/:id", asyncWrap(Modes.remove));

// Commands + mapping modes
router.get("/commands", asyncWrap(Commands.list));
router.post("/commands", asyncWrap(Commands.create));
router.put("/commands/:id", asyncWrap(Commands.update));
router.delete("/commands/:id", asyncWrap(Commands.remove));
router.post("/commands/:id/modes", asyncWrap(Commands.setAllowedModes)); // replace mapping

// Groups control
router.get("/groups", asyncWrap(Groups.list));
router.get("/groups/:id", asyncWrap(Groups.getById));
router.put("/groups/:id", asyncWrap(Groups.updateBasic));

// leasing set/unset (mirip PT)
router.put("/groups/:id/leasing", asyncWrap(Groups.setLeasingConfig));
router.delete("/groups/:id/leasing", asyncWrap(Groups.unsetLeasing));

// Leasing master + branches
router.get("/leasing/companies", asyncWrap(Leasing.listCompanies));
router.post("/leasing/companies", asyncWrap(Leasing.createCompany));
router.put("/leasing/companies/:id", asyncWrap(Leasing.updateCompany));
router.delete("/leasing/companies/:id", asyncWrap(Leasing.removeCompany));

router.get("/leasing/companies/:companyId/branches", asyncWrap(Leasing.listBranches));
router.post("/leasing/companies/:companyId/branches", asyncWrap(Leasing.createBranch));
router.post("/leasing/companies/:companyId/branches/bulk", asyncWrap(Leasing.bulkUpsertBranches));
router.put("/leasing/branches/:id", asyncWrap(Leasing.updateBranch));
router.delete("/leasing/branches/:id", asyncWrap(Leasing.removeBranch));

// Logs
router.get("/logs/messages", asyncWrap(Logs.listMessages));

// =====================
// Credit system (Policies, Wallets, Ledger)
// =====================

// List commands (picker, reuse WaCommand)
router.get("/credit/commands", asyncWrap(Credit.listCommands));

// ---- Policies ----
router.get("/credit/policies", asyncWrap(Credit.listPolicies));
router.post("/credit/policies", asyncWrap(Credit.createPolicy));
router.put("/credit/policies/:id", asyncWrap(Credit.updatePolicy));
router.delete("/credit/policies/:id", asyncWrap(Credit.removePolicy));

// ---- Wallets ----
router.get("/credit/wallets", asyncWrap(Credit.listWallets));
router.post("/credit/wallets", asyncWrap(Credit.createWallet));
router.put("/credit/wallets/:id", asyncWrap(Credit.updateWallet));

router.post("/credit/wallets/:id/topup", asyncWrap(Credit.topupWallet));
router.post("/credit/wallets/:id/debit", asyncWrap(Credit.debitWallet));

// ---- Ledger / Transactions ----
router.get("/credit/ledger", asyncWrap(Credit.listLedger));

// ===== Billing (Policy + Wallet + Topup) =====
router.get("/billing/commands", asyncWrap(Billing.listCommands));

// Policies
router.get("/billing/policies", asyncWrap(Billing.listPolicies));
router.post("/billing/policies", asyncWrap(Billing.createPolicy));
router.put("/billing/policies/:id", asyncWrap(Billing.updatePolicy));
router.delete("/billing/policies/:id", asyncWrap(Billing.removePolicy));

// Wallets
router.get("/billing/wallets", asyncWrap(Billing.listWallets));
router.post("/billing/wallets", asyncWrap(Billing.createWallet));
router.put("/billing/wallets/:id", asyncWrap(Billing.updateWallet));

// Topup (admin only)
router.post("/billing/wallets/:id/topup", asyncWrap(Billing.topupWallet));

// Optional debit (admin tool)
router.post("/billing/wallets/:id/debit", asyncWrap(Billing.debitWallet));

// Ledger
router.get("/billing/ledger", asyncWrap(Billing.listLedger));

router.post("/billing/topup", asyncWrap(Billing.topupByScope));

router.get("/pt-companies", asyncWrap(Pt.list));
router.post("/pt-companies", asyncWrap(Pt.create));
router.put("/pt-companies/:id", asyncWrap(Pt.update));
router.delete("/pt-companies/:id", asyncWrap(Pt.remove));

// set/unset PT ke group
router.put("/groups/:id/pt", asyncWrap(Pt.setGroupPt));
router.delete("/groups/:id/pt", asyncWrap(Pt.unsetGroupPt));

router.get("/subscriptions", asyncWrap(Subs.list));
router.post("/subscriptions", asyncWrap(Subs.createOrExtend));
router.post("/subscriptions/:id/disable", asyncWrap(Subs.disable));



export default router;
