const { SlashCommandSubcommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');
const { upsertSettings } = require('../../lib/settings-db');

const data = new SlashCommandSubcommandBuilder()
  .setName('role')
  .setDescription('Set or clear a role allowed to run /event commands')
  .addRoleOption(o => o.setName('role').setDescription('Role allowed to use event commands (leave empty to clear)').setRequired(false));

module.exports = {
  data,
  async execute(interaction) {
    // restrict to administrators
    const isAdmin = interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator);
    if (!isAdmin) return interaction.reply({ content: 'Administrator permission required.', ephemeral: true });

    const role = interaction.options.getRole('role');
    if (!role) {
      // clear
      try {
        await upsertSettings(interaction.guildId, { eventRoleIds: [] });
        return interaction.reply({ content: 'Event role cleared. Only members with Manage Server (if enabled) or everyone can run the command depending on other settings.' });
      } catch (err) {
        console.error('DB error:', err);
        return interaction.reply({ content: 'Failed to update settings.' });
      }
    }

    try {
      await upsertSettings(interaction.guildId, { eventRoleIds: [role.id] });
      const e = new EmbedBuilder()
        .setTitle('Setup: Event Role Updated')
        .setDescription(`Role <@&${role.id}> may now use the /event commands.`)
        .setColor('#3498db')
        .setTimestamp();
      return interaction.reply({ embeds: [e] });
    } catch (err) {
      console.error('DB error:', err);
      return interaction.reply({ content: 'Failed to update settings.' });
    }
  },
};