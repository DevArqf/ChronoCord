const { SlashCommandBuilder } = require('discord.js');
const create = require('./create');
const list = require('./list');
const end = require('./end');

const builder = new SlashCommandBuilder()
  .setName('event')
  .setDescription('Create/list/modify availability polls')
  .addSubcommand(create.data)
  .addSubcommand(list.data)
  .addSubcommand(end.data);

module.exports = {
  data: builder,
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') return create.execute(interaction);
    if (sub === 'list') return list.execute(interaction);
    if (sub === 'end') return end.execute(interaction);
    return interaction.reply({ content: 'Unknown subcommand', flags: 64 });
  },
};