import Sequelize from "sequelize";
import sequelize from "../src/config/sequelize.js";
import migration from "../migrations/20261011_000001_wa_command_events.cjs";
try {
    await migration.up(sequelize.getQueryInterface(), Sequelize);
    console.log("wa_command_events migration ready");
} catch (error) {
    console.error("Command migration failed:", error.message);
    process.exitCode = 1;
} finally { await sequelize.close(); }
