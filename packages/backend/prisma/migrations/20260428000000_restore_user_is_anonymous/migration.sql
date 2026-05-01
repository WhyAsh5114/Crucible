-- Restore user.isAnonymous on databases where it was dropped out-of-band.
-- The schema still declares this column, but some local DBs ended up without
-- it after the SIWE migration churn. IF NOT EXISTS keeps this a no-op on
-- machines that already have the column from 20260426220000_add_anonymous_user.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "isAnonymous" BOOLEAN DEFAULT false;
