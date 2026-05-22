// POST /api/interactions — Discord slash command handler (REST, no gateway)
// Register the interactions endpoint URL in Discord Dev Portal → Bot → Interactions Endpoint URL

import { webcrypto } from 'crypto';

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

async function verify(sig, ts, rawBody) {
  try {
    const key = await webcrypto.subtle.importKey(
      'raw',
      Buffer.from(PUBLIC_KEY, 'hex'),
      { name: 'Ed25519' },
      false,
      ['verify']
    );
    const data = new TextEncoder().encode(ts + rawBody);
    const signature = Buffer.from(sig, 'hex');
    return await webcrypto.subtle.verify('Ed25519', key, signature, data);
  } catch (e) {
    console.error('Verify error:', e.message);
    return false;
  }
}

async function getRawBody(req) {
  // Vercel may pre-buffer the body on req.body as a string/Buffer
  if (req.body) {
    return typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    const t = setTimeout(() => reject(new Error('Body read timeout')), 2500);
    req.on('data', c => chunks.push(c));
    req.on('end', () => { clearTimeout(t); resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', e => { clearTimeout(t); reject(e); });
  });
}

async function isCoach(discordId) {
  const rows = await sb.get('profiles', `discord_id=eq.${discordId}&role=eq.officer&select=id`);
  return Array.isArray(rows) && rows.length > 0;
}

async function findPlayer(name) {
  const encoded = encodeURIComponent(`%${name}%`);
  const rows = await sb.get('profiles', `full_name=ilike.${encoded}&select=id,full_name`);
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
    if (!await isCoach(discordId)) return respond('Only officers can log meetings. Link your account with `/link` first.');
    const date = opts.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return respond('Date must be YYYY-MM-DD format.');

    const existing = await findMeeting(date);
    if (existing) return respond(`Meeting on ${date} already exists. Use \`/log-scores\` to add stats.`);

    await sb.post('meetings', { meeting_date: date, notes: opts.notes || null });
    return respond(`Meeting on **${date}** created. Use \`/log-scores\` to add player stats.`);
  }

  // ── /log-scores ───────────────────────────────────────────────────
  if (cmd === 'log-scores') {
    if (!await isCoach(discordId)) return respond('Only officers can log scores.');

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
    if (!await isCoach(discordId)) return respond('Only officers can send notifications.');
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

    const player = players[0];

    // Look up email via admin API
    const adminRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${player.id}`, {
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
    });
    if (!adminRes.ok) return respond('Account not found in auth. Ask your officer to check your profile.');
    const { email } = await adminRes.json();

    // Verify password via sign-in
    const signIn = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY },
      body: JSON.stringify({ email, password: opts.password }),
    });
    if (!signIn.ok) return respond('Incorrect password. Try again.');

    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${player.id}`, {
      method: 'PATCH',
      headers: sb.headers,
      body: JSON.stringify({ discord_id: discordId }),
    });
    return respond(`Linked to **${player.full_name}**. Bot commands now apply to your account.`);
  }

  return respond('Unknown command.');
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!PUBLIC_KEY) return res.status(500).json({ error: 'DISCORD_PUBLIC_KEY not set' });

    const sig = req.headers['x-signature-ed25519'];
    const ts  = req.headers['x-signature-timestamp'];
    const raw = await getRawBody(req);

    if (!sig || !ts || !await verify(sig, ts, raw)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const interaction = JSON.parse(raw);

    if (interaction.type === 1) {
      return res.status(200).json({ type: 1 });
    }

    if (interaction.type === 2) {
      const response = await handleCommand(interaction);
      return res.status(200).json(response);
    }

    return res.status(400).json({ error: 'Unknown interaction type' });
  } catch (e) {
    console.error('Handler error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
