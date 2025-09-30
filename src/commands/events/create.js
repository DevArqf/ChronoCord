const {
  SlashCommandSubcommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType,
  PermissionsBitField,
} = require('discord.js');
const crypto = require('crypto');
// use the central config file (keep your existing path)
const config = require('../../main-config');
const { insertEvent, fetchEventsForGuild } = require('../../lib/events-db');
const { fetchSettings } = require('../../lib/settings-db');

const DEV_ID = '899385550585364481';

const data = new SlashCommandSubcommandBuilder()
  .setName('create')
  .setDescription('Create a new event poll')
  .addStringOption(o => o.setName('title').setDescription('Event name').setRequired(true))
  .addStringOption(o => o.setName('times').setDescription('Comma-separated times and dates').setRequired(true))
  .addIntegerOption(o => o.setName('maxvotes').setDescription('Max slots each member can vote for (default 1)').setMinValue(1))
  // optional embed fields
  .addStringOption(o => o.setName('embed_color').setDescription('Embed color hex (optional)'))
  .addStringOption(o => o.setName('embed_description').setDescription('Embed description (optional)'))
  .addStringOption(o => o.setName('embed_footer').setDescription('Embed footer text (optional)'))
  .addStringOption(o => o.setName('embed_image').setDescription('Embed image URL (optional)'));

const renderBar = (percent, length = 12) => {
  const filled = Math.round((percent / 100) * length);
  return '▰'.repeat(filled) + '▱'.repeat(Math.max(0, length - filled));
};

// helper: normalize color input -> '#RRGGBB' or null
function normalizeHexColor(input) {
  if (!input) return null;
  let hex = String(input).trim().replace(/^0x|#/i, '');
  // If 8-digit hex (RRGGBBAA), drop alpha
  if (hex.length === 8) hex = hex.slice(0, 6);
  if (/^[0-9A-Fa-f]{6}$/.test(hex)) return `#${hex.toLowerCase()}`;
  return null;
}

// check authorization based on guild settings
async function isAuthorizedToRun(interaction) {
  if (interaction.user.id === DEV_ID) return true;
  const settings = await fetchSettings(interaction.guildId).catch(() => null);
  if (!settings) return true; // default allow

  // if requireManage is true -> require ManageGuild
  if (settings.requireManage) {
    return interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild) ?? false;
  }

  // if roles configured -> require at least one role
  if (Array.isArray(settings.eventRoleIds) && settings.eventRoleIds.length) {
    const memberRoles = interaction.member?.roles?.cache;
    if (!memberRoles) return false;
    return settings.eventRoleIds.some(rid => memberRoles.has(rid));
  }

  return true;
}

module.exports = {
  data,
  async execute(interaction) {
    // permission check via settings
    const allowed = await isAuthorizedToRun(interaction);
    if (!allowed) return interaction.reply({ content: 'You are not allowed to use /event create in this server.', flags: 64 });

    const title = interaction.options.getString('title');
    const timesRaw = interaction.options.getString('times');
    const times = timesRaw.split(',').map(t => t.trim()).filter(Boolean);
    if (!times.length) return interaction.reply({ content: 'No valid times provided.', flags: 64 });

    // get guild settings to use defaultMaxVotes if present
    const settings = await fetchSettings(interaction.guildId).catch(() => null);
    const defaultMax = settings?.defaultMaxVotes ?? null;

    const suppliedMax = interaction.options.getInteger('maxvotes');
    const maxVotesOpt = suppliedMax ?? (defaultMax ?? 1);
    const maxVotes = Math.min(Math.max(1, maxVotesOpt), times.length);

    let warned = false;
    if (maxVotes > 1) {
      warned = true;
      await interaction.reply({ content: `⚠️ Members can vote for up to ${maxVotes} slots.`, flags: 64 });
    }

    // read embed customization options
    const inputColorRaw = interaction.options.getString('embed_color');
    const inputDescription = interaction.options.getString('embed_description');
    const inputFooter = interaction.options.getString('embed_footer');
    const inputImage = interaction.options.getString('embed_image');

    // prefer provided color, else config.defaultColor; normalize and fallback
    const normalized = normalizeHexColor(inputColorRaw ?? config.defaultColor);
    const embedColor = normalized || normalizeHexColor(config.defaultColor) || '#3498db';

    const notifyColor = normalizeHexColor(config.notifyColor) || '#00b0f4';

    // slot vote sets
    const slotVotes = times.map(() => new Set());

    const computeStats = () => {
      const unique = new Set();
      for (const s of slotVotes) for (const id of s) unique.add(id);
      const total = unique.size || 0;
      return slotVotes.map(s => {
        const count = s.size;
        const pct = total === 0 ? 0 : Math.round((count / total) * 100);
        return { count, pct };
      });
    };

    const buildEmbed = () => {
      const stats = computeStats();
      const totalVotes = stats.reduce((a, b) => a + b.count, 0);
      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription((inputDescription ?? `Select the times you're available.`) + `\n\nTotal selections: **${totalVotes}**`)
        .setColor(embedColor)
        .setTimestamp();
      if (inputFooter) embed.setFooter({ text: inputFooter ?? config.defaultFooterText });
      if (inputImage) embed.setImage(inputImage);

      for (let i = 0; i < times.length; i++) {
        const s = stats[i];
        embed.addFields({
          name: `${i + 1}. ${times[i]}`,
          value: `${renderBar(s.pct)} ${s.pct}% — **${s.count}** votes`,
          inline: false,
        });
      }
      return embed;
    };

    const options = times.map((t, i) => ({ label: `${t}`, value: `${i}`, description: `Vote for ${t}` }));
    if (options.length > (config.maxSelectOptions || 25)) {
      const errMsg = 'Too many timeslots (>25). Reduce the number of times.';
      if (warned) await interaction.followUp({ content: errMsg, flags: 64 }).catch(() => {});
      else await interaction.reply({ content: errMsg, flags: 64 }).catch(() => {});
      return;
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId(`evt_select_${interaction.id}`)
      .setPlaceholder('Select times you are available')
      .addOptions(options)
      .setMinValues(1)
      .setMaxValues(maxVotes);
    const row = new ActionRowBuilder().addComponents(select);

    let pollMessage;
    try {
      // use fetchReply to ensure we get a Message object (required for createMessageComponentCollector)
      if (warned || interaction.replied) {
        pollMessage = await interaction.followUp({ embeds: [buildEmbed()], components: [row], fetchReply: true });
      } else {
        pollMessage = await interaction.reply({ embeds: [buildEmbed()], components: [row], fetchReply: true });
      }
    } catch (err) {
      console.error('Failed to send poll message via interaction:', err);
      // fallback: post directly to channel and inform the user
      try {
        const channel = interaction.channel ?? await interaction.client.channels.fetch(interaction.channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) throw new Error('No channel available for fallback send');
        pollMessage = await channel.send({ embeds: [buildEmbed()], components: [row] });
        // try to inform user that we posted to channel
        try { await interaction.followUp({ content: 'Posted poll to channel (could not reply to the interaction).', flags: 64 }); } catch {}
      } catch (fallbackErr) {
        console.error('Fallback send failed:', fallbackErr);
        return;
      }
    }

    if (!pollMessage) return;

    // persist event
    const uid = crypto.randomBytes(6).toString('hex');
    const record = {
      uid,
      title,
      times,
      guildId: interaction.guildId,
      channelId: pollMessage.channelId,
      messageId: pollMessage.id,
      createdAt: Date.now(),
      maxVotes,
    };
    try { await insertEvent(record); } catch (err) { console.error('DB insert error', err); }

    // collector
    const collector = pollMessage.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 0 });
    collector.on('collect', async si => {
      try {
        await si.deferUpdate();
        const values = si.values;
        const userId = si.user.id;
        for (const s of slotVotes) s.delete(userId);
        for (const v of values) {
          const idx = parseInt(v, 10);
          if (!Number.isNaN(idx) && slotVotes[idx]) slotVotes[idx].add(userId);
        }
        await pollMessage.edit({ embeds: [buildEmbed()], components: [row] });
      } catch (err) {
        console.error('Select handling error:', err);
        try { await si.followUp({ content: 'An error occurred.', flags: 64 }); } catch {}
      }
    });

    // notify user with UID + link (use normalized notify color)
    const link = `https://discord.com/channels/${record.guildId}/${record.channelId}/${record.messageId}`;
    const notify = new EmbedBuilder()
      .setTitle('Poll Created')
      .setDescription('Your availability poll has been created. Share the link below or use the UID to reference it.')
      .setColor(notifyColor)
      .addFields(
        { name: 'UID', value: `\`${record.uid}\``, inline: true },
        { name: 'Jump to poll', value: `[Open poll](${link})`, inline: true },
        { name: 'Channel', value: `<#${record.channelId}>`, inline: true },
      )
      .setTimestamp();

    await interaction.followUp({ embeds: [notify], flags: 64 }).catch(() => {});
  },
};