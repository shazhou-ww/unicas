UPDATE spaces_principal_spaces
SET
  space_id = '/' || space_id,
  updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE space_id NOT LIKE '/%';
