const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType,
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('Create an availability poll')
    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('Create a new event poll')
        .addStringOption(o => o.setName('title').setDescription('Event name').setRequired(true))
        .addStringOption(o => o.setName('times').setDescription('Comma-separated times or dates').setRequired(true))
        .addIntegerOption(o => o.setName('maxvotes').setDescription('Max slots each member can vote for (default 1)').setMinValue(1))
        // Embed customization (optional)
        .addStringOption(o => o.setName('embed_color').setDescription('Embed color hex (e.g. #00ff00)'))
        .addStringOption(o => o.setName('embed_description').setDescription('Embed description'))
        .addStringOption(o => o.setName('embed_footer').setDescription('Embed footer text'))
        .addStringOption(o => o.setName('embed_image').setDescription('Embed image URL'))
    ),

  async execute(interaction) {
    if (interaction.options.getSubcommand() !== 'create') return;

    const title = interaction.options.getString('title');
    const timesRaw = interaction.options.getString('times');
    const times = timesRaw.split(',').map(t => t.trim()).filter(Boolean);
    if (!times.length) return interaction.reply({ content: 'No valid times provided.', flags: 64 });

    const maxVotesOpt = interaction.options.getInteger('maxvotes') || 1;
    const maxVotes = Math.min(Math.max(1, maxVotesOpt), times.length);

    // If admin allows >1, send a quick ephemeral warning first
    let warned = false;
    if (maxVotes > 1) {
      warned = true;
      await interaction.reply({
        content: `⚠️ Members will be allowed to vote for up to ${maxVotes} slot(s).`,
        flags: 64,
      });
    }

    // Embed customization inputs
    const inputColor = interaction.options.getString('embed_color');
    const inputDescription = interaction.options.getString('embed_description');
    const inputFooter = interaction.options.getString('embed_footer');
    const inputImage = interaction.options.getString('embed_image');

    // validate/normalize color
    let embedColor = '#3498db';
    if (inputColor) {
      const hex = inputColor.trim().replace(/^0x/i, '').replace(/^#/,'');
      if (/^[0-9A-Fa-f]{6}$/.test(hex)) embedColor = `#${hex}`;
    }

    // slotVotes: Set of userIds per slot
    const slotVotes = times.map(() => new Set());

    const renderBar = (percent, length = 12) => {
      const filled = Math.round((percent / 100) * length);
      return '▰'.repeat(filled) + '▱'.repeat(Math.max(0, length - filled));
    };

    const computeStats = () => {
      const uniqueVoters = new Set();
      for (const s of slotVotes) for (const id of s) uniqueVoters.add(id);
      const totalVoters = uniqueVoters.size || 0;
      const stats = slotVotes.map(s => {
        const count = s.size;
        const pct = totalVoters === 0 ? 0 : Math.round((count / totalVoters) * 100);
        return { count, pct };
      });
      return { stats, totalVoters };
    };

    const buildEmbed = () => {
      const { stats, totalVoters } = computeStats();
      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription((inputDescription ?? `Select the times you're available.`) + `\n\nTotal voters: **${totalVoters}**`)
        .setColor(embedColor)
        .setTimestamp();

      if (inputFooter) embed.setFooter({ text: inputFooter });
      if (inputImage) embed.setImage(inputImage);

      for (let i = 0; i < times.length; i++) {
        const s = stats[i];
        const bar = renderBar(s.pct);
        embed.addFields({
          name: `${i + 1}. ${times[i]}`,
          value: `${bar} ${s.pct}% — **${s.count}** votes`,
          inline: false,
        });
      }
      return embed;
    };

    // Build select menu options (value = slot index string)
    const options = times.map((t, i) => ({
      label: `${t}`,
      value: `${i}`,
      description: `Vote for ${t}`,
    }));

    if (options.length > 25) {
      const msg = warned
        ? await interaction.followUp({ content: 'Too many timeslots (>25). Reduce the number of times.', flags: 64, fetchReply: true })
        : await interaction.reply({ content: 'Too many timeslots (>25). Reduce the number of times.', flags: 64, fetchReply: true });
      return;
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId(`evt_select_${interaction.id}`)
      .setPlaceholder('Select times you are available')
      .addOptions(options)
      .setMinValues(1)
      .setMaxValues(maxVotes);

    const row = new ActionRowBuilder().addComponents(select);

    // Send the poll message (use followUp if we already replied with a warning)
    let pollMessage;
    try {
      if (warned) {
        pollMessage = await interaction.followUp({
          embeds: [buildEmbed()],
          components: [row],
          fetchReply: true,
        });
      } else {
        pollMessage = await interaction.reply({
          embeds: [buildEmbed()],
          components: [row],
          fetchReply: true,
        });
      }
    } catch (err) {
      console.error('Failed to send poll message:', err);
      return;
    }

    // Collector for the select menu
    const collector = pollMessage.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 0,
    });

    collector.on('collect', async selectInteraction => {
      try {
        await selectInteraction.deferUpdate();

        const values = selectInteraction.values; // selected slot indices as strings
        const userId = selectInteraction.user.id;

        // Remove user's id from all slots first
        for (const s of slotVotes) s.delete(userId);

        // Add user to selected slots
        for (const val of values) {
          const idx = parseInt(val, 10);
          if (!Number.isNaN(idx) && slotVotes[idx]) slotVotes[idx].add(userId);
        }

        // Edit original poll message with updated embed
        await pollMessage.edit({
          embeds: [buildEmbed()],
          components: [row],
        });
      } catch (err) {
        console.error('Select handling error:', err);
        try { await selectInteraction.followUp({ content: 'An error occurred.', flags: 64 }); } catch {}
      }
    });
  },
};
