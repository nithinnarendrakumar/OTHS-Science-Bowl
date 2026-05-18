// Calendar page

let calProfile, isCoach = false;
let currentYear, currentMonth;
let allEvents = []; // { id, meeting_date, notes, is_planned, title }

async function init() {
  const auth = await requireAuth('student');
  if (!auth) return;
  calProfile = auth.profile;
  isCoach = calProfile.role === 'coach';

  if (isCoach) document.getElementById('coach-controls').classList.remove('hidden');

  const now = new Date();
  currentYear  = now.getFullYear();
  currentMonth = now.getMonth();

  await loadEvents();
  renderCalendar();
  renderUpcoming();
}

async function loadEvents() {
  // 1. Meetings from DB
  const { data } = await sb.from('meetings').select('id,meeting_date,notes').order('meeting_date');
  const dbEvents = (data || []).map(m => ({
    id: m.id,
    date: m.meeting_date,
    notes: m.notes || '',
    planned: m.meeting_date > fmtDate(new Date()),
    source: 'db',
  }));

  // 2. Discord announcements
  let discordEvents = [];
  try {
    const res = await fetch('/api/discord-events');
    if (res.ok) {
      const json = await res.json();
      discordEvents = (json.events || []).map(e => ({
        id: 'discord-' + e.date + e.title,
        date: e.date,
        notes: (e.time ? e.time + ' — ' : '') + e.title,
        planned: e.date >= fmtDate(new Date()),
        source: 'discord',
        url: e.url,
      }));
    }
  } catch (err) {
    console.warn('Discord fetch failed:', err);
  }

  // Merge — DB wins on same date
  const dbDates = new Set(dbEvents.map(e => e.date));
  const mergedDiscord = discordEvents.filter(e => !dbDates.has(e.date));
  const merged  = [...dbEvents, ...mergedDiscord];
  allEvents = merged.sort((a, b) => a.date.localeCompare(b.date));

  const today = fmtDate(new Date());
  const upcomingDiscordCount = mergedDiscord.filter(e => e.date >= today).length;
  if (discordEvents.length > 0) updateDiscordStatus(upcomingDiscordCount, true, 0);
}

function updateDiscordStatus(count, connected, scanned) {
  const el = document.getElementById('discord-status');
  if (!connected) return; // leave placeholder text
  if (count > 0) {
    el.className = 'alert info';
    el.textContent = `Discord sync active — ${count} upcoming meeting${count !== 1 ? 's' : ''} pulled from announcements. Events tagged "Discord" are synced automatically.`;
  } else {
    el.className = 'alert info';
    el.textContent = `Discord sync connected (scanned ${scanned} messages). No upcoming meeting dates found yet — post an announcement with a date and it will appear here automatically.`;
  }
}

function renderCalendar() {
  const title = new Date(currentYear, currentMonth, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  document.getElementById('cal-title').textContent = title;

  // Header
  const dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  document.getElementById('cal-header').innerHTML =
    dayNames.map(d => `<div class="cal-header-cell">${d}</div>`).join('');

  // Build days
  const firstDay = new Date(currentYear, currentMonth, 1);
  const lastDay  = new Date(currentYear, currentMonth + 1, 0);
  const today    = fmtDate(new Date());

  // Monday-start offset
  let startOffset = (firstDay.getDay() + 6) % 7;
  const totalCells = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7;

  const eventsByDate = {};
  for (const e of allEvents) {
    if (!eventsByDate[e.date]) eventsByDate[e.date] = [];
    eventsByDate[e.date].push(e);
  }

  let cells = '';
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - startOffset + 1;
    const isCurrentMonth = dayNum >= 1 && dayNum <= lastDay.getDate();
    const dateStr = isCurrentMonth ? fmtDate(new Date(currentYear, currentMonth, dayNum)) : null;
    const isToday = dateStr === today;
    const events  = dateStr ? (eventsByDate[dateStr] || []) : [];

    const cls = ['cal-cell', !isCurrentMonth ? 'other-month' : '', isToday ? 'today' : ''].filter(Boolean).join(' ');
    const evHtml = events.map(e => {
      const label = (e.notes || 'Meeting').slice(0, 28);
      const cls   = ['cal-event', e.planned ? 'planned' : '', e.source === 'discord' ? 'discord' : ''].filter(Boolean).join(' ');
      return e.url
        ? `<a href="${e.url}" target="_blank" rel="noopener" class="${cls}" title="${e.notes}">${label}</a>`
        : `<div class="${cls}" title="${e.notes}">${label}</div>`;
    }).join('');

    cells += `<div class="${cls}">
      ${isCurrentMonth ? `<div class="cal-day">${dayNum}</div>${evHtml}` : ''}
    </div>`;
  }

  document.getElementById('cal-body').innerHTML = cells;
}

function renderUpcoming() {
  const today = fmtDate(new Date());
  const upcoming = allEvents.filter(e => e.date >= today).slice(0, 10);
  const tbody = document.getElementById('upcoming-list');

  if (!upcoming.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="muted" style="padding:12px 0">No upcoming meetings scheduled.</td></tr>';
    return;
  }

  tbody.innerHTML = upcoming.map(e => `
    <tr>
      <td>${e.date}</td>
      <td style="color:var(--muted)">${e.url ? `<a href="${e.url}" target="_blank" style="color:var(--muted);text-decoration:none">${e.notes || '–'}</a>` : (e.notes || '–')}</td>
      <td>
        <span class="tag ${e.planned ? 'warn' : 'ok'}">${e.source === 'discord' ? 'Discord' : e.planned ? 'Planned' : 'Confirmed'}</span>
      </td>
    </tr>`).join('');
}

function prevMonth() {
  currentMonth--;
  if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  renderCalendar();
}

function nextMonth() {
  currentMonth++;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  renderCalendar();
}

function toggleAddEvent() {
  document.getElementById('add-event-form').classList.toggle('hidden');
  document.getElementById('ev-date').value = fmtDate(new Date());
}

document.getElementById('btn-add-event').addEventListener('click', async () => {
  const date  = document.getElementById('ev-date').value;
  const time  = document.getElementById('ev-time').value;
  const title = document.getElementById('ev-title').value.trim();
  const notes = document.getElementById('ev-notes').value.trim();

  if (!date) { alert('Pick a date.'); return; }

  const notesFull = [title, notes, time ? `Time: ${time}` : ''].filter(Boolean).join(' — ');

  const { error } = await sb.from('meetings').insert({
    meeting_date: date,
    notes: notesFull,
    created_by: calProfile.id,
  });

  if (error) { alert('Error: ' + error.message); return; }

  document.getElementById('add-event-form').classList.add('hidden');
  document.getElementById('ev-title').value = '';
  document.getElementById('ev-notes').value = '';

  await loadEvents();
  renderCalendar();
  renderUpcoming();
});

init();
