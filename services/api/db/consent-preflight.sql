-- Read-only checks for the target database before applying migration 003.
-- Run with the intended API schema/search_path. Results contain schema/counts, not identities.
SELECT current_schema() AS schema_name;
WITH required(table_name,column_name) AS (VALUES
  ('devices','id'),('devices','subject_id'),('devices','vault_id'),
  ('consent_events','device_id'),('consent_events','activation_request_id'),
  ('consent_events','activation_id'),('consent_events','purpose'),
  ('audit_events','actor_id'),('audit_events','metadata'))
SELECT r.table_name,r.column_name AS missing_column
FROM required r LEFT JOIN information_schema.columns c
  ON c.table_schema=current_schema() AND c.table_name=r.table_name AND c.column_name=r.column_name
WHERE c.column_name IS NULL;
SELECT data_type AS audit_actor_type FROM information_schema.columns
WHERE table_schema=current_schema() AND table_name='audit_events' AND column_name='actor_id';
SELECT count(*) AS duplicate_request_groups FROM (
  SELECT device_id,activation_request_id FROM consent_events
  WHERE activation_request_id IS NOT NULL
  GROUP BY device_id,activation_request_id HAVING count(*)>1
) duplicates;
SELECT indexname,indexdef FROM pg_indexes
WHERE schemaname=current_schema() AND indexname='consent_events_device_request_unique';
SELECT table_name,
  has_table_privilege(current_user,format('%I.%I',current_schema(),table_name),'SELECT') AS can_read,
  has_table_privilege(current_user,format('%I.%I',current_schema(),table_name),'INSERT') AS can_append
FROM information_schema.tables
WHERE table_schema=current_schema() AND table_name IN('devices','consent_events','audit_events');
