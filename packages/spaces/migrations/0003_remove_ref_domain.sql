CREATE TABLE spaces_principal_spaces_next (
  principal_id TEXT PRIMARY KEY REFERENCES spaces_principals(principal_id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (app_id, space_id)
);
INSERT INTO spaces_principal_spaces_next
  (principal_id, app_id, space_id, created_at, updated_at)
SELECT principal_id, app_id, space_id, created_at, updated_at
FROM spaces_principal_spaces;
DROP TABLE spaces_principal_spaces;
ALTER TABLE spaces_principal_spaces_next RENAME TO spaces_principal_spaces;
