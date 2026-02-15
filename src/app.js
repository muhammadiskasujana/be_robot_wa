import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import cors from "cors";
import cookieParser from "cookie-parser";

import webhookRoutes from "./routes/webhook.js";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import notifyRoutes from "./routes/notifyRoutes.js";
import tempReportsRoutes from "./routes/tempReports.js";

const app = express();
app.set("trust proxy", 1);

// ✅ allow only 1 origin
const ALLOWED_ORIGIN = "https://control.digitalmanager.id";

const corsOptions = {
    origin: (origin, cb) => {
        // allow tools/curl without Origin
        if (!origin) return cb(null, true);
        if (origin === ALLOWED_ORIGIN) return cb(null, true);
        return cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));

// ✅ preflight for all paths (bukan domain)
app.options(/.*/, cors(corsOptions));

app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

app.use(helmet());
app.use(morgan("combined"));

app.get("/", (req, res) => res.send("OK"));

app.use("/webhook", webhookRoutes);
app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/api/notify", notifyRoutes);
app.use("/api/temp-reports", tempReportsRoutes);

app.use((err, req, res, next) => {
    console.error("❌ Error:", err?.message || err);
    if (String(err?.message || "").startsWith("CORS blocked:")) {
        return res.status(403).json({ ok: false, error: err.message });
    }
    res.status(500).json({ ok: false, error: "Internal Server Error" });
});

export default app;
