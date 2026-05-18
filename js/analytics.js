// Analytics page

let currentUser, currentProfile, allStudents = [];
let charts = {};
const CRIMSON = '#B91C1C';

const SUBJECT_COLORS = {
  bio:         '#B91C1C',
  chem:        '#c45c5c',
  physics:     '#cc8888',
  earth_space: '#888888',
  math:        '#bbbbbb',
};
const ANKI_COLOR = '#dddddd';

Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
Chart.defaults.font.size   = 11;
Chart.defaults.color       = '#999';

function gridOpts() {
  return { color: '#eeeeee', drawBorder: false };
}

async function init() {
  const auth = await requireAuth('student');
  if (!auth) return;
  currentUser    = auth.session.user;
  currentProfile = auth.profile;

  if (currentProfile.role === 'coach') {
    document.getElementById('link-coach').classList.remove('hidden');
    document.getElementById('team-section').classList.remove('hidden');

    // Load all students for selector
    const { data } = await sb.from('profiles').select('*').eq('role', 'student').order('full_name');
    allStudents = data || [];

    const wrap = document.getElementById('student-selector-wrap');
    wrap.style.display = 'block';
    const sel = document.getElementById('student-select');
    sel.innerHTML = `<option value="${currentUser.id}">Me (Coach)</option>` +
      allStudents.map(s => `<option value="${s.id}">${s.full_name}</option>`).join('');

    await renderTeamCharts();
  }

  await reload();
}

function getSelectedUid() {
  const sel = document.getElementById('student-select');
  return sel ? sel.value : currentUser.id;
}

function getRangeDays() {
  return parseInt(document.getElementById('range-select').value) || 30;
}

async function reload() {
  const uid  = getSelectedUid();
  const days = getRangeDays();
  const from = fmtDate(new Date(Date.now() - days * 86400000));

  const [logs, tests, attendance, meetingStats] = await Promise.all([
    sb.from('daily_logs').select('*').eq('user_id', uid).gte('log_date', from).order('log_date'),
    sb.from('practice_test_entries').select('*').eq('user_id', uid).gte('log_date', from).order('log_date'),
    sb.from('meeting_attendance').select('meeting_id').eq('user_id', uid),
    sb.from('meeting_player_stats').select('*').eq('user_id', uid),
  ]);

  const logData   = logs.data || [];
  const testData  = tests.data || [];
  const mids      = (attendance.data || []).map(a => a.meeting_id);
  const statsData = meetingStats.data || [];

  // Meeting dates for attended meetings
  let meetingDates = [];
  if (mids.length) {
    const { data: mtgs } = await sb.from('meetings').select('id,meeting_date').in('id', mids).gte('meeting_date', from).order('meeting_date');
    meetingDates = mtgs || [];
  }

  renderSummary(logData, testData, mids.length);
  renderDailyChart(logData, days);
  renderSubjectChart(logData);
  renderTestChart(testData);
  renderHeatmap(logData, days);
  renderMeetingChart(meetingDates, statsData);
}

// ── Summary stats ──────────────────────────────────────────────────────────
function renderSummary(logs, tests, meetingCount) {
  const totalMins = logs.reduce((a, l) =>
    a + (l.bio_minutes||0)+(l.chem_minutes||0)+(l.physics_minutes||0)+(l.earth_space_minutes||0)+(l.math_minutes||0), 0);
  const daysLogged = new Set(logs.filter(l =>
    (l.bio_minutes||0)+(l.chem_minutes||0)+(l.physics_minutes||0)+(l.earth_space_minutes||0)+(l.math_minutes||0) > 0
  ).map(l => l.log_date)).size;
  const avgMins = daysLogged ? Math.round(totalMins / daysLogged) : 0;

  // Streak
  const logSet = new Set(logs.filter(l =>
    (l.bio_minutes||0)+(l.chem_minutes||0)+(l.physics_minutes||0)+(l.earth_space_minutes||0)+(l.math_minutes||0) > 0
  ).map(l => l.log_date));
  let streak = 0, d = new Date();
  if (!logSet.has(fmtDate(d))) d = new Date(d.getTime() - 86400000);
  while (logSet.has(fmtDate(d))) { streak++; d = new Date(d.getTime() - 86400000); }

  const scoredTests = tests.filter(t => t.score_total);
  const avgScore = scoredTests.length
    ? Math.round(scoredTests.reduce((a, t) => a + (t.score_correct / t.score_total) * 100, 0) / scoredTests.length)
    : null;

  document.getElementById('s-hours').textContent   = (totalMins / 60).toFixed(1);
  document.getElementById('s-avg').textContent      = avgMins;
  document.getElementById('s-streak').textContent   = streak;
  document.getElementById('s-tests').textContent    = tests.length;
  document.getElementById('s-score').textContent    = avgScore !== null ? avgScore + '%' : '–';
  document.getElementById('s-meetings').textContent = meetingCount;
}

// ── Daily bar chart ────────────────────────────────────────────────────────
function renderDailyChart(logs, days) {
  const today = new Date();
  const labels = [];
  const dataBySubject = {};
  for (const s of SUBJECTS) dataBySubject[s.key] = [];
  const ankiData = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const key = fmtDate(d);
    labels.push(i % 7 === 0 || days <= 14 ? key.slice(5) : '');
    const log = logs.find(l => l.log_date === key);
    for (const s of SUBJECTS) dataBySubject[s.key].push(log ? (log[s.col] || 0) : 0);
    ankiData.push(log ? (log.anki_minutes || 0) : 0);
  }

  const datasets = SUBJECTS.map(s => ({
    label: s.label,
    data: dataBySubject[s.key],
    backgroundColor: SUBJECT_COLORS[s.key],
    borderWidth: 0,
    stack: 'study',
  }));
  datasets.push({ label: 'Anki', data: ankiData, backgroundColor: ANKI_COLOR, borderWidth: 0, stack: 'study' });

  destroyChart('chart-daily');
  charts['chart-daily'] = new Chart(document.getElementById('chart-daily'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      animation: false,
      plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, padding: 12 } }, tooltip: { mode: 'index' } },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0 } },
        y: { stacked: true, grid: gridOpts(), title: { display: true, text: 'minutes' } },
      },
    },
  });
}

// ── Subject donut ──────────────────────────────────────────────────────────
function renderSubjectChart(logs) {
  const totals = SUBJECTS.map(s => ({ label: s.label, val: logs.reduce((a, l) => a + (l[s.col] || 0), 0), color: SUBJECT_COLORS[s.key] }));

  destroyChart('chart-subjects');
  charts['chart-subjects'] = new Chart(document.getElementById('chart-subjects'), {
    type: 'doughnut',
    data: {
      labels: totals.map(t => t.label),
      datasets: [{ data: totals.map(t => t.val), backgroundColor: totals.map(t => t.color), borderWidth: 0, hoverOffset: 4 }],
    },
    options: {
      responsive: true,
      animation: false,
      cutout: '60%',
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw}m` } },
      },
    },
  });
}

// ── Practice test line chart ───────────────────────────────────────────────
function renderTestChart(tests) {
  const scored = tests.filter(t => t.score_total).map(t => ({
    x: t.log_date,
    y: Math.round((t.score_correct / t.score_total) * 100),
    label: t.test_name,
  }));

  destroyChart('chart-tests');
  charts['chart-tests'] = new Chart(document.getElementById('chart-tests'), {
    type: 'line',
    data: {
      labels: scored.map(t => t.x.slice(5)),
      datasets: [{
        label: 'Score %',
        data: scored.map(t => t.y),
        borderColor: CRIMSON,
        backgroundColor: 'rgba(185,28,28,.08)',
        pointBackgroundColor: CRIMSON,
        pointRadius: 4,
        fill: true,
        tension: .3,
        borderWidth: 1.5,
      }],
    },
    options: {
      responsive: true,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => {
          const t = scored[ctx.dataIndex];
          return `${t.label}: ${t.y}%`;
        }}},
      },
      scales: {
        x: { grid: { display: false } },
        y: { min: 0, max: 100, grid: gridOpts(), ticks: { callback: v => v + '%' } },
      },
    },
  });
}

// ── Activity heatmap ───────────────────────────────────────────────────────
function renderHeatmap(logs, days) {
  const logByDate = {};
  let maxMins = 0;
  for (const l of logs) {
    const t = (l.bio_minutes||0)+(l.chem_minutes||0)+(l.physics_minutes||0)+(l.earth_space_minutes||0)+(l.math_minutes||0);
    logByDate[l.log_date] = t;
    if (t > maxMins) maxMins = t;
  }

  // Build 90-day heatmap regardless of range (always show 3 months)
  const WEEKS = 13;
  const today = new Date(); today.setHours(0,0,0,0);
  // Go back to nearest Monday
  const endMonday = new Date(today);
  endMonday.setDate(endMonday.getDate() - ((endMonday.getDay() + 6) % 7));
  const start = new Date(endMonday.getTime() - (WEEKS - 1) * 7 * 86400000);

  const dayLabels = ['M','T','W','T','F','S','S'];
  let monthLabels = [];
  let cols = [];

  for (let w = 0; w < WEEKS; w++) {
    const col = [];
    let monthLabel = '';
    for (let d = 0; d < 7; d++) {
      const date = new Date(start.getTime() + (w * 7 + d) * 86400000);
      const key = fmtDate(date);
      const mins = logByDate[key] || 0;
      const isFuture = date > today;
      const intensity = (!isFuture && maxMins > 0) ? mins / maxMins : 0;
      const alpha = intensity > 0 ? Math.max(0.15, intensity) : 0;
      const bg = isFuture ? 'var(--surface2)' : mins > 0 ? `rgba(185,28,28,${alpha.toFixed(2)})` : 'var(--border)';
      if (d === 0) monthLabel = date.toLocaleDateString('en-US', { month: 'short' });
      col.push({ key, mins, bg, isFuture });
    }
    cols.push(col);
    monthLabels.push({ label: monthLabel, w });
  }

  // Deduplicate month labels
  const seenMonths = new Set();
  const dedupedMonths = monthLabels.map(m => {
    if (seenMonths.has(m.label)) return { ...m, label: '' };
    seenMonths.add(m.label);
    return m;
  });

  const wrap = document.getElementById('heatmap-wrap');
  const monthRow = dedupedMonths.map(m =>
    `<div class="heatmap-month-label" style="width:${m.label ? 'auto' : '15px'};min-width:15px">${m.label}</div>`
  ).join('');

  const colsHtml = cols.map(col =>
    `<div class="heatmap-col">${col.map(c =>
      `<div class="heatmap-cell" style="background:${c.bg}" data-tip="${c.isFuture ? '' : c.key + ': ' + c.mins + 'm'}"></div>`
    ).join('')}</div>`
  ).join('');

  wrap.innerHTML = `
    <div style="display:flex;margin-bottom:4px;margin-left:24px">
      <div class="heatmap-months">${monthRow}</div>
    </div>
    <div class="heatmap-outer">
      <div class="day-labels">${dayLabels.map(l => `<div class="day-label">${l}</div>`).join('')}</div>
      <div class="heatmap">${colsHtml}</div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin-top:8px;margin-left:24px">
      <span style="font-size:10px;color:var(--muted)">Less</span>
      ${[0,.2,.4,.6,.8,1].map(a => `<div style="width:12px;height:12px;border-radius:2px;background:${a===0?'var(--border)':`rgba(185,28,28,${a})`}"></div>`).join('')}
      <span style="font-size:10px;color:var(--muted)">More</span>
    </div>`;
}

// ── Meeting toss-up chart ──────────────────────────────────────────────────
function renderMeetingChart(meetings, stats) {
  if (!meetings.length) {
    document.getElementById('meeting-chart-box').style.display = 'none';
    return;
  }
  document.getElementById('meeting-chart-box').style.display = '';

  const statsByMid = {};
  for (const s of stats) {
    if (!statsByMid[s.meeting_id]) statsByMid[s.meeting_id] = [];
    statsByMid[s.meeting_id].push(s);
  }

  const labels  = meetings.map(m => m.meeting_date.slice(5));
  const correct = meetings.map(m => (statsByMid[m.id] || []).reduce((a, s) => a + s.tossups_correct, 0));
  const neg     = meetings.map(m => (statsByMid[m.id] || []).reduce((a, s) => a + s.tossups_neg, 0));

  destroyChart('chart-meetings');
  charts['chart-meetings'] = new Chart(document.getElementById('chart-meetings'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Correct', data: correct, backgroundColor: CRIMSON, borderWidth: 0 },
        { label: 'Neg',     data: neg.map(n => -n), backgroundColor: '#ddd', borderWidth: 0 },
      ],
    },
    options: {
      responsive: true,
      animation: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12 } } },
      scales: {
        x: { grid: { display: false } },
        y: { grid: gridOpts(), ticks: { callback: v => Math.abs(v) } },
      },
    },
  });
}

// ── Team charts (coach only) ───────────────────────────────────────────────
async function renderTeamCharts() {
  if (!allStudents.length) return;

  // Last 8 weeks, per student
  const from8w = fmtDate(new Date(Date.now() - 56 * 86400000));
  const ids = allStudents.map(s => s.id);
  const { data: logs } = await sb.from('daily_logs')
    .select('user_id,log_date,bio_minutes,chem_minutes,physics_minutes,earth_space_minutes,math_minutes')
    .in('user_id', ids).gte('log_date', from8w).order('log_date');

  // Bucket into weeks
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const ws = fmtDate(new Date(Date.now() - (i * 7 + 6) * 86400000));
    const we = fmtDate(new Date(Date.now() - i * 7 * 86400000));
    weeks.push({ label: ws.slice(5), ws, we });
  }

  const grays = ['#B91C1C','#c45c5c','#cc8888','#888','#bbb','#ddd','#aaa','#999','#777','#555'];
  const datasets = allStudents.map((s, i) => ({
    label: s.full_name.split(' ')[0],
    data: weeks.map(w => {
      const wLogs = (logs || []).filter(l => l.user_id === s.id && l.log_date >= w.ws && l.log_date <= w.we);
      return wLogs.reduce((a, l) => a+(l.bio_minutes||0)+(l.chem_minutes||0)+(l.physics_minutes||0)+(l.earth_space_minutes||0)+(l.math_minutes||0), 0);
    }),
    backgroundColor: grays[i % grays.length],
    borderWidth: 0,
  }));

  destroyChart('chart-team');
  charts['chart-team'] = new Chart(document.getElementById('chart-team'), {
    type: 'bar',
    data: { labels: weeks.map(w => w.label), datasets },
    options: {
      responsive: true,
      animation: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 10 } } },
      scales: {
        x: { grid: { display: false } },
        y: { grid: gridOpts(), title: { display: true, text: 'minutes' } },
      },
    },
  });

  // Subject coverage matrix — this week
  const from7 = fmtDate(new Date(Date.now() - 7 * 86400000));
  const { data: wlogs } = await sb.from('daily_logs')
    .select('user_id,' + SUBJECTS.map(s => s.col).join(','))
    .in('user_id', ids).gte('log_date', from7);

  const totals = {};
  for (const l of (wlogs || [])) {
    if (!totals[l.user_id]) totals[l.user_id] = {};
    for (const s of SUBJECTS) totals[l.user_id][s.key] = (totals[l.user_id][s.key] || 0) + (l[s.col] || 0);
  }

  const mat = document.getElementById('coverage-matrix');
  const headerRow = `<thead><tr><th>Student</th>${SUBJECTS.map(s => `<th>${s.label}</th>`).join('')}</tr></thead>`;
  const bodyRows = allStudents.map(s => {
    const st = totals[s.id] || {};
    const cells = SUBJECTS.map(sub => {
      const mins = st[sub.key] || 0;
      const specs = s.specialties || [];
      if (!specs.includes(sub.key)) return `<td class="center muted" style="font-size:10px">–</td>`;
      const intensity = Math.min(1, mins / 120);
      const bg = mins > 0 ? `rgba(185,28,28,${Math.max(0.1, intensity).toFixed(2)})` : 'transparent';
      const color = intensity > 0.5 ? '#fff' : 'var(--text)';
      return `<td class="num center" style="background:${bg};color:${color}">${mins ? mins+'m' : '×'}</td>`;
    }).join('');
    return `<tr><td style="font-weight:600">${s.full_name}</td>${cells}</tr>`;
  }).join('');

  mat.innerHTML = headerRow + `<tbody>${bodyRows}</tbody>`;
}

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

init();
