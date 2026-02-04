import express from "express";
import { asyncWrap } from "../middleware/asyncWrap.js";
import * as Notify from "../controllers/notifyAccess.controller.js";

const router = express.Router();

// POST /api/notify/access
router.post("/access", asyncWrap(Notify.enqueueAccessNotify));

export default router;
