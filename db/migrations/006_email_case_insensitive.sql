-- register()/login() previously matched email verbatim, so
-- "Jane@Example.com" and "jane@example.com" were treated as two different
-- addresses -- the plain UNIQUE(email) constraint from 001_init.sql never
-- caught the collision, letting the same person sign up twice. Normalize
-- existing rows, then enforce uniqueness on the lowercased value so a given
-- email can only ever back one account regardless of casing used at signup.
UPDATE users SET email = LOWER(email) WHERE email IS NOT NULL AND email <> LOWER(email);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (LOWER(email));
