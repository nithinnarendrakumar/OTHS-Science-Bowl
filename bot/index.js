const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const fs   = require('fs');
const path = require('path');

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

const cmdFiles = fs.readdirSync(path.join(__dirname, 'commands')).filter(f => f.endsWith('.js'));
for (const file of cmdFiles) {
  const cmd = require(`./commands/${file}`);
  client.commands.set(cmd.data.name, cmd);
}

client.once('ready', () => console.log(`Online: ${client.user.tag}`));

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;
  try {
    await cmd.execute(interaction, sb);
  } catch (err) {
    console.error(err);
    const msg = { content: 'Something went wrong.', ephemeral: true };
    interaction.replied || interaction.deferred
      ? await interaction.followUp(msg)
      : await interaction.reply(msg);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
