// Shared prices: where everyone's price updates are stored online (Supabase).
//
// Leave these empty and prices are only saved on each person's own phone.
// Fill them in (from Supabase: Project Settings → API) and everyone shares the same prices.
// The key here is the "publishable" (or "anon public") key, which is safe to put in a website.
// Never put the "secret" or "service_role" key here.

const SHARED_DB = {
  url: "",   // e.g. "https://abcdefghijkl.supabase.co"
  key: ""    // e.g. "sb_publishable_..."
};
