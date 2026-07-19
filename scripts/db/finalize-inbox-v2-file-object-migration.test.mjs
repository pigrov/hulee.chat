import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const finalizerPath = fileURLToPath(
  new URL("./finalize-inbox-v2-file-object-migration.mjs", import.meta.url)
);
const statementBreakpoint = "--> statement-breakpoint";
const finalizedMarker = "INBOX_V2_FILE_OBJECT_MIGRATION_FINALIZED_V1";
const invariantExportName = "INBOX_V2_FILE_OBJECT_INVARIANTS_SQL";
const anchorInvariantExportName =
  "INBOX_V2_MESSAGE_ATTACHMENT_ANCHOR_INVARIANTS_SQL";
const authorizationInvariantExportName =
  "INBOX_V2_AUTH_DOMAIN_PROVIDER_IO_CLOSURE_SQL";
const requiredTables = [
  "inbox_v2_file_attachment_materialization_attempts",
  "inbox_v2_file_attachment_materialization_evidence",
  "inbox_v2_file_attachment_materialization_jobs",
  "inbox_v2_file_derivative_edges",
  "inbox_v2_file_object_operation_evidence",
  "inbox_v2_file_object_version_heads",
  "inbox_v2_file_object_versions",
  "inbox_v2_file_objects",
  "inbox_v2_file_outbound_artifact_blocks",
  "inbox_v2_file_outbound_artifact_plans",
  "inbox_v2_file_outbound_dispatch_plans",
  "inbox_v2_file_parent_link_heads",
  "inbox_v2_file_parent_links",
  "inbox_v2_file_parent_set_heads",
  "inbox_v2_file_storage_orphans",
  "inbox_v2_file_versions"
];
const requiredEnums = [
  "inbox_v2_file_attachment_materialization_outcome",
  "inbox_v2_file_attachment_materialization_state",
  "inbox_v2_file_attachment_source_locator_kind",
  "inbox_v2_file_object_operation_kind",
  "inbox_v2_file_object_operation_outcome",
  "inbox_v2_file_object_state",
  "inbox_v2_file_object_version_state",
  "inbox_v2_file_object_versioning_mode",
  "inbox_v2_file_outbound_artifact_grouping",
  "inbox_v2_file_outbound_block_kind",
  "inbox_v2_file_parent_kind",
  "inbox_v2_file_parent_link_state",
  "inbox_v2_file_parent_purpose",
  "inbox_v2_file_parent_set_completeness",
  "inbox_v2_file_parent_visibility",
  "inbox_v2_file_storage_orphan_state"
];
const nullableBridgeColumns = [
  "attachment_v2_file_id",
  "attachment_file_version_id",
  "attachment_object_version_id",
  "extension_payload_v2_file_id",
  "extension_payload_file_version_id",
  "extension_payload_object_version_id"
];
const nullableRevisionBridgeColumns = [
  "attachment_file_revision",
  "extension_payload_file_revision"
];
const nullableAttachmentAnchorColumns = [
  ["owner_message_id", "text"],
  ["owner_timeline_item_id", "text"],
  ["owner_timeline_content_id", "text"],
  ["owner_block_key", "text"],
  ["materialization_state", '"inbox_v2_attachment_materialization_state"']
];
const invariantSql = String.raw`alter table public.inbox_v2_timeline_content_payloads
  alter constraint inbox_v2_timeline_content_payloads_file_version_fk
  deferrable initially deferred;

create or replace function public.inbox_v2_test_file_object_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform 1
    from public.inbox_v2_outbound_routes route_row
    join public.inbox_v2_file_outbound_dispatch_plans plan_row
      on route_row.adapter_declaration_revision =
         plan_row.adapter_contract_declaration_revision
     and route_row.adapter_loaded_by_trusted_service_id =
         plan_row.adapter_loaded_by_trusted_service_id
     and route_row.adapter_loaded_at = plan_row.adapter_loaded_at;
  return new;
end;
$function$;`;
const anchorInvariantSql = String.raw`alter table public.inbox_v2_message_attachment_anchors
  add constraint inbox_v2_message_attachment_anchors_owner_message_fk
  foreign key (tenant_id, owner_message_id)
  references public.inbox_v2_messages (tenant_id, id)
  deferrable initially deferred not valid;

create or replace function public.inbox_v2_msg003_action_attribution_cause_event_coherence()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform 1 from public.inbox_v2_domain_events event_row for key share;
  perform 1 from public.event_store event_row for key share;
  raise exception using errcode = '23503',
    message = 'inbox_v2.action_attribution_cause_event_missing';
end;
$function$;

create constraint trigger inbox_v2_msg003_action_attribution_cause_event_coherence
after insert or update on public.inbox_v2_action_attributions
deferrable initially deferred for each row
execute function public.inbox_v2_msg003_action_attribution_cause_event_coherence();

create or replace function public.inbox_v2_msg003_legacy_cause_event_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  raise exception using errcode = '23503',
    message = 'inbox_v2.action_attribution_legacy_cause_event_referenced';
end;
$function$;

create trigger inbox_v2_msg003_legacy_cause_event_guard
before update or delete on public.event_store
for each row execute function public.inbox_v2_msg003_legacy_cause_event_guard();

create or replace function public.inbox_v2_msg003_attachment_anchor_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if pg_catalog.pg_trigger_depth() > 1
       and not exists (
         select 1 from public.tenants tenant_row
          where tenant_row.id = old.tenant_id
       ) then
      return old;
    end if;
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_attachment_anchor_immutable';
  end if;
  if new.owner_message_id is null then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_attachment_anchor_owner_required';
  end if;
  if tg_op = 'UPDATE' then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_attachment_anchor_transition_invalid';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_msg003_attachment_anchor_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform 1
    from public.inbox_v2_message_attachment_anchors anchor_row
    join public.inbox_v2_timeline_content_payloads payload_row
      on anchor_row.owner_timeline_content_id = payload_row.content_id
     and anchor_row.materialization_state = payload_row.attachment_state;
  return null;
end;
$function$;`;
const attachmentAuthorizationInvariantSql = String.raw`create or replace function public.inbox_v2_auth_attachment_message_change_valid(
  expected_tenant_id text,
  expected_command_result_reference jsonb,
  expected_audit_revision_delta_hash text
)
returns boolean
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  select message_change.resulting_revision >= 2
     and message_change.payload_reference =
         expected_command_result_reference
     and content_revision_row.transition_kind = 'attachment_materialization'
     and content_revision_row.event_id = message_event.id
     and revision_row.change_kind = 'attachment_materialized'
     and attribution_row.app_actor_kind = 'trusted_service'
     and attribution_row.automation_cause_event_id is not null
     and job_row.cause_event_id =
              attribution_row.automation_cause_event_id
     and job_row.authorization_actor_kind = 'trusted_service'
     and expected_audit_revision_delta_hash <>
         'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    from public.inbox_v2_tenant_stream_changes message_change
    join public.inbox_v2_timeline_content_revisions content_revision_row
      on true
    join public.inbox_v2_message_revisions revision_row on true
    join public.inbox_v2_action_attributions attribution_row on true
    join public.inbox_v2_domain_events message_event on true
    join public.inbox_v2_file_attachment_materialization_jobs job_row
      on true;
$function$;

create or replace function public.inbox_v2_auth_domain_mutation_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if 'core:attachment.materialization.complete' is null then
    raise exception using errcode = '23514',
      message = 'inbox_v2.domain_mutation_attachment_cardinality_invalid';
  end if;
  return new;
end;
$function$;`;
const refreshedInvariantSql = `${invariantSql}\n-- refreshed exact tail`;
const refreshedAnchorInvariantSql = `${anchorInvariantSql}\n-- refreshed anchor tail`;
const refreshedAttachmentAuthorizationInvariantSql =
  attachmentAuthorizationInvariantSql.replace(
    "  return new;\nend;\n$function$;",
    "  perform true;\n  return new;\nend;\n$function$;"
  );
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe("Inbox V2 file/object migration finalizer", () => {
  it("appends exactly one marker and one exact invariant tail", async () => {
    const fixture = await createFixture();
    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status, result.stderr).toBe(0);
    const finalized = await readFile(fixture.migrationPath, "utf8");
    expect(countOccurrences(finalized, finalizedMarker)).toBe(1);
    expect(countOccurrences(finalized, invariantSql)).toBe(1);
    expect(
      countOccurrences(finalized, attachmentAuthorizationInvariantSql)
    ).toBe(1);
    expect(countOccurrences(finalized, anchorInvariantSql)).toBe(1);
    expect(finalized).toContain(`-- ${finalizedMarker}\n${invariantSql}`);
    expect(finalized).toContain(
      `${invariantSql}\n\n${attachmentAuthorizationInvariantSql}\n\n${anchorInvariantSql}`
    );
    expect(finalized.trimEnd().endsWith(anchorInvariantSql)).toBe(true);
    expect(result.stdout).toContain("additive generated DDL statements");
  });

  it("rejects a second finalization and refreshes only the exact tail", async () => {
    const fixture = await createFixture();
    expect(runFinalizer(fixture.root, fixture.migrationPath).status).toBe(0);
    const finalized = await readFile(fixture.migrationPath, "utf8");

    const duplicate = runFinalizer(fixture.root, fixture.migrationPath);
    expect(duplicate.status).not.toBe(0);
    expect(duplicate.stderr).toContain("already finalized");
    await expect(readFile(fixture.migrationPath, "utf8")).resolves.toBe(
      finalized
    );

    await writeInvariant(fixture.invariantPath, refreshedInvariantSql);
    await writeAnchorInvariant(
      fixture.anchorInvariantPath,
      refreshedAnchorInvariantSql
    );
    await writeAuthorizationInvariant(
      fixture.authorizationInvariantPath,
      refreshedAttachmentAuthorizationInvariantSql
    );
    const refreshed = runFinalizer(fixture.root, fixture.migrationPath, true);
    expect(refreshed.status, refreshed.stderr).toBe(0);
    const refreshedSql = await readFile(fixture.migrationPath, "utf8");
    expect(countOccurrences(refreshedSql, finalizedMarker)).toBe(1);
    expect(countOccurrences(refreshedSql, refreshedInvariantSql)).toBe(1);
    expect(
      countOccurrences(
        refreshedSql,
        refreshedAttachmentAuthorizationInvariantSql
      )
    ).toBe(1);
    expect(countOccurrences(refreshedSql, refreshedAnchorInvariantSql)).toBe(1);
    expect(refreshedSql.trimEnd().endsWith(refreshedAnchorInvariantSql)).toBe(
      true
    );
  });

  it("rejects incomplete, destructive and backfill generated DDL unchanged", async () => {
    for (const options of [
      { missingTable: true, expected: /CREATE TABLE/u },
      { destructive: true, expected: /destructive or backfill DDL/u },
      { backfill: true, expected: /destructive or backfill DDL/u },
      { nonNullableBridge: true, expected: /nullable N-1 bridge column/u },
      {
        nonNullableAnchor: true,
        expected: /nullable N-1 attachment-anchor column/u
      },
      {
        missingAdapterSnapshotColumn: true,
        expected: /complete immutable adapter load snapshot/u
      },
      {
        legacyContentDigest: true,
        expected: /finite HMAC content fingerprint/u
      }
    ]) {
      const fixture = await createFixture(options);
      const before = await readFile(fixture.migrationPath, "utf8");
      const result = runFinalizer(fixture.root, fixture.migrationPath);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(options.expected);
      await expect(readFile(fixture.migrationPath, "utf8")).resolves.toBe(
        before
      );
    }
  });
});

async function createFixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "hulee-msg003-finalizer-"));
  temporaryRoots.push(root);
  const migrationPath = join(
    root,
    "packages/db/drizzle/0053_inbox_v2_typed_content_and_attachments.sql"
  );
  const invariantPath = join(
    root,
    "packages/db/src/schema/inbox-v2/file-object.ts"
  );
  const anchorInvariantPath = join(
    root,
    "packages/db/src/schema/inbox-v2/timeline-message.ts"
  );
  const authorizationInvariantPath = join(
    root,
    "packages/db/src/schema/inbox-v2/authorization-relations.ts"
  );
  await Promise.all([
    mkdir(dirname(migrationPath), { recursive: true }),
    mkdir(dirname(invariantPath), { recursive: true }),
    mkdir(dirname(anchorInvariantPath), { recursive: true }),
    mkdir(dirname(authorizationInvariantPath), { recursive: true })
  ]);

  const tables = options.missingTable
    ? requiredTables.slice(1)
    : requiredTables;
  const statements = [
    ...requiredEnums.map(
      (name) => `CREATE TYPE "public"."${name}" AS ENUM('fixture');`
    ),
    ...tables.map((name) =>
      name === "inbox_v2_file_outbound_dispatch_plans"
        ? `CREATE TABLE "${name}" (` +
          '"tenant_id" text NOT NULL, ' +
          '"content_fingerprint_purpose_id" text NOT NULL, ' +
          '"content_fingerprint_key_generation" text NOT NULL, ' +
          '"content_fingerprint_valid_until" timestamp (3) with time zone NOT NULL, ' +
          '"content_fingerprint_hmac_sha256" text NOT NULL, ' +
          (options.legacyContentDigest
            ? '"content_digest_sha256" text NOT NULL, '
            : "") +
          '"adapter_contract_declaration_revision" bigint NOT NULL, ' +
          '"adapter_loaded_by_trusted_service_id" text NOT NULL' +
          (options.missingAdapterSnapshotColumn
            ? ""
            : ', "adapter_loaded_at" timestamp (3) with time zone NOT NULL') +
          ");"
        : `CREATE TABLE "${name}" ("tenant_id" text NOT NULL);`
    ),
    'ALTER TABLE "inbox_v2_action_attributions" DROP CONSTRAINT "inbox_v2_action_attributions_cause_event_fk";',
    'ALTER TABLE "inbox_v2_timeline_content_payloads" DROP CONSTRAINT "inbox_v2_timeline_content_payloads_shape_check";',
    ...nullableBridgeColumns.map(
      (name, index) =>
        `ALTER TABLE "inbox_v2_timeline_content_payloads" ADD COLUMN "${name}" text${options.nonNullableBridge && index === 0 ? " NOT NULL" : ""};`
    ),
    ...nullableRevisionBridgeColumns.map(
      (name) =>
        `ALTER TABLE "inbox_v2_timeline_content_payloads" ADD COLUMN "${name}" bigint;`
    ),
    ...nullableAttachmentAnchorColumns.map(
      ([name, sqlType], index) =>
        `ALTER TABLE "inbox_v2_message_attachment_anchors" ADD COLUMN "${name}" ${sqlType}${options.nonNullableAnchor && index === 0 ? " NOT NULL" : ""};`
    ),
    'CREATE INDEX "inbox_v2_action_attributions_cause_event_idx" ON "inbox_v2_action_attributions" USING btree ("tenant_id","automation_cause_event_id") WHERE "inbox_v2_action_attributions"."automation_cause_event_id" is not null;',
    'ALTER TABLE "inbox_v2_timeline_content_payloads" ADD CONSTRAINT "inbox_v2_timeline_content_payloads_shape_check" CHECK (num_nonnulls(attachment_file_id, attachment_v2_file_id) = 1);'
  ];
  if (options.destructive) statements.push('DROP TABLE "legacy_files";');
  if (options.backfill) {
    statements.push(
      'UPDATE "inbox_v2_timeline_content_payloads" SET "attachment_v2_file_id" = "attachment_file_id";'
    );
  }

  await Promise.all([
    writeFile(
      migrationPath,
      `${statements.join(`\n${statementBreakpoint}\n`)}\n`,
      "utf8"
    ),
    writeInvariant(invariantPath, invariantSql),
    writeAnchorInvariant(anchorInvariantPath, anchorInvariantSql),
    writeAuthorizationInvariant(
      authorizationInvariantPath,
      attachmentAuthorizationInvariantSql
    )
  ]);
  return {
    root,
    migrationPath,
    invariantPath,
    anchorInvariantPath,
    authorizationInvariantPath
  };
}

function runFinalizer(root, migrationPath, refresh = false) {
  return spawnSync(
    process.execPath,
    [finalizerPath, ...(refresh ? ["--refresh"] : []), migrationPath],
    { cwd: root, encoding: "utf8" }
  );
}

function writeInvariant(path, sql) {
  return writeFile(
    path,
    `export const ${invariantExportName} = String.raw\`${sql}\`;\n`,
    "utf8"
  );
}

function writeAnchorInvariant(path, sql) {
  return writeFile(
    path,
    `export const ${anchorInvariantExportName} = String.raw\`${sql}\`;\n`,
    "utf8"
  );
}

function writeAuthorizationInvariant(path, sql) {
  return writeFile(
    path,
    `export const ${authorizationInvariantExportName} = String.raw\`${sql}\`;\n`,
    "utf8"
  );
}

function countOccurrences(value, fragment) {
  return value.split(fragment).length - 1;
}
