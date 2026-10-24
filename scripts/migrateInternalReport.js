import Sequelize from "sequelize";
import sequelize from "../src/config/sequelize.js";
import migration from "../migrations/20261024_000001_internal_reports.cjs";

try {
    const queryInterface = sequelize.getQueryInterface();
    const tables = await queryInterface.showAllTables();
    if (tables.some((table) => (typeof table === "string" ? table : table.tableName) === "wa_internal_reports")) {
        console.log("wa_internal_reports sudah tersedia; migrasi dilewati.");
    } else {
        await migration.up(queryInterface, Sequelize);
        console.log("Migrasi wa_internal_reports selesai.");
    }
} catch (error) {
    console.error("Migrasi internal report gagal:", error);
    process.exitCode = 1;
} finally {
    await sequelize.close();
}
