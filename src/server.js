import "dotenv/config";
import app from "./app.js";
import { sequelize } from "./models/index.js";

const PORT = process.env.PORT || 3000;

async function start() {
    await sequelize.authenticate();
    await sequelize.sync({ alter: process.env.NODE_ENV !== "production" });
    app.listen(PORT, "0.0.0.0", () => console.log(`Server running :${PORT}`));
}

start().catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
});
