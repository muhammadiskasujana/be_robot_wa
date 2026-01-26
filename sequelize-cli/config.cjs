require("dotenv").config();

module.exports = {
    development: {
        username: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME,
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 5432),
        dialect: "postgres",
        logging: false,
    },
    production: {
        username: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME,
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 5432),
        dialect: "postgres",
        logging: false,
        dialectOptions: process.env.DB_SSL === "true"
            ? { ssl: { require: true, rejectUnauthorized: false } }
            : {},
    },
};
