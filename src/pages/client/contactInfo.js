// src/pages/client/contactInfo.js
//
// Single source of truth for Studio Batim's contact endpoints. Used by:
//   - ClientContact ("צור קשר" screen)
//   - ClientFooter  (sticky bottom bar on every portal screen)
//
// PHONE / EMAIL are raw identifiers used in `tel:` / `mailto:` hrefs.
// PHONE_DISPLAY is the human-readable formatting for rendered text.
// WHATSAPP_URL is the full wa.me link — IL international format with
// the leading 0 dropped and 972 prepended.

export const PHONE         = '0529593927'
export const PHONE_DISPLAY = '052-959-3927'
export const WHATSAPP_URL  = 'https://wa.me/972529593927'
export const EMAIL         = 'einav.studiob@gmail.com'
