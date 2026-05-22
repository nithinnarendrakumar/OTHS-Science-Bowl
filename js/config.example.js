// Copy this file to js/config.js and fill in your values.
// config.js is gitignored — never commit real credentials.
//
// Find these at: supabase.com → your project → Settings → API

const SUPABASE_URL  = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON = 'YOUR_ANON_PUBLIC_KEY';

// Default goals shown before an officer sets individual ones
const DEFAULT_DAILY_MIN  = 90;   // minutes
const DEFAULT_WEEKLY_MIN = 630;  // minutes (7 × 90)

// How many days back counts as "neglect" for a subject
const NEGLECT_THRESHOLD_DAYS = 5;
