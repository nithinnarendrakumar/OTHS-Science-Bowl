// Meetings page logic — coach only

let coachProfile, allStudents = [];

async function init() {
  const auth = await requireAuth('coach');
  if (!auth) return;
  coachProfile = auth.profile;
  if (coachProfile.role !== 'coach') {
    document.body.innerHTML = '<div style="padding:40px;color:var(--muted)">Coach only.</div>';
    return;
  }

  document.getElementById('mtg-date').value = fmtDate(new Date());

  const { data } = await sb.from('profiles').select('*').eq('role', 'student').order('full_name');
  allStudents = data || [];

  buildAttendanceChecks();
  await loadMeetingHistory();
}

// ── Attendance checkboxes ──────────────────────────────────────────────────
function buildAttendanceChecks() {
  const wrap = document.getElementById('attendance-checks');
  wrap.innerHTML = allStudents.map(s => `
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--muted)">
      <input type="checkbox" class="attend-cb" value="${s.id}"
        style="width:auto;border:none;border-bottom:none"
        onchange="rebuildTossupGrid()" />
      ${s.full_name}
    </label>`).join('');
}

function getAttending() {
  return [...document.querySelectorAll('.attend-cb:checked')].map(cb => {
    return allStudents.find(s => s.id === cb.value);
  }).filter(Boolean);
}

// ── Toss-up grid ───────────────────────────────────────────────────────────
function rebuildTossupGrid() {
  const attending = getAttending();
  const wrap = document.getElementById('tossup-grid');

  if (!attending.length) {
    wrap.innerHTML = '<p class="muted" style="font-size:12px">Select attending students first.</p>';
    return;
  }

  // Columns: player name | per-specialty subject correct/neg
  // Each student has their own specialties
  let html = '<table><thead><tr><th>Player</th>';
  for (const s of SUBJECTS) html += `<th colspan="2" style="text-align:center">${s.label}</th>`;
  html += '</tr><tr><th></th>';
  for (const s of SUBJECTS) html += `<th style="font-size:10px;color:var(--muted)">Correct</th><th style="font-size:10px;color:var(--muted)">Neg</th>`;
  html += '</tr></thead><tbody>';

  for (const student of attending) {
    const specs = (student.specialties || ['bio','chem','physics','earth_space','math']);
    html += `<tr><td style="font-weight:600">${student.full_name}</td>`;
    for (const s of SUBJECTS) {
      const active = specs.includes(s.key);
      const style = active ? '' : 'style="opacity:.25;pointer-events:none"';
      html += `
        <td ${style}><input type="number" min="0" value="0"
          id="tu-${student.id}-${s.key}-correct"
          style="width:52px;text-align:center" ${active ? '' : 'disabled'} /></td>
        <td ${style}><input type="number" min="0" value="0"
          id="tu-${student.id}-${s.key}-neg"
          style="width:52px;text-align:center;color:var(--muted)" ${active ? '' : 'disabled'} /></td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

// ── Round rows ─────────────────────────────────────────────────────────────
let roundCount = 0;

function addRoundRow() {
  roundCount++;
  const row = document.createElement('div');
  row.className = 'entry-row';
  row.id = `round-${roundCount}`;
  row.innerHTML = `
    <span style="font-size:11px;color:var(--muted);min-width:56px">Round ${roundCount}</span>
    <input type="text" placeholder="Team A" style="max-width:120px" value="Team A" />
    <input type="number" placeholder="Score" min="0" style="max-width:70px" title="Team A score" />
    <span class="muted" style="font-size:12px">vs</span>
    <input type="text" placeholder="Team B" style="max-width:120px" value="Team B" />
    <input type="number" placeholder="Score" min="0" style="max-width:70px" title="Team B score" />
    <span class="muted" style="font-size:11px">Bonus</span>
    <input type="number" placeholder="Correct" min="0" style="max-width:65px" title="Bonus parts correct" />
    <span class="muted" style="font-size:11px">/</span>
    <input type="number" placeholder="Total" min="0" style="max-width:65px" title="Bonus parts total" />
    <button type="button" class="small danger" onclick="this.closest('.entry-row').remove()">✕</button>`;
  document.getElementById('round-rows').appendChild(row);
}

// ── Toggle form ────────────────────────────────────────────────────────────
function toggleNewMeeting() {
  const form = document.getElementById('new-meeting-form');
  form.classList.toggle('hidden');
}

// ── Save meeting ───────────────────────────────────────────────────────────
document.getElementById('btn-save-meeting').addEventListener('click', async () => {
  const btn = document.getElementById('btn-save-meeting');
  btn.disabled = true; btn.textContent = 'Saving…';

  const date  = document.getElementById('mtg-date').value;
  const notes = document.getElementById('mtg-notes').value.trim();
  if (!date) { alert('Pick a date.'); btn.disabled = false; btn.textContent = 'Save Meeting'; return; }

  // 1. Insert meeting
  const { data: mtg, error: mtgErr } = await sb.from('meetings')
    .insert({ meeting_date: date, notes, created_by: coachProfile.id })
    .select().single();
  if (mtgErr) { alert('Error: ' + mtgErr.message); btn.disabled = false; btn.textContent = 'Save Meeting'; return; }

  const mid = mtg.id;
  const attending = getAttending();

  // 2. Attendance
  if (attending.length) {
    await sb.from('meeting_attendance').insert(
      attending.map(s => ({ meeting_id: mid, user_id: s.id }))
    );
  }

  // 3. Toss-up stats
  const statsInserts = [];
  for (const student of attending) {
    const specs = student.specialties || ['bio','chem','physics','earth_space','math'];
    for (const s of SUBJECTS) {
      if (!specs.includes(s.key)) continue;
      const correct = parseInt(document.getElementById(`tu-${student.id}-${s.key}-correct`)?.value) || 0;
      const neg     = parseInt(document.getElementById(`tu-${student.id}-${s.key}-neg`)?.value) || 0;
      if (correct > 0 || neg > 0) {
        statsInserts.push({ meeting_id: mid, user_id: student.id, subject: s.key, tossups_correct: correct, tossups_neg: neg });
      }
    }
  }
  if (statsInserts.length) await sb.from('meeting_player_stats').insert(statsInserts);

  // 4. Rounds
  const roundEls = document.querySelectorAll('#round-rows .entry-row');
  const roundInserts = [];
  roundEls.forEach((row, i) => {
    const inputs = row.querySelectorAll('input');
    const aLabel = inputs[0].value.trim() || 'Team A';
    const aScore = parseInt(inputs[1].value) || 0;
    const bLabel = inputs[2].value.trim() || 'Team B';
    const bScore = parseInt(inputs[3].value) || 0;
    const bCorrect = parseInt(inputs[4].value) || 0;
    const bTotal   = parseInt(inputs[5].value) || 0;
    roundInserts.push({ meeting_id: mid, round_number: i + 1, team_a_label: aLabel, team_a_score: aScore, team_b_label: bLabel, team_b_score: bScore, bonus_parts_correct: bCorrect, bonus_parts_total: bTotal });
  });
  if (roundInserts.length) await sb.from('meeting_rounds').insert(roundInserts);

  // Reset form
  document.getElementById('mtg-notes').value = '';
  document.getElementById('mtg-date').value = fmtDate(new Date());
  document.querySelectorAll('.attend-cb').forEach(cb => cb.checked = false);
  document.getElementById('round-rows').innerHTML = '';
  roundCount = 0;
  rebuildTossupGrid();
  document.getElementById('new-meeting-form').classList.add('hidden');

  btn.disabled = false; btn.textContent = 'Save Meeting';
  await loadMeetingHistory();
});

// ── Meeting history ────────────────────────────────────────────────────────
async function loadMeetingHistory() {
  const { data: meetings } = await sb.from('meetings').select('*').order('meeting_date', { ascending: false }).limit(30);
  if (!meetings?.length) {
    document.getElementById('meeting-history').innerHTML =
      '<tr><td colspan="6" class="muted" style="padding:16px 0">No meetings logged yet.</td></tr>';
    return;
  }

  const ids = meetings.map(m => m.id);
  const [{ data: attendance }, { data: rounds }] = await Promise.all([
    sb.from('meeting_attendance').select('meeting_id, user_id').in('meeting_id', ids),
    sb.from('meeting_rounds').select('*').in('meeting_id', ids),
  ]);

  const attendByMtg = {};
  for (const a of (attendance||[])) {
    if (!attendByMtg[a.meeting_id]) attendByMtg[a.meeting_id] = [];
    const s = allStudents.find(st => st.id === a.user_id);
    if (s) attendByMtg[a.meeting_id].push(s.full_name.split(' ')[0]);
  }

  const roundsByMtg = {};
  for (const r of (rounds||[])) {
    if (!roundsByMtg[r.meeting_id]) roundsByMtg[r.meeting_id] = [];
    roundsByMtg[r.meeting_id].push(r);
  }

  const tbody = document.getElementById('meeting-history');
  tbody.innerHTML = meetings.map(m => {
    const names = (attendByMtg[m.id] || []).join(', ') || '–';
    const rs = roundsByMtg[m.id] || [];
    const totalBonusCorrect = rs.reduce((a, r) => a + r.bonus_parts_correct, 0);
    const totalBonusTotal   = rs.reduce((a, r) => a + r.bonus_parts_total, 0);
    const bonusPct = totalBonusTotal ? Math.round((totalBonusCorrect / totalBonusTotal) * 100) + '%' : '–';
    return `<tr>
      <td>${m.meeting_date}</td>
      <td style="color:var(--muted);font-size:12px">${names}</td>
      <td class="num">${rs.length}</td>
      <td class="num">${bonusPct}</td>
      <td style="color:var(--muted);font-size:12px;max-width:200px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${m.notes||'–'}</td>
      <td><button class="small" onclick="showDetail('${m.id}')">View</button></td>
    </tr>`;
  }).join('');
}

// ── Meeting detail ─────────────────────────────────────────────────────────
async function showDetail(mid) {
  const [{ data: mtg }, { data: stats }, { data: rounds }, { data: attendance }] = await Promise.all([
    sb.from('meetings').select('*').eq('id', mid).single(),
    sb.from('meeting_player_stats').select('*').eq('meeting_id', mid),
    sb.from('meeting_rounds').select('*').eq('meeting_id', mid).order('round_number'),
    sb.from('meeting_attendance').select('user_id').eq('meeting_id', mid),
  ]);

  document.getElementById('detail-title').textContent = `Meeting — ${mtg.meeting_date}`;

  const attendingIds = (attendance||[]).map(a => a.user_id);
  const attendingStudents = allStudents.filter(s => attendingIds.includes(s.id));

  // Per-player toss-up table
  let playerRows = '';
  for (const student of attendingStudents) {
    const sStats = (stats||[]).filter(s => s.user_id === student.id);
    const totalCorrect = sStats.reduce((a, s) => a + s.tossups_correct, 0);
    const totalNeg     = sStats.reduce((a, s) => a + s.tossups_neg, 0);
    const pts = totalCorrect * 4 - totalNeg * 4;

    const subCells = SUBJECTS.map(sub => {
      const st = sStats.find(s => s.subject === sub.key);
      if (!st || (st.tossups_correct === 0 && st.tossups_neg === 0)) return '<td class="num zero">–</td><td class="num zero">–</td>';
      return `<td class="num">${st.tossups_correct}</td><td class="num" style="color:var(--muted)">${st.tossups_neg > 0 ? '-'+st.tossups_neg : '–'}</td>`;
    }).join('');

    playerRows += `<tr>
      <td style="font-weight:600">${student.full_name}</td>
      ${subCells}
      <td class="num"><b>${totalCorrect}</b></td>
      <td class="num" style="color:var(--muted)">${totalNeg > 0 ? '-'+totalNeg : '–'}</td>
      <td class="num"><b>${pts > 0 ? '+' : ''}${pts}</b></td>
    </tr>`;
  }

  // Rounds table
  let roundRows = (rounds||[]).map(r => {
    const bonusPct = r.bonus_parts_total ? Math.round((r.bonus_parts_correct / r.bonus_parts_total) * 100) + '%' : '–';
    const winner = r.team_a_score > r.team_b_score ? r.team_a_label : r.team_b_score > r.team_a_score ? r.team_b_label : 'Tie';
    return `<tr>
      <td class="num">${r.round_number}</td>
      <td>${r.team_a_label} <b>${r.team_a_score}</b></td>
      <td style="color:var(--muted)">vs</td>
      <td>${r.team_b_label} <b>${r.team_b_score}</b></td>
      <td style="color:var(--muted)">${winner}</td>
      <td class="num">${bonusPct}</td>
    </tr>`;
  }).join('');

  document.getElementById('detail-body').innerHTML = `
    ${mtg.notes ? `<p style="font-size:12px;color:var(--muted);margin-bottom:16px">${mtg.notes}</p>` : ''}

    <p style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin-bottom:10px">Toss-Up Performance</p>
    <div class="table-wrap" style="margin-bottom:24px">
      <table>
        <thead>
          <tr>
            <th>Player</th>
            ${SUBJECTS.map(s => `<th colspan="2" style="text-align:center">${s.label}</th>`).join('')}
            <th class="right">Total ✓</th>
            <th class="right">Negs</th>
            <th class="right">Pts</th>
          </tr>
          <tr>
            <th></th>
            ${SUBJECTS.map(() => '<th style="font-size:10px;color:var(--muted)">✓</th><th style="font-size:10px;color:var(--muted)">neg</th>').join('')}
            <th></th><th></th><th></th>
          </tr>
        </thead>
        <tbody>${playerRows || '<tr><td colspan="14" class="muted" style="padding:8px 0">No toss-up data.</td></tr>'}</tbody>
      </table>
    </div>

    ${rounds?.length ? `
    <p style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin-bottom:10px">Rounds</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th colspan="2">Team A</th><th></th><th colspan="2">Team B</th><th>Winner</th><th class="right">Bonus %</th></tr></thead>
        <tbody>${roundRows}</tbody>
      </table>
    </div>` : ''}
  `;

  document.getElementById('meeting-detail').classList.remove('hidden');
  document.getElementById('meeting-detail').scrollIntoView({ behavior: 'smooth' });
}

function closeDetail() {
  document.getElementById('meeting-detail').classList.add('hidden');
}

init();
