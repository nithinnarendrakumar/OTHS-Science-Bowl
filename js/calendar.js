// Calendar page — meetings from DB only

let calProfile, isOfficer = false;
let currentYear, currentMonth;
let allEvents = [];

async function init() {
  const auth = await requireAuth('student');
  if (!auth) return;
  calProfile = auth.profile;
  isOfficer = calProfile.role === 'officer';

  if (isOfficer) document.getElementById('officer-controls').classList.remove('hidden');

  const now = new Date();
  currentYear  = now.getFullYear();
  currentMonth = now.getMonth();

  await loadEvents();
  renderCalendar();
  renderUpcoming();
}

async function loadEvents() {
  const { data } = await sb.from('meetings').select('id,meeting_date,notes').order('meeting_date');
  allEvents = (data || []).map(m => ({
    id:      m.id,
    date:    m.meeting_date,
    notes:   m.notes || '',
    planned: m.meeting_date > fmtDate(new Date()),
  }));
}

function renderCalendar() {
  const title = new Date(currentYear, currentMonth, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  document.getElementById('cal-title').textContent = title;

  const dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  document.getElementById('cal-header').innerHTML =
    dayNames.map(d => `<div class="cal-header-cell">${d}</div>`).join('');

  const firstDay   = new Date(currentYear, currentMonth, 1);
  const lastDay    = new Date(currentYear, currentMonth + 1, 0);
  const today      = fmtDate(new Date());
  const startOffset = (firstDay.getDay() + 6) % 7;
  const totalCells  = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7;

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

    const cls    = ['cal-cell', !isCurrentMonth ? 'other-month' : '', isToday ? 'today' : ''].filter(Boolean).join(' ');
    const evHtml = events.map(e => {
      const label = (e.notes || 'Meeting').slice(0, 28);
      const ecls  = ['cal-event', e.planned ? 'planned' : ''].filter(Boolean).join(' ');
      return `<div class="${ecls}" title="${e.notes}">${label}</div>`;
    }).join('');

    cells += `<div class="${cls}">
      ${isCurrentMonth ? `<div class="cal-day">${dayNum}</div>${evHtml}` : ''}
    </div>`;
  }

  document.getElementById('cal-body').innerHTML = cells;
}

function renderUpcoming() {
  const today    = fmtDate(new Date());
  const upcoming = allEvents.filter(e => e.date >= today).slice(0, 10);
  const tbody    = document.getElementById('upcoming-list');

  if (!upcoming.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="muted" style="padding:12px 0">No upcoming meetings scheduled.</td></tr>';
    return;
  }

  tbody.innerHTML = upcoming.map(e => `
    <tr>
      <td>${e.date}</td>
      <td style="color:var(--muted)">${e.notes || '–'}</td>
      <td><span class="tag ${e.planned ? 'warn' : 'ok'}">${e.planned ? 'Planned' : 'Confirmed'}</span></td>
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
    notes: notesFull || null,
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
