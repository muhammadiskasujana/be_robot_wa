'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE linked_pt
      DROP CONSTRAINT IF EXISTS unique_linked_pt_name;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE linked_pt
      DROP CONSTRAINT IF EXISTS linked_pt_name_key;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE linked_pt
      DROP CONSTRAINT IF EXISTS linked_pt_name;
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addConstraint('linked_pt', {
      fields: ['name'],
      type: 'unique',
      name: 'linked_pt_name',
    });
  },
};