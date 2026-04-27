'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 🔥 Hapus unique constraint pada kolom name
    await queryInterface.removeConstraint(
        'linked_pt',
        'unique_linked_pt_name'
    );
  },

  async down(queryInterface, Sequelize) {
    // 🔁 Balikin lagi kalau rollback
    await queryInterface.addConstraint('linked_pt', {
      fields: ['name'],
      type: 'unique',
      name: 'unique_linked_pt_name',
    });
  },
};