// Student dashboard logic

let currentUser, currentProfile, todayLog, userGoal, mySubjects;
const today = fmtDate(new Date());

async function init() {
  const auth = await requireAuth('student');
  if (!auth) return;
  currentUser    = auth.session.user;
  currentProfile = auth.profile;

  // Subjects this student actually covers
  const specs = currentProfile.specialties || ['bio','chem','physics','earth_space','math'];
  mySubjects = SUBJECTS.filter(s => specs.includes(s.key));

  document.getElementById('hdr-name').textContent = currentProfile.full_name;
  document.getElementById('hdr-specialty').textContent =
    mySubjects.map(s => s.label).join(' · ');

  if (currentProfile.role === 'coach') {
    document.getElementById('link-coach').classList.remove('hidden');
  }

  buildSubjectFields();
  buildSubjectSettings();
  await Promise.all([loadGoal(), loadTodayLog(), loadWeek(), loadPracticeTests(), loadTextbooks(), loadMeetingStats()]);
  renderStats();
}

// ── Subject self-selection ─────────────────────────────────────────────────
function buildSubjectSettings() {
  const wrap = document.getElementById('my-subject-checks');
  const current = currentProfile.specialties || SUBJECTS.map(s => s.key);
  wrap.innerHTML = SUBJECTS.map(s => `
    <label class="subject-check-label ${current.includes(s.key) ? 'active' : ''}" id="scl-${s.key}">
      <input type="checkbox" value="${s.key}" id="sc-${s.key}"
        ${current.includes(s.key) ? 'checked' : ''}
        onchange="document.getElementById('scl-${s.key}').classList.toggle('active', this.checked)"
        style="width:auto;border:none;border-bottom:none" />
      ${s.label}
    </label>`).join('');
}

document.getElementById('btn-save-subjects').addEventListener('click', async () => {
  const selected = SUBJECTS.filter(s => document.getElementById(`sc-${s.key}`)?.checked).map(s => s.key);
  if (!selected.length) { alert('Select at least one subject.'); return; }

  const { error } = await sb.from('profiles').update({ specialties: selected }).eq('id', currentUser.id);
  if (error) { alert('Error: ' + error.message); return; }

  currentProfile.specialties = selected;
  mySubjects = SUBJECTS.filter(s => selected.includes(s.key));
  document.getElementById('hdr-specialty').textContent = mySubjects.map(s => s.label).join(' · ');
  buildSubjectFields();
  alert('Subjects updated. Your log form has been refreshed.');
});

// ── Build subject input fields from specialty ──────────────────────────────
function buildSubjectFields() {
  const grid = document.getElementById('subject-fields');
  grid.innerHTML = mySubjects.map(s => `
    <div class="field">
      <label>${s.label} (min)</label>
      <input type="number" id="min-${s.key}" min="0" value="0" />
    </div>`).join('') + `
    <div class="field">
      <label>Anki (min)</label>
      <input type="number" id="anki-min" min="0" value="0" />
    </div>`;
}

// ── Goal ──────────────────────────────────────────────────────────────────
async function loadGoal() {
  const { data } = await sb.from('student_goals').select('*').eq('user_id', currentUser.id).maybeSingle();
  userGoal = data || { min_daily_minutes: DEFAULT_DAILY_MIN, min_weekly_minutes: DEFAULT_WEEKLY_MIN };
  document.getElementById('goal-daily').textContent  = userGoal.min_daily_minutes + 'm';
  document.getElementById('goal-weekly').textContent = userGoal.min_weekly_minutes + 'm';
}

// ── Today's log ────────────────────────────────────────────────────────────
async function loadTodayLog() {
  const { data } = await sb.from('daily_logs').select('*')
    .eq('user_id', currentUser.id).eq('log_date', today).maybeSingle();
  todayLog = data;

  if (todayLog) {
    for (const s of mySubjects) {
      const el = document.getElementById(`min-${s.key}`);
      if (el) el.value = todayLog[s.col] || 0;
    }
    const ankiEl = document.getElementById('anki-min');
    if (ankiEl) ankiEl.value = todayLog.anki_minutes || 0;
    document.getElementById('log-notes').value = todayLog.notes || '';
    document.getElementById('submit-label').textContent = 'Update Log';
  }
}

document.getElementById('log-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const notes = document.getElementById('log-notes').value.trim();
  if (notes.length < 80) {
    document.getElementById('log-notes').focus();
    document.getElementById('notes-counter').className = 'char-count warn';
    alert(`Notes must be at least 80 characters. Currently ${notes.length}.`);
    return;
  }

  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  document.getElementById('submit-label').textContent = 'Saving…';

  const payload = { user_id: currentUser.id, log_date: today, updated_at: new Date().toISOString() };

  // Zero all subjects first, then fill in what this student tracks
  for (const s of SUBJECTS) payload[s.col] = 0;
  for (const s of mySubjects) {
    payload[s.col] = parseInt(document.getElementById(`min-${s.key}`)?.value) || 0;
  }
  payload.anki_minutes = parseInt(document.getElementById('anki-min')?.value) || 0;
  payload.notes = document.getElementById('log-notes').value.trim();

  const { error } = await sb.from('daily_logs').upsert(payload, { onConflict: 'user_id,log_date' });

  btn.disabled = false;
  document.getElementById('submit-label').textContent = 'Update Log';

  if (error) { alert('Error: ' + error.message); return; }

  await saveTextbookEntries();
  await savePracticeTestEntries();
  await loadTodayLog();
  await loadWeek();
  renderStats();
});

// ── Week table ─────────────────────────────────────────────────────────────
let weekLogs = [];

async function loadWeek() {
  const ws = fmtDate(weekStart());
  const we = fmtDate(new Date(weekStart().getTime() + 6 * 86400000));
  const { data } = await sb.from('daily_logs').select('*')
    .eq('user_id', currentUser.id).gte('log_date', ws).lte('log_date', we);
  weekLogs = data || [];
  renderWeekTable();
}

function renderWeekTable() {
  const ws = weekStart();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(ws.getTime() + i * 86400000);
    return { date: fmtDate(d), label: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i], d };
  });

  const logByDate = {};
  for (const l of weekLogs) logByDate[l.log_date] = l;

  const thead = document.getElementById('week-thead');
  thead.innerHTML = '<tr><th>Subject</th>' +
    days.map(d => `<th class="${d.date === today ? 'today' : ''}">${d.label}<br><span style="font-weight:400;font-size:10px">${d.date.slice(5)}</span></th>`).join('') +
    '<th class="right">Total</th></tr>';

  const tbody = document.getElementById('week-tbody');
  let rows = '';
  let weekTotal = 0;

  for (const s of mySubjects) {
    let rowTotal = 0;
    const cells = days.map(d => {
      const log = logByDate[d.date];
      const val = log ? (log[s.col] || 0) : null;
      if (val !== null && val > 0) rowTotal += val;
      const isPast = d.d < new Date() && d.date !== today;
      const cls = d.date === today ? 'today' : '';
      if (val === null && isPast) return `<td class="${cls} miss">×</td>`;
      if (val === 0 || val === null) return `<td class="${cls} zero">–</td>`;
      return `<td class="${cls}">${val}m</td>`;
    }).join('');
    weekTotal += rowTotal;
    rows += `<tr><td>${s.label}</td>${cells}<td class="num right">${rowTotal || '–'}</td></tr>`;
  }

  // Anki row
  let ankiTotal = 0;
  const ankiCells = days.map(d => {
    const log = logByDate[d.date];
    const val = log ? (log.anki_minutes || 0) : null;
    if (val !== null && val > 0) ankiTotal += val;
    const isPast = d.d < new Date() && d.date !== today;
    const cls = d.date === today ? 'today' : '';
    if (val === null && isPast) return `<td class="${cls} miss">×</td>`;
    if (val === 0 || val === null) return `<td class="${cls} zero">–</td>`;
    return `<td class="${cls}">${val}m</td>`;
  }).join('');
  rows += `<tr style="color:var(--muted)"><td>Anki</td>${ankiCells}<td class="num right">${ankiTotal || '–'}</td></tr>`;

  // Total row
  const totalCells = days.map(d => {
    const log = logByDate[d.date];
    const isPast = d.d < new Date() && d.date !== today;
    const cls = d.date === today ? 'today' : '';
    if (!log) return isPast ? `<td class="${cls} miss">×</td>` : `<td class="${cls}"></td>`;
    const t = mySubjects.reduce((a, s) => a + (log[s.col] || 0), 0);
    const dim = t < userGoal.min_daily_minutes ? 'style="color:var(--muted)"' : '';
    return `<td class="${cls}" ${dim}><b>${t}m</b></td>`;
  }).join('');
  rows += `<tr style="border-top:1px solid var(--border2)"><td><b>Total</b></td>${totalCells}<td class="num right"><b>${weekTotal}m</b></td></tr>`;

  tbody.innerHTML = rows;

  // Update stat cards
  document.getElementById('stat-week').textContent = weekTotal;
  const p = Math.round((weekTotal / userGoal.min_weekly_minutes) * 100);
  document.getElementById('stat-goal-pct').textContent = p + '%';
}

// ── Stats ──────────────────────────────────────────────────────────────────
async function renderStats() {
  const from = fmtDate(new Date(Date.now() - 60 * 86400000));
  const { data } = await sb.from('daily_logs')
    .select('log_date,' + mySubjects.map(s => s.col).join(','))
    .eq('user_id', currentUser.id).gte('log_date', from).order('log_date', { ascending: false });

  const logDates = new Set((data || []).filter(l =>
    mySubjects.reduce((a, s) => a + (l[s.col] || 0), 0) > 0
  ).map(l => l.log_date));

  let streak = 0, d = new Date();
  if (!logDates.has(fmtDate(d))) d = new Date(d.getTime() - 86400000);
  while (logDates.has(fmtDate(d))) { streak++; d = new Date(d.getTime() - 86400000); }
  document.getElementById('stat-streak').textContent = streak;

  // Neglect: any specialty subject not studied in 7 days?
  const from7 = fmtDate(new Date(Date.now() - 7 * 86400000));
  const { data: recent } = await sb.from('daily_logs')
    .select(mySubjects.map(s => s.col).join(','))
    .eq('user_id', currentUser.id).gte('log_date', from7);

  const alerts = [];
  for (const s of mySubjects) {
    const total = (recent || []).reduce((a, l) => a + (l[s.col] || 0), 0);
    if (total === 0) alerts.push(s.label);
  }

  const alertEl = document.getElementById('neglect-alerts');
  alertEl.innerHTML = alerts.length
    ? `<div class="alert warn">No study logged for ${alerts.join(', ')} in the past 7 days.</div>`
    : '';
}

// ── Textbook entries ───────────────────────────────────────────────────────
async function loadTextbooks() {
  const from30 = fmtDate(new Date(Date.now() - 30 * 86400000));
  const { data } = await sb.from('textbook_entries').select('*')
    .eq('user_id', currentUser.id).gte('log_date', from30).order('log_date', { ascending: false });
  const tbody = document.getElementById('tb-history');
  if (!data?.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted" style="padding:12px 0">None yet.</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(e => `
    <tr>
      <td>${e.log_date}</td>
      <td>${SUBJECTS.find(s=>s.key===e.subject)?.label || e.subject}</td>
      <td>${e.textbook_name}</td>
      <td class="mono">${e.pages_start}–${e.pages_end}</td>
      <td class="num">${e.pages_end - e.pages_start}</td>
    </tr>`).join('');
}

function addTbRow() {
  const id = Date.now();
  const row = document.createElement('div');
  row.className = 'entry-row';
  row.id = `tb-${id}`;
  row.innerHTML = `
    <select style="max-width:110px">
      ${mySubjects.map(s => `<option value="${s.key}">${s.label}</option>`).join('')}
    </select>
    <input type="text" placeholder="Textbook / resource" style="flex:2" />
    <input type="number" placeholder="p. from" min="0" style="max-width:70px" />
    <input type="number" placeholder="p. to"   min="0" style="max-width:70px" />
    <button type="button" class="small danger" onclick="this.closest('.entry-row').remove()">✕</button>`;
  document.getElementById('tb-rows').appendChild(row);
}

async function saveTextbookEntries() {
  const rows = document.querySelectorAll('#tb-rows .entry-row');
  await sb.from('textbook_entries').delete().eq('user_id', currentUser.id).eq('log_date', today);
  const inserts = [];
  rows.forEach(row => {
    const [subEl, nameEl, startEl, endEl] = row.querySelectorAll('select, input');
    const name = nameEl.value.trim();
    const start = parseInt(startEl.value), end = parseInt(endEl.value);
    if (name && !isNaN(start) && !isNaN(end) && end >= start)
      inserts.push({ user_id: currentUser.id, log_date: today, subject: subEl.value, textbook_name: name, pages_start: start, pages_end: end });
  });
  if (inserts.length) await sb.from('textbook_entries').insert(inserts);
  await loadTextbooks();
}

// ── Practice test entries ──────────────────────────────────────────────────
async function loadPracticeTests() {
  const from60 = fmtDate(new Date(Date.now() - 60 * 86400000));
  const { data } = await sb.from('practice_test_entries').select('*')
    .eq('user_id', currentUser.id).gte('log_date', from60).order('log_date', { ascending: false });
  const tbody = document.getElementById('pt-history');
  if (!data?.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted" style="padding:12px 0">None yet.</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(e => {
    const p = e.score_total ? Math.round((e.score_correct / e.score_total) * 100) : null;
    return `<tr>
      <td>${e.log_date}</td>
      <td>${e.test_name}</td>
      <td>${SUBJECTS.find(s=>s.key===e.subject)?.label || (e.subject === 'mixed' ? 'Mixed' : '–')}</td>
      <td class="mono">${e.score_correct ?? '–'}/${e.score_total ?? '–'}</td>
      <td class="num">${p !== null ? p + '%' : '–'}</td>
    </tr>`;
  }).join('');
}

function addPtRow() {
  const id = Date.now();
  const row = document.createElement('div');
  row.className = 'entry-row';
  row.id = `pt-${id}`;
  row.innerHTML = `
    <input type="text" placeholder="Test / packet name" style="flex:2" />
    <select style="max-width:110px">
      <option value="mixed">Mixed</option>
      ${mySubjects.map(s => `<option value="${s.key}">${s.label}</option>`).join('')}
    </select>
    <input type="number" placeholder="Correct" min="0" style="max-width:70px" />
    <span class="muted" style="font-size:11px">/</span>
    <input type="number" placeholder="Total" min="1" style="max-width:70px" />
    <button type="button" class="small danger" onclick="this.closest('.entry-row').remove()">✕</button>`;
  document.getElementById('pt-rows').appendChild(row);
}

async function savePracticeTestEntries() {
  const rows = document.querySelectorAll('#pt-rows .entry-row');
  await sb.from('practice_test_entries').delete().eq('user_id', currentUser.id).eq('log_date', today);
  const inserts = [];
  rows.forEach(row => {
    const nameEl = row.querySelector('input[type="text"]');
    const subEl  = row.querySelector('select');
    const nums   = row.querySelectorAll('input[type="number"]');
    const name = nameEl.value.trim();
    if (name) inserts.push({
      user_id: currentUser.id, log_date: today, test_name: name,
      subject: subEl.value,
      score_correct: nums[0].value !== '' ? parseInt(nums[0].value) : null,
      score_total:   nums[1].value !== '' ? parseInt(nums[1].value) : null,
    });
  });
  if (inserts.length) await sb.from('practice_test_entries').insert(inserts);
  await loadPracticeTests();
}

// ── Meeting stats ──────────────────────────────────────────────────────────
async function loadMeetingStats() {
  const from60 = fmtDate(new Date(Date.now() - 60 * 86400000));

  // Get meetings the student attended
  const { data: attendance } = await sb.from('meeting_attendance')
    .select('meeting_id').eq('user_id', currentUser.id);
  if (!attendance?.length) {
    document.getElementById('meeting-stats').innerHTML =
      '<tr><td colspan="5" class="muted" style="padding:12px 0">No meetings logged yet.</td></tr>';
    return;
  }

  const mids = attendance.map(a => a.meeting_id);
  const [{ data: stats }, { data: meetings }] = await Promise.all([
    sb.from('meeting_player_stats').select('*').eq('user_id', currentUser.id).in('meeting_id', mids),
    sb.from('meetings').select('id,meeting_date').in('id', mids).gte('meeting_date', from60).order('meeting_date', { ascending: false }),
  ]);

  const dateByMid = {};
  for (const m of (meetings||[])) dateByMid[m.id] = m.meeting_date;

  const statsByMid = {};
  for (const s of (stats||[])) {
    if (!statsByMid[s.meeting_id]) statsByMid[s.meeting_id] = [];
    statsByMid[s.meeting_id].push(s);
  }

  const tbody = document.getElementById('meeting-stats');
  const recentMids = (meetings||[]).map(m => m.id);

  if (!recentMids.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted" style="padding:12px 0">No meetings in last 60 days.</td></tr>';
    return;
  }

  let rows = '';
  for (const mid of recentMids) {
    const date = dateByMid[mid];
    const mStats = statsByMid[mid] || [];
    const totalCorrect = mStats.reduce((a, s) => a + s.tossups_correct, 0);
    const totalNeg     = mStats.reduce((a, s) => a + s.tossups_neg, 0);
    const pts = (totalCorrect - totalNeg) * 4;

    if (!mStats.length) {
      rows += `<tr><td>${date}</td><td class="muted" colspan="4">Present — no toss-up data recorded</td></tr>`;
      continue;
    }

    // One row per subject with data
    mStats.forEach((s, i) => {
      const subLabel = SUBJECTS.find(x => x.key === s.subject)?.label || s.subject;
      const subPts = (s.tossups_correct - s.tossups_neg) * 4;
      rows += `<tr>
        <td>${i === 0 ? date : ''}</td>
        <td>${subLabel}</td>
        <td class="num">${s.tossups_correct || '–'}</td>
        <td class="num" style="color:var(--muted)">${s.tossups_neg > 0 ? '-'+s.tossups_neg : '–'}</td>
        <td class="num">${i === 0 ? `<b>${pts > 0 ? '+' : ''}${pts}</b>` : ''}</td>
      </tr>`;
    });
  }

  tbody.innerHTML = rows;
}

init();
