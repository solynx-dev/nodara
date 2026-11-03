-- Email codes and email changes.
--
-- Emails now carry a short code next to the link, so people can finish a
-- password reset, verification or email change inside the app. Codes are
-- stored hashed, and a token stops accepting codes after a few wrong tries.
ALTER TABLE auth_tokens DROP CONSTRAINT IF EXISTS auth_tokens_purpose_check;
ALTER TABLE auth_tokens ADD CONSTRAINT auth_tokens_purpose_check
  CHECK (purpose IN ('verify_email', 'reset_password', 'admin_invite', 'change_email'));
ALTER TABLE auth_tokens ADD COLUMN code_hash text;
ALTER TABLE auth_tokens ADD COLUMN attempts int NOT NULL DEFAULT 0;
-- The new address, for an email change.
ALTER TABLE auth_tokens ADD COLUMN email text;
CREATE INDEX auth_tokens_open_idx ON auth_tokens(user_id, purpose, created_at DESC) WHERE used_at IS NULL;
