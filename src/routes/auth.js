import { Router } from "express";
import { asyncWrap } from "../middleware/asyncWrap.js";
import { requireAuth } from "../middleware/requireAuth.js";
import * as Auth from "../controllers/auth.controller.js";

const router = Router();

router.post("/login", asyncWrap(Auth.login));
router.post("/refresh", asyncWrap(Auth.refresh));
router.post("/logout", asyncWrap(Auth.logout));
router.get("/me", requireAuth, asyncWrap(Auth.me));

export default router;