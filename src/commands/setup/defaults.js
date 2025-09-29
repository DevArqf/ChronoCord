const { SlashCommandSubcommandBuilder, PermissionsBitField } = require('discord.js');
const { upsertSettings } = require('../../lib/settings-db');

const data = new SlashCommandSubcommandBuilder()
  .setName('defaults')
  .setDescription('Set default values for polls (server-wide)')
  .addIntegerOption(o => o.setName('maxvotes').setDescription('Default max votes per member for new polls (1..25)').setMinValue(1).setRequired(false));

module.exports = {
  data,
  async execute(interaction) {
    const isAdmin = interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator);
    if (!isAdmin) return interaction.reply({ content: 'Administrator permission required.', ephemeral: true });

    const maxvotes = interaction.options.getInteger('maxvotes');
    if (maxvotes !== null && (maxvotes < 1 || maxvotes > 25)) {
      return interaction.reply({ content: 'maxvotes must be between 1 and 25.' });
    }

    try {
      await upsertSettings(interaction.guildId, { defaultMaxVotes: maxvotes ?? null });
      return interaction.reply({ content: `Defaults updated.${maxvotes ? ` Default max votes: ${maxvotes}` : ' Default max votes cleared.'}` });
    } catch (err) {
      console.error('DB error:', err);
      return interaction.reply({ content: 'Failed to update defaults.' });
    }
  },
};