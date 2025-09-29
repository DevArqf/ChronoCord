const { SlashCommandBuilder } = require('discord.js');
const role = require('./role');
const requireManage = require('./require-manage');
const defaults = require('./defaults');
const view = require('./view');

const builder = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configure the bot for your server')
  .addSubcommand(role.data)
  .addSubcommand(requireManage.data)
  .addSubcommand(defaults.data)
  .addSubcommand(view.data);

module.exports = {
  data: builder,
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'role') return role.execute(interaction);
    if (sub === 'require-manage') return requireManage.execute(interaction);
    if (sub === 'defaults') return defaults.execute(interaction);
    if (sub === 'view') return view.execute(interaction);
    return interaction.reply({ content: 'Unknown subcommand.' });
  },
};