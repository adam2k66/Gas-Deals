-- Run this once in Supabase: open your project → SQL Editor → New query → paste all of this → Run.
-- It creates the tables for everyone's prices, "wrong price" reports, points and the leaderboard.
-- It's safe to run again (e.g. after an update): nothing already saved is lost.

-- ===== Prices =====
create table if not exists public.price_reports (
  id bigint generated always as identity primary key,
  station_id text not null check (char_length(station_id) <= 40),
  price numeric(5,1) not null check (price between 50 and 300),
  note text check (note is null or char_length(note) <= 80),
  created_at timestamptz not null default now()
);

-- "price" = a new price (10 points), "confirm" = tapped "Still correct" (2 points)
alter table public.price_reports
  add column if not exists kind text not null default 'price' check (kind in ('price', 'confirm'));
alter table public.price_reports
  add column if not exists nickname text check (nickname is null or char_length(nickname) between 2 and 20);
alter table public.price_reports
  add column if not exists fuel text not null default 'regular' check (fuel in ('regular', 'premium', 'diesel'));

create index if not exists price_reports_station_time on public.price_reports (station_id, created_at desc);
create index if not exists price_reports_time on public.price_reports (created_at desc);

-- ===== "Wrong price" reports =====
create table if not exists public.price_flags (
  id bigint generated always as identity primary key,
  report_id bigint not null references public.price_reports (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists price_flags_report on public.price_flags (report_id);

-- ===== Security =====
-- Anyone using the app can READ and ADD. Nobody can edit or delete, or fake the time something was added.
alter table public.price_reports enable row level security;
alter table public.price_flags enable row level security;

drop policy if exists "Anyone can read prices" on public.price_reports;
create policy "Anyone can read prices" on public.price_reports for select to anon using (true);
drop policy if exists "Anyone can add prices" on public.price_reports;
create policy "Anyone can add prices" on public.price_reports for insert to anon with check (true);

drop policy if exists "Anyone can read flags" on public.price_flags;
create policy "Anyone can read flags" on public.price_flags for select to anon using (true);
drop policy if exists "Anyone can flag a price" on public.price_flags;
create policy "Anyone can flag a price" on public.price_flags for insert to anon with check (true);

revoke all on public.price_reports from anon;
grant select on public.price_reports to anon;
grant insert (station_id, price, note, kind, nickname, fuel) on public.price_reports to anon;

revoke all on public.price_flags from anon;
grant select on public.price_flags to anon;
grant insert (report_id) on public.price_flags to anon;

-- ===== Prices the app shows =====
-- A price reported as wrong by 2 or more people is hidden (and earns no points).
create or replace view public.price_reports_live with (security_invoker = true) as
select r.id, r.station_id, r.fuel, r.price, r.note, r.kind, r.nickname, r.created_at
from public.price_reports r
where (select count(*) from public.price_flags f where f.report_id = r.id) < 2;

-- ===== Points =====
-- Each person earns points ONCE per station per day (the best one counts),
-- so sending the same station over and over doesn't earn anything extra.
-- Days and weeks follow Calgary time; weeks start on Monday.
create or replace view public.points_week with (security_invoker = true) as
select nickname, sum(points)::int as points
from (
  select distinct on (nickname, station_id, (created_at at time zone 'America/Edmonton')::date)
    nickname, case when kind = 'price' then 10 else 2 end as points
  from public.price_reports_live
  where nickname is not null
    and created_at >= (date_trunc('week', now() at time zone 'America/Edmonton') at time zone 'America/Edmonton')
  order by nickname, station_id, (created_at at time zone 'America/Edmonton')::date, (kind = 'price') desc
) as counted
group by nickname;

create or replace view public.points_all_time with (security_invoker = true) as
select nickname, sum(points)::int as points
from (
  select distinct on (nickname, station_id, (created_at at time zone 'America/Edmonton')::date)
    nickname, case when kind = 'price' then 10 else 2 end as points
  from public.price_reports_live
  where nickname is not null
  order by nickname, station_id, (created_at at time zone 'America/Edmonton')::date, (kind = 'price') desc
) as counted
group by nickname;

-- "37 price updates today by 12 spotters"
create or replace view public.stats_today with (security_invoker = true) as
select count(*)::int as reports, count(distinct nickname)::int as people
from public.price_reports
where created_at >= (date_trunc('day', now() at time zone 'America/Edmonton') at time zone 'America/Edmonton');

grant select on public.price_reports_live, public.points_week, public.points_all_time, public.stats_today to anon;
