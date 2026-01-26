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
router.put("/groups/:id", asyncWrap(Groups.updateBasic)); // title/bot enabled/notif/mode
router.post("/groups/:id/leasing", asyncWrap(Groups.setLeasingConfig)); // HO/AREA/CABANG + branches

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

export default router;
