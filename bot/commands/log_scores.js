const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('log-scores')
    .setDescription('Log tossup stats for a player at a meeting (officer only)')
    .addStringOption(o =>
      o.setName('date').setDescription('Meeting date (YYYY-MM-DD)').setRequired(true))
    .addStringOption(o =>
      o.setName('player').setDescription('Player name (partial match)').setRequired(true))
    .addStringOption(o =>
      o.setName('subject').setDescription('Subject').setRequired(true)
        .addChoices(
          { name: 'Biology',     value: 'bio'        },
          { name: 'Chemistry',   value: 'chem'       },
          { name: 'Physics',     value: 'physics'    },
          { name: 'Earth/Space', value: 'earth_space'},
          { name: 'Math',        value: 'math'       },
        ))
    .addIntegerOption(o =>
      o.setName('correct').setDescription('Tossups answered correctly').setRequired(true).setMinValue(0))
    .addIntegerOption(o =>
      o.setName('neg').setDescription('Tossups negged').setRequired(true).setMinValue(0)),

  async execute(interaction, sb) {
    await interaction.deferReply({ ephemeral: true });

    const { data: caller } = await sb.from('profiles')
      .select('id, role').eq('discord_id', interaction.user.id).single();

    if (!caller || caller.role !== 'officer') {
      return interaction.editReply('Only officeres can log scores.');
    }

    const date    = interaction.options.getString('date');
    const name    = interaction.options.getString('player');
    const subject = interaction.options.getString('subject');
    const correct = interaction.options.getInteger('correct');
    const neg     = interaction.options.getInteger('neg');

    // Resolve meeting
    const { data: meeting } = await sb.from('meetings')
      .select('id').eq('meeting_date', date).single();
    if (!meeting) {
      return interaction.editReply(`No meeting found on ${date}. Create it first with \`/log-meeting\`.`);
    }

    // Resolve player
    const { data: players } = await sb.from('profiles')
      .select('id, full_name').ilike('full_name', `%${name}%`).eq('role', 'student').limit(5);
    if (!players?.length) return interaction.editReply(`No player found matching "${name}".`);
    if (players.length > 1) {
      return interaction.editReply(`Multiple matches: ${players.map(p => p.full_name).join(', ')}. Be more specific.`);
    }
    const player = players[0];

    // Upsert stats
    const { error } = await sb.from('meeting_player_stats').upsert({
      meeting_id:      meeting.id,
      user_id:         player.id,
      subject,
      tossups_correct: correct,
      tossups_neg:     neg,
    }, { onConflict: 'meeting_id,user_id,subject' });

    if (error) return interaction.editReply(`Error: ${error.message}`);

    const acc = correct + neg > 0 ? Math.round(correct / (correct + neg) * 100) : 0;
    await interaction.editReply(
      `Logged for **${player.full_name}** on ${date} — ${subject}: ${correct}✓ ${neg}✗ (${acc}%)`
    );
  },
};
