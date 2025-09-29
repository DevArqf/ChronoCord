const { SlashCommandSubcommandBuilder, PermissionsBitField } = require('discord.js');
const { upsertSettings } = require('../../lib/settings-db');

const data = new SlashCommandSubcommandBuilder()
  .setName('require-manage')
  .setDescription('Require Manage Server permission to run /event commands (overrides role setting)')
  .addBooleanOption(o => o.setName('enabled').setDescription('True to require Manage Server, false to disable').setRequired(true));

module.exports = {
  data,
  async execute(interaction) {
    // restrict to administrators
    const isAdmin = interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator);
    if (!isAdmin) return interaction.reply({ content: 'Administrator permission required.', ephemeral: true });

    const enabled = interaction.options.getBoolean('enabled');
    try {
      await upsertSettings(interaction.guildId, { requireManage: enabled });
      return interaction.reply({ content: `Require Manage Server set to ${enabled}.` });
    } catch (err) {
      console.error('DB error:', err);
      return interaction.reply({ content: 'Failed to update settings.' });
    }
  },
};