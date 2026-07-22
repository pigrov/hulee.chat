import type { HuleeDatabase } from "./client";

export const INBOX_V2_RUNTIME_SCHEMA_EPOCH =
  "preproduction-inbox-v2-1" as const;

export const inboxV2RuntimeSchemaContract = Object.freeze({
  epoch: INBOX_V2_RUNTIME_SCHEMA_EPOCH,
  migrations: Object.freeze([
    Object.freeze({
      hash: "2c9701257243a76640a921a6589254cb5f5493b77578bf04e74f2cb257446272",
      createdAt: "1784656735719"
    })
  ])
});

export type InboxV2RuntimeSchemaEvidence = Readonly<{
  epoch: typeof INBOX_V2_RUNTIME_SCHEMA_EPOCH;
  migrationCount: number;
  currentInboxRelation: "inbox_v2_conversations";
  legacyInboxRelationCount: 0;
  legacyInboxTypeCount: 0;
}>;

export class InboxV2RuntimeSchemaEpochError extends Error {
  readonly code:
    | "inbox_v2.runtime_schema_unavailable"
    | "inbox_v2.runtime_schema_epoch_mismatch";

  constructor(
    code: InboxV2RuntimeSchemaEpochError["code"],
    message: string,
    options?: ErrorOptions
  ) {
    super(`${code}: ${message}`, options);
    this.name = "InboxV2RuntimeSchemaEpochError";
    this.code = code;
  }
}

export function assertInboxV2RuntimeSchemaEpochDeclaration(input: {
  runtimeEnvironment: string | undefined;
  declaredEpoch: string | undefined;
}): void {
  const declarationRequired = input.runtimeEnvironment === "production";
  if (
    (declarationRequired || input.declaredEpoch !== undefined) &&
    input.declaredEpoch !== INBOX_V2_RUNTIME_SCHEMA_EPOCH
  ) {
    throw new InboxV2RuntimeSchemaEpochError(
      "inbox_v2.runtime_schema_epoch_mismatch",
      `Runtime declaration must equal ${INBOX_V2_RUNTIME_SCHEMA_EPOCH}.`
    );
  }
}

type RuntimeSchemaProbeRow = Readonly<{
  migration_relation_exists: boolean;
  current_inbox_relation_exists: boolean;
  legacy_conversations_relation_exists: boolean;
  legacy_participants_relation_exists: boolean;
  legacy_messages_relation_exists: boolean;
  legacy_delivery_relation_exists: boolean;
  legacy_attachments_relation_exists: boolean;
  legacy_conversation_type_exists: boolean;
  legacy_message_direction_type_exists: boolean;
  legacy_message_status_type_exists: boolean;
}>;

type RuntimeMigrationRow = Readonly<{
  hash: unknown;
  created_at: unknown;
}>;

/**
 * Prevents an API or worker process from serving against any database other
 * than the exact, current clean-slate Inbox V2 baseline. Deployment still runs
 * the exhaustive schema/ACL audit; this fast startup fence makes an old,
 * missing, newer or V1-bearing epoch fail before runtime composition starts.
 */
export async function assertInboxV2RuntimeSchemaEpoch(
  database: Pick<HuleeDatabase, "$client">
): Promise<InboxV2RuntimeSchemaEvidence> {
  let probeRows: readonly RuntimeSchemaProbeRow[];
  let migrationRows: readonly RuntimeMigrationRow[];
  try {
    const probe = await database.$client.query<RuntimeSchemaProbeRow>(`
      select
        to_regclass('drizzle.__drizzle_migrations') is not null as migration_relation_exists,
        to_regclass('public.inbox_v2_conversations') is not null as current_inbox_relation_exists,
        to_regclass('public.conversations') is not null as legacy_conversations_relation_exists,
        to_regclass('public.conversation_participants') is not null as legacy_participants_relation_exists,
        to_regclass('public.messages') is not null as legacy_messages_relation_exists,
        to_regclass('public.message_delivery_attempts') is not null as legacy_delivery_relation_exists,
        to_regclass('public.message_attachments') is not null as legacy_attachments_relation_exists,
        to_regtype('public.conversation_type') is not null as legacy_conversation_type_exists,
        to_regtype('public.message_direction') is not null as legacy_message_direction_type_exists,
        to_regtype('public.message_status') is not null as legacy_message_status_type_exists
    `);
    probeRows = probe.rows;

    if (probeRows[0]?.migration_relation_exists !== true) {
      migrationRows = [];
    } else {
      const migrationJournal = await database.$client
        .query<RuntimeMigrationRow>(`
        select hash, created_at::text as created_at
          from drizzle.__drizzle_migrations
         order by created_at, id
      `);
      migrationRows = migrationJournal.rows;
    }
  } catch (error) {
    throw new InboxV2RuntimeSchemaEpochError(
      "inbox_v2.runtime_schema_unavailable",
      "The current Inbox V2 schema epoch could not be verified.",
      { cause: error }
    );
  }

  const [probe] = probeRows;
  const legacyRelations = probe
    ? [
        probe.legacy_conversations_relation_exists,
        probe.legacy_participants_relation_exists,
        probe.legacy_messages_relation_exists,
        probe.legacy_delivery_relation_exists,
        probe.legacy_attachments_relation_exists
      ].filter((relationExists) => relationExists)
    : [];
  const expectedMigrations = inboxV2RuntimeSchemaContract.migrations;
  const legacyTypes = probe
    ? [
        probe.legacy_conversation_type_exists,
        probe.legacy_message_direction_type_exists,
        probe.legacy_message_status_type_exists
      ].filter((typeExists) => typeExists)
    : [];
  const migrationMatches =
    migrationRows.length === expectedMigrations.length &&
    migrationRows.every(
      (migration, index) =>
        migration.hash === expectedMigrations[index]?.hash &&
        migration.created_at === expectedMigrations[index]?.createdAt
    );

  if (
    probeRows.length !== 1 ||
    probe?.migration_relation_exists !== true ||
    probe.current_inbox_relation_exists !== true ||
    legacyRelations.length !== 0 ||
    legacyTypes.length !== 0 ||
    !migrationMatches
  ) {
    throw new InboxV2RuntimeSchemaEpochError(
      "inbox_v2.runtime_schema_epoch_mismatch",
      `Runtime requires schema epoch ${INBOX_V2_RUNTIME_SCHEMA_EPOCH}; migration journal, canonical relation or removed V1 relation boundary does not match.`
    );
  }

  return Object.freeze({
    epoch: INBOX_V2_RUNTIME_SCHEMA_EPOCH,
    migrationCount: migrationRows.length,
    currentInboxRelation: "inbox_v2_conversations",
    legacyInboxRelationCount: 0,
    legacyInboxTypeCount: 0
  });
}
