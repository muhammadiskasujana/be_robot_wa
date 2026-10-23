import 'dotenv/config';
import { Sequelize } from 'sequelize';
import sequelize from '../src/config/sequelize.js';
import migration from '../migrations/20261023_000001_group_ai.cjs';

try {
  await migration.up(sequelize.getQueryInterface(), Sequelize);
  console.log('AI group migration ready');
} catch (error) {
  console.error('AI migration failed:', error.message);
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
