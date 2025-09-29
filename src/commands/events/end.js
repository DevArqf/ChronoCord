const { SlashCommandSubcommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
// use the central config file (keep your existing path)
const config = require('../../main-config');
const { fetchEventsForGuild, deleteEvent } = require('../../lib/events-db');
const { fetchSettings } = require('../../lib/settings-db');

const DEV_ID = '899385550585364481';

const data = new SlashCommandSubcommandBuilder()
  .setName('end')
  .setDescription('End a poll by its UID')
  .addStringOption(o => o.setName('uid').setDescription('The UID of the poll to end').setRequired(true));

// helper: normalize color input -> '#RRGGBB' or null (drops alpha if provided)
function normalizeHexColor(input) {
  if (!input) return null;
  let hex = String(input).trim().replace(/^0x|#/i, '');
  if (hex.length === 8) hex = hex.slice(0, 6); // drop alpha channel if present
  if (/^[0-9A-Fa-f]{6}$/.test(hex)) return `#${hex.toLowerCase()}`;
  return null;
}

async function isAuthorizedToRun(interaction) {
  if (interaction.user.id === DEV_ID) return true;
  const settings = await fetchSettings(interaction.guildId).catch(() => null);
  if (!settings) return interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild) ?? false;
  if (settings.requireManage) return interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild) ?? false;
  if (Array.isArray(settings.eventRoleIds) && settings.eventRoleIds.length) {
    const memberRoles = interaction.member?.roles?.cache;
    if (!memberRoles) return false;
    return settings.eventRoleIds.some(rid => memberRoles.has(rid));
  }
  // default: allow users with ManageGuild
  return interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild) ?? false;
}

module.exports = {
  data,
  async execute(interaction) {
    const uid = interaction.options.getString('uid')?.trim();
    if (!uid) return interaction.reply({ content: 'Please provide a valid UID.' });

    // permission check via settings (developer always bypasses)
    const allowed = await isAuthorizedToRun(interaction);
    if (!allowed) return interaction.reply({ content: 'You are not allowed to use /event end in this server.' });

    // find the event in this guild
    let rows = [];
    try {
      rows = await fetchEventsForGuild(interaction.guildId);
    } catch (err) {
      console.error('DB fetch error:', err);
      return interaction.reply({ content: 'Failed to query events.' });
    }

    const row = rows.find(r => r.uid === uid);
    if (!row) return interaction.reply({ content: `No event with UID \`${uid}\` found in this server.` });

    // delete DB record
    let changes = 0;
    try {
      changes = await deleteEvent(uid);
    } catch (err) {
      console.error('DB delete error:', err);
      return interaction.reply({ content: 'Failed to delete event from database.' });
    }

    if (!changes) {
      return interaction.reply({ content: `No event deleted (UID \`${uid}\` may not exist).` });
    }

    // try delete original message (best-effort)
    try {
      const channel = await interaction.guild.channels.fetch(row.channelId).catch(() => null);
      if (channel && channel.isTextBased && row.messageId) {
        const msg = await channel.messages.fetch(row.messageId).catch(() => null);
        if (msg) await msg.delete().catch(() => null);
      }
    } catch (err) {
      console.error('Failed to remove original poll message:', err);
    }

    // normalize colors and fallback
    const color = normalizeHexColor(config.notifyColor) || normalizeHexColor(config.defaultColor) || '#00b0f4';

    const embed = new EmbedBuilder()
      .setTitle('Poll Ended')
      .setDescription(`The poll with UID \`${uid}\` has been ended and removed.`)
      .addFields(
        { name: 'Title', value: row.title ?? 'Unknown', inline: true },
        { name: 'Channel', value: `<#${row.channelId}>`, inline: true },
        { name: 'Max votes', value: `${row.maxVotes ?? 1}`, inline: true },
      )
      .setColor(color)
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};