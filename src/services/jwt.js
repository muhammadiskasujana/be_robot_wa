import jwt from "jsonwebtoken";
import crypto from "crypto";

export function signAccessToken(payload) {
    return jwt.sign(payload, process.env.JWT_ACCESS_SECRET, {
        expiresIn: process.env.JWT_ACCESS_EXPIRES || "15m",
    });
}

export function signRefreshToken(payload) {
    return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
        expiresIn: `${Number(process.env.JWT_REFRESH_EXPIRES_DAYS || 30)}d`,
    });
}

export function verifyAccessToken(token) {
    return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
}

export function verifyRefreshToken(token) {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}

export function sha256(str) {
    return crypto.createHash("sha256").update(str).digest("hex");
}
