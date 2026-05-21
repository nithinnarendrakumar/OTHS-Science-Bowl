const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const SUBJECTS = { bio: 'Bio', chem: 'Chem', physics: 'Physics', earth_space: 'Earth/Space', math: 'Math' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show study stats for a player')
    .addStringOption(o =>
      o.setName('player').setDescription('Name (partial match). Omit to see your own.').setRequired(false))
    .addStringOption(o =>
      o.setName('period').setDescription('Time range').setRequired(false)
        .addChoices(
          { name: '7 days',  value: '7'  },
          { name: '30 days', value: '30' },
          { name: 'All time', value: '0' },
        )),

  async execute(interaction, sb) {
    await interaction.deferReply();
    const name   = interaction.options.getString('player');
    const period = parseInt(interaction.options.getString('period') ?? '7');

    // Resolve profile
    let profile;
    if (name) {
      const { data } = await sb.from('profiles')
        .select('id, full_name').ilike('full_name', `%${name}%`).eq('role', 'student').limit(1).single();
      profile = data;
    } else {
      const { data } = await sb.from('profiles')
        .select('id, full_name').eq('discord_id', interaction.user.id).single();
      profile = data;
    }

    if (!profile) {
      return interaction.editReply(
        name
          ? `No player found matching "${name}".`
          : 'Your Discord is not linked. Run `/link` first or specify a player name.'
      );
    }

    // Study time
    let logQuery = sb.from('daily_logs')
      .select('bio_minutes,chem_minutes,physics_minutes,earth_space_minutes,math_minutes')
      .eq('user_id', profile.id);
    if (period > 0) {
      const cutoff = new Date(Date.now() - period * 86400000).toISOString().slice(0, 10);
      logQuery = logQuery.gte('log_date', cutoff);
    }
    const { data: logs } = await logQuery;

    const mins = { bio: 0, chem: 0, physics: 0, earth_space: 0, math: 0 };
    for (const l of (logs || [])) {
      mins.bio         += l.bio_minutes;
      mins.chem        += l.chem_minutes;
      mins.physics     += l.physics_minutes;
      mins.earth_space += l.earth_space_minutes;
      mins.math        += l.math_minutes;
    }
    const totalMins = Object.values(mins).reduce((a, b) => a + b, 0);

    // Tossup stats
    const { data: tossups } = await sb.from('meeting_player_stats')
      .select('subject, tossups_correct, tossups_neg')
      .eq('user_id', profile.id);

    const tu = {};
    for (const t of (tossups || [])) {
      tu[t.subject] ??= { c: 0, n: 0 };
      tu[t.subject].c += t.tossups_correct;
      tu[t.subject].n += t.tossups_neg;
    }
    const tuTotal = Object.values(tu).reduce((a, b) => ({ c: a.c + b.c, n: a.n + b.n }), { c: 0, n: 0 });
    const tuAcc   = tuTotal.c + tuTotal.n > 0 ? Math.round(tuTotal.c / (tuTotal.c + tuTotal.n) * 100) : null;

    const periodLabel = period === 0 ? 'All time' : `Last ${period} days`;

    const studyLines = totalMins === 0
      ? ['No logs yet.']
      : [
          `**${(totalMins / 60).toFixed(1)} hrs total**`,
          ...Object.entries(mins).map(([s, m]) => `${SUBJECTS[s]}: ${(m / 60).toFixed(1)}h`),
        ];

    const tuLines = Object.keys(tu).length === 0
      ? ['No meeting data yet.']
      : [
          tuAcc !== null ? `**Overall: ${tuTotal.c}✓ ${tuTotal.n}✗ (${tuAcc}%)**` : '',
          ...Object.entries(tu).map(([s, d]) => {
            const acc = d.c + d.n > 0 ? Math.round(d.c / (d.c + d.n) * 100) : 0;
            return `${SUBJECTS[s]}: ${d.c}✓ ${d.n}✗ (${acc}%)`;
          }),
        ].filter(Boolean);

    const embed = new EmbedBuilder()
      .setTitle(`${profile.full_name}`)
      .setColor(0xc53030)
      .addFields(
        { name: `Study Time — ${periodLabel}`, value: studyLines.join('\n'), inline: true },
        { name: 'Meeting Toss-ups — All time', value: tuLines.join('\n'), inline: true },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
