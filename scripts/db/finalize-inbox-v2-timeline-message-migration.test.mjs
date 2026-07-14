import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertParentUniqueConstraintsBeforeForeignKeys,
  collectFinalizedMigrationDdlStatements
} from "../checks/db-check-lib.mjs";

const finalizerPath = fileURLToPath(
  new URL("./finalize-inbox-v2-timeline-message-migration.mjs", import.meta.url)
);
const checkedInPreflightPath = fileURLToPath(
  new URL("./inbox-v2-timeline-message-preflight.sql", import.meta.url)
);
const statementBreakpoint = "--> statement-breakpoint";
const finalizedMarker = "INBOX_V2_TIMELINE_MESSAGE_MIGRATION_FINALIZED_V1";
const preflightMarker = "INBOX_V2_TIMELINE_MESSAGE_PREFLIGHT_V1";
const invariantSql = String.raw`create or replace function public.inbox_v2_test_timeline_message_invariant()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  return new;
end;
$function$;`;
const providerSemanticInvariantSql = String.raw`create or replace function public.inbox_v2_test_provider_semantic_ordering_invariant()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  return new;
end;
$function$;`;

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe("Inbox V2 Timeline/Message migration finalizer", () => {
  it("injects the preflight and both invariant blocks once and moves parent keys before foreign keys", async () => {
    const fixture = await createFinalizerFixture();
    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status, result.stderr).toBe(0);
    const finalizedSql = await readFile(fixture.migrationPath, "utf8");
    expect(countOccurrences(finalizedSql, finalizedMarker)).toBe(1);
    expect(countOccurrences(finalizedSql, preflightMarker)).toBe(1);
    expect(countOccurrences(finalizedSql, invariantSql)).toBe(1);
    expect(countOccurrences(finalizedSql, providerSemanticInvariantSql)).toBe(
      1
    );
    expect(result.stdout).toContain("2 invariant blocks");
    expect(finalizedSql.indexOf("files_tenant_id_unique")).toBeLessThan(
      finalizedSql.indexOf("timeline_content_file_fk")
    );
    expect(finalizedSql.indexOf("event_store_tenant_id_unique")).toBeLessThan(
      finalizedSql.indexOf("timeline_content_file_fk")
    );
    expect(
      finalizedSql.indexOf("inbox_v2_messages_revision_unique")
    ).toBeLessThan(finalizedSql.indexOf("timeline_content_file_fk"));
    expect(
      finalizedSql.indexOf(
        "inbox_v2_source_thread_bindings_owner_account_unique"
      )
    ).toBeLessThan(finalizedSql.indexOf("timeline_content_file_fk"));

    expect(
      collectFinalizedMigrationDdlStatements({
        migrationSql: finalizedSql,
        finalizedMarker,
        preflightMarker,
        invariantBlocks: [
          {
            name: "INBOX_V2_TIMELINE_MESSAGE_INVARIANTS_SQL",
            sql: invariantSql
          },
          {
            name: "INBOX_V2_PROVIDER_SEMANTIC_ORDERING_INVARIANTS_SQL",
            sql: providerSemanticInvariantSql
          }
        ]
      })
    ).toEqual([
      'CREATE TABLE "inbox_v2_timeline_content_blocks" ("tenant_id" text NOT NULL);',
      'ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_unique" UNIQUE("tenant_id","id");',
      'ALTER TABLE "event_store" ADD CONSTRAINT "event_store_tenant_id_unique" UNIQUE("tenant_id","id");',
      'ALTER TABLE "inbox_v2_messages" ADD CONSTRAINT "inbox_v2_messages_content_unique" UNIQUE("tenant_id","content_id");',
      'ALTER TABLE "inbox_v2_messages" ADD CONSTRAINT "inbox_v2_messages_revision_unique" UNIQUE("tenant_id","id","timeline_item_id","revision");',
      'ALTER TABLE "inbox_v2_timeline_items" ADD CONSTRAINT "inbox_v2_timeline_items_revision_unique" UNIQUE("tenant_id","id","conversation_id","revision");',
      'ALTER TABLE "inbox_v2_timeline_items" ADD CONSTRAINT "inbox_v2_timeline_items_subject_unique" UNIQUE("tenant_id","id","subject_kind");',
      'ALTER TABLE "inbox_v2_timeline_items" ADD CONSTRAINT "inbox_v2_timeline_items_sequence_unique" UNIQUE("tenant_id","conversation_id","timeline_sequence");',
      'ALTER TABLE "inbox_v2_source_thread_bindings" ADD CONSTRAINT "inbox_v2_source_thread_bindings_owner_account_unique" UNIQUE("tenant_id","id","source_account_id");',
      'ALTER TABLE "inbox_v2_timeline_content_blocks" ADD CONSTRAINT "timeline_content_file_fk" FOREIGN KEY ("tenant_id") REFERENCES "files"("tenant_id");'
    ]);
    expect(() =>
      assertParentUniqueConstraintsBeforeForeignKeys({
        migrationSql: finalizedSql,
        constraintNames: [
          "files_tenant_id_unique",
          "event_store_tenant_id_unique",
          "inbox_v2_messages_content_unique",
          "inbox_v2_messages_revision_unique",
          "inbox_v2_timeline_items_revision_unique",
          "inbox_v2_timeline_items_subject_unique",
          "inbox_v2_timeline_items_sequence_unique",
          "inbox_v2_source_thread_bindings_owner_account_unique"
        ]
      })
    ).not.toThrow();
  });

  it("rejects duplicate parent-key DDL before touching the generated migration", async () => {
    const fixture = await createFinalizerFixture({ duplicateParentKey: true });
    const before = await readFile(fixture.migrationPath, "utf8");
    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/files_tenant_id_unique=2/u);
    await expect(readFile(fixture.migrationPath, "utf8")).resolves.toBe(before);
  });

  it("rejects a missing invariant export before touching the generated migration", async () => {
    const fixture = await createFinalizerFixture({ missingInvariant: true });
    const before = await readFile(fixture.migrationPath, "utf8");
    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(
      /Could not extract INBOX_V2_TIMELINE_MESSAGE_INVARIANTS_SQL/u
    );
    await expect(readFile(fixture.migrationPath, "utf8")).resolves.toBe(before);
  });

  it("rejects a missing provider semantic invariant export before touching the generated migration", async () => {
    const fixture = await createFinalizerFixture({
      missingProviderSemanticInvariant: true
    });
    const before = await readFile(fixture.migrationPath, "utf8");
    const result = runFinalizer(fixture.root, fixture.migrationPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(
      /Could not extract INBOX_V2_PROVIDER_SEMANTIC_ORDERING_INVARIANTS_SQL/u
    );
    await expect(readFile(fixture.migrationPath, "utf8")).resolves.toBe(before);
  });
});

describe("Inbox V2 Timeline/Message migration preflight", () => {
  it("keeps clean DB-003 anchors allowed and classifies missing, partial and populated states", async () => {
    const preflightSql = await readFile(checkedInPreflightPath, "utf8");

    expect(preflightSql.startsWith(`-- ${preflightMarker}`)).toBe(true);
    expect(preflightSql).toContain(
      "inbox_v2.timeline_message_foundation_missing"
    );
    expect(preflightSql).toContain(
      "inbox_v2.timeline_message_partial_schema_detected"
    );
    expect(preflightSql).toContain(
      "inbox_v2.timeline_message_backfill_required"
    );
    expect(preflightSql).toContain("errcode = '23514'");
    expect(preflightSql).toContain(
      "inbox_v2_source_occurrences_children_constraint"
    );
    expect(preflightSql).toContain("inbox_v2_work_items_aggregate_constraint");
    expect(preflightSql).toContain("to_regclass('public.files')");
    expect(preflightSql).toContain("to_regclass('public.event_store')");
    expect(preflightSql).toContain("to_regclass('public.source_accounts')");
    expect(preflightSql).toContain(
      "to_regclass('public.normalized_inbound_events')"
    );
    expect(preflightSql).toContain(
      "to_regclass('public.inbox_v2_external_message_references')"
    );
    expect(preflightSql).toContain("select count(*) <> 5");
    expect(preflightSql).toContain("select count(*) <> 6");
    expect(preflightSql).toMatch(
      /partial_object\.relname not in \(\s*'inbox_v2_timeline_items', 'inbox_v2_messages'/u
    );
    expect(preflightSql).toContain("inbox_v2_timeline_subject%");
    expect(preflightSql).toContain("inbox_v2_outbound_route_consumption%");
    expect(preflightSql).toContain("inbox_v2_provider_semantic_ordering%");
    expect(preflightSql).toMatch(
      /partial_type\.typname not in \(\s*'inbox_v2_timeline_items', 'inbox_v2_messages'/u
    );
    for (const partialTypePrefix of [
      "inbox_v2_timeline\\_%",
      "inbox_v2_app_actor\\_%",
      "inbox_v2_automation_causation\\_%",
      "inbox_v2_attachment_materialization\\_%",
      "inbox_v2_message\\_%",
      "inbox_v2_staff_note\\_%",
      "inbox_v2_provider_lifecycle\\_%",
      "inbox_v2_reaction\\_%",
      "inbox_v2_delivery\\_%",
      "inbox_v2_receipt\\_%"
    ]) {
      expect(preflightSql).toContain(partialTypePrefix);
    }
    expect(preflightSql).toContain("inbox_v2_tm\\_%");
    expect(preflightSql).toContain(
      "exists (select 1 from public.inbox_v2_timeline_items limit 1)"
    );
    expect(preflightSql).toContain(
      "exists (select 1 from public.inbox_v2_messages limit 1)"
    );
    expect(preflightSql).toContain(
      "do not contain enough evidence to infer immutable author, canonical sequence, classified content or lifecycle"
    );
    expect(preflightSql).toContain("files_tenant_id_unique");
    expect(preflightSql).toContain("event_store_tenant_id_unique");
  });
});

async function createFinalizerFixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "hulee-db005-finalizer-"));
  temporaryRoots.push(root);
  const preflightPath = join(
    root,
    "scripts/db/inbox-v2-timeline-message-preflight.sql"
  );
  const invariantPath = join(
    root,
    "packages/db/src/schema/inbox-v2/timeline-message.ts"
  );
  const providerSemanticInvariantPath = join(
    root,
    "packages/db/src/schema/inbox-v2/provider-semantic-ordering.ts"
  );
  const migrationPath = join(
    root,
    "packages/db/drizzle/0031_inbox_v2_timeline_message_foundation.sql"
  );
  await Promise.all([
    mkdir(dirname(preflightPath), { recursive: true }),
    mkdir(dirname(invariantPath), { recursive: true }),
    mkdir(dirname(migrationPath), { recursive: true })
  ]);

  const parentKey =
    'ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_unique" UNIQUE("tenant_id","id");';
  const eventStoreParentKey =
    'ALTER TABLE "event_store" ADD CONSTRAINT "event_store_tenant_id_unique" UNIQUE("tenant_id","id");';
  const messageContentParentKey =
    'ALTER TABLE "inbox_v2_messages" ADD CONSTRAINT "inbox_v2_messages_content_unique" UNIQUE("tenant_id","content_id");';
  const messageRevisionParentKey =
    'ALTER TABLE "inbox_v2_messages" ADD CONSTRAINT "inbox_v2_messages_revision_unique" UNIQUE("tenant_id","id","timeline_item_id","revision");';
  const timelineRevisionParentKey =
    'ALTER TABLE "inbox_v2_timeline_items" ADD CONSTRAINT "inbox_v2_timeline_items_revision_unique" UNIQUE("tenant_id","id","conversation_id","revision");';
  const timelineSubjectParentKey =
    'ALTER TABLE "inbox_v2_timeline_items" ADD CONSTRAINT "inbox_v2_timeline_items_subject_unique" UNIQUE("tenant_id","id","subject_kind");';
  const timelineSequenceParentKey =
    'ALTER TABLE "inbox_v2_timeline_items" ADD CONSTRAINT "inbox_v2_timeline_items_sequence_unique" UNIQUE("tenant_id","conversation_id","timeline_sequence");';
  const sourceThreadBindingOwnerAccountParentKey =
    'ALTER TABLE "inbox_v2_source_thread_bindings" ADD CONSTRAINT "inbox_v2_source_thread_bindings_owner_account_unique" UNIQUE("tenant_id","id","source_account_id");';
  const statements = [
    'CREATE TABLE "inbox_v2_timeline_content_blocks" ("tenant_id" text NOT NULL);',
    'ALTER TABLE "inbox_v2_timeline_content_blocks" ADD CONSTRAINT "timeline_content_file_fk" FOREIGN KEY ("tenant_id") REFERENCES "files"("tenant_id");',
    parentKey,
    eventStoreParentKey,
    messageContentParentKey,
    messageRevisionParentKey,
    timelineRevisionParentKey,
    timelineSubjectParentKey,
    timelineSequenceParentKey,
    sourceThreadBindingOwnerAccountParentKey
  ];
  if (options.duplicateParentKey) statements.push(parentKey);

  await Promise.all([
    writeFile(
      preflightPath,
      `-- ${preflightMarker}\ndo $preflight$ begin null; end; $preflight$;\n`,
      "utf8"
    ),
    writeFile(
      invariantPath,
      options.missingInvariant
        ? "export const SOMETHING_ELSE = String.raw`select 1`;\n"
        : `export const INBOX_V2_TIMELINE_MESSAGE_INVARIANTS_SQL = String.raw\`${invariantSql}\`;\n`,
      "utf8"
    ),
    writeFile(
      providerSemanticInvariantPath,
      options.missingProviderSemanticInvariant
        ? "export const SOMETHING_ELSE = String.raw`select 1`;\n"
        : `export const INBOX_V2_PROVIDER_SEMANTIC_ORDERING_INVARIANTS_SQL = String.raw\`${providerSemanticInvariantSql}\`;\n`,
      "utf8"
    ),
    writeFile(
      migrationPath,
      `${statements.join(`\n${statementBreakpoint}\n`)}\n`,
      "utf8"
    )
  ]);

  return { root, migrationPath };
}

function runFinalizer(root, migrationPath) {
  return spawnSync(process.execPath, [finalizerPath, migrationPath], {
    cwd: root,
    encoding: "utf8"
  });
}

function countOccurrences(value, fragment) {
  return value.split(fragment).length - 1;
}
