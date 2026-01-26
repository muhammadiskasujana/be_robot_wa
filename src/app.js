import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import webhookRoutes from "./routes/webhook.js";

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(helmet());
app.use(morgan("combined"));

app.get("/", (req, res) => res.send("OK"));
app.use("/webhook", webhookRoutes);

export default app;
