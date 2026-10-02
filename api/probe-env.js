// TEMPORARY probe — branch fix/quote-phase0 only, removed before the branch is done.
// Reports ONLY whether env vars are present and which Supabase project the
// function talks to. Never prints a key, never touches the database.
export default async function handler(req, res) {
  const url = process.env.VITE_SUPABASE_URL || ''
  const projectRef = (url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1] || null
  return res.status(200).json({
    hasSupabaseUrl:        !!process.env.VITE_SUPABASE_URL,
    supabaseProjectRef:    projectRef,            // ctwjglmva… = Dev · gastdpztg… = Prod
    hasServiceRoleKey:     !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    serviceRoleKeyLength:  (process.env.SUPABASE_SERVICE_ROLE_KEY || '').length,
    hasAnonKey:            !!process.env.VITE_SUPABASE_ANON_KEY,
    vercelEnv:             process.env.VERCEL_ENV || null,
    nodeVersion:           process.version,
  })
}
