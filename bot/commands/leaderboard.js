const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Rank all students')
    .addStringOption(o =>
      o.setName('type').setDescription('What to rank by').setRequired(false)
        .addChoices(
          { name: 'Study hours', value: 'study' },
          { name: 'Tossup accuracy', value: 'tossups' },
        ))
    .addStringOption(o =>
      o.setName('period').setDescription('Time range (study hours only)').setRequired(false)
        .addChoices(
          { name: '7 days',  value: '7'  },
          { name: '30 days', value: '30' },
          { name: 'All time', value: '0' },
        )),

  async execute(interaction, sb) {
    await interaction.deferReply();
    const type   = interaction.options.getString('type') ?? 'study';
    const period = parseInt(interaction.options.getString('period') ?? '7');

    const { data: students } = await sb.from('profiles')
      .select('id, full_name').eq('role', 'student');

    if (!students?.length) return interaction.editReply('No students found.');

    const ids = students.map(s => s.id);

    if (type === 'study') {
      let query = sb.from('daily_logs')
        .select('user_id, bio_minutes, chem_minutes, physics_minutes, earth_space_minutes, math_minutes')
        .in('user_id', ids);
      if (period > 0) {
        const cutoff = new Date(Date.now() - period * 86400000).toISOString().slice(0, 10);
        query = query.gte('log_date', cutoff);
      }
      const { data: logs } = await query;

      const totals = {};
      for (const l of (logs || [])) {
        totals[l.user_id] ??= 0;
        totals[l.user_id] += l.bio_minutes + l.chem_minutes + l.physics_minutes + l.earth_space_minutes + l.math_minutes;
      }

      const ranked = students
        .map(s => ({ name: s.full_name, mins: totals[s.id] ?? 0 }))
        .sort((a, b) => b.mins - a.mins);

      const medals = ['🥇', '🥈', '🥉'];
      const lines  = ranked.map((s, i) =>
        `${medals[i] ?? `${i + 1}.`} **${s.name}** — ${(s.mins / 60).toFixed(1)}h`
      );

      const periodLabel = period === 0 ? 'All time' : `Last ${period} days`;
      const embed = new EmbedBuilder()
        .setTitle(`Study Hours — ${periodLabel}`)
        .setColor(0xc53030)
        .setDescription(lines.join('\n'))
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    // Tossup accuracy
    const { data: tossups } = await sb.from('meeting_player_stats')
      .select('user_id, tossups_correct, tossups_neg')
      .in('user_id', ids);

    const tuMap = {};
    for (const t of (tossups || [])) {
      tuMap[t.user_id] ??= { c: 0, n: 0 };
      tuMap[t.user_id].c += t.tossups_correct;
      tuMap[t.user_id].n += t.tossups_neg;
    }

    const ranked = students
      .map(s => {
        const d   = tuMap[s.id] ?? { c: 0, n: 0 };
        const tot = d.c + d.n;
        return { name: s.full_name, c: d.c, n: d.n, acc: tot > 0 ? d.c / tot : -1 };
      })
      .sort((a, b) => b.acc - a.acc);

    const medals = ['🥇', '🥈', '🥉'];
    const lines  = ranked.map((s, i) => {
      const acc = s.acc >= 0 ? `${Math.round(s.acc * 100)}% (${s.c}✓ ${s.n}✗)` : 'no data';
      return `${medals[i] ?? `${i + 1}.`} **${s.name}** — ${acc}`;
    });

    const embed = new EmbedBuilder()
      .setTitle('Tossup Accuracy — All time')
      .setColor(0xc53030)
      .setDescription(lines.join('\n'))
      .setTimestamp();
    return interaction.editReply({ embeds: [embed] });
  },
};
