import { verifyAccessToken } from "../services/jwt.js";

export function requireAuth(req, res, next) {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) return res.status(401).json({ ok: false, error: "Missing token" });

    try {
        const decoded = verifyAccessToken(token);
        req.user = decoded;
        next();
    } catch {
        return res.status(401).json({ ok: false, error: "Invalid/expired token" });
    }
}
