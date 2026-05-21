const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('log-meeting')
    .setDescription('Create a new meeting record (coach only)')
    .addStringOption(o =>
      o.setName('date').setDescription('Meeting date (YYYY-MM-DD)').setRequired(true))
    .addStringOption(o =>
      o.setName('notes').setDescription('Optional notes').setRequired(false)),

  async execute(interaction, sb) {
    await interaction.deferReply({ ephemeral: true });

    const { data: caller } = await sb.from('profiles')
      .select('id, role').eq('discord_id', interaction.user.id).single();

    if (!caller || caller.role !== 'coach') {
      return interaction.editReply('Only coaches can log meetings. Link your account with `/link` if you haven\'t.');
    }

    const date  = interaction.options.getString('date');
    const notes = interaction.options.getString('notes') ?? null;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return interaction.editReply('Date must be YYYY-MM-DD format.');
    }

    // Upsert so running it twice doesn't create duplicates
    const { data: existing } = await sb.from('meetings').select('id').eq('meeting_date', date).single();
    if (existing) {
      return interaction.editReply(`A meeting on ${date} already exists (ID: \`${existing.id}\`). Use \`/log-scores\` to add stats to it.`);
    }

    const { data, error } = await sb.from('meetings')
      .insert({ meeting_date: date, notes, created_by: caller.id })
      .select('id').single();

    if (error) return interaction.editReply(`Error: ${error.message}`);

    await interaction.editReply(`Meeting on **${date}** created.\nNow use \`/log-scores\` to add player stats.`);
  },
};
