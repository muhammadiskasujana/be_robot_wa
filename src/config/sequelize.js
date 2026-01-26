import { Sequelize } from "sequelize";
import "dotenv/config";

const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASS,
    {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 5432),
        dialect: "postgres",
        logging: false,
        pool: { max: 10, min: 0, acquire: 30000, idle: 10000 },
    }
);

export default sequelize;
