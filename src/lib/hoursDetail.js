// src/lib/hoursDetail.js
//
// Shared logic behind the per-employee "+" drill-down under the two
// work-hours reports:
//   * "דיווח שעות" → "דוחות" sub-tab (Hours.jsx)
//   * top-nav "דוחות" → "דוח שעות עבודה" (pages/reports/HoursReport.jsx)
//
// Both screens read the SAME rows from `attendance` + `hour_reports` and
// render the SAME detail line via `formatDrillLine`, so their expanded
// views (and their PDF exports) stay byte-for-byte consistent. Any
// tweak to how a drill line reads for one report must land here and
// carry over to the other automatically.
//
// Pure helpers only — no React state, no component-local closures.

import { supabase } from '../supabaseClient'

/* HH:MM → total minutes. Missing / empty → 0. */
export const toMins = (hhmm) => {
  if (!hhmm) return 0
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}

/* (year, monthIndex, day) → ISO YYYY-MM-DD. monthIndex is 0-based. */
export const isoDate = (y, m, d) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/* ISO YYYY-MM-DD → DD/MM/YY (2-digit year), used in drill-down lines. */
export const formatDDMMYY = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y.slice(2)}`
}

/* Total hours formatter (non-padded hours): 8:30, 0:45, 12:15. */
export const formatTotalHHMM = (mins) => {
  if (!mins && mins !== 0) return ''
  const h = Math.floor(Math.abs(mins) / 60)
  const m = Math.abs(mins) % 60
  return `${h}:${String(m).padStart(2, '0')}`
}

/**
 * Fetch the per-day detail rows for a single employee in a given month.
 * Combines `attendance` + `hour_reports` into one row per date; prefers
 * the attendance departure - arrival diff (actual clock time) and falls
 * back to the hour_reports minutes sum (admin flow that saves only to
 * hour_reports). Rows are returned sorted by date ascending.
 *
 * Row shape:
 *   { date, dayType: 'work'|'vacation'|'sick'|null, arrivalTime, departureTime, totalMins }
 *
 * @param {string} uId      profiles.id
 * @param {number} year     e.g. 2026
 * @param {number} month    0-based month index (Date.getMonth()-style)
 * @returns {Promise<Array>} per-day rows, sorted by date ascending
 */
export async function fetchEmployeeDailyDetails(uId, year, month) {
  const first   = `${year}-${String(month + 1).padStart(2, '0')}-01`
  const lastDay = new Date(year, month + 1, 0).getDate()
  const last    = isoDate(year, month, lastDay)

  const [{ data: attData }, { data: repData }] = await Promise.all([
    supabase.from('attendance').select('date, day_type, arrival_time, departure_time')
      .eq('user_id', uId).gte('date', first).lte('date', last),
    supabase.from('hour_reports').select('date, hours, minutes')
      .eq('user_id', uId).gte('date', first).lte('date', last),
  ])

  const dayMap = new Map()
  for (const a of (attData || [])) {
    const existing = dayMap.get(a.date) || {
      date: a.date, dayType: null, attMins: 0, repMins: 0,
      arrivalTime: null, departureTime: null,
    }
    if (a.day_type) existing.dayType = a.day_type
    /* Capture first non-null arrival/departure seen for this date */
    if (a.arrival_time && !existing.arrivalTime) existing.arrivalTime = a.arrival_time.slice(0, 5)
    if (a.departure_time && !existing.departureTime) existing.departureTime = a.departure_time.slice(0, 5)
    if (a.day_type === 'work' && a.arrival_time && a.departure_time) {
      existing.attMins += toMins(a.departure_time.slice(0, 5)) - toMins(a.arrival_time.slice(0, 5))
    }
    dayMap.set(a.date, existing)
  }
  for (const r of (repData || [])) {
    const existing = dayMap.get(r.date) || {
      date: r.date, dayType: null, attMins: 0, repMins: 0,
      arrivalTime: null, departureTime: null,
    }
    existing.repMins += (r.hours || 0) * 60 + (r.minutes || 0)
    dayMap.set(r.date, existing)
  }

  const rows = []
  for (const day of dayMap.values()) {
    /* Prefer attendance-diff (actual time at work); fall back to hour_reports sum (admin case) */
    const totalMins = day.attMins > 0 ? day.attMins : day.repMins
    /* Include days that are marked vacation/sick OR that have any hours.
       Skip empty days (no day_type AND no hours). */
    if (day.dayType === 'vacation' || day.dayType === 'sick' || totalMins > 0) {
      rows.push({
        date:          day.date,
        dayType:       day.dayType,
        arrivalTime:   day.arrivalTime,
        departureTime: day.departureTime,
        totalMins,
      })
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date))
  return rows
}

/**
 * Format a single drill line.
 * Vacation / sick → date + label.
 * Work day (or any day with hours) → `${date}  |  ${arrival} - ${departure}  |  סה״כ שעות: ${total}`.
 * Missing arrival/departure → "—". The "HH:MM - HH:MM" run is left to the
 * browser's natural bidi handling (LTR run inside RTL paragraph) so
 * arrival reads rightmost.
 */
export const formatDrillLine = (day) => {
  const date = formatDDMMYY(day.date)
  if (day.dayType === 'vacation') return `${date}  |  יום חופש`
  if (day.dayType === 'sick')     return `${date}  |  יום מחלה`
  const arrival   = day.arrivalTime   || '—'
  const departure = day.departureTime || '—'
  const total     = formatTotalHHMM(day.totalMins)
  return `${date}  |  ${arrival} - ${departure}  |  סה״כ שעות: ${total}`
}
