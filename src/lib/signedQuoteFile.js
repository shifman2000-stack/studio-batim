// src/lib/signedQuoteFile.js
//
// One place that builds links to a signed quote PDF in Supabase storage,
// shared by the admin side (פניות, QuoteBuilder) and the client's own
// quote page — so both offer the same file under the same name.
//
// WHY THE `download` QUERY PARAM, NOT AN ANCHOR ATTRIBUTE
// The PDF lives on the Supabase storage origin, not ours. An <a download>
// attribute is ignored cross-origin: the browser navigates to the file
// instead of saving it, and any filename we asked for is dropped.
// Supabase's public object endpoint accepts ?download=<filename> and
// answers with Content-Disposition: attachment; filename=<filename>,
// which works cross-origin because the SERVER sets it.
//
// FILENAME IS ASCII ON PURPOSE
// Content-Disposition carries the value we pass in the query string. A
// Hebrew filename there has to survive URL encoding, the storage layer
// and the browser's own header parsing, and it degrades to mojibake in
// several combinations. "quote-{number}-signed.pdf" is unambiguous
// everywhere; the Hebrew context lives in the UI, not the file name.

/**
 * ASCII download name for a signed quote.
 * Anything unexpected in quote_number is stripped rather than escaped,
 * so the result can never break the header or the URL.
 *
 * @param {string|number|null|undefined} quoteNumber quotes.quote_number
 * @returns {string} e.g. "quote-1042-signed.pdf"
 */
export function signedQuoteFilename(quoteNumber) {
  const clean = String(quoteNumber ?? '').replace(/[^0-9A-Za-z_-]/g, '')
  return clean ? `quote-${clean}-signed.pdf` : 'quote-signed.pdf'
}

/**
 * The stored URL, unchanged — for opening the PDF in a tab.
 * Returns '' when there is nothing to open, so callers can treat the
 * empty string as "no signed document available".
 *
 * @param {string|null|undefined} signedFileUrl quote_versions.signed_file_url
 */
export function signedQuoteOpenUrl(signedFileUrl) {
  return signedFileUrl || ''
}

/**
 * The stored URL plus ?download=<ascii name>, which makes the storage
 * server send it as an attachment.
 *
 * @param {string|null|undefined} signedFileUrl quote_versions.signed_file_url
 * @param {string|number|null|undefined} quoteNumber quotes.quote_number
 * @returns {string} '' when there is no file
 */
export function signedQuoteDownloadUrl(signedFileUrl, quoteNumber) {
  if (!signedFileUrl) return ''
  const sep = signedFileUrl.includes('?') ? '&' : '?'
  return `${signedFileUrl}${sep}download=${encodeURIComponent(signedQuoteFilename(quoteNumber))}`
}
