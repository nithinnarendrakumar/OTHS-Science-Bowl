-- ============================================================
-- Science Bowl Training Tracker — Supabase Schema
-- Run this in the Supabase SQL Editor (Project > SQL Editor)
-- ============================================================

-- 1. Profiles (extends auth.users)
create table if not exists public.profiles (
  id          uuid references auth.users(id) on delete cascade primary key,
  full_name   text   not null,
  role        text   not null default 'student' check (role in ('student', 'coach')),
  specialties text[] not null default '{bio,chem,physics,earth_space,math}',
  auth_email  text,   -- internal only, used for name-based login
  created_at  timestamptz not null default now()
);

-- Migrations for existing deployments
alter table public.profiles add column if not exists
  specialties text[] not null default '{bio,chem,physics,earth_space,math}';
alter table public.profiles add column if not exists auth_email text;

-- Auto-create profile on signup (stores the generated internal email for name-based login)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name, role, auth_email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', 'Unnamed'),
    'student',
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2. Daily logs (one row per student per calendar day)
create table if not exists public.daily_logs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references public.profiles(id) on delete cascade not null,
  log_date            date not null default current_date,
  bio_minutes         int  not null default 0 check (bio_minutes >= 0),
  chem_minutes        int  not null default 0 check (chem_minutes >= 0),
  physics_minutes     int  not null default 0 check (physics_minutes >= 0),
  earth_space_minutes int  not null default 0 check (earth_space_minutes >= 0),
  math_minutes        int  not null default 0 check (math_minutes >= 0),
  anki_minutes        int  not null default 0 check (anki_minutes >= 0),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique(user_id, log_date)
);

-- 3. Textbook entries (many per day per student)
create table if not exists public.textbook_entries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.profiles(id) on delete cascade not null,
  log_date      date not null,
  subject       text not null check (subject in ('bio','chem','physics','earth_space','math')),
  textbook_name text not null,
  pages_start   int  not null check (pages_start >= 0),
  pages_end     int  not null check (pages_end >= pages_start),
  created_at    timestamptz not null default now()
);

-- 4. Practice test entries (many per day per student)
create table if not exists public.practice_test_entries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.profiles(id) on delete cascade not null,
  log_date      date not null,
  test_name     text not null,
  subject       text check (subject in ('bio','chem','physics','earth_space','math','mixed')),
  score_correct int  check (score_correct >= 0),
  score_total   int  check (score_total > 0),
  created_at    timestamptz not null default now()
);

-- 5. Per-student goals (set by coach)
create table if not exists public.student_goals (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references public.profiles(id) on delete cascade not null unique,
  min_daily_minutes  int not null default 90,
  min_weekly_minutes int not null default 630,
  updated_by         uuid references public.profiles(id),
  updated_at         timestamptz not null default now()
);

-- 6. Meetings
create table if not exists public.meetings (
  id           uuid primary key default gen_random_uuid(),
  meeting_date date not null default current_date,
  notes        text,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);

-- 7. Attendance (who showed up)
create table if not exists public.meeting_attendance (
  meeting_id uuid references public.meetings(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete cascade,
  primary key (meeting_id, user_id)
);

-- 8. Per-player toss-up stats per subject per meeting
create table if not exists public.meeting_player_stats (
  id              uuid primary key default gen_random_uuid(),
  meeting_id      uuid references public.meetings(id) on delete cascade,
  user_id         uuid references public.profiles(id) on delete cascade,
  subject         text not null check (subject in ('bio','chem','physics','earth_space','math')),
  tossups_correct int  not null default 0 check (tossups_correct >= 0),
  tossups_neg     int  not null default 0 check (tossups_neg >= 0),
  unique(meeting_id, user_id, subject)
);

-- 9. Round scores (team vs team per round)
create table if not exists public.meeting_rounds (
  id                  uuid primary key default gen_random_uuid(),
  meeting_id          uuid references public.meetings(id) on delete cascade,
  round_number        int  not null,
  team_a_label        text,
  team_b_label        text,
  team_a_score        int  not null default 0,
  team_b_score        int  not null default 0,
  bonus_parts_correct int  not null default 0,
  bonus_parts_total   int  not null default 0,
  unique(meeting_id, round_number)
);

-- ============================================================
-- Row Level Security
-- ============================================================

alter table public.profiles              enable row level security;
alter table public.daily_logs            enable row level security;
alter table public.textbook_entries      enable row level security;
alter table public.practice_test_entries enable row level security;
alter table public.student_goals         enable row level security;
alter table public.meetings              enable row level security;
alter table public.meeting_attendance    enable row level security;
alter table public.meeting_player_stats  enable row level security;
alter table public.meeting_rounds        enable row level security;

-- Helper: is the current user a coach?
create or replace function public.is_coach()
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'coach'
  );
$$;

-- profiles
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

drop policy if exists "coaches_update_any_profile" on public.profiles;
create policy "coaches_update_any_profile" on public.profiles for update using (public.is_coach());

-- daily_logs
drop policy if exists "logs_select" on public.daily_logs;
create policy "logs_select" on public.daily_logs for select
  using (auth.uid() = user_id or public.is_coach());

drop policy if exists "logs_insert" on public.daily_logs;
create policy "logs_insert" on public.daily_logs for insert
  with check (auth.uid() = user_id);

drop policy if exists "logs_update" on public.daily_logs;
create policy "logs_update" on public.daily_logs for update
  using (auth.uid() = user_id);

-- textbook_entries
drop policy if exists "tb_select" on public.textbook_entries;
create policy "tb_select" on public.textbook_entries for select
  using (auth.uid() = user_id or public.is_coach());

drop policy if exists "tb_insert" on public.textbook_entries;
create policy "tb_insert" on public.textbook_entries for insert
  with check (auth.uid() = user_id);

drop policy if exists "tb_delete" on public.textbook_entries;
create policy "tb_delete" on public.textbook_entries for delete
  using (auth.uid() = user_id);

-- practice_test_entries
drop policy if exists "pt_select" on public.practice_test_entries;
create policy "pt_select" on public.practice_test_entries for select
  using (auth.uid() = user_id or public.is_coach());

drop policy if exists "pt_insert" on public.practice_test_entries;
create policy "pt_insert" on public.practice_test_entries for insert
  with check (auth.uid() = user_id);

drop policy if exists "pt_delete" on public.practice_test_entries;
create policy "pt_delete" on public.practice_test_entries for delete
  using (auth.uid() = user_id);

-- student_goals
drop policy if exists "goals_select" on public.student_goals;
create policy "goals_select" on public.student_goals for select using (true);

drop policy if exists "goals_upsert" on public.student_goals;
create policy "goals_upsert" on public.student_goals for all
  using (public.is_coach()) with check (public.is_coach());

-- meetings (everyone can read, only coaches write)
drop policy if exists "meetings_select" on public.meetings;
create policy "meetings_select" on public.meetings for select using (true);

drop policy if exists "meetings_write" on public.meetings;
create policy "meetings_write" on public.meetings for all
  using (public.is_coach()) with check (public.is_coach());

-- meeting_attendance
drop policy if exists "attendance_select" on public.meeting_attendance;
create policy "attendance_select" on public.meeting_attendance for select using (true);

drop policy if exists "attendance_write" on public.meeting_attendance;
create policy "attendance_write" on public.meeting_attendance for all
  using (public.is_coach()) with check (public.is_coach());

-- meeting_player_stats
drop policy if exists "mps_select" on public.meeting_player_stats;
create policy "mps_select" on public.meeting_player_stats for select using (true);

drop policy if exists "mps_write" on public.meeting_player_stats;
create policy "mps_write" on public.meeting_player_stats for all
  using (public.is_coach()) with check (public.is_coach());

-- meeting_rounds
drop policy if exists "rounds_select" on public.meeting_rounds;
create policy "rounds_select" on public.meeting_rounds for select using (true);

drop policy if exists "rounds_write" on public.meeting_rounds;
create policy "rounds_write" on public.meeting_rounds for all
  using (public.is_coach()) with check (public.is_coach());
