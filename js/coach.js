// Coach dashboard logic

let coachProfile;
let allStudents = [];
let allGoals = {};

async function init() {
  const auth = await requireAuth('coach');
  if (!auth) return;
  coachProfile = auth.profile;

  if (auth.profile.role !== 'coach') {
    document.body.innerHTML = '<div style="padding:40px;color:var(--muted)">Access denied.</div>';
    return;
  }

  await loadStudents();
  await loadAllGoals();
  buildGoalDropdown();
  await Promise.all([renderTeamTable(), renderLeaderboard(), renderNeglectAlerts()]);
}

// ── Students & goals ───────────────────────────────────────────────────────
async function loadStudents() {
  const { data } = await sb.from('profiles').select('*').eq('role', 'student').order('full_name');
  allStudents = data || [];
}

async function loadAllGoals() {
  const { data } = await sb.from('student_goals').select('*');
  allGoals = {};
  for (const g of (data || [])) allGoals[g.user_id] = g;
}

function getGoal(uid) {
  return allGoals[uid] || { min_daily_minutes: DEFAULT_DAILY_MIN, min_weekly_minutes: DEFAULT_WEEKLY_MIN };
}

function getSpecialties(student) {
  const specs = student.specialties || ['bio','chem','physics','earth_space','math'];
  return SUBJECTS.filter(s => specs.includes(s.key));
}

// ── Team table ─────────────────────────────────────────────────────────────
async function renderTeamTable() {
  const ws    = fmtDate(weekStart());
  const we    = fmtDate(new Date(weekStart().getTime() + 6*86400000));
  const today = fmtDate(new Date());
  const ids   = allStudents.map(s => s.id);

  if (!ids.length) {
    document.getElementById('team-tbody').innerHTML =
      '<tr><td colspan="11" class="muted" style="padding:20px 0">No students yet.</td></tr>';
    return;
  }

  const [{ data: logs }, { data: logs60 }] = await Promise.all([
    sb.from('daily_logs').select('*').in('user_id', ids).gte('log_date', ws).lte('log_date', we),
    sb.from('daily_logs').select('user_id,log_date,bio_minutes,chem_minutes,physics_minutes,earth_space_minutes,math_minutes')
      .in('user_id', ids).gte('log_date', fmtDate(new Date(Date.now() - 60*86400000))),
  ]);

  const logsByStudent = {};
  for (const l of (logs || [])) {
    if (!logsByStudent[l.user_id]) logsByStudent[l.user_id] = {};
    logsByStudent[l.user_id][l.log_date] = l;
  }

  const logDates60 = {};
  for (const l of (logs60 || [])) {
    const subs = getSpecialties(allStudents.find(s=>s.id===l.user_id)||{});
    const total = subs.reduce((a,s)=>a+(l[s.col]||0),0);
    if (total > 0) {
      if (!logDates60[l.user_id]) logDates60[l.user_id] = new Set();
      logDates60[l.user_id].add(l.log_date);
    }
  }

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart().getTime() + i*86400000);
    return { date: fmtDate(d), label: ['M','T','W','T','F','S','S'][i], d };
  });

  document.getElementById('team-thead').innerHTML =
    `<tr><th>Name</th><th>Specialty</th>${days.map(d=>`<th class="${d.date===today?'today':''}">${d.label}<br><span style="font-weight:400">${d.date.slice(5)}</span></th>`).join('')}<th class="right">Wk</th><th class="right">Goal</th><th class="right">Streak</th></tr>`;

  const tbody = document.getElementById('team-tbody');
  let rows = '';
  const now = new Date();

  for (const student of allStudents) {
    const sLogs = logsByStudent[student.id] || {};
    const goal  = getGoal(student.id);
    const specs = getSpecialties(student);

    let weekTotal = 0;
    const dayCells = days.map(d => {
      const log = sLogs[d.date];
      const total = log ? specs.reduce((a,s)=>a+(log[s.col]||0),0) : 0;
      weekTotal += total;
      const isPast = new Date(d.date+'T23:59:59') < now;
      const cls = d.date === today ? 'today' : '';
      if (!log && isPast) return `<td class="${cls} miss">×</td>`;
      if (!log) return `<td class="${cls}"></td>`;
      if (total === 0) return `<td class="${cls} zero">–</td>`;
      const dim = total < goal.min_daily_minutes ? 'style="color:var(--muted)"' : '';
      return `<td class="${cls}" ${dim}>${total}m</td>`;
    }).join('');

    const goalPct = Math.round((weekTotal / goal.min_weekly_minutes) * 100);
    const goalLabel = goalPct >= 100 ? `<b>${goalPct}%</b>` : `<span class="muted">${goalPct}%</span>`;

    const dates60 = logDates60[student.id] || new Set();
    let streak = 0, d2 = new Date();
    if (!dates60.has(fmtDate(d2))) d2 = new Date(d2.getTime() - 86400000);
    while (dates60.has(fmtDate(d2))) { streak++; d2 = new Date(d2.getTime() - 86400000); }

    const specBadges = specs.map(s => `<span class="spec-badge">${s.label.slice(0,4)}</span>`).join('');

    rows += `
      <tr class="student-row" onclick="toggleStudent('${student.id}')">
        <td>${student.full_name}</td>
        <td>${specBadges}</td>
        ${dayCells}
        <td class="num right">${weekTotal}m</td>
        <td class="right">${goalLabel}</td>
        <td class="num right">${streak}</td>
      </tr>
      <tr class="student-detail hidden" id="detail-${student.id}">
        <td colspan="13"><div class="student-detail-inner" id="detail-inner-${student.id}">Loading…</div></td>
      </tr>`;
  }

  tbody.innerHTML = rows;
}

async function toggleStudent(uid) {
  const row = document.getElementById(`detail-${uid}`);
  if (!row) return;
  const isHidden = row.classList.contains('hidden');
  document.querySelectorAll('.student-detail').forEach(r => r.classList.add('hidden'));
  if (isHidden) { row.classList.remove('hidden'); await loadStudentDetail(uid); }
}

async function loadStudentDetail(uid) {
  const inner   = document.getElementById(`detail-inner-${uid}`);
  const student = allStudents.find(s => s.id === uid);
  const goal    = getGoal(uid);
  const specs   = getSpecialties(student);

  const from14 = fmtDate(new Date(Date.now() - 14*86400000));
  const [{ data: logs }, { data: tests }, { data: books }] = await Promise.all([
    sb.from('daily_logs').select('*').eq('user_id', uid).gte('log_date', from14).order('log_date', {ascending:false}),
    sb.from('practice_test_entries').select('*').eq('user_id', uid).gte('log_date', from14).order('log_date', {ascending:false}),
    sb.from('textbook_entries').select('*').eq('user_id', uid).gte('log_date', from14).order('log_date', {ascending:false}),
  ]);

  const logRows = (logs || []).map(l => {
    const t = specs.reduce((a,s)=>a+(l[s.col]||0),0);
    const dim = t < goal.min_daily_minutes ? 'style="color:var(--muted)"' : '';
    return `<tr>
      <td>${l.log_date}</td>
      ${specs.map(s=>`<td class="num">${l[s.col]||0}m</td>`).join('')}
      <td class="num">${l.anki_minutes||0}m</td>
      <td ${dim}><b>${t}m</b></td>
      <td style="max-width:200px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--muted)">${l.notes||''}</td>
    </tr>`;
  }).join('');

  const ptRows = (tests||[]).map(t => {
    const p = t.score_total ? Math.round((t.score_correct/t.score_total)*100) : null;
    return `<tr><td>${t.log_date}</td><td>${t.test_name}</td><td>${SUBJECTS.find(s=>s.key===t.subject)?.label||t.subject||'Mixed'}</td><td class="mono">${t.score_correct??'–'}/${t.score_total??'–'}</td><td class="num">${p!==null?p+'%':'–'}</td></tr>`;
  }).join('');

  const tbRows = (books||[]).map(b =>
    `<tr><td>${b.log_date}</td><td>${SUBJECTS.find(s=>s.key===b.subject)?.label||b.subject}</td><td>${b.textbook_name}</td><td class="mono">${b.pages_start}–${b.pages_end} (${b.pages_end-b.pages_start}p)</td></tr>`
  ).join('');

  inner.innerHTML = `
    <p style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin-bottom:12px">
      ${student.full_name} &nbsp;·&nbsp; ${specs.map(s=>s.label).join(', ')} &nbsp;·&nbsp; goal ${goal.min_daily_minutes}m/day · ${goal.min_weekly_minutes}m/wk
    </p>
    <div class="table-wrap" style="margin-bottom:16px">
      <table style="font-size:12px">
        <thead><tr><th>Date</th>${specs.map(s=>`<th>${s.label.slice(0,4)}</th>`).join('')}<th>Anki</th><th>Total</th><th>Notes</th></tr></thead>
        <tbody>${logRows || '<tr><td colspan="10" class="muted" style="padding:8px 0">No logs.</td></tr>'}</tbody>
      </table>
    </div>
    ${tests?.length ? `<div class="table-wrap" style="margin-bottom:16px"><table style="font-size:12px">
      <thead><tr><th>Date</th><th>Test</th><th>Subject</th><th>Score</th><th>%</th></tr></thead>
      <tbody>${ptRows}</tbody></table></div>` : ''}
    ${books?.length ? `<div class="table-wrap"><table style="font-size:12px">
      <thead><tr><th>Date</th><th>Subject</th><th>Textbook</th><th>Pages</th></tr></thead>
      <tbody>${tbRows}</tbody></table></div>` : ''}`;
}

// ── Leaderboard ────────────────────────────────────────────────────────────
async function renderLeaderboard() {
  const ws = fmtDate(weekStart());
  const we = fmtDate(new Date(weekStart().getTime() + 6*86400000));
  const ids = allStudents.map(s => s.id);
  if (!ids.length) return;

  const { data: logs } = await sb.from('daily_logs')
    .select('user_id,bio_minutes,chem_minutes,physics_minutes,earth_space_minutes,math_minutes,anki_minutes')
    .in('user_id', ids).gte('log_date', ws).lte('log_date', we);

  const totals = {};
  for (const l of (logs||[])) {
    const student = allStudents.find(s=>s.id===l.user_id);
    const specs = getSpecialties(student||{});
    const t = specs.reduce((a,s)=>a+(l[s.col]||0),0) + (l.anki_minutes||0);
    totals[l.user_id] = (totals[l.user_id]||0) + t;
  }

  const ranked = allStudents
    .map(s => ({ name: s.full_name, specs: getSpecialties(s), total: totals[s.id]||0, goal: getGoal(s.id).min_weekly_minutes }))
    .sort((a,b) => b.total - a.total);

  document.getElementById('lb-tbody').innerHTML = ranked.map((s, i) => {
    const pct = Math.round((s.total / s.goal) * 100);
    const w = Math.min(100, pct);
    return `<tr>
      <td class="muted">${i+1}</td>
      <td>${s.name}</td>
      <td style="color:var(--muted);font-size:11px">${s.specs.map(x=>x.label).join(', ')}</td>
      <td class="num">${s.total}m</td>
      <td>
        <div class="flex">
          <div class="bar-track" style="min-width:80px"><div class="bar-fill" style="width:${w}%"></div></div>
          <span style="font-size:11px;color:var(--muted)">${pct}%</span>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ── Neglect alerts ─────────────────────────────────────────────────────────
async function renderNeglectAlerts() {
  const from7 = fmtDate(new Date(Date.now() - 7*86400000));
  const ids = allStudents.map(s=>s.id);
  if (!ids.length) return;

  const { data: logs } = await sb.from('daily_logs')
    .select('user_id,bio_minutes,chem_minutes,physics_minutes,earth_space_minutes,math_minutes')
    .in('user_id', ids).gte('log_date', from7);

  const totals = {};
  for (const l of (logs||[])) {
    if (!totals[l.user_id]) totals[l.user_id] = {};
    for (const s of SUBJECTS) totals[l.user_id][s.key] = (totals[l.user_id][s.key]||0) + (l[s.col]||0);
  }

  const alerts = [];
  for (const student of allStudents) {
    const st = totals[student.id] || {};
    for (const s of getSpecialties(student)) {
      if (!st[s.key]) alerts.push(`${student.full_name} — no ${s.label} in 7 days`);
    }
  }

  const el = document.getElementById('neglect-alerts');
  el.innerHTML = alerts.length
    ? alerts.map(a => `<div class="alert warn">${a}</div>`).join('')
    : '<div class="alert info">No neglect detected. All students are covering their subjects.</div>';
}

// ── Goal & specialty config ────────────────────────────────────────────────
function buildGoalDropdown() {
  const sel = document.getElementById('goal-student');
  sel.innerHTML = '<option value="">— select student —</option>' +
    allStudents.map(s => `<option value="${s.id}">${s.full_name}</option>`).join('');
}

document.getElementById('goal-student').addEventListener('change', (e) => {
  const uid = e.target.value;
  if (!uid) return;
  const g = getGoal(uid);
  document.getElementById('goal-daily-input').value  = g.min_daily_minutes;
  document.getElementById('goal-weekly-input').value = g.min_weekly_minutes;

  const student = allStudents.find(s => s.id === uid);
  const specs = student?.specialties || ['bio','chem','physics','earth_space','math'];
  for (const s of SUBJECTS) {
    const cb = document.getElementById(`spec-${s.key}`);
    if (cb) cb.checked = specs.includes(s.key);
  }
});

document.getElementById('btn-save-goal').addEventListener('click', async () => {
  const uid = document.getElementById('goal-student').value;
  if (!uid) { alert('Select a student first.'); return; }

  const daily  = parseInt(document.getElementById('goal-daily-input').value);
  const weekly = parseInt(document.getElementById('goal-weekly-input').value);
  const specs  = SUBJECTS.filter(s => document.getElementById(`spec-${s.key}`)?.checked).map(s => s.key);

  if (!daily || !weekly) { alert('Enter valid minute values.'); return; }
  if (!specs.length) { alert('Select at least one specialty.'); return; }

  const [goalRes, profileRes] = await Promise.all([
    sb.from('student_goals').upsert({
      user_id: uid, min_daily_minutes: daily, min_weekly_minutes: weekly,
      updated_by: coachProfile.id, updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' }),
    sb.from('profiles').update({ specialties: specs }).eq('id', uid),
  ]);

  if (goalRes.error || profileRes.error) {
    alert('Error: ' + (goalRes.error?.message || profileRes.error?.message));
    return;
  }

  allGoals[uid] = { user_id: uid, min_daily_minutes: daily, min_weekly_minutes: weekly };
  const idx = allStudents.findIndex(s => s.id === uid);
  if (idx >= 0) allStudents[idx].specialties = specs;

  await Promise.all([renderTeamTable(), renderLeaderboard(), renderNeglectAlerts()]);
});

document.getElementById('btn-refresh').addEventListener('click', async () => {
  const btn = document.getElementById('btn-refresh');
  btn.textContent = '…';
  await Promise.all([loadStudents(), loadAllGoals()]);
  await Promise.all([renderTeamTable(), renderLeaderboard(), renderNeglectAlerts()]);
  btn.textContent = 'Refresh';
});

init();
