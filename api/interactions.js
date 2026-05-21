// POST /api/interactions — Discord slash command handler (REST, no gateway)
// Register the interactions endpoint URL in Discord Dev Portal → Bot → Interactions Endpoint URL

import { createServer } from 'http';
import crypto from 'crypto';

export const config = { api: { bodyParser: false } };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const PUBLIC_KEY   = process.env.DISCORD_PUBLIC_KEY;

const sb = {
  headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, 'Content-Type': 'application/json', Prefer: 'return=representation' },
  async get(table, query) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: this.headers });
    return r.json();
  },
  async post(table, body) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: 'POST', headers: this.headers, body: JSON.stringify(body) });
    return r.json();
  },
  async upsert(table, body, onConflict) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...this.headers, Prefer: `resolution=merge-duplicates,return=representation` },
      body: JSON.stringify(body),
    });
    return r.json();
  },
};

function verify(sig, ts, rawBody) {
  try {
    return crypto.verify(
      'ed25519',
      Buffer.from(ts + rawBody),
      Buffer.from(PUBLIC_KEY, 'hex'),
      Buffer.from(sig, 'hex')
    );
  } catch { return false; }
}

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function isCoach(discordId) {
  const rows = await sb.get('profiles', `discord_id=eq.${discordId}&role=eq.coach&select=id`);
  return Array.isArray(rows) && rows.length > 0;
}

async function findPlayer(name) {
  const encoded = encodeURIComponent(`%${name}%`);
  const rows = await sb.get('profiles', `full_name=ilike.${encoded}&role=eq.student&select=id,full_name`);
  return Array.isArray(rows) ? rows : [];
}

async function findMeeting(date) {
  const rows = await sb.get('meetings', `meeting_date=eq.${date}&select=id,meeting_date`);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function respond(content, ephemeral = true) {
  return { type: 4, data: { content, flags: ephemeral ? 64 : 0 } };
}

const SUBJECTS = { bio: 'bio', chem: 'chem', physics: 'physics', earth_space: 'earth_space', math: 'math' };

async function handleCommand(interaction) {
  const cmd        = interaction.data.name;
  const opts       = {};
  for (const o of (interaction.data.options || [])) opts[o.name] = o.value;
  const discordId  = interaction.member?.user?.id || interaction.user?.id;

  // ── /log-meeting ──────────────────────────────────────────────────
  if (cmd === 'log-meeting') {
    if (!await isCoach(discordId)) return respond('Only coaches can log meetings. Link your account with `/link` first.');
    const date = opts.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return respond('Date must be YYYY-MM-DD format.');

    const existing = await findMeeting(date);
    if (existing) return respond(`Meeting on ${date} already exists. Use \`/log-scores\` to add stats.`);

    await sb.post('meetings', { meeting_date: date, notes: opts.notes || null });
    return respond(`Meeting on **${date}** created. Use \`/log-scores\` to add player stats.`);
  }

  // ── /log-scores ───────────────────────────────────────────────────
  if (cmd === 'log-scores') {
    if (!await isCoach(discordId)) return respond('Only coaches can log scores.');

    const meeting = await findMeeting(opts.date);
    if (!meeting) return respond(`No meeting found on ${opts.date}. Create it first with \`/log-meeting\`.`);

    const players = await findPlayer(opts.player);
    if (!players.length) return respond(`No player found matching "${opts.player}".`);
    if (players.length > 1) return respond(`Multiple matches: ${players.map(p => p.full_name).join(', ')}. Be more specific.`);

    const player  = players[0];
    const correct = parseInt(opts.correct) || 0;
    const neg     = parseInt(opts.neg) || 0;

    await sb.upsert('meeting_player_stats', {
      meeting_id: meeting.id, user_id: player.id,
      subject: opts.subject, tossups_correct: correct, tossups_neg: neg,
    });

    const acc = correct + neg > 0 ? Math.round(correct / (correct + neg) * 100) : 0;
    return respond(`Logged **${player.full_name}** on ${opts.date} — ${opts.subject}: ${correct}✓ ${neg}✗ (${acc}%)`);
  }

  // ── /notify ───────────────────────────────────────────────────────
  if (cmd === 'notify') {
    if (!await isCoach(discordId)) return respond('Only coaches can send notifications.');
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) return respond('Webhook not configured.');
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: opts.message, username: 'Science Bowl' }),
    });
    return respond('Notification sent.');
  }

  // ── /link ─────────────────────────────────────────────────────────
  if (cmd === 'link') {
    const players = await findPlayer(opts.name);
    if (!players.length) return respond(`No profile found matching "${opts.name}".`);
    if (players.length > 1) return respond(`Multiple matches: ${players.map(p => p.full_name).join(', ')}. Be more specific.`);

    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${players[0].id}`, {
      method: 'PATCH',
      headers: sb.headers,
      body: JSON.stringify({ discord_id: discordId }),
    });
    return respond(`Linked to **${players[0].full_name}**. You can now use \`/stats\` without a name.`);
  }

  return respond('Unknown command.');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!PUBLIC_KEY) return res.status(500).json({ error: 'DISCORD_PUBLIC_KEY not set' });

  const sig = req.headers['x-signature-ed25519'];
  const ts  = req.headers['x-signature-timestamp'];
  const raw = await getRawBody(req);

  if (!sig || !ts || !verify(sig, ts, raw)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const interaction = JSON.parse(raw);

  // Discord PING — must respond immediately
  if (interaction.type === 1) {
    return res.status(200).json({ type: 1 });
  }

  // Slash command
  if (interaction.type === 2) {
    const response = await handleCommand(interaction);
    return res.status(200).json(response);
  }

  return res.status(400).json({ error: 'Unknown interaction type' });
}
