-- Defense in depth: this app has no public/anonymous pages, so the anon
-- role should not even be able to resolve objects in the public schema,
-- regardless of what RLS policies would otherwise allow or deny.

revoke all on schema public from anon;

-- Any future table/function created in public should not grant anon
-- anything by default either.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on sequences from anon;
