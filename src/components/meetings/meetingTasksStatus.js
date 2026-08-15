// src/components/meetings/meetingTasksStatus.js
//
// The "בוצע" wording shared by the manager card and the client mirror.
// Both screens render the same text from the same row, so keeping it
// here is what stops the two from drifting apart.
//
// Status is tracked ONCE per block, never per line, and in the SAME
// language the משימות tab uses (פעיל / דחוף / הושלם):
//   · CLIENT tasks  → meeting_summaries.client_tasks_status_id, written
//                     only through the set_meeting_client_tasks_status
//                     RPC. The older client_tasks_done boolean is dead —
//                     nothing reads or writes it any more.
//   · STUDIO tasks  → no column of its own. The auto-created task row
//                     (tasks.meeting_summary_id) is the single source of
//                     truth, read and written directly.

/* The status name that means a block is finished. Matched by name
   because that is what the משימות tab shows and edits. */
export const DONE_STATUS = 'הושלם'

/* What the client is shown in place of הושלם. The portal deliberately
   speaks a two-state language: פעיל and בוצע. */
export const CLIENT_DONE_LABEL = 'בוצע'

/* DD/MM/YYYY — the shape both screens already use for meeting dates.
   Goes through Date rather than slicing the ISO string so the day is
   the viewer's LOCAL day; client_tasks_done_at is a timestamptz, and
   slicing would show the UTC day, which is off by one for anything
   marked late evening Israel time. */
export function formatStamp(ts) {
  if (!ts) return ''
  const dt = new Date(ts)
  if (Number.isNaN(dt.getTime())) return ''
  const d = String(dt.getDate()).padStart(2, '0')
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  return `${d}/${m}/${dt.getFullYear()}`
}

/* What follows the status icon on the CLIENT-tasks status line once the
   block is done: who completed it and when. Returns '' for פעיל and
   דחוף, so the caller falls back to the "(לחץ לעידכון)" hint and the
   line never announces a completion that hasn't happened.

   This is the ONLY place the attribution is rendered — the block
   heading deliberately carries no "בוצע" suffix, because the same fact
   in two places is the clutter we removed.

   `statusName` is resolved from client_tasks_status_id against the
   task_statuses list; the person's name comes from a batch-resolved
   map. When the name can't be resolved we drop the "על ידי" clause
   rather than printing an empty name or a raw uuid; with no timestamp
   either it degrades to a bare "בוצע".

   The STUDIO block has no equivalent: the tasks table records neither
   who changed the status nor when, so there is nothing truthful to put
   there and the green check already carries the meaning. */
export function clientDoneHint(row, namesByUserId = {}, statusName = '') {
  if (statusName !== DONE_STATUS) return ''
  const name = (namesByUserId[row?.client_tasks_done_by] || '').trim()
  const when = formatStamp(row?.client_tasks_done_at)
  if (name && when) return `בוצע על ידי ${name} ב-${when}`
  if (when)         return `בוצע ב-${when}`
  return 'בוצע'
}
