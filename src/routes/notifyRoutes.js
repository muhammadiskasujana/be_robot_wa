import express from "express";
import { asyncWrap } from "../middleware/asyncWrap.js";
import * as Notify from "../controllers/notifyAccess.controller.js";
import { enqueueManagementEvent } from "../controllers/notifyManagement.controller.js";
import { enqueueTarikanNotify } from "../controllers/notifyTarikan.controller.js";

const router = express.Router();

// POST /api/notify/access
router.post("/report", asyncWrap(Notify.enqueueAccessNotify));
// POST /api/notify/management/activation
router.post("/management", asyncWrap(enqueueManagementEvent));
// POST /api/notify/tarikan
router.post("/tarikan", asyncWrap(enqueueTarikanNotify));

export default router;
