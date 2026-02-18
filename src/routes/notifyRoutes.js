import express from "express";
import { asyncWrap } from "../middleware/asyncWrap.js";
import * as Notify from "../controllers/notifyAccess.controller.js";
import { enqueueManagementEvent } from "../controllers/notifyManagement.controller.js";

const router = express.Router();

// POST /api/notify/access
router.post("/access", asyncWrap(Notify.enqueueAccessNotify));
// POST /api/notify/management/activation
router.post("/management", asyncWrap(enqueueManagementEvent));

export default router;
