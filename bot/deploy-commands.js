// Run once to register slash commands with Discord:
//   cd bot && node deploy-commands.js
require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Discord account to your Science Bowl profile')
    .addStringOption(o => o.setName('name').setDescription('Your full name as registered').setRequired(true))
    .addStringOption(o => o.setName('password').setDescription('Your account password').setRequired(true)),

  new SlashCommandBuilder()
    .setName('log-meeting')
    .setDescription('Create a meeting record (officer only)')
    .addStringOption(o => o.setName('date').setDescription('YYYY-MM-DD').setRequired(true))
    .addStringOption(o => o.setName('notes').setDescription('Optional notes').setRequired(false)),

  new SlashCommandBuilder()
    .setName('log-scores')
    .setDescription('Log tossup stats for a player (officer only)')
    .addStringOption(o => o.setName('date').setDescription('Meeting date YYYY-MM-DD').setRequired(true))
    .addStringOption(o => o.setName('player').setDescription('Player name (partial match)').setRequired(true))
    .addStringOption(o => o.setName('subject').setDescription('Subject').setRequired(true)
      .addChoices(
        { name: 'Biology',     value: 'bio'         },
        { name: 'Chemistry',   value: 'chem'        },
        { name: 'Physics',     value: 'physics'     },
        { name: 'Earth/Space', value: 'earth_space' },
        { name: 'Math',        value: 'math'        },
      ))
    .addIntegerOption(o => o.setName('correct').setDescription('Tossups correct').setRequired(true).setMinValue(0))
    .addIntegerOption(o => o.setName('neg').setDescription('Tossups negged').setRequired(true).setMinValue(0)),

  new SlashCommandBuilder()
    .setName('notify')
    .setDescription('Send a message to the reminders channel (officer only)')
    .addStringOption(o => o.setName('message').setDescription('Message to send').setRequired(true)),
].map(c => c.toJSON());

const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
  console.log(`Registering ${commands.length} commands…`);
  await rest.put(
    Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
    { body: commands }
  );
  console.log('Done. Set your Interactions Endpoint URL in Discord Dev Portal:');
  console.log('  https://your-vercel-domain.vercel.app/api/interactions');
})();
