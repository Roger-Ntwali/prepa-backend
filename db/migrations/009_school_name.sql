-- The mobile registration form has always collected a free-text school
-- name, but register() never stored it anywhere -- `school_id` is a real
-- FK to the schools table and the app has no way to supply a valid one,
-- so school_name was silently dropped on every signup. Every student's
-- Profile screen has shown a blank "School" field ever since. A separate
-- plain-text column sidesteps the FK problem entirely: no matching against
-- (or accidentally duplicating) rows in `schools` required.
ALTER TABLE users ADD COLUMN school_name VARCHAR(150);
