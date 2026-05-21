// POST /api/notify — sends a message to the Discord reminders webhook
// Requires a valid Supabase session token from a coach account.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return res.status(500).json({ error: 'Discord webhook not configured.' });

  // Verify caller is a coach via Supabase JWT
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: serviceKey },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Invalid session' });
  const user = await userRes.json();

  const profileRes = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}&role=eq.coach&select=id`,
    { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } }
  );
  const profiles = await profileRes.json();
  if (!profiles?.length) return res.status(403).json({ error: 'Coach access required' });

  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'content is required' });

  const discordRes = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: content.trim(), username: 'Science Bowl' }),
  });

  if (!discordRes.ok) {
    const detail = await discordRes.text();
    return res.status(502).json({ error: 'Discord error', detail });
  }

  return res.status(200).json({ ok: true });
}
