-- Any admin (including one promoted via promoteToAdmin) could previously
-- promote other teachers to admin or revoke any admin -- including the
-- original admin account, which would have locked everyone out. Only the
-- designated super admin should be able to grant/revoke admin access; a
-- promoted admin keeps every other admin privilege, just not this one.
ALTER TABLE users ADD COLUMN is_super_admin BOOLEAN NOT NULL DEFAULT false;
UPDATE users SET is_super_admin = true WHERE email = 'admin@apace.test' AND role = 'admin';
