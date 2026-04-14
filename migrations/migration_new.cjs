'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('linked_pt', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      code: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false,
      },
      meta: {
        type: Sequelize.JSONB,
        defaultValue: {},
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
      },
      updated_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
      },
    });

    // Unique constraint: name
    await queryInterface.addConstraint('linked_pt', {
      fields: ['name'],
      type: 'unique',
      name: 'unique_linked_pt_name',
    });

    // Unique constraint: code
    await queryInterface.addConstraint('linked_pt', {
      fields: ['code'],
      type: 'unique',
      name: 'unique_linked_pt_code',
    });

    // Index for performance
    await queryInterface.addIndex('linked_pt', {
      fields: ['is_active'],
      name: 'idx_linked_pt_is_active',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('linked_pt');
  },
};