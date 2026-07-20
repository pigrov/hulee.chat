import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import {
  INBOX_V2_MESSAGE_LIFECYCLE_SCHEMA_VERSION,
  INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_CREATION_COMMIT_SCHEMA_ID,
  INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_OPERATION_ENTITY_TYPE_ID,
  INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_OPERATION_SCHEMA_ID,
  INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_SCHEMA_VERSION,
  INBOX_V2_MESSAGE_REVISION_SCHEMA_ID,
  INBOX_V2_MESSAGE_SCHEMA_ID,
  INBOX_V2_MESSAGE_SCHEMA_VERSION,
  calculateInboxV2CanonicalSha256,
  calculateInboxV2MessageContentDigest,
  inboxV2AppActorSchema,
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2BigintCounterSchema,
  inboxV2ConversationParticipantSchema,
  inboxV2MessageContentBlockSchema,
  inboxV2MessageCreationCommitSchema,
  inboxV2MessageEditFileUploadAuthorityTargetSchema,
  inboxV2MessageEditFileSourceAuthorityTargetSchema,
  inboxV2MessageMutationCommitSchema,
  inboxV2MessageProviderLifecycleOperationCreationCommitSchema,
  inboxV2MessageProviderLifecycleTransitionCommitSchema,
  inboxV2OutboundRouteSchema,
  inboxV2SourceIdentityObjectKindIdSchema,
  inboxV2SourceIdentityRealmIdSchema,
  inboxV2SourceOccurrenceMaterializationCommitSchema,
  inboxV2SourceThreadBindingCreationCommitSchema,
  inboxV2SchemaVersionTokenSchema,
  inboxV2TenantIdSchema,
  inboxV2ThreadRoutePolicySchema,
  inboxV2TimelineFileSourceParentSchema,
  inboxV2TimelineContentHeadOf,
  inboxV2TimelineContentSchema,
  type InboxV2AuthorizationDecisionReference,
  type InboxV2MessageEditFileUploadAuthorityTarget,
  type InboxV2MessageEditFileSourceAuthorityTarget,
  type InboxV2MessageCreationCommit,
  type InboxV2MessageProviderLifecycleOperationCreationCommit
} from "@hulee/contracts";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  fixtureExternalTargetRoute,
  fixtureInternalCreationCommit,
  fixtureParticipant,
  fixtureReference,
  fixtureSourceConnectionReference,
  fixtureSourceCreationCommit,
  fixtureT0,
  fixtureT1,
  fixtureT2,
  fixtureT3,
  fixtureT4
} from "../../../contracts/src/inbox-v2/timeline-message-fixtures.type-fixture";
import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import { createSqlInboxV2ExternalThreadRepository } from "./sql-inbox-v2-external-thread-repository";
import { calculateInboxV2FileParentIdentityDigest } from "./sql-inbox-v2-file-object-repository";
import { createSqlInboxV2MessageLifecycleAtomicCoordinator } from "./sql-inbox-v2-message-lifecycle-command-coordinator";
import {
  buildCompareAndSwapInboxV2SourceOccurrenceResolutionSql,
  buildInsertInboxV2ExternalMessageReferenceSql,
  buildInsertInboxV2OutboundRouteSql,
  buildInsertInboxV2SourceOccurrenceResolutionTransitionSql,
  createSqlInboxV2OutboundTransportRepository
} from "./sql-inbox-v2-outbound-transport-repository";
import { createSqlInboxV2SourceExternalIdentityRepository } from "./sql-inbox-v2-source-external-identity-repository";
import { createSqlInboxV2SourceOccurrenceRepository } from "./sql-inbox-v2-source-occurrence-repository";
import { createSqlInboxV2SourceThreadBindingRepository } from "./sql-inbox-v2-source-thread-binding-repository";
import {
  computeInboxV2LeafHashDigest,
  type WithInboxV2AuthorizedCommandMutationInput
} from "./sql-inbox-v2-authorization-repository";
import {
  createSqlInboxV2TimelineMessageRepository,
  deriveInboxV2MessageEditReadyFileParents
} from "./sql-inbox-v2-timeline-message-repository";
import type { RawSqlExecutor } from "./sql-outbox-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const tenantId = inboxV2TenantIdSchema.parse(`tenant:msg005-${runId}`);
const streamEpoch = `stream-epoch:msg005-${runId}`;

type MessageMutation = ReturnType<
  typeof inboxV2MessageMutationCommitSchema.parse
>;

type LifecycleReadyFileParent = ReturnType<
  typeof deriveInboxV2MessageEditReadyFileParents
>[number];

type LifecycleUploadSourceAuthorityTarget = Extract<
  InboxV2MessageEditFileSourceAuthorityTarget,
  { purpose: "attachment" }
> &
  Readonly<{
    sourceParent: Extract<
      InboxV2MessageEditFileSourceAuthorityTarget["sourceParent"],
      { kind: "upload_staging" }
    >;
  }>;

type LifecycleEmployeeParticipant = Omit<
  InboxV2MessageCreationCommit["authorParticipant"],
  "subject"
> &
  Readonly<{
    subject: Extract<
      InboxV2MessageCreationCommit["authorParticipant"]["subject"],
      { kind: "employee" }
    >;
  }>;

type OutboundRoute = ReturnType<typeof inboxV2OutboundRouteSchema.parse>;

type LifecycleFixture = Readonly<{
  input: WithInboxV2AuthorizedCommandMutationInput;
  messageMutation: MessageMutation | null;
  providerCreation: InboxV2MessageProviderLifecycleOperationCreationCommit | null;
  fileUploadAuthorityPlan: readonly InboxV2MessageEditFileUploadAuthorityTarget[];
  fileSourceAuthorityPlan: readonly InboxV2MessageEditFileSourceAuthorityTarget[];
}>;

describe("MSG005 migration moderation fixture coherence", () => {
  it("builds allowed and denied mutations with a distinct Employee moderator", () => {
    for (const label of [
      "migration-internal-allowed-probe",
      "migration-external-denied-probe"
    ]) {
      const creation = migrationCreation(label);
      const moderator = lifecycleOperatorFixture(
        creation,
        `${label}-moderator`
      );
      const mutation = editMutation(creation, label, `Probe ${label}`, {
        actionParticipant: moderator,
        actionAppActor: lifecycleEmployeeAppActor(
          moderator,
          `${label}-moderator`
        )
      });

      expect(moderator.id).not.toBe(creation.authorParticipant.id);
      expect(mutation).toMatchObject({
        actionParticipantSnapshot: { id: moderator.id },
        revision: {
          actionAttribution: {
            actionParticipant: { id: moderator.id },
            appActor: {
              kind: "employee",
              employee: { id: moderator.subject.employee.id }
            }
          }
        }
      });
    }
  });
});

describePostgres(
  "SQL Inbox V2 Message lifecycle authorized coordinator (PostgreSQL)",
  () => {
    let db: HuleeDatabase;
    let nextHistoricalPosition = 100;

    beforeAll(async () => {
      db = createHuleeDatabase();
      const readiness = await db.execute<{
        operations: string | null;
        streamCommits: string | null;
        routeConsumptions: string | null;
      }>(sql`
        select
          to_regclass('public.inbox_v2_message_provider_lifecycle_operations')::text
            as "operations",
          to_regclass('public.inbox_v2_tenant_stream_commits')::text
            as "streamCommits",
          to_regclass('public.inbox_v2_outbound_route_consumptions')::text
            as "routeConsumptions"
      `);
      if (
        Object.values(readiness.rows[0] ?? {}).some((value) => value === null)
      ) {
        throw new Error(
          "Inbox V2 Message lifecycle and authorization migrations are not applied."
        );
      }
      await db.execute(sql`
        insert into tenants (id, slug, display_name, deployment_type)
        values (
          ${tenantId}, ${`msg005-${runId}`},
          'MSG005 lifecycle integration tenant', 'saas_shared'
        )
      `);
      await executeHistoricalFixtureSql(
        db,
        sql`
        insert into inbox_v2_tenant_stream_heads (
          tenant_id, stream_epoch, last_position, min_retained_position,
          revision, created_at, updated_at
        ) values (
          ${tenantId}, ${streamEpoch}, 1000, 0, 1, ${fixtureT0}, ${fixtureT0}
        )
      `
      );
    }, 30_000);

    afterAll(async () => {
      if (db) await closeHuleeDatabase(db);
    });

    async function seedInternal(suffix: string) {
      const creation = internalCreation(suffix);
      await seedInternalCommit(creation);
      return creation;
    }

    async function seedInternalCommit(creation: InboxV2MessageCreationCommit) {
      await seedInternalCreationAnchors(db, creation);
      const created = await historicalTimelineFixtureRepository(
        db
      ).createMessage({
        commit: creation,
        streamPosition: position(String(nextHistoricalPosition++))
      });
      expect(created).toMatchObject({ kind: "created" });
    }

    it("commits an own-author edit through the production two-phase capability seam", async () => {
      const creation = await seedInternal("edit-applied");
      const mutation = editMutation(creation, "edit-applied", "Edited safely");
      const fixture = lifecycleFixture({
        label: "edit-applied",
        messageMutation: mutation,
        providerCreation: null
      });

      const result = await createSqlInboxV2MessageLifecycleAtomicCoordinator(
        db
      ).withAuthorizedMessageLifecycleMutation({
        authorizedMutation: fixture.input,
        messageMutation: mutation,
        providerOperationCreation: null,
        legalHoldFence: null,
        fileUploadAuthorityPlan: [],
        fileSourceAuthorityPlan: []
      });

      expect(result).toMatchObject({
        kind: "applied",
        result: {
          messageId: creation.message.id,
          messageRevision: "2",
          providerOperationId: null
        }
      });
      expect(await committedClosure(db, fixture)).toEqual({
        commands: 1,
        streamCommits: 1,
        changes: 1,
        events: 1,
        outboxIntents: 1,
        messageRevisions: 1,
        providerOperations: 0
      });
      await expect(
        createSqlInboxV2TimelineMessageRepository(db).findMessage({
          tenantId,
          messageId: creation.message.id
        })
      ).resolves.toMatchObject({
        revision: "2",
        lifecycle: { kind: "active" }
      });
    }, 30_000);

    it("uses locked internal Timeline visibility for migration moderation and rejects external authority without closure", async () => {
      const allowedCreation = migrationCreation("migration-internal-allowed");
      await seedInternalCommit(allowedCreation);
      const allowedModerator = await seedLifecycleOperator(
        db,
        allowedCreation,
        "migration-internal-allowed-moderator"
      );
      const allowedMutation = editMutation(
        allowedCreation,
        "migration-internal-allowed",
        "Moderated migrated history",
        {
          actionParticipant: allowedModerator,
          actionAppActor: lifecycleEmployeeAppActor(
            allowedModerator,
            "migration-internal-allowed-moderator"
          )
        }
      );
      const allowedFixture = lifecycleFixture({
        label: "migration-internal-allowed",
        messageMutation: allowedMutation,
        providerCreation: null,
        authorityKind: "moderate_internal"
      });
      await expect(
        createSqlInboxV2MessageLifecycleAtomicCoordinator(
          db
        ).withAuthorizedMessageLifecycleMutation({
          authorizedMutation: allowedFixture.input,
          messageMutation: allowedMutation,
          providerOperationCreation: null,
          legalHoldFence: null,
          fileUploadAuthorityPlan: [],
          fileSourceAuthorityPlan: []
        })
      ).resolves.toMatchObject({ kind: "applied" });
      expect(await committedClosure(db, allowedFixture)).toMatchObject({
        commands: 1,
        messageRevisions: 1
      });

      const deniedCreation = migrationCreation("migration-external-denied");
      await seedInternalCommit(deniedCreation);
      const deniedModerator = await seedLifecycleOperator(
        db,
        deniedCreation,
        "migration-external-denied-moderator"
      );
      const deniedMutation = editMutation(
        deniedCreation,
        "migration-external-denied",
        "Must remain unchanged",
        {
          actionParticipant: deniedModerator,
          actionAppActor: lifecycleEmployeeAppActor(
            deniedModerator,
            "migration-external-denied-moderator"
          )
        }
      );
      const deniedFixture = lifecycleFixture({
        label: "migration-external-denied",
        messageMutation: deniedMutation,
        providerCreation: null,
        authorityKind: "moderate_external"
      });
      await expect(
        createSqlInboxV2MessageLifecycleAtomicCoordinator(
          db
        ).withAuthorizedMessageLifecycleMutation({
          authorizedMutation: deniedFixture.input,
          messageMutation: deniedMutation,
          providerOperationCreation: null,
          legalHoldFence: null,
          fileUploadAuthorityPlan: [],
          fileSourceAuthorityPlan: []
        })
      ).rejects.toThrow(
        "Message lifecycle command requires the exact allowed action authorization decision."
      );
      expect(await committedClosure(db, deniedFixture)).toEqual(zeroClosure());
      await expect(
        createSqlInboxV2TimelineMessageRepository(db).findMessage({
          tenantId,
          messageId: deniedCreation.message.id
        })
      ).resolves.toMatchObject({ revision: "1" });
    }, 30_000);

    it("commits local delete as one Message tombstone without provider work", async () => {
      const creation = await seedInternal("local-delete-applied");
      const mutation = localDeleteMutation(creation, "local-delete-applied");
      const fixture = lifecycleFixture({
        label: "local-delete-applied",
        messageMutation: mutation,
        providerCreation: null
      });

      const result = await createSqlInboxV2MessageLifecycleAtomicCoordinator(
        db
      ).withAuthorizedMessageLifecycleMutation({
        authorizedMutation: fixture.input,
        messageMutation: mutation,
        providerOperationCreation: null,
        legalHoldFence: deleteLegalHoldFence(mutation.beforeTimelineItem.id),
        fileUploadAuthorityPlan: [],
        fileSourceAuthorityPlan: []
      });

      expect(result).toMatchObject({
        kind: "applied",
        result: {
          messageId: creation.message.id,
          messageRevision: "2",
          providerOperationId: null
        }
      });
      expect(await committedClosure(db, fixture)).toEqual({
        commands: 1,
        streamCommits: 1,
        changes: 1,
        events: 1,
        outboxIntents: 1,
        messageRevisions: 1,
        providerOperations: 0
      });
      await expect(
        createSqlInboxV2TimelineMessageRepository(db).findMessage({
          tenantId,
          messageId: creation.message.id
        })
      ).resolves.toMatchObject({
        revision: "2",
        lifecycle: {
          kind: "local_delete_tombstone",
          reasonId: "core:employee-delete"
        }
      });
    }, 30_000);

    it("rolls an unauthorized actor mismatch back before any canonical closure", async () => {
      const creation = await seedInternal("denied-rollback");
      const mutation = editMutation(
        creation,
        "denied-rollback",
        "Must not persist"
      );
      const intruderId = `employee:msg005-intruder-${runId}`;
      await db.execute(sql`
        insert into employees (
          id, tenant_id, email, display_name, profile, created_at, updated_at
        ) values (
          ${intruderId}, ${tenantId}, ${`msg005-intruder-${runId}@example.test`},
          'MSG005 intruder', '{}'::jsonb, ${fixtureT0}, ${fixtureT0}
        )
      `);
      const fixture = lifecycleFixture({
        label: "denied-rollback",
        messageMutation: mutation,
        providerCreation: null,
        actor: {
          employeeId: intruderId,
          authorizationEpoch: `authorization:msg005-intruder-${runId}`
        }
      });

      await expect(
        createSqlInboxV2MessageLifecycleAtomicCoordinator(
          db
        ).withAuthorizedMessageLifecycleMutation({
          authorizedMutation: fixture.input,
          messageMutation: mutation,
          providerOperationCreation: null,
          legalHoldFence: null,
          fileUploadAuthorityPlan: [],
          fileSourceAuthorityPlan: []
        })
      ).rejects.toThrow(
        "Message lifecycle action actor must match the authenticated command actor."
      );
      expect(await committedClosure(db, fixture)).toEqual(zeroClosure());
      await expect(
        createSqlInboxV2TimelineMessageRepository(db).findMessage({
          tenantId,
          messageId: creation.message.id
        })
      ).resolves.toMatchObject({
        revision: "1",
        lifecycle: { kind: "active" }
      });
    }, 30_000);

    it("maps a stale Message to revision_conflict and rolls every candidate write back", async () => {
      const creation = await seedInternal("revision-conflict");
      const winning = editMutation(
        creation,
        "revision-conflict-winner",
        "Winning edit"
      );
      await expect(
        createSqlInboxV2TimelineMessageRepository(db).mutateMessage({
          commit: winning,
          streamPosition: position(String(nextHistoricalPosition++))
        })
      ).resolves.toMatchObject({ kind: "applied", message: { revision: "2" } });
      const stale = editMutation(
        creation,
        "revision-conflict-stale",
        "Stale edit"
      );
      const fixture = lifecycleFixture({
        label: "revision-conflict-stale",
        messageMutation: stale,
        providerCreation: null
      });

      await expect(
        createSqlInboxV2MessageLifecycleAtomicCoordinator(
          db
        ).withAuthorizedMessageLifecycleMutation({
          authorizedMutation: fixture.input,
          messageMutation: stale,
          providerOperationCreation: null,
          legalHoldFence: null,
          fileUploadAuthorityPlan: [],
          fileSourceAuthorityPlan: []
        })
      ).resolves.toEqual({
        kind: "revision_conflict",
        code: "revision.conflict",
        conflicts: []
      });
      expect(await committedClosure(db, fixture)).toEqual(zeroClosure());
      await expect(
        createSqlInboxV2TimelineMessageRepository(db).findMessage({
          tenantId,
          messageId: creation.message.id
        })
      ).resolves.toMatchObject({
        revision: "2",
        lifecycle: { kind: "active" }
      });
    }, 30_000);

    it("rejects a stale TimelineItem action-decision revision before any lifecycle closure", async () => {
      const creation = await seedInternal("stale-action-decision");
      const mutation = editMutation(
        creation,
        "stale-action-decision",
        "Must not persist"
      );
      const fixture = lifecycleFixture({
        label: "stale-action-decision",
        messageMutation: mutation,
        providerCreation: null
      });
      const staleInput = withAuthorizationDecisionPatch(
        fixture.input,
        (decision) =>
          decision.id === fixture.input.command.authorizationDecisionId,
        (decision) => ({
          ...decision,
          resourceAccessRevision: "2",
          decisionHash: digest("stale-action-decision:decision")
        })
      );
      const staleFixture: LifecycleFixture = { ...fixture, input: staleInput };

      await expect(
        createSqlInboxV2MessageLifecycleAtomicCoordinator(
          db
        ).withAuthorizedMessageLifecycleMutation({
          authorizedMutation: staleInput,
          messageMutation: mutation,
          providerOperationCreation: null,
          legalHoldFence: null,
          fileUploadAuthorityPlan: [],
          fileSourceAuthorityPlan: []
        })
      ).rejects.toThrow(
        "Message lifecycle command requires the exact allowed action authorization decision."
      );
      expect(await committedClosure(db, staleFixture)).toEqual(zeroClosure());
      await expect(
        createSqlInboxV2TimelineMessageRepository(db).findMessage({
          tenantId,
          messageId: creation.message.id
        })
      ).resolves.toMatchObject({
        revision: "1",
        lifecycle: { kind: "active" }
      });
    }, 30_000);

    it("commits provider delete as pending provider work without a premature Message tombstone", async () => {
      const external = await seedExternalLifecycleFixture(
        db,
        "provider-delete-applied",
        String(nextHistoricalPosition++)
      );
      const fixture = lifecycleFixture({
        label: "provider-delete-applied",
        messageMutation: null,
        providerCreation: external.providerCreation
      });

      const result = await createSqlInboxV2MessageLifecycleAtomicCoordinator(
        db
      ).withAuthorizedMessageLifecycleMutation({
        authorizedMutation: fixture.input,
        messageMutation: null,
        providerOperationCreation: external.providerCreation,
        legalHoldFence: deleteLegalHoldFence(
          external.providerCreation.timelineItem.id
        ),
        fileUploadAuthorityPlan: [],
        fileSourceAuthorityPlan: []
      });

      expect(result).toMatchObject({
        kind: "applied",
        result: {
          messageId: external.creation.message.id,
          messageRevision: null,
          providerOperationId: external.providerCreation.operation.id
        }
      });
      expect(await committedClosure(db, fixture)).toEqual({
        commands: 1,
        streamCommits: 1,
        changes: 1,
        events: 1,
        outboxIntents: 2,
        messageRevisions: 0,
        providerOperations: 1
      });
      await expect(
        createSqlInboxV2TimelineMessageRepository(db).findMessage({
          tenantId,
          messageId: external.creation.message.id
        })
      ).resolves.toMatchObject({
        revision: "1",
        lifecycle: { kind: "active" }
      });
      await expect(
        createSqlInboxV2TimelineMessageRepository(
          db
        ).findProviderLifecycleOperation({
          tenantId,
          operationId: external.providerCreation.operation.id
        })
      ).resolves.toMatchObject({
        operation: { action: "delete", outcome: { state: "pending" } }
      });
      const outbox = await db.execute<{
        type_id: string;
        effect_class: string;
      }>(
        sql`
          select type_id, effect_class::text
          from inbox_v2_outbox_intents
          where tenant_id = ${tenantId}
            and stream_commit_id = ${fixture.input.records.streamCommitId}
          order by ordinal
        `
      );
      expect(outbox.rows).toEqual([
        { type_id: "core:projection.update", effect_class: "projection" },
        {
          type_id: "core:provider.message_lifecycle",
          effect_class: "provider_io"
        }
      ]);
    }, 30_000);

    it("commits an external edit as one Message revision plus one provider operation and provider_io outbox", async () => {
      const external = await seedExternalLifecycleFixture(
        db,
        "external-edit-applied",
        String(nextHistoricalPosition++),
        "edit"
      );
      const mutation = externalEditMutation({
        creation: external.creation,
        operator: external.operator,
        providerCreation: external.providerCreation,
        suffix: "external-edit-applied",
        text: "Edited locally and queued for provider delivery"
      });
      const fixture = lifecycleFixture({
        label: "external-edit-applied",
        messageMutation: mutation,
        providerCreation: external.providerCreation
      });

      const result = await createSqlInboxV2MessageLifecycleAtomicCoordinator(
        db
      ).withAuthorizedMessageLifecycleMutation({
        authorizedMutation: fixture.input,
        messageMutation: mutation,
        providerOperationCreation: external.providerCreation,
        legalHoldFence: null,
        fileUploadAuthorityPlan: [],
        fileSourceAuthorityPlan: []
      });

      expect(result).toMatchObject({
        kind: "applied",
        result: {
          messageId: external.creation.message.id,
          messageRevision: "2",
          providerOperationId: external.providerCreation.operation.id
        }
      });
      expect(await committedClosure(db, fixture)).toEqual({
        commands: 1,
        streamCommits: 1,
        changes: 2,
        events: 1,
        outboxIntents: 2,
        messageRevisions: 1,
        providerOperations: 1
      });
      await expect(
        createSqlInboxV2TimelineMessageRepository(db).findMessage({
          tenantId,
          messageId: external.creation.message.id
        })
      ).resolves.toMatchObject({
        revision: "2",
        lifecycle: { kind: "active" }
      });
      await expect(
        createSqlInboxV2TimelineMessageRepository(
          db
        ).findProviderLifecycleOperation({
          tenantId,
          operationId: external.providerCreation.operation.id
        })
      ).resolves.toMatchObject({
        operation: { action: "edit", outcome: { state: "pending" } }
      });
    }, 30_000);

    it("returns an already-applied external edit replay without duplicating its canonical closure", async () => {
      const external = await seedExternalLifecycleFixture(
        db,
        "external-edit-replay",
        String(nextHistoricalPosition++),
        "edit"
      );
      const mutation = externalEditMutation({
        creation: external.creation,
        operator: external.operator,
        providerCreation: external.providerCreation,
        suffix: "external-edit-replay",
        text: "Exactly-once lifecycle replay"
      });
      const fixture = lifecycleFixture({
        label: "external-edit-replay",
        messageMutation: mutation,
        providerCreation: external.providerCreation
      });
      const coordinator = createSqlInboxV2MessageLifecycleAtomicCoordinator(db);
      const command = {
        authorizedMutation: fixture.input,
        messageMutation: mutation,
        providerOperationCreation: external.providerCreation,
        legalHoldFence: null,
        fileUploadAuthorityPlan: [],
        fileSourceAuthorityPlan: []
      };

      await expect(
        coordinator.withAuthorizedMessageLifecycleMutation(command)
      ).resolves.toMatchObject({ kind: "applied" });
      await expect(
        coordinator.withAuthorizedMessageLifecycleMutation(command)
      ).resolves.toMatchObject({ kind: "already_applied" });

      expect(await committedClosure(db, fixture)).toEqual({
        commands: 1,
        streamCommits: 1,
        changes: 2,
        events: 1,
        outboxIntents: 2,
        messageRevisions: 1,
        providerOperations: 1
      });
      const routeConsumptions = await db.execute<{ count: number }>(sql`
        select count(*)::integer as count
          from inbox_v2_outbound_route_consumptions
         where tenant_id = ${tenantId}
           and consumer_kind = 'provider_lifecycle'
           and consumer_id = ${external.providerCreation.operation.id}
      `);
      expect(routeConsumptions.rows).toEqual([{ count: 1 }]);
    }, 30_000);

    it("materializes retained and new ready pins once per edit revision without duplicating attachment anchors on replay", async () => {
      const retainedPin = lifecycleReadyFilePin("retained-edit-pin");
      const addedPin = lifecycleReadyFilePin("added-edit-pin", "2");
      const creation = creationWithReadyAttachment(
        internalCreation("attachment-edit-applied"),
        retainedPin,
        "attachment-edit-retained"
      );
      await seedReadyLifecycleFileGraph(
        db,
        retainedPin,
        creation.content.createdAt
      );
      await seedReadyLifecycleFileGraph(
        db,
        addedPin,
        creation.content.createdAt
      );
      await seedInternalCommit(creation);
      await expect(fileParentState(db, retainedPin.file.id)).resolves.toEqual({
        revision: "2",
        liveParentCount: 1,
        linkCount: 1
      });
      const mutation = editMutationWithReadyAttachments({
        creation,
        suffix: "attachment-edit-applied",
        retainExistingPins: true,
        additions: [{ pin: addedPin }]
      });
      const addedSourceAuthority = lifecycleUploadSourceAuthorityTarget(
        mutation,
        addedPin
      );
      await seedUploadStagingLifecycleSource(
        db,
        addedSourceAuthority,
        mutation,
        creation.content.createdAt
      );
      const fixture = lifecycleFixture({
        label: "attachment-edit-applied",
        messageMutation: mutation,
        providerCreation: null,
        fileUploadAuthorityPlan: [lifecycleUploadAuthorityTarget(addedPin)],
        fileSourceAuthorityPlan: lifecycleCanonicalSourceAuthorityPlan(
          lifecycleMessageSourceAuthorityTarget(
            mutation,
            retainedPin,
            creation
          ),
          addedSourceAuthority
        )
      });
      const coordinator = createSqlInboxV2MessageLifecycleAtomicCoordinator(db);
      const command = {
        authorizedMutation: fixture.input,
        messageMutation: mutation,
        providerOperationCreation: null,
        legalHoldFence: null,
        fileUploadAuthorityPlan: fixture.fileUploadAuthorityPlan,
        fileSourceAuthorityPlan: fixture.fileSourceAuthorityPlan
      };

      await expect(
        coordinator.withAuthorizedMessageLifecycleMutation(command)
      ).resolves.toMatchObject({ kind: "applied" });
      await expect(fileParentState(db, retainedPin.file.id)).resolves.toEqual({
        revision: "3",
        liveParentCount: 2,
        linkCount: 2
      });
      await expect(fileParentState(db, addedPin.file.id)).resolves.toEqual({
        revision: "3",
        liveParentCount: 2,
        linkCount: 2
      });
      const anchorsAfterApply = await countMessageAttachmentAnchors(
        db,
        creation.message.id
      );
      expect(anchorsAfterApply).toBe(2);

      await expect(
        coordinator.withAuthorizedMessageLifecycleMutation(command)
      ).resolves.toMatchObject({ kind: "already_applied" });
      await expect(fileParentState(db, retainedPin.file.id)).resolves.toEqual({
        revision: "3",
        liveParentCount: 2,
        linkCount: 2
      });
      await expect(fileParentState(db, addedPin.file.id)).resolves.toEqual({
        revision: "3",
        liveParentCount: 2,
        linkCount: 2
      });
      expect(await countMessageAttachmentAnchors(db, creation.message.id)).toBe(
        anchorsAfterApply
      );
      expect(await committedClosure(db, fixture)).toEqual({
        commands: 1,
        streamCommits: 1,
        changes: 1,
        events: 1,
        outboxIntents: 1,
        messageRevisions: 1,
        providerOperations: 0
      });
    }, 30_000);

    it("rolls a cross-Message copy back when the authorized source head becomes stale", async () => {
      const pin = lifecycleReadyFilePin("source-message-head-drift");
      const sourceCreation = creationWithReadyAttachment(
        internalCreation("source-message-head-drift-source"),
        pin,
        "source-message-head-drift-source"
      );
      await seedReadyLifecycleFileGraph(
        db,
        pin,
        sourceCreation.content.createdAt
      );
      await seedInternalCommit(sourceCreation);
      const targetCreation = await seedInternal(
        "source-message-head-drift-target"
      );
      const mutation = editMutationWithReadyAttachments({
        creation: targetCreation,
        suffix: "source-message-head-drift-target",
        additions: [{ pin }]
      });
      const sourceAuthority = lifecycleMessageSourceAuthorityTarget(
        mutation,
        pin,
        sourceCreation
      );
      const fixture = lifecycleFixture({
        label: "source-message-head-drift",
        messageMutation: mutation,
        providerCreation: null,
        fileUploadAuthorityPlan: [],
        fileSourceAuthorityPlan:
          lifecycleCanonicalSourceAuthorityPlan(sourceAuthority)
      });
      await executeHistoricalFixtureSql(
        db,
        sql`
          update inbox_v2_messages
             set revision = 2,
                 content_state = 'privacy_erased',
                 updated_at = ${fixtureT4}
           where tenant_id = ${tenantId}
             and id = ${sourceCreation.message.id}
        `
      );

      await expect(
        createSqlInboxV2MessageLifecycleAtomicCoordinator(
          db
        ).withAuthorizedMessageLifecycleMutation({
          authorizedMutation: fixture.input,
          messageMutation: mutation,
          providerOperationCreation: null,
          legalHoldFence: null,
          fileUploadAuthorityPlan: fixture.fileUploadAuthorityPlan,
          fileSourceAuthorityPlan: fixture.fileSourceAuthorityPlan
        })
      ).resolves.toEqual({
        kind: "revision_conflict",
        code: "revision.conflict",
        conflicts: []
      });
      expect(await committedClosure(db, fixture)).toEqual(zeroClosure());
      await expect(fileParentState(db, pin.file.id)).resolves.toEqual({
        revision: "2",
        liveParentCount: 1,
        linkCount: 1
      });
      await expect(
        createSqlInboxV2TimelineMessageRepository(db).findMessage({
          tenantId,
          messageId: targetCreation.message.id
        })
      ).resolves.toMatchObject({ revision: "1" });
    }, 30_000);

    it("rolls the whole edit back when upload-staging uploader authority drifts after authorization", async () => {
      const pin = lifecycleReadyFilePin("source-uploader-drift", "2");
      const creation = await seedInternal("source-uploader-drift");
      await seedReadyLifecycleFileGraph(db, pin, creation.content.createdAt);
      const mutation = editMutationWithReadyAttachments({
        creation,
        suffix: "source-uploader-drift",
        additions: [{ pin }]
      });
      const sourceAuthority = lifecycleUploadSourceAuthorityTarget(
        mutation,
        pin
      );
      await seedUploadStagingLifecycleSource(
        db,
        sourceAuthority,
        mutation,
        creation.content.createdAt
      );
      await executeHistoricalFixtureSql(
        db,
        sql`
          update inbox_v2_file_attachment_materialization_jobs
             set authorization_actor_id =
                   ${`employee:msg005-drifted-uploader-${runId}`}
           where tenant_id = ${tenantId}
             and attachment_id = ${sourceAuthority.attachment.id}
        `
      );
      const fixture = lifecycleFixture({
        label: "source-uploader-drift",
        messageMutation: mutation,
        providerCreation: null,
        fileUploadAuthorityPlan: [lifecycleUploadAuthorityTarget(pin)],
        fileSourceAuthorityPlan:
          lifecycleCanonicalSourceAuthorityPlan(sourceAuthority)
      });

      await expect(
        createSqlInboxV2MessageLifecycleAtomicCoordinator(
          db
        ).withAuthorizedMessageLifecycleMutation({
          authorizedMutation: fixture.input,
          messageMutation: mutation,
          providerOperationCreation: null,
          legalHoldFence: null,
          fileUploadAuthorityPlan: fixture.fileUploadAuthorityPlan,
          fileSourceAuthorityPlan: fixture.fileSourceAuthorityPlan
        })
      ).resolves.toEqual({
        kind: "revision_conflict",
        code: "revision.conflict",
        conflicts: []
      });
      expect(await committedClosure(db, fixture)).toEqual(zeroClosure());
      await expect(fileParentState(db, pin.file.id)).resolves.toEqual({
        revision: "2",
        liveParentCount: 1,
        linkCount: 1
      });
      await expect(
        createSqlInboxV2TimelineMessageRepository(db).findMessage({
          tenantId,
          messageId: creation.message.id
        })
      ).resolves.toMatchObject({ revision: "1" });
    }, 30_000);

    it("rejects missing or stale File and destination authority before attachment edit materialization", async () => {
      const scenarios = [
        {
          label: "missing-file-upload",
          expected:
            "Message lifecycle FileParent plan requires exact File view and upload authority subsets with no extra File authority.",
          mutate: (input: WithInboxV2AuthorizedCommandMutationInput) =>
            withoutAuthorizationDecisions(
              input,
              (decision) => decision.permissionId === "core:file.upload"
            )
        },
        {
          label: "missing-file-view",
          expected:
            "Message lifecycle FileParent plan requires exact File view and upload authority subsets with no extra File authority.",
          mutate: (input: WithInboxV2AuthorizedCommandMutationInput) =>
            withoutAuthorizationDecisions(
              input,
              (decision) => decision.permissionId === "core:file.view"
            )
        },
        {
          label: "stale-file-view",
          expected:
            "Message lifecycle FileParent plan requires exact File view and upload authority subsets with no extra File authority.",
          mutate: (input: WithInboxV2AuthorizedCommandMutationInput) =>
            withAuthorizationDecisionPatch(
              input,
              (decision) => decision.permissionId === "core:file.view",
              (decision) => ({
                ...decision,
                resourceAccessRevision: "3",
                decisionHash: digest("stale-file-view:decision")
              })
            )
        },
        {
          label: "missing-destination",
          expected:
            "Message lifecycle FileParent plan requires its exact destination Conversation authority.",
          mutate: (input: WithInboxV2AuthorizedCommandMutationInput) =>
            withoutAuthorizationDecisions(
              input,
              (decision) =>
                decision.permissionId === "core:message.send_internal"
            )
        }
      ] as const;

      for (const scenario of scenarios) {
        const pin = lifecycleReadyFilePin(`authority-${scenario.label}`, "2");
        const creation = await seedInternal(`authority-${scenario.label}`);
        await seedReadyLifecycleFileGraph(db, pin, creation.content.createdAt);
        const mutation = editMutationWithReadyAttachments({
          creation,
          suffix: `authority-${scenario.label}`,
          additions: [{ pin }]
        });
        const sourceAuthority = lifecycleUploadSourceAuthorityTarget(
          mutation,
          pin
        );
        await seedUploadStagingLifecycleSource(
          db,
          sourceAuthority,
          mutation,
          creation.content.createdAt
        );
        const fixture = lifecycleFixture({
          label: `authority-${scenario.label}`,
          messageMutation: mutation,
          providerCreation: null,
          fileUploadAuthorityPlan: [lifecycleUploadAuthorityTarget(pin)],
          fileSourceAuthorityPlan:
            lifecycleCanonicalSourceAuthorityPlan(sourceAuthority)
        });
        const rejectedInput = scenario.mutate(fixture.input);
        const rejectedFixture: LifecycleFixture = {
          ...fixture,
          input: rejectedInput
        };

        await expect(
          createSqlInboxV2MessageLifecycleAtomicCoordinator(
            db
          ).withAuthorizedMessageLifecycleMutation({
            authorizedMutation: rejectedInput,
            messageMutation: mutation,
            providerOperationCreation: null,
            legalHoldFence: null,
            fileUploadAuthorityPlan: fixture.fileUploadAuthorityPlan,
            fileSourceAuthorityPlan: fixture.fileSourceAuthorityPlan
          })
        ).rejects.toThrow(scenario.expected);
        expect(await committedClosure(db, rejectedFixture)).toEqual(
          zeroClosure()
        );
        await expect(fileParentState(db, pin.file.id)).resolves.toEqual({
          revision: "2",
          liveParentCount: 1,
          linkCount: 1
        });
        await expect(
          createSqlInboxV2TimelineMessageRepository(db).findMessage({
            tenantId,
            messageId: creation.message.id
          })
        ).resolves.toMatchObject({ revision: "1" });
      }
    }, 30_000);

    it("rolls missing, stale and incomplete ready File graphs back without lifecycle closure", async () => {
      const scenarios = [
        {
          label: "missing-file",
          seed: false,
          fileRevision: "2",
          incomplete: false
        },
        {
          label: "stale-file",
          seed: true,
          fileRevision: "3",
          incomplete: false
        },
        {
          label: "incomplete-file",
          seed: true,
          fileRevision: "2",
          incomplete: true
        }
      ] as const;

      for (const scenario of scenarios) {
        const pin = lifecycleReadyFilePin(`file-fence-${scenario.label}`, "2");
        const creation = await seedInternal(`file-fence-${scenario.label}`);
        if (scenario.seed) {
          await seedReadyLifecycleFileGraph(
            db,
            pin,
            creation.content.createdAt
          );
        }
        if (scenario.incomplete) {
          await executeHistoricalFixtureSql(
            db,
            sql`
            update inbox_v2_file_parent_set_heads
               set completeness = 'reconciling'
             where tenant_id = ${tenantId}
               and file_id = ${pin.file.id}
          `
          );
        }
        const mutation = editMutationWithReadyAttachments({
          creation,
          suffix: `file-fence-${scenario.label}`,
          additions: [{ pin, fileRevision: scenario.fileRevision }]
        });
        const sourceAuthority = lifecycleUploadSourceAuthorityTarget(
          mutation,
          pin
        );
        if (scenario.seed) {
          await seedUploadStagingLifecycleSource(
            db,
            sourceAuthority,
            mutation,
            creation.content.createdAt
          );
        }
        const fixture = lifecycleFixture({
          label: `file-fence-${scenario.label}`,
          messageMutation: mutation,
          providerCreation: null,
          fileUploadAuthorityPlan: [
            lifecycleUploadAuthorityTarget(pin, scenario.fileRevision)
          ],
          fileSourceAuthorityPlan:
            lifecycleCanonicalSourceAuthorityPlan(sourceAuthority)
        });

        await expect(
          createSqlInboxV2MessageLifecycleAtomicCoordinator(
            db
          ).withAuthorizedMessageLifecycleMutation({
            authorizedMutation: fixture.input,
            messageMutation: mutation,
            providerOperationCreation: null,
            legalHoldFence: null,
            fileUploadAuthorityPlan: fixture.fileUploadAuthorityPlan,
            fileSourceAuthorityPlan: fixture.fileSourceAuthorityPlan
          })
        ).resolves.toEqual({
          kind: "revision_conflict",
          code: "revision.conflict",
          conflicts: []
        });
        expect(await committedClosure(db, fixture)).toEqual(zeroClosure());
        if (scenario.seed) {
          await expect(fileParentState(db, pin.file.id)).resolves.toEqual({
            revision: "2",
            liveParentCount: 1,
            linkCount: 1
          });
        }
        await expect(
          createSqlInboxV2TimelineMessageRepository(db).findMessage({
            tenantId,
            messageId: creation.message.id
          })
        ).resolves.toMatchObject({ revision: "1" });
      }
    }, 30_000);

    it("rolls an exact pre-existing revision-scoped FileParent link conflict back", async () => {
      const pin = lifecycleReadyFilePin("parent-link-conflict", "2");
      const creation = await seedInternal("parent-link-conflict");
      await seedReadyLifecycleFileGraph(db, pin, creation.content.createdAt);
      const mutation = editMutationWithReadyAttachments({
        creation,
        suffix: "parent-link-conflict",
        additions: [{ pin }]
      });
      const sourceAuthority = lifecycleUploadSourceAuthorityTarget(
        mutation,
        pin
      );
      await seedUploadStagingLifecycleSource(
        db,
        sourceAuthority,
        mutation,
        creation.content.createdAt
      );
      const plan = deriveInboxV2MessageEditReadyFileParents(
        mutation,
        "core:chat",
        creation.content.createdAt
      );
      const plannedParent = plan[0];
      if (plannedParent === undefined) {
        throw new Error("MSG005 link-conflict plan is empty.");
      }
      await seedConflictingLifecycleFileParent(
        db,
        plannedParent,
        creation.content.createdAt
      );
      const fixture = lifecycleFixture({
        label: "parent-link-conflict",
        messageMutation: mutation,
        providerCreation: null,
        fileUploadAuthorityPlan: [lifecycleUploadAuthorityTarget(pin)],
        fileSourceAuthorityPlan:
          lifecycleCanonicalSourceAuthorityPlan(sourceAuthority)
      });

      await expect(
        createSqlInboxV2MessageLifecycleAtomicCoordinator(
          db
        ).withAuthorizedMessageLifecycleMutation({
          authorizedMutation: fixture.input,
          messageMutation: mutation,
          providerOperationCreation: null,
          legalHoldFence: null,
          fileUploadAuthorityPlan: fixture.fileUploadAuthorityPlan,
          fileSourceAuthorityPlan: fixture.fileSourceAuthorityPlan
        })
      ).resolves.toEqual({
        kind: "revision_conflict",
        code: "revision.conflict",
        conflicts: []
      });
      expect(await committedClosure(db, fixture)).toEqual(zeroClosure());
      await expect(fileParentState(db, pin.file.id)).resolves.toEqual({
        revision: "3",
        liveParentCount: 2,
        linkCount: 2
      });
      await expect(
        createSqlInboxV2TimelineMessageRepository(db).findMessage({
          tenantId,
          messageId: creation.message.id
        })
      ).resolves.toMatchObject({ revision: "1" });
    }, 30_000);

    it("serializes concurrent edits so exactly one command commits and the loser has no closure", async () => {
      const creation = await seedInternal("concurrent-edit-edit");
      const firstMutation = editMutation(
        creation,
        "concurrent-edit-edit-first",
        "Concurrent edit one"
      );
      const secondMutation = editMutation(
        creation,
        "concurrent-edit-edit-second",
        "Concurrent edit two"
      );
      const conversationResourceHeadId = `authorization-resource:msg005-concurrent-edit-edit-${runId}`;
      const firstFixture = lifecycleFixture({
        label: "concurrent-edit-edit-first",
        messageMutation: firstMutation,
        providerCreation: null,
        conversationResourceHeadId
      });
      const secondFixture = lifecycleFixture({
        label: "concurrent-edit-edit-second",
        messageMutation: secondMutation,
        providerCreation: null,
        conversationResourceHeadId
      });
      const coordinator = createSqlInboxV2MessageLifecycleAtomicCoordinator(db);

      const results = await Promise.all([
        coordinator.withAuthorizedMessageLifecycleMutation({
          authorizedMutation: firstFixture.input,
          messageMutation: firstMutation,
          providerOperationCreation: null,
          legalHoldFence: null,
          fileUploadAuthorityPlan: [],
          fileSourceAuthorityPlan: []
        }),
        coordinator.withAuthorizedMessageLifecycleMutation({
          authorizedMutation: secondFixture.input,
          messageMutation: secondMutation,
          providerOperationCreation: null,
          legalHoldFence: null,
          fileUploadAuthorityPlan: [],
          fileSourceAuthorityPlan: []
        })
      ]);

      expect(results.map(({ kind }) => kind).sort()).toEqual([
        "applied",
        "revision_conflict"
      ]);
      const closures = await Promise.all([
        committedClosure(db, firstFixture),
        committedClosure(db, secondFixture)
      ]);
      expect(closures.filter(({ commands }) => commands === 1)).toHaveLength(1);
      expect(closures.filter(({ commands }) => commands === 0)).toHaveLength(1);
      expect(
        closures.reduce(
          (total, closure) => ({
            commands: total.commands + closure.commands,
            streamCommits: total.streamCommits + closure.streamCommits,
            changes: total.changes + closure.changes,
            events: total.events + closure.events,
            outboxIntents: total.outboxIntents + closure.outboxIntents,
            messageRevisions: total.messageRevisions + closure.messageRevisions,
            providerOperations:
              total.providerOperations + closure.providerOperations
          }),
          zeroClosure()
        )
      ).toEqual({
        commands: 1,
        streamCommits: 1,
        changes: 1,
        events: 1,
        outboxIntents: 1,
        messageRevisions: 1,
        providerOperations: 0
      });
      await expect(
        createSqlInboxV2TimelineMessageRepository(db).findMessage({
          tenantId,
          messageId: creation.message.id
        })
      ).resolves.toMatchObject({
        revision: "2",
        lifecycle: { kind: "active" }
      });
    }, 30_000);

    it("rejects an action permission substituted into a provider route before any lifecycle closure", async () => {
      const external = await seedExternalLifecycleFixture(
        db,
        "route-primary-permission-mismatch",
        String(nextHistoricalPosition++)
      );
      const fixture = lifecycleFixture({
        label: "route-primary-permission-mismatch",
        messageMutation: null,
        providerCreation: external.providerCreation
      });
      const rawMismatched = withRouteConversationPermission(
        external.providerCreation,
        "core:message.delete_own"
      );
      expect(
        inboxV2MessageProviderLifecycleOperationCreationCommitSchema.safeParse(
          rawMismatched
        ).success
      ).toBe(false);
      const mismatched =
        rawMismatched as InboxV2MessageProviderLifecycleOperationCreationCommit;
      const mismatchFixture: LifecycleFixture = {
        ...fixture,
        providerCreation: mismatched
      };

      await expect(
        createSqlInboxV2MessageLifecycleAtomicCoordinator(
          db
        ).withAuthorizedMessageLifecycleMutation({
          authorizedMutation: fixture.input,
          messageMutation: null,
          providerOperationCreation: mismatched,
          legalHoldFence: deleteLegalHoldFence(mismatched.timelineItem.id),
          fileUploadAuthorityPlan: [],
          fileSourceAuthorityPlan: []
        })
      ).rejects.toThrow(
        "Hulee lifecycle induction pins the exact original reference, binding generation and authorized route."
      );
      expect(await committedClosure(db, mismatchFixture)).toEqual(
        zeroClosure()
      );
      await expect(
        createSqlInboxV2TimelineMessageRepository(db).findMessage({
          tenantId,
          messageId: external.creation.message.id
        })
      ).resolves.toMatchObject({
        revision: "1",
        lifecycle: { kind: "active" }
      });
    }, 30_000);

    it("rejects a provider route snapshot that no longer matches its Conversation read decision", async () => {
      const external = await seedExternalLifecycleFixture(
        db,
        "route-read-decision-mismatch",
        String(nextHistoricalPosition++)
      );
      const fixture = lifecycleFixture({
        label: "route-read-decision-mismatch",
        messageMutation: null,
        providerCreation: external.providerCreation
      });
      const mismatchedInput = withAuthorizationDecisionPatch(
        fixture.input,
        (decision) => decision.permissionId === "core:conversation.read",
        (decision) => ({
          ...decision,
          decisionRevision: "2",
          decisionHash: digest("route-read-decision-mismatch:decision")
        })
      );
      const mismatchFixture: LifecycleFixture = {
        ...fixture,
        input: mismatchedInput
      };

      await expect(
        createSqlInboxV2MessageLifecycleAtomicCoordinator(
          db
        ).withAuthorizedMessageLifecycleMutation({
          authorizedMutation: mismatchedInput,
          messageMutation: null,
          providerOperationCreation: external.providerCreation,
          legalHoldFence: deleteLegalHoldFence(
            external.providerCreation.timelineItem.id
          ),
          fileUploadAuthorityPlan: [],
          fileSourceAuthorityPlan: []
        })
      ).rejects.toThrow(
        "Provider lifecycle command requires exact Conversation and SourceAccount route authority."
      );
      expect(await committedClosure(db, mismatchFixture)).toEqual(
        zeroClosure()
      );
      await expect(
        createSqlInboxV2TimelineMessageRepository(db).findMessage({
          tenantId,
          messageId: external.creation.message.id
        })
      ).resolves.toMatchObject({
        revision: "1",
        lifecycle: { kind: "active" }
      });
    }, 30_000);

    it.each([
      {
        label: "binding-snapshot-drift",
        mutate: (
          commit: InboxV2MessageProviderLifecycleOperationCreationCommit
        ) =>
          inboxV2MessageProviderLifecycleOperationCreationCommitSchema.parse({
            ...commit,
            outboundBindingSnapshot: {
              ...commit.outboundBindingSnapshot!,
              updatedAt: fixtureT2
            }
          })
      },
      {
        label: "capability-valid-until-snapshot-drift",
        mutate: (
          commit: InboxV2MessageProviderLifecycleOperationCreationCommit
        ) =>
          inboxV2MessageProviderLifecycleOperationCreationCommitSchema.parse({
            ...commit,
            outboundBindingSnapshot: {
              ...commit.outboundBindingSnapshot!,
              capabilities: {
                ...commit.outboundBindingSnapshot!.capabilities,
                entries:
                  commit.outboundBindingSnapshot!.capabilities.entries.map(
                    (entry) =>
                      entry.capabilityId === "core:message-delete"
                        ? { ...entry, validUntil: futureTimestamp(30) }
                        : entry
                  )
              }
            }
          })
      },
      {
        label: "required-provider-role-set-substitution",
        mutate: (
          commit: InboxV2MessageProviderLifecycleOperationCreationCommit
        ) =>
          inboxV2MessageProviderLifecycleOperationCreationCommitSchema.parse({
            ...commit,
            outboundBindingSnapshot: {
              ...commit.outboundBindingSnapshot!,
              providerAccess: {
                ...commit.outboundBindingSnapshot!.providerAccess,
                roleIds: ["module:synthetic:msg005-substituted-role"]
              },
              capabilities: {
                ...commit.outboundBindingSnapshot!.capabilities,
                entries:
                  commit.outboundBindingSnapshot!.capabilities.entries.map(
                    (entry) =>
                      entry.capabilityId === "core:message-delete"
                        ? {
                            ...entry,
                            requiredProviderRoleIds: [
                              "module:synthetic:msg005-substituted-role"
                            ]
                          }
                        : entry
                  )
              }
            }
          })
      },
      {
        label: "persisted-route-selection-drift",
        mutate: (
          commit: InboxV2MessageProviderLifecycleOperationCreationCommit
        ) =>
          inboxV2MessageProviderLifecycleOperationCreationCommitSchema.parse({
            ...commit,
            outboundRoute: {
              ...commit.outboundRoute!,
              selection: {
                ...commit.outboundRoute!.selection,
                candidateSnapshotToken: `snapshot:msg005-drift-${runId}`
              }
            }
          })
      }
    ])(
      "rejects exact $label and rolls command/stream/event/outbox/lifecycle writes back",
      async ({ label, mutate }) => {
        const external = await seedExternalLifecycleFixture(
          db,
          label,
          String(nextHistoricalPosition++)
        );
        const drifted = mutate(external.providerCreation);
        const fixture = lifecycleFixture({
          label,
          messageMutation: null,
          providerCreation: drifted
        });

        await expect(
          createSqlInboxV2MessageLifecycleAtomicCoordinator(
            db
          ).withAuthorizedMessageLifecycleMutation({
            authorizedMutation: fixture.input,
            messageMutation: null,
            providerOperationCreation: drifted,
            legalHoldFence: deleteLegalHoldFence(drifted.timelineItem.id),
            fileUploadAuthorityPlan: [],
            fileSourceAuthorityPlan: []
          })
        ).resolves.toEqual({
          kind: "revision_conflict",
          code: "revision.conflict",
          conflicts: []
        });
        expect(await committedClosure(db, fixture)).toEqual(zeroClosure());
        await expect(
          createSqlInboxV2TimelineMessageRepository(db).findMessage({
            tenantId,
            messageId: external.creation.message.id
          })
        ).resolves.toMatchObject({
          revision: "1",
          lifecycle: { kind: "active" }
        });
      },
      30_000
    );

    it("rejects a local delete after the legal-hold control-set revision advances", async () => {
      await advanceLegalHoldControlSetRevision(db, "0", "1");
      const creation = await seedInternal("legal-hold-stale-set");
      const mutation = localDeleteMutation(creation, "legal-hold-stale-set");
      const fixture = lifecycleFixture({
        label: "legal-hold-stale-set",
        messageMutation: mutation,
        providerCreation: null
      });

      await expect(
        createSqlInboxV2MessageLifecycleAtomicCoordinator(
          db
        ).withAuthorizedMessageLifecycleMutation({
          authorizedMutation: fixture.input,
          messageMutation: mutation,
          providerOperationCreation: null,
          legalHoldFence: deleteLegalHoldFence(
            mutation.beforeTimelineItem.id,
            "0"
          ),
          fileUploadAuthorityPlan: [],
          fileSourceAuthorityPlan: []
        })
      ).resolves.toEqual({
        kind: "revision_conflict",
        code: "revision.conflict",
        conflicts: []
      });
      expect(await committedClosure(db, fixture)).toEqual(zeroClosure());
      await expect(
        createSqlInboxV2TimelineMessageRepository(db).findMessage({
          tenantId,
          messageId: creation.message.id
        })
      ).resolves.toMatchObject({
        revision: "1",
        lifecycle: { kind: "active" }
      });
    }, 30_000);

    it("rejects a local delete covered by an active exact TimelineItem legal hold", async () => {
      const creation = await seedInternal("legal-hold-active-exact");
      const mutation = localDeleteMutation(creation, "legal-hold-active-exact");
      await seedActiveExactTimelineItemLegalHold(
        db,
        mutation.beforeTimelineItem.id,
        "legal-hold-active-exact"
      );
      const fixture = lifecycleFixture({
        label: "legal-hold-active-exact",
        messageMutation: mutation,
        providerCreation: null
      });

      await expect(
        createSqlInboxV2MessageLifecycleAtomicCoordinator(
          db
        ).withAuthorizedMessageLifecycleMutation({
          authorizedMutation: fixture.input,
          messageMutation: mutation,
          providerOperationCreation: null,
          legalHoldFence: deleteLegalHoldFence(
            mutation.beforeTimelineItem.id,
            "1"
          ),
          fileUploadAuthorityPlan: [],
          fileSourceAuthorityPlan: []
        })
      ).resolves.toEqual({
        kind: "revision_conflict",
        code: "revision.conflict",
        conflicts: []
      });
      expect(await committedClosure(db, fixture)).toEqual(zeroClosure());
      await expect(
        createSqlInboxV2TimelineMessageRepository(db).findMessage({
          tenantId,
          messageId: creation.message.id
        })
      ).resolves.toMatchObject({
        revision: "1",
        lifecycle: { kind: "active" }
      });
    }, 30_000);

    it("serializes a concurrent control-set advance before delete and rejects the stale fence", async () => {
      const creation = await seedInternal("legal-hold-concurrent-advance");
      const mutation = localDeleteMutation(
        creation,
        "legal-hold-concurrent-advance"
      );
      const fixture = lifecycleFixture({
        label: "legal-hold-concurrent-advance",
        messageMutation: mutation,
        providerCreation: null
      });
      const controlDb = createHuleeDatabase();
      const observerDb = createHuleeDatabase();
      let markAdvanceLocked!: () => void;
      let releaseAdvance!: () => void;
      const advanceLocked = new Promise<void>((resolve) => {
        markAdvanceLocked = resolve;
      });
      const release = new Promise<void>((resolve) => {
        releaseAdvance = resolve;
      });
      const advancing = controlDb.transaction(async (transaction) => {
        await transaction.execute(
          sql`set local session_replication_role = replica`
        );
        const result = await transaction.execute<{ revision: string }>(sql`
          update inbox_v2_data_governance_control_set_heads
             set legal_hold_set_revision = 2,
                 last_changed_stream_position = 2,
                 head_revision = head_revision + 1,
                 updated_at = ${fixtureT2}
           where tenant_id = ${tenantId}
             and legal_hold_set_revision = 1
          returning legal_hold_set_revision::text as revision
        `);
        expect(result.rows).toEqual([{ revision: "2" }]);
        markAdvanceLocked();
        await release;
      });

      await advanceLocked;
      const deleting = createSqlInboxV2MessageLifecycleAtomicCoordinator(
        db
      ).withAuthorizedMessageLifecycleMutation({
        authorizedMutation: fixture.input,
        messageMutation: mutation,
        providerOperationCreation: null,
        legalHoldFence: deleteLegalHoldFence(
          mutation.beforeTimelineItem.id,
          "1"
        ),
        fileUploadAuthorityPlan: [],
        fileSourceAuthorityPlan: []
      });
      let observedControlSetLock = false;
      try {
        observedControlSetLock =
          await waitForLegalHoldControlSetLock(observerDb);
      } finally {
        releaseAdvance();
        await advancing;
        await closeHuleeDatabase(controlDb);
        await closeHuleeDatabase(observerDb);
      }

      expect(observedControlSetLock).toBe(true);
      await expect(deleting).resolves.toEqual({
        kind: "revision_conflict",
        code: "revision.conflict",
        conflicts: []
      });
      const controlSet = await db.execute<{ revision: string }>(sql`
        select legal_hold_set_revision::text as revision
          from inbox_v2_data_governance_control_set_heads
         where tenant_id = ${tenantId}
      `);
      expect(controlSet.rows).toEqual([{ revision: "2" }]);
      expect(await committedClosure(db, fixture)).toEqual(zeroClosure());
      await expect(
        createSqlInboxV2TimelineMessageRepository(db).findMessage({
          tenantId,
          messageId: creation.message.id
        })
      ).resolves.toMatchObject({
        revision: "1",
        lifecycle: { kind: "active" }
      });
    }, 30_000);

    it("serializes concurrent provider deletes so one active requested operation wins", async () => {
      const external = await seedExternalLifecycleFixture(
        db,
        "concurrent-provider-delete-delete",
        String(nextHistoricalPosition++)
      );
      const competing = await seedCompetingRequestedProviderCreation(
        db,
        external,
        "concurrent-provider-delete-delete-second",
        "delete"
      );
      const conversationResourceHeadId = `authorization-resource:msg005-provider-delete-delete-conversation-${runId}`;
      const sourceAccountResourceHeadId = `authorization-resource:msg005-provider-delete-delete-source-${runId}`;
      const firstFixture = lifecycleFixture({
        label: "concurrent-provider-delete-delete-first",
        messageMutation: null,
        providerCreation: external.providerCreation,
        conversationResourceHeadId,
        sourceAccountResourceHeadId
      });
      const secondFixture = lifecycleFixture({
        label: "concurrent-provider-delete-delete-second",
        messageMutation: null,
        providerCreation: competing,
        conversationResourceHeadId,
        sourceAccountResourceHeadId
      });
      const coordinator = createSqlInboxV2MessageLifecycleAtomicCoordinator(db);

      const results = await Promise.all([
        coordinator.withAuthorizedMessageLifecycleMutation({
          authorizedMutation: firstFixture.input,
          messageMutation: null,
          providerOperationCreation: external.providerCreation,
          legalHoldFence: deleteLegalHoldFence(
            external.providerCreation.timelineItem.id,
            "2"
          ),
          fileUploadAuthorityPlan: [],
          fileSourceAuthorityPlan: []
        }),
        coordinator.withAuthorizedMessageLifecycleMutation({
          authorizedMutation: secondFixture.input,
          messageMutation: null,
          providerOperationCreation: competing,
          legalHoldFence: deleteLegalHoldFence(competing.timelineItem.id, "2"),
          fileUploadAuthorityPlan: [],
          fileSourceAuthorityPlan: []
        })
      ]);

      expect(results.map(({ kind }) => kind).sort()).toEqual([
        "applied",
        "revision_conflict"
      ]);
      const closures = await Promise.all([
        committedClosure(db, firstFixture),
        committedClosure(db, secondFixture)
      ]);
      expect(totalClosure(closures)).toEqual({
        commands: 1,
        streamCommits: 1,
        changes: 1,
        events: 1,
        outboxIntents: 2,
        messageRevisions: 0,
        providerOperations: 1
      });
      expect(
        await countProviderLifecycleRouteConsumptions(db, [
          external.providerCreation.operation.id,
          competing.operation.id
        ])
      ).toBe(1);
      await expect(
        createSqlInboxV2TimelineMessageRepository(db).findMessage({
          tenantId,
          messageId: external.creation.message.id
        })
      ).resolves.toMatchObject({
        revision: "1",
        lifecycle: { kind: "active" }
      });
    }, 30_000);

    it("serializes provider delete against external edit on the same Message", async () => {
      const external = await seedExternalLifecycleFixture(
        db,
        "concurrent-provider-delete-edit",
        String(nextHistoricalPosition++)
      );
      const editProviderCreation = await seedCompetingRequestedProviderCreation(
        db,
        external,
        "concurrent-provider-delete-edit-edit",
        "edit"
      );
      const edit = externalEditMutation({
        creation: external.creation,
        operator: external.operator,
        providerCreation: editProviderCreation,
        suffix: "concurrent-provider-delete-edit-edit",
        text: "Concurrent provider edit"
      });
      const conversationResourceHeadId = `authorization-resource:msg005-provider-delete-edit-conversation-${runId}`;
      const sourceAccountResourceHeadId = `authorization-resource:msg005-provider-delete-edit-source-${runId}`;
      const deleteFixture = lifecycleFixture({
        label: "concurrent-provider-delete-edit-delete",
        messageMutation: null,
        providerCreation: external.providerCreation,
        conversationResourceHeadId,
        sourceAccountResourceHeadId
      });
      const editFixture = lifecycleFixture({
        label: "concurrent-provider-delete-edit-edit",
        messageMutation: edit,
        providerCreation: editProviderCreation,
        conversationResourceHeadId,
        sourceAccountResourceHeadId
      });
      const coordinator = createSqlInboxV2MessageLifecycleAtomicCoordinator(db);

      const results = await Promise.all([
        coordinator.withAuthorizedMessageLifecycleMutation({
          authorizedMutation: deleteFixture.input,
          messageMutation: null,
          providerOperationCreation: external.providerCreation,
          legalHoldFence: deleteLegalHoldFence(
            external.providerCreation.timelineItem.id,
            "2"
          ),
          fileUploadAuthorityPlan: [],
          fileSourceAuthorityPlan: []
        }),
        coordinator.withAuthorizedMessageLifecycleMutation({
          authorizedMutation: editFixture.input,
          messageMutation: edit,
          providerOperationCreation: editProviderCreation,
          legalHoldFence: null,
          fileUploadAuthorityPlan: [],
          fileSourceAuthorityPlan: []
        })
      ]);

      expect(results.map(({ kind }) => kind).sort()).toEqual([
        "applied",
        "revision_conflict"
      ]);
      const closures = await Promise.all([
        committedClosure(db, deleteFixture),
        committedClosure(db, editFixture)
      ]);
      const total = totalClosure(closures);
      expect(total).toMatchObject({
        commands: 1,
        streamCommits: 1,
        events: 1,
        outboxIntents: 2,
        providerOperations: 1
      });
      expect([1, 2]).toContain(total.changes);
      expect([0, 1]).toContain(total.messageRevisions);
      expect(total.changes).toBe(1 + total.messageRevisions);
      expect(
        await countProviderLifecycleRouteConsumptions(db, [
          external.providerCreation.operation.id,
          editProviderCreation.operation.id
        ])
      ).toBe(1);
      const editWon = results[1]?.kind === "applied";
      await expect(
        createSqlInboxV2TimelineMessageRepository(db).findMessage({
          tenantId,
          messageId: external.creation.message.id
        })
      ).resolves.toMatchObject({
        revision: editWon ? "2" : "1",
        lifecycle: { kind: "active" }
      });
    }, 30_000);

    it("allows a new requested provider operation only after the previous one becomes terminal", async () => {
      const external = await seedExternalLifecycleFixture(
        db,
        "provider-operation-terminal-release",
        String(nextHistoricalPosition++)
      );
      const successor = await seedCompetingRequestedProviderCreation(
        db,
        external,
        "provider-operation-terminal-release-successor",
        "delete"
      );
      const conversationResourceHeadId = `authorization-resource:msg005-terminal-release-conversation-${runId}`;
      const sourceAccountResourceHeadId = `authorization-resource:msg005-terminal-release-source-${runId}`;
      const firstFixture = lifecycleFixture({
        label: "provider-operation-terminal-release-first",
        messageMutation: null,
        providerCreation: external.providerCreation,
        conversationResourceHeadId,
        sourceAccountResourceHeadId
      });
      const successorFixture = lifecycleFixture({
        label: "provider-operation-terminal-release-successor",
        messageMutation: null,
        providerCreation: successor,
        conversationResourceHeadId,
        sourceAccountResourceHeadId
      });
      const coordinator = createSqlInboxV2MessageLifecycleAtomicCoordinator(db);
      const firstResult =
        await coordinator.withAuthorizedMessageLifecycleMutation({
          authorizedMutation: firstFixture.input,
          messageMutation: null,
          providerOperationCreation: external.providerCreation,
          legalHoldFence: deleteLegalHoldFence(
            external.providerCreation.timelineItem.id,
            "2"
          ),
          fileUploadAuthorityPlan: [],
          fileSourceAuthorityPlan: []
        });
      expect(firstResult).toMatchObject({ kind: "applied" });
      if (firstResult.kind !== "applied") {
        throw new Error("MSG005 terminal-release fixture was not applied.");
      }
      const terminal = terminalUnsupportedProviderLifecycleTransition(
        external.providerCreation,
        "provider-operation-terminal-release"
      );
      await expect(
        createSqlInboxV2TimelineMessageRepository(
          db
        ).transitionProviderLifecycleOperation({
          commit: terminal,
          streamPosition: position(
            (BigInt(firstResult.status.streamPosition) + 1n).toString()
          )
        })
      ).resolves.toMatchObject({ kind: "appended" });

      await expect(
        coordinator.withAuthorizedMessageLifecycleMutation({
          authorizedMutation: successorFixture.input,
          messageMutation: null,
          providerOperationCreation: successor,
          legalHoldFence: deleteLegalHoldFence(successor.timelineItem.id, "2"),
          fileUploadAuthorityPlan: [],
          fileSourceAuthorityPlan: []
        })
      ).resolves.toMatchObject({ kind: "applied" });
      expect(await committedClosure(db, firstFixture)).toMatchObject({
        commands: 1,
        providerOperations: 1
      });
      expect(await committedClosure(db, successorFixture)).toMatchObject({
        commands: 1,
        providerOperations: 1
      });
      await expect(
        createSqlInboxV2TimelineMessageRepository(
          db
        ).findProviderLifecycleOperation({
          tenantId,
          operationId: external.providerCreation.operation.id
        })
      ).resolves.toMatchObject({
        operation: { outcome: { state: "unsupported" }, revision: "2" }
      });
      await expect(
        createSqlInboxV2TimelineMessageRepository(
          db
        ).findProviderLifecycleOperation({
          tenantId,
          operationId: successor.operation.id
        })
      ).resolves.toMatchObject({
        operation: { outcome: { state: "pending" }, revision: "1" }
      });
    }, 30_000);
  }
);

function internalCreation(suffix: string): InboxV2MessageCreationCommit {
  return inboxV2MessageCreationCommitSchema.parse(
    namespaceFixture(fixtureInternalCreationCommit(), suffix)
  );
}

function migrationCreation(suffix: string): InboxV2MessageCreationCommit {
  const base = internalCreation(suffix);
  const legacyAuthor = namespaceFixture(fixtureParticipant("legacy"), suffix);
  const provenanceId = `core:migration.msg005-${suffix}-${runId}`;
  const automationCausation = {
    kind: "system_event" as const,
    causeEvent: fixtureReference(
      "event",
      `event:msg005-migration-${suffix}-${runId}`,
      tenantId
    ),
    correlationId: `correlation:msg005-migration-${suffix}-${runId}`,
    causedAt: base.initialRevision.occurredAt
  };
  const beforeActivityHead = base.timelineAllocation.conversationBefore.head;
  return inboxV2MessageCreationCommitSchema.parse({
    ...base,
    authorParticipant: {
      ...base.authorParticipant,
      subject: legacyAuthor.subject
    },
    message: {
      ...base.message,
      appActor: {
        kind: "trusted_service",
        trustedServiceId: "core:migration-service"
      },
      automationCausation,
      origin: {
        kind: "migration",
        provenanceId
      }
    },
    initialRevision: {
      ...base.initialRevision,
      actionAttribution: {
        ...base.initialRevision.actionAttribution,
        appActor: {
          kind: "trusted_service",
          trustedServiceId: "core:migration-service"
        },
        automationCausation
      }
    },
    timelineAllocation: {
      ...base.timelineAllocation,
      conversationAfter: {
        ...base.timelineAllocation.conversationAfter,
        head: {
          ...base.timelineAllocation.conversationAfter.head,
          latestActivityItemId: beforeActivityHead.latestActivityItemId,
          latestActivityTimelineSequence:
            beforeActivityHead.latestActivityTimelineSequence,
          latestActivityAt: beforeActivityHead.latestActivityAt
        }
      },
      items: base.timelineAllocation.items.map((item) => ({
        ...item,
        activity: {
          kind: "migration",
          provenanceId,
          importedAt: base.timelineAllocation.committedAt
        }
      }))
    }
  });
}

function sourceCreation(suffix: string): InboxV2MessageCreationCommit {
  return inboxV2MessageCreationCommitSchema.parse(
    namespaceFixture(fixtureSourceCreationCommit(), suffix)
  );
}

function lifecycleReadyFilePin(suffix: string, fileRevision = "1") {
  return {
    file: fixtureReference("file", `file:msg005-${suffix}-${runId}`, tenantId),
    fileRevision,
    fileVersion: fixtureReference(
      "file_version",
      `file_version:msg005-${suffix}-v1-${runId}`,
      tenantId
    ),
    objectVersion: fixtureReference(
      "file_object_version",
      `file_object_version:msg005-${suffix}-v1-${runId}`,
      tenantId
    )
  } as const;
}

function lifecycleUploadAuthorityTarget(
  pin: ReturnType<typeof lifecycleReadyFilePin>,
  expectedFileRevision: string = pin.fileRevision
): InboxV2MessageEditFileUploadAuthorityTarget {
  return inboxV2MessageEditFileUploadAuthorityTargetSchema.parse({
    file: pin.file,
    expectedFileRevision
  });
}

function lifecycleUploadSourceAuthorityTarget(
  mutation: MessageMutation,
  pin: ReturnType<typeof lifecycleReadyFilePin>,
  uploadRevision = "1"
): LifecycleUploadSourceAuthorityTarget {
  const appActor = mutation.revision.actionAttribution.appActor;
  if (appActor === null) {
    throw new Error("MSG005 upload source authority requires an app actor.");
  }
  const target = lifecycleSourceAuthorityTarget(
    mutation,
    pin,
    inboxV2TimelineFileSourceParentSchema.parse({
      kind: "upload_staging",
      appActor,
      uploadRevision
    })
  );
  if (
    target.purpose !== "attachment" ||
    target.sourceParent.kind !== "upload_staging"
  ) {
    throw new Error("MSG005 upload source authority target is invalid.");
  }
  return Object.freeze({
    ...target,
    sourceParent: target.sourceParent
  });
}

function lifecycleMessageSourceAuthorityTarget(
  mutation: MessageMutation,
  pin: ReturnType<typeof lifecycleReadyFilePin>,
  creation: InboxV2MessageCreationCommit
): InboxV2MessageEditFileSourceAuthorityTarget {
  const timelineItem = creation.timelineAllocation.items[0];
  if (timelineItem === undefined) {
    throw new Error("MSG005 Message source authority requires a TimelineItem.");
  }
  return lifecycleSourceAuthorityTarget(
    mutation,
    pin,
    inboxV2TimelineFileSourceParentSchema.parse({
      kind: "message",
      conversation: creation.message.conversation,
      message: fixtureReference("message", creation.message.id, tenantId),
      expectedMessageRevision: creation.message.revision,
      visibilityBoundary:
        timelineItem.visibility === "internal_participants"
          ? "internal"
          : "external_work"
    })
  );
}

function lifecycleSourceAuthorityTarget(
  mutation: MessageMutation,
  pin: ReturnType<typeof lifecycleReadyFilePin>,
  sourceParent: InboxV2MessageEditFileSourceAuthorityTarget["sourceParent"]
): InboxV2MessageEditFileSourceAuthorityTarget {
  const after = mutation.contentTransition?.after;
  if (after?.state.kind !== "available") {
    throw new Error("MSG005 File source authority requires available content.");
  }
  const block = after.state.blocks.find(
    (candidate) =>
      "attachment" in candidate &&
      candidate.attachment.state === "ready" &&
      candidate.attachment.file.id === pin.file.id
  );
  if (
    block === undefined ||
    !("attachment" in block) ||
    block.attachment.state !== "ready"
  ) {
    throw new Error("MSG005 File source authority target block is missing.");
  }
  return inboxV2MessageEditFileSourceAuthorityTargetSchema.parse({
    blockKey: block.blockKey,
    purpose: "attachment",
    attachment: block.attachment.attachment,
    file: block.attachment.file,
    expectedFileRevision: block.attachment.fileRevision,
    fileVersion: block.attachment.fileVersion,
    objectVersion: block.attachment.objectVersion,
    targetParent: {
      kind: "message",
      message: fixtureReference("message", mutation.afterMessage.id, tenantId),
      expectedMessageRevision: mutation.afterMessage.revision
    },
    sourceParent
  });
}

function lifecycleCanonicalSourceAuthorityPlan(
  ...targets: readonly InboxV2MessageEditFileSourceAuthorityTarget[]
): readonly InboxV2MessageEditFileSourceAuthorityTarget[] {
  return Object.freeze(
    [...targets].sort((left, right) =>
      `${left.file.tenantId}\u0000${left.file.id}\u0000${left.blockKey}\u0000${left.purpose}`.localeCompare(
        `${right.file.tenantId}\u0000${right.file.id}\u0000${right.blockKey}\u0000${right.purpose}`
      )
    )
  );
}

function lifecycleReadyAttachmentBlock(
  pin: ReturnType<typeof lifecycleReadyFilePin>,
  suffix: string,
  fileRevision: string = pin.fileRevision
) {
  return inboxV2MessageContentBlockSchema.parse({
    blockKey: `image-${suffix}`,
    kind: "image",
    attachment: {
      state: "ready",
      attachment: fixtureReference(
        "message_attachment",
        `message_attachment:msg005-${suffix}-${runId}`,
        tenantId
      ),
      file: pin.file,
      fileRevision,
      fileVersion: pin.fileVersion,
      objectVersion: pin.objectVersion
    },
    displayName: `${suffix}.png`
  });
}

function creationWithReadyAttachment(
  base: InboxV2MessageCreationCommit,
  pin: ReturnType<typeof lifecycleReadyFilePin>,
  suffix: string
): InboxV2MessageCreationCommit {
  if (base.content.state.kind !== "available") {
    throw new Error("MSG005 ready creation requires available content.");
  }
  const blocks = [
    ...base.content.state.blocks,
    lifecycleReadyAttachmentBlock(pin, suffix)
  ];
  const content = inboxV2TimelineContentSchema.parse({
    ...base.content,
    state: {
      kind: "available",
      blocks,
      contentDigestSha256: calculateInboxV2MessageContentDigest(blocks)
    }
  });
  const message = {
    ...base.message,
    content: inboxV2TimelineContentHeadOf(content)
  };
  return inboxV2MessageCreationCommitSchema.parse({
    ...base,
    content,
    message,
    initialRevision: {
      ...base.initialRevision,
      change: { kind: "created", content: message.content }
    }
  });
}

function lifecycleEmployeeAppActor(
  participant: InboxV2MessageCreationCommit["authorParticipant"],
  suffix: string
) {
  if (participant.subject.kind !== "employee") {
    throw new Error(
      "MSG005 lifecycle Employee actor requires an Employee participant."
    );
  }
  return inboxV2AppActorSchema.parse({
    kind: "employee",
    employee: participant.subject.employee,
    authorizationEpoch: `authorization:msg005-${suffix}-${runId}`
  });
}

function editMutation(
  creation: InboxV2MessageCreationCommit,
  suffix: string,
  text: string,
  options: Readonly<{
    retainExistingNonTextBlocks?: boolean;
    actionAppActor?: InboxV2MessageCreationCommit["message"]["appActor"];
    actionParticipant?: InboxV2MessageCreationCommit["authorParticipant"];
    additionalBlocks?: readonly ReturnType<
      typeof inboxV2MessageContentBlockSchema.parse
    >[];
  }> = {}
): MessageMutation {
  const beforeTimelineItem = creation.timelineAllocation.items[0];
  if (beforeTimelineItem === undefined) {
    throw new Error("MSG005 edit fixture requires one TimelineItem.");
  }
  const blocks = [
    {
      blockKey: "body-1",
      kind: "text" as const,
      role: "body" as const,
      text,
      language: "en"
    },
    ...(options.retainExistingNonTextBlocks &&
    creation.content.state.kind === "available"
      ? creation.content.state.blocks.filter((block) => block.kind !== "text")
      : []),
    ...(options.additionalBlocks ?? [])
  ];
  const afterContent = inboxV2TimelineContentSchema.parse({
    ...creation.content,
    state: {
      kind: "available",
      blocks,
      contentDigestSha256: calculateInboxV2MessageContentDigest(blocks)
    },
    revision: "2",
    updatedAt: fixtureT3
  });
  const afterMessage = {
    ...creation.message,
    content: inboxV2TimelineContentHeadOf(afterContent),
    revision: "2",
    updatedAt: fixtureT3
  };
  const afterTimelineItem = advancedTimelineItem(beforeTimelineItem);
  const actionParticipant =
    options.actionParticipant ?? creation.authorParticipant;
  return inboxV2MessageMutationCommitSchema.parse({
    tenantId,
    beforeMessage: creation.message,
    beforeTimelineItem,
    contentTransition: {
      tenantId,
      before: creation.content,
      transition: {
        kind: "edit",
        expectedRevision: "1",
        resultingRevision: "2",
        event: fixtureReference(
          "event",
          `event:msg005-edit-${suffix}-${runId}`,
          tenantId
        ),
        occurredAt: fixtureT3
      },
      after: afterContent
    },
    providerOperation: null,
    providerOperationCreationCommit: null,
    actionParticipantSnapshot: actionParticipant,
    revision: {
      tenantId,
      id: `message_revision:msg005-edit-${suffix}-${runId}`,
      message: fixtureReference("message", creation.message.id, tenantId),
      timelineItem: fixtureReference(
        "timeline_item",
        beforeTimelineItem.id,
        tenantId
      ),
      expectedPreviousRevision: "1",
      messageRevision: "2",
      change: {
        kind: "edited",
        beforeContent: creation.message.content,
        afterContent: afterMessage.content,
        providerOperation: null
      },
      actionAttribution: {
        actionParticipant: fixtureReference(
          "conversation_participant",
          actionParticipant.id,
          tenantId
        ),
        appActor: options.actionAppActor ?? creation.message.appActor,
        sourceOccurrence: null,
        automationCausation: null
      },
      occurredAt: fixtureT3,
      recordedAt: fixtureT3,
      recordRevision: "1",
      createdAt: fixtureT3
    },
    afterMessage,
    afterTimelineItem
  });
}

function editMutationWithReadyAttachments(input: {
  creation: InboxV2MessageCreationCommit;
  suffix: string;
  additions?: readonly Readonly<{
    pin: ReturnType<typeof lifecycleReadyFilePin>;
    fileRevision?: string;
  }>[];
  retainExistingPins?: boolean;
}): MessageMutation {
  const added = (input.additions ?? []).map(({ pin, fileRevision }, index) =>
    lifecycleReadyAttachmentBlock(
      pin,
      `${input.suffix}-added-${index + 1}`,
      fileRevision
    )
  );
  return editMutation(
    input.creation,
    input.suffix,
    `Attachment edit ${input.suffix}`,
    {
      retainExistingNonTextBlocks: input.retainExistingPins,
      additionalBlocks: added
    }
  );
}

function localDeleteMutation(
  creation: InboxV2MessageCreationCommit,
  suffix: string
): MessageMutation {
  const beforeTimelineItem = creation.timelineAllocation.items[0];
  if (beforeTimelineItem === undefined) {
    throw new Error("MSG005 local-delete fixture requires one TimelineItem.");
  }
  const revisionId = `message_revision:msg005-local-delete-${suffix}-${runId}`;
  const reasonId = "core:employee-delete";
  const afterMessage = {
    ...creation.message,
    lifecycle: {
      kind: "local_delete_tombstone" as const,
      revision: fixtureReference("message_revision", revisionId, tenantId),
      reasonId,
      deletedAt: fixtureT3
    },
    revision: "2",
    updatedAt: fixtureT3
  };
  return inboxV2MessageMutationCommitSchema.parse({
    tenantId,
    beforeMessage: creation.message,
    beforeTimelineItem,
    contentTransition: null,
    providerOperation: null,
    providerOperationCreationCommit: null,
    actionParticipantSnapshot: creation.authorParticipant,
    revision: {
      tenantId,
      id: revisionId,
      message: fixtureReference("message", creation.message.id, tenantId),
      timelineItem: fixtureReference(
        "timeline_item",
        beforeTimelineItem.id,
        tenantId
      ),
      expectedPreviousRevision: "1",
      messageRevision: "2",
      change: { kind: "local_delete_tombstone", reasonId },
      actionAttribution: {
        actionParticipant: creation.message.authorParticipant,
        appActor: creation.message.appActor,
        sourceOccurrence: null,
        automationCausation: null
      },
      occurredAt: fixtureT3,
      recordedAt: fixtureT3,
      recordRevision: "1",
      createdAt: fixtureT3
    },
    afterMessage,
    afterTimelineItem: advancedTimelineItem(beforeTimelineItem)
  });
}

function externalEditMutation(input: {
  creation: InboxV2MessageCreationCommit;
  operator: ReturnType<typeof fixtureParticipant>;
  providerCreation: InboxV2MessageProviderLifecycleOperationCreationCommit;
  suffix: string;
  text: string;
}): MessageMutation {
  const beforeTimelineItem = input.creation.timelineAllocation.items[0];
  if (
    beforeTimelineItem === undefined ||
    input.operator.subject.kind !== "employee" ||
    input.providerCreation.operation.action !== "edit"
  ) {
    throw new Error("MSG005 external edit fixture is incomplete.");
  }
  const blocks = [
    {
      blockKey: "body-1",
      kind: "text" as const,
      role: "body" as const,
      text: input.text,
      language: "en"
    }
  ];
  const afterContent = inboxV2TimelineContentSchema.parse({
    ...input.creation.content,
    state: {
      kind: "available",
      blocks,
      contentDigestSha256: calculateInboxV2MessageContentDigest(blocks)
    },
    revision: "2",
    updatedAt: fixtureT3
  });
  const afterMessage = {
    ...input.creation.message,
    content: inboxV2TimelineContentHeadOf(afterContent),
    revision: "2",
    updatedAt: fixtureT3
  };
  const providerOperationReference = fixtureReference(
    "message_provider_lifecycle_operation",
    input.providerCreation.operation.id,
    tenantId
  );
  return inboxV2MessageMutationCommitSchema.parse({
    tenantId,
    beforeMessage: input.creation.message,
    beforeTimelineItem,
    contentTransition: {
      tenantId,
      before: input.creation.content,
      transition: {
        kind: "edit",
        expectedRevision: "1",
        resultingRevision: "2",
        event: fixtureReference(
          "event",
          `event:msg005-external-edit-${input.suffix}-${runId}`,
          tenantId
        ),
        occurredAt: fixtureT3
      },
      after: afterContent
    },
    providerOperation: input.providerCreation.operation,
    providerOperationCreationCommit: input.providerCreation,
    actionParticipantSnapshot: input.operator,
    revision: {
      tenantId,
      id: `message_revision:msg005-external-edit-${input.suffix}-${runId}`,
      message: fixtureReference("message", input.creation.message.id, tenantId),
      timelineItem: fixtureReference(
        "timeline_item",
        beforeTimelineItem.id,
        tenantId
      ),
      expectedPreviousRevision: "1",
      messageRevision: "2",
      change: {
        kind: "edited",
        beforeContent: input.creation.message.content,
        afterContent: afterMessage.content,
        providerOperation: providerOperationReference
      },
      actionAttribution: {
        actionParticipant: fixtureReference(
          "conversation_participant",
          input.operator.id,
          tenantId
        ),
        appActor: input.providerCreation.operation.appActor,
        sourceOccurrence: null,
        automationCausation: null
      },
      occurredAt: fixtureT3,
      recordedAt: fixtureT3,
      recordRevision: "1",
      createdAt: fixtureT3
    },
    afterMessage,
    afterTimelineItem: advancedTimelineItem(beforeTimelineItem)
  });
}

function advancedTimelineItem(
  before: InboxV2MessageCreationCommit["timelineAllocation"]["items"][number]
) {
  if (before.subject.kind !== "message") {
    throw new Error("MSG005 lifecycle fixture requires a Message item.");
  }
  return {
    ...before,
    subject: {
      kind: "message" as const,
      message: before.subject.message,
      messageRevision: "2"
    },
    revision: "2",
    updatedAt: fixtureT3
  };
}

function lifecycleFixture(input: {
  label: string;
  messageMutation: MessageMutation | null;
  providerCreation: InboxV2MessageProviderLifecycleOperationCreationCommit | null;
  authorityKind?: "own" | "moderate_internal" | "moderate_external";
  fileUploadAuthorityPlan?: readonly InboxV2MessageEditFileUploadAuthorityTarget[];
  fileSourceAuthorityPlan?: readonly InboxV2MessageEditFileSourceAuthorityTarget[];
  actor?: Readonly<{ employeeId: string; authorizationEpoch: string }>;
  conversationResourceHeadId?: string;
  sourceAccountResourceHeadId?: string;
}): LifecycleFixture {
  const message =
    input.messageMutation?.beforeMessage ?? input.providerCreation?.message;
  const timelineItem =
    input.messageMutation?.beforeTimelineItem ??
    input.providerCreation?.timelineItem;
  if (message === undefined || timelineItem === undefined) {
    throw new Error("MSG005 lifecycle fixture requires a Message target.");
  }
  const appActor =
    input.messageMutation?.revision.actionAttribution.appActor ??
    input.providerCreation?.operation.appActor ??
    null;
  if (appActor?.kind !== "employee") {
    throw new Error("MSG005 lifecycle fixture requires an Employee app actor.");
  }
  const actor =
    input.actor ??
    Object.freeze({
      employeeId: appActor.employee.id,
      authorizationEpoch: appActor.authorizationEpoch
    });
  const token = `${input.label}-${runId}`;
  const commandKind =
    input.providerCreation !== null && input.messageMutation === null
      ? "provider_delete"
      : input.messageMutation?.revision.change.kind === "local_delete_tombstone"
        ? "local_delete"
        : "edit";
  const commandTypeId =
    commandKind === "edit"
      ? "core:message.edit"
      : commandKind === "local_delete"
        ? "core:message.delete_local"
        : "core:message.delete_provider";
  const publicResultCode =
    commandKind === "edit"
      ? "core:message.edited"
      : commandKind === "local_delete"
        ? "core:message.deleted_local"
        : "core:message.provider_delete_queued";
  const primaryPermissionId =
    input.authorityKind === "moderate_internal"
      ? "core:message.moderate_internal"
      : input.authorityKind === "moderate_external"
        ? "core:message.moderate_external"
        : input.providerCreation !== null
          ? "core:message.moderate_external"
          : commandKind === "edit"
            ? "core:message.edit_own"
            : commandKind === "local_delete"
              ? "core:message.delete_own"
              : "core:message.moderate_external";
  const readPermissionId =
    timelineItem.visibility === "internal_participants"
      ? "core:conversation.internal.read"
      : "core:conversation.read";
  const occurredAt =
    input.messageMutation?.revision.recordedAt ??
    input.providerCreation?.operation.recordedAt ??
    fixtureT3;
  const commandId = `command:msg005-${token}`;
  const clientMutationId = `mutation:msg005-${token}`;
  const mutationId = `authorization-mutation:msg005-${token}`;
  const streamCommitId = `commit:msg005-${token}`;
  const eventId = `event:msg005-lifecycle-${token}`;
  const correlationId = `correlation:msg005-${token}`;
  const primaryDecision = authorizationDecision({
    label: `${input.label}-action`,
    actor,
    permissionId: primaryPermissionId,
    resourceScopeId:
      primaryPermissionId === "core:message.moderate_internal"
        ? "core:conversation"
        : "core:timeline-item",
    entityTypeId:
      primaryPermissionId === "core:message.moderate_internal"
        ? "core:conversation"
        : "core:timeline-item",
    entityId:
      primaryPermissionId === "core:message.moderate_internal"
        ? message.conversation.id
        : timelineItem.id,
    resourceAccessRevision:
      primaryPermissionId === "core:message.moderate_internal"
        ? "1"
        : timelineItem.revision,
    decidedAt: fixtureT1,
    notAfter: futureTimestamp(60)
  });
  const readDecision =
    input.providerCreation === null
      ? authorizationDecision({
          label: `${input.label}-conversation-read`,
          actor,
          permissionId: readPermissionId,
          resourceScopeId: "core:conversation",
          entityTypeId: "core:conversation",
          entityId: message.conversation.id,
          decidedAt: fixtureT1,
          notAfter: futureTimestamp(60)
        })
      : authorizationDecisionFromRoute(
          input.providerCreation.outboundRoute!,
          "conversation",
          actor,
          `${input.label}-conversation-read`
        );
  const sourceAccountDecision =
    input.providerCreation === null
      ? null
      : authorizationDecisionFromRoute(
          input.providerCreation.outboundRoute!,
          "source_account",
          actor,
          `${input.label}-source-account`
        );
  const fileParentAttachmentPlan =
    input.messageMutation?.revision.change.kind === "edited"
      ? deriveInboxV2MessageEditReadyFileParents(
          input.messageMutation,
          "core:chat",
          timelineItem.occurredAt
        )
      : [];
  const plannedFiles = [
    ...new Map(
      fileParentAttachmentPlan.map((attachment) => [
        attachment.fileId,
        attachment.expectedFileRevision
      ])
    )
  ].sort(([left], [right]) => left.localeCompare(right));
  const fileViewDecisions = plannedFiles.map(([fileId, fileRevision], index) =>
    authorizationDecision({
      label: `${input.label}-file-view-${index + 1}`,
      actor,
      permissionId: "core:file.view",
      resourceScopeId: "core:file",
      entityTypeId: "core:file",
      entityId: fileId,
      resourceAccessRevision: fileRevision,
      decidedAt: fixtureT1,
      notAfter: futureTimestamp(60)
    })
  );
  const fileUploadAuthorityPlan = Object.freeze([
    ...(input.fileUploadAuthorityPlan ?? [])
  ]);
  const fileSourceAuthorityPlan = Object.freeze([
    ...(input.fileSourceAuthorityPlan ?? [])
  ]);
  const fileUploadDecisions = fileUploadAuthorityPlan.map((target, index) =>
    authorizationDecision({
      label: `${input.label}-file-upload-${index + 1}`,
      actor,
      permissionId: "core:file.upload",
      resourceScopeId: "core:file",
      entityTypeId: "core:file",
      entityId: target.file.id,
      resourceAccessRevision: target.expectedFileRevision,
      decidedAt: fixtureT1,
      notAfter: futureTimestamp(60)
    })
  );
  const destinationDecision =
    plannedFiles.length === 0
      ? null
      : authorizationDecision({
          label: `${input.label}-message-destination`,
          actor,
          permissionId:
            timelineItem.visibility === "internal_participants"
              ? "core:message.send_internal"
              : "core:message.reply_external",
          resourceScopeId: "core:conversation",
          entityTypeId: "core:conversation",
          entityId: message.conversation.id,
          resourceAccessRevision: readDecision.resourceAccessRevision,
          decidedAt: fixtureT1,
          notAfter: futureTimestamp(60)
        });
  const decisions = [
    primaryDecision,
    readDecision,
    destinationDecision,
    ...fileViewDecisions,
    ...fileUploadDecisions,
    sourceAccountDecision
  ]
    .filter(
      (decision): decision is InboxV2AuthorizationDecisionReference =>
        decision !== null
    )
    .sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0
    );

  const messagePayloadReference =
    input.messageMutation === null
      ? null
      : payloadReference(
          input.messageMutation.afterMessage.id,
          INBOX_V2_MESSAGE_SCHEMA_ID,
          INBOX_V2_MESSAGE_SCHEMA_VERSION,
          input.messageMutation.afterMessage
        );
  const messageCommitReference =
    input.messageMutation === null
      ? null
      : payloadReference(
          input.messageMutation.revision.id,
          INBOX_V2_MESSAGE_REVISION_SCHEMA_ID,
          INBOX_V2_MESSAGE_LIFECYCLE_SCHEMA_VERSION,
          input.messageMutation.revision
        );
  const providerPayloadReference =
    input.providerCreation === null
      ? null
      : payloadReference(
          input.providerCreation.operation.id,
          INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_OPERATION_SCHEMA_ID,
          INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_SCHEMA_VERSION,
          input.providerCreation.operation
        );
  const providerCommitReference =
    input.providerCreation === null
      ? null
      : payloadReference(
          input.providerCreation.operation.id,
          INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_CREATION_COMMIT_SCHEMA_ID,
          INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_SCHEMA_VERSION,
          input.providerCreation
        );
  const eventReference = messageCommitReference ?? providerCommitReference;
  const resultReference =
    commandKind === "provider_delete"
      ? providerPayloadReference
      : messagePayloadReference;
  if (eventReference === null || resultReference === null) {
    throw new Error("MSG005 lifecycle fixture has no event/result reference.");
  }

  const messageChange =
    input.messageMutation === null || messagePayloadReference === null
      ? null
      : {
          id: `change:msg005-message-${token}`,
          ordinal: 1,
          entity: {
            tenantId,
            entityTypeId: "core:message",
            entityId: message.id
          },
          resultingRevision: input.messageMutation.afterMessage.revision,
          timeline: {
            conversation: message.conversation,
            timelineSequence: timelineItem.timelineSequence
          },
          audience: timelineItem.visibility,
          state: {
            kind: "upsert" as const,
            stateSchemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
            stateSchemaVersion: INBOX_V2_MESSAGE_SCHEMA_VERSION,
            stateHash: messagePayloadReference.digest,
            payloadReference: messagePayloadReference,
            domainCommitReference: messageCommitReference
          }
        };
  const providerChange =
    input.providerCreation === null || providerPayloadReference === null
      ? null
      : {
          id: `change:msg005-provider-operation-${token}`,
          ordinal: messageChange === null ? 1 : 2,
          entity: {
            tenantId,
            entityTypeId:
              INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_OPERATION_ENTITY_TYPE_ID,
            entityId: input.providerCreation.operation.id
          },
          resultingRevision: input.providerCreation.operation.revision,
          timeline: null,
          audience: "conversation_external" as const,
          state: {
            kind: "upsert" as const,
            stateSchemaId:
              INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_OPERATION_SCHEMA_ID,
            stateSchemaVersion:
              INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_SCHEMA_VERSION,
            stateHash: providerPayloadReference.digest,
            payloadReference: providerPayloadReference,
            domainCommitReference: providerCommitReference
          }
        };
  const changes = [messageChange, providerChange].filter(
    (change): change is NonNullable<typeof change> => change !== null
  );
  const projectionIntent = {
    id: `outbox-intent:msg005-projection-${token}`,
    ordinal: 1,
    typeId: "core:projection.update",
    handlerId: "core:inbox-projection",
    effectClass: "projection" as const,
    eventId,
    changeIds: changes.map(({ id }) => id),
    payloadReference: null,
    consumerDedupeKey: digest(`${token}:projection-dedupe`),
    correlationId,
    availableAt: occurredAt,
    intentHash: digest(`${token}:projection-intent`)
  };
  const providerIntent =
    providerChange === null || providerPayloadReference === null
      ? null
      : {
          id: `outbox-intent:msg005-provider-${token}`,
          ordinal: 2,
          typeId: "core:provider.message_lifecycle",
          handlerId: "core:provider-message-lifecycle-worker",
          effectClass: "provider_io" as const,
          eventId,
          changeIds: [providerChange.id],
          payloadReference: providerPayloadReference,
          consumerDedupeKey: digest(`${token}:provider-dedupe`),
          correlationId,
          availableAt: occurredAt,
          intentHash: digest(`${token}:provider-intent`)
        };
  const permissions = [
    ...new Set(decisions.map(({ permissionId }) => permissionId))
  ].sort();
  const scopes = [
    ...new Set(decisions.map(({ resourceScopeId }) => resourceScopeId))
  ].sort();
  const inputValue = {
    tenantId,
    command: {
      id: commandId,
      requestId: `request:msg005-${token}`,
      clientMutationId,
      commandTypeId,
      requestHash: digest(`${token}:request`),
      actor: { kind: "employee" as const, employeeId: actor.employeeId },
      authorizationDecisionId: primaryDecision.id,
      authorizationEpoch: actor.authorizationEpoch,
      authorizedAt: primaryDecision.decidedAt,
      publicResultCode,
      resultReference,
      sensitiveResultReference: null
    },
    revisions: {
      expectedTenantRbacRevision: "1",
      expectedSharedAccessRevision: "1",
      advanceTenantRbac: false,
      advanceSharedAccess: false,
      employees: [
        {
          employeeId: actor.employeeId,
          expectedEmployeeAccessRevision: "1",
          expectedEmployeeInboxRelationRevision: "1",
          advanceEmployeeAccess: false,
          advanceEmployeeInboxRelation: false
        }
      ],
      resources: [
        {
          resourceKind: "conversation" as const,
          resourceId: message.conversation.id,
          resourceHeadId:
            input.conversationResourceHeadId ??
            `authorization-resource:msg005-conversation-${token}`,
          expectedResourceAccessRevision: readDecision.resourceAccessRevision,
          advance: "none" as const
        },
        ...(sourceAccountDecision === null || input.providerCreation === null
          ? []
          : [
              {
                resourceKind: "source_account" as const,
                resourceId:
                  input.providerCreation.outboundRoute!.sourceAccount.id,
                resourceHeadId:
                  input.sourceAccountResourceHeadId ??
                  `authorization-resource:msg005-source-account-${token}`,
                expectedResourceAccessRevision: "1",
                advance: "none" as const
              }
            ])
      ]
    },
    records: {
      mutationId,
      relationKind: null,
      streamCommitId,
      expectedStreamEpoch: streamEpoch,
      audienceImpact: { kind: "none" as const },
      commitHash: digest(`${token}:commit`),
      correlationId,
      changes,
      events: [
        {
          id: eventId,
          typeId: "core:message.changed",
          payloadSchemaId: eventReference.schemaId,
          payloadSchemaVersion: eventReference.schemaVersion,
          ordinal: "1",
          changeIds: changes.map(({ id }) => id),
          subjects: [
            {
              tenantId,
              entityTypeId: "core:message",
              entityId: message.id
            }
          ],
          payloadReference: eventReference,
          correlationId,
          commandIds: [commandId],
          clientMutationIds: [clientMutationId],
          authorizationDecisionRefs: decisions,
          accessEffect: { kind: "none" as const },
          occurredAt:
            input.messageMutation?.revision.occurredAt ??
            input.providerCreation?.operation.occurredAt ??
            occurredAt,
          recordedAt: occurredAt,
          eventHash: digest(`${token}:event`)
        }
      ],
      outboxIntents: [projectionIntent, providerIntent].filter(
        (intent): intent is NonNullable<typeof intent> => intent !== null
      ),
      audit: {
        id: `authorization-audit:msg005-${token}`,
        actionId: commandTypeId,
        target: {
          tenantId,
          entityTypeId: "core:message",
          entityId: internalReference(`${token}:audit-target`)
        },
        reasonCodeId:
          commandKind === "edit"
            ? "core:message-edit-requested"
            : commandKind === "local_delete"
              ? "core:employee-delete"
              : "core:employee-delete-provider",
        matchedPermissionIds: permissions,
        grantSourceIds: [internalReference(`${token}:grant-source`)],
        authorizationScopeIds: scopes,
        overrideReasonCodeId: null,
        policyVersion: "v1",
        evidenceReference: eventReference,
        authorizationDecisionRefs: decisions,
        correlationId,
        outcome: "succeeded" as const,
        revisionDeltaHash: computeInboxV2LeafHashDigest([]),
        previousAuditHash: null,
        auditHash: digest(`${token}:audit`),
        occurredAt,
        recordedAt: occurredAt,
        expiresAt: futureTimestamp(24 * 60),
        facets: [
          {
            ordinal: 1,
            dimension: "tenant" as const,
            reference: {
              tenantId,
              entityTypeId: "core:tenant",
              entityId: internalReference(`${token}:tenant-facet`)
            },
            relation: "affected" as const,
            facetHash: digest(`${token}:audit-facet`)
          }
        ]
      }
    },
    occurredAt
  } as unknown as WithInboxV2AuthorizedCommandMutationInput;
  return {
    input: inputValue,
    messageMutation: input.messageMutation,
    providerCreation: input.providerCreation,
    fileUploadAuthorityPlan,
    fileSourceAuthorityPlan
  };
}

function authorizationDecision(input: {
  label: string;
  actor: Readonly<{ employeeId: string; authorizationEpoch: string }>;
  permissionId: string;
  resourceScopeId: string;
  entityTypeId: string;
  entityId: string;
  resourceAccessRevision?: string;
  decisionRevision?: string;
  decidedAt: string;
  notAfter: string;
}): InboxV2AuthorizationDecisionReference {
  return {
    tenantId,
    id: `authorization-decision:msg005-${input.label}-${runId}`,
    authorizationEpoch: input.actor.authorizationEpoch,
    principal: {
      kind: "employee",
      employee: {
        tenantId,
        kind: "employee",
        id: input.actor.employeeId
      }
    },
    permissionId: input.permissionId,
    resourceScopeId: input.resourceScopeId,
    resource: {
      tenantId,
      entityTypeId: input.entityTypeId,
      entityId: input.entityId
    },
    resourceAccessRevision: input.resourceAccessRevision ?? "1",
    decisionRevision: input.decisionRevision ?? "1",
    decisionHash: digest(`${input.label}:decision`),
    outcome: "allowed",
    decidedAt: input.decidedAt,
    notAfter: input.notAfter
  } as InboxV2AuthorizationDecisionReference;
}

function authorizationDecisionFromRoute(
  route: ReturnType<typeof inboxV2OutboundRouteSchema.parse>,
  resourceKind: "conversation" | "source_account",
  actor: Readonly<{ employeeId: string; authorizationEpoch: string }>,
  label: string
): InboxV2AuthorizationDecisionReference {
  const snapshot =
    resourceKind === "conversation"
      ? route.conversationAuthorization
      : route.sourceAccountAuthorization;
  return authorizationDecision({
    label,
    actor,
    permissionId: snapshot.requiredPermissionId,
    resourceScopeId:
      resourceKind === "conversation"
        ? "core:conversation"
        : "core:source-account",
    entityTypeId:
      resourceKind === "conversation"
        ? "core:conversation"
        : "core:source-account",
    entityId:
      resourceKind === "conversation"
        ? route.conversation.id
        : route.sourceAccount.id,
    decisionRevision: snapshot.decisionRevision,
    decidedAt: snapshot.decidedAt,
    notAfter: snapshot.notAfter
  });
}

function payloadReference(
  recordId: string,
  schemaId: string,
  schemaVersion: string,
  payload: unknown
) {
  return {
    tenantId,
    recordId,
    schemaId,
    schemaVersion,
    digest: calculateInboxV2CanonicalSha256(payload)
  };
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function internalReference(value: string): string {
  return `internal-ref:${createHash("sha256")
    .update(value, "utf8")
    .digest("hex")}`;
}

function futureTimestamp(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function committedClosure(db: HuleeDatabase, fixture: LifecycleFixture) {
  const revisionId = fixture.messageMutation?.revision.id ?? "";
  const providerOperationId = fixture.providerCreation?.operation.id ?? "";
  const result = await db.execute<{
    commands: number;
    streamCommits: number;
    changes: number;
    events: number;
    outboxIntents: number;
    messageRevisions: number;
    providerOperations: number;
  }>(sql`
    select
      (select count(*)::integer
         from inbox_v2_auth_command_records
        where tenant_id = ${tenantId}
          and id = ${fixture.input.command.id}) as "commands",
      (select count(*)::integer
         from inbox_v2_tenant_stream_commits
        where tenant_id = ${tenantId}
          and id = ${fixture.input.records.streamCommitId}) as "streamCommits",
      (select count(*)::integer
         from inbox_v2_tenant_stream_changes
        where tenant_id = ${tenantId}
          and stream_commit_id = ${fixture.input.records.streamCommitId})
        as "changes",
      (select count(*)::integer
         from inbox_v2_domain_events
        where tenant_id = ${tenantId}
          and stream_commit_id = ${fixture.input.records.streamCommitId})
        as "events",
      (select count(*)::integer
         from inbox_v2_outbox_intents
        where tenant_id = ${tenantId}
          and stream_commit_id = ${fixture.input.records.streamCommitId})
        as "outboxIntents",
      (select count(*)::integer
         from inbox_v2_message_revisions
        where tenant_id = ${tenantId}
          and id = ${revisionId}) as "messageRevisions",
      (select count(*)::integer
         from inbox_v2_message_provider_lifecycle_operations
        where tenant_id = ${tenantId}
          and id = ${providerOperationId}) as "providerOperations"
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("MSG005 closure count is missing.");
  return row;
}

function zeroClosure() {
  return {
    commands: 0,
    streamCommits: 0,
    changes: 0,
    events: 0,
    outboxIntents: 0,
    messageRevisions: 0,
    providerOperations: 0
  };
}

function totalClosure(closures: readonly ReturnType<typeof zeroClosure>[]) {
  return closures.reduce(
    (total, closure) => ({
      commands: total.commands + closure.commands,
      streamCommits: total.streamCommits + closure.streamCommits,
      changes: total.changes + closure.changes,
      events: total.events + closure.events,
      outboxIntents: total.outboxIntents + closure.outboxIntents,
      messageRevisions: total.messageRevisions + closure.messageRevisions,
      providerOperations: total.providerOperations + closure.providerOperations
    }),
    zeroClosure()
  );
}

async function countProviderLifecycleRouteConsumptions(
  db: HuleeDatabase,
  operationIds: readonly [string, string]
): Promise<number> {
  const result = await db.execute<{ count: number }>(sql`
    select count(*)::integer as count
      from inbox_v2_outbound_route_consumptions
     where tenant_id = ${tenantId}
       and consumer_kind = 'provider_lifecycle'
       and (
         consumer_id = ${operationIds[0]}
         or consumer_id = ${operationIds[1]}
       )
  `);
  return result.rows[0]?.count ?? 0;
}

function terminalUnsupportedProviderLifecycleTransition(
  creation: InboxV2MessageProviderLifecycleOperationCreationCommit,
  suffix: string
) {
  const before = creation.operation;
  if (before.outboundRoute === null) {
    throw new Error(
      "MSG005 terminal requested provider operation requires an OutboundRoute."
    );
  }
  const outcome = {
    state: "unsupported" as const,
    reasonId: "core:provider-operation-unsupported"
  };
  const resultProof = {
    tenantId,
    operation: fixtureReference(
      "message_provider_lifecycle_operation",
      before.id,
      tenantId
    ),
    outboundRoute: before.outboundRoute,
    adapterContract: before.adapterContract,
    capabilityId:
      before.action === "delete" ? "core:message-delete" : "core:message-edit",
    capabilityRevision: before.capabilityRevision,
    semanticId: `core:message.lifecycle.${before.action}.result.unsupported`,
    semanticRevision: "1",
    resultState: "unsupported" as const,
    declaredByTrustedServiceId: before.adapterContract.loadedByTrustedServiceId,
    resultToken: `result:msg005-terminal-${suffix}-${runId}`,
    resultDigestSha256: createHash("sha256")
      .update(`msg005-terminal:${suffix}:${runId}`, "utf8")
      .digest("hex"),
    recordedAt: fixtureT4,
    revision: "1" as const
  };
  const after = {
    ...before,
    outcome,
    revision: "2",
    updatedAt: fixtureT4
  };
  return inboxV2MessageProviderLifecycleTransitionCommitSchema.parse({
    tenantId,
    before,
    transition: {
      operation: resultProof.operation,
      expectedRevision: "1",
      resultingRevision: "2",
      outcome,
      deleteLocalPolicy: before.deleteLocalPolicy,
      resultProof,
      recordedAt: fixtureT4
    },
    after
  });
}

function deleteLegalHoldFence(
  timelineItemId: string,
  expectedLegalHoldSetRevision = "0"
) {
  return {
    tenantId,
    timelineItemId,
    expectedLegalHoldSetRevision
  } as const;
}

async function advanceLegalHoldControlSetRevision(
  db: HuleeDatabase,
  expectedRevision: string,
  resultingRevision: string
): Promise<void> {
  await executeHistoricalFixtureSql(
    db,
    sql`
      insert into inbox_v2_data_governance_control_set_heads (
        tenant_id, legal_hold_set_revision, restriction_set_revision,
        last_changed_stream_position, head_revision, updated_at
      ) values (${tenantId}, 0, 0, 0, 1, ${fixtureT0})
      on conflict (tenant_id) do nothing
    `
  );
  const updated = await executeHistoricalFixtureSql(
    db,
    sql`
      update inbox_v2_data_governance_control_set_heads
         set legal_hold_set_revision = ${resultingRevision}::bigint,
             last_changed_stream_position = ${resultingRevision}::bigint,
             head_revision = head_revision + 1,
             updated_at = ${fixtureT2}
       where tenant_id = ${tenantId}
         and legal_hold_set_revision = ${expectedRevision}::bigint
      returning legal_hold_set_revision::text as revision
    `
  );
  if (updated.rows[0]?.revision !== resultingRevision) {
    throw new Error("MSG005 legal-hold control-set fixture did not advance.");
  }
}

async function seedActiveExactTimelineItemLegalHold(
  db: HuleeDatabase,
  timelineItemId: string,
  suffix: string
): Promise<void> {
  const holdId = `legal_hold:msg005-${suffix}-${runId}`;
  await executeHistoricalFixtureSql(
    db,
    sql`
      insert into inbox_v2_data_governance_legal_hold_targets (
        tenant_id, hold_id, hold_revision, state, scope_manifest_id,
        scope_manifest_revision, storage_root_id, root_record_id,
        entity_type_id, entity_id, expected_entity_revision,
        expected_lineage_revision
      ) values (
        ${tenantId}, ${holdId}, 1, 'active',
        ${`scope_manifest:msg005-${suffix}-${runId}`}, 1,
        ${`storage_root:msg005-${suffix}-${runId}`},
        ${`root_record:msg005-${suffix}-${runId}`},
        'core:timeline-item', ${timelineItemId}, 1, 1
      )
    `
  );
  await executeHistoricalFixtureSql(
    db,
    sql`
      insert into inbox_v2_data_governance_legal_hold_heads (
        tenant_id, hold_id, current_revision, state, head_revision, updated_at
      ) values (${tenantId}, ${holdId}, 1, 'active', 1, ${fixtureT2})
    `
  );
}

async function waitForLegalHoldControlSetLock(
  db: HuleeDatabase
): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await db.execute<{ blocked: boolean }>(sql`
      select exists (
        select 1
          from pg_stat_activity activity
         where activity.pid <> pg_backend_pid()
           and activity.datname = current_database()
           and activity.state = 'active'
           and activity.wait_event_type = 'Lock'
           and activity.query ilike
             '%inbox_v2_data_governance_control_set_heads%'
      ) as blocked
    `);
    if (result.rows[0]?.blocked === true) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

async function seedInternalCreationAnchors(
  db: HuleeDatabase,
  creation: InboxV2MessageCreationCommit
): Promise<void> {
  const conversation = creation.timelineAllocation.conversationBefore;
  const participant = creation.authorParticipant;
  if (
    participant.subject.kind !== "employee" &&
    participant.subject.kind !== "legacy_unknown"
  ) {
    throw new Error(
      "MSG005 internal fixture requires an Employee or legacy migration author."
    );
  }
  const employee =
    participant.subject.kind === "employee"
      ? participant.subject.employee
      : null;
  const legacyProvenanceId =
    participant.subject.kind === "legacy_unknown"
      ? participant.subject.provenanceCodeId
      : null;
  await db.transaction(async (transaction) => {
    if (employee !== null) {
      await transaction.execute(sql`
        insert into employees (
          id, tenant_id, email, display_name, profile, created_at, updated_at
        ) values (
          ${employee.id}, ${tenantId},
          ${`${employee.id.replaceAll(":", "-")}@example.test`},
          'MSG005 internal author', '{}'::jsonb,
          ${participant.createdAt}, ${participant.updatedAt}
        )
      `);
    }
    await transaction.execute(sql`
      insert into inbox_v2_conversations (
        tenant_id, id, topology, transport, purpose_id, lifecycle,
        revision, last_changed_stream_position, created_at, updated_at
      ) values (
        ${tenantId}, ${conversation.id}, ${conversation.topology},
        ${conversation.transport}, ${conversation.purposeId},
        ${conversation.lifecycle}, ${conversation.revision}, 1,
        ${conversation.createdAt}, ${conversation.updatedAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_conversation_heads (
        tenant_id, conversation_id, latest_timeline_sequence,
        latest_activity_item_id, latest_activity_timeline_sequence,
        latest_activity_at, revision, last_changed_stream_position,
        created_at, updated_at
      ) values (
        ${tenantId}, ${conversation.id},
        ${conversation.head.latestTimelineSequence},
        ${conversation.head.latestActivityItemId},
        ${conversation.head.latestActivityTimelineSequence},
        ${conversation.head.latestActivityAt}, ${conversation.head.revision}, 1,
        ${conversation.head.createdAt}, ${conversation.head.updatedAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_conversation_membership_heads (
        tenant_id, conversation_id, membership_revision, created_at, updated_at
      ) values (
        ${tenantId}, ${conversation.id}, 0,
        ${conversation.createdAt}, ${conversation.updatedAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_conversation_participants (
        tenant_id, id, conversation_id, subject_kind,
        subject_employee_id, subject_legacy_provenance_id,
        revision, created_at, updated_at
      ) values (
        ${tenantId}, ${participant.id}, ${conversation.id},
        ${participant.subject.kind}, ${employee?.id ?? null},
        ${legacyProvenanceId}, ${participant.revision},
        ${participant.createdAt}, ${participant.updatedAt}
      )
    `);
  });
}

async function seedExternalLifecycleFixture(
  db: HuleeDatabase,
  suffix: string,
  historicalPosition: string,
  action: "edit" | "delete" = "delete"
) {
  const creation = sourceCreation(suffix);
  const context = await seedExternalCreationAnchors(db, creation, suffix);
  const operator = await seedLifecycleOperator(db, creation, suffix);
  await expect(
    createSourceMessage(
      historicalTimelineFixtureRepository(db),
      creation,
      historicalPosition
    )
  ).resolves.toMatchObject({ kind: "created" });
  const route = await seedLifecycleOutboundRoute({
    db,
    creation,
    context,
    operator,
    suffix,
    action
  });
  const providerCreation = requestedProviderCreation({
    action,
    creation,
    binding: context.bindingProjection.binding,
    operator,
    route,
    suffix
  });
  return { creation, context, operator, route, providerCreation };
}

async function seedCompetingRequestedProviderCreation(
  db: HuleeDatabase,
  external: Awaited<ReturnType<typeof seedExternalLifecycleFixture>>,
  suffix: string,
  action: "edit" | "delete"
) {
  const route = await seedLifecycleOutboundRoute({
    db,
    creation: external.creation,
    context: external.context,
    operator: external.operator,
    suffix,
    action,
    persistedRoutePolicy: {
      routePolicy: external.route.routePolicy,
      routePolicyRevision: external.route.routePolicyRevision
    }
  });
  return requestedProviderCreation({
    action,
    creation: external.creation,
    binding: external.context.bindingProjection.binding,
    operator: external.operator,
    route,
    suffix
  });
}

async function seedExternalCreationAnchors(
  db: HuleeDatabase,
  creation: InboxV2MessageCreationCommit,
  suffix: string
) {
  const occurrence = requireSourceOccurrence(creation);
  const mapping = requireExternalThreadMapping(creation);
  const sourceAccount = occurrence.bindingContext.sourceAccount;
  const sourceConnection = namespaceFixture(
    fixtureSourceConnectionReference,
    suffix
  );
  const adapterContract = occurrence.descriptor.adapterContract;
  const bindingEvidence = {
    tenantId,
    kind: "raw_inbound_event" as const,
    id: `raw_inbound_event:msg005-binding-${suffix}-${runId}`
  };
  const identity = sourceAccountIdentityFixture({
    sourceAccount,
    sourceConnection,
    adapterContract,
    suffix
  });

  await db.transaction(async (transaction) => {
    await transaction.execute(sql`
      insert into source_connections (
        id, tenant_id, source_type, source_name, display_name
      ) values (
        ${sourceConnection.id}, ${tenantId}, 'messenger', 'synthetic',
        ${`MSG005 source connection ${suffix}`}
      )
    `);
    await transaction.execute(sql`
      insert into source_accounts (
        id, tenant_id, source_connection_id, account_type, display_name
      ) values (
        ${sourceAccount.id}, ${tenantId}, ${sourceConnection.id},
        'direct_number', ${`MSG005 source account ${suffix}`}
      )
    `);
    await insertRawInboundEvent(transaction, {
      id: bindingEvidence.id,
      sourceConnectionId: sourceConnection.id,
      sourceAccountId: sourceAccount.id,
      idempotencyKey: `msg005-binding-${suffix}-${runId}`,
      observedAt: fixtureT0
    });
  });
  await seedVerifiedSourceAccountIdentity(db, identity);

  const threadResult = await createSqlInboxV2ExternalThreadRepository(
    db
  ).resolveOrCreateExactMapping({
    mapping,
    streamPosition: position("1")
  });
  expect(threadResult).toMatchObject({ kind: "created" });

  const bindingCommit = sourceThreadBindingCreationCommit({
    creation,
    sourceConnection,
    sourceAccountIdentity: identity,
    bindingEvidence
  });
  const bindingResult =
    await createSqlInboxV2SourceThreadBindingRepository(db).resolveOrCreate(
      bindingCommit
    );
  expect(bindingResult).toMatchObject({ kind: "created" });
  if (
    bindingResult.kind !== "created" &&
    bindingResult.kind !== "already_exists"
  ) {
    throw new Error(
      `Expected a valid MSG005 binding, got ${bindingResult.kind}.`
    );
  }

  const providerActor = occurrence.providerActor;
  if (providerActor?.kind !== "source_external_identity") {
    throw new Error("MSG005 source fixture requires an external actor.");
  }
  const actorRealmId = inboxV2SourceIdentityRealmIdSchema.parse(
    "module:synthetic:msg005-actor-realm"
  );
  const actorVersion = inboxV2SchemaVersionTokenSchema.parse("v1");
  const actorObjectKindId = inboxV2SourceIdentityObjectKindIdSchema.parse(
    "module:synthetic:msg005-provider-user"
  );
  await expect(
    createSqlInboxV2SourceExternalIdentityRepository(db).findOrCreate({
      tenantId,
      id: providerActor.sourceExternalIdentity.id,
      realm: {
        realmId: actorRealmId,
        version: actorVersion,
        canonicalizationVersion: actorVersion
      },
      objectKindId: actorObjectKindId,
      scope: { kind: "source_account", owner: sourceAccount },
      identityDeclaration: {
        adapterContract,
        identityKind: "source_external_identity",
        realmId: actorRealmId,
        realmVersion: actorVersion,
        canonicalizationVersion: actorVersion,
        objectKindId: actorObjectKindId,
        scopeKind: "source_account",
        decisionStrength: "safe_default"
      },
      materializationAuthority: {
        kind: "trusted_service",
        tenantId,
        trustedServiceId: adapterContract.loadedByTrustedServiceId,
        authorizationToken: `materialize:msg005-actor-${suffix}-${runId}`,
        authorizedAt: fixtureT1
      },
      materializedAt: fixtureT1,
      canonicalExternalSubject: `ProviderActor:${suffix}-${runId}`,
      stability: { kind: "stable" },
      createdAt: fixtureT1
    })
  ).resolves.toMatchObject({ kind: "created" });

  const participant = creation.authorParticipant;
  await db.execute(sql`
    insert into inbox_v2_conversation_participants (
      tenant_id, id, conversation_id, subject_kind,
      subject_source_external_identity_id, revision, created_at, updated_at
    ) values (
      ${tenantId}, ${participant.id}, ${creation.message.conversation.id},
      'source_external_identity', ${providerActor.sourceExternalIdentity.id},
      ${participant.revision}, ${participant.createdAt}, ${participant.updatedAt}
    )
  `);

  const eventOrigin = occurrence.origin;
  if (
    eventOrigin.kind === "provider_response" ||
    eventOrigin.kind === "provider_echo"
  ) {
    throw new Error("MSG005 source fixture requires event-backed evidence.");
  }
  await db.transaction(async (transaction) => {
    await insertRawInboundEvent(transaction, {
      id: eventOrigin.rawInboundEvent.id,
      sourceConnectionId: sourceConnection.id,
      sourceAccountId: sourceAccount.id,
      idempotencyKey: `msg005-source-raw-${suffix}-${runId}`,
      observedAt: occurrence.recordedAt
    });
    await transaction.execute(sql`
      insert into normalized_inbound_events (
        id, tenant_id, raw_event_id, source_connection_id,
        source_account_id, source_type, source_name, event_type,
        direction, visibility, payload_version, normalized_payload,
        reply_capability, idempotency_key, processing_status,
        created_at, updated_at
      ) values (
        ${eventOrigin.normalizedInboundEvent.id}, ${tenantId},
        ${eventOrigin.rawInboundEvent.id}, ${sourceConnection.id},
        ${sourceAccount.id}, 'messenger', 'synthetic', 'message',
        ${occurrence.direction}, 'private', 'v1', '{}'::jsonb, '{}'::jsonb,
        ${`msg005-source-normalized-${suffix}-${runId}`}, 'processed',
        ${occurrence.recordedAt}, ${occurrence.recordedAt}
      )
    `);
  });

  const pendingOccurrence = creation.sourceResolutionCommit?.before;
  if (pendingOccurrence === undefined) {
    throw new Error("MSG005 source fixture requires a pending occurrence.");
  }
  const materialization =
    inboxV2SourceOccurrenceMaterializationCommitSchema.parse({
      tenantId,
      occurrence: pendingOccurrence,
      bindingMaterialization: {
        kind: "existing",
        currentProjection: bindingResult.projection,
        creationAuthority: null
      },
      externalThreadMapping: mapping,
      sourceAccountIdentity: identity,
      outboundDispatchAttempt: null,
      outboundDispatch: null,
      outboundRoute: null,
      authority: {
        kind: "trusted_service",
        trustedServiceId: adapterContract.loadedByTrustedServiceId,
        authorizationToken: `materialize:msg005-occurrence-${suffix}-${runId}`,
        authorizedAt: pendingOccurrence.createdAt
      },
      materializedAt: pendingOccurrence.createdAt
    });
  await expect(
    createSqlInboxV2SourceOccurrenceRepository(db).materialize(materialization)
  ).resolves.toMatchObject({ kind: "materialized" });
  return {
    bindingProjection: bindingResult.projection,
    sourceAccountIdentity: identity,
    sourceConnection
  };
}

function sourceAccountIdentityFixture(input: {
  sourceAccount: { tenantId: string; kind: "source_account"; id: string };
  sourceConnection: {
    tenantId: string;
    kind: "source_connection";
    id: string;
  };
  adapterContract: NonNullable<
    InboxV2MessageCreationCommit["sourceOccurrence"]
  >["descriptor"]["adapterContract"];
  suffix: string;
}) {
  const identityDeclaration = {
    adapterContract: input.adapterContract,
    identityKind: "source_account" as const,
    realmId: "module:synthetic:msg005-account-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic:msg005-user-account",
    scopeKind: "source_connection" as const,
    decisionStrength: "authoritative" as const
  };
  return {
    tenantId,
    sourceAccount: input.sourceAccount,
    sourceConnection: input.sourceConnection,
    identityDeclaration,
    accountGeneration: "2",
    revision: "2",
    createdAt: fixtureT0,
    updatedAt: fixtureT1,
    state: "verified" as const,
    expectedCanonicalScope: null,
    provisionalIdentity: null,
    canonicalIdentity: {
      realm: {
        realmId: identityDeclaration.realmId,
        realmVersion: identityDeclaration.realmVersion,
        canonicalizationVersion: identityDeclaration.canonicalizationVersion,
        objectKindId: identityDeclaration.objectKindId
      },
      scope: {
        kind: "source_connection" as const,
        owner: input.sourceConnection
      },
      canonicalExternalSubject: `ProviderAccount:${input.suffix}-${runId}`
    },
    verifiedBy: {
      actor: {
        kind: "trusted_service" as const,
        trustedServiceId: input.adapterContract.loadedByTrustedServiceId
      },
      policyId: "core:provider-account-verification",
      policyVersion: "v1",
      reasonCodeId: "core:account-verified",
      verificationEvidenceToken: `evidence:msg005-account-${input.suffix}-${runId}`,
      decidedAt: fixtureT1
    },
    conflict: null
  };
}

async function seedVerifiedSourceAccountIdentity(
  db: HuleeDatabase,
  identity: ReturnType<typeof sourceAccountIdentityFixture>
): Promise<void> {
  const declaration = identity.identityDeclaration;
  const adapter = declaration.adapterContract;
  const canonical = identity.canonicalIdentity;
  const verifiedTransitionId = `source_account_identity_transition:msg005-${createHash(
    "sha256"
  )
    .update(identity.sourceAccount.id, "utf8")
    .digest("hex")
    .slice(0, 32)}`;
  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = replica`
    );
    try {
      await transaction.execute(sql`
        insert into inbox_v2_source_account_identities (
          tenant_id, source_account_id, source_connection_id, state,
          identity_declaration, declaration_contract_id,
          declaration_contract_version, declaration_revision,
          declaration_surface_id, declaration_loaded_by_trusted_service_id,
          declaration_loaded_at, declaration_realm_id,
          declaration_realm_version, declaration_canonicalization_version,
          declaration_object_kind_id, declaration_scope_kind,
          canonical_realm_id, canonical_realm_version,
          canonicalization_version, canonical_object_kind_id,
          canonical_scope_kind, canonical_scope_source_connection_id,
          canonical_scope_owner_key, canonical_external_subject,
          verified_decision_actor_trusted_service_id,
          verified_decision_policy_id, verified_decision_policy_version,
          verified_decision_reason_code_id,
          verified_decision_verification_evidence_token,
          verified_decision_decided_at, account_generation, revision,
          created_at, updated_at
        ) values (
          ${tenantId}, ${identity.sourceAccount.id},
          ${identity.sourceConnection.id}, 'verified',
          ${JSON.stringify(declaration)}::jsonb,
          ${adapter.contractId}, ${adapter.contractVersion},
          ${adapter.declarationRevision}::bigint, ${adapter.surfaceId},
          ${adapter.loadedByTrustedServiceId}, ${adapter.loadedAt},
          ${declaration.realmId}, ${declaration.realmVersion},
          ${declaration.canonicalizationVersion}, ${declaration.objectKindId},
          'source_connection', ${canonical.realm.realmId},
          ${canonical.realm.realmVersion},
          ${canonical.realm.canonicalizationVersion},
          ${canonical.realm.objectKindId}, 'source_connection',
          ${identity.sourceConnection.id}, ${identity.sourceConnection.id},
          ${canonical.canonicalExternalSubject},
          ${adapter.loadedByTrustedServiceId},
          ${identity.verifiedBy.policyId}, ${identity.verifiedBy.policyVersion},
          ${identity.verifiedBy.reasonCodeId},
          ${identity.verifiedBy.verificationEvidenceToken},
          ${identity.verifiedBy.decidedAt}, ${identity.accountGeneration}::bigint,
          ${identity.revision}::bigint, ${identity.createdAt}, ${identity.updatedAt}
        )
      `);
      await transaction.execute(sql`
        insert into inbox_v2_source_account_identity_verified_snapshots (
          tenant_id, source_account_id, source_connection_id, transition_id,
          identity_revision, account_generation, state,
          identity_declaration, declaration_contract_id,
          declaration_contract_version, declaration_revision,
          declaration_surface_id, declaration_loaded_by_trusted_service_id,
          declaration_loaded_at, declaration_realm_id,
          declaration_realm_version, declaration_canonicalization_version,
          declaration_object_kind_id, declaration_scope_kind,
          canonical_realm_id, canonical_realm_version,
          canonicalization_version, canonical_object_kind_id,
          canonical_scope_kind, canonical_scope_source_connection_id,
          canonical_scope_owner_key, canonical_external_subject,
          verified_decision_actor_trusted_service_id,
          verified_decision_policy_id, verified_decision_policy_version,
          verified_decision_reason_code_id,
          verified_decision_verification_evidence_token,
          verified_decision_decided_at, identity_created_at, verified_at
        ) values (
          ${tenantId}, ${identity.sourceAccount.id},
          ${identity.sourceConnection.id}, ${verifiedTransitionId},
          ${identity.revision}::bigint, ${identity.accountGeneration}::bigint,
          'verified', ${JSON.stringify(declaration)}::jsonb,
          ${adapter.contractId}, ${adapter.contractVersion},
          ${adapter.declarationRevision}::bigint, ${adapter.surfaceId},
          ${adapter.loadedByTrustedServiceId}, ${adapter.loadedAt},
          ${declaration.realmId}, ${declaration.realmVersion},
          ${declaration.canonicalizationVersion}, ${declaration.objectKindId},
          'source_connection', ${canonical.realm.realmId},
          ${canonical.realm.realmVersion},
          ${canonical.realm.canonicalizationVersion},
          ${canonical.realm.objectKindId}, 'source_connection',
          ${identity.sourceConnection.id}, ${identity.sourceConnection.id},
          ${canonical.canonicalExternalSubject},
          ${adapter.loadedByTrustedServiceId},
          ${identity.verifiedBy.policyId}, ${identity.verifiedBy.policyVersion},
          ${identity.verifiedBy.reasonCodeId},
          ${identity.verifiedBy.verificationEvidenceToken},
          ${identity.verifiedBy.decidedAt}, ${identity.createdAt},
          ${identity.updatedAt}
        )
      `);
    } finally {
      await transaction.execute(
        sql`set local session_replication_role = origin`
      );
    }
  });
}

function sourceThreadBindingCreationCommit(input: {
  creation: InboxV2MessageCreationCommit;
  sourceConnection: {
    tenantId: string;
    kind: "source_connection";
    id: string;
  };
  sourceAccountIdentity: ReturnType<typeof sourceAccountIdentityFixture>;
  bindingEvidence: {
    tenantId: string;
    kind: "raw_inbound_event";
    id: string;
  };
}) {
  const occurrence = requireSourceOccurrence(input.creation);
  const mapping = requireExternalThreadMapping(input.creation);
  const adapterContract = occurrence.descriptor.adapterContract;
  const routeDescriptorBase = {
    adapterContract,
    descriptorSchemaId: "module:synthetic:msg005-route",
    descriptorVersion: "v1",
    descriptorRevision: "1",
    destinationKindId: "module:synthetic:msg005-thread",
    destinationSubject: mapping.thread.key.canonicalExternalSubject,
    attributes: [] as const
  };
  const capabilities = [
    {
      capabilityId: "core:message-edit",
      operationId: "core:message.edit",
      contentKindId: null,
      state: "supported" as const,
      referencePortability: "external_thread" as const,
      requiredProviderRoleIds: [] as const,
      validUntil: null,
      diagnostic: null,
      evidence: [input.bindingEvidence]
    },
    {
      capabilityId: "core:message-delete",
      operationId: "core:message.delete",
      contentKindId: null,
      state: "supported" as const,
      referencePortability: "external_thread" as const,
      requiredProviderRoleIds: [] as const,
      validUntil: null,
      diagnostic: null,
      evidence: [input.bindingEvidence]
    }
  ];
  const binding = {
    tenantId,
    id: occurrence.bindingContext.sourceThreadBinding.id,
    externalThread: occurrence.bindingContext.externalThread,
    sourceConnection: input.sourceConnection,
    sourceAccount: occurrence.bindingContext.sourceAccount,
    accountIdentitySnapshot: {
      status: "verified" as const,
      sourceConnection: input.sourceConnection,
      sourceAccount: occurrence.bindingContext.sourceAccount,
      declaration: input.sourceAccountIdentity.identityDeclaration,
      realmId: input.sourceAccountIdentity.canonicalIdentity.realm.realmId,
      canonicalExternalSubject:
        input.sourceAccountIdentity.canonicalIdentity.canonicalExternalSubject,
      accountGeneration: input.sourceAccountIdentity.accountGeneration,
      verificationEvidence: [input.bindingEvidence],
      verifiedAt: fixtureT1
    },
    bindingGeneration: "1",
    remoteAccess: {
      state: "active" as const,
      evidenceAuthority: "direct_observation" as const,
      revision: "1",
      since: fixtureT1,
      evidence: [input.bindingEvidence]
    },
    administrative: {
      state: "enabled" as const,
      revision: "1",
      changedAt: fixtureT1
    },
    runtimeHealth: {
      state: "ready" as const,
      revision: "1",
      checkedAt: fixtureT1,
      diagnostic: null
    },
    historySync: {
      state: "unsupported" as const,
      revision: "1",
      receiveCursor: null,
      historyCursor: null,
      providerWatermark: null,
      lastDurableRawEvent: null,
      updatedAt: fixtureT1,
      diagnostic: null
    },
    providerAccess: {
      revision: "1",
      roleIds: [] as const,
      evidence: [input.bindingEvidence],
      observedAt: fixtureT1
    },
    capabilities: {
      adapterContract,
      revision: "1",
      capturedAt: fixtureT1,
      entries: capabilities
    },
    routeDescriptor: {
      ...routeDescriptorBase,
      descriptorDigestSha256:
        computeCanonicalRouteDescriptorDigest(routeDescriptorBase)
    },
    revision: "1",
    createdAt: fixtureT1,
    updatedAt: fixtureT1
  };
  return inboxV2SourceThreadBindingCreationCommitSchema.parse({
    tenantId,
    externalThreadMapping: mapping,
    sourceAccountIdentity: input.sourceAccountIdentity,
    initialProjection: {
      binding,
      currentRemoteAccessEpisode: {
        tenantId,
        id: `source_thread_binding_remote_access_episode:msg005-${input.creation.message.id.slice(input.creation.message.id.indexOf(":") + 1)}`,
        binding: fixtureReference(
          "source_thread_binding",
          binding.id,
          tenantId
        ),
        state: "active",
        startedAt: fixtureT1,
        endedAt: null,
        startEvidence: [input.bindingEvidence],
        endEvidence: [],
        revision: "1",
        createdAt: fixtureT1,
        updatedAt: fixtureT1
      }
    }
  });
}

async function seedLifecycleOperator(
  db: HuleeDatabase,
  creation: InboxV2MessageCreationCommit,
  suffix: string
) {
  const operator = lifecycleOperatorFixture(creation, suffix);
  const employee = operator.subject.employee;
  await db.transaction(async (transaction) => {
    await transaction.execute(sql`
      insert into employees (
        id, tenant_id, email, display_name, profile, created_at, updated_at
      ) values (
        ${employee.id}, ${tenantId}, ${`msg005-${suffix}-${runId}@example.test`},
        'MSG005 lifecycle operator', '{}'::jsonb,
        ${operator.createdAt}, ${operator.updatedAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_conversation_participants (
        tenant_id, id, conversation_id, subject_kind,
        subject_employee_id, revision, created_at, updated_at
      ) values (
        ${tenantId}, ${operator.id}, ${creation.message.conversation.id},
        'employee', ${employee.id}, ${operator.revision},
        ${operator.createdAt}, ${operator.updatedAt}
      )
    `);
  });
  return operator;
}

function lifecycleOperatorFixture(
  creation: InboxV2MessageCreationCommit,
  suffix: string
): LifecycleEmployeeParticipant {
  const namespaced = namespaceFixture(fixtureParticipant("employee"), suffix);
  const operator = inboxV2ConversationParticipantSchema.parse({
    ...namespaced,
    tenantId,
    conversation: creation.message.conversation
  });
  if (
    operator.subject.kind !== "employee" ||
    operator.conversation.id !== creation.message.conversation.id
  ) {
    throw new Error("MSG005 operator must belong to the source Conversation.");
  }
  return { ...operator, subject: operator.subject };
}

async function seedLifecycleOutboundRoute(input: {
  db: HuleeDatabase;
  creation: InboxV2MessageCreationCommit;
  context: Awaited<ReturnType<typeof seedExternalCreationAnchors>>;
  operator: ReturnType<typeof fixtureParticipant>;
  suffix: string;
  action?: "edit" | "delete";
  persistedRoutePolicy?: Readonly<
    Pick<OutboundRoute, "routePolicy" | "routePolicyRevision">
  >;
}) {
  const action = input.action ?? "delete";
  const occurrence = requireSourceOccurrence(input.creation);
  const externalReference = input.creation.externalMessageReference;
  const resolution = input.creation.sourceResolutionCommit;
  const binding = input.context.bindingProjection.binding;
  if (
    externalReference === null ||
    resolution === null ||
    input.operator.subject.kind !== "employee"
  ) {
    throw new Error("MSG005 route requires one exact external target.");
  }
  const operationId = `core:message.${action}`;
  const permissionId = "core:conversation.read";
  const rawRoute = namespaceFixture(
    fixtureExternalTargetRoute(operationId, permissionId),
    input.suffix
  );
  if (rawRoute.referenceContext.kind !== "external_message") {
    throw new Error("MSG005 route requires external-message context.");
  }
  const occurrenceReference = fixtureReference(
    "source_occurrence",
    occurrence.id,
    tenantId
  );
  const externalReferenceRef = fixtureReference(
    "external_message_reference",
    externalReference.id,
    tenantId
  );
  const bindingReference = fixtureReference(
    "source_thread_binding",
    binding.id,
    tenantId
  );
  const bindingFence = {
    accountGeneration:
      binding.accountIdentitySnapshot.status === "verified"
        ? binding.accountIdentitySnapshot.accountGeneration
        : input.context.sourceAccountIdentity.accountGeneration,
    bindingGeneration: binding.bindingGeneration,
    remoteAccessRevision: binding.remoteAccess.revision,
    administrativeRevision: binding.administrative.revision,
    capabilityRevision: binding.capabilities.revision,
    routeDescriptorRevision: binding.routeDescriptor.descriptorRevision
  };
  const authorizationEpoch = `authorization:msg005-provider-${input.suffix}-${runId}`;
  const notAfter = futureTimestamp(60);
  const referenceContext = {
    ...rawRoute.referenceContext,
    externalThread: binding.externalThread,
    externalMessageReference: externalReferenceRef,
    sourceOccurrence: occurrenceReference,
    originBinding: bindingReference,
    originSourceAccount: binding.sourceAccount,
    portability: occurrence.referencePortability,
    resolutionDecision: {
      ...rawRoute.referenceContext.resolutionDecision,
      tenantId,
      externalThread: binding.externalThread,
      externalMessageReference: externalReferenceRef,
      sourceOccurrence: occurrenceReference,
      originBinding: bindingReference,
      originSourceAccount: binding.sourceAccount,
      occurrenceRevision: occurrence.revision,
      occurrenceBindingGeneration: occurrence.bindingContext.bindingGeneration,
      occurrenceDescriptor: occurrence.descriptor,
      portability: occurrence.referencePortability,
      availabilityObservation: {
        ...rawRoute.referenceContext.resolutionDecision.availabilityObservation,
        tenantId,
        externalThread: binding.externalThread,
        externalMessageReference: externalReferenceRef,
        sourceOccurrence: occurrenceReference,
        occurrenceRevision: occurrence.revision,
        occurrenceDescriptorDigestSha256:
          occurrence.descriptor.descriptorDigestSha256,
        adapterContract: occurrence.descriptor.adapterContract,
        notAfter
      },
      loadedByTrustedServiceId: resolution.resolver.trustedServiceId,
      decidedAt: resolution.changedAt,
      notAfter
    }
  };
  const referenceTarget = {
    kind: "external_message" as const,
    externalMessageReference: externalReferenceRef,
    sourceOccurrence: occurrenceReference
  };
  const principal = {
    kind: "employee" as const,
    employee: input.operator.subject.employee
  };
  const authorizationTarget = {
    ...rawRoute.conversationAuthorization.target,
    authorizationEpoch,
    conversation: input.creation.message.conversation,
    externalThread: binding.externalThread,
    sourceThreadBinding: bindingReference,
    sourceAccount: binding.sourceAccount,
    sourceConnection: binding.sourceConnection,
    operationId,
    contentKindId: null,
    bindingFence,
    referenceTarget
  };
  const authorizationBase = {
    tenantId,
    principal,
    target: authorizationTarget,
    effect: "allow" as const,
    decisionRevision: "1",
    loadedByTrustedServiceId: "core:authorization-service",
    decidedAt: fixtureT1,
    notAfter
  };
  const route = inboxV2OutboundRouteSchema.parse({
    ...rawRoute,
    tenantId,
    principal,
    conversation: input.creation.message.conversation,
    externalThread: binding.externalThread,
    sourceThreadBinding: bindingReference,
    sourceAccount: binding.sourceAccount,
    sourceConnection: binding.sourceConnection,
    operationId,
    contentKindId: null,
    routePolicy:
      input.persistedRoutePolicy?.routePolicy ?? rawRoute.routePolicy,
    routePolicyRevision:
      input.persistedRoutePolicy?.routePolicyRevision ??
      rawRoute.routePolicyRevision,
    authorizationEpoch,
    requiredConversationPermissionId: permissionId,
    bindingFence,
    adapterContract: binding.capabilities.adapterContract,
    routeDescriptor: binding.routeDescriptor,
    conversationAuthorization: {
      ...authorizationBase,
      decisionKind: "conversation_action",
      requiredPermissionId: permissionId,
      matchedPermissionIds: [permissionId],
      decisionToken: `decision:msg005-conversation-${input.suffix}-${runId}`
    },
    sourceAccountAuthorization: {
      ...authorizationBase,
      decisionKind: "source_account_use",
      requiredPermissionId: "core:source_account.use",
      matchedPermissionIds: ["core:source_account.use"],
      decisionToken: `decision:msg005-source-account-${input.suffix}-${runId}`
    },
    referenceContext,
    runtimeObservationAtResolution: {
      state: binding.runtimeHealth.state,
      revision: binding.runtimeHealth.revision,
      observedAt: binding.runtimeHealth.checkedAt,
      diagnostic: binding.runtimeHealth.diagnostic
    },
    selection: {
      ...rawRoute.selection,
      intent: { kind: "explicit_occurrence", occurrence: occurrenceReference },
      reason: "explicit_occurrence"
    },
    mutationToken: `mutation:msg005-route-${input.suffix}-${runId}`,
    idempotencyToken: `idempotency:msg005-route-${input.suffix}-${runId}`,
    correlationToken: `correlation:msg005-route-${input.suffix}-${runId}`,
    createdAt: fixtureT2
  });
  const policy = inboxV2ThreadRoutePolicySchema.parse({
    tenantId,
    id: route.routePolicy.id,
    conversation: route.conversation,
    externalThread: route.externalThread,
    operationId: route.operationId,
    contentKindId: route.contentKindId,
    policyId: "core:ordered-explicit-policy",
    requiredConversationPermissionId: route.requiredConversationPermissionId,
    preferredBinding: null,
    fallback: { kind: "none" },
    revision: route.routePolicyRevision,
    createdAt: fixtureT0,
    updatedAt: fixtureT0
  });
  if (input.persistedRoutePolicy === undefined) {
    await expect(
      createSqlInboxV2OutboundTransportRepository(input.db).persistRoutePolicy(
        policy
      )
    ).resolves.toMatchObject({ kind: "committed" });
  }
  const fenceResult = await input.db.execute<Record<string, unknown>>(sql`
    select binding_id, external_thread_id, source_connection_id,
           source_account_id, revision as binding_revision,
           account_generation, binding_generation, remote_access_revision,
           administrative_revision, capability_revision,
           provider_access_revision, route_descriptor_revision,
           remote_access_state, administrative_state, runtime_health_state
      from inbox_v2_source_thread_binding_heads
     where tenant_id = ${tenantId}
       and binding_id = ${binding.id}
  `);
  const fence = fenceResult.rows[0];
  if (fence === undefined) {
    throw new Error("MSG005 route requires a persisted binding fence.");
  }
  const inserted = await executeHistoricalFixtureSql(
    input.db,
    buildInsertInboxV2OutboundRouteSql(route, fence as never)
  );
  expect(inserted.rows).toHaveLength(1);
  return route;
}

function requestedProviderCreation(input: {
  action: "edit" | "delete";
  creation: InboxV2MessageCreationCommit;
  binding: Awaited<
    ReturnType<typeof seedExternalCreationAnchors>
  >["bindingProjection"]["binding"];
  operator: ReturnType<typeof fixtureParticipant>;
  route: ReturnType<typeof inboxV2OutboundRouteSchema.parse>;
  suffix: string;
}): InboxV2MessageProviderLifecycleOperationCreationCommit {
  const occurrence = requireSourceOccurrence(input.creation);
  const externalReference = input.creation.externalMessageReference;
  const timelineItem = input.creation.timelineAllocation.items[0];
  if (
    externalReference === null ||
    timelineItem === undefined ||
    input.operator.subject.kind !== "employee"
  ) {
    throw new Error("MSG005 provider operation requires exact target state.");
  }
  const operationId = `message_provider_lifecycle_operation:msg005-${input.action}-${input.suffix}-${runId}`;
  const actionParticipant = fixtureReference(
    "conversation_participant",
    input.operator.id,
    tenantId
  );
  const operation = {
    tenantId,
    id: operationId,
    message: fixtureReference("message", input.creation.message.id, tenantId),
    action: input.action,
    origin: "hulee_requested" as const,
    externalMessageReference: fixtureReference(
      "external_message_reference",
      externalReference.id,
      tenantId
    ),
    sourceOccurrence: fixtureReference(
      "source_occurrence",
      occurrence.id,
      tenantId
    ),
    sourceAccount: input.route.sourceAccount,
    sourceThreadBinding: input.route.sourceThreadBinding,
    bindingGeneration: occurrence.bindingContext.bindingGeneration,
    outboundRoute: fixtureReference("outbound_route", input.route.id, tenantId),
    adapterContract: input.route.adapterContract,
    capabilityRevision: input.route.bindingFence.capabilityRevision,
    appActor: {
      kind: "employee" as const,
      employee: input.operator.subject.employee,
      authorizationEpoch: input.route.authorizationEpoch
    },
    actionParticipant,
    automationCausation: null,
    outcome: { state: "pending" as const },
    deleteLocalPolicy:
      input.action === "delete"
        ? ({ effect: "not_evaluated" as const } as const)
        : null,
    revision: "1",
    occurredAt: fixtureT3,
    recordedAt: fixtureT3,
    createdAt: fixtureT3,
    updatedAt: fixtureT3
  };
  return inboxV2MessageProviderLifecycleOperationCreationCommitSchema.parse({
    tenantId,
    message: input.creation.message,
    timelineItem,
    externalMessageReference: externalReference,
    sourceOccurrence: occurrence,
    outboundRoute: input.route,
    outboundBindingSnapshot: input.binding,
    actionParticipantSnapshot: input.operator,
    providerSemanticProof: null,
    semanticOrderingCommit: null,
    routeConsumption: {
      outboundRoute: operation.outboundRoute,
      operation: fixtureReference(
        "message_provider_lifecycle_operation",
        operationId,
        tenantId
      ),
      mutationToken: input.route.mutationToken,
      idempotencyToken: input.route.idempotencyToken,
      correlationToken: input.route.correlationToken,
      consumedByTrustedServiceId:
        input.route.adapterContract.loadedByTrustedServiceId,
      consumedAt: operation.recordedAt,
      revision: "1"
    },
    operation
  });
}

function withRouteConversationPermission(
  commit: InboxV2MessageProviderLifecycleOperationCreationCommit,
  permissionId: "core:message.delete_own"
) {
  if (commit.outboundRoute === null) {
    throw new Error(
      "MSG005 route-permission fixture requires an OutboundRoute."
    );
  }
  return {
    ...commit,
    outboundRoute: {
      ...commit.outboundRoute,
      requiredConversationPermissionId: permissionId,
      conversationAuthorization: {
        ...commit.outboundRoute.conversationAuthorization,
        requiredPermissionId: permissionId,
        matchedPermissionIds: [permissionId]
      }
    }
  };
}

function withAuthorizationDecisionPatch(
  input: WithInboxV2AuthorizedCommandMutationInput,
  matches: (decision: InboxV2AuthorizationDecisionReference) => boolean,
  patch: (decision: InboxV2AuthorizationDecisionReference) => unknown
): WithInboxV2AuthorizedCommandMutationInput {
  const rewrite = (
    decisions: readonly InboxV2AuthorizationDecisionReference[]
  ) =>
    decisions.map((decision) =>
      matches(decision)
        ? inboxV2AuthorizationDecisionReferenceSchema.parse(patch(decision))
        : decision
    );
  return {
    ...input,
    records: {
      ...input.records,
      events: input.records.events.map((event) => ({
        ...event,
        authorizationDecisionRefs: rewrite(event.authorizationDecisionRefs)
      })),
      audit: {
        ...input.records.audit,
        authorizationDecisionRefs: rewrite(
          input.records.audit.authorizationDecisionRefs
        )
      }
    }
  };
}

function withoutAuthorizationDecisions(
  input: WithInboxV2AuthorizedCommandMutationInput,
  remove: (decision: InboxV2AuthorizationDecisionReference) => boolean
): WithInboxV2AuthorizedCommandMutationInput {
  const keep = (decisions: readonly InboxV2AuthorizationDecisionReference[]) =>
    decisions.filter((decision) => !remove(decision));
  const auditDecisions = keep(input.records.audit.authorizationDecisionRefs);
  return {
    ...input,
    records: {
      ...input.records,
      events: input.records.events.map((event) => ({
        ...event,
        authorizationDecisionRefs: keep(event.authorizationDecisionRefs)
      })),
      audit: {
        ...input.records.audit,
        matchedPermissionIds: [
          ...new Set(auditDecisions.map(({ permissionId }) => permissionId))
        ].sort(),
        authorizationScopeIds: [
          ...new Set(
            auditDecisions.map(({ resourceScopeId }) => resourceScopeId)
          )
        ].sort(),
        authorizationDecisionRefs: auditDecisions
      }
    }
  };
}

async function createSourceMessage(
  repository: ReturnType<typeof createSqlInboxV2TimelineMessageRepository>,
  creation: InboxV2MessageCreationCommit,
  streamPosition: string
) {
  const resolution = creation.sourceResolutionCommit;
  const externalReference = creation.externalMessageReference;
  if (resolution === null || externalReference === null) {
    throw new Error("MSG005 source creation requires its resolution graph.");
  }
  return repository.withMessageCreation(
    { commit: creation, streamPosition: position(streamPosition) },
    async ({ executor }) => {
      const referenceInsert = await executor.execute(
        buildInsertInboxV2ExternalMessageReferenceSql(externalReference)
      );
      expect(referenceInsert.rows).toHaveLength(1);
      const transitionInsert = await executor.execute(
        buildInsertInboxV2SourceOccurrenceResolutionTransitionSql(resolution)
      );
      expect(transitionInsert.rows).toHaveLength(1);
      const occurrenceUpdate = await executor.execute(
        buildCompareAndSwapInboxV2SourceOccurrenceResolutionSql(resolution)
      );
      expect(occurrenceUpdate.rows).toHaveLength(1);
    }
  );
}

async function insertRawInboundEvent(
  executor: { execute(query: ReturnType<typeof sql>): Promise<unknown> },
  input: {
    id: string;
    sourceConnectionId: string;
    sourceAccountId: string;
    idempotencyKey: string;
    observedAt: string;
  }
): Promise<void> {
  await executor.execute(sql`
    insert into raw_inbound_events (
      id, tenant_id, source_connection_id, source_account_id,
      idempotency_key, received_at, payload, headers,
      processing_status, created_at, updated_at
    ) values (
      ${input.id}, ${tenantId}, ${input.sourceConnectionId},
      ${input.sourceAccountId}, ${input.idempotencyKey}, ${input.observedAt},
      '{}'::jsonb, '{}'::jsonb, 'processed', ${input.observedAt},
      ${input.observedAt}
    )
  `);
}

function computeCanonicalRouteDescriptorDigest(descriptor: {
  adapterContract: {
    contractId: string;
    contractVersion: string;
    declarationRevision: string;
    surfaceId: string;
    loadedByTrustedServiceId: string;
  };
  descriptorSchemaId: string;
  descriptorVersion: string;
  descriptorRevision: string;
  destinationKindId: string;
  destinationSubject: string;
  attributes: readonly { attributeId: string; value: string }[];
}): string {
  const lengthPrefixed = (value: string) =>
    `${Buffer.byteLength(value, "utf8")}:${value}`;
  const adapter = descriptor.adapterContract;
  return createHash("sha256")
    .update(
      [
        lengthPrefixed(adapter.contractId),
        lengthPrefixed(adapter.contractVersion),
        lengthPrefixed(adapter.declarationRevision),
        lengthPrefixed(adapter.surfaceId),
        lengthPrefixed(adapter.loadedByTrustedServiceId),
        lengthPrefixed(descriptor.descriptorSchemaId),
        lengthPrefixed(descriptor.descriptorVersion),
        lengthPrefixed(descriptor.descriptorRevision),
        lengthPrefixed(descriptor.destinationKindId),
        lengthPrefixed(descriptor.destinationSubject),
        ...[...descriptor.attributes]
          .sort((left, right) =>
            left.attributeId.localeCompare(right.attributeId, "en")
          )
          .flatMap((attribute) => [
            lengthPrefixed(attribute.attributeId),
            lengthPrefixed(attribute.value)
          ])
      ].join(""),
      "utf8"
    )
    .digest("hex");
}

function requireSourceOccurrence(creation: InboxV2MessageCreationCommit) {
  if (creation.sourceOccurrence === null) {
    throw new Error("MSG005 fixture requires a SourceOccurrence.");
  }
  return creation.sourceOccurrence;
}

function requireExternalThreadMapping(creation: InboxV2MessageCreationCommit) {
  if (creation.externalThreadMapping === null) {
    throw new Error("MSG005 fixture requires an ExternalThread mapping.");
  }
  return creation.externalThreadMapping;
}

function historicalTimelineFixtureRepository(db: HuleeDatabase) {
  return createSqlInboxV2TimelineMessageRepository({
    execute: db.execute.bind(db),
    transaction: <TResult>(
      work: (transaction: unknown) => Promise<TResult>,
      config: Readonly<{
        isolationLevel: "read committed" | "repeatable read";
      }>
    ) =>
      db.transaction(async (transaction) => {
        await transaction.execute(
          sql`set local session_replication_role = replica`
        );
        try {
          return await work(transaction);
        } finally {
          await transaction.execute(
            sql`set local session_replication_role = origin`
          );
        }
      }, config)
  } as never);
}

async function executeHistoricalFixtureSql(
  db: HuleeDatabase,
  statement: Parameters<RawSqlExecutor["execute"]>[0]
) {
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = replica`
    );
    try {
      return await transaction.execute(statement);
    } finally {
      await transaction.execute(
        sql`set local session_replication_role = origin`
      );
    }
  });
}

async function seedReadyLifecycleFileGraph(
  db: HuleeDatabase,
  pin: ReturnType<typeof lifecycleReadyFilePin>,
  timestamp: string
): Promise<void> {
  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = replica`
    );
    try {
      await transaction.execute(sql`
        insert into inbox_v2_file_object_versions (
          tenant_id, id, storage_root_id, storage_object_key,
          storage_version_identity, versioning_mode, checksum_sha256,
          size_bytes, declared_media_type, detected_media_type,
          encryption_key_ref, data_class_id, retention_anchor_at, created_at
        ) values (
          ${tenantId}, ${pin.objectVersion.id}, 'core:tenant-object-storage',
          ${`msg005/${pin.file.id}/v1`}, 'v1', 'immutable_key',
          ${"a".repeat(64)}, 42, 'image/png', 'image/png', null,
          'core:message-content', ${timestamp}, ${timestamp}
        )
      `);
      await transaction.execute(sql`
        insert into inbox_v2_file_objects (
          tenant_id, id, data_class_id, processing_purpose_id,
          retention_anchor_at, state, current_file_version_id,
          current_object_version_id, revision, created_at, updated_at
        ) values (
          ${tenantId}, ${pin.file.id}, 'core:message-content', 'core:chat',
          ${timestamp}, 'ready', ${pin.fileVersion.id},
          ${pin.objectVersion.id}, ${pin.fileRevision}::bigint,
          ${timestamp}, ${timestamp}
        )
      `);
      await transaction.execute(sql`
        insert into inbox_v2_file_versions (
          tenant_id, id, file_id, version_number, object_version_id, created_at
        ) values (
          ${tenantId}, ${pin.fileVersion.id}, ${pin.file.id}, 1,
          ${pin.objectVersion.id}, ${timestamp}
        )
      `);
      await transaction.execute(sql`
        insert into inbox_v2_file_object_version_heads (
          tenant_id, object_version_id, state, latest_operation_evidence_id,
          revision, state_changed_at, created_at
        ) values (
          ${tenantId}, ${pin.objectVersion.id}, 'ready', null, 1,
          ${timestamp}, ${timestamp}
        )
      `);
      await transaction.execute(sql`
        insert into inbox_v2_file_parent_set_heads (
          tenant_id, file_id, revision, completeness,
          completeness_revision, live_parent_count, updated_at
        ) values (
          ${tenantId}, ${pin.file.id}, 1, 'complete', 1, 0, ${timestamp}
        )
      `);
    } finally {
      await transaction.execute(
        sql`set local session_replication_role = origin`
      );
    }
  });
}

async function seedUploadStagingLifecycleSource(
  db: HuleeDatabase,
  authority: InboxV2MessageEditFileSourceAuthorityTarget,
  mutation: MessageMutation,
  timestamp: string
): Promise<void> {
  const source = authority.sourceParent;
  if (
    authority.purpose !== "attachment" ||
    source.kind !== "upload_staging" ||
    source.appActor.kind !== "employee"
  ) {
    throw new Error(
      "MSG005 upload-staging fixture requires an Employee attachment source."
    );
  }
  const priorFileRevision = (
    BigInt(authority.expectedFileRevision) - 1n
  ).toString();
  if (BigInt(priorFileRevision) < 1n) {
    throw new Error(
      "MSG005 ready upload source requires a resulting File revision above one."
    );
  }
  const suffix = createHash("sha256")
    .update(authority.attachment.id, "utf8")
    .digest("hex")
    .slice(0, 32);
  const parent = {
    kind: "upload_staging" as const,
    purpose: "attachment" as const,
    visibilityBoundary: "upload_staging" as const,
    parentConversationVisibility: null,
    entityId: authority.attachment.id,
    entityRevision: source.uploadRevision,
    conversationId: null,
    timelineItemId: null,
    contentId: null,
    contentRevision: null,
    blockKey: null
  };
  const attachInput = {
    tenantId,
    fileId: authority.file.id,
    fileVersionId: authority.fileVersion.id,
    objectVersionId: authority.objectVersion.id,
    expectedParentSetRevision: "2",
    parent,
    dataClassId: "core:message-content",
    processingPurposeId: "core:chat",
    retentionAnchorAt: timestamp
  };
  const parentIdentityDigestSha256 =
    calculateInboxV2FileParentIdentityDigest(attachInput);
  const linkId = lifecycleFileParentLinkId(
    authority.file.id,
    parentIdentityDigestSha256
  );
  const jobId = `attachment_materialization_job:msg005-${suffix}`;
  const actor = source.appActor;
  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = replica`
    );
    try {
      await transaction.execute(sql`
        insert into inbox_v2_file_parent_links (
          tenant_id, id, file_id, file_version_id, object_version_id,
          parent_identity_digest_sha256, parent_kind, parent_purpose,
          visibility_boundary, parent_conversation_visibility,
          parent_entity_id, parent_entity_revision, conversation_id,
          timeline_item_id, content_id, content_revision, block_key,
          data_class_id, processing_purpose_id, retention_anchor_at,
          created_at, revision
        ) values (
          ${tenantId}, ${linkId}, ${authority.file.id},
          ${authority.fileVersion.id}, ${authority.objectVersion.id},
          ${parentIdentityDigestSha256}, 'upload_staging', 'attachment',
          'upload_staging', null, ${authority.attachment.id},
          ${source.uploadRevision}::bigint, null, null, null,
          null, null, 'core:message-content', 'core:chat', ${timestamp},
          ${timestamp}, 1
        )
      `);
      await transaction.execute(sql`
        insert into inbox_v2_file_parent_link_heads (
          tenant_id, link_id, file_id, state, detached_by_event_id,
          revision, updated_at
        ) values (
          ${tenantId}, ${linkId}, ${authority.file.id}, 'live', null, 1,
          ${timestamp}
        )
      `);
      await transaction.execute(sql`
        update inbox_v2_file_parent_set_heads
           set revision = revision + 1,
               completeness_revision = completeness_revision + 1,
               live_parent_count = live_parent_count + 1,
               updated_at = ${timestamp}
         where tenant_id = ${tenantId}
           and file_id = ${authority.file.id}
      `);
      await transaction.execute(sql`
        insert into inbox_v2_file_attachment_materialization_jobs (
          tenant_id, id, attachment_id, file_id, expected_file_revision,
          conversation_id, timeline_item_id, parent_message_id,
          expected_parent_revision, visibility_boundary,
          timeline_content_id, expected_content_revision, content_block_key,
          content_mutation_fence_sha256, source_occurrence_id,
          source_locator_kind, source_locator_reference,
          source_locator_digest_sha256, reservation_namespace_generation,
          idempotency_token, cause_event_id, cause_mutation_id,
          cause_stream_commit_id, cause_stream_position, correlation_id,
          caused_at, authorization_command_id,
          authorization_command_type_id, authorization_client_mutation_id,
          authorization_mutation_id, authorization_decision_id,
          authorization_epoch, authorization_actor_kind,
          authorization_actor_id, authorization_authorized_at,
          authorization_decision_set_digest_sha256,
          authorization_resource_fence_set_digest_sha256,
          authorization_tenant_rbac_revision,
          authorization_shared_access_revision,
          authorization_resource_head_id,
          authorization_resource_access_revision,
          authorization_structural_relation_revision,
          authorization_collaborator_set_revision,
          authorization_audit_grant_source_ids,
          authorization_audit_policy_version,
          expected_attachment_revision, state, lease_generation,
          reserved_file_version_id, reserved_object_version_id,
          reserved_storage_root_id, reserved_storage_object_key,
          result_file_version_id, result_object_version_id,
          result_file_revision, result_content_revision, terminal_reason_id,
          revision, created_at, updated_at
        ) values (
          ${tenantId}, ${jobId}, ${authority.attachment.id},
          ${authority.file.id}, ${priorFileRevision}::bigint,
          ${mutation.beforeMessage.conversation.id},
          ${mutation.beforeTimelineItem.id}, ${mutation.beforeMessage.id},
          ${mutation.beforeMessage.revision}::bigint,
          ${mutation.beforeTimelineItem.visibility === "internal_participants" ? "internal" : "external_work"},
          ${mutation.beforeMessage.content.content.id},
          ${mutation.beforeMessage.content.contentRevision}::bigint,
          ${authority.blockKey}, ${"a".repeat(64)}, null,
          'upload_staging', ${`src_ref_${suffix}${"a".repeat(11)}`},
          ${"b".repeat(64)}, 'msg005-upload-v1',
          ${`msg005-upload-${suffix}`}, ${`event:msg005-upload-${suffix}`},
          ${`mutation:msg005-upload-${suffix}`},
          ${`stream_commit:msg005-upload-${suffix}`}, 1,
          ${`correlation:msg005-upload-${suffix}`}, ${timestamp},
          ${`command:msg005-upload-${suffix}`},
          'core:attachment.materialization.reserve',
          ${`mutation:msg005-upload-client-${suffix}`},
          ${`authorization-mutation:msg005-upload-${suffix}`},
          ${`authorization-decision:msg005-upload-${suffix}`},
          ${actor.authorizationEpoch}, 'employee', ${actor.employee.id},
          ${timestamp}, ${"c".repeat(64)}, ${"d".repeat(64)}, 1, 1,
          ${`authorization-resource:msg005-upload-${suffix}`}, 1, 1, 1,
          array[${`internal-ref:${suffix}`}], 'core:msg005-upload',
          ${source.uploadRevision}::bigint, 'ready', 0,
          ${authority.fileVersion.id}, ${authority.objectVersion.id},
          'core:tenant-object-storage', ${`msg005/upload/${suffix}`},
          ${authority.fileVersion.id}, ${authority.objectVersion.id},
          ${authority.expectedFileRevision}::bigint, 2, null, 2,
          ${timestamp}, ${timestamp}
        )
      `);
    } finally {
      await transaction.execute(
        sql`set local session_replication_role = origin`
      );
    }
  });
}

async function seedConflictingLifecycleFileParent(
  db: HuleeDatabase,
  attachment: LifecycleReadyFileParent,
  createdAt: string
): Promise<void> {
  const attachInput = {
    tenantId,
    fileId: attachment.fileId,
    fileVersionId: attachment.fileVersionId,
    objectVersionId: attachment.objectVersionId,
    expectedParentSetRevision: "1",
    parent: attachment.parent,
    dataClassId: "core:message-content",
    processingPurposeId: attachment.processingPurposeId,
    retentionAnchorAt: attachment.retentionAnchorAt
  };
  const parentIdentityDigestSha256 =
    calculateInboxV2FileParentIdentityDigest(attachInput);
  const linkId = lifecycleFileParentLinkId(
    attachment.fileId,
    parentIdentityDigestSha256
  );
  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = replica`
    );
    try {
      await transaction.execute(sql`
        insert into inbox_v2_file_parent_links (
          tenant_id, id, file_id, file_version_id, object_version_id,
          parent_identity_digest_sha256, parent_kind, parent_purpose,
          visibility_boundary, parent_conversation_visibility,
          parent_entity_id, parent_entity_revision, conversation_id,
          timeline_item_id, content_id, content_revision, block_key,
          data_class_id, processing_purpose_id, retention_anchor_at,
          created_at, revision
        ) values (
          ${tenantId}, ${linkId}, ${attachment.fileId},
          ${attachment.fileVersionId}, ${attachment.objectVersionId},
          ${parentIdentityDigestSha256}, ${attachment.parent.kind},
          ${attachment.parent.purpose},
          ${attachment.parent.visibilityBoundary},
          ${attachment.parent.parentConversationVisibility},
          ${attachment.parent.entityId},
          ${attachment.parent.entityRevision}::bigint,
          ${attachment.parent.conversationId},
          ${attachment.parent.timelineItemId}, ${attachment.parent.contentId},
          ${attachment.parent.contentRevision}::bigint,
          ${attachment.parent.blockKey}, 'core:message-content',
          ${attachment.processingPurposeId}, ${attachment.retentionAnchorAt},
          ${createdAt}, 1
        )
      `);
      await transaction.execute(sql`
        insert into inbox_v2_file_parent_link_heads (
          tenant_id, link_id, file_id, state, detached_by_event_id,
          revision, updated_at
        ) values (
          ${tenantId}, ${linkId}, ${attachment.fileId}, 'live', null, 1,
          ${createdAt}
        )
      `);
      await transaction.execute(sql`
        update inbox_v2_file_parent_set_heads
           set revision = revision + 1,
               completeness_revision = completeness_revision + 1,
               live_parent_count = live_parent_count + 1,
               updated_at = ${createdAt}
         where tenant_id = ${tenantId}
           and file_id = ${attachment.fileId}
      `);
    } finally {
      await transaction.execute(
        sql`set local session_replication_role = origin`
      );
    }
  });
}

function lifecycleFileParentLinkId(
  fileId: string,
  parentIdentityDigestSha256: string
): string {
  const hash = createHash("sha256");
  hash.update("core:inbox-v2.file_parent_link-id@v1", "utf8");
  for (const part of [tenantId, fileId, parentIdentityDigestSha256]) {
    hash.update("\u0000", "utf8");
    hash.update(part, "utf8");
  }
  return `file_parent_link:${hash.digest("hex")}`;
}

async function fileParentState(db: HuleeDatabase, fileId: string) {
  const result = await db.execute<{
    revision: string;
    liveParentCount: number;
    linkCount: number;
  }>(sql`
    select head.revision::text as revision,
           head.live_parent_count::integer as "liveParentCount",
           (
             select count(*)::integer
               from inbox_v2_file_parent_link_heads link_head
              where link_head.tenant_id = head.tenant_id
                and link_head.file_id = head.file_id
                and link_head.state = 'live'
           ) as "linkCount"
      from inbox_v2_file_parent_set_heads head
     where head.tenant_id = ${tenantId}
       and head.file_id = ${fileId}
  `);
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`MSG005 FileParent head is missing for ${fileId}.`);
  }
  return row;
}

async function countMessageAttachmentAnchors(
  db: HuleeDatabase,
  messageId: string
): Promise<number> {
  const result = await db.execute<{ count: number }>(sql`
    select count(*)::integer as count
      from inbox_v2_message_attachment_anchors
     where tenant_id = ${tenantId}
       and owner_message_id = ${messageId}
  `);
  return result.rows[0]?.count ?? 0;
}

function namespaceFixture<T>(value: T, suffix: string): T {
  return namespaceValue(value, `${suffix}-${runId}`) as T;
}

function namespaceValue(value: unknown, suffix: string): unknown {
  if (typeof value === "string") {
    if (value === "tenant:tenant-1") return tenantId;
    if (
      !value.startsWith("core:") &&
      !value.startsWith("module:") &&
      /^[a-z][a-z0-9_]*:[A-Za-z0-9]/u.test(value)
    ) {
      return `${value}-${suffix}`;
    }
    return value;
  }
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => namespaceValue(item, suffix));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      namespaceValue(item, suffix)
    ])
  );
}

function position(value: string) {
  return inboxV2BigintCounterSchema.parse(value);
}
