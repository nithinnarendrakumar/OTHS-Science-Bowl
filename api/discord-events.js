// Serverless function — proxies Discord channel messages and extracts meeting dates
// Token stays server-side; client only sees parsed events.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const token     = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;

  if (!token || !channelId) {
    return res.status(500).json({ error: 'Discord not configured.' });
  }

  try {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages?limit=50`,
      { headers: { Authorization: `Bot ${token}` } }
    );

    if (!response.ok) {
      const body = await response.text();
      return res.status(response.status).json({ error: `Discord API error: ${response.status}`, detail: body });
    }

    const messages = await response.json();
    const events   = [];

    for (const msg of messages) {
      // Collect all text from message: content + embed titles/descriptions/fields
      const texts = [msg.content || ''];
      for (const embed of (msg.embeds || [])) {
        if (embed.title)       texts.push(embed.title);
        if (embed.description) texts.push(embed.description);
        for (const f of (embed.fields || [])) texts.push(`${f.name} ${f.value}`);
      }
      const fullText = texts.filter(Boolean).join('\n');
      if (!fullText.trim()) continue;

      const extracted = extractDates(fullText, msg.timestamp);
      for (const ev of extracted) {
        events.push({
          date:    ev.date,
          time:    ev.time || null,
          title:   extractTitle(fullText),
          snippet: fullText.slice(0, 120).replace(/\n/g, ' '),
          url:     `https://discord.com/channels/${msg.guild_id || '@me'}/${channelId}/${msg.id}`,
          source:  'discord',
        });
      }
    }

    // Deduplicate by date + title
    const seen = new Set();
    const deduped = events.filter(e => {
      const key = e.date + e.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return res.status(200).json({ events: deduped, connected: true, scanned: messages.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ── Date extraction ────────────────────────────────────────────────────────

const MONTHS = {
  january:1, february:2, march:3, april:4, may:5, june:6,
  july:7, august:8, september:9, october:10, november:11, december:12,
  jan:1, feb:2, mar:3, apr:4, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
};

const WEEKDAYS = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };

function extractDates(text, msgTimestamp) {
  const results = [];
  const msgDate = new Date(msgTimestamp);
  const lower   = text.toLowerCase();

  // 1. ISO format: 2026-05-16
  const isoRe = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  let m;
  while ((m = isoRe.exec(text)) !== null) {
    results.push({ date: `${m[1]}-${m[2]}-${m[3]}`, time: extractTime(text, m.index) });
  }

  // 2. Written: May 16, May 16th, 16 May, 16th of May
  const writtenRe = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b|\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/gi;
  while ((m = writtenRe.exec(lower)) !== null) {
    const monthStr = (m[1] || m[4]);
    const day      = parseInt(m[2] || m[3]);
    const monthNum = MONTHS[monthStr];
    if (!monthNum || !day || day > 31) continue;
    const year = guessYear(monthNum, day, msgDate);
    const date = `${year}-${String(monthNum).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    results.push({ date, time: extractTime(text, m.index) });
  }

  // 3. Weekday references: "this friday", "next monday", "on thursday"
  const wdRe = /\b(?:this|next|on)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;
  while ((m = wdRe.exec(lower)) !== null) {
    const wdTarget = WEEKDAYS[m[1].toLowerCase()];
    const base = new Date(msgDate);
    const isNext = /next/i.test(m[0]);
    let diff = (wdTarget - base.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    if (isNext) diff += 7;
    base.setDate(base.getDate() + diff);
    const date = base.toISOString().slice(0, 10);
    if (!results.find(r => r.date === date)) {
      results.push({ date, time: extractTime(text, m.index) });
    }
  }

  // 4. "today" / "tomorrow"
  if (/\btoday\b/i.test(text)) {
    const date = msgDate.toISOString().slice(0, 10);
    if (!results.find(r => r.date === date)) {
      results.push({ date, time: extractTime(text, 0) });
    }
  }
  if (/\btomorrow\b/i.test(text)) {
    const tom = new Date(msgDate);
    tom.setDate(tom.getDate() + 1);
    const date = tom.toISOString().slice(0, 10);
    if (!results.find(r => r.date === date)) {
      results.push({ date, time: extractTime(text, 0) });
    }
  }

  // Filter out past dates more than 7 days ago
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  return results.filter(r => r.date >= cutoff);
}

function extractTime(text, nearIndex) {
  // Look for time patterns within 60 chars of the date mention
  const slice = text.slice(Math.max(0, nearIndex - 10), nearIndex + 80);
  const m = slice.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM)\b|\b(\d{2}):(\d{2})\b/);
  if (!m) return null;
  return m[0].trim();
}

function guessYear(month, day, msgDate) {
  const y = msgDate.getFullYear();
  const msgMonth = msgDate.getMonth() + 1;
  // If the month is earlier than the message's month, assume next year
  if (month < msgMonth - 1) return y + 1;
  return y;
}

function extractTitle(text) {
  // First meaningful line of the message
  const first = text.split('\n').find(l => l.trim().length > 3) || text;
  return first.trim().slice(0, 60);
}
