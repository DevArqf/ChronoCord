require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, Events } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

const commands = [];
for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (!command || !command.data) {
    console.warn(`Skipping invalid command file: ${file}`);
    continue;
  }
  commands.push(command.data.toJSON ? command.data.toJSON() : command.data);
  const name = command.data.name || (command.data.toJSON && command.data.toJSON().name);
  if (name) client.commands.set(name, command);
}

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
const DEV_MODE = process.env.DEV_MODE === 'true';

client.once(Events.ClientReady, async c => {
  console.log(`✅ Logged in as ${c.user.tag}`);

  if (DEV_MODE) {
    try {
      console.log('🚀 [DEV] Registering slash commands...');
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commands },
      );
      console.log('✅ [DEV] Commands registered locally!');
    } catch (error) {
      console.error('Failed to register commands:', error);
    }
  } else {
    console.log('🌍 Production mode — skipping command registration.');
  }

  console.log(`✅ ChronoCord has successfully launched. Logged in as ${c.user.tag}`);
});

client.login(process.env.TOKEN).catch(err => {
  console.error('Failed to login:', err);
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(error);
      await interaction.reply({ content: '❌ There was an error executing this command!', ephemeral: true });
    }
  }

  if (interaction.isButton()) {
    await interaction.reply({ content: `✅ You voted for **${interaction.component.label}**`, ephemeral: true });
  }
});
