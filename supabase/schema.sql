-- LotCalc Pro database (already applied to the Supabase project as migrations lotcalc_core + lotcalc_hardening).
-- Every row belongs to a company; only that company's members can see it.
create table if not exists public.lc_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  phone text, email text, address text, website text, logo text,
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.lc_members (
  company_id uuid not null references public.lc_companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'estimator' check (role in ('owner','admin','estimator','crew')),
  name text,
  joined_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index if not exists lc_members_user on public.lc_members(user_id);
create table if not exists public.lc_invites (
  code text primary key,
  company_id uuid not null references public.lc_companies(id) on delete cascade,
  role text not null default 'estimator' check (role in ('admin','estimator','crew')),
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default now() + interval '14 days',
  used_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.lc_crew (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lc_companies(id) on delete cascade,
  name text not null, role text, wage numeric(8,2) not null default 0 check (wage >= 0),
  phone text, email text, active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists lc_crew_company on public.lc_crew(company_id);
create table if not exists public.lc_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lc_companies(id) on delete cascade,
  title text not null default 'New job',
  customer jsonb not null default '{}'::jsonb,
  address text, lat double precision, lng double precision,
  status text not null default 'lead' check (status in ('lead','quoted','won','scheduled','done','lost')),
  drawing jsonb not null default '{"type":"FeatureCollection","features":[]}'::jsonb,
  inputs jsonb not null default '{}'::jsonb,
  estimate jsonb not null default '{}'::jsonb,
  price numeric(12,2),
  scheduled_date date, scheduled_days numeric(5,2), crew_ids uuid[] not null default '{}',
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lc_jobs_company on public.lc_jobs(company_id, updated_at desc);
create table if not exists public.lc_quotes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lc_companies(id) on delete cascade,
  job_id uuid references public.lc_jobs(id) on delete cascade,
  number integer not null,
  data jsonb not null default '{}'::jsonb,
  total numeric(12,2) not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (company_id, number)
);

-- helpers (security definer so policies don't recurse through lc_members' own policy)
create or replace function public.lc_role(cid uuid) returns text language sql stable security definer set search_path = public as $$
  select role from public.lc_members where company_id = cid and user_id = auth.uid() $$;
create or replace function public.lc_is_member(cid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.lc_members where company_id = cid and user_id = auth.uid()) $$;
create or replace function public.lc_can_edit(cid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.lc_role(cid) in ('owner','admin','estimator'), false) $$;
create or replace function public.lc_is_boss(cid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.lc_role(cid) in ('owner','admin'), false) $$;

create or replace function public.lc_create_company(p_name text, p_phone text default null, p_email text default null, p_address text default null, p_settings jsonb default '{}'::jsonb, p_member_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if (select count(*) from public.lc_members where user_id = auth.uid() and role = 'owner') >= 5 then raise exception 'Company limit reached'; end if;
  insert into public.lc_companies(name, phone, email, address, settings, created_by) values (trim(p_name), p_phone, p_email, p_address, coalesce(p_settings,'{}'::jsonb), auth.uid()) returning id into cid;
  insert into public.lc_members(company_id, user_id, role, name) values (cid, auth.uid(), 'owner', p_member_name);
  return cid;
end $$;

create or replace function public.lc_create_invite(p_company uuid, p_role text default 'estimator') returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.lc_is_boss(p_company) then raise exception 'Only an owner or admin can invite'; end if;
  if p_role not in ('admin','estimator','crew') then raise exception 'Bad role'; end if;
  c := upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)); -- 12 hex chars: too many combinations to guess
  insert into public.lc_invites(code, company_id, role, created_by) values (c, p_company, p_role, auth.uid());
  return c;
end $$;

create or replace function public.lc_join_company(p_code text, p_member_name text default null) returns uuid language plpgsql security definer set search_path = public as $$
declare inv public.lc_invites;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into inv from public.lc_invites where code = upper(trim(p_code)) and used_by is null and expires_at > now() for update;
  if inv.code is null then raise exception 'That invite code is not valid or has expired'; end if;
  insert into public.lc_members(company_id, user_id, role, name) values (inv.company_id, auth.uid(), inv.role, p_member_name) on conflict (company_id, user_id) do nothing;
  update public.lc_invites set used_by = auth.uid() where code = inv.code;
  return inv.company_id;
end $$;

create or replace function public.lc_save_quote(p_job uuid, p_data jsonb, p_total numeric) returns public.lc_quotes language plpgsql security definer set search_path = public as $$
declare cid uuid; q public.lc_quotes;
begin
  select company_id into cid from public.lc_jobs where id = p_job;
  if cid is null or not public.lc_can_edit(cid) then raise exception 'Not allowed'; end if;
  perform pg_advisory_xact_lock(hashtext(cid::text));
  insert into public.lc_quotes(company_id, job_id, number, data, total, created_by)
    values (cid, p_job, coalesce((select max(number) from public.lc_quotes where company_id = cid), 1000) + 1, p_data, p_total, auth.uid()) returning * into q;
  update public.lc_jobs set status = case when status in ('lead') then 'quoted' else status end, price = p_total, updated_at = now() where id = p_job;
  return q;
end $$;

create or replace function public.lc_touch() returns trigger language plpgsql set search_path = public as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists lc_jobs_touch on public.lc_jobs;
create trigger lc_jobs_touch before update on public.lc_jobs for each row execute function public.lc_touch();

-- row level security
alter table public.lc_companies enable row level security;
alter table public.lc_members enable row level security;
alter table public.lc_invites enable row level security;
alter table public.lc_crew enable row level security;
alter table public.lc_jobs enable row level security;
alter table public.lc_quotes enable row level security;

create policy "lc members read company" on public.lc_companies for select to authenticated using (public.lc_is_member(id));
create policy "lc bosses update company" on public.lc_companies for update to authenticated using (public.lc_is_boss(id)) with check (public.lc_is_boss(id));
create policy "lc owner deletes company" on public.lc_companies for delete to authenticated using (public.lc_role(id) = 'owner');
create policy "lc members see members" on public.lc_members for select to authenticated using (public.lc_is_member(company_id));
create policy "lc bosses change members" on public.lc_members for update to authenticated using (public.lc_is_boss(company_id) and role <> 'owner') with check (public.lc_is_boss(company_id) and role <> 'owner');
create policy "lc leave or remove" on public.lc_members for delete to authenticated using ((user_id = auth.uid() and role <> 'owner') or (public.lc_is_boss(company_id) and role <> 'owner'));
create policy "lc bosses see invites" on public.lc_invites for select to authenticated using (public.lc_is_boss(company_id));
create policy "lc bosses delete invites" on public.lc_invites for delete to authenticated using (public.lc_is_boss(company_id));
create policy "lc editors see crew" on public.lc_crew for select to authenticated using (public.lc_can_edit(company_id));
create policy "lc bosses add crew" on public.lc_crew for insert to authenticated with check (public.lc_is_boss(company_id));
create policy "lc bosses edit crew" on public.lc_crew for update to authenticated using (public.lc_is_boss(company_id)) with check (public.lc_is_boss(company_id));
create policy "lc bosses remove crew" on public.lc_crew for delete to authenticated using (public.lc_is_boss(company_id));
create policy "lc members see jobs" on public.lc_jobs for select to authenticated using (public.lc_is_member(company_id));
create policy "lc editors add jobs" on public.lc_jobs for insert to authenticated with check (public.lc_can_edit(company_id));
create policy "lc editors edit jobs" on public.lc_jobs for update to authenticated using (public.lc_can_edit(company_id)) with check (public.lc_can_edit(company_id));
create policy "lc editors remove jobs" on public.lc_jobs for delete to authenticated using (public.lc_can_edit(company_id));
create policy "lc editors see quotes" on public.lc_quotes for select to authenticated using (public.lc_can_edit(company_id));
create policy "lc editors remove quotes" on public.lc_quotes for delete to authenticated using (public.lc_can_edit(company_id));

revoke all on function public.lc_create_company(text,text,text,text,jsonb,text), public.lc_create_invite(uuid,text), public.lc_join_company(text,text), public.lc_save_quote(uuid,jsonb,numeric), public.lc_role(uuid), public.lc_is_member(uuid), public.lc_can_edit(uuid), public.lc_is_boss(uuid) from public, anon;
grant execute on function public.lc_create_company(text,text,text,text,jsonb,text), public.lc_create_invite(uuid,text), public.lc_join_company(text,text), public.lc_save_quote(uuid,jsonb,numeric), public.lc_role(uuid), public.lc_is_member(uuid), public.lc_can_edit(uuid), public.lc_is_boss(uuid) to authenticated;
revoke all on public.lc_companies, public.lc_members, public.lc_invites, public.lc_crew, public.lc_jobs, public.lc_quotes from anon;

-- ===== 1.2: invite limit + job photos (migrations lotcalc_longer_invites, lotcalc_photos) =====
create or replace function public.lc_create_invite(p_company uuid, p_role text default 'estimator') returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.lc_is_boss(p_company) then raise exception 'Only an owner or admin can invite'; end if;
  if p_role not in ('admin','estimator','crew') then raise exception 'Bad role'; end if;
  if (select count(*) from public.lc_invites where company_id = p_company and used_by is null and expires_at > now()) >= 50 then raise exception 'Too many open invites. Delete some first.'; end if;
  c := upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
  insert into public.lc_invites(code, company_id, role, created_by) values (c, p_company, p_role, auth.uid());
  return c;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lotcalc', 'lotcalc', false, 4194304, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 4194304, allowed_mime_types = array['image/jpeg','image/png','image/webp'];
create table if not exists public.lc_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lc_companies(id) on delete cascade,
  job_id uuid not null references public.lc_jobs(id) on delete cascade,
  path text not null unique,
  label text not null default 'before' check (label in ('before','after','damage','other')),
  note text check (char_length(note) <= 500),
  width int, height int, bytes int,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (path like company_id::text || '/' || job_id::text || '/%')
);
create index if not exists lc_photos_job on public.lc_photos(job_id, created_at);
alter table public.lc_photos enable row level security;
create policy "lc members see photos" on public.lc_photos for select to authenticated using (public.lc_is_member(company_id));
create policy "lc members add photos" on public.lc_photos for insert to authenticated with check (public.lc_is_member(company_id) and created_by = auth.uid() and exists (select 1 from public.lc_jobs j where j.id = job_id and j.company_id = lc_photos.company_id));
create policy "lc edit photo labels" on public.lc_photos for update to authenticated using (public.lc_can_edit(company_id) or created_by = auth.uid()) with check (public.lc_is_member(company_id));
create policy "lc remove photos" on public.lc_photos for delete to authenticated using (public.lc_can_edit(company_id) or created_by = auth.uid());
revoke all on public.lc_photos from anon;
create or replace function public.lc_member_of_path(p text) returns boolean language plpgsql stable security definer set search_path = public as $$
begin return public.lc_is_member(split_part(p, '/', 1)::uuid); exception when others then return false; end $$;
create or replace function public.lc_editor_of_path(p text) returns boolean language plpgsql stable security definer set search_path = public as $$
begin return public.lc_can_edit(split_part(p, '/', 1)::uuid); exception when others then return false; end $$;
revoke all on function public.lc_member_of_path(text), public.lc_editor_of_path(text) from public, anon;
grant execute on function public.lc_member_of_path(text), public.lc_editor_of_path(text) to authenticated;
create policy "lc photo files read" on storage.objects for select to authenticated using (bucket_id = 'lotcalc' and public.lc_member_of_path(name));
create policy "lc photo files add" on storage.objects for insert to authenticated with check (bucket_id = 'lotcalc' and public.lc_member_of_path(name));
create policy "lc photo files remove" on storage.objects for delete to authenticated using (bucket_id = 'lotcalc' and (public.lc_editor_of_path(name) or owner_id = auth.uid()::text));

-- ===== 1.3: customer sign-off (migrations lotcalc_signoff, lotcalc_signoff_fix) =====
-- adds share_token/status/expiry/acceptance columns to lc_quotes, replaces lc_save_quote(uuid,jsonb,numeric,int),
-- and adds lc_public_quote / lc_accept_quote / lc_decline_quote (callable without an account, only with the secret link).
-- Full text is in the Supabase migration history.

-- ===== 1.4: lc_public_quote no longer marks a quote "opened" when someone from your own company previews it (migration lotcalc_owner_preview_not_viewed) =====

-- ===== 1.5: invoices, payments, job wrap-up (migration lotcalc_money) =====
-- lc_invoices: numbered per company from 2001. Owners/admins/estimators only (crew can't see).
--   Created only through lc_create_invoice(job, kind, data, total, due). Totals, numbers and payments can't be edited directly;
--   payments go through lc_add_payment (no overpaying, no fractions of a cent, no future dates) and lc_remove_payment.
--   A paid-on invoice can't be voided; a voided one can't be reopened (trigger lc_invoice_guard).
-- lc_job_costs: one wrap-up per job (hours, materials, other costs, the estimate snapshot). Owners/admins/estimators only,
--   and only on their own company's jobs.

-- ===== 1.6: length limits (migration lotcalc_name_limits) =====
-- lc_companies.name 1-120 characters, lc_jobs.title up to 300 (added NOT VALID so old rows aren't checked). The app caps at 80 / 200.
-- The layout designer needs no database changes: it saves its shapes in lc_jobs.drawing like anything you draw.

-- ===== 1.7: crew schedules + live calendars (migration lotcalc_crew_schedule, edge function lotcalc-cal) =====
-- lc_crew: user_id (link a login; must be a member of that company; one crew record per login), time_off jsonb array of {from,to,note},
--   cal_token (secret for that person's calendar feed). lc_companies.cal_token for the whole-company feed.
-- lc_crew_names(company): names + days off for anyone in the company (no wages/phones/tokens), so crew can see who they work with.
-- lc_my_calendar(company): your own feed link (made the first time). lc_calendar_link(company, crew|null, reset): bosses only.
-- Edge function lotcalc-cal (no login, secret link): GET /functions/v1/lotcalc-cal?t=<40 hex> returns an .ics of scheduled jobs
--   (last 60 days onward, not lost) for that person or the whole company. No prices. Wrong/old link = 404.

-- ===== 1.8: AI (migration lotcalc_ai_usage, edge function lotcalc-ai, secret GEMINI_KEY) =====
-- lc_ai_usage(company_id, day, n): AI calls per company per day. Only the edge function (service role) touches it, through lc_ai_take(company, limit).
-- Edge function lotcalc-ai (login required): checks the caller can edit that company (owner/admin/estimator) with their own token.
--   action 'photo': up to 4 storage paths, must be under <company>/<job>/; images go to Gemini; answer is cleaned and range-checked.
--   action 'email': pasted text (max 20k chars) -> job fields. The text is treated as data; instructions inside it are ignored.
--   Models tried in order: gemini-3.5-flash, gemini-3-flash-preview, gemini-flash-latest (2.5-flash is closed to new keys).
-- Edge function lotcalc-ai-check: retired setup helper, returns 404.
--   action 'outline': lat/lng/meters of the map view; the function fetches the Esri satellite picture itself and Gemini returns the lot and holes.
-- ===== 1.9: follow-ups, website form, time clock =====
-- lc_followups (migration lotcalc_followups): done / snoozed / stopped state per job + reminder key. Office only (lc_can_edit).
-- lc_web_hits + lc_web_take (migration lotcalc_web_form): per-visitor (hashed IP) and per-company limits for the public quote form.
-- Edge function lotcalc-web (public, no login): 'info' (company name + message, only if the form is on), 'price' (range worked out
--   server-side from your rates, which never leave the server), 'submit' (honeypot + 4-second check, makes a 'lead' job).
-- lc_time (migrations lotcalc_time_clock, lotcalc_time_clock_own_rows): clock in/out rows with GPS distance from the lot (lc_dist_ft).
--   lc_clock_in(job, lat, lng) / lc_clock_out(lat, lng): crew only for their own linked crew record (lc_is_my_crew); office sees all.
-- Payment info, review link and driveway rates live in lc_companies.settings (no new tables).
