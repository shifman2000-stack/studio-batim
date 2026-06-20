// src/lib/generateAuthCode.js
//
// Generate a unique per-project authorization code in the format
// 'BATIM' + 4 zero-padded digits (e.g. 'BATIM7430').
//
// Used at project-creation time by:
//   - ProjectsKanban.handleAddProject  ("פרויקט חדש" modal)
//   - Inquiries.handleConvert          ("הפוך לפרויקט")
//
// Race-resistance: the candidate is checked against the DB before the
// caller's insert. The column has a UNIQUE constraint so the
// worst case (two callers picking the same code simultaneously) still
// fails the second insert at the DB layer; the constraint is the final
// guard, this helper just makes the happy path collision-free.

const MAX_ATTEMPTS = 15

function newCandidate() {
  return 'BATIM' + String(Math.floor(Math.random() * 10000)).padStart(4, '0')
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<string|null>} The unique code, or null if every
 *   attempt collided (vanishingly unlikely with 10,000 codes and a
 *   small project set). Callers should treat null as "skip auth_code,
 *   project still creates" — never block creation on this.
 */
export async function generateUniqueAuthCode(supabase) {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const candidate = newCandidate()
    /* maybeSingle so "no row" is NOT treated as an error; data === null
       means the code is free. */
    const { data, error } = await supabase
      .from('projects')
      .select('id')
      .eq('auth_code', candidate)
      .maybeSingle()
    if (error) {
      /* A read failure shouldn't gate creation. Bubble up null so the
         caller proceeds without setting auth_code. */
      console.warn('generateUniqueAuthCode — uniqueness check failed:', error)
      return null
    }
    if (data === null) return candidate
  }
  console.warn(`generateUniqueAuthCode — exhausted ${MAX_ATTEMPTS} attempts; returning null`)
  return null
}
