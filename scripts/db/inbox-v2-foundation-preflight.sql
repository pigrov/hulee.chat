-- INBOX_V2_FOUNDATION_PREFLIGHT_V1
DO $inbox_v2_preflight$
DECLARE
  violations jsonb := '{}'::jsonb;
  violation_count bigint;
BEGIN
  SELECT count(*) INTO violation_count
    FROM source_accounts account_row
    LEFT JOIN source_connections connection_row
      ON connection_row.id = account_row.source_connection_id
   WHERE connection_row.id IS NULL
      OR connection_row.tenant_id IS DISTINCT FROM account_row.tenant_id;
  IF violation_count > 0 THEN
    violations := violations || jsonb_build_object(
      'source_accounts.connection_tenant', violation_count
    );
  END IF;

  SELECT count(*) INTO violation_count
    FROM raw_inbound_events raw_row
    LEFT JOIN source_connections connection_row
      ON connection_row.id = raw_row.source_connection_id
   WHERE connection_row.id IS NULL
      OR connection_row.tenant_id IS DISTINCT FROM raw_row.tenant_id;
  IF violation_count > 0 THEN
    violations := violations || jsonb_build_object(
      'raw_inbound_events.connection_tenant', violation_count
    );
  END IF;

  SELECT count(*) INTO violation_count
    FROM raw_inbound_events raw_row
    LEFT JOIN source_accounts account_row
      ON account_row.id = raw_row.source_account_id
   WHERE raw_row.source_account_id IS NOT NULL
     AND (
       account_row.id IS NULL
       OR account_row.tenant_id IS DISTINCT FROM raw_row.tenant_id
     );
  IF violation_count > 0 THEN
    violations := violations || jsonb_build_object(
      'raw_inbound_events.account_tenant', violation_count
    );
  END IF;

  SELECT count(*) INTO violation_count
    FROM raw_inbound_events raw_row
    LEFT JOIN source_accounts account_row
      ON account_row.id = raw_row.source_account_id
   WHERE raw_row.source_account_id IS NOT NULL
     AND (
       account_row.id IS NULL
       OR account_row.source_connection_id IS DISTINCT FROM
          raw_row.source_connection_id
     );
  IF violation_count > 0 THEN
    violations := violations || jsonb_build_object(
      'raw_inbound_events.account_connection', violation_count
    );
  END IF;

  SELECT count(*) INTO violation_count
    FROM normalized_inbound_events normalized_row
    LEFT JOIN raw_inbound_events raw_row
      ON raw_row.id = normalized_row.raw_event_id
   WHERE raw_row.id IS NULL
      OR raw_row.tenant_id IS DISTINCT FROM normalized_row.tenant_id;
  IF violation_count > 0 THEN
    violations := violations || jsonb_build_object(
      'normalized_inbound_events.raw_tenant', violation_count
    );
  END IF;

  SELECT count(*) INTO violation_count
    FROM normalized_inbound_events normalized_row
    LEFT JOIN source_connections connection_row
      ON connection_row.id = normalized_row.source_connection_id
   WHERE connection_row.id IS NULL
      OR connection_row.tenant_id IS DISTINCT FROM normalized_row.tenant_id;
  IF violation_count > 0 THEN
    violations := violations || jsonb_build_object(
      'normalized_inbound_events.connection_tenant', violation_count
    );
  END IF;

  SELECT count(*) INTO violation_count
    FROM normalized_inbound_events normalized_row
    LEFT JOIN source_accounts account_row
      ON account_row.id = normalized_row.source_account_id
   WHERE normalized_row.source_account_id IS NOT NULL
     AND (
       account_row.id IS NULL
       OR account_row.tenant_id IS DISTINCT FROM normalized_row.tenant_id
     );
  IF violation_count > 0 THEN
    violations := violations || jsonb_build_object(
      'normalized_inbound_events.account_tenant', violation_count
    );
  END IF;

  SELECT count(*) INTO violation_count
    FROM normalized_inbound_events normalized_row
    LEFT JOIN source_accounts account_row
      ON account_row.id = normalized_row.source_account_id
   WHERE normalized_row.source_account_id IS NOT NULL
     AND (
       account_row.id IS NULL
       OR account_row.source_connection_id IS DISTINCT FROM
          normalized_row.source_connection_id
     );
  IF violation_count > 0 THEN
    violations := violations || jsonb_build_object(
      'normalized_inbound_events.account_connection', violation_count
    );
  END IF;

  SELECT count(*) INTO violation_count
    FROM normalized_inbound_events normalized_row
    LEFT JOIN raw_inbound_events raw_row
      ON raw_row.id = normalized_row.raw_event_id
   WHERE raw_row.id IS NULL
      OR raw_row.source_connection_id IS DISTINCT FROM
         normalized_row.source_connection_id;
  IF violation_count > 0 THEN
    violations := violations || jsonb_build_object(
      'normalized_inbound_events.raw_connection', violation_count
    );
  END IF;

  SELECT count(*) INTO violation_count
    FROM normalized_inbound_events normalized_row
    LEFT JOIN raw_inbound_events raw_row
      ON raw_row.id = normalized_row.raw_event_id
   WHERE raw_row.id IS NULL
      OR raw_row.source_account_id IS DISTINCT FROM
         normalized_row.source_account_id;
  IF violation_count > 0 THEN
    violations := violations || jsonb_build_object(
      'normalized_inbound_events.raw_account', violation_count
    );
  END IF;

  SELECT count(*) INTO violation_count
    FROM client_contacts contact_row
    LEFT JOIN clients client_row
      ON client_row.id = contact_row.client_id
   WHERE client_row.id IS NULL
      OR client_row.tenant_id IS DISTINCT FROM contact_row.tenant_id;
  IF violation_count > 0 THEN
    violations := violations || jsonb_build_object(
      'client_contacts.client_tenant', violation_count
    );
  END IF;

  IF violations <> '{}'::jsonb THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Inbox V2 migration preflight failed: migration.tenant_edge_invalid',
      DETAIL = violations::text,
      HINT = 'Repair the listed legacy tenant edges before retrying migration 0029.';
  END IF;
END
$inbox_v2_preflight$;
