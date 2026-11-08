-- Run in Supabase SQL Editor AFTER setting SUPABASE_SERVICE_ROLE_KEY in Vercel
-- and configuring the authenticated companion bridge on Windows.
-- Does not delete or rewrite existing requests/system state.
BEGIN;
ALTER TABLE public.portal_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.portal_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.portal_requests TO service_role;
COMMIT;

-- Verification using the publishable/anon key must return permission denied,
-- including for id = '__SYSTEM_STATE__'. The server's service role keeps access.
-- Never grant anon access again as a workaround for a misconfigured server.
