const {
  SlashCommandSubcommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType,
  PermissionsBitField,
} = require('discord.js');
const config = require('../../main-config');
const { fetchEventsForGuild, deleteEvent } = require('../../lib/events-db');
const { fetchSettings } = require('../../lib/settings-db');

const DEV_ID = '899385550585364481';

const data = new SlashCommandSubcommandBuilder()
  .setName('list')
  .setDescription('List ongoing events for this server');

async function isAuthorizedToRun(interaction) {
  if (interaction.user.id === DEV_ID) return true;
  const settings = await fetchSettings(interaction.guildId).catch(() => null);
  if (!settings) return true;
  if (settings.requireManage) return interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild) ?? false;
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
    const allowed = await isAuthorizedToRun(interaction);
    if (!allowed) return interaction.reply({ content: 'You are not allowed to use /event list in this server.' });

    // fetch events
    let rows = [];
    try {
      rows = await fetchEventsForGuild(interaction.guildId);
    } catch (err) {
      console.error('DB fetch error:', err);
      return interaction.reply({ content: 'Failed to fetch events.' });
    }

    if (!rows.length) return interaction.reply({ content: 'No ongoing events found for this server.' });

    const embed = new EmbedBuilder()
      .setTitle('Ongoing Events')
      .setDescription(`Found **${rows.length}** ongoing event(s) for this server.\n\nSelect one or more events below to end (delete) them.`)
      .setColor(config.listColor || config.defaultColor || '#00b0f4')
      .setFooter(config.defaultFooterText ? { text: config.defaultFooterText } : null)
      .setTimestamp();

    // Add detailed fields (previously present) for readability
    for (const r of rows) {
      let timesPreview = '(times unavailable)';
      try {
        const parsed = JSON.parse(r.times);
        timesPreview = parsed.slice(0, 5).join(', ') + (parsed.length > 5 ? '...' : '');
      } catch {}
      const createdTs = Math.floor(r.createdAt / 1000);
      const link = `https://discord.com/channels/${r.guildId}/${r.channelId}/${r.messageId}`;

      embed.addFields({
        name: `${r.title}`,
        value:
          `• UID: \`${r.uid}\`\n` +
          `• Max votes: **${r.maxVotes ?? 1}**\n` +
          `• Times: ${timesPreview}\n` +
          `• Channel: <#${r.channelId}>\n` +
          `• Created: <t:${createdTs}:f>\n` +
          `[Jump to poll](${link})`,
        inline: false,
      });
    }

    // build options for select menu (cap at config.maxSelectOptions)
    const maxOptions = config.maxSelectOptions || 25;
    const options = rows.slice(0, maxOptions).map(r => {
      let timesPreview = '(times unavailable)';
      try {
        const parsed = JSON.parse(r.times);
        timesPreview = parsed.slice(0, 3).join(', ') + (parsed.length > 3 ? '...' : '');
      } catch {}
      // label must be <=100 chars; ensure it
      const label = (r.title && r.title.length > 90 ? r.title.slice(0, 87) + '...' : (r.title || r.uid));
      // include UID in description so user can see it in the menu
      const description = `${r.uid} • ${timesPreview} • ${new Date(r.createdAt).toLocaleDateString()}`;
      return {
        label,
        value: r.uid,
        description: description.slice(0, 100),
      };
    });

    const select = new StringSelectMenuBuilder()
      .setCustomId(`event_end_${interaction.id}`)
      .setPlaceholder('Select event(s) to end')
      .addOptions(options)
      .setMinValues(1)
      .setMaxValues(Math.min(options.length, 25));

    const row = new ActionRowBuilder().addComponents(select);

    // send message and get the message object to attach collector
    let listMessage;
    try {
      listMessage = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });
    } catch (err) {
      console.error('Failed to send list message:', err);
      return;
    }

    // collector: only the command user or users with ManageGuild can delete; check on collect
    const collector = listMessage.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 1000 * 60 * 5, // 5 minutes to act
    });

    collector.on('collect', async selectInteraction => {
      // permission check: allow if command user OR has ManageGuild OR developer
      const isInvoker = selectInteraction.user.id === interaction.user.id;
      const isDev = selectInteraction.user.id === DEV_ID;
      const hasManage = selectInteraction.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild);
      if (!isInvoker && !hasManage && !isDev) {
        return selectInteraction.reply({ content: 'You do not have permission to end events.' });
      }

      await selectInteraction.deferUpdate();

      const uids = selectInteraction.values; // array of uid strings
      const deleted = [];
      const failed = [];

      for (const uid of uids) {
        try {
          // remove DB record
          const changes = await deleteEvent(uid);
          if (!changes) {
            failed.push(uid);
            continue;
          }
          // try to delete the original message in the channel if present
          try {
            // fetch DB row info from local 'rows' array
            const rowInfo = rows.find(r => r.uid === uid);
            if (rowInfo) {
              const channel = await interaction.guild.channels.fetch(rowInfo.channelId).catch(() => null);
              if (channel && channel.isTextBased && rowInfo.messageId) {
                try {
                  const msg = await channel.messages.fetch(rowInfo.messageId).catch(() => null);
                  if (msg) await msg.delete().catch(() => null);
                } catch {}
              }
            }
          } catch (err) {
            // ignore message deletion errors
          }
          deleted.push(uid);
        } catch (err) {
          console.error('Failed to delete event uid:', uid, err);
          failed.push(uid);
        }
      }

      // refresh list after deletion
      try {
        rows = await fetchEventsForGuild(interaction.guildId);
      } catch (err) {
        console.error('DB fetch error after delete:', err);
      }

      // build updated embed (re-add detailed fields)
      const updatedEmbed = new EmbedBuilder()
        .setTitle('Ongoing Events')
        .setDescription(`Found **${rows.length}** ongoing event(s) for this server.`)
        .setColor(config.listColor || config.defaultColor || '#00b0f4')
        .setFooter(config.defaultFooterText ? { text: config.defaultFooterText } : null)
        .setTimestamp();

      for (const r of rows) {
        let timesList = [];
        try { const parsed = JSON.parse(r.times); timesList = parsed.slice(0, 5); } catch { timesList = ['(times unavailable)']; }
        const timesPreview = timesList.join(', ') + (timesList.length >= 5 ? '...' : '');
        const createdTs = Math.floor(r.createdAt / 1000);
        const link = `https://discord.com/channels/${r.guildId}/${r.channelId}/${r.messageId}`;

        updatedEmbed.addFields({
          name: `${r.title}`,
          value:
            `• UID: \`${r.uid}\`\n` +
            `• Max votes: **${r.maxVotes ?? 1}**\n` +
            `• Times: ${timesPreview}\n` +
            `• Channel: <#${r.channelId}>\n` +
            `• Created: <t:${createdTs}:f>\n` +
            `[Jump to poll](${link})`,
          inline: false,
        });
      }

      // edit original message to reflect updated list (if still exists)
      try {
        await listMessage.edit({ embeds: [updatedEmbed], components: rows.length ? [row] : [] });
      } catch (err) {
        // ignore edit errors
      }

      // reply to the user with result (non-ephemeral)
      const resultLines = [];
      if (deleted.length) resultLines.push(`\`✅\` Deleted: ${deleted.map(u => `\`${u}\``).join(', ')}`);
      if (failed.length) resultLines.push(`\`❌\` Failed: ${failed.map(u => `\`${u}\``).join(', ')}`);
      if (!resultLines.length) resultLines.push('No events were deleted.');

      try {
        await selectInteraction.followUp({ content: resultLines.join('\n') });
      } catch {}
    });

    collector.on('end', () => {
      // disable select after timeout
      try {
        listMessage.edit({ components: [] }).catch(() => {});
      } catch {}
    });

    return;
  },
};