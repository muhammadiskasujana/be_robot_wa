import bcrypt from "bcrypt";
import { AdminUser, AdminRefreshToken } from "../models/index.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken, sha256 } from "../services/jwt.js";

function refreshCookieOptions() {
    const secure = String(process.env.COOKIE_SECURE || "false") === "true";
    const domain = process.env.COOKIE_DOMAIN || undefined;

    return {
        httpOnly: true,
        secure,
        sameSite: secure ? "none" : "lax",
        domain,
        path: "/",
    };
}

export async function login(req, res) {
    const { email, password } = req.body;
    const user = await AdminUser.findOne({ where: { email: String(email || "").toLowerCase() } });
    if (!user || !user.is_active) return res.status(401).json({ ok: false, error: "Invalid credentials" });

    const ok = await bcrypt.compare(String(password || ""), user.password_hash);
    if (!ok) return res.status(401).json({ ok: false, error: "Invalid credentials" });

    const payload = { userId: user.id, email: user.email, role: user.role };

    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken({ userId: user.id });

    const refreshHash = sha256(refreshToken);
    const days = Number(process.env.JWT_REFRESH_EXPIRES_DAYS || 30);
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    await AdminRefreshToken.create({ user_id: user.id, token_hash: refreshHash, expires_at: expiresAt });

    await user.update({ last_login_at: new Date() });

    res.cookie("admin_refresh", refreshToken, {
        ...refreshCookieOptions(),
        maxAge: days * 24 * 60 * 60 * 1000,
    });

    return res.json({
        ok: true,
        data: {
            accessToken,
            user: { id: user.id, email: user.email, name: user.name, role: user.role },
        },
    });
}

export async function me(req, res) {
    // req.user dari middleware requireAuth
    res.json({ ok: true, data: req.user });
}

export async function refresh(req, res) {
    const rt = req.cookies?.admin_refresh;
    if (!rt) return res.status(401).json({ ok: false, error: "Missing refresh token" });

    try {
        const decoded = verifyRefreshToken(rt);
        const hash = sha256(rt);

        const row = await AdminRefreshToken.findOne({ where: { token_hash: hash } });
        if (!row || row.revoked_at) return res.status(401).json({ ok: false, error: "Refresh token revoked" });
        if (new Date(row.expires_at).getTime() < Date.now()) return res.status(401).json({ ok: false, error: "Refresh token expired" });

        const user = await AdminUser.findByPk(decoded.userId);
        if (!user || !user.is_active) return res.status(401).json({ ok: false, error: "User inactive" });

        const accessToken = signAccessToken({ userId: user.id, email: user.email, role: user.role });
        return res.json({ ok: true, data: { accessToken } });
    } catch {
        return res.status(401).json({ ok: false, error: "Invalid refresh token" });
    }
}

export async function logout(req, res) {
    const rt = req.cookies?.admin_refresh;
    if (rt) {
        const hash = sha256(rt);
        await AdminRefreshToken.update({ revoked_at: new Date() }, { where: { token_hash: hash } });
    }
    res.clearCookie("admin_refresh", refreshCookieOptions());
    res.json({ ok: true });
}
