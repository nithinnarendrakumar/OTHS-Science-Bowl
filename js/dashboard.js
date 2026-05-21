// Dashboard — unified role-based view

const CRIMSON = '#B91C1C';
let dashProfile, allStudents = [], allGoals = {}, activeMeetingId = null;

async function init() {
  const auth = await requireAuth('student');
  if (!auth) return;
  dashProfile = auth.profile;
  document.getElementById('hdr-name').textContent = dashProfile.full_name;

  if (dashProfile.role === 'coach') {
    document.getElementById('coach-view').classList.remove('hidden');
    await initCoach();
  } else {
    document.getElementById('student-view').classList.remove('hidden');
    await initStudent();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STUDENT VIEW
// ─────────────────────────────────────────────────────────────────────────────

async function initStudent() {
  const uid = dashProfile.id;

  const [studentsRes, allStatsRes, myStatsRes] = await Promise.all([
    sb.from('profiles').select('id,full_name').eq('role', 'student'),
    sb.from('meeting_player_stats').select('user_id,subject,tossups_correct,tossups_neg'),
    sb.from('meeting_player_stats').select('meeting_id,subject,tossups_correct,tossups_neg').eq('user_id', uid),
  ]);

  const students = studentsRes.data || [];
  const allStats = allStatsRes.data || [];
  const myStats  = myStatsRes.data  || [];

  const rankings = computeRankings(students, allStats);
  const myRank   = rankings.findIndex(r => r.id === uid) + 1;
  const myData   = rankings.find(r => r.id === uid) || { c: 0, n: 0, acc: 0, bySub: {} };

  const meetingIds = [...new Set(myStats.map(s => s.meeting_id))];
  let meetings = [];
  if (meetingIds.length) {
    const { data } = await sb.from('meetings').select('id,meeting_date').in('id', meetingIds).order('meeting_date');
    meetings = data || [];
  }

  renderStudent(uid, myRank, rankings, myData, myStats, meetings);
}

function computeRankings(students, allStats) {
  const SUB_KEYS = ['bio', 'chem', 'physics', 'earth_space', 'math'];
  return students.map(s => {
    const stats = allStats.filter(x => x.user_id === s.id);
    const c = stats.reduce((a, x) => a + x.tossups_correct, 0);
    const n = stats.reduce((a, x) => a + x.tossups_neg, 0);
    const bySub = {};
    for (const k of SUB_KEYS) {
      const ss = stats.filter(x => x.subject === k);
      bySub[k] = { c: ss.reduce((a, x) => a + x.tossups_correct, 0), n: ss.reduce((a, x) => a + x.tossups_neg, 0) };
    }
    return { id: s.id, name: s.full_name, c, n, acc: c + n > 0 ? c / (c + n) : 0, bySub };
  }).sort((a, b) => b.acc - a.acc || b.c - a.c);
}

function renderStudent(uid, myRank, rankings, myData, myStats, meetings) {
  const acc   = myData.c + myData.n > 0 ? Math.round(myData.acc * 100) : null;
  const total = rankings.length;

  document.getElementById('s-rank').textContent      = myRank ? '#' + myRank : '–';
  document.getElementById('s-rank-of').textContent   = `of ${total}`;
  document.getElementById('s-acc').textContent        = acc !== null ? acc + '%' : '–';
  document.getElementById('s-acc-detail').textContent = `${myData.c} correct · ${myData.n} neg`;
  document.getElementById('s-meetings').textContent   = meetings.length;

  // Per-subject cards
  document.getElementById('s-subjects').innerHTML = SUBJECTS.map(s => {
    const d   = myData.bySub[s.key] || { c: 0, n: 0 };
    const a   = d.c + d.n > 0 ? Math.round(d.c / (d.c + d.n) * 100) : null;
    const cls = a === null ? '' : a >= 75 ? 'good' : a >= 50 ? 'warn' : 'danger';
    return `<div class="sub-acc-card">
      <div class="sub-acc-label">${s.label}</div>
      <div class="sub-acc-val ${cls}">${a !== null ? a + '%' : '–'}</div>
      <div class="sub-acc-detail">${d.c}✓${d.n > 0 ? ' ' + d.n + '✗' : ''}</div>
    </div>`;
  }).join('');

  // Group stats by meeting
  const statsByMid = {};
  for (const s of myStats) {
    statsByMid[s.meeting_id] ??= { c: 0, n: 0 };
    statsByMid[s.meeting_id].c += s.tossups_correct;
    statsByMid[s.meeting_id].n += s.tossups_neg;
  }

  if (!meetings.length) {
    document.getElementById('s-history').innerHTML =
      '<tr><td colspan="5" class="muted" style="padding:16px 0">No meetings recorded yet.</td></tr>';
  } else {
    document.getElementById('s-no-meetings').style.display = 'none';
    document.getElementById('s-chart').style.display = 'block';

    document.getElementById('s-history').innerHTML = [...meetings].reverse().map(m => {
      const d   = statsByMid[m.id] || { c: 0, n: 0 };
      const a   = d.c + d.n > 0 ? Math.round(d.c / (d.c + d.n) * 100) : null;
      const pts = (d.c - d.n) * 4;
      return `<tr>
        <td>${m.meeting_date}</td>
        <td class="num right">${d.c}</td>
        <td class="num right" style="color:var(--muted)">${d.n > 0 ? d.n : '–'}</td>
        <td class="num right">${pts !== 0 ? (pts > 0 ? '+' : '') + pts : '–'}</td>
        <td class="num right">${a !== null ? a + '%' : '–'}</td>
      </tr>`;
    }).join('');

    new Chart(document.getElementById('s-chart'), {
      type: 'line',
      data: {
        labels: meetings.map(m => m.meeting_date.slice(5)),
        datasets: [{
          label: 'Accuracy %',
          data: meetings.map(m => {
            const d = statsByMid[m.id] || { c: 0, n: 0 };
            return d.c + d.n > 0 ? Math.round(d.c / (d.c + d.n) * 100) : null;
          }),
          borderColor: CRIMSON,
          backgroundColor: 'rgba(185,28,28,.08)',
          pointBackgroundColor: CRIMSON,
          pointRadius: 4,
          fill: true,
          tension: .3,
          borderWidth: 2,
          spanGaps: true,
        }],
      },
      options: {
        responsive: true,
        animation: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { min: 0, max: 100, grid: { color: '#eee' }, ticks: { callback: v => v + '%' } },
        },
      },
    });
  }

  // Team rankings
  document.getElementById('s-rankings').innerHTML = rankings.map((r, i) => {
    const a   = r.c + r.n > 0 ? Math.round(r.acc * 100) : null;
    const you = r.id === uid;
    return `<tr ${you ? 'style="background:rgba(185,28,28,.06);font-weight:600"' : ''}>
      <td>${i + 1}</td>
      <td>${r.name}${you ? ' <span class="tag ok" style="font-size:9px">you</span>' : ''}</td>
      <td class="num right">${r.c}</td>
      <td class="num right" style="color:var(--muted)">${r.n}</td>
      <td class="num right">${a !== null ? a + '%' : '–'}</td>
    </tr>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// COACH VIEW
// ─────────────────────────────────────────────────────────────────────────────

async function initCoach() {
  const { data: students } = await sb.from('profiles').select('*').eq('role', 'student').order('full_name');
  allStudents = students || [];

  const { data: goals } = await sb.from('student_goals').select('*');
  for (const g of (goals || [])) allGoals[g.user_id] = g;

  const opts = allStudents.map(s => `<option value="${s.id}">${s.full_name}</option>`).join('');
  document.getElementById('detail-select').innerHTML = '<option value="">— select student —</option>' + opts;
  document.getElementById('cfg-student').innerHTML   = '<option value="">— select —</option>' + opts;

  document.getElementById('cfg-specs').innerHTML = SUBJECTS.map(s => `
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--muted)">
      <input type="checkbox" value="${s.key}" id="spec-${s.key}" style="width:auto;border:none;border-bottom:none" />
      ${s.label}
    </label>`).join('');

  await renderLeaderboard();
  setupCoachEvents();
}

async function renderLeaderboard() {
  const ids = allStudents.map(s => s.id);
  if (!ids.length) {
    document.getElementById('lb-tbody').innerHTML =
      '<tr><td colspan="9" class="muted" style="padding:20px 0">No students yet.</td></tr>';
    return;
  }

  const { data: allStats } = await sb.from('meeting_player_stats')
    .select('user_id,subject,tossups_correct,tossups_neg').in('user_id', ids);

  const rankings = computeRankings(allStudents, allStats || []);
  const SUB_KEYS = ['bio', 'chem', 'physics', 'earth_space', 'math'];

  document.getElementById('lb-tbody').innerHTML = rankings.map((r, i) => {
    const subCells = SUB_KEYS.map(k => {
      const d = r.bySub[k] || { c: 0, n: 0 };
      const a = d.c + d.n > 0 ? Math.round(d.c / (d.c + d.n) * 100) : null;
      return `<td class="num right" style="font-size:11px">${a !== null ? a + '%' : '<span class="muted">–</span>'}</td>`;
    }).join('');
    const acc = r.c + r.n > 0 ? Math.round(r.acc * 100) : null;
    const pts = (r.c - r.n) * 4;
    return `<tr>
      <td class="muted">${i + 1}</td>
      <td style="font-weight:600">${r.name}</td>
      ${subCells}
      <td class="num right"><b>${acc !== null ? acc + '%' : '–'}</b></td>
      <td class="num right">${pts !== 0 ? (pts > 0 ? '+' : '') + pts : '–'}</td>
    </tr>`;
  }).join('');
}

async function loadStudentDetail(uid) {
  const panel   = document.getElementById('detail-panel');
  const student = allStudents.find(s => s.id === uid);
  if (!student) { panel.innerHTML = ''; return; }
  panel.innerHTML = '<p class="muted" style="font-size:12px">Loading…</p>';

  const [statsRes, meetingsRes] = await Promise.all([
    sb.from('meeting_player_stats').select('meeting_id,subject,tossups_correct,tossups_neg').eq('user_id', uid),
    sb.from('meetings').select('id,meeting_date').order('meeting_date'),
  ]);

  const stats    = statsRes.data || [];
  const meetings = meetingsRes.data || [];
  const midsWithStats = new Set(stats.map(s => s.meeting_id));
  const relevant  = meetings.filter(m => midsWithStats.has(m.id));

  if (!relevant.length) {
    panel.innerHTML = `<p class="muted" style="font-size:12px">${student.full_name} has no meeting data yet.</p>`;
    return;
  }

  const statsByMid = {};
  for (const s of stats) {
    statsByMid[s.meeting_id] ??= { c: 0, n: 0, bySub: {} };
    statsByMid[s.meeting_id].c += s.tossups_correct;
    statsByMid[s.meeting_id].n += s.tossups_neg;
    statsByMid[s.meeting_id].bySub[s.subject] = { c: s.tossups_correct, n: s.tossups_neg };
  }

  const tableRows = [...relevant].reverse().map(m => {
    const d = statsByMid[m.id];
    const a = d.c + d.n > 0 ? Math.round(d.c / (d.c + d.n) * 100) : null;
    const subCells = SUBJECTS.map(s => {
      const sd = d.bySub[s.key];
      if (!sd) return `<td class="num right muted" style="font-size:11px">–</td>`;
      const sa = sd.c + sd.n > 0 ? Math.round(sd.c / (sd.c + sd.n) * 100) : null;
      return `<td class="num right" style="font-size:11px">${sa !== null ? sa + '%' : '–'}</td>`;
    }).join('');
    return `<tr>
      <td>${m.meeting_date}</td>${subCells}
      <td class="num right"><b>${a !== null ? a + '%' : '–'}</b></td>
      <td class="num right">${d.c}</td>
      <td class="num right" style="color:var(--muted)">${d.n}</td>
    </tr>`;
  }).join('');

  panel.innerHTML = `
    <p style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin-bottom:12px">${student.full_name}</p>
    <div class="table-wrap" style="margin-bottom:20px">
      <table style="font-size:12px">
        <thead><tr>
          <th>Date</th>
          ${SUBJECTS.map(s => `<th class="right">${s.label.slice(0,4)}</th>`).join('')}
          <th class="right">Acc</th><th class="right">✓</th><th class="right">✗</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <canvas id="detail-chart" height="80"></canvas>`;

  new Chart(document.getElementById('detail-chart'), {
    type: 'line',
    data: {
      labels: relevant.map(m => m.meeting_date.slice(5)),
      datasets: [{
        label: 'Accuracy %',
        data: relevant.map(m => {
          const d = statsByMid[m.id];
          return d.c + d.n > 0 ? Math.round(d.c / (d.c + d.n) * 100) : null;
        }),
        borderColor: CRIMSON,
        backgroundColor: 'rgba(185,28,28,.08)',
        pointBackgroundColor: CRIMSON,
        pointRadius: 4,
        fill: true,
        tension: .3,
        borderWidth: 2,
        spanGaps: true,
      }],
    },
    options: {
      responsive: true,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { min: 0, max: 100, grid: { color: '#eee' }, ticks: { callback: v => v + '%' } },
      },
    },
  });
}

// ── Log meeting scores ─────────────────────────────────────────────────────

function addScoreRow() {
  const id  = Date.now();
  const row = document.createElement('div');
  row.className = 'entry-row';
  row.id = `sr-${id}`;
  row.innerHTML = `
    <select style="max-width:160px" id="sr-player-${id}">
      <option value="">— player —</option>
      ${allStudents.map(s => `<option value="${s.id}">${s.full_name}</option>`).join('')}
    </select>
    <select style="max-width:120px" id="sr-sub-${id}">
      ${SUBJECTS.map(s => `<option value="${s.key}">${s.label}</option>`).join('')}
    </select>
    <input type="number" min="0" placeholder="Correct" style="max-width:75px" id="sr-c-${id}" />
    <input type="number" min="0" placeholder="Neg"     style="max-width:60px" id="sr-n-${id}" />
    <button type="button" class="small danger" onclick="this.closest('.entry-row').remove()">✕</button>`;
  document.getElementById('score-rows').appendChild(row);
}

function setupCoachEvents() {

  document.getElementById('btn-create-meeting').addEventListener('click', async () => {
    const date = document.getElementById('log-date').value;
    if (!date) { alert('Pick a date.'); return; }

    let { data: existing } = await sb.from('meetings').select('id,meeting_date').eq('meeting_date', date).maybeSingle();
    if (!existing) {
      const notes = document.getElementById('log-notes').value.trim() || null;
      const { data, error } = await sb.from('meetings')
        .insert({ meeting_date: date, notes, created_by: dashProfile.id })
        .select('id,meeting_date').single();
      if (error) { alert('Error: ' + error.message); return; }
      existing = data;
    }

    activeMeetingId = existing.id;
    document.getElementById('active-meeting-date').textContent = existing.meeting_date;
    document.getElementById('score-entry').classList.remove('hidden');
    document.getElementById('score-rows').innerHTML = '';
    addScoreRow();
  });

  document.getElementById('btn-save-scores').addEventListener('click', async () => {
    if (!activeMeetingId) return;
    const rows    = document.querySelectorAll('#score-rows .entry-row');
    const inserts = [];

    for (const row of rows) {
      const id  = row.id.replace('sr-', '');
      const uid = document.getElementById(`sr-player-${id}`)?.value;
      const sub = document.getElementById(`sr-sub-${id}`)?.value;
      const c   = parseInt(document.getElementById(`sr-c-${id}`)?.value) || 0;
      const n   = parseInt(document.getElementById(`sr-n-${id}`)?.value) || 0;
      if (!uid) continue;
      inserts.push({ meeting_id: activeMeetingId, user_id: uid, subject: sub, tossups_correct: c, tossups_neg: n });
    }

    if (!inserts.length) { alert('No rows to save.'); return; }

    const { error } = await sb.from('meeting_player_stats')
      .upsert(inserts, { onConflict: 'meeting_id,user_id,subject' });
    if (error) { alert('Error: ' + error.message); return; }

    document.getElementById('score-entry').classList.add('hidden');
    activeMeetingId = null;
    await renderLeaderboard();
    alert('Scores saved.');
  });

  document.getElementById('detail-select').addEventListener('change', async e => {
    if (e.target.value) await loadStudentDetail(e.target.value);
    else document.getElementById('detail-panel').innerHTML = '';
  });

  document.getElementById('cfg-student').addEventListener('change', e => {
    const uid = e.target.value;
    if (!uid) return;
    const g = allGoals[uid] || { min_daily_minutes: 90, min_weekly_minutes: 630 };
    document.getElementById('cfg-daily').value  = g.min_daily_minutes;
    document.getElementById('cfg-weekly').value = g.min_weekly_minutes;
    const student = allStudents.find(s => s.id === uid);
    const specs   = student?.specialties || SUBJECTS.map(s => s.key);
    for (const s of SUBJECTS) {
      const cb = document.getElementById(`spec-${s.key}`);
      if (cb) cb.checked = specs.includes(s.key);
    }
  });

  document.getElementById('btn-save-cfg').addEventListener('click', async () => {
    const uid   = document.getElementById('cfg-student').value;
    if (!uid) { alert('Select a student.'); return; }
    const daily  = parseInt(document.getElementById('cfg-daily').value);
    const weekly = parseInt(document.getElementById('cfg-weekly').value);
    const specs  = SUBJECTS.filter(s => document.getElementById(`spec-${s.key}`)?.checked).map(s => s.key);
    if (!specs.length) { alert('Select at least one specialty.'); return; }

    const [g, p] = await Promise.all([
      sb.from('student_goals').upsert({
        user_id: uid, min_daily_minutes: daily, min_weekly_minutes: weekly,
        updated_by: dashProfile.id, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' }),
      sb.from('profiles').update({ specialties: specs }).eq('id', uid),
    ]);
    if (g.error || p.error) { alert('Error saving.'); return; }
    allGoals[uid] = { user_id: uid, min_daily_minutes: daily, min_weekly_minutes: weekly };
    const idx = allStudents.findIndex(s => s.id === uid);
    if (idx >= 0) allStudents[idx].specialties = specs;
    alert('Saved.');
  });

  document.getElementById('btn-notify').addEventListener('click', async () => {
    const msg = document.getElementById('notify-msg').value.trim();
    if (!msg) { alert('Enter a message.'); return; }
    const btn    = document.getElementById('btn-notify');
    const status = document.getElementById('notify-status');
    btn.disabled = true;
    status.textContent = 'Sending…';
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ content: msg }),
    });
    btn.disabled = false;
    if (res.ok) {
      status.textContent = 'Sent.';
      document.getElementById('notify-msg').value = '';
    } else {
      const err = await res.json().catch(() => ({}));
      status.textContent = 'Error: ' + (err.error || res.status);
    }
  });
}

async function coachRefresh() {
  document.getElementById('btn-refresh').textContent = '…';
  await renderLeaderboard();
  document.getElementById('btn-refresh').textContent = 'Refresh';
}

init();
