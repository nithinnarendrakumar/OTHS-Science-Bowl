// Shared auth helpers — loaded on every page

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

async function requireAuth(expectedRole) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return null; }

  const { data: profile } = await sb.from('profiles').select('id,full_name,role,specialties').eq('id', session.user.id).single();
  if (!profile) { await sb.auth.signOut(); window.location.href = 'index.html'; return null; }

  if (expectedRole && profile.role !== expectedRole && profile.role !== 'coach') {
    // coach can access student dashboard, but student cannot access coach
    if (expectedRole === 'coach' && profile.role !== 'coach') {
      window.location.href = 'dashboard.html';
      return null;
    }
  }

  // Redirect logged-in users away from index
  if (window.location.pathname.endsWith('index.html') || window.location.pathname === '/') {
    window.location.href = 'dashboard.html';
    return null;
  }

  return { session, profile };
}

async function signOut() {
  await sb.auth.signOut();
  window.location.href = 'index.html';
}

// Utility: Monday of the ISO week containing `date`
function weekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function fmtMins(m) {
  if (!m) return '–';
  const h = Math.floor(m / 60), min = m % 60;
  return h > 0 ? `${h}h ${min}m` : `${min}m`;
}

function pct(correct, total) {
  if (!total) return '–';
  return Math.round((correct / total) * 100) + '%';
}

const SUBJECTS = [
  { key: 'bio',         label: 'Biology',     col: 'bio_minutes' },
  { key: 'chem',        label: 'Chemistry',   col: 'chem_minutes' },
  { key: 'physics',     label: 'Physics',     col: 'physics_minutes' },
  { key: 'earth_space', label: 'Earth/Space', col: 'earth_space_minutes' },
  { key: 'math',        label: 'Math',        col: 'math_minutes' },
];
