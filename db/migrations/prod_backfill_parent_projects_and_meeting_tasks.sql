-- ══════════════════════════════════════════════════════════════════
-- PRODUCTION backfill migration — bring gastdpztgdbmavvdmlne (Prod)
-- in line with ctwjglmvatqvbzvqzane (Dev) for:
--   · Bug 1: "פרויקט אב" checkbox not persisting
--   · Bug 2: "שגיאה בטעינת סיכומים" on סיכומי פגישות
--   · Part B (opt-in, approved): the models/child-inquiry feature set
--     that turned out to be entirely missing on Prod as well
--
-- DRAFT ONLY. Do not run until the user replies "APPROVED".
-- Every definition below was pulled directly from Dev's live schema
-- (information_schema, pg_constraint, pg_policies, pg_proc) on
-- 2026-08-16, not guessed.
-- ══════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- 1. NEW TABLES (Part B) — created first so everything below that
--    references them (projects.selected_model_id, the RPC) can do so.
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.project_models (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text NOT NULL,
  image_url   text,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.project_model_presentations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  file_url    text NOT NULL,
  file_name   text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.child_project_inquiries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  contact1_name        text,
  contact1_phone       text,
  contact1_email       text,
  contact2_name        text,
  contact2_phone       text,
  contact2_email       text,
  selected_model_id    uuid REFERENCES public.project_models(id) ON DELETE SET NULL,
  submitted_at         timestamptz NOT NULL DEFAULT now(),
  converted_to_project boolean NOT NULL DEFAULT false,
  converted_project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL
);

-- ── RLS — enable + policies, exact match to Dev ──
ALTER TABLE public.project_models             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_model_presentations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.child_project_inquiries     ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_full_access_project_models ON public.project_models
  FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid()));

CREATE POLICY staff_full_access_project_model_presentations ON public.project_model_presentations
  FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid()));

CREATE POLICY staff_full_access_child_project_inquiries ON public.child_project_inquiries
  FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid()));

-- The public, unauthenticated inquiry form only needs to INSERT.
CREATE POLICY anon_insert_child_project_inquiries ON public.child_project_inquiries
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- ── Table-level grants — explicit, matching Dev's, rather than
--    relying on Prod having identical ALTER DEFAULT PRIVILEGES. RLS
--    above is still the real access gate. ──
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_models             TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_model_presentations TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.child_project_inquiries     TO anon, authenticated;

-- ────────────────────────────────────────────────────────────────
-- 2. projects — 3 missing columns (Bug 1), now including the
--    selected_model_id FK that Part A deliberately left out.
-- ────────────────────────────────────────────────────────────────

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS is_parent_project   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS selected_model_id   uuid REFERENCES public.project_models(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS child_inquiry_token uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.projects
  ADD CONSTRAINT projects_child_inquiry_token_key UNIQUE (child_inquiry_token);

-- ────────────────────────────────────────────────────────────────
-- 3. meeting_summaries — 9 missing columns (Bug 2). stages and
--    task_statuses already exist on Prod with matching shapes, so
--    both FKs below resolve cleanly.
-- ────────────────────────────────────────────────────────────────

ALTER TABLE public.meeting_summaries
  ADD COLUMN IF NOT EXISTS client_tasks           text,
  ADD COLUMN IF NOT EXISTS studio_tasks            text,
  ADD COLUMN IF NOT EXISTS has_client_tasks        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_studio_tasks        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS client_tasks_done       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS client_tasks_done_at    timestamptz,
  ADD COLUMN IF NOT EXISTS client_tasks_done_by    uuid,
  ADD COLUMN IF NOT EXISTS client_tasks_status_id  integer REFERENCES public.task_statuses(id),
  ADD COLUMN IF NOT EXISTS stage_id                integer REFERENCES public.stages(id);

-- ────────────────────────────────────────────────────────────────
-- 4. RPC functions — copied verbatim from Dev's pg_get_functiondef.
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_meeting_client_tasks_done(p_summary_id uuid, p_done boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_project uuid;
begin
  select project_id into v_project from meeting_summaries where id = p_summary_id;
  if v_project is null then
    raise exception 'meeting summary not found';
  end if;

  if not (
    exists (select 1 from profiles where id = auth.uid())
    or exists (select 1 from client_users where id = auth.uid() and project_id = v_project)
  ) then
    raise exception 'forbidden';
  end if;

  update meeting_summaries
     set client_tasks_done    = p_done,
         client_tasks_done_at = case when p_done then now() else null end,
         client_tasks_done_by = case when p_done then auth.uid() else null end,
         updated_at           = now()
   where id = p_summary_id;
end $function$;

CREATE OR REPLACE FUNCTION public.set_meeting_client_tasks_status(p_summary_id uuid, p_status_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_project  uuid;
  v_is_staff boolean;
begin
  select project_id into v_project from meeting_summaries where id = p_summary_id;
  if v_project is null then
    raise exception 'meeting summary not found';
  end if;

  if not exists (select 1 from task_statuses where id = p_status_id) then
    raise exception 'invalid status';
  end if;

  v_is_staff := exists (select 1 from profiles where id = auth.uid());

  if not v_is_staff then
    if not exists (select 1 from client_users where id = auth.uid() and project_id = v_project) then
      raise exception 'forbidden';
    end if;
    if p_status_id not in (
         (select id from task_statuses where name = 'פעיל'),
         (select id from task_statuses where name = 'הושלם')
       ) then
      raise exception 'forbidden status for client';
    end if;
  end if;

  update meeting_summaries
     set client_tasks_status_id = p_status_id,
         client_tasks_done_at   = case when p_status_id = (select id from task_statuses where name = 'הושלם') then now() else null end,
         client_tasks_done_by   = case when p_status_id = (select id from task_statuses where name = 'הושלם') then auth.uid() else null end,
         updated_at             = now()
   where id = p_summary_id;
end $function$;

CREATE OR REPLACE FUNCTION public.get_child_inquiry_form_data(p_token uuid)
 RETURNS TABLE(project_id uuid, project_name text, model_id uuid, model_name text, model_description text, model_image_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    p.id,
    p.name,
    m.id,
    m.name,
    m.description,
    m.image_url
  FROM projects p
  LEFT JOIN project_models m ON m.project_id = p.id
  WHERE p.child_inquiry_token = p_token
    AND p.is_parent_project = true
    AND p.archived = false;
$function$;

GRANT EXECUTE ON FUNCTION public.set_meeting_client_tasks_done(uuid, boolean)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_meeting_client_tasks_status(uuid, integer)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_child_inquiry_form_data(uuid)                 TO anon, authenticated;

COMMIT;
