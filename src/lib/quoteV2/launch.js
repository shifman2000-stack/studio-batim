// src/lib/quoteV2/launch.js
//
// The single switch that decides what a NEW quote is.
//
// ⚠️ It governs NEW quotes only. An existing quote always opens by its
// OWN schema — a v1 draft stays a v1 draft forever, flag or no flag
// (design decision 18: moving to v2 is an explicit act that creates a
// new quote, never a silent conversion). Flipping this back to false
// returns the app to exactly today's behaviour; nothing already created
// changes shape.
export const V2_FOR_NEW_QUOTES = true

/** A quote row is v2 when its own content says so. Nothing else decides. */
export const isV2Quote = (quote) => Number(quote?.draft_content?.schema) === 2

/** Same for a sent/signed version's content. */
export const isV2Content = (content) => Number(content?.schema) === 2

/**
 * The quote that represents an inquiry in a list: the one with the
 * highest quote_number.
 *
 * ⚠️ Before this, the map was built by assignment in fetch order, so an
 * inquiry with more than one quote showed whichever row the database
 * happened to return last — a v1 quote from phase 0 could hide the v2
 * quote that replaced it, with its status, its tooltip and its link.
 */
export function latestQuoteOf(quotes) {
  let best = null
  for (const q of quotes ?? []) {
    if (!best || (q.quote_number ?? 0) > (best.quote_number ?? 0)) best = q
  }
  return best
}

/**
 * The Gmail compose URL for sending a quote link — the SAME shape v1
 * builds in QuoteBuilder, moved here so the two faces cannot drift.
 *
 * The second contact is added only when it is a different address;
 * Gmail would otherwise show the same person twice.
 */
export function quoteGmailUrl({ inquiry, link }) {
  const subject = 'הצעת מחיר — סטודיו בתים'
  const body =
    `שלום ${inquiry?.first_name ?? ''},\n\n` +
    `מצורף קישור להצעת מחיר עבורכם:\n${link}\n\n` +
    'נשמח לקבל את חתימתכם דרך הקישור.\n\n' +
    'לכל שאלה אני זמינה.\n\n' +
    'בברכה,\nעינב שיפמן\nסטודיו בתים'

  const primary   = (inquiry?.email || '').trim()
  const secondary = (inquiry?.contact2_email || '').trim()
  const to = [primary].filter(Boolean)
  if (secondary && secondary.toLowerCase() !== primary.toLowerCase()) to.push(secondary)

  return 'https://mail.google.com/mail/?view=cm&fs=1'
    + `&to=${to.map(e => encodeURIComponent(e)).join(',')}`
    + `&su=${encodeURIComponent(subject)}`
    + `&body=${encodeURIComponent(body)}`
}
