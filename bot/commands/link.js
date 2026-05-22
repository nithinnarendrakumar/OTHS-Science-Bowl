const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Discord account to your Science Bowl profile')
    .addStringOption(o =>
      o.setName('name').setDescription('Your full name as registered').setRequired(true)),

  async execute(interaction, sb) {
    await interaction.deferReply({ ephemeral: true });
    const name = interaction.options.getString('name');

    const { data: profiles } = await sb.from('profiles')
      .select('id, full_name, discord_id')
      .ilike('full_name', `%${name}%`)
      .eq('role', 'student')
      .limit(5);

    if (!profiles?.length) {
      return interaction.editReply(`No profile found matching "${name}". Ask your officer to check your name in the system.`);
    }
    if (profiles.length > 1) {
      return interaction.editReply(`Multiple matches: ${profiles.map(p => p.full_name).join(', ')}. Be more specific.`);
    }

    const profile = profiles[0];
    if (profile.discord_id && profile.discord_id !== interaction.user.id) {
      return interaction.editReply(`${profile.full_name} is already linked to a different Discord account.`);
    }

    await sb.from('profiles').update({ discord_id: interaction.user.id }).eq('id', profile.id);
    await interaction.editReply(`Linked to **${profile.full_name}**. You can now use \`/stats\` without specifying a name.`);
  },
};
