// src/lib/stages.js
//
// The one place the stages LUT is referred to by id from application code.
//
// Lives here rather than in a screen because two screens need it and they
// already point one way: Tasks.jsx imports NewTaskModal, so a constant kept
// in Tasks.jsx and imported back by the modal would close an import cycle.
// src/lib/ is where this project keeps shared, React-free helpers.
//
// Pure constants only — no React, no Supabase.

/* "השהייה" — a project parked rather than finished. Referred to by ID and
   never by its Hebrew name: renaming the stage in the admin screen must move
   the label without quietly turning off the filters that depend on it.
   `projects.stage_id` and `tasks.stage_id` both point at this table. */
export const SUSPENDED_STAGE_ID = 9

/* PostgREST filter that drops suspended projects from a `projects` query.
   Written as an OR rather than a plain `.neq('stage_id', …)` on purpose:
   stage_id is nullable with no default, and under SQL's three-valued logic
   `stage_id <> 9` is NULL — i.e. NOT a match — for a project whose stage was
   never set, which would silently hide an ordinary project. Verified on Dev:
   both forms return 47 of 49 unarchived projects today, because every row
   happens to have a stage; only this one stays correct when one does not.

   Use as: query.or(NOT_SUSPENDED_FILTER) */
export const NOT_SUSPENDED_FILTER = `stage_id.is.null,stage_id.neq.${SUSPENDED_STAGE_ID}`
