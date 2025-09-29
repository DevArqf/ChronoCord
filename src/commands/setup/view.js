const { SlashCommandSubcommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { fetchSettings } = require('../../lib/settings-db');

const data = new SlashCommandSubcommandBuilder()
  .setName('view')
  .setDescription('View current server settings');

module.exports = {
  data,
  async execute(interaction) {
    const isAdmin = interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator);
    if (!isAdmin) return interaction.reply({ content: 'Administrator permission required.', ephemeral: true });

    let settings = null;
    try {
      settings = await fetchSettings(interaction.guildId);
    } catch (err) {
      console.error('DB error:', err);
      return interaction.reply({ content: 'Failed to fetch settings.' });
    }

    const embed = new EmbedBuilder()
      .setTitle('Server Settings')
      .setColor('#3498db')
      .setTimestamp();

    if (!settings) {
      embed.setDescription('No custom settings stored. Defaults are in effect.');
      return interaction.reply({ embeds: [embed] });
    }

    const roleList = (settings.eventRoleIds && settings.eventRoleIds.length)
      ? settings.eventRoleIds.map(id => `<@&${id}>`).join(', ')
      : 'None (all members allowed unless require-manage enabled)';

    embed.addFields(
      { name: 'Allowed Role(s)', value: roleList, inline: false },
      { name: 'Require Manage Server', value: String(settings.requireManage), inline: true },
      { name: 'Default Max Votes', value: settings.defaultMaxVotes ? String(settings.defaultMaxVotes) : 'Not set', inline: true },
    );

    return interaction.reply({ embeds: [embed] });
  },
};