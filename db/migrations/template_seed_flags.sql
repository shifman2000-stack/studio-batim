-- db/migrations/template_seed_flags.sql
--
-- Lets the three spec tabs (כתב כמויות / חומרי גמר / מפרט לקבלן) tell
-- "this project was never filled in" apart from "this project was
-- deliberately emptied".
--
-- WHY
-- Each tab lazily seeds itself from its template table when the project
-- has zero rows. With the new delete-a-whole-category action, removing
-- the LAST remaining category leaves zero rows, so the next open would
-- re-create every template row and the deletion would look undone.
-- These flags make seeding a once-per-project event instead.
--
-- SAFE TO RUN MORE THAN ONCE (IF NOT EXISTS on every statement).
-- Adds nullable boolean columns with a default; no data is rewritten and
-- no existing behaviour changes until the app reads them.
--
-- NOTE the backfill at the bottom: every project that ALREADY has rows
-- in a tab is marked as seeded, so emptying such a project after this
-- migration does not resurrect its rows. Without the backfill, existing
-- projects would keep the old behaviour.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS quantities_seeded       boolean NOT NULL DEFAULT false;
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS finishing_seeded        boolean NOT NULL DEFAULT false;
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS contractor_spec_seeded  boolean NOT NULL DEFAULT false;

-- Backfill: any project that already has content in a tab counts as
-- seeded, so a later "delete every category" stays deleted.
UPDATE public.projects p
   SET quantities_seeded = true
 WHERE quantities_seeded = false
   AND EXISTS (SELECT 1 FROM public.project_quantities q WHERE q.project_id = p.id);

UPDATE public.projects p
   SET finishing_seeded = true
 WHERE finishing_seeded = false
   AND EXISTS (SELECT 1 FROM public.project_finishing_materials f WHERE f.project_id = p.id);

UPDATE public.projects p
   SET contractor_spec_seeded = true
 WHERE contractor_spec_seeded = false
   AND EXISTS (SELECT 1 FROM public.project_contractor_spec c WHERE c.project_id = p.id);
