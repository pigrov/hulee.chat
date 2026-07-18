import {
  INBOX_V2_CONVERSATION_SYSTEM_EVENT_PAYLOAD_SCHEMA_ID,
  INBOX_V2_CONVERSATION_SYSTEM_EVENT_PAYLOAD_SCHEMA_VERSION,
  INBOX_V2_MESSAGE_SCHEMA_ID,
  INBOX_V2_MESSAGE_SCHEMA_VERSION,
  INBOX_V2_EXTERNAL_MESSAGE_SCHEMA_VERSION,
  INBOX_V2_SOURCE_OCCURRENCE_RESOLUTION_COMMIT_SCHEMA_ID,
  INBOX_V2_SOURCE_OCCURRENCE_SCHEMA_ID,
  INBOX_V2_SYSTEM_EVENT_TIMELINE_CREATION_COMMIT_SCHEMA_ID,
  INBOX_V2_SYSTEM_EVENT_TIMELINE_CREATION_COMMIT_SCHEMA_VERSION,
  INBOX_V2_TIMELINE_ITEM_SCHEMA_ID,
  INBOX_V2_TIMELINE_SCHEMA_VERSION,
  INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS,
  inboxV2BigintCounterSchema,
  inboxV2CatalogIdSchema,
  inboxV2ClientIdSchema,
  inboxV2ClientMergeDecisionSchema,
  inboxV2ClientMergeRedirectIdSchema,
  inboxV2ClientMergeTrustedServiceIdSchema,
  inboxV2ConversationClientLinkDecisionSchema,
  inboxV2ConversationClientLinkIdSchema,
  inboxV2ConversationClientLinkSchema,
  inboxV2ConversationClientLinkTransitionIdSchema,
  inboxV2ConversationParticipantSchema,
  inboxV2EntityRevisionSchema,
  inboxV2MessageCreationCommitSchema,
  inboxV2MessageIdSchema,
  inboxV2MessageMutationCommitSchema,
  inboxV2MessageProviderLifecycleOperationCreationCommitSchema,
  inboxV2MessageProviderLifecycleTransitionCommitSchema,
  inboxV2MessageReactionCommitSchema,
  inboxV2MessageTransportAssociationCommitSchema,
  inboxV2MessageTransportFactCommitSchema,
  inboxV2NamespacedIdSchema,
  inboxV2ParticipantMembershipEpisodeIdSchema,
  inboxV2ParticipantMembershipReasonIdSchema,
  inboxV2ParticipantMembershipTransitionIdSchema,
  inboxV2ReactionSemanticSlotKeyFor,
  inboxV2SchemaVersionTokenSchema,
  inboxV2Sha256DigestSchema,
  inboxV2SourceIdentityObjectKindIdSchema,
  inboxV2SourceIdentityRealmIdSchema,
  inboxV2SourceAccountIdSchema,
  inboxV2SourceOccurrenceMaterializationCommitSchema,
  inboxV2SourceOccurrenceResolutionCommitSchema,
  inboxV2SourceThreadBindingSchema,
  inboxV2StaffNoteCreationCommitSchema,
  inboxV2StaffNoteMutationCommitSchema,
  inboxV2SourceThreadBindingCreationCommitSchema,
  inboxV2SourceThreadBindingIdSchema,
  inboxV2SystemEventTimelineCreationCommitSchema,
  inboxV2OutboundRouteSchema,
  inboxV2OutboxIntentIdSchema,
  inboxV2ThreadRoutePolicySchema,
  inboxV2TimelineContentHeadOf,
  inboxV2TimelineContentSchema,
  inboxV2TenantIdSchema,
  type EventId,
  type InboxV2ClientId,
  type InboxV2ConversationId,
  type InboxV2EmployeeId,
  type InboxV2MessageCreationCommit,
  type InboxV2SystemEventTimelineCreationCommit
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  fixtureAdapterContract,
  fixtureBindingReference,
  fixtureExternalMessageReference,
  fixtureExternalReference,
  fixtureExternalTargetRoute,
  fixtureExternalThreadMapping,
  fixtureHuleeCreationCommit,
  fixtureInternalCreationCommit,
  fixtureMessageReference,
  fixtureOccurrence,
  fixtureOccurrenceResolutionCommit,
  fixtureOutboundBindingSnapshot,
  fixtureParticipant,
  fixtureProviderSemanticOrderingCommit,
  fixtureProviderSemanticProof,
  fixtureReference,
  fixtureSourceAccountReference,
  fixtureSourceConnectionReference,
  fixtureSourceIdentityReference,
  fixtureSourceOccurrenceReference,
  fixtureSourceCreationCommit,
  fixtureT0,
  fixtureT1,
  fixtureT2,
  fixtureT3,
  fixtureTimelineItem,
  fixtureTransportLink
} from "../../../contracts/src/inbox-v2/timeline-message-fixtures.type-fixture";
import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import { createSqlEmployeeDirectoryRepository } from "./sql-employee-directory-repository";
import { createSqlInboxV2ClientMergeRepository } from "./sql-inbox-v2-client-merge-repository";
import { createSqlInboxV2ConversationClientLinkRepository } from "./sql-inbox-v2-conversation-client-link-repository";
import { createSqlInboxV2ConversationRepository } from "./sql-inbox-v2-conversation-repository";
import { createSqlInboxV2ExternalThreadRepository } from "./sql-inbox-v2-external-thread-repository";
import {
  computeInboxV2LeafHashDigest,
  computeInboxV2TenantStreamManifestDigest,
  createSqlInboxV2AuthorizedCommandCoordinator,
  type WithInboxV2AuthorizedCommandMutationInput
} from "./sql-inbox-v2-authorization-repository";
import {
  buildCompareAndSwapInboxV2SourceOccurrenceResolutionSql,
  buildInsertInboxV2ExternalMessageReferenceSql,
  buildInsertInboxV2OutboundDispatchSql,
  buildInsertInboxV2OutboundRouteSql,
  buildInsertInboxV2SourceOccurrenceResolutionTransitionSql,
  createSqlInboxV2OutboundTransportRepository,
  deriveInboxV2SourceOccurrenceResolutionTransitionId
} from "./sql-inbox-v2-outbound-transport-repository";
import { createSqlInboxV2SourceExternalIdentityRepository } from "./sql-inbox-v2-source-external-identity-repository";
import { createSqlInboxV2SourceOccurrenceRepository } from "./sql-inbox-v2-source-occurrence-repository";
import { createSqlInboxV2SourceThreadBindingRepository } from "./sql-inbox-v2-source-thread-binding-repository";
import { createSqlInboxV2ParticipantMembershipRepository } from "./sql-inbox-v2-participant-membership-repository";
import {
  buildAdvanceInboxV2TimelineContentSql,
  buildAdvanceInboxV2MessageReactionSlotHeadSql,
  buildAdvanceInboxV2MessageReactionSql,
  buildAdvanceInboxV2MessageSql,
  buildAdvanceInboxV2ProviderLifecycleOperationSql,
  buildAdvanceInboxV2ProviderSemanticOrderingHeadSql,
  buildAdvanceInboxV2TimelineConversationHeadSql,
  buildAdvanceInboxV2TimelineItemSql,
  buildInsertInboxV2ActionAttributionSql,
  buildInsertInboxV2MessageReactionSql,
  buildInsertInboxV2MessageReactionTransitionSql,
  buildInsertInboxV2MessageReferenceCanonicalTargetsSql,
  buildInsertInboxV2MessageReferenceContextSql,
  buildInsertInboxV2MessageReferenceExternalTargetsSql,
  buildInsertInboxV2MessageRevisionSql,
  buildInsertInboxV2MessageSql,
  buildInsertInboxV2OutboundRouteConsumptionSql,
  buildInsertInboxV2ProviderReactionObservationSql,
  buildInsertInboxV2ProviderLifecycleTransitionSql,
  buildInsertInboxV2TimelineContentContactValuesSql,
  buildInsertInboxV2TimelineContentPayloadSql,
  buildInsertInboxV2TimelineContentRevisionSql,
  buildInsertInboxV2TimelineContentSql,
  buildInsertInboxV2TimelineItemSql,
  buildPurgeInboxV2TimelineContentPayloadSql,
  computeInboxV2TimelineMessageCommitDigest,
  createSqlInboxV2TimelineMessageRepository,
  prepareInboxV2MessageCreation,
  sealInboxV2PreparedMessageCreation
} from "./sql-inbox-v2-timeline-message-repository";
import type {
  InboxV2MessageTransportFactCommit,
  InboxV2TimelineMessageTransactionExecutor
} from "./sql-inbox-v2-timeline-message-repository";
import {
  INBOX_V2_SYSTEM_EVENT_TIMELINE_COMMAND_TYPE_ID,
  INBOX_V2_SYSTEM_EVENT_TIMELINE_PERMISSION_ID,
  prepareInboxV2SystemEventTimelineCreation,
  sealInboxV2PreparedSystemEventTimelineCreation
} from "./sql-inbox-v2-timeline-system-event-repository";
import type { RawSqlExecutor } from "./sql-outbox-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const tenantId = inboxV2TenantIdSchema.parse(`tenant:db005-${runId}`);
const t3 = "2026-07-11T09:03:00.000Z";
const tClientLink = "2026-07-11T09:04:00.000Z";
const tLeave = "2026-07-11T09:05:00.000Z";
const tDeactivate = "2026-07-11T09:06:00.000Z";
const tMergeResolved = "2026-07-11T09:07:00.000Z";
const tMergeCommitted = "2026-07-11T09:08:00.000Z";
const t4 = "2026-07-11T10:00:00.000Z";
const clientMergeResolverId = inboxV2ClientMergeTrustedServiceIdSchema.parse(
  "core:client-merge-resolver"
);

describe("SQL Inbox V2 timeline/message PostgreSQL fixtures", () => {
  it("builds contract-valid lifecycle and cross-ledger race commits", () => {
    const creation = creationCommit("contract-lifecycle");
    const edit = editMutation(creation, "contract-edit", "Edited", "e");
    expect(privacyMutation(edit, "contract-privacy")).toMatchObject({
      revision: { change: { kind: "privacy_erasure_tombstone" } }
    });
    const referenceTarget = creationCommit("contract-reference-target");
    const reply = replyCreationCommit(
      referenceTarget,
      "contract-reference-reply"
    );
    expect(reply.message.referenceContext).toMatchObject({
      kind: "reply",
      target: { state: "resolved_internal" }
    });
    expect(
      retentionMutation(
        editMutation(reply, "contract-retention-edit", "Retained", "9"),
        "contract-retention"
      )
    ).toMatchObject({
      revision: { change: { kind: "retention_purge_tombstone" } }
    });

    for (const suffix of ["contract-delivery", "contract-receipt"] as const) {
      const sourceCreation = sourceOutboundCreationCommit(suffix);
      const sourceOccurrence = requireSourceOccurrence(sourceCreation);
      const sourceConnection = namespaceFixture(
        fixtureSourceConnectionReference,
        suffix
      );
      const sourceAccountIdentity = sourceAccountIdentityFixture({
        sourceAccount: sourceOccurrence.bindingContext.sourceAccount,
        sourceConnection,
        adapterContract: sourceOccurrence.descriptor.adapterContract,
        suffix
      });
      expect(
        sourceThreadBindingCreationCommit({
          creation: sourceCreation,
          sourceConnection,
          sourceAccountIdentity,
          bindingEvidence: {
            tenantId,
            kind: "raw_inbound_event",
            id: `raw_inbound_event:db005-binding-${suffix}-${runId}`
          }
        }).initialProjection.binding
      ).toMatchObject({ revision: "1", bindingGeneration: "1" });
      const commit =
        suffix === "contract-delivery"
          ? deliveryFactCommit(
              suffix,
              sourceCreation,
              `transport:${suffix}-${runId}`
            )
          : receiptFactCommit(
              suffix,
              sourceCreation,
              `transport:${suffix}-${runId}`
            );
      expect(commit.fact.kind).toBe(
        suffix === "contract-delivery" ? "delivery" : "receipt"
      );
    }

    const providerReactionMessage = sourceOutboundCreationCommit(
      "contract-provider-reaction"
    );
    const providerReactionSet = providerObservedReactionSetCommit(
      providerReactionMessage,
      "contract-provider-reaction",
      "👍"
    );
    expect(
      competingProviderObservedReactionCommit(
        providerReactionSet,
        "contract-provider-reaction-stale"
      ).providerObservation?.orderingCommit.before
    ).toBeNull();
    expect(
      advancedProviderObservedReactionCommit(
        providerReactionSet,
        "contract-provider-reaction-successor",
        "🔥",
        additionalProviderOccurrenceResolution(
          providerReactionMessage,
          "contract-provider-reaction-successor-evidence"
        ).after
      )
    ).toMatchObject({
      transition: { operation: "replace", resultingRevision: "2" },
      providerObservation: {
        orderingCommit: { after: { position: "2", revision: "2" } }
      },
      afterReaction: { revision: "2" },
      slotHeadAfter: { revision: "2" }
    });

    const providerResultMessage = sourceOutboundCreationCommit(
      "contract-provider-result"
    );
    const rawProviderResultRoute = fixtureExternalTargetRoute(
      "core:message.reaction.set",
      "core:message.reaction.set_external"
    );
    const providerResultRoute = inboxV2OutboundRouteSchema.parse(
      namespaceFixture(rawProviderResultRoute, "contract-provider-result")
    );
    const providerResultBinding = inboxV2SourceThreadBindingSchema.parse(
      namespaceFixture(
        fixtureOutboundBindingSnapshot(
          rawProviderResultRoute,
          "module:synthetic:reactions"
        ),
        "contract-provider-result"
      )
    );
    const providerResultRequest = providerResultExternalRequestCommit(
      providerResultMessage,
      namespaceFixture(
        fixtureParticipant("employee"),
        "contract-provider-result"
      ),
      providerResultRoute,
      providerResultBinding,
      "contract-provider-result-request"
    );
    const providerResultTerminal = providerResultTerminalReactionCommit(
      providerResultRequest,
      "contract-provider-result-terminal"
    );
    expect(providerResultTerminal).toMatchObject({
      transition: {
        mode: "provider_result",
        externalAuthority: null,
        resultingRevision: "2"
      },
      afterReaction: {
        state: { kind: "external_terminal", outcome: "failed" },
        revision: "2"
      },
      slotHeadAfter: { revision: "2" }
    });
    expect(
      inboxV2MessageReactionCommitSchema.safeParse(
        tamperedProviderResultReactionCommit(providerResultTerminal)
      ).success
    ).toBe(false);
  });
});

describePostgres(
  "SQL Inbox V2 timeline/message repository (PostgreSQL)",
  () => {
    let db: HuleeDatabase;
    let acceptedAtomicSource:
      | {
          creation: InboxV2MessageCreationCommit;
          authorized: ReturnType<typeof authorizedSourceMaterializationFixture>;
          context: Awaited<ReturnType<typeof seedExternalCreationAnchors>>;
        }
      | undefined;

    beforeAll(async () => {
      db = createHuleeDatabase();
      const readiness = await db.execute<{
        messages: string | null;
        revisions: string | null;
        factLedger: string | null;
        semanticOrderingHeads: string | null;
      }>(sql`
      select
        to_regclass('public.inbox_v2_messages')::text as messages,
        to_regclass('public.inbox_v2_message_revisions')::text as revisions,
        to_regclass('public.inbox_v2_message_transport_fact_commits')::text
          as "factLedger",
        to_regclass('public.inbox_v2_provider_semantic_ordering_heads')::text
          as "semanticOrderingHeads"
    `);
      const ready = readiness.rows[0];
      if (
        ready?.messages === null ||
        ready?.revisions === null ||
        ready?.factLedger === null ||
        ready?.semanticOrderingHeads === null
      ) {
        throw new Error("Inbox V2 DB005 PostgreSQL tables are not migrated.");
      }
      await db.execute(sql`
      insert into tenants (id, slug, display_name, deployment_type)
      values (
        ${tenantId}, ${`db005-${runId}`},
        'DB005 timeline/message repository tenant', 'saas_shared'
      )
    `);
    });

    afterAll(async () => {
      if (!db) return;
      await closeHuleeDatabase(db);
    });

    it("atomically seals a source-originated Message with its source, stream, event and outbox closure", async () => {
      const suffix = "atomic-source-seal";
      const creation = inboxV2MessageCreationCommitSchema.parse(
        namespaceFixture(fixtureSourceCreationCommit(), suffix)
      );
      const context = await seedExternalCreationAnchors(db, creation, suffix);
      const operator = await seedProviderResultOperator(db, creation, suffix);
      const authorized = authorizedSourceMaterializationFixture({
        creation,
        operator,
        suffix
      });
      await db.transaction(async (transaction) => {
        // The existing Conversation anchor already consumes position 1. Seed
        // the matching historical stream checkpoint without replaying a second
        // synthetic command through the acceptance's coordinator under test.
        await transaction.execute(
          sql`set local session_replication_role = replica`
        );
        await transaction.execute(sql`
          insert into inbox_v2_tenant_stream_heads (
            tenant_id, stream_epoch, last_position, min_retained_position,
            revision, created_at, updated_at
          ) values (
            ${tenantId}, ${authorized.streamEpoch}, 1, 0, 1,
            ${creation.timelineAllocation.conversationBefore.createdAt},
            ${creation.timelineAllocation.conversationBefore.createdAt}
          )
        `);
        await transaction.execute(
          sql`set local session_replication_role = origin`
        );
      });

      const coordinator = createSqlInboxV2AuthorizedCommandCoordinator(db);
      let failAfterSeal = true;
      const materialize = () =>
        coordinator.withAuthorizedAtomicMaterialization(
          authorized.input,
          async (context) => {
            const prepared = await prepareInboxV2MessageCreation(context, {
              commit: creation
            });
            if (prepared.kind !== "ready") {
              throw new Error(
                `Atomic source Message preparation failed: ${prepared.kind}`
              );
            }
            return prepared.capability;
          },
          async (context, capability) => {
            const sealed = await sealInboxV2PreparedMessageCreation(context, {
              capability
            });
            if (failAfterSeal) {
              throw new Error("injected failure after source Message seal");
            }
            return {
              result: { messageId: sealed.message.id },
              receipt: sealed.receipt
            };
          }
        );

      await expect(materialize()).rejects.toThrow(
        "injected failure after source Message seal"
      );
      expect(
        await loadAtomicSourceMaterializationState(db, creation, authorized)
      ).toEqual({
        commands: "0",
        stream_commits: "0",
        stream_position: "1",
        changes: "0",
        events: "0",
        outbox_intents: "0",
        outbox_work: "0",
        messages: "0",
        timeline_items: "0",
        timeline_contents: "0",
        message_revisions: "0",
        external_references: "0",
        resolution_transitions: "0",
        source_resolution_materializations: "0",
        transport_links: "0",
        occurrence_state: "pending",
        occurrence_revision: "1",
        occurrence_reference_id: null
      });

      failAfterSeal = false;
      await expect(materialize()).resolves.toMatchObject({
        kind: "applied",
        result: { messageId: creation.message.id },
        status: { streamPosition: "2" }
      });
      expect(
        await loadAtomicSourceMaterializationState(db, creation, authorized)
      ).toEqual({
        commands: "1",
        stream_commits: "1",
        stream_position: "2",
        changes: "2",
        events: "2",
        outbox_intents: "2",
        outbox_work: "2",
        messages: "1",
        timeline_items: "1",
        timeline_contents: "1",
        message_revisions: "1",
        external_references: "1",
        resolution_transitions: "1",
        source_resolution_materializations: "1",
        transport_links: "1",
        occurrence_state: "resolved",
        occurrence_revision: "2",
        occurrence_reference_id: creation.externalMessageReference?.id ?? null
      });
      const expectedOccurrenceChange = authorized.input.records.changes.find(
        ({ entity }) => entity.entityTypeId === "core:source-occurrence"
      );
      const expectedOccurrenceEvent = authorized.input.records.events.find(
        ({ typeId }) => typeId === "core:source-occurrence.changed"
      );
      if (
        expectedOccurrenceChange === undefined ||
        expectedOccurrenceChange.state.kind !== "upsert" ||
        expectedOccurrenceEvent === undefined
      ) {
        throw new Error(
          "Atomic source fixture requires its occurrence change and event."
        );
      }
      const occurrenceClosure = await db.execute<{
        audience: string;
        state_hash: string;
        event_type_id: string;
        event_occurred_at: string;
      }>(sql`
        select change_row.audience::text as audience,
               change_row.state_hash,
               event_row.type_id as event_type_id,
               to_char(
                 event_row.occurred_at at time zone 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
               ) as event_occurred_at
          from inbox_v2_tenant_stream_changes change_row
          join inbox_v2_domain_events event_row
            on event_row.tenant_id = change_row.tenant_id
           and event_row.stream_commit_id = change_row.stream_commit_id
           and event_row.change_ids ? change_row.id
         where change_row.tenant_id = ${tenantId}
           and change_row.id = ${expectedOccurrenceChange.id}
      `);
      expect(occurrenceClosure.rows).toEqual([
        {
          audience: "policy_filtered",
          state_hash: expectedOccurrenceChange.state.stateHash,
          event_type_id: "core:source-occurrence.changed",
          event_occurred_at: expectedOccurrenceEvent.occurredAt
        }
      ]);
      acceptedAtomicSource = { creation, authorized, context };
    });

    it("atomically seals, rolls back, replays and deduplicates a Conversation-bound system TimelineItem", async () => {
      const accepted = requireAcceptedAtomicSource(acceptedAtomicSource);
      const suffix = "atomic-system-timeline";
      const anchor = creationCommit(suffix);
      await seedCreationAnchors(db, anchor);
      const fixture = systemEventTimelineFixture({
        conversationBefore: anchor.timelineAllocation.conversationBefore,
        suffix
      });
      const item = fixture.commit.timelineAllocation.items[0]!;
      await seedSystemTimelineSourceEvent(db, fixture);
      const authorized = authorizedSystemTimelineMaterializationFixture({
        commit: fixture.commit,
        suffix,
        streamEpoch: accepted.authorized.streamEpoch
      });
      const coordinator = createSqlInboxV2AuthorizedCommandCoordinator(db);
      let failAfterSeal = true;
      const materialize = () =>
        coordinator.withAuthorizedAtomicMaterialization(
          authorized.input,
          async (context) => {
            const prepared = await prepareInboxV2SystemEventTimelineCreation(
              context,
              {
                commit: fixture.commit
              }
            );
            if (prepared.kind !== "ready") {
              throw new Error(
                `System TimelineItem preparation failed: ${prepared.kind}`
              );
            }
            return prepared.capability;
          },
          async (context, capability) => {
            const sealed = await sealInboxV2PreparedSystemEventTimelineCreation(
              context,
              {
                capability
              }
            );
            if (failAfterSeal) {
              throw new Error(
                "injected failure after system TimelineItem seal"
              );
            }
            return {
              result: { timelineItemId: sealed.timelineItem.id },
              receipt: sealed.receipt
            };
          }
        );

      await expect(materialize()).rejects.toThrow(
        "injected failure after system TimelineItem seal"
      );
      expect(
        await loadAtomicSystemTimelineState(db, fixture, authorized)
      ).toEqual({
        commands: "0",
        stream_commits: "0",
        stream_position: "2",
        changes: "0",
        events: "0",
        outbox_intents: "0",
        timeline_items: "0",
        subject_details: "0",
        latest_sequence: "0",
        head_revision: "1",
        occurred_at: null,
        received_at: null,
        created_at: null
      });

      failAfterSeal = false;
      await expect(materialize()).resolves.toMatchObject({
        kind: "applied",
        result: {
          timelineItemId: fixture.commit.timelineAllocation.items[0]!.id
        },
        status: { streamPosition: "3" }
      });
      const committedState = await loadAtomicSystemTimelineState(
        db,
        fixture,
        authorized
      );
      expect(committedState).toEqual({
        commands: "1",
        stream_commits: "1",
        stream_position: "3",
        changes: "1",
        events: "1",
        outbox_intents: "1",
        timeline_items: "1",
        subject_details: "1",
        latest_sequence: "1",
        head_revision: "2",
        occurred_at: fixture.commit.source.occurredAt,
        received_at: fixture.commit.source.recordedAt,
        created_at: fixture.commit.timelineAllocation.committedAt
      });

      const sourceRewriteError = await capturePostgresError(
        db.execute(sql`
          update event_store
             set payload = payload || '{"fact":{"kind":"rewritten"}}'::jsonb
           where tenant_id = ${tenantId}
             and id = ${fixture.commit.source.event.id}
        `)
      );
      expect(postgresSqlState(sourceRewriteError)).toBe("23514");
      expect(postgresErrorText(sourceRewriteError)).toContain(
        "inbox_v2.referenced_system_event_immutable"
      );

      const duplicateItemId = `timeline_item:db005-system-duplicate-raw-${runId}`;
      const duplicateEventError = await capturePostgresError(
        db.transaction(async (transaction) => {
          await transaction.execute(sql`
            insert into inbox_v2_timeline_items (
              tenant_id, id, conversation_id, timeline_sequence,
              subject_kind, subject_id, visibility, activity_kind,
              activity_reason_id, occurred_at, received_at, revision,
              last_changed_stream_position, created_at, updated_at
            ) values (
              ${tenantId}, ${duplicateItemId}, ${item.conversation.id}, 2,
              'system_event', ${fixture.commit.source.event.id},
              'workforce_metadata', 'non_activity', 'core:system-metadata',
              ${fixture.commit.source.occurredAt},
              ${fixture.commit.source.recordedAt}, 1, 4,
              ${fixture.commit.timelineAllocation.committedAt},
              ${fixture.commit.timelineAllocation.committedAt}
            )
          `);
          await transaction.execute(sql`
            insert into inbox_v2_timeline_subject_details (
              tenant_id, timeline_item_id, subject_kind, system_event_id,
              system_actor_id, system_app_actor_kind,
              system_app_trusted_service_id, record_revision, created_at
            ) values (
              ${tenantId}, ${duplicateItemId}, 'system_event',
              ${fixture.commit.source.event.id}, 'core:timeline-system',
              'trusted_service', 'core:timeline-runtime', 1,
              ${fixture.commit.timelineAllocation.committedAt}
            )
          `);
        })
      );
      expect(postgresSqlState(duplicateEventError)).toBe("23505");
      expect(postgresErrorText(duplicateEventError)).toContain(
        "inbox_v2_timeline_subject_details_system_event_unique"
      );

      await expect(
        coordinator.withAuthorizedAtomicMaterialization(
          authorized.input,
          async () => {
            throw new Error("system replay must skip prepare");
          },
          async () => {
            throw new Error("system replay must skip seal");
          }
        )
      ).resolves.toMatchObject({
        kind: "already_applied",
        status: { streamPosition: "3" }
      });
      expect(
        await loadAtomicSystemTimelineState(db, fixture, authorized)
      ).toEqual(committedState);

      const current = await createSqlInboxV2ConversationRepository(db).findById(
        {
          tenantId,
          conversationId: anchor.message.conversation.id
        }
      );
      if (current === null) {
        throw new Error("System TimelineItem Conversation disappeared.");
      }
      const duplicate = systemEventTimelineFixture({
        conversationBefore: current.aggregate,
        suffix: `${suffix}-duplicate`,
        source: fixture
      });
      const duplicateAuthorized =
        authorizedSystemTimelineMaterializationFixture({
          commit: duplicate.commit,
          suffix: `${suffix}-duplicate`,
          streamEpoch: accepted.authorized.streamEpoch,
          resourceHeadId: authorized.resourceHeadId
        });
      await expect(
        coordinator.withAuthorizedAtomicMaterialization(
          duplicateAuthorized.input,
          async (context) => {
            const prepared = await prepareInboxV2SystemEventTimelineCreation(
              context,
              {
                commit: duplicate.commit
              }
            );
            if (
              prepared.kind === "conflict" &&
              prepared.code === "timeline_item.identity_conflict"
            ) {
              throw new Error("duplicate system event rejected");
            }
            throw new Error(`Unexpected duplicate result: ${prepared.kind}`);
          },
          async () => {
            throw new Error("duplicate system event must not seal");
          }
        )
      ).rejects.toThrow("duplicate system event rejected");
      expect(
        await loadAtomicSystemTimelineState(db, fixture, authorized)
      ).toEqual(committedState);
    });

    it("serializes real authorized inbound, provider-native outbound and system creation paths on one Conversation", async () => {
      const suffix = "authorized-timeline-race";
      const inbound = inboxV2MessageCreationCommitSchema.parse(
        namespaceFixture(fixtureSourceCreationCommit(), `${suffix}-inbound`)
      );
      const context = await seedExternalCreationAnchors(
        db,
        inbound,
        `${suffix}-inbound`
      );
      const operator = await seedProviderResultOperator(
        db,
        inbound,
        `${suffix}-inbound`
      );
      const providerNativeOutbound = providerNativeOutboundCreationCommit({
        anchor: inbound,
        suffix: `${suffix}-native-outbound`
      });
      await seedAdditionalSourceCreationOccurrence({
        db,
        creation: providerNativeOutbound,
        context,
        suffix: `${suffix}-native-outbound`
      });
      const system = systemEventTimelineFixture({
        conversationBefore: inbound.timelineAllocation.conversationBefore,
        suffix: `${suffix}-system`
      });
      await seedSystemTimelineSourceEvent(db, system);

      const requestedStreamEpoch = `stream-epoch:${suffix}-${runId}`;
      await db.transaction(async (transaction) => {
        await transaction.execute(
          sql`set local session_replication_role = replica`
        );
        await transaction.execute(sql`
          insert into inbox_v2_tenant_stream_heads (
            tenant_id, stream_epoch, last_position, min_retained_position,
            revision, created_at, updated_at
          ) values (
            ${tenantId}, ${requestedStreamEpoch}, 1, 0, 1,
            ${inbound.timelineAllocation.committedAt},
            ${inbound.timelineAllocation.committedAt}
          )
          on conflict (tenant_id) do nothing
        `);
        await transaction.execute(
          sql`set local session_replication_role = origin`
        );
      });
      const streamBefore = await db.execute<{
        last_position: string;
        stream_epoch: string;
      }>(sql`
        select last_position::text as last_position, stream_epoch
          from inbox_v2_tenant_stream_heads
         where tenant_id = ${tenantId}
      `);
      const previousStreamPosition = streamBefore.rows[0]?.last_position;
      const streamEpoch = streamBefore.rows[0]?.stream_epoch;
      if (previousStreamPosition === undefined || streamEpoch === undefined) {
        throw new Error("Timeline race requires an existing tenant stream.");
      }

      const inboundAuthorized = authorizedSourceMaterializationFixture({
        creation: inbound,
        operator,
        suffix: `${suffix}-inbound`,
        streamEpoch
      });
      const outboundAuthorized = authorizedSourceMaterializationFixture({
        creation: providerNativeOutbound,
        operator,
        resourceHeadId: inboundAuthorized.resourceHeadId,
        streamEpoch,
        suffix: `${suffix}-native-outbound`
      });
      const systemAuthorized = authorizedSystemTimelineMaterializationFixture({
        commit: system.commit,
        resourceHeadId: inboundAuthorized.resourceHeadId,
        streamEpoch,
        suffix: `${suffix}-system`
      });
      await db.execute(sql`
        insert into inbox_v2_auth_resource_heads (
          tenant_id, id, resource_kind, conversation_id,
          resource_access_revision, structural_relation_revision,
          collaborator_set_revision, revision, created_at, updated_at
        ) values (
          ${tenantId}, ${inboundAuthorized.resourceHeadId}, 'conversation',
          ${inbound.message.conversation.id}, 1, 1, 1, 1,
          ${inbound.timelineAllocation.committedAt},
          ${inbound.timelineAllocation.committedAt}
        )
      `);
      const coordinator = createSqlInboxV2AuthorizedCommandCoordinator(db);
      const revisionConflict = Symbol("timeline-race-revision-conflict");

      const attemptMessage = async (
        creation: InboxV2MessageCreationCommit,
        authorized: ReturnType<typeof authorizedSourceMaterializationFixture>,
        afterPrepared?: () => Promise<void>
      ) => {
        try {
          const result = await coordinator.withAuthorizedAtomicMaterialization(
            authorized.input,
            async (authorizedContext) => {
              const prepared = await prepareInboxV2MessageCreation(
                authorizedContext,
                { commit: creation }
              );
              if (
                prepared.kind === "conflict" &&
                prepared.code === "revision.conflict"
              ) {
                throw revisionConflict;
              }
              if (prepared.kind !== "ready") {
                throw new Error(
                  `Timeline race Message preparation failed: ${prepared.kind}`
                );
              }
              await afterPrepared?.();
              return prepared.capability;
            },
            async (authorizedContext, capability) => {
              const sealed = await sealInboxV2PreparedMessageCreation(
                authorizedContext,
                { capability }
              );
              return {
                result: { timelineItemId: sealed.timelineItem.id },
                receipt: sealed.receipt
              };
            }
          );
          return { kind: "result" as const, result };
        } catch (error) {
          if (error === revisionConflict) {
            return { kind: "revision_conflict" as const };
          }
          throw error;
        }
      };
      const attemptSystem = async (
        fixture: SystemEventTimelineFixture,
        authorized: ReturnType<
          typeof authorizedSystemTimelineMaterializationFixture
        >
      ) => {
        try {
          const result = await coordinator.withAuthorizedAtomicMaterialization(
            authorized.input,
            async (authorizedContext) => {
              const prepared = await prepareInboxV2SystemEventTimelineCreation(
                authorizedContext,
                { commit: fixture.commit }
              );
              if (
                prepared.kind === "conflict" &&
                prepared.code === "revision.conflict"
              ) {
                throw revisionConflict;
              }
              if (prepared.kind !== "ready") {
                throw new Error(
                  `Timeline race system preparation failed: ${prepared.kind}`
                );
              }
              return prepared.capability;
            },
            async (authorizedContext, capability) => {
              const sealed =
                await sealInboxV2PreparedSystemEventTimelineCreation(
                  authorizedContext,
                  { capability }
                );
              return {
                result: { timelineItemId: sealed.timelineItem.id },
                receipt: sealed.receipt
              };
            }
          );
          return { kind: "result" as const, result };
        } catch (error) {
          if (error === revisionConflict) {
            return { kind: "revision_conflict" as const };
          }
          throw error;
        }
      };

      let signalInboundPrepared!: () => void;
      const inboundPrepared = new Promise<void>((resolve) => {
        signalInboundPrepared = resolve;
      });
      let releaseInbound!: () => void;
      const inboundRelease = new Promise<void>((resolve) => {
        releaseInbound = resolve;
      });
      const inboundAttempt = attemptMessage(
        inbound,
        inboundAuthorized,
        async () => {
          signalInboundPrepared();
          await inboundRelease;
        }
      );
      await inboundPrepared;
      const outboundAttempt = attemptMessage(
        providerNativeOutbound,
        outboundAuthorized
      );
      const systemAttempt = attemptSystem(system, systemAuthorized);
      await Promise.resolve();
      releaseInbound();

      const [inboundResult, outboundConflict, systemConflict] =
        await Promise.all([inboundAttempt, outboundAttempt, systemAttempt]);
      if (inboundResult.kind !== "result") {
        throw new Error(
          `Unexpected timeline race winner: ${JSON.stringify({
            inboundResult,
            outboundConflict,
            systemConflict
          })}`
        );
      }
      expect(inboundResult).toMatchObject({
        kind: "result",
        result: {
          kind: "applied",
          result: {
            timelineItemId: inbound.timelineAllocation.items[0]!.id
          }
        }
      });
      expect(outboundConflict).toEqual({ kind: "revision_conflict" });
      expect(systemConflict).toEqual({ kind: "revision_conflict" });

      const conversationRepository = createSqlInboxV2ConversationRepository(db);
      const afterInbound = await conversationRepository.findById({
        tenantId,
        conversationId: inbound.message.conversation.id
      });
      if (afterInbound === null) {
        throw new Error("Timeline race Conversation disappeared.");
      }
      const rebuiltOutbound = rebaseMessageCreationCommit(
        providerNativeOutbound,
        afterInbound.aggregate
      );
      const rebuiltOutboundAuthorized = authorizedSourceMaterializationFixture({
        creation: rebuiltOutbound,
        operator,
        resourceHeadId: inboundAuthorized.resourceHeadId,
        streamEpoch,
        suffix: `${suffix}-native-outbound`
      });
      await expect(
        attemptMessage(rebuiltOutbound, rebuiltOutboundAuthorized)
      ).resolves.toMatchObject({
        kind: "result",
        result: {
          kind: "applied",
          result: {
            timelineItemId: rebuiltOutbound.timelineAllocation.items[0]!.id
          }
        }
      });

      const afterOutbound = await conversationRepository.findById({
        tenantId,
        conversationId: inbound.message.conversation.id
      });
      if (afterOutbound === null) {
        throw new Error("Timeline race Conversation disappeared.");
      }
      const rebuiltSystem = {
        ...system,
        commit: rebaseSystemEventTimelineCommit(
          system.commit,
          afterOutbound.aggregate
        )
      };
      const rebuiltSystemAuthorized =
        authorizedSystemTimelineMaterializationFixture({
          commit: rebuiltSystem.commit,
          resourceHeadId: inboundAuthorized.resourceHeadId,
          streamEpoch,
          suffix: `${suffix}-system`
        });
      await expect(
        attemptSystem(rebuiltSystem, rebuiltSystemAuthorized)
      ).resolves.toMatchObject({
        kind: "result",
        result: {
          kind: "applied",
          result: {
            timelineItemId: rebuiltSystem.commit.timelineAllocation.items[0]!.id
          }
        }
      });

      const inboundOccurrence = requireSourceOccurrence(inbound);
      const outboundOccurrence = requireSourceOccurrence(rebuiltOutbound);
      const timeline = await db.execute<{
        id: string;
        last_changed_stream_position: string;
        occurred_at: string;
        received_at: string;
        timeline_sequence: string;
      }>(sql`
        select item.id, item.timeline_sequence::text as timeline_sequence,
               item.last_changed_stream_position::text
                 as last_changed_stream_position,
               to_char(item.occurred_at at time zone 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as occurred_at,
               to_char(item.received_at at time zone 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as received_at
          from inbox_v2_timeline_items item
         where item.tenant_id = ${tenantId}
           and item.conversation_id = ${inbound.message.conversation.id}
         order by item.timeline_sequence
      `);
      const firstPosition = String(BigInt(previousStreamPosition) + 1n);
      const secondPosition = String(BigInt(previousStreamPosition) + 2n);
      const thirdPosition = String(BigInt(previousStreamPosition) + 3n);
      expect(timeline.rows).toEqual([
        {
          id: inbound.timelineAllocation.items[0]!.id,
          timeline_sequence: "1",
          last_changed_stream_position: firstPosition,
          occurred_at: inboundOccurrence.observedAt,
          received_at: inboundOccurrence.recordedAt
        },
        {
          id: rebuiltOutbound.timelineAllocation.items[0]!.id,
          timeline_sequence: "2",
          last_changed_stream_position: secondPosition,
          occurred_at: outboundOccurrence.observedAt,
          received_at: outboundOccurrence.recordedAt
        },
        {
          id: rebuiltSystem.commit.timelineAllocation.items[0]!.id,
          timeline_sequence: "3",
          last_changed_stream_position: thirdPosition,
          occurred_at: rebuiltSystem.commit.source.occurredAt,
          received_at: rebuiltSystem.commit.source.recordedAt
        }
      ]);

      const sourceClocks = await db.execute<{
        id: string;
        observed_at: string;
        provider_timestamp: string;
        recorded_at: string;
      }>(sql`
        select occurrence.id,
               to_char(occurrence.observed_at at time zone 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as observed_at,
               to_char(occurrence.recorded_at at time zone 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as recorded_at,
               to_char(provider_clock.timestamp at time zone 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as provider_timestamp
          from inbox_v2_source_occurrences occurrence
          join inbox_v2_source_occurrence_provider_timestamps provider_clock
            on provider_clock.tenant_id = occurrence.tenant_id
           and provider_clock.source_occurrence_id = occurrence.id
         where occurrence.tenant_id = ${tenantId}
           and occurrence.id in (${inboundOccurrence.id}, ${outboundOccurrence.id})
         order by occurrence.id
      `);
      expect(sourceClocks.rows).toEqual(
        [inboundOccurrence, outboundOccurrence]
          .map((occurrence) => ({
            id: occurrence.id,
            observed_at: occurrence.observedAt,
            recorded_at: occurrence.recordedAt,
            provider_timestamp: occurrence.providerTimestamps[0]!.timestamp
          }))
          .sort((left, right) => left.id.localeCompare(right.id))
      );
      expect(
        outboundOccurrence.providerTimestamps[0]!.timestamp <
          inboundOccurrence.providerTimestamps[0]!.timestamp
      ).toBe(true);

      const streamClosure = await db.execute<{
        id: string;
        stream_position: string;
      }>(sql`
        select stream_commit.id,
               stream_commit.position::text as stream_position
          from inbox_v2_tenant_stream_commits stream_commit
         where stream_commit.tenant_id = ${tenantId}
           and stream_commit.id in (
             ${inboundAuthorized.streamCommitId},
             ${rebuiltOutboundAuthorized.streamCommitId},
             ${rebuiltSystemAuthorized.streamCommitId}
           )
         order by stream_commit.position
      `);
      expect(streamClosure.rows).toEqual([
        {
          id: inboundAuthorized.streamCommitId,
          stream_position: firstPosition
        },
        {
          id: rebuiltOutboundAuthorized.streamCommitId,
          stream_position: secondPosition
        },
        {
          id: rebuiltSystemAuthorized.streamCommitId,
          stream_position: thirdPosition
        }
      ]);
      const finalHead = await db.execute<{
        latest_timeline_sequence: string;
        stream_position: string;
      }>(sql`
        select conversation_head.latest_timeline_sequence::text
                 as latest_timeline_sequence,
               stream_head.last_position::text as stream_position
          from inbox_v2_conversation_heads conversation_head
          join inbox_v2_tenant_stream_heads stream_head
            on stream_head.tenant_id = conversation_head.tenant_id
         where conversation_head.tenant_id = ${tenantId}
           and conversation_head.conversation_id = ${inbound.message.conversation.id}
      `);
      expect(finalHead.rows).toEqual([
        {
          latest_timeline_sequence: "3",
          stream_position: thirdPosition
        }
      ]);
    });

    it("rejects a coherent duplicate SourceOccurrence projection in the deferred database closure", async () => {
      const fixture = requireAcceptedAtomicSource(acceptedAtomicSource);
      const occurrenceChange = fixture.authorized.input.records.changes.find(
        ({ entity }) => entity.entityTypeId === "core:source-occurrence"
      );
      const occurrenceEvent = fixture.authorized.input.records.events.find(
        ({ typeId }) => typeId === "core:source-occurrence.changed"
      );
      const occurrenceProjection =
        fixture.authorized.input.records.outboxIntents.find(
          (intent) =>
            intent.effectClass === "projection" &&
            intent.eventId === occurrenceEvent?.id
        );
      if (
        occurrenceChange === undefined ||
        occurrenceEvent === undefined ||
        occurrenceProjection === undefined
      ) {
        throw new Error(
          "Atomic source fixture requires its SourceOccurrence projection closure."
        );
      }
      const duplicateProjection = {
        ...occurrenceProjection,
        id: inboxV2OutboxIntentIdSchema.parse(
          `outbox-intent:atomic-source-projection-duplicate-${runId}`
        ),
        ordinal: fixture.authorized.input.records.outboxIntents.length + 1,
        handlerId: inboxV2NamespacedIdSchema.parse(
          "core:source-occurrence-projection-duplicate"
        ),
        consumerDedupeKey: inboxV2Sha256DigestSchema.parse(
          atomicSourceSha256(
            `atomic-source-projection-duplicate-dedupe-${runId}`
          )
        ),
        intentHash: inboxV2Sha256DigestSchema.parse(
          atomicSourceSha256(
            `atomic-source-projection-duplicate-intent-${runId}`
          )
        )
      };

      const error = await capturePostgresError(
        insertCoherentDuplicateProjectionAndRecheckDomainClosure(
          db,
          fixture.authorized.input,
          duplicateProjection
        )
      );
      expect(postgresSqlState(error)).toBe("23514");
      expect(postgresErrorText(error)).toContain(
        "inbox_v2.domain_mutation_stream_child_mismatch"
      );
      const persisted = await db.execute<{ count: string }>(sql`
        select count(*)::text as count
          from inbox_v2_outbox_intents
         where tenant_id = ${tenantId}
           and id = ${duplicateProjection.id}
      `);
      expect(persisted.rows).toEqual([{ count: "0" }]);
    });

    it("rejects a cross-wired source-resolution materialization", async () => {
      const fixture = requireAcceptedAtomicSource(acceptedAtomicSource);
      const suffix = "atomic-source-forged-post-fact-ledger";
      const additionalResolution = additionalProviderOccurrenceResolution(
        fixture.creation,
        suffix
      );
      const additionalOccurrence =
        await seedAdditionalProviderSemanticOccurrence({
          db,
          creation: fixture.creation,
          context: fixture.context,
          resolution: additionalResolution,
          suffix
        });
      const originOccurrence = requireSourceOccurrence(fixture.creation);
      const transitionId =
        deriveInboxV2SourceOccurrenceResolutionTransitionId(
          additionalResolution
        );

      const error = await capturePostgresError(
        db.transaction(async (transaction) => {
          await transaction.execute(sql`
            insert into inbox_v2_atomic_source_resolution_materializations (
              tenant_id, source_occurrence_id, resolution_transition_id,
              external_message_reference_id, message_id, mutation_id,
              stream_commit_id, stream_position, resulting_revision, created_at
            )
            select source_materialization.tenant_id,
                   ${additionalOccurrence.id},
                   ${transitionId},
                   ${fixture.creation.externalMessageReference!.id},
                   ${fixture.creation.message.id},
                   source_materialization.mutation_id,
                   source_materialization.stream_commit_id,
                   source_materialization.stream_position,
                   ${additionalOccurrence.revision},
                   source_materialization.created_at
              from inbox_v2_atomic_source_resolution_materializations
                source_materialization
             where source_materialization.tenant_id = ${tenantId}
               and source_materialization.source_occurrence_id =
                 ${originOccurrence.id}
          `);
          await transaction.execute(sql`set constraints all immediate`);
        })
      );
      expect(postgresSqlState(error)).toBe("23514");
      expect(postgresErrorText(error)).toContain(
        "inbox_v2.atomic_source_resolution_closure_missing"
      );
      const persisted = await db.execute<{ count: string }>(sql`
        select count(*)::text as count
          from inbox_v2_atomic_source_resolution_materializations
         where tenant_id = ${tenantId}
           and source_occurrence_id = ${additionalOccurrence.id}
      `);
      expect(persisted.rows).toEqual([{ count: "0" }]);
    });

    it("rejects a standalone fresh Message written without its atomic producer closure", async () => {
      const suffix = "atomic-raw-message-inverse";
      const creation = creationCommit(suffix);
      await seedCrossFeatureCreationAnchors(db, creation, suffix);
      const repository = createSqlInboxV2TimelineMessageRepository(db);

      const error = await capturePostgresError(
        repository.createMessage({
          commit: creation,
          streamPosition: position("10")
        })
      );
      expect(postgresSqlState(error)).toBe("23514");
      expect(postgresErrorText(error)).toContain(
        "inbox_v2.atomic_message_creation_closure_missing"
      );
      const persisted = await db.execute<{ count: string }>(sql`
        select count(*)::text as count
          from inbox_v2_messages
         where tenant_id = ${tenantId}
           and id = ${creation.message.id}
      `);
      expect(persisted.rows).toEqual([{ count: "0" }]);
    });

    it("purges classified payloads for privacy erasure while preserving immutable history and safe event metadata", async () => {
      const creation = creationCommit("privacy");
      await seedCrossFeatureCreationAnchors(db, creation, "privacy");
      const repository = createSqlInboxV2TimelineMessageRepository(db);

      await expect(
        historicalTimelineFixtureRepository(db).createMessage({
          commit: creation,
          streamPosition: position("10")
        })
      ).resolves.toMatchObject({
        kind: "created",
        envelope: { streamPosition: "10", entityRevision: "1" }
      });
      const edit = editMutation(creation, "privacy-edit", "Private", "b");
      await expect(
        repository.mutateMessage({
          commit: edit,
          streamPosition: position("11")
        })
      ).resolves.toMatchObject({
        kind: "applied",
        envelope: { streamPosition: "11", entityRevision: "2" }
      });
      expect(
        await loadLifecycleRowCounts(
          db,
          creation.message.id,
          creation.content.id
        )
      ).toMatchObject({
        contact_count: "1",
        content_revision_count: "2",
        message_revision_count: "2",
        payload_count: "3"
      });

      const availableContactDeleteError = await capturePostgresError(
        db.transaction(async (transaction) => {
          await transaction.execute(sql`
            delete from inbox_v2_timeline_content_contact_values
             where tenant_id = ${tenantId}
               and content_id = ${creation.content.id}
          `);
          await transaction.execute(sql`set constraints all immediate`);
        })
      );
      expect(postgresSqlState(availableContactDeleteError)).toBe("23514");
      expect(postgresErrorText(availableContactDeleteError)).toContain(
        "inbox_v2.timeline_content_head_coherence"
      );

      const availablePayloadDeleteError = await capturePostgresError(
        db.transaction(async (transaction) => {
          await transaction.execute(
            buildPurgeInboxV2TimelineContentPayloadSql({
              tenantId,
              contentId: creation.content.id
            })
          );
          await transaction.execute(sql`set constraints all immediate`);
        })
      );
      expect(postgresSqlState(availablePayloadDeleteError)).toBe("23514");
      expect(postgresErrorText(availablePayloadDeleteError)).toContain(
        "inbox_v2.timeline_content_head_coherence"
      );
      expect(
        await loadLifecycleRowCounts(
          db,
          creation.message.id,
          creation.content.id
        )
      ).toMatchObject({ contact_count: "1", payload_count: "3" });

      const privacy = privacyMutation(edit, "privacy-erasure");
      const privacyEvent = privacy.contentTransition?.transition.event;
      if (privacyEvent === undefined) {
        throw new Error("Expected a privacy tombstone event.");
      }
      const privacyEventMetadata = {
        actionKind: "privacy_erasure",
        entityKind: "timeline_content",
        entityId: creation.content.id,
        requestId: `privacy_request:db005-${runId}`,
        reasonId: "core:privacy_request"
      };
      await db.execute(sql`
        insert into event_store (
          id, tenant_id, type, version, occurred_at, idempotency_key,
          payload, created_at, updated_at
        ) values (
          ${privacyEvent.id}, ${tenantId}, 'inbox_v2.content.privacy_erased',
          'v1', ${t4}, ${`db005-privacy-${runId}`},
          ${JSON.stringify(privacyEventMetadata)}::jsonb,
          ${t4}, ${t4}
        )
      `);
      await expect(
        repository.mutateMessage({
          commit: privacy,
          streamPosition: position("12")
        })
      ).resolves.toMatchObject({
        kind: "applied",
        message: {
          revision: "3",
          authorParticipant: creation.message.authorParticipant,
          content: { stateKind: "privacy_erased" }
        },
        envelope: { streamPosition: "12", entityRevision: "3" }
      });

      const [content, history, rowCounts, event] = await Promise.all([
        repository.findTimelineContent({
          tenantId,
          contentId: creation.content.id
        }),
        repository.listMessageHistory({
          tenantId,
          messageId: creation.message.id,
          afterRevision: null,
          limit: 10
        }),
        loadLifecycleRowCounts(db, creation.message.id, creation.content.id),
        db.execute<{ payload: Record<string, unknown> }>(sql`
          select payload
            from event_store
           where tenant_id = ${tenantId}
             and id = ${privacyEvent.id}
        `)
      ]);

      expect(content).toMatchObject({
        revision: "3",
        state: {
          kind: "privacy_erased",
          reasonId: "core:privacy_request",
          erasedAt: t4
        }
      });
      expect(rowCounts).toMatchObject({
        contact_count: "0",
        content_revision_count: "3",
        message_revision_count: "3",
        payload_count: "0"
      });
      if (history === null)
        throw new Error("Expected privacy Message history.");
      expect(history.revisions.map((item) => item.messageRevision)).toEqual([
        "1",
        "2",
        "3"
      ]);
      expect(history.revisions.map((item) => item.change.kind)).toEqual([
        "created",
        "edited",
        "privacy_erasure_tombstone"
      ]);
      expect(history.revisions[0]?.actionAttribution.actionParticipant).toEqual(
        creation.message.authorParticipant
      );
      expect(history.revisions[2]?.actionAttribution).toMatchObject({
        actionParticipant: null,
        appActor: {
          kind: "trusted_service",
          trustedServiceId: "core:privacy-worker"
        }
      });
      expect(event.rows[0]?.payload).toEqual(privacyEventMetadata);
      expect(collectJsonKeys(event.rows[0]?.payload)).not.toEqual(
        expect.arrayContaining([
          "body",
          "content",
          "payload",
          "providerPayload",
          "raw",
          "rawPayload",
          "text"
        ])
      );
    });

    it("rejects a raw gap in immutable content revision history and rolls the orphan revision back", async () => {
      const suffix = "content-history-gap";
      const creation = creationCommit(suffix);
      await seedCreationAnchors(db, creation);
      const repository = createSqlInboxV2TimelineMessageRepository(db);
      await expect(
        historicalTimelineFixtureRepository(db).createMessage({
          commit: creation,
          streamPosition: position("20")
        })
      ).resolves.toMatchObject({ kind: "created" });
      const edit = editMutation(
        creation,
        `${suffix}-edit`,
        "Gap baseline",
        "7"
      );
      await expect(
        repository.mutateMessage({
          commit: edit,
          streamPosition: position("21")
        })
      ).resolves.toMatchObject({ kind: "applied" });
      const gapContent = inboxV2TimelineContentSchema.parse({
        ...edit.contentTransition!.after,
        revision: "4",
        updatedAt: t4
      });

      const gapError = await capturePostgresError(
        db.transaction(async (transaction) => {
          await transaction.execute(
            buildInsertInboxV2TimelineContentRevisionSql({
              tenantId,
              content: gapContent,
              transitionKind: "edit",
              expectedPreviousRevision: inboxV2EntityRevisionSchema.parse("3"),
              eventId: `event:db005-${suffix}-gap-${runId}`,
              occurredAt: t4,
              recordedAt: t4,
              streamPosition: position("22")
            })
          );
          await transaction.execute(sql`set constraints all immediate`);
        })
      );
      expect(postgresSqlState(gapError)).toBe("23514");
      expect(postgresErrorText(gapError)).toContain(
        "inbox_v2.timeline_content_revision_history_coherence"
      );
      expect(
        await loadLifecycleRowCounts(
          db,
          creation.message.id,
          creation.content.id
        )
      ).toMatchObject({
        content_revision_count: "2",
        message_revision_count: "2"
      });
    });

    it("rejects a StaffNote successor whose matching content revision has a different occurrence clock", async () => {
      const suffix = "staff-note-content-clock";
      const anchors = creationCommit(`${suffix}-anchors`);
      await seedCreationAnchors(db, anchors);
      const creation = staffNoteCreationCommit(anchors, suffix);
      await insertRawStaffNoteCreation(db, creation, position("30"));
      const edit = staffNoteEditMutation(creation, `${suffix}-edit`);
      const clockError = await capturePostgresError(
        insertRawStaffNoteEdit(db, edit, position("31"), {
          contentOccurredAt: fixtureT2
        })
      );
      expect(postgresSqlState(clockError)).toBe("23514");
      expect(postgresErrorText(clockError)).toContain(
        "inbox_v2.staff_note_revision_history_coherence"
      );
      const rows = await db.execute<{
        content_revision: string;
        content_revision_count: string;
        note_revision: string;
        note_revision_count: string;
      }>(sql`
        select note_row.revision::text as note_revision,
               content_row.revision::text as content_revision,
               (
                 select count(*)::text
                   from inbox_v2_staff_note_revisions revision_row
                  where revision_row.tenant_id = ${tenantId}
                    and revision_row.staff_note_id = ${creation.staffNote.id}
               ) as note_revision_count,
               (
                 select count(*)::text
                   from inbox_v2_timeline_content_revisions revision_row
                  where revision_row.tenant_id = ${tenantId}
                    and revision_row.content_id = ${creation.content.id}
               ) as content_revision_count
          from inbox_v2_staff_notes note_row
          join inbox_v2_timeline_contents content_row
            on content_row.tenant_id = note_row.tenant_id
           and content_row.id = note_row.content_id
         where note_row.tenant_id = ${tenantId}
           and note_row.id = ${creation.staffNote.id}
      `);
      expect(rows.rows[0]).toEqual({
        content_revision: "1",
        content_revision_count: "1",
        note_revision: "1",
        note_revision_count: "1"
      });
    });

    it("retains immutable author, resolved reply and history across leave, deactivation, Client merge and retention purge", async () => {
      const referenceTarget = creationCommit("lifecycle-target");
      const creation = replyCreationCommit(referenceTarget, "lifecycle");
      const anchors = await seedCrossFeatureCreationAnchors(
        db,
        referenceTarget,
        "lifecycle"
      );
      const repository = createSqlInboxV2TimelineMessageRepository(db);

      const targetCreated = await historicalTimelineFixtureRepository(
        db
      ).createMessage({
        commit: referenceTarget,
        streamPosition: position("100")
      });
      expect(targetCreated).toMatchObject({
        kind: "created",
        envelope: { streamPosition: "100", entityRevision: "1" }
      });
      const created = await historicalTimelineFixtureRepository(
        db
      ).createMessage({
        commit: creation,
        streamPosition: position("101")
      });
      expect(created).toMatchObject({
        kind: "created",
        envelope: { streamPosition: "101", entityRevision: "1" }
      });

      const replay = await repository.createMessage({
        commit: creation,
        streamPosition: position("999")
      });
      expect(replay).toMatchObject({
        kind: "already_applied",
        envelope: { streamPosition: "101", entityRevision: "1" }
      });

      const edit = editMutation(creation, "edit", "Edited", "e");
      const edited = await repository.mutateMessage({
        commit: edit,
        streamPosition: position("102")
      });
      expect(edited).toMatchObject({
        kind: "applied",
        envelope: { streamPosition: "102", entityRevision: "2" }
      });

      const editReplay = await repository.mutateMessage({
        commit: edit,
        streamPosition: position("998")
      });
      expect(editReplay).toMatchObject({
        kind: "already_applied",
        envelope: { streamPosition: "102", entityRevision: "2" }
      });

      const beforeStaleCounts = await loadLifecycleRowCounts(
        db,
        creation.message.id,
        creation.content.id
      );
      expect(beforeStaleCounts).toMatchObject({
        contact_count: "1",
        content_revision_count: "2",
        message_revision_count: "2",
        payload_count: "3"
      });
      const staleCollision = editMutation(
        creation,
        "edit",
        "Competing stale edit",
        "f"
      );
      const stale = await repository.mutateMessage({
        commit: staleCollision,
        streamPosition: position("103")
      });
      expect(stale).toMatchObject({
        kind: "conflict",
        code: "message.state_conflict"
      });
      expect(
        await loadLifecycleRowCounts(
          db,
          creation.message.id,
          creation.content.id
        )
      ).toEqual(beforeStaleCounts);

      const clientGraph = await seedClientMergeRoots(db, "lifecycle");
      const linkResult = await linkConversationToClient(db, {
        conversationId: creation.message.conversation.id,
        clientId: clientGraph.sourceClientId,
        actorEmployeeId: anchors.employeeId,
        suffix: "lifecycle"
      });
      expect(linkResult).toMatchObject({
        kind: "applied",
        transition: {
          expectedRevision: null,
          currentRevision: null,
          resultingRevision: "1"
        }
      });

      const participantRepository =
        createSqlInboxV2ParticipantMembershipRepository(db);
      const left = await participantRepository.transitionEpisode({
        tenantId,
        conversationId: anchors.conversationId,
        episodeId: anchors.episodeId,
        transitionId: inboxV2ParticipantMembershipTransitionIdSchema.parse(
          `participant_membership_transition:db005-lifecycle-leave-${runId}`
        ),
        intent: "leave",
        nextRole: null,
        cause: {
          kind: "hulee_internal_command",
          actorEmployee: {
            tenantId,
            kind: "employee",
            id: anchors.employeeId
          }
        },
        reasonCodeId: inboxV2ParticipantMembershipReasonIdSchema.parse(
          "core:membership-left"
        ),
        expectedMembershipRevision: anchors.membershipRevision,
        expectedEpisodeRevision: anchors.episodeRevision,
        occurredAt: tLeave
      });
      expect(left).toMatchObject({
        kind: "updated",
        record: {
          conversationMembershipRevision: "2",
          episode: {
            state: "left",
            revision: "2",
            validTo: tLeave
          }
        }
      });

      const employeeRepository = createSqlEmployeeDirectoryRepository(db);
      await employeeRepository.deactivateEmployee({
        tenantId,
        employeeId: anchors.employeeId,
        deactivatedAt: new Date(tDeactivate),
        events: [
          {
            id: `event:db005-lifecycle-employee-deactivated-${runId}` as EventId,
            type: "employee.deactivated",
            version: "v1",
            tenantId,
            occurredAt: tDeactivate,
            idempotencyKey: `db005-lifecycle-employee-deactivated-${runId}`,
            payload: { employeeId: anchors.employeeId }
          }
        ]
      });

      const clientMergeRepository = createSqlInboxV2ClientMergeRepository(db);
      const merged = await clientMergeRepository.mergeRoots({
        tenantId,
        redirectId: inboxV2ClientMergeRedirectIdSchema.parse(
          `client_merge_redirect:db005-lifecycle-${runId}`
        ),
        sourceRootClientId: clientGraph.sourceClientId,
        targetRootClientId: clientGraph.targetClientId,
        expectedGraphRevision: null,
        resolverTrustedServiceId: clientMergeResolverId,
        resolvedAt: tMergeResolved,
        decision: inboxV2ClientMergeDecisionSchema.parse({
          actor: {
            kind: "trusted_service",
            trustedServiceId: clientMergeResolverId
          },
          policyId: "core:client-merge-manual",
          policyVersion: "v1",
          reasonCodeId: "core:duplicate-client"
        }),
        createdAt: tMergeCommitted
      });
      expect(merged).toMatchObject({
        kind: "merged",
        commit: {
          graphHeadAfter: { revision: "1" },
          sourceNodeAfter: {
            state: "redirected",
            nextClient: { id: clientGraph.targetClientId }
          }
        }
      });

      const retention = retentionMutation(edit, "retention");
      const retentionEvent = retention.contentTransition?.transition.event;
      if (retentionEvent === undefined) {
        throw new Error("Expected a retention tombstone event.");
      }
      const retentionEventMetadata = {
        actionKind: "retention_purge",
        entityKind: "timeline_content",
        entityId: creation.content.id,
        policyId: "core:message-content-retention",
        policyVersion: "v1",
        policyRevision: "4"
      };
      await db.execute(sql`
      insert into event_store (
        id, tenant_id, type, version, occurred_at, idempotency_key,
        payload, created_at, updated_at
      ) values (
        ${retentionEvent.id}, ${tenantId}, 'inbox_v2.content.retention_purged',
        'v1', ${t4}, ${`db005-retention-${runId}`},
        ${JSON.stringify(retentionEventMetadata)}::jsonb,
        ${t4}, ${t4}
      )
    `);
      const purged = await repository.mutateMessage({
        commit: retention,
        streamPosition: position("104")
      });
      expect(purged).toMatchObject({
        kind: "applied",
        message: {
          revision: "3",
          authorParticipant: creation.message.authorParticipant,
          referenceContext: creation.message.referenceContext,
          content: { stateKind: "retention_purged" }
        },
        envelope: { streamPosition: "104", entityRevision: "3" }
      });

      const [
        message,
        content,
        history,
        timeline,
        classifiedCounts,
        preservedAudit,
        genericEvent,
        participantAfter,
        episodeAfter,
        employeeAfter,
        canonicalClientAfter
      ] = await Promise.all([
        repository.findMessage({
          tenantId,
          messageId: creation.message.id
        }),
        repository.findTimelineContent({
          tenantId,
          contentId: creation.content.id
        }),
        repository.listMessageHistory({
          tenantId,
          messageId: creation.message.id,
          afterRevision: null,
          limit: 10
        }),
        repository.listTimeline({
          tenantId,
          conversationId: creation.message.conversation.id,
          anchor: { kind: "latest" },
          limit: 10
        }),
        db.execute<{
          payload_count: string;
          contact_count: string;
          opaque_count: string;
        }>(sql`
          select
            (
              select count(*)::text
                from inbox_v2_timeline_content_payloads payload_row
               where payload_row.tenant_id = ${tenantId}
                 and payload_row.content_id = ${creation.content.id}
            ) as payload_count,
            (
              select count(*)::text
                from inbox_v2_timeline_content_contact_values contact_row
               where contact_row.tenant_id = ${tenantId}
                 and contact_row.content_id = ${creation.content.id}
            ) as contact_count,
            (
              select count(*)::text
                from inbox_v2_provider_receipt_opaque_payloads opaque_row
                join inbox_v2_provider_receipt_observations receipt_row
                  on receipt_row.tenant_id = opaque_row.tenant_id
                 and receipt_row.id = opaque_row.receipt_observation_id
               where receipt_row.tenant_id = ${tenantId}
                 and receipt_row.target_message_id = ${creation.message.id}
            ) as opaque_count
        `),
        db.execute<{
          author_participant_id: string;
          revision_count: string;
          attribution_count: string;
          retention_event_count: string;
        }>(sql`
          select message_row.author_participant_id,
                 (
                   select count(*)::text
                     from inbox_v2_message_revisions revision_row
                    where revision_row.tenant_id = message_row.tenant_id
                      and revision_row.message_id = message_row.id
                 ) as revision_count,
                 (
                   select count(*)::text
                     from inbox_v2_action_attributions attribution_row
                    where attribution_row.tenant_id = message_row.tenant_id
                      and attribution_row.conversation_id =
                          message_row.conversation_id
                 ) as attribution_count,
                 (
                   select count(*)::text
                     from event_store event_row
                    where event_row.tenant_id = message_row.tenant_id
                      and event_row.id = ${retentionEvent.id}
                 ) as retention_event_count
            from inbox_v2_messages message_row
           where message_row.tenant_id = ${tenantId}
             and message_row.id = ${creation.message.id}
        `),
        db.execute<{ payload: Record<string, unknown> }>(sql`
          select payload
            from event_store
           where tenant_id = ${tenantId}
             and id = ${retentionEvent.id}
        `),
        participantRepository.findParticipantById({
          tenantId,
          participantId: anchors.participantId
        }),
        participantRepository.findEpisodeById({
          tenantId,
          episodeId: anchors.episodeId
        }),
        employeeRepository.findEmployee({
          tenantId,
          employeeId: anchors.employeeId
        }),
        clientMergeRepository.resolveCanonical({
          tenantId,
          clientId: clientGraph.sourceClientId,
          trustedServiceId: clientMergeResolverId,
          resolvedAt: t4
        })
      ]);

      expect(message).toMatchObject({
        id: creation.message.id,
        revision: "3",
        authorParticipant: creation.message.authorParticipant,
        referenceContext: creation.message.referenceContext,
        content: { stateKind: "retention_purged", contentRevision: "3" }
      });
      expect(message?.referenceContext).toEqual(
        creation.message.referenceContext
      );
      expect(content).toMatchObject({
        revision: "3",
        state: {
          kind: "retention_purged",
          policyId: "core:message-content-retention",
          policyVersion: "v1",
          policyRevision: "4"
        }
      });
      if (history === null) throw new Error("Expected Message history.");
      expect(history.revisions.map((item) => item.messageRevision)).toEqual([
        "1",
        "2",
        "3"
      ]);
      expect(history.revisions.map((item) => item.change.kind)).toEqual([
        "created",
        "edited",
        "retention_purge_tombstone"
      ]);
      expect(history.revisions[0]?.actionAttribution.actionParticipant).toEqual(
        creation.message.authorParticipant
      );
      expect(history.revisions[1]?.actionAttribution.actionParticipant).toEqual(
        creation.message.authorParticipant
      );
      expect(
        history.revisions[2]?.actionAttribution.actionParticipant
      ).toBeNull();
      expect(timeline.items).toHaveLength(2);
      expect(
        timeline.items.find(
          (item) => item.id === creation.timelineAllocation.items[0]?.id
        )
      ).toMatchObject({
        id: creation.timelineAllocation.items[0]?.id,
        revision: "3",
        subject: { kind: "message", messageRevision: "3" }
      });
      expect(classifiedCounts.rows[0]).toEqual({
        payload_count: "0",
        contact_count: "0",
        opaque_count: "0"
      });
      expect(preservedAudit.rows[0]).toMatchObject({
        author_participant_id: creation.message.authorParticipant.id,
        revision_count: "3",
        retention_event_count: "1"
      });
      expect(
        Number(preservedAudit.rows[0]?.attribution_count)
      ).toBeGreaterThanOrEqual(3);
      expect(genericEvent.rows[0]?.payload).toEqual(retentionEventMetadata);
      expect(collectJsonKeys(genericEvent.rows[0]?.payload)).not.toEqual(
        expect.arrayContaining([
          "body",
          "content",
          "payload",
          "providerPayload",
          "raw",
          "rawPayload",
          "text"
        ])
      );
      expect(participantAfter).toEqual(creation.authorParticipant);
      expect(episodeAfter).toMatchObject({
        id: anchors.episodeId,
        participant: { id: anchors.participantId },
        state: "left",
        validTo: tLeave,
        revision: "2"
      });
      expect(employeeAfter?.deactivatedAt?.toISOString()).toBe(tDeactivate);
      // Client canonicalization is deliberately unrelated to employee author
      // identity. This is a coupled negative proof that the adjacent DB002
      // graph transition cannot rewrite the Message or its immutable history.
      expect(canonicalClientAfter).toMatchObject({
        kind: "resolved",
        resolution: {
          requestedClient: { id: clientGraph.sourceClientId },
          canonicalClient: { id: clientGraph.targetClientId },
          graphHead: { revision: "1" }
        }
      });
    });

    it("atomically serializes a delivery/receipt token race across conversations and replays the winner's original position", async () => {
      const deliveryCreation = sourceOutboundCreationCommit("fact-delivery");
      const receiptCreation = sourceOutboundCreationCommit("fact-receipt");
      const deliveryContext = await seedExternalCreationAnchors(
        db,
        deliveryCreation,
        "fact-delivery"
      );
      await seedExternalCreationAnchors(db, receiptCreation, "fact-receipt");
      const repository = createSqlInboxV2TimelineMessageRepository(db);
      expect(
        await createSourceMessage(
          historicalTimelineFixtureRepository(db),
          deliveryCreation,
          "201"
        )
      ).toMatchObject({ kind: "created" });
      expect(
        await createSourceMessage(
          historicalTimelineFixtureRepository(db),
          receiptCreation,
          "202"
        )
      ).toMatchObject({ kind: "created" });

      expect(
        await repository.createMessage({
          commit: deliveryCreation,
          streamPosition: position("901")
        })
      ).toMatchObject({
        kind: "already_applied",
        envelope: { streamPosition: "201" }
      });
      const linkReplay = await repository.listMessageTransportLinks({
        tenantId,
        messageId: deliveryCreation.message.id,
        snapshotToken: null,
        cursor: null,
        limit: 10
      });
      expect(linkReplay).not.toBeNull();
      expect(linkReplay?.links).toHaveLength(1);
      expect(linkReplay?.head?.head).toMatchObject({
        linkCount: "1",
        latestLink: deliveryCreation.originTransportLinkHead?.latestLink
      });

      const missingMessageId = inboxV2MessageIdSchema.parse(
        `message:db005-missing-${runId}`
      );
      const [
        missingMessage,
        missingContent,
        missingLinks,
        missingReactions,
        missingFacts,
        missingLifecycle
      ] = await Promise.all([
        repository.findMessage({ tenantId, messageId: missingMessageId }),
        repository.findTimelineContent({
          tenantId,
          contentId: `timeline_content:db005-missing-${runId}`
        }),
        repository.listMessageTransportLinks({
          tenantId,
          messageId: missingMessageId,
          snapshotToken: null,
          cursor: null,
          limit: 10
        }),
        repository.listMessageReactions({
          tenantId,
          messageId: missingMessageId,
          snapshotToken: null,
          cursor: null,
          limit: 10
        }),
        repository.listMessageTransportFacts({
          tenantId,
          messageId: missingMessageId,
          snapshotToken: null,
          cursor: null,
          limit: 10
        }),
        repository.findProviderLifecycleOperation({
          tenantId,
          operationId: `message_provider_lifecycle_operation:db005-missing-${runId}`
        })
      ]);
      expect({
        missingMessage,
        missingContent,
        missingLinks,
        missingReactions,
        missingFacts,
        missingLifecycle
      }).toEqual({
        missingMessage: null,
        missingContent: null,
        missingLinks: null,
        missingReactions: null,
        missingFacts: null,
        missingLifecycle: null
      });

      const echoCommit = await seedProviderEchoAssociation({
        db,
        creation: deliveryCreation,
        context: deliveryContext,
        suffix: "fact-delivery"
      });
      expect(
        await repository.associateTransportOccurrence({
          commit: echoCommit,
          streamPosition: position("301")
        })
      ).toMatchObject({
        kind: "appended",
        envelope: { streamPosition: "301" }
      });
      expect(
        await repository.associateTransportOccurrence({
          commit: echoCommit,
          streamPosition: position("997")
        })
      ).toMatchObject({
        kind: "already_applied",
        envelope: { streamPosition: "301" }
      });
      const linksAfterEcho = await repository.listMessageTransportLinks({
        tenantId,
        messageId: deliveryCreation.message.id,
        snapshotToken: null,
        cursor: null,
        limit: 10
      });
      expect(linksAfterEcho?.links).toHaveLength(2);
      expect(linksAfterEcho?.links.map(({ link }) => link.role)).toEqual([
        "native_outbound",
        "provider_echo"
      ]);
      expect(linksAfterEcho?.head?.head).toMatchObject({
        linkCount: "2",
        latestLink: echoCommit.linkHeadAfter.latestLink,
        revision: "2"
      });

      const sharedToken = `transport:db005-race-${runId}`;
      const delivery = deliveryFactCommit(
        "fact-delivery",
        deliveryCreation,
        sharedToken
      );
      const receipt = receiptFactCommit(
        "fact-receipt",
        receiptCreation,
        sharedToken
      );
      const deliveryClient = await db.$client.connect();
      const receiptClient = await db.$client.connect();
      let results: Awaited<ReturnType<typeof repository.appendTransportFact>>[];
      try {
        const [deliveryPid, receiptPid] = await Promise.all([
          deliveryClient.query<{ pid: number }>(
            "select pg_backend_pid()::integer as pid"
          ),
          receiptClient.query<{ pid: number }>(
            "select pg_backend_pid()::integer as pid"
          )
        ]);
        expect(deliveryPid.rows[0]?.pid).toBeTypeOf("number");
        expect(receiptPid.rows[0]?.pid).toBeTypeOf("number");
        expect(deliveryPid.rows[0]?.pid).not.toBe(receiptPid.rows[0]?.pid);

        const barrier = createAsyncBarrier(2);
        const deliveryRepository = createBarrierScopedTimelineRepository(
          deliveryClient,
          barrier
        );
        const receiptRepository = createBarrierScopedTimelineRepository(
          receiptClient,
          barrier
        );
        results = await Promise.all([
          deliveryRepository.appendTransportFact({
            commit: delivery,
            streamPosition: position("501")
          }),
          receiptRepository.appendTransportFact({
            commit: receipt,
            streamPosition: position("502")
          })
        ]);
      } finally {
        deliveryClient.release();
        receiptClient.release();
      }
      expect(results.map((result) => result.kind).sort()).toEqual([
        "appended",
        "conflict"
      ]);
      expect(
        results.find((result) => result.kind === "conflict")
      ).toMatchObject({
        kind: "conflict",
        code: "message.transport_conflict"
      });

      const persisted = await db.execute<{
        fact_kind: "delivery" | "receipt";
        recorded_stream_position: string;
        delivery_count: string;
        receipt_count: string;
      }>(sql`
      select ledger.fact_kind, ledger.recorded_stream_position::text,
             count(delivery.id)::text as delivery_count,
             count(receipt.id)::text as receipt_count
        from inbox_v2_message_transport_fact_commits ledger
        left join inbox_v2_message_delivery_observations delivery
          on delivery.tenant_id = ledger.tenant_id
         and delivery.commit_token = ledger.commit_token
        left join inbox_v2_provider_receipt_observations receipt
          on receipt.tenant_id = ledger.tenant_id
         and receipt.commit_token = ledger.commit_token
       where ledger.tenant_id = ${tenantId}
         and ledger.commit_token = ${sharedToken}
       group by ledger.fact_kind, ledger.recorded_stream_position
    `);
      expect(persisted.rows).toHaveLength(1);
      const winner = persisted.rows[0];
      if (winner === undefined) throw new Error("Expected one fact winner.");
      expect(Number(winner.delivery_count) + Number(winner.receipt_count)).toBe(
        1
      );

      const winningCommit =
        winner.fact_kind === "delivery" ? delivery : receipt;
      const replay = await repository.appendTransportFact({
        commit: winningCommit,
        streamPosition: position("999")
      });
      expect(replay).toMatchObject({
        kind: "already_applied",
        envelope: { streamPosition: winner.recorded_stream_position }
      });

      const winningMessageId = winningCommit.beforeMessage.id;
      const facts = await repository.listMessageTransportFacts({
        tenantId,
        messageId: winningMessageId,
        snapshotToken: null,
        cursor: null,
        limit: 10
      });
      expect(facts?.facts).toHaveLength(1);
      expect(facts?.facts[0]).toMatchObject({
        projectionState: "available",
        fact: {
          kind: winner.fact_kind,
          observation: { id: winningCommit.fact.observation.id }
        }
      });
    });

    it("creates and replays an exact queued dispatch while rejecting missing, cross-wired and wrong-author creation graphs", async () => {
      const repository = createSqlInboxV2TimelineMessageRepository(db);
      const happySuffix = "hulee-external-dispatch-happy";
      const happyScaffold = sourceOutboundCreationCommit(happySuffix);
      const happyContext = await seedExternalCreationAnchors(
        db,
        happyScaffold,
        happySuffix,
        { includeMessageSendCapability: true }
      );
      const happyOperator = await seedProviderResultOperator(
        db,
        happyScaffold,
        happySuffix
      );
      const happyRoute = await seedMessageSendOutboundRoute({
        db,
        creation: happyScaffold,
        context: happyContext,
        operator: happyOperator,
        suffix: happySuffix
      });
      const happyCommit = huleeExternalCreationCommit({
        binding: happyContext.bindingProjection.binding,
        creation: happyScaffold,
        operator: happyOperator,
        route: happyRoute,
        suffix: happySuffix
      });
      await expect(
        historicalTimelineFixtureRepository(db).createMessage({
          commit: happyCommit,
          streamPosition: position("650")
        })
      ).resolves.toMatchObject({
        kind: "created",
        envelope: { streamPosition: "650", entityRevision: "1" }
      });
      const happyTransportState = {
        dispatch_count: "1",
        dispatch_state: "queued",
        dispatch_revision: "1",
        dispatch_message_id: happyCommit.message.id,
        dispatch_route_id: happyRoute.id,
        route_consumption_count: "1"
      };
      expect(
        await loadHuleeExternalCreationTransportState(
          db,
          happyCommit.message.id
        )
      ).toEqual(happyTransportState);
      await expect(
        repository.createMessage({
          commit: happyCommit,
          streamPosition: position("9650")
        })
      ).resolves.toMatchObject({
        kind: "already_applied",
        envelope: { streamPosition: "650", entityRevision: "1" }
      });
      expect(
        await loadHuleeExternalCreationTransportState(
          db,
          happyCommit.message.id
        )
      ).toEqual(happyTransportState);

      const invalidSuffix = "hulee-external-dispatch-invalid";
      const invalidScaffold = sourceOutboundCreationCommit(invalidSuffix);
      const invalidContext = await seedExternalCreationAnchors(
        db,
        invalidScaffold,
        invalidSuffix,
        { includeMessageSendCapability: true }
      );
      const invalidOperator = await seedProviderResultOperator(
        db,
        invalidScaffold,
        invalidSuffix
      );
      const invalidRoute = await seedMessageSendOutboundRoute({
        db,
        creation: invalidScaffold,
        context: invalidContext,
        operator: invalidOperator,
        suffix: invalidSuffix
      });
      const crossWireRoute = await seedMessageSendOutboundRoute({
        db,
        creation: invalidScaffold,
        context: invalidContext,
        operator: invalidOperator,
        routePolicy: invalidRoute.routePolicy,
        suffix: `${invalidSuffix}-cross-wire`
      });
      const invalidCommit = huleeExternalCreationCommit({
        binding: invalidContext.bindingProjection.binding,
        creation: invalidScaffold,
        operator: invalidOperator,
        route: invalidRoute,
        suffix: invalidSuffix
      });
      const invalidAttributionId = derivedInboxV2Id(
        "action_attribution",
        invalidCommit.initialRevision.id
      );

      const missingDispatchError = await captureLegacyMessageCreationError(
        db,
        async (transaction) => {
          await insertRawMessageCreationGraph(
            transaction,
            invalidCommit,
            position("660"),
            { includeDispatch: false }
          );
          await transaction.execute(sql`set constraints all immediate`);
        }
      );
      expect(postgresSqlState(missingDispatchError)).toBe("23514");
      expect(postgresErrorText(missingDispatchError)).toMatch(
        /inbox_v2\.message_dispatch_coherence/u
      );
      expect(await loadActionAttributionCount(db, invalidAttributionId)).toBe(
        0
      );
      await expect(
        repository.findMessage({
          tenantId,
          messageId: invalidCommit.message.id
        })
      ).resolves.toBeNull();

      if (invalidCommit.outboundDispatch === null) {
        throw new Error("Cross-wire case requires one queued dispatch.");
      }
      const crossWiredDispatch = {
        ...invalidCommit.outboundDispatch,
        route: {
          ...invalidCommit.outboundDispatch.route,
          id: crossWireRoute.id
        }
      };
      const crossWireError = await captureLegacyMessageCreationError(
        db,
        async (transaction) => {
          await insertRawMessageCreationGraph(
            transaction,
            invalidCommit,
            position("660"),
            { dispatch: crossWiredDispatch }
          );
          await transaction.execute(sql`set constraints all immediate`);
        }
      );
      expect(postgresSqlState(crossWireError)).toBe("23514");
      expect(postgresErrorText(crossWireError)).toMatch(
        /inbox_v2\.(?:message_creation_dispatch_mismatch|message_dispatch_coherence)/u
      );
      expect(await loadActionAttributionCount(db, invalidAttributionId)).toBe(
        0
      );
      await expect(
        repository.findMessage({
          tenantId,
          messageId: invalidCommit.message.id
        })
      ).resolves.toBeNull();

      const wrongAuthorAttribution = {
        ...invalidCommit.initialRevision.actionAttribution,
        actionParticipant: invalidScaffold.message.authorParticipant
      };
      const wrongAuthorError = await captureLegacyMessageCreationError(
        db,
        async (transaction) => {
          await insertRawMessageCreationGraph(
            transaction,
            invalidCommit,
            position("660"),
            { attribution: wrongAuthorAttribution }
          );
          await transaction.execute(sql`set constraints all immediate`);
        }
      );
      expect(postgresSqlState(wrongAuthorError)).toBe("23514");
      expect(postgresErrorText(wrongAuthorError)).toMatch(
        /inbox_v2\.message_head_coherence/u
      );
      expect(await loadActionAttributionCount(db, invalidAttributionId)).toBe(
        0
      );
      await expect(
        repository.findMessage({
          tenantId,
          messageId: invalidCommit.message.id
        })
      ).resolves.toBeNull();
    });

    it("rejects a raw resolved-external reply whose canonical and provider targets identify different Messages", async () => {
      const repository = createSqlInboxV2TimelineMessageRepository(db);
      const canonicalTarget = creationCommit("reply-target-canonical");
      await seedCreationAnchors(db, canonicalTarget);
      await expect(
        historicalTimelineFixtureRepository(db).createMessage({
          commit: canonicalTarget,
          streamPosition: position("670")
        })
      ).resolves.toMatchObject({ kind: "created" });

      const externalTarget = sourceOutboundCreationCommit(
        "reply-target-external"
      );
      await seedExternalCreationAnchors(
        db,
        externalTarget,
        "reply-target-external"
      );
      await expect(
        createSourceMessage(
          historicalTimelineFixtureRepository(db),
          externalTarget,
          "671"
        )
      ).resolves.toMatchObject({ kind: "created" });
      const externalMessageReference = externalTarget.externalMessageReference;
      const sourceOccurrence = externalTarget.sourceOccurrence;
      const reply = replyCreationCommit(
        canonicalTarget,
        "reply-target-identity-mismatch"
      );
      if (
        reply.message.referenceContext.kind !== "reply" ||
        reply.message.referenceContext.target.state === "unresolved_source" ||
        externalMessageReference === null ||
        sourceOccurrence === null
      ) {
        throw new Error(
          "Reply identity mismatch requires canonical and external targets."
        );
      }
      const mismatchedMessage = {
        ...reply.message,
        referenceContext: {
          kind: "reply" as const,
          target: {
            state: "resolved_external" as const,
            canonical: reply.message.referenceContext.target.canonical,
            external: {
              externalMessageReference: fixtureReference(
                "external_message_reference",
                externalMessageReference.id,
                tenantId
              ),
              sourceOccurrence: fixtureReference(
                "source_occurrence",
                sourceOccurrence.id,
                tenantId
              )
            }
          }
        }
      } as unknown as InboxV2MessageCreationCommit["message"];
      const replyAttributionId = derivedInboxV2Id(
        "action_attribution",
        reply.initialRevision.id
      );
      const identityError = await captureLegacyMessageCreationError(
        db,
        async (transaction) => {
          await insertRawMessageCreationGraph(
            transaction,
            reply,
            position("672"),
            { message: mismatchedMessage }
          );
          await transaction.execute(sql`set constraints all immediate`);
        }
      );
      expect(postgresSqlState(identityError)).toBe("23514");
      expect(postgresErrorText(identityError)).toMatch(
        /inbox_v2\.message_reply_target_identity_mismatch/u
      );
      expect(await loadActionAttributionCount(db, replyAttributionId)).toBe(0);
      await expect(
        repository.findMessage({ tenantId, messageId: reply.message.id })
      ).resolves.toBeNull();
    });

    it("replays, fences and recovers reactions plus provider lifecycle state", async () => {
      const repository = createSqlInboxV2TimelineMessageRepository(db);
      const foreignTenantId = inboxV2TenantIdSchema.parse(
        `tenant:db005-foreign-${runId}`
      );

      const reactionCreation = creationCommit("reaction-recovery");
      await seedCreationAnchors(db, reactionCreation);
      await expect(
        historicalTimelineFixtureRepository(db).createMessage({
          commit: reactionCreation,
          streamPosition: position("700")
        })
      ).resolves.toMatchObject({ kind: "created" });

      const setA = internalReactionSetCommit(
        reactionCreation,
        "reaction-a",
        "👍"
      );
      const setB = internalReactionSetCommit(
        reactionCreation,
        "reaction-b",
        "🔥"
      );
      await expect(
        repository.applyReaction({
          commit: setA,
          streamPosition: position("701")
        })
      ).resolves.toMatchObject({
        kind: "appended",
        envelope: { streamPosition: "701", entityRevision: "1" }
      });
      await expect(
        repository.applyReaction({
          commit: setA,
          streamPosition: position("9701")
        })
      ).resolves.toMatchObject({
        kind: "already_applied",
        envelope: { streamPosition: "701", entityRevision: "1" }
      });
      await expect(
        repository.applyReaction({
          commit: setB,
          streamPosition: position("702")
        })
      ).resolves.toMatchObject({ kind: "appended" });

      const firstReactionPage = await repository.listMessageReactions({
        tenantId,
        messageId: reactionCreation.message.id,
        snapshotToken: null,
        cursor: null,
        limit: 1
      });
      expect(firstReactionPage).not.toBeNull();
      expect(firstReactionPage?.reactions).toHaveLength(1);
      expect(firstReactionPage?.reactions[0]).toMatchObject({
        projectionState: "available",
        reaction: {
          id: setA.afterReaction.id,
          state: { kind: "active", value: { value: "👍" } },
          revision: "1"
        }
      });
      expect(firstReactionPage?.nextCursor).not.toBeNull();

      const clearB = internalReactionClearCommit(setB, "reaction-b-clear");
      await expect(
        repository.applyReaction({
          commit: clearB,
          streamPosition: position("703")
        })
      ).resolves.toMatchObject({
        kind: "appended",
        envelope: { streamPosition: "703", entityRevision: "2" }
      });
      await expect(
        repository.applyReaction({
          commit: clearB,
          streamPosition: position("9703")
        })
      ).resolves.toMatchObject({
        kind: "already_applied",
        envelope: { streamPosition: "703", entityRevision: "2" }
      });
      const staleClearB = internalReactionClearCommit(setB, "reaction-b-stale");
      await expect(
        repository.applyReaction({
          commit: staleClearB,
          streamPosition: position("704")
        })
      ).resolves.toMatchObject({
        kind: "conflict",
        code: "message.state_conflict"
      });

      const frozenSecondReactionPage = await repository.listMessageReactions({
        tenantId,
        messageId: reactionCreation.message.id,
        snapshotToken: firstReactionPage?.snapshotToken ?? null,
        cursor: firstReactionPage?.nextCursor ?? null,
        limit: 1
      });
      expect(frozenSecondReactionPage?.reactions).toHaveLength(1);
      expect(frozenSecondReactionPage?.reactions[0]).toMatchObject({
        projectionState: "available",
        reaction: {
          id: setB.afterReaction.id,
          state: { kind: "active", value: { value: "🔥" } },
          revision: "1"
        }
      });
      expect(frozenSecondReactionPage?.nextCursor).toBeNull();

      const currentReactions = await repository.listMessageReactions({
        tenantId,
        messageId: reactionCreation.message.id,
        snapshotToken: null,
        cursor: null,
        limit: 10
      });
      expect(currentReactions?.reactions).toHaveLength(2);
      expect(currentReactions?.reactions[1]).toMatchObject({
        projectionState: "available",
        reaction: {
          id: setB.afterReaction.id,
          state: { kind: "cleared", lastValue: { value: "🔥" } },
          revision: "2"
        }
      });
      await expect(
        repository.listMessageReactions({
          tenantId: foreignTenantId,
          messageId: reactionCreation.message.id,
          snapshotToken: null,
          cursor: null,
          limit: 10
        })
      ).resolves.toBeNull();

      const lifecycleMessage = sourceOutboundCreationCommit(
        "provider-lifecycle-recovery"
      );
      await seedExternalCreationAnchors(
        db,
        lifecycleMessage,
        "provider-lifecycle-recovery"
      );
      await expect(
        createSourceMessage(
          historicalTimelineFixtureRepository(db),
          lifecycleMessage,
          "710"
        )
      ).resolves.toMatchObject({ kind: "created" });
      const lifecycleCreation = providerObservedLifecycleCreationCommit(
        lifecycleMessage,
        "provider-lifecycle-recovery"
      );
      await expect(
        repository.createProviderLifecycleOperation({
          commit: lifecycleCreation,
          streamPosition: position("711")
        })
      ).resolves.toMatchObject({
        kind: "appended",
        envelope: { streamPosition: "711", entityRevision: "1" }
      });
      await expect(
        repository.createProviderLifecycleOperation({
          commit: lifecycleCreation,
          streamPosition: position("9711")
        })
      ).resolves.toMatchObject({
        kind: "already_applied",
        envelope: { streamPosition: "711", entityRevision: "1" }
      });

      const policyEventId = `event:db005-provider-policy-${runId}`;
      await db.execute(sql`
        insert into event_store (
          id, tenant_id, type, version, occurred_at, idempotency_key,
          payload, created_at, updated_at
        ) values (
          ${policyEventId}, ${tenantId},
          'inbox_v2.message.provider_delete_policy_decided', 'v1', ${t3},
          ${`db005-provider-policy-${runId}`},
          ${JSON.stringify({
            actionKind: "provider_delete_policy",
            entityKind: "message_provider_lifecycle_operation",
            entityId: lifecycleCreation.operation.id,
            effect: "tombstone_local"
          })}::jsonb,
          ${t3}, ${t3}
        )
      `);
      const lifecycleTransition = providerLifecyclePolicyTransitionCommit(
        lifecycleCreation,
        policyEventId,
        "tombstone_local",
        t3
      );
      await expect(
        repository.transitionProviderLifecycleOperation({
          commit: lifecycleTransition,
          streamPosition: position("712")
        })
      ).resolves.toMatchObject({
        kind: "appended",
        envelope: { streamPosition: "712", entityRevision: "2" }
      });
      await expect(
        repository.transitionProviderLifecycleOperation({
          commit: lifecycleTransition,
          streamPosition: position("9712")
        })
      ).resolves.toMatchObject({
        kind: "already_applied",
        envelope: { streamPosition: "712", entityRevision: "2" }
      });
      const staleLifecycleTransition = providerLifecyclePolicyTransitionCommit(
        lifecycleCreation,
        `event:db005-provider-policy-stale-${runId}`,
        "retain_local",
        t4
      );
      await expect(
        repository.transitionProviderLifecycleOperation({
          commit: staleLifecycleTransition,
          streamPosition: position("713")
        })
      ).resolves.toMatchObject({
        kind: "conflict",
        code: "message.state_conflict"
      });

      const recoveredLifecycle =
        await repository.findProviderLifecycleOperation({
          tenantId,
          operationId: lifecycleCreation.operation.id
        });
      expect(recoveredLifecycle).toMatchObject({
        operation: lifecycleTransition.after,
        initialOperation: lifecycleCreation.operation,
        createdStreamPosition: "711",
        lastChangedStreamPosition: "712"
      });
      const recoveredTransitions =
        await repository.listProviderLifecycleTransitions({
          tenantId,
          operationId: lifecycleCreation.operation.id,
          snapshotToken: null,
          cursor: null,
          limit: 1
        });
      expect(recoveredTransitions).toMatchObject({
        throughRevision: "2",
        transitions: [
          {
            transition: lifecycleTransition.transition,
            recordedStreamPosition: "712"
          }
        ],
        nextCursor: null
      });
      await expect(
        repository.findProviderLifecycleOperation({
          tenantId: foreignTenantId,
          operationId: lifecycleCreation.operation.id
        })
      ).resolves.toBeNull();
      await expect(
        repository.listProviderLifecycleTransitions({
          tenantId: foreignTenantId,
          operationId: lifecycleCreation.operation.id,
          snapshotToken: null,
          cursor: null,
          limit: 1
        })
      ).resolves.toBeNull();
    });

    it("atomically creates one shared provider semantic head and fences replay, stale and concurrent lifecycle commits", async () => {
      const repository = createSqlInboxV2TimelineMessageRepository(db);
      const sequentialMessage = sourceOutboundCreationCommit(
        "provider-semantic-sequential"
      );
      await seedExternalCreationAnchors(
        db,
        sequentialMessage,
        "provider-semantic-sequential"
      );
      await expect(
        createSourceMessage(
          historicalTimelineFixtureRepository(db),
          sequentialMessage,
          "720"
        )
      ).resolves.toMatchObject({ kind: "created" });

      const firstCommit = providerObservedLifecycleCreationCommit(
        sequentialMessage,
        "provider-semantic-sequential"
      );
      const firstOrderingCommit =
        requireProviderSemanticOrderingCommit(firstCommit);
      await expect(
        repository.createProviderLifecycleOperation({
          commit: firstCommit,
          streamPosition: position("721")
        })
      ).resolves.toMatchObject({
        kind: "appended",
        envelope: { streamPosition: "721", entityRevision: "1" }
      });
      expect(
        await loadProviderSemanticOrderingHeads(db, firstOrderingCommit)
      ).toEqual([
        {
          proof_token: firstOrderingCommit.after.proofToken,
          position: firstOrderingCommit.after.position,
          revision: "1",
          last_changed_stream_position: "721"
        }
      ]);

      const nonAdvancingHead = {
        ...firstOrderingCommit.after,
        revision: "2",
        updatedAt: t4
      };
      const nonAdvancingError = await capturePostgresError(
        db.execute(sql`
          update inbox_v2_provider_semantic_ordering_heads
             set position = ${nonAdvancingHead.position},
                 revision = ${nonAdvancingHead.revision},
                 head_detail = ${JSON.stringify(nonAdvancingHead)}::jsonb,
                 head_detail_digest_sha256 =
                   ${computeInboxV2TimelineMessageCommitDigest(nonAdvancingHead)},
                 last_changed_stream_position = 722,
                 updated_at = ${nonAdvancingHead.updatedAt}
           where tenant_id = ${firstOrderingCommit.tenantId}
             and external_message_reference_id =
               ${firstOrderingCommit.after.externalMessageReference.id}
             and semantic_family_id = ${firstOrderingCommit.semanticFamilyId}
        `)
      );
      expect(postgresSqlState(nonAdvancingError)).toBe("23514");
      expect(postgresErrorText(nonAdvancingError)).toContain(
        "inbox_v2.provider_semantic_ordering_head_invalid_advance"
      );
      expect(
        await loadProviderSemanticOrderingHeads(db, firstOrderingCommit)
      ).toEqual([
        {
          proof_token: firstOrderingCommit.after.proofToken,
          position: firstOrderingCommit.after.position,
          revision: "1",
          last_changed_stream_position: "721"
        }
      ]);

      const identityMutatingHead = {
        ...firstOrderingCommit.after,
        scopeToken: `ordering:db005-mutated-${runId}`,
        position: (BigInt(firstOrderingCommit.after.position) + 1n).toString(),
        revision: "2",
        updatedAt: t4
      };
      const identityMutationError = await capturePostgresError(
        db.execute(sql`
          update inbox_v2_provider_semantic_ordering_heads
             set scope_token = ${identityMutatingHead.scopeToken},
                 position = ${identityMutatingHead.position},
                 revision = ${identityMutatingHead.revision},
                 head_detail = ${JSON.stringify(identityMutatingHead)}::jsonb,
                 head_detail_digest_sha256 =
                   ${computeInboxV2TimelineMessageCommitDigest(identityMutatingHead)},
                 last_changed_stream_position = 722,
                 updated_at = ${identityMutatingHead.updatedAt}
           where tenant_id = ${firstOrderingCommit.tenantId}
             and external_message_reference_id =
               ${firstOrderingCommit.after.externalMessageReference.id}
             and semantic_family_id = ${firstOrderingCommit.semanticFamilyId}
        `)
      );
      expect(postgresSqlState(identityMutationError)).toBe("23514");
      expect(postgresErrorText(identityMutationError)).toContain(
        "inbox_v2.provider_semantic_ordering_head_invalid_advance"
      );
      expect(
        await loadProviderSemanticOrderingHeads(db, firstOrderingCommit)
      ).toEqual([
        {
          proof_token: firstOrderingCommit.after.proofToken,
          position: firstOrderingCommit.after.position,
          revision: "1",
          last_changed_stream_position: "721"
        }
      ]);

      await expect(
        repository.createProviderLifecycleOperation({
          commit: firstCommit,
          streamPosition: position("9721")
        })
      ).resolves.toMatchObject({
        kind: "already_applied",
        envelope: { streamPosition: "721", entityRevision: "1" }
      });
      expect(
        await loadProviderSemanticOrderingHeads(db, firstOrderingCommit)
      ).toEqual([
        {
          proof_token: firstOrderingCommit.after.proofToken,
          position: firstOrderingCommit.after.position,
          revision: "1",
          last_changed_stream_position: "721"
        }
      ]);

      const staleCommit = competingProviderObservedLifecycleCreationCommit(
        firstCommit,
        "provider-semantic-stale"
      );
      await expect(
        repository.createProviderLifecycleOperation({
          commit: staleCommit,
          streamPosition: position("722")
        })
      ).resolves.toMatchObject({
        kind: "conflict",
        code: "message.state_conflict"
      });
      expect(
        await loadProviderLifecycleOperationCount(db, [
          firstCommit.operation.id,
          staleCommit.operation.id
        ])
      ).toBe(1);
      expect(
        await loadProviderSemanticOrderingHeads(db, firstOrderingCommit)
      ).toEqual([
        {
          proof_token: firstOrderingCommit.after.proofToken,
          position: firstOrderingCommit.after.position,
          revision: "1",
          last_changed_stream_position: "721"
        }
      ]);

      const raceMessage = sourceOutboundCreationCommit(
        "provider-semantic-race"
      );
      await seedExternalCreationAnchors(
        db,
        raceMessage,
        "provider-semantic-race"
      );
      await expect(
        createSourceMessage(
          historicalTimelineFixtureRepository(db),
          raceMessage,
          "730"
        )
      ).resolves.toMatchObject({ kind: "created" });
      const raceCommitA = providerObservedLifecycleCreationCommit(
        raceMessage,
        "provider-semantic-race"
      );
      const raceCommitB = competingProviderObservedLifecycleCreationCommit(
        raceCommitA,
        "provider-semantic-race-b"
      );
      const raceOrderingCommit =
        requireProviderSemanticOrderingCommit(raceCommitA);
      const clientA = await db.$client.connect();
      const clientB = await db.$client.connect();
      let raceResults: Awaited<
        ReturnType<typeof repository.createProviderLifecycleOperation>
      >[];
      try {
        const [pidA, pidB] = await Promise.all([
          clientA.query<{ pid: number }>(
            "select pg_backend_pid()::integer as pid"
          ),
          clientB.query<{ pid: number }>(
            "select pg_backend_pid()::integer as pid"
          )
        ]);
        expect(pidA.rows[0]?.pid).toBeTypeOf("number");
        expect(pidB.rows[0]?.pid).toBeTypeOf("number");
        expect(pidA.rows[0]?.pid).not.toBe(pidB.rows[0]?.pid);

        const barrier = createAsyncBarrier(2);
        const repositoryA = createBarrierScopedTimelineRepository(
          clientA,
          barrier
        );
        const repositoryB = createBarrierScopedTimelineRepository(
          clientB,
          barrier
        );
        raceResults = await Promise.all([
          repositoryA.createProviderLifecycleOperation({
            commit: raceCommitA,
            streamPosition: position("731")
          }),
          repositoryB.createProviderLifecycleOperation({
            commit: raceCommitB,
            streamPosition: position("732")
          })
        ]);
      } finally {
        clientA.release();
        clientB.release();
      }
      expect(raceResults.map((result) => result.kind).sort()).toEqual([
        "appended",
        "conflict"
      ]);
      expect(
        raceResults.find((result) => result.kind === "conflict")
      ).toMatchObject({
        kind: "conflict",
        code: "message.state_conflict"
      });

      const winningIndex = raceResults.findIndex(
        (result) => result.kind === "appended"
      );
      const winningCommit = winningIndex === 0 ? raceCommitA : raceCommitB;
      const winningStreamPosition = winningIndex === 0 ? "731" : "732";
      const winningOrderingCommit =
        requireProviderSemanticOrderingCommit(winningCommit);
      expect(
        await loadProviderLifecycleOperationCount(db, [
          raceCommitA.operation.id,
          raceCommitB.operation.id
        ])
      ).toBe(1);
      expect(
        await loadProviderSemanticOrderingHeads(db, raceOrderingCommit)
      ).toEqual([
        {
          proof_token: winningOrderingCommit.after.proofToken,
          position: winningOrderingCommit.after.position,
          revision: "1",
          last_changed_stream_position: winningStreamPosition
        }
      ]);

      const successorCommit = advancedProviderObservedLifecycleCreationCommit(
        winningCommit,
        "provider-semantic-race-successor"
      );
      const successorOrderingCommit =
        requireProviderSemanticOrderingCommit(successorCommit);
      expect(successorOrderingCommit).toMatchObject({
        before: winningOrderingCommit.after,
        after: { position: "2", revision: "2" }
      });
      await expect(
        repository.createProviderLifecycleOperation({
          commit: successorCommit,
          streamPosition: position("733")
        })
      ).resolves.toMatchObject({
        kind: "appended",
        envelope: { streamPosition: "733", entityRevision: "1" }
      });

      const staleOldCommit = advancedProviderObservedLifecycleCreationCommit(
        winningCommit,
        "provider-semantic-race-stale-old"
      );
      await expect(
        repository.createProviderLifecycleOperation({
          commit: staleOldCommit,
          streamPosition: position("734")
        })
      ).resolves.toMatchObject({
        kind: "conflict",
        code: "message.state_conflict"
      });

      await expect(
        repository.createProviderLifecycleOperation({
          commit: winningCommit,
          streamPosition: position("9731")
        })
      ).resolves.toMatchObject({
        kind: "already_applied",
        envelope: {
          streamPosition: winningStreamPosition,
          entityRevision: "1"
        }
      });
      expect(
        await loadProviderLifecycleOperationCountForMessage(
          db,
          raceMessage.message.id
        )
      ).toBe(2);
      expect(
        await loadProviderSemanticOrderingHeads(db, raceOrderingCommit)
      ).toEqual([
        {
          proof_token: successorOrderingCommit.after.proofToken,
          position: "2",
          revision: "2",
          last_changed_stream_position: "733"
        }
      ]);

      const revisionJumpHead = {
        ...successorOrderingCommit.after,
        position: "3",
        revision: "4"
      };
      const revisionJumpError = await capturePostgresError(
        db.execute(sql`
          update inbox_v2_provider_semantic_ordering_heads
             set position = ${revisionJumpHead.position},
                 revision = ${revisionJumpHead.revision},
                 head_detail = ${JSON.stringify(revisionJumpHead)}::jsonb,
                 head_detail_digest_sha256 =
                   ${computeInboxV2TimelineMessageCommitDigest(revisionJumpHead)},
                 last_changed_stream_position = 734,
                 updated_at = ${revisionJumpHead.updatedAt}
           where tenant_id = ${successorOrderingCommit.tenantId}
             and external_message_reference_id =
               ${successorOrderingCommit.after.externalMessageReference.id}
             and semantic_family_id =
               ${successorOrderingCommit.semanticFamilyId}
        `)
      );
      expect(postgresSqlState(revisionJumpError)).toBe("23514");
      expect(postgresErrorText(revisionJumpError)).toContain(
        "inbox_v2.provider_semantic_ordering_head_invalid_advance"
      );
      expect(
        await loadProviderSemanticOrderingHeads(db, raceOrderingCommit)
      ).toEqual([
        {
          proof_token: successorOrderingCommit.after.proofToken,
          position: "2",
          revision: "2",
          last_changed_stream_position: "733"
        }
      ]);
    });

    it("keeps lifecycle and provider-observed reaction semantic heads independent across replay, stale and successor commits", async () => {
      const repository = createSqlInboxV2TimelineMessageRepository(db);
      const creation = sourceOutboundCreationCommit(
        "provider-reaction-shared-head"
      );
      const creationContext = await seedExternalCreationAnchors(
        db,
        creation,
        "provider-reaction-shared-head"
      );
      await expect(
        createSourceMessage(
          historicalTimelineFixtureRepository(db),
          creation,
          "800"
        )
      ).resolves.toMatchObject({ kind: "created" });

      const lifecycleCommit = providerObservedLifecycleCreationCommit(
        creation,
        "provider-reaction-shared-head"
      );
      const lifecycleOrderingCommit =
        requireProviderSemanticOrderingCommit(lifecycleCommit);
      await expect(
        repository.createProviderLifecycleOperation({
          commit: lifecycleCommit,
          streamPosition: position("801")
        })
      ).resolves.toMatchObject({
        kind: "appended",
        envelope: { streamPosition: "801", entityRevision: "1" }
      });

      const duplicateLifecycleOperationId = `message_provider_lifecycle_operation:db005-provider-reaction-late-duplicate-${runId}`;
      const duplicateLifecycleError = await capturePostgresError(
        db.transaction(async (transaction) => {
          await transaction.execute(sql`
            insert into inbox_v2_message_provider_lifecycle_operations
            select (
              jsonb_populate_record(
                null::inbox_v2_message_provider_lifecycle_operations,
                to_jsonb(operation_row) ||
                  jsonb_build_object('id', ${duplicateLifecycleOperationId}::text)
              )
            ).*
              from inbox_v2_message_provider_lifecycle_operations operation_row
             where operation_row.tenant_id = ${tenantId}
               and operation_row.id = ${lifecycleCommit.operation.id}
          `);
        })
      );
      expect(postgresSqlState(duplicateLifecycleError)).toBe("23514");
      expect(postgresErrorText(duplicateLifecycleError)).toContain(
        "inbox_v2.provider_semantic_ordering_consumer_count_invalid"
      );
      expect(
        await loadProviderLifecycleOperationCountForMessage(
          db,
          creation.message.id
        )
      ).toBe(1);

      const firstReactionCommit = providerObservedReactionSetCommit(
        creation,
        "provider-reaction-shared-head",
        "👍"
      );
      const firstReactionOrderingCommit =
        requireProviderReactionOrderingCommit(firstReactionCommit);
      const firstReactionEvidence =
        firstReactionCommit.externalAuthorityEvidence;
      if (firstReactionEvidence === null) {
        throw new Error(
          "Provider reaction fixture requires external evidence."
        );
      }
      await expect(
        repository.applyReaction({
          commit: firstReactionCommit,
          streamPosition: position("802")
        })
      ).resolves.toMatchObject({
        kind: "appended",
        envelope: { streamPosition: "802", entityRevision: "1" }
      });
      expect(
        await loadProviderSemanticOrderingHeads(db, firstReactionOrderingCommit)
      ).toEqual([
        {
          proof_token: firstReactionOrderingCommit.after.proofToken,
          position: "1",
          revision: "1",
          last_changed_stream_position: "802"
        }
      ]);
      expect(
        await loadProviderReactionPersistenceState(db, creation.message.id)
      ).toEqual({
        reaction_count: "1",
        reaction_revision: "1",
        slot_count: "1",
        slot_revision: "1",
        transition_count: "1",
        observation_count: "1"
      });

      await expect(
        repository.applyReaction({
          commit: firstReactionCommit,
          streamPosition: position("9802")
        })
      ).resolves.toMatchObject({
        kind: "already_applied",
        envelope: { streamPosition: "802", entityRevision: "1" }
      });
      expect(
        await loadProviderReactionPersistenceState(db, creation.message.id)
      ).toEqual({
        reaction_count: "1",
        reaction_revision: "1",
        slot_count: "1",
        slot_revision: "1",
        transition_count: "1",
        observation_count: "1"
      });
      expect(
        await loadProviderSemanticOrderingHeads(db, firstReactionOrderingCommit)
      ).toEqual([
        {
          proof_token: firstReactionOrderingCommit.after.proofToken,
          position: "1",
          revision: "1",
          last_changed_stream_position: "802"
        }
      ]);

      const staleReactionCommit = competingProviderObservedReactionCommit(
        firstReactionCommit,
        "provider-reaction-shared-head-stale"
      );
      await expect(
        repository.applyReaction({
          commit: staleReactionCommit,
          streamPosition: position("803")
        })
      ).resolves.toMatchObject({
        kind: "conflict",
        code: "message.state_conflict"
      });
      expect(
        await loadProviderReactionPersistenceState(db, creation.message.id)
      ).toEqual({
        reaction_count: "1",
        reaction_revision: "1",
        slot_count: "1",
        slot_revision: "1",
        transition_count: "1",
        observation_count: "1"
      });

      const successorEvidenceResolution =
        additionalProviderOccurrenceResolution(
          creation,
          "provider-reaction-shared-head-successor-evidence"
        );
      const successorEvidence = await seedAdditionalProviderSemanticOccurrence({
        db,
        creation,
        context: creationContext,
        resolution: successorEvidenceResolution,
        suffix: "provider-reaction-shared-head-successor-evidence"
      });
      const successorReactionCommit = advancedProviderObservedReactionCommit(
        firstReactionCommit,
        "provider-reaction-shared-head-successor",
        "🔥",
        successorEvidence
      );
      const successorReactionOrderingCommit =
        requireProviderReactionOrderingCommit(successorReactionCommit);
      await expect(
        repository.applyReaction({
          commit: successorReactionCommit,
          streamPosition: position("804")
        })
      ).resolves.toMatchObject({
        kind: "appended",
        envelope: { streamPosition: "804", entityRevision: "2" }
      });
      expect(
        await loadProviderReactionPersistenceState(db, creation.message.id)
      ).toEqual({
        reaction_count: "1",
        reaction_revision: "2",
        slot_count: "1",
        slot_revision: "2",
        transition_count: "2",
        observation_count: "2"
      });
      expect(
        await loadProviderSemanticOrderingHeads(
          db,
          successorReactionOrderingCommit
        )
      ).toEqual([
        {
          proof_token: successorReactionOrderingCommit.after.proofToken,
          position: "2",
          revision: "2",
          last_changed_stream_position: "804"
        }
      ]);
      expect(
        await loadProviderReactionEvidence(db, creation.message.id)
      ).toEqual([
        {
          ordering_position: "1",
          normalized_inbound_event_id:
            firstReactionOrderingCommit.proof.normalizedInboundEvent.id,
          source_occurrence_id: firstReactionEvidence.sourceOccurrence.id
        },
        {
          ordering_position: "2",
          normalized_inbound_event_id:
            successorReactionOrderingCommit.proof.normalizedInboundEvent.id,
          source_occurrence_id: successorEvidence.id
        }
      ]);
      await expect(
        repository.applyReaction({
          commit: firstReactionCommit,
          streamPosition: position("9804")
        })
      ).resolves.toMatchObject({
        kind: "already_applied",
        envelope: { streamPosition: "802", entityRevision: "1" }
      });
      expect(
        await loadProviderReactionPersistenceState(db, creation.message.id)
      ).toEqual({
        reaction_count: "1",
        reaction_revision: "2",
        slot_count: "1",
        slot_revision: "2",
        transition_count: "2",
        observation_count: "2"
      });
      expect(
        await loadProviderSemanticOrderingHeads(
          db,
          successorReactionOrderingCommit
        )
      ).toEqual([
        {
          proof_token: successorReactionOrderingCommit.after.proofToken,
          position: "2",
          revision: "2",
          last_changed_stream_position: "804"
        }
      ]);
      expect(
        await loadProviderSemanticOrderingHeads(db, lifecycleOrderingCommit)
      ).toEqual([
        {
          proof_token: lifecycleOrderingCommit.after.proofToken,
          position: "1",
          revision: "1",
          last_changed_stream_position: "801"
        }
      ]);

      const policyEventId = `event:db005-provider-reaction-delete-policy-${runId}`;
      await db.execute(sql`
        insert into event_store (
          id, tenant_id, type, version, occurred_at, idempotency_key,
          payload, created_at, updated_at
        ) values (
          ${policyEventId}, ${tenantId},
          'inbox_v2.message.provider_delete_policy_decided', 'v1', ${t4},
          ${`db005-provider-reaction-delete-policy-${runId}`},
          ${JSON.stringify({
            actionKind: "provider_delete_policy",
            entityKind: "message_provider_lifecycle_operation",
            entityId: lifecycleCommit.operation.id,
            effect: "tombstone_local"
          })}::jsonb,
          ${t4}, ${t4}
        )
      `);
      const lifecycleTransition = providerLifecyclePolicyTransitionCommit(
        lifecycleCommit,
        policyEventId,
        "tombstone_local",
        t4
      );
      await expect(
        repository.transitionProviderLifecycleOperation({
          commit: lifecycleTransition,
          streamPosition: position("805")
        })
      ).resolves.toMatchObject({
        kind: "appended",
        envelope: { streamPosition: "805", entityRevision: "2" }
      });
      const tombstoneCommit = providerDeleteTombstoneMutation(
        creation,
        lifecycleCommit,
        lifecycleTransition,
        "provider-reaction-shared-head-tombstone"
      );
      await expect(
        repository.mutateMessage({
          commit: tombstoneCommit,
          streamPosition: position("806")
        })
      ).resolves.toMatchObject({
        kind: "applied",
        envelope: { streamPosition: "806", entityRevision: "2" }
      });
      const replayAuditBefore = await loadProviderLifecycleReplayAuditState(
        db,
        creation.message.id,
        lifecycleCommit.operation.id
      );
      await expect(
        repository.createProviderLifecycleOperation({
          commit: lifecycleCommit,
          streamPosition: position("9801")
        })
      ).resolves.toMatchObject({
        kind: "already_applied",
        envelope: { streamPosition: "801", entityRevision: "1" }
      });
      expect(
        await loadProviderLifecycleReplayAuditState(
          db,
          creation.message.id,
          lifecycleCommit.operation.id
        )
      ).toEqual(replayAuditBefore);
      expect(
        await loadProviderSemanticOrderingHeads(db, lifecycleOrderingCommit)
      ).toEqual([
        {
          proof_token: lifecycleOrderingCommit.after.proofToken,
          position: "1",
          revision: "1",
          last_changed_stream_position: "801"
        }
      ]);
    });

    it("rejects raw reaction FSM corruption and a non-monotonic reaction head advance", async () => {
      const repository = createSqlInboxV2TimelineMessageRepository(db);
      const suffix = "reaction-raw-fsm";
      const creation = creationCommit(suffix);
      await seedCreationAnchors(db, creation);
      await expect(
        historicalTimelineFixtureRepository(db).createMessage({
          commit: creation,
          streamPosition: position("870")
        })
      ).resolves.toMatchObject({ kind: "created" });
      const setCommit = internalReactionSetCommit(
        creation,
        `${suffix}-set`,
        "🔥"
      );
      await expect(
        repository.applyReaction({
          commit: setCommit,
          streamPosition: position("871")
        })
      ).resolves.toMatchObject({
        kind: "appended",
        envelope: { streamPosition: "871", entityRevision: "1" }
      });
      const baselineState = {
        reaction_count: "1",
        reaction_revision: "1",
        slot_count: "1",
        slot_revision: "1",
        transition_count: "1",
        observation_count: "0"
      };

      const invalidClear = tamperedInternalReactionClearLastValueCommit(
        internalReactionClearCommit(setCommit, `${suffix}-wrong-last-value`)
      );
      const invalidClearAttributionId = derivedInboxV2Id(
        "action_attribution",
        invalidClear.transition.id
      );
      const invalidClearError = await capturePostgresError(
        db.transaction(async (transaction) => {
          expect(
            (
              await transaction.execute(
                buildInsertInboxV2ActionAttributionSql({
                  tenantId,
                  id: invalidClearAttributionId,
                  conversationId: creation.message.conversation.id,
                  attribution: invalidClear.transition.actionAttribution,
                  createdAt: invalidClear.transition.recordedAt
                })
              )
            ).rows
          ).toHaveLength(1);
          await transaction.execute(
            buildInsertInboxV2MessageReactionTransitionSql({
              commit: invalidClear,
              actionAttributionId: invalidClearAttributionId,
              streamPosition: position("872")
            })
          );
          await transaction.execute(sql`set constraints all immediate`);
        })
      );
      expect(postgresSqlState(invalidClearError)).toBe("23514");
      expect(postgresErrorText(invalidClearError)).toMatch(
        /inbox_v2\.timeline_message_json_contract:inbox_v2_message_reaction_transitions/u
      );
      expect(
        await loadActionAttributionCount(db, invalidClearAttributionId)
      ).toBe(0);
      expect(
        await loadProviderReactionPersistenceState(db, creation.message.id)
      ).toEqual(baselineState);

      const nonMonotonicClear = nonMonotonicReactionHeadCommit(
        internalReactionClearCommit(setCommit, `${suffix}-non-monotonic`)
      );
      const reactionBefore = nonMonotonicClear.beforeReaction;
      if (reactionBefore === null) {
        throw new Error("Reaction chronology case requires an existing head.");
      }
      const nonMonotonicAttributionId = derivedInboxV2Id(
        "action_attribution",
        nonMonotonicClear.transition.id
      );
      const chronologyError = await capturePostgresError(
        db.transaction(async (transaction) => {
          expect(
            (
              await transaction.execute(
                buildInsertInboxV2ActionAttributionSql({
                  tenantId,
                  id: nonMonotonicAttributionId,
                  conversationId: creation.message.conversation.id,
                  attribution: nonMonotonicClear.transition.actionAttribution,
                  createdAt: nonMonotonicClear.transition.recordedAt
                })
              )
            ).rows
          ).toHaveLength(1);
          expect(
            (
              await transaction.execute(
                buildInsertInboxV2MessageReactionTransitionSql({
                  commit: nonMonotonicClear,
                  actionAttributionId: nonMonotonicAttributionId,
                  streamPosition: position("871")
                })
              )
            ).rows
          ).toHaveLength(1);
          await transaction.execute(
            buildAdvanceInboxV2MessageReactionSql({
              before: reactionBefore,
              after: nonMonotonicClear.afterReaction,
              streamPosition: position("871")
            })
          );
          await transaction.execute(sql`set constraints all immediate`);
        })
      );
      expect(postgresSqlState(chronologyError)).toBe("23514");
      expect(postgresErrorText(chronologyError)).toMatch(
        /inbox_v2\.timeline_message_stale_head:inbox_v2_message_reactions/u
      );
      expect(
        await loadActionAttributionCount(db, nonMonotonicAttributionId)
      ).toBe(0);
      expect(
        await loadProviderReactionPersistenceState(db, creation.message.id)
      ).toEqual(baselineState);
    });

    it("rejects a provider reaction whose semantic proof tampers with trusted adapter authority", async () => {
      const repository = createSqlInboxV2TimelineMessageRepository(db);
      const suffix = "provider-reaction-authority-tamper";
      const creation = sourceOutboundCreationCommit(suffix);
      const context = await seedExternalCreationAnchors(db, creation, suffix);
      await expect(
        createSourceMessage(
          historicalTimelineFixtureRepository(db),
          creation,
          "850"
        )
      ).resolves.toMatchObject({ kind: "created" });

      const firstCommit = providerObservedReactionSetCommit(
        creation,
        suffix,
        "👍"
      );
      const firstOrderingCommit =
        requireProviderReactionOrderingCommit(firstCommit);
      await expect(
        repository.applyReaction({
          commit: firstCommit,
          streamPosition: position("851")
        })
      ).resolves.toMatchObject({
        kind: "appended",
        envelope: { streamPosition: "851", entityRevision: "1" }
      });

      const successorEvidenceResolution =
        additionalProviderOccurrenceResolution(
          creation,
          `${suffix}-successor-evidence`
        );
      const successorEvidence = await seedAdditionalProviderSemanticOccurrence({
        db,
        creation,
        context,
        resolution: successorEvidenceResolution,
        suffix: `${suffix}-successor-evidence`
      });
      const validSuccessorCommit = advancedProviderObservedReactionCommit(
        firstCommit,
        `${suffix}-successor`,
        "🔥",
        successorEvidence
      );
      const tamperedCommit =
        trustedAuthorityTamperedProviderReactionCommit(validSuccessorCommit);
      const tamperedOrderingCommit =
        requireProviderReactionOrderingCommit(tamperedCommit);
      const orderingHeadBefore = tamperedOrderingCommit.before;
      const reactionBefore = tamperedCommit.beforeReaction;
      const slotHeadBefore = tamperedCommit.slotHeadBefore;
      if (
        orderingHeadBefore === null ||
        reactionBefore === null ||
        slotHeadBefore === null
      ) {
        throw new Error(
          "Authority tamper requires existing reaction and ordering heads."
        );
      }
      const tamperedAdapter =
        tamperedCommit.providerObservation?.semanticProof.adapterContract;
      expect(tamperedAdapter?.contractVersion).toBe("v999");
      expect(tamperedAdapter).not.toEqual(
        validSuccessorCommit.transition.externalAuthority?.adapterContract
      );
      const tamperedAttributionId = derivedInboxV2Id(
        "action_attribution",
        tamperedCommit.transition.id
      );

      const authorityError = await capturePostgresError(
        db.transaction(async (transaction) => {
          expect(
            (
              await transaction.execute(
                buildInsertInboxV2ActionAttributionSql({
                  tenantId,
                  id: tamperedAttributionId,
                  conversationId: creation.message.conversation.id,
                  attribution: tamperedCommit.transition.actionAttribution,
                  createdAt: tamperedCommit.transition.recordedAt
                })
              )
            ).rows
          ).toHaveLength(1);
          expect(
            (
              await transaction.execute(
                buildInsertInboxV2MessageReactionTransitionSql({
                  commit: tamperedCommit,
                  actionAttributionId: tamperedAttributionId,
                  streamPosition: position("852")
                })
              )
            ).rows
          ).toHaveLength(1);
          expect(
            (
              await transaction.execute(
                buildAdvanceInboxV2MessageReactionSql({
                  before: reactionBefore,
                  after: tamperedCommit.afterReaction,
                  streamPosition: position("852")
                })
              )
            ).rows
          ).toHaveLength(1);
          expect(
            (
              await transaction.execute(
                buildInsertInboxV2ProviderReactionObservationSql(tamperedCommit)
              )
            ).rows
          ).toHaveLength(1);
          expect(
            (
              await transaction.execute(
                buildAdvanceInboxV2ProviderSemanticOrderingHeadSql({
                  before: orderingHeadBefore,
                  after: tamperedOrderingCommit.after,
                  currentLastChangedStreamPosition: position("851"),
                  streamPosition: position("852")
                })
              )
            ).rows
          ).toHaveLength(1);
          expect(
            (
              await transaction.execute(
                buildAdvanceInboxV2MessageReactionSlotHeadSql({
                  before: slotHeadBefore,
                  after: tamperedCommit.slotHeadAfter,
                  streamPosition: position("852")
                })
              )
            ).rows
          ).toHaveLength(1);
          await transaction.execute(sql`set constraints all immediate`);
        })
      );
      expect(postgresSqlState(authorityError)).toBe("23514");
      expect(postgresErrorText(authorityError)).toMatch(
        /inbox_v2\.provider_semantic_ordering_(?:head_consumer|consumer_head|consumer_count)_invalid/u
      );
      expect(await loadActionAttributionCount(db, tamperedAttributionId)).toBe(
        0
      );
      expect(
        await loadProviderSemanticOrderingHeads(db, firstOrderingCommit)
      ).toEqual([
        {
          proof_token: firstOrderingCommit.after.proofToken,
          position: "1",
          revision: "1",
          last_changed_stream_position: "851"
        }
      ]);
      expect(
        await loadProviderReactionPersistenceState(db, creation.message.id)
      ).toEqual({
        reaction_count: "1",
        reaction_revision: "1",
        slot_count: "1",
        slot_revision: "1",
        transition_count: "1",
        observation_count: "1"
      });

      const missingObservationAttributionId = derivedInboxV2Id(
        "action_attribution",
        validSuccessorCommit.transition.id
      );
      const missingObservationError = await capturePostgresError(
        db.transaction(async (transaction) => {
          expect(
            (
              await transaction.execute(
                buildInsertInboxV2ActionAttributionSql({
                  tenantId,
                  id: missingObservationAttributionId,
                  conversationId: creation.message.conversation.id,
                  attribution:
                    validSuccessorCommit.transition.actionAttribution,
                  createdAt: validSuccessorCommit.transition.recordedAt
                })
              )
            ).rows
          ).toHaveLength(1);
          expect(
            (
              await transaction.execute(
                buildInsertInboxV2MessageReactionTransitionSql({
                  commit: validSuccessorCommit,
                  actionAttributionId: missingObservationAttributionId,
                  streamPosition: position("853")
                })
              )
            ).rows
          ).toHaveLength(1);
          expect(
            (
              await transaction.execute(
                buildAdvanceInboxV2MessageReactionSql({
                  before: reactionBefore,
                  after: validSuccessorCommit.afterReaction,
                  streamPosition: position("853")
                })
              )
            ).rows
          ).toHaveLength(1);
          expect(
            (
              await transaction.execute(
                buildAdvanceInboxV2MessageReactionSlotHeadSql({
                  before: slotHeadBefore,
                  after: validSuccessorCommit.slotHeadAfter,
                  streamPosition: position("853")
                })
              )
            ).rows
          ).toHaveLength(1);
          await transaction.execute(sql`set constraints all immediate`);
        })
      );
      expect(postgresSqlState(missingObservationError)).toBe("23514");
      expect(postgresErrorText(missingObservationError)).toContain(
        "inbox_v2.message_reaction_head_coherence"
      );
      expect(
        await loadActionAttributionCount(db, missingObservationAttributionId)
      ).toBe(0);
      expect(
        await loadProviderReactionPersistenceState(db, creation.message.id)
      ).toEqual({
        reaction_count: "1",
        reaction_revision: "1",
        slot_count: "1",
        slot_revision: "1",
        transition_count: "1",
        observation_count: "1"
      });
      expect(
        await loadProviderSemanticOrderingHeads(db, firstOrderingCommit)
      ).toEqual([
        {
          proof_token: firstOrderingCommit.after.proofToken,
          position: "1",
          revision: "1",
          last_changed_stream_position: "851"
        }
      ]);
    });

    it("rejects a non-monotonic provider lifecycle head advance and rolls its transition back", async () => {
      const repository = createSqlInboxV2TimelineMessageRepository(db);
      const suffix = "provider-lifecycle-non-monotonic";
      const creation = sourceOutboundCreationCommit(suffix);
      await seedExternalCreationAnchors(db, creation, suffix);
      await expect(
        createSourceMessage(
          historicalTimelineFixtureRepository(db),
          creation,
          "880"
        )
      ).resolves.toMatchObject({ kind: "created" });
      const lifecycleCreation = providerObservedLifecycleCreationCommit(
        creation,
        suffix
      );
      await expect(
        repository.createProviderLifecycleOperation({
          commit: lifecycleCreation,
          streamPosition: position("881")
        })
      ).resolves.toMatchObject({
        kind: "appended",
        envelope: { streamPosition: "881", entityRevision: "1" }
      });

      const decisionEventId = `event:db005-${suffix}-${runId}`;
      await db.execute(sql`
        insert into event_store (
          id, tenant_id, type, version, occurred_at, idempotency_key,
          payload, created_at, updated_at
        ) values (
          ${decisionEventId}, ${tenantId},
          'inbox_v2.message.provider_delete_policy_decided', 'v1', ${t4},
          ${`db005-${suffix}-${runId}`},
          ${JSON.stringify({
            actionKind: "provider_delete_policy",
            entityKind: "message_provider_lifecycle_operation",
            entityId: lifecycleCreation.operation.id,
            effect: "retain_local"
          })}::jsonb,
          ${t4}, ${t4}
        )
      `);
      const nonMonotonicTransition = nonMonotonicProviderLifecycleHeadCommit(
        providerLifecyclePolicyTransitionCommit(
          lifecycleCreation,
          decisionEventId,
          "retain_local",
          t4
        )
      );
      const chronologyError = await capturePostgresError(
        db.transaction(async (transaction) => {
          expect(
            (
              await transaction.execute(
                buildInsertInboxV2ProviderLifecycleTransitionSql({
                  commit: nonMonotonicTransition,
                  streamPosition: position("881")
                })
              )
            ).rows
          ).toHaveLength(1);
          await transaction.execute(
            buildAdvanceInboxV2ProviderLifecycleOperationSql(
              nonMonotonicTransition,
              position("881")
            )
          );
          await transaction.execute(sql`set constraints all immediate`);
        })
      );
      expect(postgresSqlState(chronologyError)).toBe("23514");
      expect(postgresErrorText(chronologyError)).toMatch(
        /inbox_v2\.timeline_message_stale_head:inbox_v2_message_provider_lifecycle_operations/u
      );
      expect(
        await loadProviderLifecycleReplayAuditState(
          db,
          creation.message.id,
          lifecycleCreation.operation.id
        )
      ).toEqual({
        operation_count: "1",
        operation_revision: "1",
        created_stream_position: "881",
        last_changed_stream_position: "881",
        transition_count: "0",
        message_revision_count: "1"
      });
    });

    it("terminalizes an external reaction request from exact provider result proof and rejects proof tampering", async () => {
      const repository = createSqlInboxV2TimelineMessageRepository(db);
      const suffix = "provider-result-terminal";
      const creation = sourceOutboundCreationCommit(suffix);
      const context = await seedExternalCreationAnchors(db, creation, suffix, {
        includeReactionSetCapability: true
      });
      expect(
        context.bindingProjection.binding.capabilities.entries
      ).toContainEqual(
        expect.objectContaining({
          capabilityId: "module:synthetic:reactions",
          operationId: "core:message.reaction.set",
          state: "supported"
        })
      );
      await expect(
        createSourceMessage(
          historicalTimelineFixtureRepository(db),
          creation,
          "860"
        )
      ).resolves.toMatchObject({ kind: "created" });
      const operator = await seedProviderResultOperator(db, creation, suffix);
      const route = await seedProviderResultOutboundRoute({
        db,
        creation,
        context,
        operator,
        suffix
      });
      const outboundBindingSnapshot = providerResultOutboundBindingSnapshot(
        context.bindingProjection.binding,
        route
      );
      const requestCommit = providerResultExternalRequestCommit(
        creation,
        operator,
        route,
        outboundBindingSnapshot,
        `${suffix}-request`
      );
      const invalidRequest =
        tamperedExternalRequestConfirmedBeforeCommit(requestCommit);
      const requestAttributionId = derivedInboxV2Id(
        "action_attribution",
        requestCommit.transition.id
      );
      const requestFsmError = await capturePostgresError(
        db.transaction(async (transaction) => {
          expect(
            (
              await transaction.execute(
                buildInsertInboxV2ActionAttributionSql({
                  tenantId,
                  id: requestAttributionId,
                  conversationId: creation.message.conversation.id,
                  attribution: invalidRequest.transition.actionAttribution,
                  createdAt: invalidRequest.transition.recordedAt
                })
              )
            ).rows
          ).toHaveLength(1);
          expect(
            (
              await transaction.execute(
                buildInsertInboxV2MessageReactionSql({
                  reaction: invalidRequest.afterReaction,
                  streamPosition: position("861")
                })
              )
            ).rows
          ).toHaveLength(1);
          await transaction.execute(
            buildInsertInboxV2MessageReactionTransitionSql({
              commit: invalidRequest,
              actionAttributionId: requestAttributionId,
              streamPosition: position("861")
            })
          );
          await transaction.execute(sql`set constraints all immediate`);
        })
      );
      expect(postgresSqlState(requestFsmError)).toBe("23514");
      expect(postgresErrorText(requestFsmError)).toMatch(
        /inbox_v2\.timeline_message_json_contract:inbox_v2_message_reaction_transitions/u
      );
      expect(await loadActionAttributionCount(db, requestAttributionId)).toBe(
        0
      );
      expect(
        await loadProviderReactionPersistenceState(db, creation.message.id)
      ).toEqual({
        reaction_count: "0",
        reaction_revision: null,
        slot_count: "0",
        slot_revision: null,
        transition_count: "0",
        observation_count: "0"
      });
      await expect(
        repository.applyReaction({
          commit: requestCommit,
          streamPosition: position("861")
        })
      ).resolves.toMatchObject({
        kind: "appended",
        envelope: { streamPosition: "861", entityRevision: "1" }
      });
      expect(
        await loadProviderResultReactionState(
          db,
          requestCommit.afterReaction.id
        )
      ).toEqual({
        reaction_state: "pending_external",
        reaction_outcome: null,
        reaction_revision: "1",
        reaction_stream_position: "861",
        slot_state: "pending_external",
        slot_revision: "1",
        transition_count: "1",
        provider_result_count: "0",
        route_consumption_count: "1"
      });

      const terminalCommit = providerResultTerminalReactionCommit(
        requestCommit,
        `${suffix}-result`
      );
      expect(terminalCommit.transition.externalAuthority).toBeNull();
      const terminalAttributionId = derivedInboxV2Id(
        "action_attribution",
        terminalCommit.transition.id
      );
      const invalidTerminalState =
        tamperedProviderResultStateCommit(terminalCommit);
      const resultFsmError = await capturePostgresError(
        db.transaction(async (transaction) => {
          expect(
            (
              await transaction.execute(
                buildInsertInboxV2ActionAttributionSql({
                  tenantId,
                  id: terminalAttributionId,
                  conversationId: creation.message.conversation.id,
                  attribution:
                    invalidTerminalState.transition.actionAttribution,
                  createdAt: invalidTerminalState.transition.recordedAt
                })
              )
            ).rows
          ).toHaveLength(1);
          await transaction.execute(
            buildInsertInboxV2MessageReactionTransitionSql({
              commit: invalidTerminalState,
              actionAttributionId: terminalAttributionId,
              streamPosition: position("862")
            })
          );
          await transaction.execute(sql`set constraints all immediate`);
        })
      );
      expect(postgresSqlState(resultFsmError)).toBe("23514");
      expect(postgresErrorText(resultFsmError)).toMatch(
        /inbox_v2\.timeline_message_json_contract:inbox_v2_message_reaction_transitions/u
      );
      expect(await loadActionAttributionCount(db, terminalAttributionId)).toBe(
        0
      );
      expect(
        await loadProviderResultReactionState(
          db,
          requestCommit.afterReaction.id
        )
      ).toEqual({
        reaction_state: "pending_external",
        reaction_outcome: null,
        reaction_revision: "1",
        reaction_stream_position: "861",
        slot_state: "pending_external",
        slot_revision: "1",
        transition_count: "1",
        provider_result_count: "0",
        route_consumption_count: "1"
      });
      const tamperedCommit =
        tamperedProviderResultReactionCommit(terminalCommit);
      const proofError = await capturePostgresError(
        db.transaction(async (transaction) => {
          expect(
            (
              await transaction.execute(
                buildInsertInboxV2ActionAttributionSql({
                  tenantId,
                  id: terminalAttributionId,
                  conversationId: creation.message.conversation.id,
                  attribution: tamperedCommit.transition.actionAttribution,
                  createdAt: tamperedCommit.transition.recordedAt
                })
              )
            ).rows
          ).toHaveLength(1);
          await transaction.execute(
            buildInsertInboxV2MessageReactionTransitionSql({
              commit: tamperedCommit,
              actionAttributionId: terminalAttributionId,
              streamPosition: position("862")
            })
          );
          await transaction.execute(sql`set constraints all immediate`);
        })
      );
      expect(postgresSqlState(proofError)).toBe("23514");
      expect(postgresErrorText(proofError)).toMatch(
        /inbox_v2\.(?:timeline_message_json_contract|message_reaction(?:_transition)?_coherence)/u
      );
      expect(await loadActionAttributionCount(db, terminalAttributionId)).toBe(
        0
      );
      expect(
        await loadProviderResultReactionState(
          db,
          requestCommit.afterReaction.id
        )
      ).toEqual({
        reaction_state: "pending_external",
        reaction_outcome: null,
        reaction_revision: "1",
        reaction_stream_position: "861",
        slot_state: "pending_external",
        slot_revision: "1",
        transition_count: "1",
        provider_result_count: "0",
        route_consumption_count: "1"
      });

      await expect(
        repository.applyReaction({
          commit: terminalCommit,
          streamPosition: position("862")
        })
      ).resolves.toMatchObject({
        kind: "appended",
        envelope: { streamPosition: "862", entityRevision: "2" }
      });
      const terminalState = {
        reaction_state: "external_terminal",
        reaction_outcome: "failed",
        reaction_revision: "2",
        reaction_stream_position: "862",
        slot_state: "external_terminal",
        slot_revision: "2",
        transition_count: "2",
        provider_result_count: "1",
        route_consumption_count: "1"
      };
      expect(
        await loadProviderResultReactionState(
          db,
          requestCommit.afterReaction.id
        )
      ).toEqual(terminalState);
      await expect(
        repository.applyReaction({
          commit: terminalCommit,
          streamPosition: position("9862")
        })
      ).resolves.toMatchObject({
        kind: "already_applied",
        envelope: { streamPosition: "862", entityRevision: "2" }
      });
      expect(
        await loadProviderResultReactionState(
          db,
          requestCommit.afterReaction.id
        )
      ).toEqual(terminalState);
    });

    it("advances one provider-thread lifecycle head through a second source account and binding", async () => {
      const repository = createSqlInboxV2TimelineMessageRepository(db);
      const creation = sourceOutboundCreationCommit(
        "provider-cross-account-head",
        { threadScope: "source_connection" }
      );
      const externalMessageReference = creation.externalMessageReference;
      if (externalMessageReference === null) {
        throw new Error(
          "Cross-account fixture requires an external reference."
        );
      }
      expect(externalMessageReference.key.scope).toEqual({
        kind: "provider_thread"
      });
      const accountAContext = await seedExternalCreationAnchors(
        db,
        creation,
        "provider-cross-account-head"
      );
      await expect(
        createSourceMessage(
          historicalTimelineFixtureRepository(db),
          creation,
          "900"
        )
      ).resolves.toMatchObject({ kind: "created" });

      const firstCommit = providerObservedLifecycleCreationCommit(
        creation,
        "provider-cross-account-head"
      );
      const firstOrderingCommit =
        requireProviderSemanticOrderingCommit(firstCommit);
      await expect(
        repository.createProviderLifecycleOperation({
          commit: firstCommit,
          streamPosition: position("901")
        })
      ).resolves.toMatchObject({
        kind: "appended",
        envelope: { streamPosition: "901", entityRevision: "1" }
      });
      expect(
        await loadProviderSemanticOrderingHeadProvenance(
          db,
          firstOrderingCommit
        )
      ).toEqual([
        {
          source_account_id: firstOrderingCommit.after.sourceAccount.id,
          source_thread_binding_id:
            firstOrderingCommit.after.sourceThreadBinding.id,
          binding_generation: firstOrderingCommit.after.bindingGeneration,
          normalized_inbound_event_id:
            firstOrderingCommit.after.normalizedInboundEvent.id,
          position: "1",
          revision: "1",
          last_changed_stream_position: "901"
        }
      ]);

      const accountBContext = await seedCrossAccountBinding({
        db,
        creation,
        sourceConnection: accountAContext.sourceConnection,
        suffix: "provider-cross-account-head-b"
      });
      const accountBEvidenceResolution = additionalProviderOccurrenceResolution(
        creation,
        "provider-cross-account-head-b-evidence",
        {
          bindingContext: accountBContext.bindingContext,
          direction: "system",
          providerActor: {
            kind: "provider_system",
            actorKindId: inboxV2CatalogIdSchema.parse(
              "module:synthetic:service-event"
            ),
            actorSubject: "provider-system"
          }
        }
      );
      const accountBEventOrigin = accountBEvidenceResolution.after.origin;
      if (
        accountBEventOrigin.kind === "provider_response" ||
        accountBEventOrigin.kind === "provider_echo"
      ) {
        throw new Error("Cross-account evidence must be event-backed.");
      }
      expect(accountBEventOrigin.normalizedInboundEvent.id).not.toBe(
        firstOrderingCommit.after.normalizedInboundEvent.id
      );
      expect(accountBEvidenceResolution.after.id).not.toBe(
        firstCommit.sourceOccurrence.id
      );
      const accountBEvidence = await seedAdditionalProviderSemanticOccurrence({
        db,
        creation,
        context: accountBContext,
        resolution: accountBEvidenceResolution,
        suffix: "provider-cross-account-head-b-evidence"
      });
      const successorCommit =
        crossAccountAdvancedProviderObservedLifecycleCreationCommit(
          firstCommit,
          "provider-cross-account-head-successor",
          accountBEvidence
        );
      const successorOrderingCommit =
        requireProviderSemanticOrderingCommit(successorCommit);
      expect(successorOrderingCommit).toMatchObject({
        before: {
          sourceAccount: firstOrderingCommit.after.sourceAccount,
          sourceThreadBinding: firstOrderingCommit.after.sourceThreadBinding,
          normalizedInboundEvent:
            firstOrderingCommit.after.normalizedInboundEvent
        },
        after: {
          sourceAccount: accountBContext.bindingContext.sourceAccount,
          sourceThreadBinding:
            accountBContext.bindingContext.sourceThreadBinding,
          bindingGeneration: accountBContext.bindingContext.bindingGeneration,
          normalizedInboundEvent: accountBEventOrigin.normalizedInboundEvent,
          position: "2",
          revision: "2"
        }
      });
      await expect(
        repository.createProviderLifecycleOperation({
          commit: successorCommit,
          streamPosition: position("902")
        })
      ).resolves.toMatchObject({
        kind: "appended",
        envelope: { streamPosition: "902", entityRevision: "1" }
      });
      expect(
        await loadProviderSemanticOrderingHeadProvenance(
          db,
          successorOrderingCommit
        )
      ).toEqual([
        {
          source_account_id: accountBContext.bindingContext.sourceAccount.id,
          source_thread_binding_id:
            accountBContext.bindingContext.sourceThreadBinding.id,
          binding_generation: accountBContext.bindingContext.bindingGeneration,
          normalized_inbound_event_id:
            successorOrderingCommit.after.normalizedInboundEvent.id,
          position: "2",
          revision: "2",
          last_changed_stream_position: "902"
        }
      ]);
      expect(
        await loadCrossAccountProviderThreadTopology(db, {
          externalMessageReferenceId: externalMessageReference.id,
          bindingIds: [
            firstOrderingCommit.after.sourceThreadBinding.id,
            accountBContext.bindingContext.sourceThreadBinding.id
          ]
        })
      ).toEqual({
        binding_count: "2",
        source_account_count: "2",
        external_thread_count: "1",
        external_message_scope_kind: "provider_thread"
      });
      expect(
        await loadProviderLifecycleOperationCountForMessage(
          db,
          creation.message.id
        )
      ).toBe(2);
    });

    it("attributes provider-system edits only to a same-conversation system participant", async () => {
      const suffix = "provider-system-edit";
      const repository = createSqlInboxV2TimelineMessageRepository(db);
      const creation = sourceOutboundCreationCommit(suffix);
      const context = await seedExternalCreationAnchors(db, creation, suffix);
      await expect(
        createSourceMessage(
          historicalTimelineFixtureRepository(db),
          creation,
          "920"
        )
      ).resolves.toMatchObject({ kind: "created" });
      const systemResolution = additionalProviderOccurrenceResolution(
        creation,
        `${suffix}-occurrence`,
        {
          direction: "system",
          providerActor: {
            kind: "provider_system",
            actorKindId: inboxV2CatalogIdSchema.parse(
              "module:synthetic:service-event"
            ),
            actorSubject: "provider-system"
          }
        }
      );
      const systemOccurrence = await seedAdditionalProviderSemanticOccurrence({
        db,
        creation,
        context,
        resolution: systemResolution,
        suffix: `${suffix}-occurrence`
      });
      const systemParticipant = providerSystemParticipant(
        creation,
        `${suffix}-participant`
      );
      await seedProviderSystemParticipant(db, systemParticipant);
      const lifecycleCreation = providerObservedLifecycleCreationCommit(
        creation,
        `${suffix}-operation`,
        { action: "edit", sourceOccurrence: systemOccurrence }
      );
      await expect(
        repository.createProviderLifecycleOperation({
          commit: lifecycleCreation,
          streamPosition: position("921")
        })
      ).resolves.toMatchObject({ kind: "appended" });
      const validMutation = providerObservedEditMutation(
        creation,
        lifecycleCreation,
        systemParticipant,
        `${suffix}-revision`
      );
      const invalidAttribution = {
        ...validMutation.revision.actionAttribution,
        actionParticipant: creation.message.authorParticipant
      };
      const invalidError = await capturePostgresError(
        attemptRawMessageMutationWithAttribution(
          db,
          validMutation,
          invalidAttribution,
          position("922")
        )
      );
      expect(postgresSqlState(invalidError)).toBe("23514");
      expect(postgresErrorText(invalidError)).toContain(
        "inbox_v2.message_revision_history_coherence"
      );
      await expect(
        repository.mutateMessage({
          commit: validMutation,
          streamPosition: position("922")
        })
      ).resolves.toMatchObject({
        kind: "applied",
        message: { revision: "2", content: { stateKind: "available" } }
      });
      const history = await repository.listMessageHistory({
        tenantId,
        messageId: creation.message.id,
        afterRevision: null,
        limit: 10
      });
      expect(history?.revisions[1]?.actionAttribution).toMatchObject({
        actionParticipant: {
          id: systemParticipant.id
        },
        appActor: null,
        sourceOccurrence: { id: systemOccurrence.id }
      });
    });

    it("attributes provider-system deletes only to a same-conversation system participant", async () => {
      const suffix = "provider-system-delete";
      const repository = createSqlInboxV2TimelineMessageRepository(db);
      const creation = sourceOutboundCreationCommit(suffix);
      const context = await seedExternalCreationAnchors(db, creation, suffix);
      await expect(
        createSourceMessage(
          historicalTimelineFixtureRepository(db),
          creation,
          "930"
        )
      ).resolves.toMatchObject({ kind: "created" });
      const systemResolution = additionalProviderOccurrenceResolution(
        creation,
        `${suffix}-occurrence`,
        {
          direction: "system",
          providerActor: {
            kind: "provider_system",
            actorKindId: inboxV2CatalogIdSchema.parse(
              "module:synthetic:service-event"
            ),
            actorSubject: "provider-system"
          }
        }
      );
      const systemOccurrence = await seedAdditionalProviderSemanticOccurrence({
        db,
        creation,
        context,
        resolution: systemResolution,
        suffix: `${suffix}-occurrence`
      });
      const systemParticipant = providerSystemParticipant(
        creation,
        `${suffix}-participant`
      );
      await seedProviderSystemParticipant(db, systemParticipant);
      const lifecycleCreation = providerObservedLifecycleCreationCommit(
        creation,
        `${suffix}-operation`,
        { action: "delete", sourceOccurrence: systemOccurrence }
      );
      await expect(
        repository.createProviderLifecycleOperation({
          commit: lifecycleCreation,
          streamPosition: position("931")
        })
      ).resolves.toMatchObject({ kind: "appended" });

      const policyEventId = `event:db005-${suffix}-policy-${runId}`;
      await db.execute(sql`
        insert into event_store (
          id, tenant_id, type, version, occurred_at, idempotency_key,
          payload, created_at, updated_at
        ) values (
          ${policyEventId}, ${tenantId},
          'inbox_v2.message.provider_delete_policy_decided', 'v1', ${t4},
          ${`db005-${suffix}-policy-${runId}`},
          ${JSON.stringify({
            actionKind: "provider_delete_policy",
            entityKind: "message_provider_lifecycle_operation",
            entityId: lifecycleCreation.operation.id,
            effect: "tombstone_local"
          })}::jsonb,
          ${t4}, ${t4}
        )
      `);
      const lifecycleTransition = providerLifecyclePolicyTransitionCommit(
        lifecycleCreation,
        policyEventId,
        "tombstone_local",
        t4
      );
      await expect(
        repository.transitionProviderLifecycleOperation({
          commit: lifecycleTransition,
          streamPosition: position("932")
        })
      ).resolves.toMatchObject({ kind: "appended" });
      const validMutation = providerDeleteTombstoneMutation(
        creation,
        lifecycleCreation,
        lifecycleTransition,
        `${suffix}-revision`,
        systemParticipant
      );
      const invalidAttribution = {
        ...validMutation.revision.actionAttribution,
        actionParticipant: creation.message.authorParticipant
      };
      const invalidError = await capturePostgresError(
        attemptRawMessageMutationWithAttribution(
          db,
          validMutation,
          invalidAttribution,
          position("933")
        )
      );
      expect(postgresSqlState(invalidError)).toBe("23514");
      expect(postgresErrorText(invalidError)).toContain(
        "inbox_v2.message_revision_history_coherence"
      );
      await expect(
        repository.mutateMessage({
          commit: validMutation,
          streamPosition: position("933")
        })
      ).resolves.toMatchObject({
        kind: "applied",
        message: {
          revision: "2",
          lifecycle: { kind: "provider_delete_tombstone" }
        }
      });
      const history = await repository.listMessageHistory({
        tenantId,
        messageId: creation.message.id,
        afterRevision: null,
        limit: 10
      });
      expect(history?.revisions[1]?.actionAttribution).toMatchObject({
        actionParticipant: { id: systemParticipant.id },
        appActor: null,
        sourceOccurrence: { id: systemOccurrence.id }
      });
    });
  }
);

function creationCommit(suffix: string): InboxV2MessageCreationCommit {
  return inboxV2MessageCreationCommitSchema.parse(
    namespaceFixture(fixtureInternalCreationCommit(), suffix)
  );
}

function staffNoteCreationCommit(
  anchors: InboxV2MessageCreationCommit,
  suffix: string
) {
  const baseItem = anchors.timelineAllocation.items[0];
  const appActor = anchors.message.appActor;
  if (baseItem === undefined || appActor?.kind !== "employee") {
    throw new Error("StaffNote fixture requires one employee-authored item.");
  }
  const staffNoteId = `staff_note:db005-${suffix}-${runId}`;
  const content = inboxV2TimelineContentSchema.parse({
    ...anchors.content,
    id: `timeline_content:db005-${suffix}-${runId}`,
    state: {
      kind: "available",
      blocks: [
        {
          blockKey: "body-1",
          kind: "text",
          role: "body",
          text: "Staff-only note",
          language: "en"
        }
      ],
      contentDigestSha256: "4".repeat(64)
    }
  });
  const staffNoteReference = fixtureReference(
    "staff_note",
    staffNoteId,
    tenantId
  );
  const timelineItem = {
    ...baseItem,
    subject: {
      kind: "staff_note" as const,
      staffNote: staffNoteReference,
      staffNoteRevision: "1"
    },
    visibility: "staff_only" as const
  };
  const staffNote = {
    tenantId,
    id: staffNoteId,
    conversation: anchors.message.conversation,
    timelineItem: fixtureReference("timeline_item", timelineItem.id, tenantId),
    authorParticipant: anchors.message.authorParticipant,
    appActor,
    automationCausation: null,
    content: inboxV2TimelineContentHeadOf(content),
    revision: "1",
    createdAt: content.createdAt,
    updatedAt: content.updatedAt
  };
  return inboxV2StaffNoteCreationCommitSchema.parse({
    tenantId,
    timelineAllocation: {
      ...anchors.timelineAllocation,
      items: [timelineItem]
    },
    authorParticipant: anchors.authorParticipant,
    content,
    initialRevision: {
      tenantId,
      id: `staff_note_revision:db005-${suffix}-created-${runId}`,
      staffNote: staffNoteReference,
      timelineItem: staffNote.timelineItem,
      expectedPreviousRevision: null,
      staffNoteRevision: "1",
      change: { kind: "created", content: staffNote.content },
      actionAttribution: {
        actionParticipant: staffNote.authorParticipant,
        appActor,
        automationCausation: null
      },
      occurredAt: timelineItem.occurredAt,
      recordedAt: content.createdAt,
      recordRevision: "1",
      createdAt: content.createdAt
    },
    staffNote
  });
}

function staffNoteEditMutation(
  creation: ReturnType<typeof staffNoteCreationCommit>,
  suffix: string
) {
  const beforeTimelineItem = creation.timelineAllocation.items[0];
  if (beforeTimelineItem === undefined) {
    throw new Error("StaffNote edit fixture requires one TimelineItem.");
  }
  const afterContent = inboxV2TimelineContentSchema.parse({
    ...creation.content,
    state: {
      kind: "available",
      blocks: [
        {
          blockKey: "body-1",
          kind: "text",
          role: "body",
          text: "Edited staff-only note",
          language: "en"
        }
      ],
      contentDigestSha256: "5".repeat(64)
    },
    revision: "2",
    updatedAt: t3
  });
  const afterStaffNote = {
    ...creation.staffNote,
    content: inboxV2TimelineContentHeadOf(afterContent),
    revision: "2",
    updatedAt: t3
  };
  const afterTimelineItem = {
    ...beforeTimelineItem,
    subject: {
      kind: "staff_note" as const,
      staffNote: creation.initialRevision.staffNote,
      staffNoteRevision: "2"
    },
    revision: "2",
    updatedAt: t3
  };
  const event = fixtureReference(
    "event",
    `event:db005-${suffix}-${runId}`,
    tenantId
  );
  return inboxV2StaffNoteMutationCommitSchema.parse({
    tenantId,
    beforeStaffNote: creation.staffNote,
    beforeTimelineItem,
    authorParticipantSnapshot: creation.authorParticipant,
    actionParticipantSnapshot: creation.authorParticipant,
    contentTransition: {
      tenantId,
      before: creation.content,
      transition: {
        kind: "edit",
        expectedRevision: "1",
        resultingRevision: "2",
        event,
        occurredAt: t3
      },
      after: afterContent
    },
    revision: {
      tenantId,
      id: `staff_note_revision:db005-${suffix}-${runId}`,
      staffNote: creation.initialRevision.staffNote,
      timelineItem: creation.initialRevision.timelineItem,
      expectedPreviousRevision: "1",
      staffNoteRevision: "2",
      change: {
        kind: "edited",
        beforeContent: creation.staffNote.content,
        afterContent: afterStaffNote.content
      },
      actionAttribution: {
        actionParticipant: creation.staffNote.authorParticipant,
        appActor: creation.staffNote.appActor,
        automationCausation: null
      },
      occurredAt: t3,
      recordedAt: t3,
      recordRevision: "1",
      createdAt: t3
    },
    afterStaffNote,
    afterTimelineItem
  });
}

function replyCreationCommit(
  target: InboxV2MessageCreationCommit,
  suffix: string
): InboxV2MessageCreationCommit {
  const base = creationCommit(suffix);
  const targetTimelineItem = target.timelineAllocation.items[0];
  const baseTimelineItem = base.timelineAllocation.items[0];
  if (targetTimelineItem === undefined || baseTimelineItem === undefined) {
    throw new Error(
      "Resolved reply fixture requires one target and reply item."
    );
  }
  const messageReference = {
    tenantId,
    kind: "message" as const,
    id: base.message.id
  };
  const timelineItemReference = {
    tenantId,
    kind: "timeline_item" as const,
    id: baseTimelineItem.id
  };
  const timelineItem = {
    ...baseTimelineItem,
    conversation: target.message.conversation,
    timelineSequence: "2",
    subject: {
      kind: "message" as const,
      message: messageReference,
      messageRevision: "1"
    }
  };
  const referenceContext = {
    kind: "reply" as const,
    target: {
      state: "resolved_internal" as const,
      canonical: {
        message: {
          tenantId,
          kind: "message" as const,
          id: target.message.id
        },
        timelineItem: {
          tenantId,
          kind: "timeline_item" as const,
          id: targetTimelineItem.id
        },
        messageRevision: target.message.revision
      }
    }
  };
  const message = {
    ...base.message,
    conversation: target.message.conversation,
    timelineItem: timelineItemReference,
    authorParticipant: target.message.authorParticipant,
    appActor: target.message.appActor,
    referenceContext
  };
  const conversationBefore = target.timelineAllocation.conversationAfter;
  const conversationAfter = {
    ...conversationBefore,
    head: {
      ...conversationBefore.head,
      latestTimelineSequence: "2",
      latestActivityItemId: timelineItem.id,
      latestActivityTimelineSequence: "2",
      latestActivityAt: timelineItem.occurredAt,
      revision: (BigInt(conversationBefore.head.revision) + 1n).toString(),
      updatedAt: base.timelineAllocation.committedAt
    }
  };

  return inboxV2MessageCreationCommitSchema.parse({
    ...base,
    timelineAllocation: {
      tenantId,
      conversationBefore,
      items: [timelineItem],
      conversationAfter,
      committedAt: base.timelineAllocation.committedAt
    },
    authorParticipant: target.authorParticipant,
    message,
    initialRevision: {
      ...base.initialRevision,
      message: messageReference,
      timelineItem: timelineItemReference,
      actionAttribution: {
        ...base.initialRevision.actionAttribution,
        actionParticipant: target.message.authorParticipant,
        appActor: target.message.appActor
      }
    },
    canonicalReferenceTargets: [
      { message: target.message, timelineItem: targetTimelineItem }
    ]
  });
}

function sourceOutboundCreationCommit(
  suffix: string,
  options: { threadScope?: "source_account" | "source_connection" } = {}
): InboxV2MessageCreationCommit {
  const base = namespaceFixture(fixtureSourceCreationCommit(), suffix);
  const occurrence = namespaceFixture(
    fixtureOccurrence({ direction: "outbound" }),
    suffix
  );
  const externalMessageReference = namespaceFixture(
    fixtureExternalReference(fixtureOccurrence({ direction: "outbound" })),
    suffix
  );
  const sourceResolutionCommit = namespaceFixture(
    fixtureOccurrenceResolutionCommit(
      fixtureOccurrence({ direction: "outbound" })
    ),
    suffix
  );
  const originTransportLink = namespaceFixture(
    fixtureTransportLink(
      fixtureOccurrence({ direction: "outbound" }),
      "native_outbound"
    ),
    suffix
  );
  const originTransportLinkHead = {
    ...base.originTransportLinkHead,
    latestLink: {
      tenantId,
      kind: "message_transport_occurrence_link" as const,
      id: originTransportLink.id
    }
  };
  const externalThreadMapping =
    options.threadScope !== "source_connection" ||
    base.externalThreadMapping === null
      ? base.externalThreadMapping
      : {
          ...base.externalThreadMapping,
          thread: {
            ...base.externalThreadMapping.thread,
            key: {
              ...base.externalThreadMapping.thread.key,
              scope: {
                kind: "source_connection" as const,
                owner: namespaceFixture(
                  fixtureSourceConnectionReference,
                  suffix
                )
              }
            },
            identityDeclaration: {
              ...base.externalThreadMapping.thread.identityDeclaration,
              scopeKind: "source_connection" as const,
              decisionStrength: "authoritative" as const
            }
          }
        };

  return inboxV2MessageCreationCommitSchema.parse({
    ...base,
    message: {
      ...base.message,
      origin: {
        ...base.message.origin,
        direction: "outbound"
      }
    },
    sourceOccurrence: occurrence,
    sourceResolutionCommit,
    externalMessageReference,
    externalThreadMapping,
    originTransportLink,
    originTransportLinkHead
  });
}

function rebaseMessageCreationCommit(
  commit: InboxV2MessageCreationCommit,
  conversationBefore: InboxV2MessageCreationCommit["timelineAllocation"]["conversationBefore"]
): InboxV2MessageCreationCommit {
  const originalItem = commit.timelineAllocation.items[0];
  if (originalItem === undefined) {
    throw new Error("Timeline race fixture requires one Message item.");
  }
  const conversation = fixtureReference(
    "conversation",
    conversationBefore.id,
    tenantId
  );
  const timelineSequence = String(
    BigInt(conversationBefore.head.latestTimelineSequence) + 1n
  );
  const item = {
    ...originalItem,
    conversation,
    timelineSequence
  };
  const authorParticipant = {
    ...commit.authorParticipant,
    conversation
  };
  const message = {
    ...commit.message,
    conversation,
    authorParticipant: fixtureReference(
      "conversation_participant",
      authorParticipant.id,
      tenantId
    )
  };
  const conversationAfter = {
    ...conversationBefore,
    head: {
      ...conversationBefore.head,
      latestTimelineSequence: timelineSequence,
      latestActivityItemId: item.id,
      latestActivityTimelineSequence: timelineSequence,
      latestActivityAt: item.occurredAt,
      revision: String(BigInt(conversationBefore.head.revision) + 1n),
      updatedAt: commit.timelineAllocation.committedAt
    }
  };
  return inboxV2MessageCreationCommitSchema.parse({
    ...commit,
    timelineAllocation: {
      tenantId,
      conversationBefore,
      items: [item],
      conversationAfter,
      committedAt: commit.timelineAllocation.committedAt
    },
    authorParticipant,
    message,
    initialRevision: {
      ...commit.initialRevision,
      actionAttribution: {
        ...commit.initialRevision.actionAttribution,
        actionParticipant: message.authorParticipant
      }
    },
    externalThreadMapping:
      commit.externalThreadMapping === null
        ? null
        : {
            ...commit.externalThreadMapping,
            conversation: conversationBefore
          }
  });
}

function providerNativeOutboundCreationCommit(input: {
  anchor: InboxV2MessageCreationCommit;
  suffix: string;
}): InboxV2MessageCreationCommit {
  const raw = sourceOutboundCreationCommit(input.suffix);
  const rawOccurrence = requireSourceOccurrence(raw);
  const anchorOccurrence = requireSourceOccurrence(input.anchor);
  const rawResolution = raw.sourceResolutionCommit;
  const rawReference = raw.externalMessageReference;
  const rawLink = raw.originTransportLink;
  if (
    rawResolution === null ||
    rawReference === null ||
    rawLink === null ||
    input.anchor.externalThreadMapping === null ||
    anchorOccurrence.providerActor?.kind !== "source_external_identity"
  ) {
    throw new Error(
      "Provider-native race fixture requires one resolved source transport graph."
    );
  }
  if (
    rawOccurrence.origin.kind === "provider_response" ||
    rawOccurrence.origin.kind === "provider_echo"
  ) {
    throw new Error(
      "Provider-native race fixture requires event-backed outbound evidence."
    );
  }
  const occurrence = {
    ...rawOccurrence,
    messageKey: {
      ...rawOccurrence.messageKey,
      externalThread: anchorOccurrence.bindingContext.externalThread,
      canonicalExternalSubject: `provider-native:${input.suffix}:${runId}`
    },
    bindingContext: anchorOccurrence.bindingContext,
    origin: {
      ...rawOccurrence.origin,
      sourceAccount: anchorOccurrence.bindingContext.sourceAccount
    },
    providerActor: anchorOccurrence.providerActor,
    providerTimestamps: rawOccurrence.providerTimestamps.map((timestamp) => ({
      ...timestamp,
      timestamp: fixtureT0
    }))
  };
  const externalMessageReference = {
    ...rawReference,
    key: occurrence.messageKey,
    externalThread: anchorOccurrence.bindingContext.externalThread
  };
  const sourceResolutionCommit = {
    ...rawResolution,
    before: {
      ...occurrence,
      resolution: rawResolution.before.resolution,
      revision: rawResolution.before.revision
    },
    after: occurrence,
    resolvedReference: externalMessageReference
  };
  const authorParticipant = input.anchor.authorParticipant;
  const message = {
    ...raw.message,
    conversation: input.anchor.message.conversation,
    authorParticipant: fixtureReference(
      "conversation_participant",
      authorParticipant.id,
      tenantId
    ),
    origin: {
      ...raw.message.origin,
      originOccurrence: fixtureReference(
        "source_occurrence",
        occurrence.id,
        tenantId
      ),
      direction: "outbound" as const
    }
  };
  const originTransportLink = {
    ...rawLink,
    sourceOccurrence: fixtureReference(
      "source_occurrence",
      occurrence.id,
      tenantId
    ),
    externalMessageReference: fixtureReference(
      "external_message_reference",
      externalMessageReference.id,
      tenantId
    )
  };
  return rebaseMessageCreationCommit(
    {
      ...raw,
      authorParticipant,
      message,
      initialRevision: {
        ...raw.initialRevision,
        actionAttribution: {
          ...raw.initialRevision.actionAttribution,
          actionParticipant: message.authorParticipant,
          sourceOccurrence: fixtureReference(
            "source_occurrence",
            occurrence.id,
            tenantId
          )
        }
      },
      sourceOccurrence: occurrence,
      sourceResolutionCommit,
      externalMessageReference,
      originTransportLink,
      externalThreadMapping: input.anchor.externalThreadMapping
    } as unknown as InboxV2MessageCreationCommit,
    input.anchor.timelineAllocation.conversationBefore
  );
}

function rebaseSystemEventTimelineCommit(
  commit: InboxV2SystemEventTimelineCreationCommit,
  conversationBefore: InboxV2SystemEventTimelineCreationCommit["timelineAllocation"]["conversationBefore"]
): InboxV2SystemEventTimelineCreationCommit {
  const originalItem = commit.timelineAllocation.items[0];
  if (originalItem === undefined) {
    throw new Error("Timeline race fixture requires one system item.");
  }
  const conversation = fixtureReference(
    "conversation",
    conversationBefore.id,
    tenantId
  );
  const timelineSequence = String(
    BigInt(conversationBefore.head.latestTimelineSequence) + 1n
  );
  const item = {
    ...originalItem,
    conversation,
    timelineSequence
  };
  return inboxV2SystemEventTimelineCreationCommitSchema.parse({
    ...commit,
    timelineAllocation: {
      tenantId,
      conversationBefore,
      items: [item],
      conversationAfter: {
        ...conversationBefore,
        head: {
          ...conversationBefore.head,
          latestTimelineSequence: timelineSequence,
          revision: String(BigInt(conversationBefore.head.revision) + 1n),
          updatedAt: commit.timelineAllocation.committedAt
        }
      },
      committedAt: commit.timelineAllocation.committedAt
    },
    source: {
      ...commit.source,
      conversation
    }
  });
}

function huleeExternalCreationCommit(input: {
  binding: Awaited<
    ReturnType<typeof seedExternalCreationAnchors>
  >["bindingProjection"]["binding"];
  creation: InboxV2MessageCreationCommit;
  operator: ReturnType<typeof fixtureParticipant>;
  route: ReturnType<typeof inboxV2OutboundRouteSchema.parse>;
  suffix: string;
}) {
  const raw = namespaceFixture(fixtureHuleeCreationCommit(), input.suffix);
  const rawTimelineItem = raw.timelineAllocation.items[0];
  if (
    rawTimelineItem === undefined ||
    raw.outboundDispatch === null ||
    raw.routeConsumption === null ||
    input.operator.subject.kind !== "employee"
  ) {
    throw new Error(
      "Hulee-external creation fixture requires one item, route consumption and queued dispatch."
    );
  }
  const conversation = input.creation.timelineAllocation.conversationBefore;
  const messageReference = fixtureReference(
    "message",
    raw.message.id,
    tenantId
  );
  const timelineItemReference = fixtureReference(
    "timeline_item",
    rawTimelineItem.id,
    tenantId
  );
  const authorParticipant = fixtureReference(
    "conversation_participant",
    input.operator.id,
    tenantId
  );
  const routeReference = fixtureReference(
    "outbound_route",
    input.route.id,
    tenantId
  );
  const appActor = {
    kind: "employee" as const,
    employee: input.operator.subject.employee,
    authorizationEpoch: input.route.authorizationEpoch
  };
  const timelineItem = {
    ...rawTimelineItem,
    conversation: input.creation.message.conversation,
    subject: {
      kind: "message" as const,
      message: messageReference,
      messageRevision: "1"
    }
  };
  const message = {
    ...raw.message,
    conversation: input.creation.message.conversation,
    timelineItem: timelineItemReference,
    authorParticipant,
    origin: {
      kind: "hulee_external" as const,
      outboundRoute: routeReference
    },
    appActor
  };
  const conversationAfter = {
    ...conversation,
    head: {
      ...conversation.head,
      latestTimelineSequence: timelineItem.timelineSequence,
      latestActivityItemId: timelineItem.id,
      latestActivityTimelineSequence: timelineItem.timelineSequence,
      latestActivityAt: timelineItem.occurredAt,
      revision: (BigInt(conversation.head.revision) + 1n).toString(),
      updatedAt: raw.timelineAllocation.committedAt
    }
  };
  return inboxV2MessageCreationCommitSchema.parse({
    ...raw,
    timelineAllocation: {
      tenantId,
      conversationBefore: conversation,
      items: [timelineItem],
      conversationAfter,
      committedAt: raw.timelineAllocation.committedAt
    },
    authorParticipant: input.operator,
    message,
    initialRevision: {
      ...raw.initialRevision,
      message: messageReference,
      timelineItem: timelineItemReference,
      actionAttribution: {
        ...raw.initialRevision.actionAttribution,
        actionParticipant: authorParticipant,
        appActor
      }
    },
    externalThreadMapping: input.creation.externalThreadMapping,
    outboundRoute: input.route,
    outboundBindingSnapshot: input.binding,
    outboundDispatch: {
      ...raw.outboundDispatch,
      message: messageReference,
      route: routeReference
    },
    routeConsumption: {
      ...raw.routeConsumption,
      outboundRoute: routeReference,
      message: messageReference,
      mutationToken: input.route.mutationToken,
      idempotencyToken: input.route.idempotencyToken,
      correlationToken: input.route.correlationToken,
      consumedByTrustedServiceId:
        input.route.adapterContract.loadedByTrustedServiceId
    }
  });
}

function additionalProviderOccurrenceResolution(
  creation: InboxV2MessageCreationCommit,
  suffix: string,
  options: {
    bindingContext?: NonNullable<
      InboxV2MessageCreationCommit["sourceOccurrence"]
    >["bindingContext"];
    direction?: "outbound" | "system";
    providerActor?: NonNullable<
      InboxV2MessageCreationCommit["sourceOccurrence"]
    >["providerActor"];
  } = {}
) {
  const originOccurrence = requireSourceOccurrence(creation);
  const externalMessageReference = creation.externalMessageReference;
  if (
    externalMessageReference === null ||
    originOccurrence.origin.kind === "provider_response" ||
    originOccurrence.origin.kind === "provider_echo" ||
    originOccurrence.providerActor?.kind !== "source_external_identity"
  ) {
    throw new Error(
      "Additional provider evidence requires an event-backed resolved source occurrence."
    );
  }
  const rawAdditional = namespaceFixture(
    fixtureOccurrence({
      origin: "history",
      direction: "outbound",
      recordedAt: t4,
      occurrenceId: "source_occurrence:provider-semantic-successor"
    }),
    suffix
  );
  if (
    rawAdditional.origin.kind === "provider_response" ||
    rawAdditional.origin.kind === "provider_echo"
  ) {
    throw new Error("Expected event-backed additional provider evidence.");
  }
  const after = {
    ...originOccurrence,
    id: rawAdditional.id,
    bindingContext: options.bindingContext ?? originOccurrence.bindingContext,
    origin: {
      ...rawAdditional.origin,
      sourceAccount:
        options.bindingContext?.sourceAccount ??
        originOccurrence.bindingContext.sourceAccount
    },
    providerActor:
      options.providerActor === undefined
        ? originOccurrence.providerActor
        : options.providerActor,
    direction: options.direction ?? ("outbound" as const),
    resolution: {
      state: "resolved" as const,
      externalMessageReference: fixtureReference(
        "external_message_reference",
        externalMessageReference.id,
        tenantId
      )
    },
    observedAt: t4,
    recordedAt: t4,
    revision: "2",
    createdAt: t4,
    updatedAt: t4
  };
  const base = namespaceFixture(
    fixtureOccurrenceResolutionCommit(
      fixtureOccurrence({
        origin: "history",
        direction: "outbound",
        recordedAt: t4,
        occurrenceId: "source_occurrence:provider-semantic-successor"
      })
    ),
    suffix
  );
  return inboxV2SourceOccurrenceResolutionCommitSchema.parse({
    ...base,
    tenantId,
    changedAt: t4,
    resolver: {
      kind: "trusted_service",
      trustedServiceId:
        originOccurrence.descriptor.adapterContract.loadedByTrustedServiceId,
      resolutionToken: `resolution:db005-provider-semantic-${suffix}-${runId}`
    },
    before: {
      ...after,
      resolution: base.before.resolution,
      revision: "1"
    },
    after,
    resolvedReference: externalMessageReference
  });
}

function internalReactionSetCommit(
  creation: InboxV2MessageCreationCommit,
  suffix: string,
  value: string
) {
  const timelineItem = creation.timelineAllocation.items[0];
  if (timelineItem === undefined || creation.message.appActor === null) {
    throw new Error(
      "Internal reaction fixture requires one app-owned Message."
    );
  }
  const reactionId = `message_reaction:db005-${suffix}-${runId}`;
  const transitionId = `message_reaction_transition:db005-${suffix}-${runId}`;
  const actor = {
    kind: "participant" as const,
    participant: creation.message.authorParticipant
  };
  const capability = {
    kind: "internal" as const,
    cardinality: "multiple_values" as const
  };
  const state = {
    kind: "active" as const,
    value: { kind: "unicode" as const, value }
  };
  const afterReaction = {
    tenantId,
    id: reactionId,
    message: creation.initialRevision.message,
    actor,
    capability,
    semanticSlotKey: inboxV2ReactionSemanticSlotKeyFor({
      message: creation.initialRevision.message,
      actor,
      capability,
      state
    }),
    state,
    revision: "1",
    createdAt: t3,
    updatedAt: t3
  };
  const reactionReference = fixtureReference(
    "message_reaction",
    reactionId,
    tenantId
  );
  const transition = {
    tenantId,
    id: transitionId,
    reaction: reactionReference,
    semanticSlotKey: afterReaction.semanticSlotKey,
    mode: "internal_apply" as const,
    operation: "set" as const,
    expectedRevision: null,
    resultingRevision: "1",
    beforeState: null,
    afterState: state,
    actionAttribution: {
      actionParticipant: creation.message.authorParticipant,
      appActor: creation.message.appActor,
      sourceOccurrence: null,
      automationCausation: creation.message.automationCausation
    },
    externalAuthority: null,
    occurredAt: t3,
    recordedAt: t3,
    recordRevision: "1" as const
  };
  return inboxV2MessageReactionCommitSchema.parse({
    tenantId,
    beforeMessage: creation.message,
    beforeTimelineItem: timelineItem,
    beforeReaction: null,
    transition,
    afterReaction,
    participantSnapshots: [creation.authorParticipant],
    externalAuthorityEvidence: null,
    outboundBindingSnapshot: null,
    routeConsumption: null,
    providerObservation: null,
    providerResultProof: null,
    slotHeadBefore: null,
    slotHeadAfter: {
      tenantId,
      message: creation.initialRevision.message,
      semanticSlotKey: afterReaction.semanticSlotKey,
      reaction: reactionReference,
      state,
      revision: "1",
      updatedAt: t3
    }
  });
}

function internalReactionClearCommit(
  setCommit: ReturnType<typeof internalReactionSetCommit>,
  suffix: string
) {
  const beforeReaction = setCommit.afterReaction;
  if (beforeReaction.state.kind !== "active") {
    throw new Error("Reaction clear fixture requires one active state.");
  }
  const state = {
    kind: "cleared" as const,
    lastValue: beforeReaction.state.value,
    clearedAt: t4
  };
  const afterReaction = {
    ...beforeReaction,
    state,
    revision: "2",
    updatedAt: t4
  };
  const transition = {
    ...setCommit.transition,
    id: `message_reaction_transition:db005-${suffix}-${runId}`,
    operation: "clear" as const,
    expectedRevision: "1",
    resultingRevision: "2",
    beforeState: beforeReaction.state,
    afterState: state,
    occurredAt: t4,
    recordedAt: t4
  };
  return inboxV2MessageReactionCommitSchema.parse({
    ...setCommit,
    beforeReaction,
    transition,
    afterReaction,
    slotHeadBefore: setCommit.slotHeadAfter,
    slotHeadAfter: {
      ...setCommit.slotHeadAfter,
      state,
      revision: "2",
      updatedAt: t4
    }
  });
}

function tamperedInternalReactionClearLastValueCommit(
  commit: ReturnType<typeof internalReactionClearCommit>
) {
  const clone = structuredClone(commit);
  if (
    clone.transition.beforeState?.kind !== "active" ||
    clone.transition.afterState.kind !== "cleared"
  ) {
    throw new Error("Clear tamper requires one active-to-cleared transition.");
  }
  return {
    ...clone,
    transition: {
      ...clone.transition,
      afterState: {
        ...clone.transition.afterState,
        lastValue: { kind: "unicode", value: "❌" }
      }
    }
  } as unknown as ReturnType<typeof internalReactionClearCommit>;
}

function nonMonotonicReactionHeadCommit(
  commit: ReturnType<typeof internalReactionClearCommit>
) {
  const clone = structuredClone(commit);
  return {
    ...clone,
    afterReaction: {
      ...clone.afterReaction,
      updatedAt: fixtureT0
    },
    slotHeadAfter: {
      ...clone.slotHeadAfter,
      updatedAt: fixtureT0
    }
  } as unknown as ReturnType<typeof internalReactionClearCommit>;
}

function providerObservedReactionSetCommit(
  creation: InboxV2MessageCreationCommit,
  suffix: string,
  value: string
) {
  const timelineItem = creation.timelineAllocation.items[0];
  const sourceOccurrence = creation.sourceOccurrence;
  const externalMessageReference = creation.externalMessageReference;
  if (
    timelineItem === undefined ||
    sourceOccurrence === null ||
    externalMessageReference === null ||
    sourceOccurrence.origin.kind === "provider_response" ||
    sourceOccurrence.origin.kind === "provider_echo" ||
    sourceOccurrence.providerActor?.kind !== "source_external_identity"
  ) {
    throw new Error(
      "Provider reaction fixture requires one event-backed resolved source occurrence with a known actor."
    );
  }
  const sourceOccurrenceReference = fixtureReference(
    "source_occurrence",
    sourceOccurrence.id,
    tenantId
  );
  const externalMessageReferenceReference = fixtureReference(
    "external_message_reference",
    externalMessageReference.id,
    tenantId
  );
  const reactionId = `message_reaction:db005-${suffix}-${runId}`;
  const transitionId = `message_reaction_transition:db005-${suffix}-${runId}`;
  const reactionReference = fixtureReference(
    "message_reaction",
    reactionId,
    tenantId
  );
  const actor = {
    kind: "participant" as const,
    participant: creation.message.authorParticipant
  };
  const capability = {
    kind: "external" as const,
    capabilityId: "module:synthetic:reactions",
    capabilityRevision: sourceOccurrence.descriptor.capabilityRevision,
    cardinality: "single_value" as const,
    adapterContract: sourceOccurrence.descriptor.adapterContract
  };
  const state = {
    kind: "active" as const,
    value: { kind: "unicode" as const, value }
  };
  const semanticSlotKey = inboxV2ReactionSemanticSlotKeyFor({
    message: creation.initialRevision.message,
    actor,
    capability,
    state
  });
  const afterReaction = {
    tenantId,
    id: reactionId,
    message: creation.initialRevision.message,
    actor,
    capability,
    semanticSlotKey,
    state,
    revision: "1",
    createdAt: t3,
    updatedAt: t3
  };
  const externalAuthority = {
    externalMessageReference: externalMessageReferenceReference,
    sourceOccurrence: sourceOccurrenceReference,
    sourceAccount: sourceOccurrence.bindingContext.sourceAccount,
    sourceThreadBinding: sourceOccurrence.bindingContext.sourceThreadBinding,
    bindingGeneration: sourceOccurrence.bindingContext.bindingGeneration,
    outboundRoute: null,
    adapterContract: sourceOccurrence.descriptor.adapterContract,
    capabilityFence: {
      capabilityId: capability.capabilityId,
      capabilityRevision: capability.capabilityRevision,
      adapterContract: capability.adapterContract,
      decision: "supported" as const,
      evaluatedAt: sourceOccurrence.observedAt,
      notAfter: t4
    }
  };
  const transition = {
    tenantId,
    id: transitionId,
    reaction: reactionReference,
    semanticSlotKey,
    mode: "provider_observed" as const,
    operation: "set" as const,
    expectedRevision: null,
    resultingRevision: "1",
    beforeState: null,
    afterState: state,
    actionAttribution: {
      actionParticipant: creation.message.authorParticipant,
      appActor: null,
      sourceOccurrence: sourceOccurrenceReference,
      automationCausation: null
    },
    externalAuthority,
    occurredAt: t3,
    recordedAt: t3,
    recordRevision: "1" as const
  };
  const providerSemanticProof = {
    ...fixtureProviderSemanticProof({
      semanticId: "core:message.reaction.set",
      capabilityId: capability.capabilityId,
      capabilityRevision: capability.capabilityRevision,
      normalizedInboundEvent: sourceOccurrence.origin.normalizedInboundEvent,
      externalMessageReference: externalMessageReferenceReference,
      sourceOccurrence: sourceOccurrenceReference,
      actor: sourceOccurrence.providerActor.sourceExternalIdentity,
      occurredAt: t3,
      recordedAt: t3
    }),
    tenantId,
    sourceAccount: sourceOccurrence.bindingContext.sourceAccount,
    sourceThreadBinding: sourceOccurrence.bindingContext.sourceThreadBinding,
    bindingGeneration: sourceOccurrence.bindingContext.bindingGeneration,
    adapterContract: sourceOccurrence.descriptor.adapterContract,
    ordering: {
      kind: "monotonic_exact" as const,
      scopeToken: `ordering:db005-${suffix}-${runId}`,
      position: "1",
      comparatorId: "core:provider-sequence",
      comparatorRevision: "1"
    },
    proofToken: `proof:db005-${suffix}-${runId}`
  };
  const semanticOrderingCommit = {
    tenantId,
    semanticFamilyId: "core:message.reaction" as const,
    before: null,
    proof: providerSemanticProof,
    after: {
      tenantId,
      semanticFamilyId: "core:message.reaction" as const,
      externalMessageReference: externalMessageReferenceReference,
      sourceAccount: providerSemanticProof.sourceAccount,
      sourceThreadBinding: providerSemanticProof.sourceThreadBinding,
      bindingGeneration: providerSemanticProof.bindingGeneration,
      scopeToken: providerSemanticProof.ordering.scopeToken,
      comparatorId: providerSemanticProof.ordering.comparatorId,
      comparatorRevision: providerSemanticProof.ordering.comparatorRevision,
      position: providerSemanticProof.ordering.position,
      normalizedInboundEvent: providerSemanticProof.normalizedInboundEvent,
      proofToken: providerSemanticProof.proofToken,
      revision: "1",
      updatedAt: t3
    },
    committedAt: t3
  };
  return inboxV2MessageReactionCommitSchema.parse({
    tenantId,
    beforeMessage: creation.message,
    beforeTimelineItem: timelineItem,
    beforeReaction: null,
    transition,
    afterReaction,
    participantSnapshots: [creation.authorParticipant],
    externalAuthorityEvidence: {
      externalMessageReference,
      sourceOccurrence,
      outboundRoute: null
    },
    outboundBindingSnapshot: null,
    routeConsumption: null,
    providerObservation: {
      semanticProof: providerSemanticProof,
      orderingCommit: semanticOrderingCommit,
      normalizedState: state,
      providerActorParticipant: creation.message.authorParticipant
    },
    providerResultProof: null,
    slotHeadBefore: null,
    slotHeadAfter: {
      tenantId,
      message: creation.initialRevision.message,
      semanticSlotKey,
      reaction: reactionReference,
      state,
      revision: "1",
      updatedAt: t3
    }
  });
}

function competingProviderObservedReactionCommit(
  commit: ReturnType<typeof providerObservedReactionSetCommit>,
  suffix: string
) {
  if (commit.providerObservation === null) {
    throw new Error("Provider reaction competitor requires semantic evidence.");
  }
  const proofToken = `proof:db005-${suffix}-${runId}`;
  const semanticProof = {
    ...commit.providerObservation.semanticProof,
    proofToken
  };
  return inboxV2MessageReactionCommitSchema.parse({
    ...commit,
    transition: {
      ...commit.transition,
      id: `message_reaction_transition:db005-${suffix}-${runId}`
    },
    providerObservation: {
      ...commit.providerObservation,
      semanticProof,
      orderingCommit: {
        ...commit.providerObservation.orderingCommit,
        proof: semanticProof,
        after: {
          ...commit.providerObservation.orderingCommit.after,
          proofToken
        }
      }
    }
  });
}

function trustedAuthorityTamperedProviderReactionCommit(
  commit: ReturnType<typeof providerObservedReactionSetCommit>
) {
  const clone = structuredClone(commit);
  const providerObservation = clone.providerObservation;
  if (providerObservation === null) {
    throw new Error("Provider reaction tamper requires semantic evidence.");
  }
  const adapterContract = {
    ...providerObservation.semanticProof.adapterContract,
    contractVersion: "v999"
  } as unknown as typeof providerObservation.semanticProof.adapterContract;
  const semanticProof = {
    ...providerObservation.semanticProof,
    adapterContract
  } as unknown as typeof providerObservation.semanticProof;
  return {
    ...clone,
    providerObservation: {
      ...providerObservation,
      semanticProof,
      orderingCommit: {
        ...providerObservation.orderingCommit,
        proof: semanticProof
      }
    }
  } as unknown as ReturnType<typeof providerObservedReactionSetCommit>;
}

function providerResultOutboundBindingSnapshot(
  binding: Awaited<
    ReturnType<typeof seedExternalCreationAnchors>
  >["bindingProjection"]["binding"],
  route: ReturnType<typeof inboxV2OutboundRouteSchema.parse>
) {
  const reactionCapability = {
    capabilityId: "module:synthetic:reactions",
    operationId: route.operationId,
    contentKindId: route.contentKindId,
    state: "supported" as const,
    referencePortability: "external_thread" as const,
    requiredProviderRoleIds: [] as const,
    validUntil: null,
    diagnostic: null,
    evidence: binding.providerAccess.evidence
  };
  const hasReactionCapability = binding.capabilities.entries.some(
    (entry) =>
      entry.capabilityId === reactionCapability.capabilityId &&
      entry.operationId === reactionCapability.operationId &&
      entry.contentKindId === reactionCapability.contentKindId
  );
  return inboxV2SourceThreadBindingSchema.parse({
    ...binding,
    capabilities: {
      ...binding.capabilities,
      entries: hasReactionCapability
        ? binding.capabilities.entries
        : [...binding.capabilities.entries, reactionCapability]
    }
  });
}

function providerResultExternalRequestCommit(
  creation: InboxV2MessageCreationCommit,
  operator: ReturnType<typeof fixtureParticipant>,
  route: ReturnType<typeof inboxV2OutboundRouteSchema.parse>,
  outboundBindingSnapshot: ReturnType<
    typeof inboxV2SourceThreadBindingSchema.parse
  >,
  suffix: string
) {
  const timelineItem = creation.timelineAllocation.items[0];
  const sourceOccurrence = creation.sourceOccurrence;
  const externalMessageReference = creation.externalMessageReference;
  if (
    timelineItem === undefined ||
    sourceOccurrence === null ||
    externalMessageReference === null ||
    operator.subject.kind !== "employee"
  ) {
    throw new Error(
      "Provider result request fixture requires source evidence and an Employee operator."
    );
  }
  const reactionId = `message_reaction:db005-${suffix}-${runId}`;
  const transitionId = `message_reaction_transition:db005-${suffix}-${runId}`;
  const reactionReference = fixtureReference(
    "message_reaction",
    reactionId,
    tenantId
  );
  const transitionReference = fixtureReference(
    "message_reaction_transition",
    transitionId,
    tenantId
  );
  const routeReference = fixtureReference("outbound_route", route.id, tenantId);
  const operatorReference = fixtureReference(
    "conversation_participant",
    operator.id,
    tenantId
  );
  const actionAttribution = {
    actionParticipant: operatorReference,
    appActor: {
      kind: "employee" as const,
      employee: operator.subject.employee,
      authorizationEpoch: route.authorizationEpoch
    },
    sourceOccurrence: null,
    automationCausation: null
  };
  const actor = {
    kind: "participant" as const,
    participant: operatorReference
  };
  const capability = {
    kind: "external" as const,
    capabilityId: "module:synthetic:reactions",
    capabilityRevision: route.bindingFence.capabilityRevision,
    cardinality: "single_value" as const,
    adapterContract: route.adapterContract
  };
  const desired = {
    kind: "active" as const,
    value: { kind: "unicode" as const, value: "🔥" }
  };
  const pendingState = {
    kind: "pending_external" as const,
    operation: "set" as const,
    desired,
    confirmedBefore: null,
    outboundRoute: routeReference,
    requestTransition: transitionReference,
    requestAttribution: actionAttribution,
    requestedAt: t3
  };
  const semanticSlotKey = inboxV2ReactionSemanticSlotKeyFor({
    message: creation.initialRevision.message,
    actor,
    capability,
    state: pendingState
  });
  const afterReaction = {
    tenantId,
    id: reactionId,
    message: creation.initialRevision.message,
    actor,
    capability,
    semanticSlotKey,
    state: pendingState,
    revision: "1",
    createdAt: t3,
    updatedAt: t3
  };
  const sourceOccurrenceReference = fixtureReference(
    "source_occurrence",
    sourceOccurrence.id,
    tenantId
  );
  const externalMessageReferenceReference = fixtureReference(
    "external_message_reference",
    externalMessageReference.id,
    tenantId
  );
  const transition = {
    tenantId,
    id: transitionId,
    reaction: reactionReference,
    semanticSlotKey,
    mode: "external_request" as const,
    operation: "set" as const,
    expectedRevision: null,
    resultingRevision: "1",
    beforeState: null,
    afterState: pendingState,
    actionAttribution,
    externalAuthority: {
      externalMessageReference: externalMessageReferenceReference,
      sourceOccurrence: sourceOccurrenceReference,
      sourceAccount: sourceOccurrence.bindingContext.sourceAccount,
      sourceThreadBinding: sourceOccurrence.bindingContext.sourceThreadBinding,
      bindingGeneration: sourceOccurrence.bindingContext.bindingGeneration,
      outboundRoute: routeReference,
      adapterContract: route.adapterContract,
      capabilityFence: {
        capabilityId: capability.capabilityId,
        capabilityRevision: capability.capabilityRevision,
        adapterContract: capability.adapterContract,
        decision: "supported" as const,
        evaluatedAt: outboundBindingSnapshot.capabilities.capturedAt,
        notAfter: t4
      }
    },
    occurredAt: t3,
    recordedAt: t3,
    recordRevision: "1" as const
  };
  return inboxV2MessageReactionCommitSchema.parse({
    tenantId,
    beforeMessage: creation.message,
    beforeTimelineItem: timelineItem,
    beforeReaction: null,
    transition,
    afterReaction,
    participantSnapshots: [operator],
    externalAuthorityEvidence: {
      externalMessageReference,
      sourceOccurrence,
      outboundRoute: route
    },
    outboundBindingSnapshot,
    routeConsumption: {
      tenantId,
      outboundRoute: routeReference,
      transition: transitionReference,
      reaction: reactionReference,
      semanticSlotKey,
      mutationToken: route.mutationToken,
      idempotencyToken: route.idempotencyToken,
      correlationToken: route.correlationToken,
      consumedByTrustedServiceId:
        route.adapterContract.loadedByTrustedServiceId,
      consumedAt: t3,
      revision: "1" as const
    },
    providerObservation: null,
    providerResultProof: null,
    slotHeadBefore: null,
    slotHeadAfter: {
      tenantId,
      message: creation.initialRevision.message,
      semanticSlotKey,
      reaction: reactionReference,
      state: pendingState,
      revision: "1",
      updatedAt: t3
    }
  });
}

function tamperedExternalRequestConfirmedBeforeCommit(
  commit: ReturnType<typeof providerResultExternalRequestCommit>
) {
  const clone = structuredClone(commit);
  if (
    clone.transition.beforeState !== null ||
    clone.transition.afterState.kind !== "pending_external"
  ) {
    throw new Error("External-request tamper requires an initial request.");
  }
  const pendingState = {
    ...clone.transition.afterState,
    confirmedBefore: {
      kind: "active" as const,
      value: { kind: "unicode" as const, value: "🔥" }
    }
  };
  return {
    ...clone,
    transition: { ...clone.transition, afterState: pendingState },
    afterReaction: { ...clone.afterReaction, state: pendingState },
    slotHeadAfter: { ...clone.slotHeadAfter, state: pendingState }
  } as unknown as ReturnType<typeof providerResultExternalRequestCommit>;
}

function providerResultTerminalReactionCommit(
  request: ReturnType<typeof providerResultExternalRequestCommit>,
  suffix: string
) {
  const beforeReaction = request.afterReaction;
  const beforeState = beforeReaction.state;
  if (
    beforeState.kind !== "pending_external" ||
    beforeReaction.capability.kind !== "external"
  ) {
    throw new Error("Provider result fixture requires a pending request.");
  }
  const resultToken = `result:db005-${suffix}-${runId}`;
  const resultDigestSha256 = "d".repeat(64);
  const terminalState = {
    kind: "external_terminal" as const,
    operation: beforeState.operation,
    desired: beforeState.desired,
    confirmedState: beforeState.confirmedBefore,
    outboundRoute: beforeState.outboundRoute,
    requestTransition: beforeState.requestTransition,
    outcome: "failed" as const,
    resultToken,
    resultDigestSha256,
    resolvedAt: t4
  };
  const afterReaction = {
    ...beforeReaction,
    state: terminalState,
    revision: "2",
    updatedAt: t4
  };
  return inboxV2MessageReactionCommitSchema.parse({
    ...request,
    beforeReaction,
    transition: {
      ...request.transition,
      id: `message_reaction_transition:db005-${suffix}-${runId}`,
      mode: "provider_result",
      expectedRevision: "1",
      resultingRevision: "2",
      beforeState,
      afterState: terminalState,
      actionAttribution: beforeState.requestAttribution,
      externalAuthority: null,
      occurredAt: t4,
      recordedAt: t4
    },
    afterReaction,
    externalAuthorityEvidence: null,
    outboundBindingSnapshot: null,
    routeConsumption: null,
    providerObservation: null,
    providerResultProof: {
      tenantId,
      operation: beforeState.requestTransition,
      outboundRoute: beforeState.outboundRoute,
      adapterContract: beforeReaction.capability.adapterContract,
      capabilityId: beforeReaction.capability.capabilityId,
      capabilityRevision: beforeReaction.capability.capabilityRevision,
      semanticId: `core:message.reaction.${beforeState.operation}.result`,
      semanticRevision: "1",
      resultState: "failed",
      declaredByTrustedServiceId:
        beforeReaction.capability.adapterContract.loadedByTrustedServiceId,
      resultToken,
      resultDigestSha256,
      recordedAt: t4,
      revision: "1"
    },
    slotHeadBefore: request.slotHeadAfter,
    slotHeadAfter: {
      ...request.slotHeadAfter,
      state: terminalState,
      revision: "2",
      updatedAt: t4
    }
  });
}

function tamperedProviderResultReactionCommit(
  commit: ReturnType<typeof providerResultTerminalReactionCommit>
) {
  const clone = structuredClone(commit);
  if (clone.providerResultProof === null) {
    throw new Error("Provider result tamper requires one result proof.");
  }
  return {
    ...clone,
    providerResultProof: {
      ...clone.providerResultProof,
      adapterContract: {
        ...clone.providerResultProof.adapterContract,
        contractVersion: "v999"
      },
      capabilityId: "module:synthetic:tampered-reactions"
    }
  } as unknown as ReturnType<typeof providerResultTerminalReactionCommit>;
}

function tamperedProviderResultStateCommit(
  commit: ReturnType<typeof providerResultTerminalReactionCommit>
) {
  const clone = structuredClone(commit);
  if (
    clone.transition.beforeState?.kind !== "pending_external" ||
    clone.transition.afterState.kind !== "external_terminal"
  ) {
    throw new Error("Provider-result state tamper requires a terminal result.");
  }
  const changedConfirmedState = {
    kind: "active" as const,
    value: { kind: "unicode" as const, value: "🔥" }
  };
  return {
    ...clone,
    transition: {
      ...clone.transition,
      afterState: {
        ...clone.transition.afterState,
        desired: changedConfirmedState,
        confirmedState: changedConfirmedState
      }
    }
  } as unknown as ReturnType<typeof providerResultTerminalReactionCommit>;
}

function advancedProviderObservedReactionCommit(
  commit: ReturnType<typeof providerObservedReactionSetCommit>,
  suffix: string,
  value: string,
  sourceOccurrence: NonNullable<
    InboxV2MessageCreationCommit["sourceOccurrence"]
  >
) {
  if (
    commit.providerObservation === null ||
    sourceOccurrence.origin.kind === "provider_response" ||
    sourceOccurrence.origin.kind === "provider_echo" ||
    sourceOccurrence.providerActor?.kind !== "source_external_identity" ||
    commit.transition.externalAuthority === null
  ) {
    throw new Error("Provider reaction successor requires semantic evidence.");
  }
  const sourceOccurrenceReference = fixtureReference(
    "source_occurrence",
    sourceOccurrence.id,
    tenantId
  );
  const externalAuthority = commit.transition.externalAuthority;
  const beforeReaction = commit.afterReaction;
  const state = {
    kind: "active" as const,
    value: { kind: "unicode" as const, value }
  };
  const afterReaction = {
    ...beforeReaction,
    state,
    revision: "2",
    updatedAt: t4
  };
  const semanticProof = {
    ...commit.providerObservation.semanticProof,
    normalizedInboundEvent: sourceOccurrence.origin.normalizedInboundEvent,
    sourceOccurrence: sourceOccurrenceReference,
    sourceAccount: sourceOccurrence.bindingContext.sourceAccount,
    sourceThreadBinding: sourceOccurrence.bindingContext.sourceThreadBinding,
    bindingGeneration: sourceOccurrence.bindingContext.bindingGeneration,
    adapterContract: sourceOccurrence.descriptor.adapterContract,
    semanticId: "core:message.reaction.replace",
    ordering: {
      ...commit.providerObservation.semanticProof.ordering,
      position: "2"
    },
    proofToken: `proof:db005-${suffix}-${runId}`,
    actor: sourceOccurrence.providerActor.sourceExternalIdentity,
    occurredAt: t4,
    recordedAt: t4
  };
  const orderingBefore = commit.providerObservation.orderingCommit.after;
  return inboxV2MessageReactionCommitSchema.parse({
    ...commit,
    beforeReaction,
    transition: {
      ...commit.transition,
      id: `message_reaction_transition:db005-${suffix}-${runId}`,
      operation: "replace",
      expectedRevision: "1",
      resultingRevision: "2",
      beforeState: beforeReaction.state,
      afterState: state,
      actionAttribution: {
        ...commit.transition.actionAttribution,
        sourceOccurrence: sourceOccurrenceReference
      },
      externalAuthority: {
        ...externalAuthority,
        sourceOccurrence: sourceOccurrenceReference,
        sourceAccount: sourceOccurrence.bindingContext.sourceAccount,
        sourceThreadBinding:
          sourceOccurrence.bindingContext.sourceThreadBinding,
        bindingGeneration: sourceOccurrence.bindingContext.bindingGeneration,
        adapterContract: sourceOccurrence.descriptor.adapterContract,
        capabilityFence: {
          ...externalAuthority.capabilityFence,
          adapterContract: sourceOccurrence.descriptor.adapterContract,
          evaluatedAt: sourceOccurrence.observedAt
        }
      },
      occurredAt: t4,
      recordedAt: t4
    },
    afterReaction,
    externalAuthorityEvidence: {
      ...commit.externalAuthorityEvidence,
      sourceOccurrence
    },
    providerObservation: {
      ...commit.providerObservation,
      semanticProof,
      orderingCommit: {
        ...commit.providerObservation.orderingCommit,
        before: orderingBefore,
        proof: semanticProof,
        after: {
          ...orderingBefore,
          sourceAccount: sourceOccurrence.bindingContext.sourceAccount,
          sourceThreadBinding:
            sourceOccurrence.bindingContext.sourceThreadBinding,
          bindingGeneration: sourceOccurrence.bindingContext.bindingGeneration,
          position: "2",
          normalizedInboundEvent:
            sourceOccurrence.origin.normalizedInboundEvent,
          proofToken: semanticProof.proofToken,
          revision: "2",
          updatedAt: t4
        },
        committedAt: t4
      },
      normalizedState: state
    },
    slotHeadBefore: commit.slotHeadAfter,
    slotHeadAfter: {
      ...commit.slotHeadAfter,
      state,
      revision: "2",
      updatedAt: t4
    }
  });
}

function requireProviderReactionOrderingCommit(
  commit: ReturnType<typeof providerObservedReactionSetCommit>
) {
  if (commit.providerObservation === null) {
    throw new Error(
      "Provider reaction fixture requires semantic ordering CAS."
    );
  }
  return commit.providerObservation.orderingCommit;
}

function providerObservedLifecycleCreationCommit(
  creation: InboxV2MessageCreationCommit,
  suffix: string,
  options: {
    action?: "edit" | "delete";
    message?: InboxV2MessageCreationCommit["message"];
    sourceOccurrence?: NonNullable<
      InboxV2MessageCreationCommit["sourceOccurrence"]
    >;
    timelineItem?: InboxV2MessageCreationCommit["timelineAllocation"]["items"][number];
  } = {}
) {
  const timelineItem =
    options.timelineItem ?? creation.timelineAllocation.items[0];
  const sourceOccurrence =
    options.sourceOccurrence ?? creation.sourceOccurrence;
  const externalMessageReference = creation.externalMessageReference;
  const message = options.message ?? creation.message;
  const action = options.action ?? "delete";
  if (
    timelineItem === undefined ||
    sourceOccurrence === null ||
    externalMessageReference === null ||
    sourceOccurrence.origin.kind === "provider_response" ||
    sourceOccurrence.origin.kind === "provider_echo" ||
    sourceOccurrence.providerActor === null
  ) {
    throw new Error(
      "Provider lifecycle fixture requires one resolved native source occurrence."
    );
  }
  const operation = {
    tenantId,
    id: `message_provider_lifecycle_operation:db005-${suffix}-${runId}`,
    message: creation.initialRevision.message,
    action,
    origin: "provider_observed" as const,
    externalMessageReference: fixtureReference(
      "external_message_reference",
      externalMessageReference.id,
      tenantId
    ),
    sourceOccurrence: fixtureReference(
      "source_occurrence",
      sourceOccurrence.id,
      tenantId
    ),
    sourceAccount: sourceOccurrence.bindingContext.sourceAccount,
    sourceThreadBinding: sourceOccurrence.bindingContext.sourceThreadBinding,
    bindingGeneration: sourceOccurrence.bindingContext.bindingGeneration,
    outboundRoute: null,
    adapterContract: sourceOccurrence.descriptor.adapterContract,
    capabilityRevision: sourceOccurrence.descriptor.capabilityRevision,
    appActor: null,
    actionParticipant: null,
    automationCausation: null,
    outcome: { state: "observed" as const },
    deleteLocalPolicy:
      action === "delete" ? { effect: "not_evaluated" as const } : null,
    revision: "1",
    occurredAt: sourceOccurrence.observedAt,
    recordedAt: sourceOccurrence.recordedAt,
    createdAt: sourceOccurrence.recordedAt,
    updatedAt: sourceOccurrence.recordedAt
  };
  const providerSemanticProofBase = namespaceFixture(
    fixtureProviderSemanticProof({
      semanticId: `core:message.lifecycle.${action}.observed`,
      capabilityId:
        action === "delete" ? "core:message-delete" : "core:message-edit",
      capabilityRevision: sourceOccurrence.descriptor.capabilityRevision,
      actor: null,
      occurredAt: sourceOccurrence.observedAt,
      recordedAt: sourceOccurrence.recordedAt
    }),
    suffix
  );
  const providerSemanticProof = {
    ...providerSemanticProofBase,
    tenantId,
    normalizedInboundEvent: sourceOccurrence.origin.normalizedInboundEvent,
    externalMessageReference: fixtureReference(
      "external_message_reference",
      externalMessageReference.id,
      tenantId
    ),
    sourceOccurrence: fixtureReference(
      "source_occurrence",
      sourceOccurrence.id,
      tenantId
    ),
    sourceAccount: sourceOccurrence.bindingContext.sourceAccount,
    sourceThreadBinding: sourceOccurrence.bindingContext.sourceThreadBinding,
    bindingGeneration: sourceOccurrence.bindingContext.bindingGeneration,
    adapterContract: sourceOccurrence.descriptor.adapterContract,
    capabilityRevision: sourceOccurrence.descriptor.capabilityRevision,
    actor:
      sourceOccurrence.providerActor.kind === "source_external_identity"
        ? sourceOccurrence.providerActor.sourceExternalIdentity
        : null,
    occurredAt: sourceOccurrence.observedAt,
    recordedAt: sourceOccurrence.recordedAt
  };
  const semanticOrderingCommitBase = fixtureProviderSemanticOrderingCommit(
    providerSemanticProofBase,
    "core:message.lifecycle",
    operation.recordedAt
  );
  return inboxV2MessageProviderLifecycleOperationCreationCommitSchema.parse({
    tenantId,
    message,
    timelineItem,
    externalMessageReference,
    sourceOccurrence,
    outboundRoute: null,
    outboundBindingSnapshot: null,
    actionParticipantSnapshot: null,
    providerSemanticProof,
    semanticOrderingCommit: {
      ...semanticOrderingCommitBase,
      tenantId,
      proof: providerSemanticProof,
      after: {
        ...semanticOrderingCommitBase.after,
        tenantId,
        externalMessageReference:
          providerSemanticProof.externalMessageReference,
        sourceAccount: providerSemanticProof.sourceAccount,
        sourceThreadBinding: providerSemanticProof.sourceThreadBinding,
        bindingGeneration: providerSemanticProof.bindingGeneration,
        normalizedInboundEvent: providerSemanticProof.normalizedInboundEvent,
        proofToken: providerSemanticProof.proofToken,
        updatedAt: operation.recordedAt
      }
    },
    routeConsumption: null,
    operation
  });
}

function requireProviderSemanticOrderingCommit(
  commit: ReturnType<typeof providerObservedLifecycleCreationCommit>
) {
  if (commit.semanticOrderingCommit === null) {
    throw new Error(
      "Provider-observed lifecycle fixture requires semantic ordering CAS."
    );
  }
  return commit.semanticOrderingCommit;
}

function competingProviderObservedLifecycleCreationCommit(
  commit: ReturnType<typeof providerObservedLifecycleCreationCommit>,
  suffix: string
) {
  if (
    commit.providerSemanticProof === null ||
    commit.semanticOrderingCommit === null
  ) {
    throw new Error(
      "Competing provider lifecycle fixture requires semantic ordering evidence."
    );
  }
  const proofToken = `proof:db005-${suffix}-${runId}`;
  const providerSemanticProof = {
    ...commit.providerSemanticProof,
    proofToken
  };
  return inboxV2MessageProviderLifecycleOperationCreationCommitSchema.parse({
    ...commit,
    providerSemanticProof,
    semanticOrderingCommit: {
      ...commit.semanticOrderingCommit,
      proof: providerSemanticProof,
      after: {
        ...commit.semanticOrderingCommit.after,
        proofToken
      }
    },
    operation: {
      ...commit.operation,
      id: `message_provider_lifecycle_operation:db005-${suffix}-${runId}`
    }
  });
}

function advancedProviderObservedLifecycleCreationCommit(
  commit: ReturnType<typeof providerObservedLifecycleCreationCommit>,
  suffix: string
) {
  if (
    commit.providerSemanticProof === null ||
    commit.semanticOrderingCommit === null
  ) {
    throw new Error(
      "Advancing provider lifecycle fixture requires semantic ordering evidence."
    );
  }
  const before = commit.semanticOrderingCommit.after;
  const position = (BigInt(before.position) + 1n).toString();
  const proofToken = `proof:db005-${suffix}-${runId}`;
  const providerSemanticProof = {
    ...commit.providerSemanticProof,
    ordering: {
      ...commit.providerSemanticProof.ordering,
      position
    },
    proofToken,
    occurredAt: t4,
    recordedAt: t4
  };
  return inboxV2MessageProviderLifecycleOperationCreationCommitSchema.parse({
    ...commit,
    providerSemanticProof,
    semanticOrderingCommit: {
      ...commit.semanticOrderingCommit,
      before,
      proof: providerSemanticProof,
      after: {
        ...before,
        position,
        proofToken,
        revision: (BigInt(before.revision) + 1n).toString(),
        updatedAt: t4
      },
      committedAt: t4
    },
    operation: {
      ...commit.operation,
      id: `message_provider_lifecycle_operation:db005-${suffix}-${runId}`,
      occurredAt: t4,
      recordedAt: t4,
      createdAt: t4,
      updatedAt: t4
    }
  });
}

function crossAccountAdvancedProviderObservedLifecycleCreationCommit(
  commit: ReturnType<typeof providerObservedLifecycleCreationCommit>,
  suffix: string,
  sourceOccurrence: NonNullable<
    InboxV2MessageCreationCommit["sourceOccurrence"]
  >
) {
  if (
    commit.providerSemanticProof === null ||
    commit.semanticOrderingCommit === null ||
    sourceOccurrence.origin.kind === "provider_response" ||
    sourceOccurrence.origin.kind === "provider_echo"
  ) {
    throw new Error(
      "Cross-account lifecycle advance requires event-backed semantic evidence."
    );
  }
  const before = commit.semanticOrderingCommit.after;
  const position = (BigInt(before.position) + 1n).toString();
  const proofToken = `proof:db005-${suffix}-${runId}`;
  const sourceOccurrenceReference = fixtureReference(
    "source_occurrence",
    sourceOccurrence.id,
    tenantId
  );
  const providerSemanticProof = {
    ...commit.providerSemanticProof,
    normalizedInboundEvent: sourceOccurrence.origin.normalizedInboundEvent,
    sourceOccurrence: sourceOccurrenceReference,
    sourceAccount: sourceOccurrence.bindingContext.sourceAccount,
    sourceThreadBinding: sourceOccurrence.bindingContext.sourceThreadBinding,
    bindingGeneration: sourceOccurrence.bindingContext.bindingGeneration,
    adapterContract: sourceOccurrence.descriptor.adapterContract,
    capabilityRevision: sourceOccurrence.descriptor.capabilityRevision,
    actor:
      sourceOccurrence.providerActor?.kind === "source_external_identity"
        ? sourceOccurrence.providerActor.sourceExternalIdentity
        : null,
    ordering: {
      ...commit.providerSemanticProof.ordering,
      position
    },
    proofToken,
    occurredAt: sourceOccurrence.observedAt,
    recordedAt: sourceOccurrence.recordedAt
  };
  return inboxV2MessageProviderLifecycleOperationCreationCommitSchema.parse({
    ...commit,
    sourceOccurrence,
    providerSemanticProof,
    semanticOrderingCommit: {
      ...commit.semanticOrderingCommit,
      before,
      proof: providerSemanticProof,
      after: {
        ...before,
        sourceAccount: sourceOccurrence.bindingContext.sourceAccount,
        sourceThreadBinding:
          sourceOccurrence.bindingContext.sourceThreadBinding,
        bindingGeneration: sourceOccurrence.bindingContext.bindingGeneration,
        position,
        normalizedInboundEvent: sourceOccurrence.origin.normalizedInboundEvent,
        proofToken,
        revision: (BigInt(before.revision) + 1n).toString(),
        updatedAt: sourceOccurrence.recordedAt
      },
      committedAt: sourceOccurrence.recordedAt
    },
    operation: {
      ...commit.operation,
      id: `message_provider_lifecycle_operation:db005-${suffix}-${runId}`,
      sourceOccurrence: sourceOccurrenceReference,
      sourceAccount: sourceOccurrence.bindingContext.sourceAccount,
      sourceThreadBinding: sourceOccurrence.bindingContext.sourceThreadBinding,
      bindingGeneration: sourceOccurrence.bindingContext.bindingGeneration,
      adapterContract: sourceOccurrence.descriptor.adapterContract,
      capabilityRevision: sourceOccurrence.descriptor.capabilityRevision,
      occurredAt: sourceOccurrence.observedAt,
      recordedAt: sourceOccurrence.recordedAt,
      createdAt: sourceOccurrence.recordedAt,
      updatedAt: sourceOccurrence.recordedAt
    }
  });
}

function providerLifecyclePolicyTransitionCommit(
  creation: ReturnType<typeof providerObservedLifecycleCreationCommit>,
  decisionEventId: string,
  effect: "retain_local" | "tombstone_local",
  recordedAt: string
) {
  const deleteLocalPolicy = {
    effect,
    decisionEvent: fixtureReference("event", decisionEventId, tenantId),
    decisionRevision: "1",
    decidedAt: recordedAt
  };
  const after = {
    ...creation.operation,
    deleteLocalPolicy,
    revision: "2",
    updatedAt: recordedAt
  };
  return inboxV2MessageProviderLifecycleTransitionCommitSchema.parse({
    tenantId,
    before: creation.operation,
    transition: {
      operation: fixtureReference(
        "message_provider_lifecycle_operation",
        creation.operation.id,
        tenantId
      ),
      expectedRevision: "1",
      resultingRevision: "2",
      outcome: after.outcome,
      deleteLocalPolicy,
      resultProof: null,
      recordedAt
    },
    after
  });
}

function nonMonotonicProviderLifecycleHeadCommit(
  commit: ReturnType<typeof providerLifecyclePolicyTransitionCommit>
) {
  const clone = structuredClone(commit);
  return {
    ...clone,
    after: {
      ...clone.after,
      updatedAt: fixtureT0
    }
  } as unknown as ReturnType<typeof providerLifecyclePolicyTransitionCommit>;
}

function providerSystemParticipant(
  creation: InboxV2MessageCreationCommit,
  suffix: string
) {
  return inboxV2ConversationParticipantSchema.parse({
    tenantId,
    id: `conversation_participant:db005-${suffix}-${runId}`,
    conversation: creation.message.conversation,
    subject: {
      kind: "system",
      systemActorId: "core:provider-system"
    },
    revision: "1",
    createdAt: t4,
    updatedAt: t4
  });
}

function providerObservedEditMutation(
  creation: InboxV2MessageCreationCommit,
  lifecycleCreation: ReturnType<typeof providerObservedLifecycleCreationCommit>,
  actionParticipantSnapshot: ReturnType<
    typeof inboxV2ConversationParticipantSchema.parse
  >,
  suffix: string
) {
  const beforeTimelineItem = creation.timelineAllocation.items[0];
  if (beforeTimelineItem === undefined) {
    throw new Error("Provider edit fixture requires one TimelineItem.");
  }
  const operation = lifecycleCreation.operation;
  const beforeContent = creation.content;
  const afterContent = inboxV2TimelineContentSchema.parse({
    ...beforeContent,
    state: {
      kind: "available",
      blocks: [
        {
          blockKey: "body-1",
          kind: "text",
          role: "body",
          text: "Provider-system edited",
          language: "en"
        }
      ],
      contentDigestSha256: "6".repeat(64)
    },
    revision: "2",
    updatedAt: t4
  });
  const afterMessage = {
    ...creation.message,
    content: inboxV2TimelineContentHeadOf(afterContent),
    revision: "2",
    updatedAt: t4
  };
  const afterTimelineItem = {
    ...beforeTimelineItem,
    subject: {
      kind: "message" as const,
      message: creation.initialRevision.message,
      messageRevision: "2"
    },
    revision: "2",
    updatedAt: t4
  };
  const participantReference = fixtureReference(
    "conversation_participant",
    actionParticipantSnapshot.id,
    tenantId
  );
  return inboxV2MessageMutationCommitSchema.parse({
    tenantId,
    beforeMessage: creation.message,
    beforeTimelineItem,
    contentTransition: {
      tenantId,
      before: beforeContent,
      transition: {
        kind: "edit",
        expectedRevision: "1",
        resultingRevision: "2",
        event: fixtureReference(
          "event",
          `event:db005-${suffix}-${runId}`,
          tenantId
        ),
        occurredAt: t4
      },
      after: afterContent
    },
    providerOperation: operation,
    providerOperationCreationCommit: lifecycleCreation,
    actionParticipantSnapshot,
    revision: {
      tenantId,
      id: `message_revision:db005-${suffix}-${runId}`,
      message: creation.initialRevision.message,
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
        providerOperation: fixtureReference(
          "message_provider_lifecycle_operation",
          operation.id,
          tenantId
        )
      },
      actionAttribution: {
        actionParticipant: participantReference,
        appActor: null,
        sourceOccurrence: operation.sourceOccurrence,
        automationCausation: null
      },
      occurredAt: operation.occurredAt,
      recordedAt: t4,
      recordRevision: "1",
      createdAt: t4
    },
    afterMessage,
    afterTimelineItem
  });
}

function providerDeleteTombstoneMutation(
  creation: InboxV2MessageCreationCommit,
  lifecycleCreation: ReturnType<typeof providerObservedLifecycleCreationCommit>,
  lifecycleTransition: ReturnType<
    typeof providerLifecyclePolicyTransitionCommit
  >,
  suffix: string,
  actionParticipantSnapshot = creation.authorParticipant
) {
  const beforeTimelineItem = creation.timelineAllocation.items[0];
  if (beforeTimelineItem === undefined) {
    throw new Error("Provider tombstone fixture requires one TimelineItem.");
  }
  const operation = lifecycleTransition.after;
  const revisionId = `message_revision:db005-${suffix}-${runId}`;
  const afterMessage = {
    ...creation.message,
    lifecycle: {
      kind: "provider_delete_tombstone" as const,
      revision: fixtureReference("message_revision", revisionId, tenantId),
      providerOperation: fixtureReference(
        "message_provider_lifecycle_operation",
        operation.id,
        tenantId
      ),
      policyReasonId: "core:provider-delete-policy",
      appliedAt: t4
    },
    revision: "2",
    updatedAt: t4
  };
  const afterTimelineItem = {
    ...beforeTimelineItem,
    subject: {
      kind: "message" as const,
      message: creation.initialRevision.message,
      messageRevision: "2"
    },
    revision: "2",
    updatedAt: t4
  };
  return inboxV2MessageMutationCommitSchema.parse({
    tenantId,
    beforeMessage: creation.message,
    beforeTimelineItem,
    contentTransition: null,
    providerOperation: operation,
    providerOperationCreationCommit: lifecycleCreation,
    actionParticipantSnapshot,
    revision: {
      tenantId,
      id: revisionId,
      message: creation.initialRevision.message,
      timelineItem: fixtureReference(
        "timeline_item",
        beforeTimelineItem.id,
        tenantId
      ),
      expectedPreviousRevision: "1",
      messageRevision: "2",
      change: {
        kind: "provider_delete_policy_tombstone",
        providerOperation: fixtureReference(
          "message_provider_lifecycle_operation",
          operation.id,
          tenantId
        ),
        policyReasonId: afterMessage.lifecycle.policyReasonId
      },
      actionAttribution: {
        actionParticipant: fixtureReference(
          "conversation_participant",
          actionParticipantSnapshot.id,
          tenantId
        ),
        appActor: null,
        sourceOccurrence: operation.sourceOccurrence,
        automationCausation: null
      },
      occurredAt: operation.occurredAt,
      recordedAt: t4,
      recordRevision: "1",
      createdAt: t4
    },
    afterMessage,
    afterTimelineItem
  });
}

function editMutation(
  creation: InboxV2MessageCreationCommit,
  revisionSuffix: string,
  text: string,
  digestCharacter: string
) {
  const beforeContent = creation.content;
  const beforeMessage = creation.message;
  const beforeTimelineItem = creation.timelineAllocation.items[0];
  if (beforeTimelineItem === undefined) {
    throw new Error("Expected one creation TimelineItem.");
  }
  const afterContent = inboxV2TimelineContentSchema.parse({
    ...beforeContent,
    state: {
      kind: "available" as const,
      blocks: [
        {
          blockKey: "body-1",
          kind: "text" as const,
          role: "body" as const,
          text,
          language: "en"
        },
        {
          blockKey: "contact-1",
          kind: "contact" as const,
          displayName: "DB005 classified contact",
          organization: null,
          values: [
            {
              kind: "phone" as const,
              value: "+79990000000",
              label: "mobile"
            }
          ]
        }
      ],
      contentDigestSha256: digestCharacter.repeat(64)
    },
    revision: "2",
    updatedAt: t3
  });
  const afterMessage = {
    ...beforeMessage,
    content: inboxV2TimelineContentHeadOf(afterContent),
    revision: "2",
    updatedAt: t3
  };
  const afterTimelineItem = {
    ...beforeTimelineItem,
    subject: {
      kind: "message" as const,
      message: {
        tenantId,
        kind: "message" as const,
        id: beforeMessage.id
      },
      messageRevision: "2"
    },
    revision: "2",
    updatedAt: t3
  };
  return inboxV2MessageMutationCommitSchema.parse({
    tenantId,
    beforeMessage,
    beforeTimelineItem,
    contentTransition: {
      tenantId,
      before: beforeContent,
      transition: {
        kind: "edit",
        expectedRevision: "1",
        resultingRevision: "2",
        event: {
          tenantId,
          kind: "event",
          id: `event:db005-${revisionSuffix}-${runId}`
        },
        occurredAt: t3
      },
      after: afterContent
    },
    providerOperation: null,
    providerOperationCreationCommit: null,
    actionParticipantSnapshot: creation.authorParticipant,
    revision: {
      tenantId,
      id: `message_revision:db005-${revisionSuffix}-${runId}`,
      message: { tenantId, kind: "message", id: beforeMessage.id },
      timelineItem: {
        tenantId,
        kind: "timeline_item",
        id: beforeTimelineItem.id
      },
      expectedPreviousRevision: "1",
      messageRevision: "2",
      change: {
        kind: "edited",
        beforeContent: beforeMessage.content,
        afterContent: afterMessage.content,
        providerOperation: null
      },
      actionAttribution: {
        actionParticipant: beforeMessage.authorParticipant,
        appActor: beforeMessage.appActor,
        sourceOccurrence: null,
        automationCausation: null
      },
      occurredAt: t3,
      recordedAt: t3,
      recordRevision: "1",
      createdAt: t3
    },
    afterMessage,
    afterTimelineItem
  });
}

function privacyMutation(
  edit: ReturnType<typeof editMutation>,
  suffix: string
) {
  const event = {
    tenantId,
    kind: "event" as const,
    id: `event:db005-${suffix}-${runId}`
  };
  const afterContent = inboxV2TimelineContentSchema.parse({
    ...edit.contentTransition!.after,
    state: {
      kind: "privacy_erased" as const,
      tombstoneEvent: event,
      reasonId: "core:privacy_request",
      erasedAt: t4
    },
    revision: "3",
    updatedAt: t4
  });
  const tombstoneEvent =
    afterContent.state.kind === "privacy_erased"
      ? afterContent.state.tombstoneEvent
      : event;
  const afterMessage = {
    ...edit.afterMessage,
    content: inboxV2TimelineContentHeadOf(afterContent),
    revision: "3",
    updatedAt: t4
  };
  const afterTimelineItem = {
    ...edit.afterTimelineItem,
    subject: {
      kind: "message" as const,
      message: {
        tenantId,
        kind: "message" as const,
        id: edit.afterMessage.id
      },
      messageRevision: "3"
    },
    revision: "3",
    updatedAt: t4
  };
  return inboxV2MessageMutationCommitSchema.parse({
    tenantId,
    beforeMessage: edit.afterMessage,
    beforeTimelineItem: edit.afterTimelineItem,
    contentTransition: {
      tenantId,
      before: edit.contentTransition!.after,
      transition: {
        kind: "privacy_erasure",
        expectedRevision: "2",
        resultingRevision: "3",
        event: tombstoneEvent,
        occurredAt: t4
      },
      after: afterContent
    },
    providerOperation: null,
    providerOperationCreationCommit: null,
    actionParticipantSnapshot: null,
    revision: {
      tenantId,
      id: `message_revision:db005-${suffix}-${runId}`,
      message: {
        tenantId,
        kind: "message",
        id: edit.afterMessage.id
      },
      timelineItem: {
        tenantId,
        kind: "timeline_item",
        id: edit.afterTimelineItem.id
      },
      expectedPreviousRevision: "2",
      messageRevision: "3",
      change: {
        kind: "privacy_erasure_tombstone",
        beforeContent: edit.afterMessage.content,
        afterContent: afterMessage.content
      },
      actionAttribution: {
        actionParticipant: null,
        appActor: {
          kind: "trusted_service",
          trustedServiceId: "core:privacy-worker"
        },
        sourceOccurrence: null,
        automationCausation: {
          kind: "system_event",
          causeEvent: tombstoneEvent,
          correlationId: `correlation:db005-${suffix}-${runId}`,
          causedAt: t4
        }
      },
      occurredAt: t4,
      recordedAt: t4,
      recordRevision: "1",
      createdAt: t4
    },
    afterMessage,
    afterTimelineItem
  });
}

function retentionMutation(
  edit: ReturnType<typeof editMutation>,
  suffix: string
) {
  const event = {
    tenantId,
    kind: "event" as const,
    id: `event:db005-${suffix}-${runId}`
  };
  const afterContent = inboxV2TimelineContentSchema.parse({
    ...edit.contentTransition!.after,
    state: {
      kind: "retention_purged" as const,
      tombstoneEvent: event,
      policyId: "core:message-content-retention",
      policyVersion: "v1",
      policyRevision: "4",
      purgedAt: t4
    },
    revision: "3",
    updatedAt: t4
  });
  const tombstoneEvent =
    afterContent.state.kind === "retention_purged"
      ? afterContent.state.tombstoneEvent
      : event;
  const afterMessage = {
    ...edit.afterMessage,
    content: inboxV2TimelineContentHeadOf(afterContent),
    revision: "3",
    updatedAt: t4
  };
  const afterTimelineItem = {
    ...edit.afterTimelineItem,
    subject: {
      kind: "message" as const,
      message: {
        tenantId,
        kind: "message" as const,
        id: edit.afterMessage.id
      },
      messageRevision: "3"
    },
    revision: "3",
    updatedAt: t4
  };
  return inboxV2MessageMutationCommitSchema.parse({
    tenantId,
    beforeMessage: edit.afterMessage,
    beforeTimelineItem: edit.afterTimelineItem,
    contentTransition: {
      tenantId,
      before: edit.contentTransition!.after,
      transition: {
        kind: "retention_purge",
        expectedRevision: "2",
        resultingRevision: "3",
        event: tombstoneEvent,
        occurredAt: t4
      },
      after: afterContent
    },
    providerOperation: null,
    providerOperationCreationCommit: null,
    actionParticipantSnapshot: null,
    revision: {
      tenantId,
      id: `message_revision:db005-${suffix}-${runId}`,
      message: {
        tenantId,
        kind: "message",
        id: edit.afterMessage.id
      },
      timelineItem: {
        tenantId,
        kind: "timeline_item",
        id: edit.afterTimelineItem.id
      },
      expectedPreviousRevision: "2",
      messageRevision: "3",
      change: {
        kind: "retention_purge_tombstone",
        beforeContent: edit.afterMessage.content,
        afterContent: afterMessage.content
      },
      actionAttribution: {
        actionParticipant: null,
        appActor: {
          kind: "trusted_service",
          trustedServiceId: "core:retention-worker"
        },
        sourceOccurrence: null,
        automationCausation: {
          kind: "system_event",
          causeEvent: tombstoneEvent,
          correlationId: `correlation:db005-${suffix}-${runId}`,
          causedAt: t4
        }
      },
      occurredAt: t4,
      recordedAt: t4,
      recordRevision: "1",
      createdAt: t4
    },
    afterMessage,
    afterTimelineItem
  });
}

async function seedCrossFeatureCreationAnchors(
  db: HuleeDatabase,
  commit: InboxV2MessageCreationCommit,
  suffix: string
) {
  const conversation = commit.timelineAllocation.conversationBefore;
  const participant = commit.authorParticipant;
  if (participant.subject.kind !== "employee") {
    throw new Error(
      "DB005 cross-feature fixture expects an employee participant."
    );
  }
  const employee = participant.subject.employee;
  await db.execute(sql`
    insert into employees (
      id, tenant_id, email, display_name, profile, created_at, updated_at
    ) values (
      ${employee.id}, ${tenantId},
      ${`${employee.id.replaceAll(":", "-")}@example.test`},
      'DB005 cross-feature employee', '{}'::jsonb,
      ${participant.createdAt}, ${participant.updatedAt}
    )
  `);

  const conversationResult = await createSqlInboxV2ConversationRepository(
    db
  ).create({
    tenantId,
    conversationId: conversation.id,
    topology: conversation.topology,
    transport: conversation.transport,
    purposeId: conversation.purposeId,
    lifecycle: conversation.lifecycle,
    streamPosition: position("1"),
    createdAt: conversation.createdAt
  });
  if (conversationResult.kind !== "created") {
    throw new Error(
      `Expected a new DB005 Conversation, got ${conversationResult.kind}.`
    );
  }

  const membershipRepository =
    createSqlInboxV2ParticipantMembershipRepository(db);
  const participantResult = await membershipRepository.createParticipant({
    tenantId,
    id: participant.id,
    conversationId: conversation.id,
    subject: participant.subject,
    createdAt: participant.createdAt
  });
  if (participantResult.kind !== "created") {
    throw new Error(
      `Expected a new DB005 participant, got ${participantResult.kind}.`
    );
  }

  const episodeId = inboxV2ParticipantMembershipEpisodeIdSchema.parse(
    `participant_membership_episode:db005-${suffix}-${runId}`
  );
  const started = await membershipRepository.startEpisode({
    tenantId,
    conversationId: conversation.id,
    participantId: participant.id,
    episodeId,
    transitionId: inboxV2ParticipantMembershipTransitionIdSchema.parse(
      `participant_membership_transition:db005-${suffix}-start-${runId}`
    ),
    origin: { kind: "hulee_internal_command" },
    initialState: "active",
    role: "member",
    evidenceClassification: "confirmed",
    cause: {
      kind: "hulee_internal_command",
      actorEmployee: employee
    },
    reasonCodeId: inboxV2ParticipantMembershipReasonIdSchema.parse(
      "core:conversation-created"
    ),
    expectedMembershipRevision: position("0"),
    occurredAt: participant.createdAt
  });
  if (started.kind !== "created") {
    throw new Error(`Expected a membership episode, got ${started.kind}.`);
  }

  return {
    conversationId: conversation.id,
    participantId: participant.id,
    employeeId: employee.id,
    episodeId,
    membershipRevision: started.record.conversationMembershipRevision,
    episodeRevision: started.record.episode.revision
  };
}

async function seedClientMergeRoots(db: HuleeDatabase, suffix: string) {
  const sourceClientId = inboxV2ClientIdSchema.parse(
    `client:db005-${suffix}-source-${runId}`
  );
  const targetClientId = inboxV2ClientIdSchema.parse(
    `client:db005-${suffix}-target-${runId}`
  );
  await db.execute(sql`
    insert into clients (
      id, tenant_id, display_name, source, created_at, updated_at
    ) values
      (
        ${sourceClientId}, ${tenantId}, 'DB005 source Client',
        'db005-integration', ${fixtureT0}, ${fixtureT0}
      ),
      (
        ${targetClientId}, ${tenantId}, 'DB005 target Client',
        'db005-integration', ${fixtureT0}, ${fixtureT0}
      )
  `);
  return { sourceClientId, targetClientId };
}

async function linkConversationToClient(
  db: HuleeDatabase,
  input: Readonly<{
    conversationId: InboxV2ConversationId;
    clientId: InboxV2ClientId;
    actorEmployeeId: InboxV2EmployeeId;
    suffix: string;
  }>
) {
  const decision = inboxV2ConversationClientLinkDecisionSchema.parse({
    actor: {
      kind: "employee",
      employee: {
        tenantId,
        kind: "employee",
        id: input.actorEmployeeId
      }
    },
    policyId: "core:manual-client-link",
    policyVersion: "v1",
    reasonCodeId: "core:operator-linked-client",
    policyAuthority: null
  });
  const linkId = inboxV2ConversationClientLinkIdSchema.parse(
    `conversation_client_link:db005-${input.suffix}-${runId}`
  );
  const link = inboxV2ConversationClientLinkSchema.parse({
    tenantId,
    id: linkId,
    conversation: {
      tenantId,
      kind: "conversation",
      id: input.conversationId
    },
    client: { tenantId, kind: "client", id: input.clientId },
    roleIds: [INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS.subject],
    associationConfidence: "confirmed",
    provenance: { kind: "manual" },
    auditEvidenceReferences: [],
    linkedBy: decision,
    validFrom: tClientLink,
    validFromBasis: "known_effective",
    state: "active",
    termination: null,
    revision: "1"
  });
  return createSqlInboxV2ConversationClientLinkRepository(db).applyTransition({
    tenantId,
    conversationId: input.conversationId,
    transitionId: inboxV2ConversationClientLinkTransitionIdSchema.parse(
      `conversation_client_link_transition:db005-${input.suffix}-${runId}`
    ),
    expectedRevision: null,
    decision,
    operations: [{ kind: "create_link", link }],
    resultingPrimaryLinkId: linkId,
    occurredAt: tClientLink
  });
}

async function seedCreationAnchors(
  db: HuleeDatabase,
  commit: InboxV2MessageCreationCommit
): Promise<void> {
  const conversation = commit.timelineAllocation.conversationBefore;
  const participant = commit.authorParticipant;
  if (participant.subject.kind !== "employee") {
    throw new Error("DB005 fixture expects an employee participant.");
  }
  const employee = participant.subject.employee;
  await db.transaction(async (transaction) => {
    await transaction.execute(sql`
      insert into employees (
        id, tenant_id, email, display_name, profile, created_at, updated_at
      ) values (
        ${employee.id}, ${tenantId},
        ${`${employee.id.replaceAll(":", "-")}@example.test`},
        'DB005 employee', '{}'::jsonb,
        ${participant.createdAt}, ${participant.updatedAt}
      )
    `);
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
        subject_employee_id, revision, created_at, updated_at
      ) values (
        ${tenantId}, ${participant.id}, ${conversation.id}, 'employee',
        ${employee.id}, ${participant.revision},
        ${participant.createdAt}, ${participant.updatedAt}
      )
    `);
  });
}

async function seedExternalCreationAnchors(
  db: HuleeDatabase,
  creation: InboxV2MessageCreationCommit,
  suffix: string,
  options: {
    includeMessageSendCapability?: boolean;
    includeReactionSetCapability?: boolean;
  } = {}
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
    id: `raw_inbound_event:db005-binding-${suffix}-${runId}`
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
        ${`DB005 source connection ${suffix}`}
      )
    `);
    await transaction.execute(sql`
      insert into source_accounts (
        id, tenant_id, source_connection_id, account_type, display_name
      ) values (
        ${sourceAccount.id}, ${tenantId}, ${sourceConnection.id},
        'direct_number', ${`DB005 source account ${suffix}`}
      )
    `);
    await insertRawInboundEvent(transaction, {
      id: bindingEvidence.id,
      sourceConnectionId: sourceConnection.id,
      sourceAccountId: sourceAccount.id,
      idempotencyKey: `db005-binding-${suffix}-${runId}`,
      observedAt: fixtureT0
    });
  });
  await seedVerifiedSourceAccountIdentity(db, identity, suffix);

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
    bindingEvidence,
    includeMessageSendCapability: options.includeMessageSendCapability ?? false,
    includeReactionSetCapability: options.includeReactionSetCapability ?? false
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
      `Expected a valid DB005 binding, got ${bindingResult.kind}.`
    );
  }

  const providerActor = occurrence.providerActor;
  if (providerActor?.kind !== "source_external_identity") {
    throw new Error(
      "DB005 source fixture requires one external provider actor."
    );
  }
  const actorRealmId = inboxV2SourceIdentityRealmIdSchema.parse(
    "module:synthetic:db005-actor-realm"
  );
  const actorVersion = inboxV2SchemaVersionTokenSchema.parse("v1");
  const actorObjectKindId = inboxV2SourceIdentityObjectKindIdSchema.parse(
    "module:synthetic:db005-provider-user"
  );
  const actorResult = await createSqlInboxV2SourceExternalIdentityRepository(
    db
  ).findOrCreate({
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
      authorizationToken: `materialize:db005-actor-${suffix}-${runId}`,
      authorizedAt: fixtureT1
    },
    materializedAt: fixtureT1,
    canonicalExternalSubject: `ProviderActor:${suffix}-${runId}`,
    stability: { kind: "stable" },
    createdAt: fixtureT1
  });
  expect(actorResult).toMatchObject({ kind: "created" });

  const participant = creation.authorParticipant;
  await db.execute(sql`
    insert into inbox_v2_conversation_participants (
      tenant_id, id, conversation_id, subject_kind,
      subject_employee_id, subject_source_external_identity_id,
      subject_client_contact_id, subject_bot_identity_id,
      subject_system_actor_id, subject_legacy_provenance_id,
      revision, created_at, updated_at
    ) values (
      ${tenantId}, ${participant.id}, ${creation.message.conversation.id},
      'source_external_identity', null,
      ${providerActor.sourceExternalIdentity.id}, null, null, null, null,
      ${participant.revision}, ${participant.createdAt}, ${participant.updatedAt}
    )
  `);

  if (
    occurrence.origin.kind === "provider_response" ||
    occurrence.origin.kind === "provider_echo"
  ) {
    throw new Error("DB005 source fixture requires webhook/history evidence.");
  }
  const eventOrigin = occurrence.origin;
  await db.transaction(async (transaction) => {
    await insertRawInboundEvent(transaction, {
      id: eventOrigin.rawInboundEvent.id,
      sourceConnectionId: sourceConnection.id,
      sourceAccountId: sourceAccount.id,
      idempotencyKey: `db005-source-raw-${suffix}-${runId}`,
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
        ${`db005-source-normalized-${suffix}-${runId}`}, 'processed',
        ${occurrence.recordedAt}, ${occurrence.recordedAt}
      )
    `);
  });

  const pendingOccurrence = creation.sourceResolutionCommit?.before;
  if (pendingOccurrence === undefined) {
    throw new Error("DB005 source fixture requires a pending occurrence.");
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
        authorizationToken: `materialize:db005-occurrence-${suffix}-${runId}`,
        authorizedAt: pendingOccurrence.createdAt
      },
      materializedAt: pendingOccurrence.createdAt
    });
  expect(
    await createSqlInboxV2SourceOccurrenceRepository(db).materialize(
      materialization
    )
  ).toMatchObject({ kind: "materialized" });
  return {
    bindingProjection: bindingResult.projection,
    sourceAccountIdentity: identity,
    sourceConnection
  };
}

async function seedAdditionalSourceCreationOccurrence(input: {
  db: HuleeDatabase;
  creation: InboxV2MessageCreationCommit;
  context: Awaited<ReturnType<typeof seedExternalCreationAnchors>>;
  suffix: string;
}): Promise<void> {
  const occurrence = requireSourceOccurrence(input.creation);
  const pendingOccurrence = input.creation.sourceResolutionCommit?.before;
  const mapping = requireExternalThreadMapping(input.creation);
  if (
    pendingOccurrence === undefined ||
    occurrence.origin.kind === "provider_response" ||
    occurrence.origin.kind === "provider_echo"
  ) {
    throw new Error(
      "Additional source creation fixture requires pending event-backed evidence."
    );
  }
  const eventOrigin = occurrence.origin;
  await input.db.transaction(async (transaction) => {
    await insertRawInboundEvent(transaction, {
      id: eventOrigin.rawInboundEvent.id,
      sourceConnectionId: input.context.sourceConnection.id,
      sourceAccountId: occurrence.bindingContext.sourceAccount.id,
      idempotencyKey: `db005-source-race-raw-${input.suffix}-${runId}`,
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
        ${eventOrigin.rawInboundEvent.id},
        ${input.context.sourceConnection.id},
        ${occurrence.bindingContext.sourceAccount.id}, 'messenger',
        'synthetic', 'message', ${occurrence.direction}, 'private', 'v1',
        '{}'::jsonb, '{}'::jsonb,
        ${`db005-source-race-normalized-${input.suffix}-${runId}`},
        'processed', ${occurrence.recordedAt}, ${occurrence.recordedAt}
      )
    `);
  });
  const materialization =
    inboxV2SourceOccurrenceMaterializationCommitSchema.parse({
      tenantId,
      occurrence: pendingOccurrence,
      bindingMaterialization: {
        kind: "existing",
        currentProjection: input.context.bindingProjection,
        creationAuthority: null
      },
      externalThreadMapping: mapping,
      sourceAccountIdentity: input.context.sourceAccountIdentity,
      outboundDispatchAttempt: null,
      outboundDispatch: null,
      outboundRoute: null,
      authority: {
        kind: "trusted_service",
        trustedServiceId:
          occurrence.descriptor.adapterContract.loadedByTrustedServiceId,
        authorizationToken: `materialize:db005-source-race-${input.suffix}-${runId}`,
        authorizedAt: pendingOccurrence.createdAt
      },
      materializedAt: pendingOccurrence.createdAt
    });
  expect(
    await createSqlInboxV2SourceOccurrenceRepository(input.db).materialize(
      materialization
    )
  ).toMatchObject({ kind: "materialized" });
}

async function seedProviderResultOperator(
  db: HuleeDatabase,
  creation: InboxV2MessageCreationCommit,
  suffix: string
) {
  const operator = namespaceFixture(fixtureParticipant("employee"), suffix);
  if (
    operator.subject.kind !== "employee" ||
    operator.conversation.id !== creation.message.conversation.id
  ) {
    throw new Error(
      "Provider result operator must belong to the source Conversation."
    );
  }
  const operatorEmployee = operator.subject.employee;
  await db.transaction(async (transaction) => {
    await transaction.execute(sql`
      insert into employees (
        id, tenant_id, email, display_name, profile, created_at, updated_at
      ) values (
        ${operatorEmployee.id}, ${tenantId},
        ${`provider-result-${suffix}-${runId}@example.test`},
        'DB005 provider result operator', '{}'::jsonb,
        ${operator.createdAt}, ${operator.updatedAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_conversation_participants (
        tenant_id, id, conversation_id, subject_kind,
        subject_employee_id, revision, created_at, updated_at
      ) values (
        ${tenantId}, ${operator.id}, ${creation.message.conversation.id},
        'employee', ${operatorEmployee.id}, ${operator.revision},
        ${operator.createdAt}, ${operator.updatedAt}
      )
    `);
  });
  return operator;
}

type SystemEventTimelineFixture = Readonly<{
  commit: InboxV2SystemEventTimelineCreationCommit;
  payload: Readonly<Record<string, unknown>>;
}>;

function systemEventTimelineFixture(input: {
  conversationBefore: InboxV2SystemEventTimelineCreationCommit["timelineAllocation"]["conversationBefore"];
  suffix: string;
  source?: SystemEventTimelineFixture;
}): SystemEventTimelineFixture {
  const conversationBefore = input.conversationBefore;
  const conversation = {
    tenantId,
    kind: "conversation" as const,
    id: conversationBefore.id
  };
  const event =
    input.source?.commit.source.event ??
    fixtureReference(
      "event",
      `event:db005-system-timeline-source-${input.suffix}-${runId}`,
      tenantId
    );
  const occurredAt = input.source?.commit.source.occurredAt ?? fixtureT1;
  const recordedAt = input.source?.commit.source.recordedAt ?? fixtureT2;
  const committedAt = fixtureT2;
  const payload = input.source?.payload ?? {
    schemaId: INBOX_V2_CONVERSATION_SYSTEM_EVENT_PAYLOAD_SCHEMA_ID,
    schemaVersion: INBOX_V2_CONVERSATION_SYSTEM_EVENT_PAYLOAD_SCHEMA_VERSION,
    conversation,
    recordedAt,
    fact: {
      kind: "assignment_observed",
      value: `system-fact-${input.suffix}`
    }
  };
  const timelineSequence = String(
    BigInt(conversationBefore.head.latestTimelineSequence) + 1n
  );
  const item = fixtureTimelineItem(
    conversationBefore.transport === "internal" ? "internal" : "external",
    {
      tenantId,
      id: `timeline_item:db005-system-${input.suffix}-${runId}`,
      conversation,
      timelineSequence,
      subject: {
        kind: "system_event" as const,
        event,
        systemActorId: "core:timeline-system",
        appActor: {
          kind: "trusted_service" as const,
          trustedServiceId: "core:timeline-runtime"
        }
      },
      visibility: "workforce_metadata" as const,
      activity: {
        kind: "non_activity" as const,
        reasonId: "core:system-metadata"
      },
      occurredAt,
      receivedAt: recordedAt,
      revision: "1",
      createdAt: committedAt,
      updatedAt: committedAt
    }
  );
  const conversationAfter = {
    ...conversationBefore,
    head: {
      ...conversationBefore.head,
      latestTimelineSequence: timelineSequence,
      revision: String(BigInt(conversationBefore.head.revision) + 1n),
      updatedAt: committedAt
    }
  };
  return {
    payload,
    commit: inboxV2SystemEventTimelineCreationCommitSchema.parse({
      tenantId,
      timelineAllocation: {
        tenantId,
        conversationBefore,
        items: [item],
        conversationAfter,
        committedAt
      },
      source: {
        event,
        eventTypeId: "core:conversation.system_fact",
        eventVersion: "v1",
        conversation,
        payloadDigest: atomicSourcePayloadDigest(payload),
        occurredAt,
        recordedAt
      }
    })
  };
}

async function seedSystemTimelineSourceEvent(
  db: HuleeDatabase,
  fixture: SystemEventTimelineFixture
): Promise<void> {
  const source = fixture.commit.source;
  await db.execute(sql`
    insert into event_store (
      id, tenant_id, type, version, occurred_at, idempotency_key,
      payload, created_at, updated_at
    ) values (
      ${source.event.id}, ${tenantId}, ${source.eventTypeId},
      ${source.eventVersion}, ${source.occurredAt},
      ${`db005-system-timeline-${source.event.id}-${runId}`},
      ${JSON.stringify(fixture.payload)}::jsonb,
      ${source.recordedAt}, ${source.recordedAt}
    )
  `);
}

function authorizedSystemTimelineMaterializationFixture(input: {
  commit: InboxV2SystemEventTimelineCreationCommit;
  suffix: string;
  streamEpoch: string;
  resourceHeadId?: string;
}) {
  const token = `${input.suffix}-${runId}`;
  const item = input.commit.timelineAllocation.items[0]!;
  const commandId = `command:atomic-system-timeline-${token}`;
  const clientMutationId = `mutation:atomic-system-timeline-${token}`;
  const mutationId = `authorization-mutation:atomic-system-timeline-${token}`;
  const streamCommitId = `commit:atomic-system-timeline-${token}`;
  const changeId = `change:atomic-system-timeline-${token}`;
  const eventId = `event:atomic-system-timeline-${token}`;
  const projectionIntentId = `outbox-intent:atomic-system-timeline-${token}`;
  const decisionId = `authorization-decision:atomic-system-timeline-${token}`;
  const authorizationEpoch = `authorization:atomic-system-timeline-${token}`;
  const correlationId = `correlation:atomic-system-timeline-${token}`;
  const occurredAt = input.commit.timelineAllocation.committedAt;
  const notAfter = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
  const trustedServiceId = "core:timeline-runtime";
  const resourceHeadId =
    input.resourceHeadId ?? `authorization-resource:atomic-system-${token}`;
  const internalReference = (purpose: string) =>
    `internal-ref:${createHash("sha256")
      .update(`${token}:${purpose}`, "utf8")
      .digest("hex")
      .slice(0, 32)}`;
  const payloadReference = {
    tenantId,
    recordId: item.id,
    schemaId: INBOX_V2_TIMELINE_ITEM_SCHEMA_ID,
    schemaVersion: INBOX_V2_TIMELINE_SCHEMA_VERSION,
    digest: atomicSourcePayloadDigest(item)
  };
  const domainCommitReference = {
    tenantId,
    recordId: item.id,
    schemaId: INBOX_V2_SYSTEM_EVENT_TIMELINE_CREATION_COMMIT_SCHEMA_ID,
    schemaVersion:
      INBOX_V2_SYSTEM_EVENT_TIMELINE_CREATION_COMMIT_SCHEMA_VERSION,
    digest: atomicSourcePayloadDigest(input.commit)
  };
  const decision = {
    tenantId,
    id: decisionId,
    authorizationEpoch,
    principal: { kind: "trusted_service" as const, trustedServiceId },
    permissionId: INBOX_V2_SYSTEM_EVENT_TIMELINE_PERMISSION_ID,
    resourceScopeId: "core:conversation",
    resource: {
      tenantId,
      entityTypeId: "core:conversation",
      entityId: item.conversation.id
    },
    resourceAccessRevision: "1",
    decisionRevision: "1",
    decisionHash: atomicSourceSha256(`${token}:decision`),
    outcome: "allowed" as const,
    decidedAt: occurredAt,
    notAfter
  };
  const entity = {
    tenantId,
    entityTypeId: "core:timeline-item",
    entityId: item.id
  } as const;
  const change = {
    id: changeId,
    ordinal: 1,
    entity,
    resultingRevision: item.revision,
    timeline: {
      conversation: item.conversation,
      timelineSequence: item.timelineSequence
    },
    audience: "workforce_metadata" as const,
    state: {
      kind: "upsert" as const,
      stateSchemaId: payloadReference.schemaId,
      stateSchemaVersion: payloadReference.schemaVersion,
      stateHash: payloadReference.digest,
      payloadReference,
      domainCommitReference
    }
  };
  const event = {
    id: eventId,
    typeId: "core:timeline.changed" as const,
    payloadSchemaId: domainCommitReference.schemaId,
    payloadSchemaVersion: domainCommitReference.schemaVersion,
    ordinal: "1",
    changeIds: [changeId],
    subjects: [entity],
    payloadReference: domainCommitReference,
    correlationId,
    commandIds: [commandId],
    clientMutationIds: [clientMutationId],
    authorizationDecisionRefs: [decision],
    accessEffect: { kind: "none" as const },
    occurredAt: item.occurredAt,
    recordedAt: occurredAt,
    eventHash: atomicSourceSha256(`${token}:event`)
  };
  return {
    commandId,
    resourceHeadId,
    streamCommitId,
    streamEpoch: input.streamEpoch,
    input: {
      tenantId,
      command: {
        id: commandId,
        requestId: `request:atomic-system-timeline-${token}`,
        clientMutationId,
        commandTypeId: INBOX_V2_SYSTEM_EVENT_TIMELINE_COMMAND_TYPE_ID,
        requestHash: atomicSourceSha256(`${token}:request`),
        actor: { kind: "trusted_service", trustedServiceId },
        authorizationDecisionId: decisionId,
        authorizationEpoch,
        authorizedAt: occurredAt,
        publicResultCode: "core:timeline.item_created",
        resultReference: payloadReference,
        sensitiveResultReference: null
      },
      revisions: {
        expectedTenantRbacRevision: "1",
        expectedSharedAccessRevision: "1",
        advanceTenantRbac: false,
        advanceSharedAccess: false,
        employees: [],
        resources: [
          {
            resourceKind: "conversation",
            resourceId: item.conversation.id,
            resourceHeadId,
            expectedResourceAccessRevision: "1",
            advance: "none"
          }
        ]
      },
      records: {
        mutationId,
        relationKind: null,
        streamCommitId,
        expectedStreamEpoch: input.streamEpoch,
        audienceImpact: { kind: "none" },
        commitHash: atomicSourceSha256(`${token}:stream-commit`),
        correlationId,
        changes: [change],
        events: [event],
        outboxIntents: [
          {
            id: projectionIntentId,
            ordinal: 1,
            typeId: "core:projection.update",
            handlerId: "core:inbox-projection",
            effectClass: "projection",
            eventId,
            changeIds: [changeId],
            payloadReference: null,
            consumerDedupeKey: atomicSourceSha256(`${token}:projection-dedupe`),
            correlationId,
            availableAt: occurredAt,
            intentHash: atomicSourceSha256(`${token}:projection-intent`)
          }
        ],
        audit: {
          id: `authorization-audit:atomic-system-timeline-${token}`,
          actionId: INBOX_V2_SYSTEM_EVENT_TIMELINE_COMMAND_TYPE_ID,
          target: {
            tenantId,
            entityTypeId: "core:timeline-item",
            entityId: internalReference("audit-target")
          },
          reasonCodeId: "core:system-timeline-item-created",
          matchedPermissionIds: [decision.permissionId],
          grantSourceIds: [internalReference("grant-source")],
          authorizationScopeIds: [decision.resourceScopeId],
          overrideReasonCodeId: null,
          policyVersion: "v1",
          evidenceReference: domainCommitReference,
          authorizationDecisionRefs: [decision],
          correlationId,
          outcome: "succeeded",
          revisionDeltaHash: computeInboxV2LeafHashDigest([]),
          previousAuditHash: null,
          auditHash: atomicSourceSha256(`${token}:audit`),
          occurredAt,
          recordedAt: occurredAt,
          expiresAt,
          facets: [
            {
              ordinal: 1,
              dimension: "tenant",
              reference: {
                tenantId,
                entityTypeId: "core:tenant",
                entityId: internalReference("tenant-facet")
              },
              relation: "affected",
              facetHash: atomicSourceSha256(`${token}:audit-facet`)
            }
          ]
        }
      },
      occurredAt
    } as unknown as WithInboxV2AuthorizedCommandMutationInput
  };
}

async function loadAtomicSystemTimelineState(
  db: HuleeDatabase,
  fixture: SystemEventTimelineFixture,
  authorized: ReturnType<typeof authorizedSystemTimelineMaterializationFixture>
) {
  const item = fixture.commit.timelineAllocation.items[0]!;
  const result = await db.execute<Record<string, string | null>>(sql`
    select
      (select count(*)::text from inbox_v2_auth_command_records
        where tenant_id = ${tenantId} and id = ${authorized.commandId})
        as commands,
      (select count(*)::text from inbox_v2_tenant_stream_commits
        where tenant_id = ${tenantId} and id = ${authorized.streamCommitId})
        as stream_commits,
      (select last_position::text from inbox_v2_tenant_stream_heads
        where tenant_id = ${tenantId}) as stream_position,
      (select count(*)::text from inbox_v2_tenant_stream_changes
        where tenant_id = ${tenantId}
          and stream_commit_id = ${authorized.streamCommitId}) as changes,
      (select count(*)::text from inbox_v2_domain_events
        where tenant_id = ${tenantId}
          and stream_commit_id = ${authorized.streamCommitId}) as events,
      (select count(*)::text from inbox_v2_outbox_intents
        where tenant_id = ${tenantId}
          and stream_commit_id = ${authorized.streamCommitId}) as outbox_intents,
      (select count(*)::text from inbox_v2_timeline_items
        where tenant_id = ${tenantId} and id = ${item.id}) as timeline_items,
      (select count(*)::text from inbox_v2_timeline_subject_details
        where tenant_id = ${tenantId} and timeline_item_id = ${item.id}
          and system_event_id = ${fixture.commit.source.event.id})
        as subject_details,
      (select latest_timeline_sequence::text
         from inbox_v2_conversation_heads
        where tenant_id = ${tenantId}
          and conversation_id = ${item.conversation.id}) as latest_sequence,
      (select revision::text from inbox_v2_conversation_heads
        where tenant_id = ${tenantId}
          and conversation_id = ${item.conversation.id}) as head_revision,
      (select to_char(occurred_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
         from inbox_v2_timeline_items
        where tenant_id = ${tenantId} and id = ${item.id}) as occurred_at,
      (select to_char(received_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
         from inbox_v2_timeline_items
        where tenant_id = ${tenantId} and id = ${item.id}) as received_at,
      (select to_char(created_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
         from inbox_v2_timeline_items
        where tenant_id = ${tenantId} and id = ${item.id}) as created_at
  `);
  return result.rows[0]!;
}

function authorizedSourceMaterializationFixture(input: {
  creation: InboxV2MessageCreationCommit;
  operator: ReturnType<typeof fixtureParticipant>;
  resourceHeadId?: string;
  streamEpoch?: string;
  suffix: string;
}) {
  if (input.operator.subject.kind !== "employee") {
    throw new Error("Atomic source fixture requires an employee coordinator.");
  }
  const occurredAt = input.creation.timelineAllocation.committedAt;
  const token = `${input.suffix}-${runId}`;
  const commandId = `command:atomic-source-${token}`;
  const clientMutationId = `mutation:atomic-source-${token}`;
  const mutationId = `authorization-mutation:atomic-source-${token}`;
  const streamCommitId = `commit:atomic-source-${token}`;
  const streamEpoch =
    input.streamEpoch ?? `stream-epoch:atomic-source-${token}`;
  const correlationId = `correlation:atomic-source-${token}`;
  const messageChangeId = `change:atomic-source-message-${token}`;
  const occurrenceChangeId = `change:atomic-source-occurrence-${token}`;
  const eventId = `event:atomic-source-message-${token}`;
  const occurrenceEventId = `event:atomic-source-occurrence-${token}`;
  const projectionIntentId = `outbox-intent:atomic-source-message-${token}`;
  const occurrenceProjectionIntentId = `outbox-intent:atomic-source-occurrence-${token}`;
  const authorizationEpoch = `authorization:atomic-source-${token}`;
  const decisionId = `authorization-decision:atomic-source-${token}`;
  const notAfter = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
  const employee = input.operator.subject.employee;
  const conversation = input.creation.message.conversation;
  const resourceHeadId =
    input.resourceHeadId ?? `authorization-resource:atomic-source-${token}`;
  const resolution = input.creation.sourceResolutionCommit;
  if (resolution === null) {
    throw new Error("Atomic source fixture requires a resolution commit.");
  }
  const messageReference = {
    tenantId,
    recordId: input.creation.message.id,
    schemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
    schemaVersion: INBOX_V2_MESSAGE_SCHEMA_VERSION,
    digest: atomicSourcePayloadDigest(input.creation.message)
  };
  const domainCommitReference = {
    tenantId,
    recordId: input.creation.initialRevision.id,
    schemaId: "core:inbox-v2.message-creation-commit",
    schemaVersion: "v1",
    digest: atomicSourcePayloadDigest(input.creation)
  };
  const occurrenceReference = {
    tenantId,
    recordId: resolution.after.id,
    schemaId: INBOX_V2_SOURCE_OCCURRENCE_SCHEMA_ID,
    schemaVersion: INBOX_V2_EXTERNAL_MESSAGE_SCHEMA_VERSION,
    digest: atomicSourcePayloadDigest(resolution.after)
  };
  const occurrenceResolutionReference = {
    tenantId,
    recordId: deriveInboxV2SourceOccurrenceResolutionTransitionId(resolution),
    schemaId: INBOX_V2_SOURCE_OCCURRENCE_RESOLUTION_COMMIT_SCHEMA_ID,
    schemaVersion: INBOX_V2_EXTERNAL_MESSAGE_SCHEMA_VERSION,
    digest: atomicSourcePayloadDigest(resolution)
  };
  const decision = {
    tenantId,
    id: decisionId,
    authorizationEpoch,
    principal: { kind: "employee" as const, employee },
    permissionId: "core:message.receive_external",
    resourceScopeId: "core:conversation",
    resource: {
      tenantId,
      entityTypeId: "core:conversation",
      entityId: conversation.id
    },
    resourceAccessRevision: "1",
    decisionRevision: "1",
    decisionHash: atomicSourceSha256(`${token}:authorization-decision`),
    outcome: "allowed" as const,
    decidedAt: occurredAt,
    notAfter
  };
  const change = {
    id: messageChangeId,
    ordinal: 1,
    entity: {
      tenantId,
      entityTypeId: "core:message",
      entityId: input.creation.message.id
    },
    resultingRevision: "1",
    timeline: {
      conversation,
      timelineSequence:
        input.creation.timelineAllocation.items[0]?.timelineSequence
    },
    audience: "conversation_external" as const,
    state: {
      kind: "upsert" as const,
      stateSchemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
      stateSchemaVersion: INBOX_V2_MESSAGE_SCHEMA_VERSION,
      stateHash: messageReference.digest,
      payloadReference: messageReference,
      domainCommitReference
    }
  };
  const occurrenceChange = {
    id: occurrenceChangeId,
    ordinal: 2,
    entity: {
      tenantId,
      entityTypeId: "core:source-occurrence",
      entityId: resolution.after.id
    },
    resultingRevision: resolution.resultingRevision,
    timeline: null,
    audience: "policy_filtered" as const,
    state: {
      kind: "upsert" as const,
      stateSchemaId: INBOX_V2_SOURCE_OCCURRENCE_SCHEMA_ID,
      stateSchemaVersion: INBOX_V2_EXTERNAL_MESSAGE_SCHEMA_VERSION,
      stateHash: occurrenceReference.digest,
      payloadReference: occurrenceReference,
      domainCommitReference: occurrenceResolutionReference
    }
  };
  const internalReference = (purpose: string) =>
    `internal-ref:${createHash("sha256")
      .update(`${token}:${purpose}`, "utf8")
      .digest("hex")
      .slice(0, 32)}`;

  return {
    commandId,
    resourceHeadId,
    streamCommitId,
    streamEpoch,
    eventId,
    projectionIntentId,
    input: {
      tenantId,
      command: {
        id: commandId,
        requestId: `request:atomic-source-${token}`,
        clientMutationId,
        commandTypeId: "core:message.receive",
        requestHash: atomicSourceSha256(`${token}:request`),
        actor: { kind: "employee", employeeId: employee.id },
        authorizationDecisionId: decisionId,
        authorizationEpoch,
        authorizedAt: occurredAt,
        publicResultCode: "core:message.received",
        resultReference: messageReference,
        sensitiveResultReference: null
      },
      revisions: {
        expectedTenantRbacRevision: "1",
        expectedSharedAccessRevision: "1",
        advanceTenantRbac: false,
        advanceSharedAccess: false,
        employees: [
          {
            employeeId: employee.id,
            expectedEmployeeAccessRevision: "1",
            expectedEmployeeInboxRelationRevision: "1",
            advanceEmployeeAccess: false,
            advanceEmployeeInboxRelation: false
          }
        ],
        resources: [
          {
            resourceKind: "conversation",
            resourceId: conversation.id,
            resourceHeadId,
            expectedResourceAccessRevision: "1",
            advance: "none"
          }
        ]
      },
      records: {
        mutationId,
        relationKind: null,
        streamCommitId,
        expectedStreamEpoch: streamEpoch,
        audienceImpact: { kind: "none" },
        commitHash: atomicSourceSha256(`${token}:stream-commit`),
        correlationId,
        changes: [change, occurrenceChange],
        events: [
          {
            id: eventId,
            typeId: "core:message.changed",
            payloadSchemaId: domainCommitReference.schemaId,
            payloadSchemaVersion: domainCommitReference.schemaVersion,
            ordinal: "1",
            changeIds: [messageChangeId],
            subjects: [change.entity],
            payloadReference: domainCommitReference,
            correlationId,
            commandIds: [commandId],
            clientMutationIds: [clientMutationId],
            authorizationDecisionRefs: [decision],
            accessEffect: { kind: "none" },
            occurredAt: input.creation.initialRevision.occurredAt,
            recordedAt: input.creation.initialRevision.recordedAt,
            eventHash: atomicSourceSha256(`${token}:message-event`)
          },
          {
            id: occurrenceEventId,
            typeId: "core:source-occurrence.changed",
            payloadSchemaId: occurrenceResolutionReference.schemaId,
            payloadSchemaVersion: occurrenceResolutionReference.schemaVersion,
            ordinal: "2",
            changeIds: [occurrenceChangeId],
            subjects: [occurrenceChange.entity],
            payloadReference: occurrenceResolutionReference,
            correlationId,
            commandIds: [commandId],
            clientMutationIds: [clientMutationId],
            authorizationDecisionRefs: [decision],
            accessEffect: { kind: "none" },
            occurredAt: resolution.changedAt,
            recordedAt: occurredAt,
            eventHash: atomicSourceSha256(`${token}:occurrence-event`)
          }
        ],
        outboxIntents: [
          {
            id: projectionIntentId,
            ordinal: 1,
            typeId: "core:projection.update",
            handlerId: "core:inbox-projection",
            effectClass: "projection",
            eventId,
            changeIds: [messageChangeId],
            payloadReference: null,
            consumerDedupeKey: atomicSourceSha256(`${token}:projection-dedupe`),
            correlationId,
            availableAt: occurredAt,
            intentHash: atomicSourceSha256(`${token}:projection-intent`)
          },
          {
            id: occurrenceProjectionIntentId,
            ordinal: 2,
            typeId: "core:projection.update",
            handlerId: "core:source-occurrence-projection",
            effectClass: "projection",
            eventId: occurrenceEventId,
            changeIds: [occurrenceChangeId],
            payloadReference: null,
            consumerDedupeKey: atomicSourceSha256(
              `${token}:occurrence-projection-dedupe`
            ),
            correlationId,
            availableAt: occurredAt,
            intentHash: atomicSourceSha256(
              `${token}:occurrence-projection-intent`
            )
          }
        ],
        audit: {
          id: `authorization-audit:atomic-source-${token}`,
          actionId: "core:message.receive",
          target: {
            tenantId,
            entityTypeId: "core:message",
            entityId: internalReference("audit-target")
          },
          reasonCodeId: "core:source-message-materialized",
          matchedPermissionIds: [decision.permissionId],
          grantSourceIds: [internalReference("grant-source")],
          authorizationScopeIds: [decision.resourceScopeId],
          overrideReasonCodeId: null,
          policyVersion: "v1",
          evidenceReference: domainCommitReference,
          authorizationDecisionRefs: [decision],
          correlationId,
          outcome: "succeeded",
          revisionDeltaHash: computeInboxV2LeafHashDigest([]),
          previousAuditHash: null,
          auditHash: atomicSourceSha256(`${token}:audit`),
          occurredAt,
          recordedAt: occurredAt,
          expiresAt,
          facets: [
            {
              ordinal: 1,
              dimension: "tenant",
              reference: {
                tenantId,
                entityTypeId: "core:tenant",
                entityId: internalReference("tenant-facet")
              },
              relation: "affected",
              facetHash: atomicSourceSha256(`${token}:audit-facet`)
            }
          ]
        }
      },
      occurredAt
    } as unknown as WithInboxV2AuthorizedCommandMutationInput
  };
}

async function loadAtomicSourceMaterializationState(
  db: HuleeDatabase,
  creation: InboxV2MessageCreationCommit,
  authorized: ReturnType<typeof authorizedSourceMaterializationFixture>
) {
  const occurrence = creation.sourceResolutionCommit?.before;
  const timelineItem = creation.timelineAllocation.items[0];
  if (occurrence === undefined || timelineItem === undefined) {
    throw new Error(
      "Atomic source fixture requires one pending occurrence/item."
    );
  }
  const result = await db.execute<Record<string, string | null>>(sql`
    select
      (select count(*)::text from inbox_v2_auth_command_records
        where tenant_id = ${tenantId} and id = ${authorized.commandId})
        as commands,
      (select count(*)::text from inbox_v2_tenant_stream_commits
        where tenant_id = ${tenantId} and id = ${authorized.streamCommitId})
        as stream_commits,
      (select last_position::text from inbox_v2_tenant_stream_heads
        where tenant_id = ${tenantId}) as stream_position,
      (select count(*)::text from inbox_v2_tenant_stream_changes
        where tenant_id = ${tenantId}
          and stream_commit_id = ${authorized.streamCommitId}) as changes,
      (select count(*)::text from inbox_v2_domain_events
        where tenant_id = ${tenantId}
          and stream_commit_id = ${authorized.streamCommitId}) as events,
      (select count(*)::text from inbox_v2_outbox_intents
        where tenant_id = ${tenantId}
          and stream_commit_id = ${authorized.streamCommitId}) as outbox_intents,
      (select count(*)::text
         from inbox_v2_outbox_work_items work_item
         inner join inbox_v2_outbox_intents intent
           on intent.tenant_id = work_item.tenant_id
          and intent.id = work_item.intent_id
        where work_item.tenant_id = ${tenantId}
          and intent.stream_commit_id = ${authorized.streamCommitId})
        as outbox_work,
      (select count(*)::text from inbox_v2_messages
        where tenant_id = ${tenantId} and id = ${creation.message.id})
        as messages,
      (select count(*)::text from inbox_v2_timeline_items
        where tenant_id = ${tenantId} and id = ${timelineItem.id})
        as timeline_items,
      (select count(*)::text from inbox_v2_timeline_contents
        where tenant_id = ${tenantId} and id = ${creation.content.id})
        as timeline_contents,
      (select count(*)::text from inbox_v2_message_revisions
        where tenant_id = ${tenantId}
          and message_id = ${creation.message.id}) as message_revisions,
      (select count(*)::text from inbox_v2_external_message_references
        where tenant_id = ${tenantId}
          and id = ${creation.externalMessageReference?.id ?? ""})
        as external_references,
      (select count(*)::text
        from inbox_v2_source_occurrence_resolution_transitions
        where tenant_id = ${tenantId}
          and source_occurrence_id = ${occurrence.id}) as resolution_transitions,
      (select count(*)::text
        from inbox_v2_atomic_source_resolution_materializations
        where tenant_id = ${tenantId}
          and source_occurrence_id = ${occurrence.id})
        as source_resolution_materializations,
      (select count(*)::text from inbox_v2_message_transport_links
        where tenant_id = ${tenantId}
          and source_occurrence_id = ${occurrence.id}) as transport_links,
      (select resolution_state::text from inbox_v2_source_occurrences
        where tenant_id = ${tenantId} and id = ${occurrence.id})
        as occurrence_state,
      (select revision::text from inbox_v2_source_occurrences
        where tenant_id = ${tenantId} and id = ${occurrence.id})
        as occurrence_revision,
      (select resolved_external_message_reference_id
        from inbox_v2_source_occurrences
        where tenant_id = ${tenantId} and id = ${occurrence.id})
        as occurrence_reference_id
  `);
  return result.rows[0]!;
}

function requireAcceptedAtomicSource(
  fixture:
    | {
        creation: InboxV2MessageCreationCommit;
        authorized: ReturnType<typeof authorizedSourceMaterializationFixture>;
        context: Awaited<ReturnType<typeof seedExternalCreationAnchors>>;
      }
    | undefined
) {
  if (fixture === undefined) {
    throw new Error("The accepted atomic source fixture is not available.");
  }
  return fixture;
}

async function insertCoherentDuplicateProjectionAndRecheckDomainClosure(
  db: HuleeDatabase,
  input: WithInboxV2AuthorizedCommandMutationInput,
  duplicateProjection: WithInboxV2AuthorizedCommandMutationInput["records"]["outboxIntents"][number]
): Promise<void> {
  const outboxIntents = [...input.records.outboxIntents, duplicateProjection];
  const manifestDigest = computeInboxV2TenantStreamManifestDigest({
    ...input.records,
    outboxIntents
  });
  const projectionIntentCount = outboxIntents.filter(
    ({ effectClass }) => effectClass === "projection"
  ).length;

  await db.transaction(async (transaction) => {
    await transaction.execute(sql`
      create temporary table inbox_v2_test_mutation_backup
      on commit drop
      as select *
           from inbox_v2_auth_mutation_commits
          where tenant_id = ${input.tenantId}
            and mutation_id = ${input.records.mutationId}
    `);
    await transaction.execute(sql`
      insert into inbox_v2_outbox_intents (
        tenant_id, id, mutation_id, stream_commit_id, stream_position,
        ordinal, type_id, handler_id, effect_class, event_id, change_ids,
        payload_reference, consumer_dedupe_key, correlation_id, available_at,
        intent_hash, created_at
      )
      select original_intent.tenant_id,
             ${duplicateProjection.id},
             original_intent.mutation_id,
             original_intent.stream_commit_id,
             original_intent.stream_position,
             ${duplicateProjection.ordinal},
             ${duplicateProjection.typeId},
             ${duplicateProjection.handlerId},
             ${duplicateProjection.effectClass},
             ${duplicateProjection.eventId},
             ${JSON.stringify(duplicateProjection.changeIds)}::jsonb,
             ${
               duplicateProjection.payloadReference === null
                 ? null
                 : JSON.stringify(duplicateProjection.payloadReference)
             }::jsonb,
             ${duplicateProjection.consumerDedupeKey},
             ${duplicateProjection.correlationId},
             ${duplicateProjection.availableAt},
             ${duplicateProjection.intentHash},
             original_intent.created_at
        from inbox_v2_outbox_intents original_intent
       where original_intent.tenant_id = ${input.tenantId}
         and original_intent.id = ${input.records.outboxIntents[0]!.id}
    `);
    await transaction.execute(
      sql`set local session_replication_role = replica`
    );
    await transaction.execute(sql`
      update inbox_v2_tenant_stream_commits
         set outbox_intent_count = ${outboxIntents.length},
             outbox_intent_ids = ${JSON.stringify(
               outboxIntents.map(({ id }) => id)
             )}::jsonb,
             manifest_digest_sha256 = ${manifestDigest}
       where tenant_id = ${input.tenantId}
         and id = ${input.records.streamCommitId}
         and mutation_id = ${input.records.mutationId}
    `);
    await transaction.execute(sql`
      delete from inbox_v2_auth_mutation_commits
       where tenant_id = ${input.tenantId}
         and mutation_id = ${input.records.mutationId}
    `);
    await transaction.execute(sql`set local session_replication_role = origin`);
    await transaction.execute(sql`
      insert into inbox_v2_auth_mutation_commits (
        tenant_id, mutation_id, command_record_id, stream_commit_id,
        audit_event_id, revision_effect_count,
        revision_effect_digest_sha256, relation_write_count,
        relation_write_digest_sha256, projection_intent_count,
        manifest_digest_sha256, committed_at, created_at
      )
      select tenant_id, mutation_id, command_record_id, stream_commit_id,
             audit_event_id, revision_effect_count,
             revision_effect_digest_sha256, relation_write_count,
             relation_write_digest_sha256, ${projectionIntentCount},
             manifest_digest_sha256, committed_at, created_at
        from inbox_v2_test_mutation_backup
    `);
    await transaction.execute(sql`set constraints all immediate`);
  });
}

function atomicSourceSha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function atomicSourcePayloadDigest(value: unknown): `sha256:${string}` {
  return `sha256:${computeInboxV2TimelineMessageCommitDigest(value)}`;
}

async function seedProviderSystemParticipant(
  db: HuleeDatabase,
  participant: ReturnType<typeof providerSystemParticipant>
) {
  if (participant.subject.kind !== "system") {
    throw new Error("Expected one provider-system participant.");
  }
  await db.execute(sql`
    insert into inbox_v2_conversation_participants (
      tenant_id, id, conversation_id, subject_kind,
      subject_employee_id, subject_source_external_identity_id,
      subject_client_contact_id, subject_bot_identity_id,
      subject_system_actor_id, subject_legacy_provenance_id,
      revision, created_at, updated_at
    ) values (
      ${tenantId}, ${participant.id}, ${participant.conversation.id},
      'system', null, null, null, null,
      ${participant.subject.systemActorId}, null, ${participant.revision},
      ${participant.createdAt}, ${participant.updatedAt}
    )
  `);
}

async function seedProviderResultOutboundRoute(input: {
  db: HuleeDatabase;
  creation: InboxV2MessageCreationCommit;
  context: Awaited<ReturnType<typeof seedExternalCreationAnchors>>;
  operator: ReturnType<typeof fixtureParticipant>;
  suffix: string;
}) {
  const sourceOccurrence = requireSourceOccurrence(input.creation);
  const externalMessageReference = input.creation.externalMessageReference;
  const sourceResolutionCommit = input.creation.sourceResolutionCommit;
  const binding = input.context.bindingProjection.binding;
  if (
    externalMessageReference === null ||
    sourceResolutionCommit === null ||
    input.operator.subject.kind !== "employee"
  ) {
    throw new Error(
      "Provider result route requires an external target and Employee principal."
    );
  }
  const operatorEmployee = input.operator.subject.employee;
  const rawRoute = namespaceFixture(
    fixtureExternalTargetRoute(
      "core:message.reaction.set",
      "core:message.reaction.set_external"
    ),
    input.suffix
  );
  if (rawRoute.referenceContext.kind !== "external_message") {
    throw new Error("Provider result route requires exact message context.");
  }
  const sourceOccurrenceReference = fixtureReference(
    "source_occurrence",
    sourceOccurrence.id,
    tenantId
  );
  const externalMessageReferenceReference = fixtureReference(
    "external_message_reference",
    externalMessageReference.id,
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
  const referenceContext = {
    ...rawRoute.referenceContext,
    externalThread: binding.externalThread,
    externalMessageReference: externalMessageReferenceReference,
    sourceOccurrence: sourceOccurrenceReference,
    originBinding: {
      tenantId,
      kind: "source_thread_binding" as const,
      id: binding.id
    },
    originSourceAccount: binding.sourceAccount,
    portability: sourceOccurrence.referencePortability,
    resolutionDecision: {
      ...rawRoute.referenceContext.resolutionDecision,
      tenantId,
      externalThread: binding.externalThread,
      externalMessageReference: externalMessageReferenceReference,
      sourceOccurrence: sourceOccurrenceReference,
      originBinding: {
        tenantId,
        kind: "source_thread_binding" as const,
        id: binding.id
      },
      originSourceAccount: binding.sourceAccount,
      occurrenceRevision: sourceOccurrence.revision,
      occurrenceBindingGeneration:
        sourceOccurrence.bindingContext.bindingGeneration,
      portability: sourceOccurrence.referencePortability,
      loadedByTrustedServiceId:
        sourceResolutionCommit.resolver.trustedServiceId,
      decidedAt: sourceResolutionCommit.changedAt
    }
  };
  const referenceTarget = {
    kind: "external_message" as const,
    externalMessageReference: externalMessageReferenceReference,
    sourceOccurrence: sourceOccurrenceReference
  };
  const principal = {
    kind: "employee" as const,
    employee: operatorEmployee
  };
  const authorizationTarget = {
    ...rawRoute.conversationAuthorization.target,
    conversation: input.creation.message.conversation,
    externalThread: binding.externalThread,
    sourceThreadBinding: {
      tenantId,
      kind: "source_thread_binding" as const,
      id: binding.id
    },
    sourceAccount: binding.sourceAccount,
    sourceConnection: binding.sourceConnection,
    operationId: rawRoute.operationId,
    contentKindId: rawRoute.contentKindId,
    bindingFence,
    referenceTarget
  };
  const conversationAuthorization = {
    ...rawRoute.conversationAuthorization,
    tenantId,
    principal,
    target: authorizationTarget
  };
  const sourceAccountAuthorization = {
    ...rawRoute.sourceAccountAuthorization,
    tenantId,
    principal,
    target: authorizationTarget
  };
  const route = inboxV2OutboundRouteSchema.parse({
    ...rawRoute,
    tenantId,
    principal,
    conversation: input.creation.message.conversation,
    externalThread: binding.externalThread,
    sourceThreadBinding: {
      tenantId,
      kind: "source_thread_binding",
      id: binding.id
    },
    sourceAccount: binding.sourceAccount,
    sourceConnection: binding.sourceConnection,
    bindingFence,
    adapterContract: binding.capabilities.adapterContract,
    routeDescriptor: binding.routeDescriptor,
    conversationAuthorization,
    sourceAccountAuthorization,
    referenceContext,
    runtimeObservationAtResolution: {
      state: binding.runtimeHealth.state,
      revision: binding.runtimeHealth.revision,
      observedAt: binding.runtimeHealth.checkedAt,
      diagnostic: binding.runtimeHealth.diagnostic
    },
    selection: {
      ...rawRoute.selection,
      intent: {
        kind: "explicit_occurrence",
        occurrence: sourceOccurrenceReference
      },
      reason: "explicit_occurrence"
    }
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
  await expect(
    createSqlInboxV2OutboundTransportRepository(input.db).persistRoutePolicy(
      policy
    )
  ).resolves.toMatchObject({ kind: "committed" });
  const fenceResult = await input.db.execute<{
    binding_id: unknown;
    external_thread_id: unknown;
    source_connection_id: unknown;
    source_account_id: unknown;
    binding_revision: unknown;
    account_generation: unknown;
    binding_generation: unknown;
    remote_access_revision: unknown;
    administrative_revision: unknown;
    capability_revision: unknown;
    route_descriptor_revision: unknown;
    remote_access_state: unknown;
    administrative_state: unknown;
    runtime_health_state: unknown;
  }>(sql`
    select binding_id, external_thread_id, source_connection_id,
           source_account_id, revision as binding_revision,
           account_generation, binding_generation, remote_access_revision,
           administrative_revision, capability_revision,
           route_descriptor_revision, remote_access_state,
           administrative_state, runtime_health_state
      from inbox_v2_source_thread_binding_heads
     where tenant_id = ${tenantId}
       and binding_id = ${binding.id}
  `);
  const fence = fenceResult.rows[0];
  if (fence === undefined) {
    throw new Error("Provider result route requires a binding fence.");
  }
  const insert = await executeHistoricalFixtureSql(
    input.db,
    buildInsertInboxV2OutboundRouteSql(route, fence)
  );
  expect(insert.rows).toHaveLength(1);
  return route;
}

async function seedMessageSendOutboundRoute(input: {
  db: HuleeDatabase;
  creation: InboxV2MessageCreationCommit;
  context: Awaited<ReturnType<typeof seedExternalCreationAnchors>>;
  operator: ReturnType<typeof fixtureParticipant>;
  routePolicy?: ReturnType<
    typeof inboxV2OutboundRouteSchema.parse
  >["routePolicy"];
  suffix: string;
}) {
  const binding = input.context.bindingProjection.binding;
  const rawRoute = namespaceFixture(
    fixtureHuleeCreationCommit().outboundRoute,
    input.suffix
  );
  if (rawRoute === null || input.operator.subject.kind !== "employee") {
    throw new Error(
      "Message-send route requires a route fixture and Employee principal."
    );
  }
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
  const principal = {
    kind: "employee" as const,
    employee: input.operator.subject.employee
  };
  const authorizationTarget = {
    ...rawRoute.conversationAuthorization.target,
    conversation: input.creation.message.conversation,
    externalThread: binding.externalThread,
    sourceThreadBinding: {
      tenantId,
      kind: "source_thread_binding" as const,
      id: binding.id
    },
    sourceAccount: binding.sourceAccount,
    sourceConnection: binding.sourceConnection,
    operationId: rawRoute.operationId,
    contentKindId: rawRoute.contentKindId,
    bindingFence,
    referenceTarget: { kind: "none" as const }
  };
  const route = inboxV2OutboundRouteSchema.parse({
    ...rawRoute,
    tenantId,
    principal,
    conversation: input.creation.message.conversation,
    externalThread: binding.externalThread,
    sourceThreadBinding: {
      tenantId,
      kind: "source_thread_binding",
      id: binding.id
    },
    sourceAccount: binding.sourceAccount,
    sourceConnection: binding.sourceConnection,
    routePolicy: input.routePolicy ?? rawRoute.routePolicy,
    bindingFence,
    adapterContract: binding.capabilities.adapterContract,
    routeDescriptor: binding.routeDescriptor,
    conversationAuthorization: {
      ...rawRoute.conversationAuthorization,
      tenantId,
      principal,
      target: authorizationTarget
    },
    sourceAccountAuthorization: {
      ...rawRoute.sourceAccountAuthorization,
      tenantId,
      principal,
      target: authorizationTarget
    },
    referenceContext: { kind: "none" },
    runtimeObservationAtResolution: {
      state: binding.runtimeHealth.state,
      revision: binding.runtimeHealth.revision,
      observedAt: binding.runtimeHealth.checkedAt,
      diagnostic: binding.runtimeHealth.diagnostic
    }
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
  if (input.routePolicy === undefined) {
    await expect(
      createSqlInboxV2OutboundTransportRepository(input.db).persistRoutePolicy(
        policy
      )
    ).resolves.toMatchObject({ kind: "committed" });
  }
  const fenceResult = await input.db.execute<{
    binding_id: unknown;
    external_thread_id: unknown;
    source_connection_id: unknown;
    source_account_id: unknown;
    binding_revision: unknown;
    account_generation: unknown;
    binding_generation: unknown;
    remote_access_revision: unknown;
    administrative_revision: unknown;
    capability_revision: unknown;
    route_descriptor_revision: unknown;
    remote_access_state: unknown;
    administrative_state: unknown;
    runtime_health_state: unknown;
  }>(sql`
    select binding_id, external_thread_id, source_connection_id,
           source_account_id, revision as binding_revision,
           account_generation, binding_generation, remote_access_revision,
           administrative_revision, capability_revision,
           route_descriptor_revision, remote_access_state,
           administrative_state, runtime_health_state
      from inbox_v2_source_thread_binding_heads
     where tenant_id = ${tenantId}
       and binding_id = ${binding.id}
  `);
  const fence = fenceResult.rows[0];
  if (fence === undefined) {
    throw new Error("Message-send route requires a binding fence.");
  }
  expect(
    (
      await executeHistoricalFixtureSql(
        input.db,
        buildInsertInboxV2OutboundRouteSql(route, fence)
      )
    ).rows
  ).toHaveLength(1);
  return route;
}

async function seedCrossAccountBinding(input: {
  db: HuleeDatabase;
  creation: InboxV2MessageCreationCommit;
  sourceConnection: Awaited<
    ReturnType<typeof seedExternalCreationAnchors>
  >["sourceConnection"];
  suffix: string;
}) {
  const occurrence = requireSourceOccurrence(input.creation);
  const sourceAccount = {
    ...occurrence.bindingContext.sourceAccount,
    id: inboxV2SourceAccountIdSchema.parse(
      `source_account:db005-${input.suffix}-${runId}`
    )
  };
  const sourceThreadBinding = {
    ...occurrence.bindingContext.sourceThreadBinding,
    id: inboxV2SourceThreadBindingIdSchema.parse(
      `source_thread_binding:db005-${input.suffix}-${runId}`
    )
  };
  const bindingContext = {
    ...occurrence.bindingContext,
    sourceAccount,
    sourceThreadBinding,
    bindingGeneration: inboxV2EntityRevisionSchema.parse("1")
  };
  const bindingEvidence = {
    tenantId,
    kind: "raw_inbound_event" as const,
    id: `raw_inbound_event:db005-binding-${input.suffix}-${runId}`
  };
  const identity = sourceAccountIdentityFixture({
    sourceAccount,
    sourceConnection: input.sourceConnection,
    adapterContract: occurrence.descriptor.adapterContract,
    suffix: input.suffix
  });
  await input.db.transaction(async (transaction) => {
    await transaction.execute(sql`
      insert into source_accounts (
        id, tenant_id, source_connection_id, account_type, display_name
      ) values (
        ${sourceAccount.id}, ${tenantId}, ${input.sourceConnection.id},
        'direct_number', ${`DB005 cross-account ${input.suffix}`}
      )
    `);
    await insertRawInboundEvent(transaction, {
      id: bindingEvidence.id,
      sourceConnectionId: input.sourceConnection.id,
      sourceAccountId: sourceAccount.id,
      idempotencyKey: `db005-binding-${input.suffix}-${runId}`,
      observedAt: fixtureT0
    });
  });
  await seedVerifiedSourceAccountIdentity(input.db, identity, input.suffix);
  const bindingCommit = sourceThreadBindingCreationCommit({
    creation: input.creation,
    sourceConnection: input.sourceConnection,
    sourceAccountIdentity: identity,
    bindingEvidence,
    bindingContext
  });
  const bindingResult = await createSqlInboxV2SourceThreadBindingRepository(
    input.db
  ).resolveOrCreate(bindingCommit);
  expect(bindingResult).toMatchObject({ kind: "created" });
  if (
    bindingResult.kind !== "created" &&
    bindingResult.kind !== "already_exists"
  ) {
    throw new Error(
      `Expected a valid cross-account binding, got ${bindingResult.kind}.`
    );
  }
  return {
    bindingProjection: bindingResult.projection,
    sourceAccountIdentity: identity,
    sourceConnection: input.sourceConnection,
    bindingContext
  };
}

async function seedProviderEchoAssociation(input: {
  db: HuleeDatabase;
  creation: InboxV2MessageCreationCommit;
  context: Awaited<ReturnType<typeof seedExternalCreationAnchors>>;
  suffix: string;
}) {
  const originOccurrence = requireSourceOccurrence(input.creation);
  const externalMessageReference = input.creation.externalMessageReference;
  const externalThreadMapping = requireExternalThreadMapping(input.creation);
  const linkHeadBefore = input.creation.originTransportLinkHead;
  if (externalMessageReference === null || linkHeadBefore === null) {
    throw new Error("Provider echo requires the original transport graph.");
  }
  const rawEcho = fixtureOccurrence({
    origin: "provider_echo",
    direction: "outbound",
    occurrenceId: "source_occurrence:provider-echo-1"
  });
  const echoResolution = namespaceFixture(
    fixtureOccurrenceResolutionCommit(rawEcho),
    input.suffix
  );
  const echoOccurrence = {
    ...echoResolution.after,
    resolution: {
      state: "resolved" as const,
      externalMessageReference: {
        tenantId,
        kind: "external_message_reference" as const,
        id: externalMessageReference.id
      }
    }
  };
  const resolution = inboxV2SourceOccurrenceResolutionCommitSchema.parse({
    ...echoResolution,
    resolver: {
      ...echoResolution.resolver,
      resolutionToken: `resolution:db005-provider-echo-${input.suffix}-${runId}`
    },
    after: echoOccurrence,
    resolvedReference: externalMessageReference
  });
  if (
    echoOccurrence.origin.kind !== "provider_echo" ||
    echoResolution.before.origin.kind !== "provider_echo"
  ) {
    throw new Error("Expected provider-echo occurrence evidence.");
  }
  const echoOrigin = echoOccurrence.origin;
  await input.db.transaction(async (transaction) => {
    await insertRawInboundEvent(transaction, {
      id: echoOrigin.rawInboundEvent.id,
      sourceConnectionId: input.context.sourceConnection.id,
      sourceAccountId: echoOccurrence.bindingContext.sourceAccount.id,
      idempotencyKey: `db005-echo-raw-${input.suffix}-${runId}`,
      observedAt: echoOccurrence.recordedAt
    });
    await transaction.execute(sql`
      insert into normalized_inbound_events (
        id, tenant_id, raw_event_id, source_connection_id,
        source_account_id, source_type, source_name, event_type,
        direction, visibility, payload_version, normalized_payload,
        reply_capability, idempotency_key, processing_status,
        created_at, updated_at
      ) values (
        ${echoOrigin.normalizedInboundEvent.id}, ${tenantId},
        ${echoOrigin.rawInboundEvent.id},
        ${input.context.sourceConnection.id},
        ${echoOccurrence.bindingContext.sourceAccount.id}, 'messenger',
        'synthetic', 'message', 'outbound', 'private', 'v1', '{}'::jsonb,
        '{}'::jsonb, ${`db005-echo-normalized-${input.suffix}-${runId}`},
        'processed', ${echoOccurrence.recordedAt},
        ${echoOccurrence.recordedAt}
      )
    `);
  });
  const materialization =
    inboxV2SourceOccurrenceMaterializationCommitSchema.parse({
      tenantId,
      occurrence: echoResolution.before,
      bindingMaterialization: {
        kind: "existing",
        currentProjection: input.context.bindingProjection,
        creationAuthority: null
      },
      externalThreadMapping,
      sourceAccountIdentity: input.context.sourceAccountIdentity,
      outboundDispatchAttempt: null,
      outboundDispatch: null,
      outboundRoute: null,
      authority: {
        kind: "trusted_service",
        trustedServiceId:
          echoOccurrence.descriptor.adapterContract.loadedByTrustedServiceId,
        authorizationToken: `materialize:db005-echo-${input.suffix}-${runId}`,
        authorizedAt: echoOccurrence.createdAt
      },
      materializedAt: echoOccurrence.createdAt
    });
  expect(
    await createSqlInboxV2SourceOccurrenceRepository(input.db).materialize(
      materialization
    )
  ).toMatchObject({ kind: "materialized" });
  await input.db.transaction(async (transaction) => {
    expect(
      (
        await transaction.execute(
          buildInsertInboxV2SourceOccurrenceResolutionTransitionSql(resolution)
        )
      ).rows
    ).toHaveLength(1);
    expect(
      (
        await transaction.execute(
          buildCompareAndSwapInboxV2SourceOccurrenceResolutionSql(resolution)
        )
      ).rows
    ).toHaveLength(1);
  });

  const link = namespaceFixture(
    fixtureTransportLink(rawEcho, "provider_echo"),
    input.suffix
  );
  return inboxV2MessageTransportAssociationCommitSchema.parse({
    tenantId,
    message: input.creation.message,
    timelineItem: input.creation.timelineAllocation.items[0],
    linkHeadBefore,
    sourceOccurrence: echoOccurrence,
    externalMessageReference,
    externalThreadMapping,
    occurrenceBinding: input.context.bindingProjection.binding,
    messageOriginProof: {
      kind: "source_originated",
      originOccurrence
    },
    link,
    linkHeadAfter: {
      ...linkHeadBefore,
      linkCount: "2",
      latestLink: {
        tenantId,
        kind: "message_transport_occurrence_link",
        id: link.id
      },
      revision: "2",
      updatedAt: echoOccurrence.recordedAt
    },
    committedAt: echoOccurrence.recordedAt
  });
}

async function seedAdditionalProviderSemanticOccurrence(input: {
  db: HuleeDatabase;
  creation: InboxV2MessageCreationCommit;
  context: Awaited<ReturnType<typeof seedExternalCreationAnchors>>;
  resolution: ReturnType<typeof additionalProviderOccurrenceResolution>;
  suffix: string;
}) {
  const occurrence = input.resolution.after;
  const externalThreadMapping = requireExternalThreadMapping(input.creation);
  if (
    occurrence.origin.kind === "provider_response" ||
    occurrence.origin.kind === "provider_echo"
  ) {
    throw new Error("Provider semantic evidence must be event-backed.");
  }
  const eventOrigin = occurrence.origin;
  await input.db.transaction(async (transaction) => {
    await insertRawInboundEvent(transaction, {
      id: eventOrigin.rawInboundEvent.id,
      sourceConnectionId: input.context.sourceConnection.id,
      sourceAccountId: occurrence.bindingContext.sourceAccount.id,
      idempotencyKey: `db005-semantic-raw-${input.suffix}-${runId}`,
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
        ${eventOrigin.rawInboundEvent.id},
        ${input.context.sourceConnection.id},
        ${occurrence.bindingContext.sourceAccount.id}, 'messenger',
        'synthetic', 'reaction', ${occurrence.direction}, 'private', 'v1', '{}'::jsonb,
        '{}'::jsonb,
        ${`db005-semantic-normalized-${input.suffix}-${runId}`},
        'processed', ${occurrence.recordedAt}, ${occurrence.recordedAt}
      )
    `);
  });
  const materialization =
    inboxV2SourceOccurrenceMaterializationCommitSchema.parse({
      tenantId,
      occurrence: input.resolution.before,
      bindingMaterialization: {
        kind: "existing",
        currentProjection: input.context.bindingProjection,
        creationAuthority: null
      },
      externalThreadMapping,
      sourceAccountIdentity: input.context.sourceAccountIdentity,
      outboundDispatchAttempt: null,
      outboundDispatch: null,
      outboundRoute: null,
      authority: {
        kind: "trusted_service",
        trustedServiceId:
          occurrence.descriptor.adapterContract.loadedByTrustedServiceId,
        authorizationToken: `materialize:db005-semantic-${input.suffix}-${runId}`,
        authorizedAt: occurrence.createdAt
      },
      materializedAt: occurrence.createdAt
    });
  expect(
    await createSqlInboxV2SourceOccurrenceRepository(input.db).materialize(
      materialization
    )
  ).toMatchObject({ kind: "materialized" });
  await input.db.transaction(async (transaction) => {
    expect(
      (
        await transaction.execute(
          buildInsertInboxV2SourceOccurrenceResolutionTransitionSql(
            input.resolution
          )
        )
      ).rows
    ).toHaveLength(1);
    expect(
      (
        await transaction.execute(
          buildCompareAndSwapInboxV2SourceOccurrenceResolutionSql(
            input.resolution
          )
        )
      ).rows
    ).toHaveLength(1);
  });
  return occurrence;
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
    realmId: "module:synthetic:db005-account-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic:db005-user-account",
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
      verificationEvidenceToken: `evidence:db005-account-${input.suffix}-${runId}`,
      decidedAt: fixtureT1
    },
    conflict: null
  };
}

async function seedVerifiedSourceAccountIdentity(
  db: HuleeDatabase,
  identity: ReturnType<typeof sourceAccountIdentityFixture>,
  suffix: string
): Promise<void> {
  const declaration = identity.identityDeclaration;
  const adapter = declaration.adapterContract;
  const sourceAccountId = identity.sourceAccount.id;
  const sourceConnectionId = identity.sourceConnection.id;
  const provisionalSubject = `ProviderSession:${suffix}-${runId}`;
  const transitionId = `source_account_identity_transition:db005-promote-${suffix}-${runId}`;
  const aliasId = `source_account_identity_alias:db005-${suffix}-${runId}`;
  const declarationJson = JSON.stringify(declaration);
  const canonical = identity.canonicalIdentity;

  await db.transaction(async (transaction) => {
    await transaction.execute(sql`
      insert into inbox_v2_source_account_provisional_keys (
        tenant_id, source_account_id, source_connection_id,
        declaration_contract_id, declaration_contract_version,
        declaration_surface_id, connector_session_subject,
        provisional_observed_at, created_at
      ) values (
        ${tenantId}, ${sourceAccountId}, ${sourceConnectionId},
        ${adapter.contractId}, ${adapter.contractVersion}, ${adapter.surfaceId},
        ${provisionalSubject}, ${fixtureT0}, ${fixtureT0}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_source_account_identities (
        tenant_id, source_account_id, source_connection_id, state,
        identity_declaration, declaration_contract_id,
        declaration_contract_version, declaration_revision,
        declaration_surface_id, declaration_loaded_by_trusted_service_id,
        declaration_loaded_at, declaration_realm_id,
        declaration_realm_version, declaration_canonicalization_version,
        declaration_object_kind_id, declaration_scope_kind,
        expected_scope_kind, expected_scope_source_connection_id,
        expected_scope_owner_key, provisional_connector_session_subject,
        provisional_observed_at, account_generation, revision,
        created_at, updated_at
      ) values (
        ${tenantId}, ${sourceAccountId}, ${sourceConnectionId}, 'provisional',
        ${declarationJson}::jsonb, ${adapter.contractId},
        ${adapter.contractVersion}, ${BigInt(adapter.declarationRevision)},
        ${adapter.surfaceId}, ${adapter.loadedByTrustedServiceId},
        ${adapter.loadedAt}, ${declaration.realmId}, ${declaration.realmVersion},
        ${declaration.canonicalizationVersion}, ${declaration.objectKindId},
        'source_connection', 'source_connection', ${sourceConnectionId},
        ${sourceConnectionId}, ${provisionalSubject}, ${fixtureT0}, 1, 1,
        ${fixtureT0}, ${fixtureT0}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_source_account_identity_transitions (
        tenant_id, id, source_account_id, provisional_key_digest_sha256,
        provisional_observed_at, intent, from_state, to_state,
        expected_revision, current_revision, resulting_revision,
        expected_account_generation, current_account_generation,
        resulting_account_generation, pinned_declaration_trusted_service_id,
        decision_actor_trusted_service_id, decision_policy_id,
        decision_policy_version, decision_reason_code_id,
        decision_verification_evidence_token, decision_decided_at, occurred_at
      )
      select ${tenantId},
             ${`source_account_identity_transition:db005-create-${suffix}-${runId}`},
             ${sourceAccountId}, provisional_key_digest_sha256,
             provisional_observed_at, 'create_provisional', null,
             'provisional', null, null, 1, null, null, 1,
             ${adapter.loadedByTrustedServiceId},
             ${adapter.loadedByTrustedServiceId},
             'core:provider-account-verification', 'v1',
             'core:account-observed',
             ${`evidence:db005-account-observed-${suffix}-${runId}`},
             ${fixtureT0}, ${fixtureT0}
        from inbox_v2_source_account_provisional_keys
       where tenant_id = ${tenantId}
         and source_account_id = ${sourceAccountId}
    `);
    await transaction.execute(sql`set constraints all immediate`);
    await transaction.execute(sql`set constraints all deferred`);
    await transaction.execute(sql`
      insert into inbox_v2_source_account_identity_transitions (
        tenant_id, id, source_account_id, provisional_key_digest_sha256,
        provisional_observed_at, intent, from_state, to_state,
        expected_revision, current_revision, resulting_revision,
        expected_account_generation, current_account_generation,
        resulting_account_generation, pinned_declaration_trusted_service_id,
        decision_actor_trusted_service_id, decision_policy_id,
        decision_policy_version, decision_reason_code_id,
        decision_verification_evidence_token, decision_decided_at, occurred_at
      )
      select ${tenantId}, ${transitionId}, ${sourceAccountId},
             provisional_key_digest_sha256, provisional_observed_at,
             'promote_verified', 'provisional', 'verified', 1, 1, 2,
             1, 1, 2, ${adapter.loadedByTrustedServiceId},
             ${adapter.loadedByTrustedServiceId},
             ${identity.verifiedBy.policyId}, ${identity.verifiedBy.policyVersion},
             ${identity.verifiedBy.reasonCodeId},
             ${identity.verifiedBy.verificationEvidenceToken},
             ${fixtureT1}, ${fixtureT1}
        from inbox_v2_source_account_provisional_keys
       where tenant_id = ${tenantId}
         and source_account_id = ${sourceAccountId}
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
        canonical_realm_id, canonical_realm_version, canonicalization_version,
        canonical_object_kind_id, canonical_scope_kind,
        canonical_scope_source_connection_id, canonical_scope_owner_key,
        canonical_external_subject,
        verified_decision_actor_trusted_service_id,
        verified_decision_policy_id, verified_decision_policy_version,
        verified_decision_reason_code_id,
        verified_decision_verification_evidence_token,
        verified_decision_decided_at, identity_created_at, verified_at
      ) values (
        ${tenantId}, ${sourceAccountId}, ${sourceConnectionId}, ${transitionId},
        2, 2, 'verified', ${declarationJson}::jsonb,
        ${adapter.contractId}, ${adapter.contractVersion},
        ${BigInt(adapter.declarationRevision)}, ${adapter.surfaceId},
        ${adapter.loadedByTrustedServiceId}, ${adapter.loadedAt},
        ${declaration.realmId}, ${declaration.realmVersion},
        ${declaration.canonicalizationVersion}, ${declaration.objectKindId},
        'source_connection', ${canonical.realm.realmId},
        ${canonical.realm.realmVersion},
        ${canonical.realm.canonicalizationVersion},
        ${canonical.realm.objectKindId}, 'source_connection',
        ${sourceConnectionId}, ${sourceConnectionId},
        ${canonical.canonicalExternalSubject},
        ${adapter.loadedByTrustedServiceId}, ${identity.verifiedBy.policyId},
        ${identity.verifiedBy.policyVersion}, ${identity.verifiedBy.reasonCodeId},
        ${identity.verifiedBy.verificationEvidenceToken}, ${fixtureT1},
        ${fixtureT0}, ${fixtureT1}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_source_account_identity_aliases (
        tenant_id, id, provisional_source_connection_id,
        provisional_connector_session_subject, provisional_observed_at,
        canonical_source_account_id, canonical_realm_id,
        canonical_realm_version, canonicalization_version,
        canonical_object_kind_id, canonical_scope_kind,
        canonical_scope_source_connection_id, canonical_scope_owner_key,
        canonical_external_subject, identity_declaration,
        declaration_contract_id, declaration_contract_version,
        declaration_revision, declaration_surface_id,
        declaration_loaded_by_trusted_service_id, declaration_loaded_at,
        declaration_realm_id, declaration_realm_version,
        declaration_canonicalization_version, declaration_object_kind_id,
        declaration_scope_kind, expected_account_identity_revision,
        expected_account_generation, target_identity_state,
        decision_actor_trusted_service_id, decision_policy_id,
        decision_policy_version, decision_reason_code_id,
        decision_verification_evidence_token, decision_decided_at,
        revision, created_at
      ) values (
        ${tenantId}, ${aliasId}, ${sourceConnectionId}, ${provisionalSubject},
        ${fixtureT0}, ${sourceAccountId}, ${canonical.realm.realmId},
        ${canonical.realm.realmVersion},
        ${canonical.realm.canonicalizationVersion},
        ${canonical.realm.objectKindId}, 'source_connection',
        ${sourceConnectionId}, ${sourceConnectionId},
        ${canonical.canonicalExternalSubject}, ${declarationJson}::jsonb,
        ${adapter.contractId}, ${adapter.contractVersion},
        ${BigInt(adapter.declarationRevision)}, ${adapter.surfaceId},
        ${adapter.loadedByTrustedServiceId}, ${adapter.loadedAt},
        ${declaration.realmId}, ${declaration.realmVersion},
        ${declaration.canonicalizationVersion}, ${declaration.objectKindId},
        'source_connection', 2, 2, 'verified',
        ${adapter.loadedByTrustedServiceId}, ${identity.verifiedBy.policyId},
        ${identity.verifiedBy.policyVersion}, ${identity.verifiedBy.reasonCodeId},
        ${identity.verifiedBy.verificationEvidenceToken}, ${fixtureT1}, 1,
        ${fixtureT1}
      )
    `);
    await transaction.execute(sql`
      update inbox_v2_source_account_identities
         set state = 'verified', expected_scope_kind = null,
             expected_scope_source_connection_id = null,
             expected_scope_owner_key = null,
             provisional_connector_session_subject = null,
             provisional_observed_at = null,
             canonical_realm_id = ${canonical.realm.realmId},
             canonical_realm_version = ${canonical.realm.realmVersion},
             canonicalization_version =
               ${canonical.realm.canonicalizationVersion},
             canonical_object_kind_id = ${canonical.realm.objectKindId},
             canonical_scope_kind = 'source_connection',
             canonical_scope_source_connection_id = ${sourceConnectionId},
             canonical_scope_owner_key = ${sourceConnectionId},
             canonical_external_subject =
               ${canonical.canonicalExternalSubject},
             verified_decision_actor_trusted_service_id =
               ${adapter.loadedByTrustedServiceId},
             verified_decision_policy_id = ${identity.verifiedBy.policyId},
             verified_decision_policy_version =
               ${identity.verifiedBy.policyVersion},
             verified_decision_reason_code_id =
               ${identity.verifiedBy.reasonCodeId},
             verified_decision_verification_evidence_token =
               ${identity.verifiedBy.verificationEvidenceToken},
             verified_decision_decided_at = ${fixtureT1},
             account_generation = 2, revision = 2, updated_at = ${fixtureT1}
       where tenant_id = ${tenantId}
         and source_account_id = ${sourceAccountId}
    `);
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
  bindingContext?: NonNullable<
    InboxV2MessageCreationCommit["sourceOccurrence"]
  >["bindingContext"];
  includeMessageSendCapability?: boolean;
  includeReactionSetCapability?: boolean;
}) {
  const occurrence = requireSourceOccurrence(input.creation);
  const bindingContext = input.bindingContext ?? occurrence.bindingContext;
  const externalThreadMapping = requireExternalThreadMapping(input.creation);
  const adapterContract = occurrence.descriptor.adapterContract;
  const routeDescriptorBase = {
    adapterContract,
    descriptorSchemaId: "module:synthetic:db005-route",
    descriptorVersion: "v1",
    descriptorRevision: "1",
    destinationKindId: "module:synthetic:db005-thread",
    destinationSubject:
      externalThreadMapping.thread.key.canonicalExternalSubject,
    attributes: [] as const
  };
  const binding = {
    tenantId,
    id: bindingContext.sourceThreadBinding.id,
    externalThread: bindingContext.externalThread,
    sourceConnection: input.sourceConnection,
    sourceAccount: bindingContext.sourceAccount,
    accountIdentitySnapshot: {
      status: "verified" as const,
      sourceConnection: input.sourceConnection,
      sourceAccount: bindingContext.sourceAccount,
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
      roleIds: [],
      evidence: [input.bindingEvidence],
      observedAt: fixtureT1
    },
    capabilities: {
      adapterContract,
      revision: "1",
      capturedAt: fixtureT1,
      entries: [
        {
          capabilityId: "module:synthetic:delivery-delivered",
          operationId: "core:message.delivery.delivered",
          contentKindId: null,
          state: "supported" as const,
          referencePortability: "external_thread" as const,
          requiredProviderRoleIds: [],
          validUntil: null,
          diagnostic: null,
          evidence: [input.bindingEvidence]
        },
        {
          capabilityId: "module:synthetic:read-receipt",
          operationId: "core:message.receipt.read",
          contentKindId: null,
          state: "supported" as const,
          referencePortability: "external_thread" as const,
          requiredProviderRoleIds: [],
          validUntil: null,
          diagnostic: null,
          evidence: [input.bindingEvidence]
        },
        ...(input.includeReactionSetCapability
          ? [
              {
                capabilityId: "module:synthetic:reactions",
                operationId: "core:message.reaction.set",
                contentKindId: null,
                state: "supported" as const,
                referencePortability: "external_thread" as const,
                requiredProviderRoleIds: [],
                validUntil: null,
                diagnostic: null,
                evidence: [input.bindingEvidence]
              }
            ]
          : []),
        ...(input.includeMessageSendCapability
          ? [
              {
                capabilityId: "core:message-text-send",
                operationId: "core:message.send",
                contentKindId: "core:text",
                state: "supported" as const,
                referencePortability: "external_thread" as const,
                requiredProviderRoleIds: [],
                validUntil: null,
                diagnostic: null,
                evidence: [input.bindingEvidence]
              }
            ]
          : [])
      ]
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
    externalThreadMapping,
    sourceAccountIdentity: input.sourceAccountIdentity,
    initialProjection: {
      binding,
      currentRemoteAccessEpisode: {
        tenantId,
        id: `source_thread_binding_remote_access_episode:db005-${binding.id.slice(binding.id.indexOf(":") + 1)}`,
        binding: {
          tenantId,
          kind: "source_thread_binding",
          id: binding.id
        },
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

function derivedInboxV2Id(prefix: string, source: string): string {
  return `${prefix}:${createHash("sha256")
    .update(source, "utf8")
    .digest("hex")}`;
}

async function insertRawStaffNoteCreation(
  db: HuleeDatabase,
  commit: ReturnType<typeof staffNoteCreationCommit>,
  streamPosition: ReturnType<typeof position>
) {
  const item = commit.timelineAllocation.items[0];
  if (item === undefined || commit.content.state.kind !== "available") {
    throw new Error("Raw StaffNote creation requires available content.");
  }
  const blocks = commit.content.state.blocks;
  const attributionId = derivedInboxV2Id(
    "action_attribution",
    commit.initialRevision.id
  );
  await db.transaction(async (transaction) => {
    await transaction.execute(
      buildInsertInboxV2ActionAttributionSql({
        tenantId,
        id: attributionId,
        conversationId: commit.staffNote.conversation.id,
        attribution: {
          ...commit.initialRevision.actionAttribution,
          sourceOccurrence: null
        },
        createdAt: commit.initialRevision.recordedAt
      })
    );
    await transaction.execute(
      buildInsertInboxV2TimelineContentSql({
        tenantId,
        ownerKind: "staff_note",
        ownerId: commit.staffNote.id,
        processingPurposeId:
          commit.timelineAllocation.conversationAfter.purposeId,
        retentionAnchorAt: item.occurredAt,
        content: commit.content,
        streamPosition
      })
    );
    await transaction.execute(
      buildInsertInboxV2TimelineContentRevisionSql({
        tenantId,
        content: commit.content,
        transitionKind: "created",
        expectedPreviousRevision: null,
        eventId: null,
        occurredAt: item.occurredAt,
        recordedAt: commit.initialRevision.recordedAt,
        streamPosition
      })
    );
    const payload = buildInsertInboxV2TimelineContentPayloadSql({
      tenantId,
      contentId: commit.content.id,
      contentRevision: commit.content.revision,
      blocks,
      createdAt: commit.content.updatedAt
    });
    if (payload !== null) await transaction.execute(payload);
    await transaction.execute(
      buildInsertInboxV2TimelineItemSql({ item, streamPosition })
    );
    await transaction.execute(sql`
      insert into inbox_v2_staff_notes (
        tenant_id, id, conversation_id, timeline_item_id,
        author_participant_id, creation_attribution_id, content_id,
        content_revision, content_state, revision,
        last_changed_stream_position, created_at, updated_at
      ) values (
        ${tenantId}, ${commit.staffNote.id},
        ${commit.staffNote.conversation.id}, ${commit.staffNote.timelineItem.id},
        ${commit.staffNote.authorParticipant.id}, ${attributionId},
        ${commit.staffNote.content.content.id},
        ${commit.staffNote.content.contentRevision},
        ${commit.staffNote.content.stateKind}, ${commit.staffNote.revision},
        ${streamPosition}, ${commit.staffNote.createdAt},
        ${commit.staffNote.updatedAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_staff_note_revisions (
        tenant_id, id, staff_note_id, timeline_item_id,
        expected_previous_revision, staff_note_revision, change_kind,
        before_content_id, before_content_revision, before_content_state,
        after_content_id, after_content_revision, after_content_state,
        action_attribution_id, occurred_at, recorded_at,
        recorded_stream_position, record_revision
      ) values (
        ${tenantId}, ${commit.initialRevision.id}, ${commit.staffNote.id},
        ${commit.staffNote.timelineItem.id}, null,
        ${commit.initialRevision.staffNoteRevision}, 'created',
        null, null, null, ${commit.staffNote.content.content.id},
        ${commit.staffNote.content.contentRevision},
        ${commit.staffNote.content.stateKind}, ${attributionId},
        ${commit.initialRevision.occurredAt},
        ${commit.initialRevision.recordedAt}, ${streamPosition}, 1
      )
    `);
    const beforeHead = commit.timelineAllocation.conversationBefore.head;
    const afterHead = commit.timelineAllocation.conversationAfter.head;
    await transaction.execute(
      buildAdvanceInboxV2TimelineConversationHeadSql({
        tenantId,
        conversationId: commit.staffNote.conversation.id,
        expectedRevision: beforeHead.revision,
        expectedLatestSequence: beforeHead.latestTimelineSequence,
        latestSequence: afterHead.latestTimelineSequence,
        latestActivityItemId: afterHead.latestActivityItemId,
        latestActivitySequence: afterHead.latestActivityTimelineSequence,
        latestActivityAt: afterHead.latestActivityAt,
        streamPosition,
        changedAt: commit.initialRevision.recordedAt
      })
    );
    await transaction.execute(sql`set constraints all immediate`);
  });
}

async function insertRawStaffNoteEdit(
  db: HuleeDatabase,
  commit: ReturnType<typeof staffNoteEditMutation>,
  streamPosition: ReturnType<typeof position>,
  options: { contentOccurredAt?: string } = {}
) {
  if (commit.contentTransition.after.state.kind !== "available") {
    throw new Error("Raw StaffNote edit requires available content.");
  }
  const blocks = commit.contentTransition.after.state.blocks;
  const afterContent =
    options.contentOccurredAt === undefined
      ? commit.contentTransition.after
      : {
          ...commit.contentTransition.after,
          updatedAt: options.contentOccurredAt
        };
  const attributionId = derivedInboxV2Id(
    "action_attribution",
    commit.revision.id
  );
  await db.transaction(async (transaction) => {
    await transaction.execute(
      buildInsertInboxV2ActionAttributionSql({
        tenantId,
        id: attributionId,
        conversationId: commit.beforeStaffNote.conversation.id,
        attribution: {
          ...commit.revision.actionAttribution,
          sourceOccurrence: null
        },
        createdAt: commit.revision.recordedAt
      })
    );
    await transaction.execute(
      buildAdvanceInboxV2TimelineContentSql({
        before: commit.contentTransition.before,
        after: afterContent,
        streamPosition
      })
    );
    await transaction.execute(
      buildInsertInboxV2TimelineContentRevisionSql({
        tenantId,
        content: afterContent,
        transitionKind: "edit",
        expectedPreviousRevision:
          commit.contentTransition.transition.expectedRevision,
        eventId: commit.contentTransition.transition.event.id,
        occurredAt:
          options.contentOccurredAt ??
          commit.contentTransition.transition.occurredAt,
        recordedAt: commit.revision.recordedAt,
        streamPosition
      })
    );
    const payload = buildInsertInboxV2TimelineContentPayloadSql({
      tenantId,
      contentId: afterContent.id,
      contentRevision: afterContent.revision,
      blocks,
      createdAt: afterContent.updatedAt
    });
    if (payload !== null) await transaction.execute(payload);
    await transaction.execute(sql`
      update inbox_v2_staff_notes
         set content_revision = ${commit.afterStaffNote.content.contentRevision},
             content_state = ${commit.afterStaffNote.content.stateKind},
             revision = ${commit.afterStaffNote.revision},
             last_changed_stream_position = ${streamPosition},
             updated_at = ${commit.afterStaffNote.updatedAt}
       where tenant_id = ${tenantId}
         and id = ${commit.beforeStaffNote.id}
         and revision = ${commit.beforeStaffNote.revision}
    `);
    await transaction.execute(
      buildAdvanceInboxV2TimelineItemSql({
        before: commit.beforeTimelineItem,
        after: commit.afterTimelineItem,
        streamPosition
      })
    );
    await transaction.execute(sql`
      insert into inbox_v2_staff_note_revisions (
        tenant_id, id, staff_note_id, timeline_item_id,
        expected_previous_revision, staff_note_revision, change_kind,
        before_content_id, before_content_revision, before_content_state,
        after_content_id, after_content_revision, after_content_state,
        action_attribution_id, occurred_at, recorded_at,
        recorded_stream_position, record_revision
      ) values (
        ${tenantId}, ${commit.revision.id}, ${commit.beforeStaffNote.id},
        ${commit.beforeTimelineItem.id}, ${commit.revision.expectedPreviousRevision},
        ${commit.revision.staffNoteRevision}, 'edited',
        ${commit.beforeStaffNote.content.content.id},
        ${commit.beforeStaffNote.content.contentRevision},
        ${commit.beforeStaffNote.content.stateKind},
        ${commit.afterStaffNote.content.content.id},
        ${commit.afterStaffNote.content.contentRevision},
        ${commit.afterStaffNote.content.stateKind}, ${attributionId},
        ${commit.revision.occurredAt}, ${commit.revision.recordedAt},
        ${streamPosition}, 1
      )
    `);
    await transaction.execute(sql`set constraints all immediate`);
  });
}

async function attemptRawMessageMutationWithAttribution(
  db: HuleeDatabase,
  commit: ReturnType<typeof providerObservedEditMutation>,
  attribution: ReturnType<
    typeof providerObservedEditMutation
  >["revision"]["actionAttribution"],
  streamPosition: ReturnType<typeof position>
) {
  const attributionId = derivedInboxV2Id(
    "action_attribution",
    commit.revision.id
  );
  const availableBlocks =
    commit.contentTransition?.after.state.kind === "available"
      ? commit.contentTransition.after.state.blocks
      : null;
  await db.transaction(async (transaction) => {
    await transaction.execute(
      buildInsertInboxV2ActionAttributionSql({
        tenantId,
        id: attributionId,
        conversationId: commit.beforeMessage.conversation.id,
        attribution,
        createdAt: commit.revision.recordedAt
      })
    );
    if (commit.contentTransition !== null) {
      const transition = commit.contentTransition;
      await transaction.execute(
        buildInsertInboxV2TimelineContentRevisionSql({
          tenantId,
          content: transition.after,
          transitionKind: transition.transition.kind,
          expectedPreviousRevision: transition.transition.expectedRevision,
          eventId: transition.transition.event.id,
          occurredAt: transition.transition.occurredAt,
          recordedAt: commit.revision.recordedAt,
          streamPosition
        })
      );
      if (availableBlocks !== null) {
        const payload = buildInsertInboxV2TimelineContentPayloadSql({
          tenantId,
          contentId: transition.after.id,
          contentRevision: transition.after.revision,
          blocks: availableBlocks,
          createdAt: transition.after.updatedAt
        });
        if (payload !== null) await transaction.execute(payload);
        const contacts = buildInsertInboxV2TimelineContentContactValuesSql({
          tenantId,
          contentId: transition.after.id,
          contentRevision: transition.after.revision,
          blocks: availableBlocks
        });
        if (contacts !== null) await transaction.execute(contacts);
      }
      await transaction.execute(
        buildAdvanceInboxV2TimelineContentSql({
          before: transition.before,
          after: transition.after,
          streamPosition
        })
      );
    }
    await transaction.execute(
      buildAdvanceInboxV2MessageSql({
        before: commit.beforeMessage,
        after: commit.afterMessage,
        streamPosition
      })
    );
    await transaction.execute(
      buildAdvanceInboxV2TimelineItemSql({
        before: commit.beforeTimelineItem,
        after: commit.afterTimelineItem,
        streamPosition
      })
    );
    await transaction.execute(
      buildInsertInboxV2MessageRevisionSql({
        revision: commit.revision,
        actionAttributionId: attributionId,
        streamPosition
      })
    );
    await transaction.execute(sql`set constraints all immediate`);
  });
}

async function insertRawMessageCreationGraph(
  executor: RawSqlExecutor,
  commit: InboxV2MessageCreationCommit,
  streamPosition: ReturnType<typeof position>,
  options: {
    attribution?: InboxV2MessageCreationCommit["initialRevision"]["actionAttribution"];
    dispatch?: InboxV2MessageCreationCommit["outboundDispatch"];
    includeDispatch?: boolean;
    message?: InboxV2MessageCreationCommit["message"];
  } = {}
): Promise<string> {
  const timelineItem = commit.timelineAllocation.items[0];
  if (timelineItem === undefined) {
    throw new Error("Raw Message creation requires one TimelineItem.");
  }
  const message = options.message ?? commit.message;
  const attribution =
    options.attribution ?? commit.initialRevision.actionAttribution;
  const attributionId = derivedInboxV2Id(
    "action_attribution",
    commit.initialRevision.id
  );
  await executor.execute(
    buildInsertInboxV2ActionAttributionSql({
      tenantId: commit.tenantId,
      id: attributionId,
      conversationId: message.conversation.id,
      attribution,
      createdAt: commit.initialRevision.recordedAt
    })
  );
  await executor.execute(
    buildInsertInboxV2TimelineContentSql({
      tenantId: commit.tenantId,
      ownerKind: "message",
      ownerId: message.id,
      processingPurposeId:
        commit.timelineAllocation.conversationAfter.purposeId,
      retentionAnchorAt: timelineItem.occurredAt,
      content: commit.content,
      streamPosition
    })
  );
  await executor.execute(
    buildInsertInboxV2TimelineContentRevisionSql({
      tenantId: commit.tenantId,
      content: commit.content,
      transitionKind: "created",
      expectedPreviousRevision: null,
      eventId: null,
      occurredAt: timelineItem.occurredAt,
      recordedAt: commit.timelineAllocation.committedAt,
      streamPosition
    })
  );
  if (commit.content.state.kind === "available") {
    const payload = buildInsertInboxV2TimelineContentPayloadSql({
      tenantId: commit.tenantId,
      contentId: commit.content.id,
      contentRevision: commit.content.revision,
      blocks: commit.content.state.blocks,
      createdAt: commit.content.updatedAt
    });
    if (payload !== null) await executor.execute(payload);
    const contacts = buildInsertInboxV2TimelineContentContactValuesSql({
      tenantId: commit.tenantId,
      contentId: commit.content.id,
      contentRevision: commit.content.revision,
      blocks: commit.content.state.blocks
    });
    if (contacts !== null) await executor.execute(contacts);
  }
  await executor.execute(
    buildInsertInboxV2TimelineItemSql({ item: timelineItem, streamPosition })
  );
  await executor.execute(
    buildInsertInboxV2MessageSql({
      message,
      creationAttributionId: attributionId,
      streamPosition
    })
  );
  const dispatch = options.dispatch ?? commit.outboundDispatch;
  if (options.includeDispatch !== false && dispatch !== null) {
    await executor.execute(
      buildInsertInboxV2OutboundDispatchSql({
        dispatch,
        conversationId: message.conversation.id,
        timelineItemId: timelineItem.id
      })
    );
  }
  if (commit.routeConsumption !== null) {
    const consumption = commit.routeConsumption;
    await executor.execute(
      buildInsertInboxV2OutboundRouteConsumptionSql({
        tenantId: commit.tenantId,
        consumerKind: "message_creation",
        consumerId: message.id,
        messageId: message.id,
        outboundRouteId: consumption.outboundRoute.id,
        mutationToken: consumption.mutationToken,
        idempotencyToken: consumption.idempotencyToken,
        correlationToken: consumption.correlationToken,
        consumedByTrustedServiceId: consumption.consumedByTrustedServiceId,
        consumedAt: consumption.consumedAt,
        revision: inboxV2EntityRevisionSchema.parse(consumption.revision),
        commitDigestSha256:
          computeInboxV2TimelineMessageCommitDigest(consumption)
      })
    );
  }
  await executor.execute(
    buildInsertInboxV2MessageRevisionSql({
      revision: commit.initialRevision,
      actionAttributionId: attributionId,
      streamPosition
    })
  );
  await executor.execute(buildInsertInboxV2MessageReferenceContextSql(message));
  for (const statement of [
    buildInsertInboxV2MessageReferenceCanonicalTargetsSql(message),
    buildInsertInboxV2MessageReferenceExternalTargetsSql(message)
  ]) {
    if (statement !== null) await executor.execute(statement);
  }
  const beforeHead = commit.timelineAllocation.conversationBefore.head;
  const afterHead = commit.timelineAllocation.conversationAfter.head;
  await executor.execute(
    buildAdvanceInboxV2TimelineConversationHeadSql({
      tenantId: commit.tenantId,
      conversationId: message.conversation.id,
      expectedRevision: beforeHead.revision,
      expectedLatestSequence: beforeHead.latestTimelineSequence,
      latestSequence: afterHead.latestTimelineSequence,
      latestActivityItemId: afterHead.latestActivityItemId,
      latestActivitySequence: afterHead.latestActivityTimelineSequence,
      latestActivityAt: afterHead.latestActivityAt,
      streamPosition,
      changedAt: commit.timelineAllocation.committedAt
    })
  );
  return attributionId;
}

function requireSourceOccurrence(creation: InboxV2MessageCreationCommit) {
  if (creation.sourceOccurrence === null) {
    throw new Error("Expected a source-originated DB005 Message fixture.");
  }
  return creation.sourceOccurrence;
}

function requireExternalThreadMapping(creation: InboxV2MessageCreationCommit) {
  if (creation.externalThreadMapping === null) {
    throw new Error("Expected an external DB005 Message fixture.");
  }
  return creation.externalThreadMapping;
}

function deliveryFactCommit(
  suffix: string,
  creation: InboxV2MessageCreationCommit,
  commitToken: string
): InboxV2MessageTransportFactCommit {
  const beforeMessage = creation.message;
  const beforeTimelineItem = creation.timelineAllocation.items[0];
  if (beforeTimelineItem === undefined) {
    throw new Error("Expected a delivery TimelineItem.");
  }
  const occurrence = fixtureOccurrence({
    origin: "provider_echo",
    direction: "outbound",
    recordedAt: fixtureT3
  });
  const externalReference = fixtureExternalReference(occurrence);
  const raw = {
    tenantId: "tenant:tenant-1",
    beforeMessage: fixtureHuleeCreationCommit().message,
    beforeTimelineItem: fixtureTimelineItem("external"),
    fact: {
      kind: "delivery" as const,
      observation: {
        tenantId: "tenant:tenant-1",
        id: "message_delivery_observation:delivered-1",
        message: fixtureMessageReference,
        fact: "delivered" as const,
        scope: {
          kind: "external_reference" as const,
          externalMessageReference: fixtureExternalMessageReference,
          sourceOccurrence: fixtureSourceOccurrenceReference
        },
        sourceAccount: fixtureSourceAccountReference,
        sourceThreadBinding: fixtureBindingReference,
        bindingGeneration: "1",
        adapterContract: fixtureAdapterContract,
        capabilityId: "module:synthetic:delivery-delivered",
        capabilityRevision: "1",
        evidence: {
          kind: "provider_event" as const,
          normalizedInboundEvent: fixtureReference(
            "normalized_inbound_event",
            "normalized_inbound_event:provider_echo-1"
          ),
          externalMessageReference: fixtureExternalMessageReference,
          sourceOccurrence: fixtureSourceOccurrenceReference
        },
        semanticProof: fixtureProviderSemanticProof({
          semanticId: "core:message.delivery.delivered",
          capabilityId: "module:synthetic:delivery-delivered",
          normalizedInboundEvent: fixtureReference(
            "normalized_inbound_event",
            "normalized_inbound_event:provider_echo-1"
          ),
          occurredAt: fixtureT2,
          recordedAt: fixtureT3
        }),
        evidenceKindId: "module:synthetic:provider-event",
        evidenceDigestSha256: "d".repeat(64),
        failureReasonId: null,
        observedAt: fixtureT2,
        recordedAt: fixtureT3,
        revision: "1"
      }
    },
    transportEvidence: {
      kind: "external_reference" as const,
      externalMessageReference: externalReference,
      sourceOccurrence: occurrence,
      externalThreadMapping: fixtureExternalThreadMapping()
    },
    commitToken: "transport:delivery:fixture",
    committedAt: fixtureT3
  };
  const namespaced = namespaceFixture(raw, suffix);
  const evidence = requireExternalFactEvidence(creation);
  const observation = namespaced.fact.observation;
  return inboxV2MessageTransportFactCommitSchema.parse({
    ...namespaced,
    beforeMessage,
    beforeTimelineItem,
    fact: {
      kind: "delivery",
      observation: {
        ...observation,
        message: {
          tenantId,
          kind: "message",
          id: beforeMessage.id
        },
        scope: {
          kind: "external_reference",
          externalMessageReference: {
            tenantId,
            kind: "external_message_reference",
            id: evidence.externalMessageReference.id
          },
          sourceOccurrence: {
            tenantId,
            kind: "source_occurrence",
            id: evidence.sourceOccurrence.id
          }
        },
        sourceAccount: evidence.sourceOccurrence.bindingContext.sourceAccount,
        sourceThreadBinding:
          evidence.sourceOccurrence.bindingContext.sourceThreadBinding,
        bindingGeneration:
          evidence.sourceOccurrence.bindingContext.bindingGeneration,
        adapterContract: evidence.sourceOccurrence.descriptor.adapterContract,
        evidence: {
          kind: "provider_event",
          normalizedInboundEvent: evidence.normalizedInboundEvent,
          externalMessageReference: {
            tenantId,
            kind: "external_message_reference",
            id: evidence.externalMessageReference.id
          },
          sourceOccurrence: {
            tenantId,
            kind: "source_occurrence",
            id: evidence.sourceOccurrence.id
          }
        },
        semanticProof: {
          ...observation.semanticProof,
          normalizedInboundEvent: evidence.normalizedInboundEvent,
          externalMessageReference: {
            tenantId,
            kind: "external_message_reference",
            id: evidence.externalMessageReference.id
          },
          sourceOccurrence: {
            tenantId,
            kind: "source_occurrence",
            id: evidence.sourceOccurrence.id
          },
          sourceAccount: evidence.sourceOccurrence.bindingContext.sourceAccount,
          sourceThreadBinding:
            evidence.sourceOccurrence.bindingContext.sourceThreadBinding,
          bindingGeneration:
            evidence.sourceOccurrence.bindingContext.bindingGeneration,
          adapterContract: evidence.sourceOccurrence.descriptor.adapterContract
        }
      }
    },
    transportEvidence: {
      kind: "external_reference",
      externalMessageReference: evidence.externalMessageReference,
      sourceOccurrence: evidence.sourceOccurrence,
      externalThreadMapping: evidence.externalThreadMapping
    },
    commitToken
  });
}

function receiptFactCommit(
  suffix: string,
  creation: InboxV2MessageCreationCommit,
  commitToken: string
): InboxV2MessageTransportFactCommit {
  const beforeMessage = creation.message;
  const beforeTimelineItem = creation.timelineAllocation.items[0];
  if (beforeTimelineItem === undefined) {
    throw new Error("Expected a receipt TimelineItem.");
  }
  const occurrence = fixtureOccurrence({ recordedAt: fixtureT3 });
  const externalReference = fixtureExternalReference(occurrence);
  const raw = {
    tenantId: "tenant:tenant-1",
    beforeMessage: fixtureHuleeCreationCommit().message,
    beforeTimelineItem: fixtureTimelineItem("external"),
    fact: {
      kind: "receipt" as const,
      observation: {
        tenantId: "tenant:tenant-1",
        id: "provider_receipt_observation:exact-message-known",
        fact: "read" as const,
        target: {
          kind: "exact_message" as const,
          message: fixtureMessageReference,
          externalMessageReference: fixtureExternalMessageReference,
          sourceOccurrence: fixtureSourceOccurrenceReference
        },
        reader: {
          kind: "source_external_identity" as const,
          sourceExternalIdentity: fixtureSourceIdentityReference
        },
        sourceAccount: fixtureSourceAccountReference,
        sourceThreadBinding: fixtureBindingReference,
        bindingGeneration: "1",
        adapterContract: fixtureAdapterContract,
        capabilityId: "module:synthetic:read-receipt",
        capabilityRevision: "1",
        evidenceEvent: fixtureReference(
          "normalized_inbound_event",
          "normalized_inbound_event:webhook-1"
        ),
        semanticProof: fixtureProviderSemanticProof({
          semanticId: "core:message.receipt.read",
          capabilityId: "module:synthetic:read-receipt",
          normalizedInboundEvent: fixtureReference(
            "normalized_inbound_event",
            "normalized_inbound_event:webhook-1"
          ),
          externalMessageReference: fixtureExternalMessageReference,
          sourceOccurrence: fixtureSourceOccurrenceReference,
          actor: fixtureSourceIdentityReference,
          occurredAt: fixtureT2,
          recordedAt: fixtureT3
        }),
        evidenceKindId: "module:synthetic:provider-event",
        evidenceDigestSha256: "e".repeat(64),
        observedAt: fixtureT2,
        recordedAt: fixtureT3,
        revision: "1"
      }
    },
    transportEvidence: {
      kind: "external_reference" as const,
      externalMessageReference: externalReference,
      sourceOccurrence: occurrence,
      externalThreadMapping: fixtureExternalThreadMapping()
    },
    commitToken: "transport:receipt:fixture",
    committedAt: fixtureT3
  };
  const namespaced = namespaceFixture(raw, suffix);
  const evidence = requireExternalFactEvidence(creation);
  const providerActor = evidence.sourceOccurrence.providerActor;
  if (providerActor?.kind !== "source_external_identity") {
    throw new Error("Receipt fixture requires one exact provider reader.");
  }
  const observation = namespaced.fact.observation;
  return inboxV2MessageTransportFactCommitSchema.parse({
    ...namespaced,
    beforeMessage,
    beforeTimelineItem,
    fact: {
      kind: "receipt",
      observation: {
        ...observation,
        target: {
          kind: "exact_message",
          message: { tenantId, kind: "message", id: beforeMessage.id },
          externalMessageReference: {
            tenantId,
            kind: "external_message_reference",
            id: evidence.externalMessageReference.id
          },
          sourceOccurrence: {
            tenantId,
            kind: "source_occurrence",
            id: evidence.sourceOccurrence.id
          }
        },
        reader: providerActor,
        sourceAccount: evidence.sourceOccurrence.bindingContext.sourceAccount,
        sourceThreadBinding:
          evidence.sourceOccurrence.bindingContext.sourceThreadBinding,
        bindingGeneration:
          evidence.sourceOccurrence.bindingContext.bindingGeneration,
        adapterContract: evidence.sourceOccurrence.descriptor.adapterContract,
        evidenceEvent: evidence.normalizedInboundEvent,
        semanticProof: {
          ...observation.semanticProof,
          normalizedInboundEvent: evidence.normalizedInboundEvent,
          externalMessageReference: {
            tenantId,
            kind: "external_message_reference",
            id: evidence.externalMessageReference.id
          },
          sourceOccurrence: {
            tenantId,
            kind: "source_occurrence",
            id: evidence.sourceOccurrence.id
          },
          sourceAccount: evidence.sourceOccurrence.bindingContext.sourceAccount,
          sourceThreadBinding:
            evidence.sourceOccurrence.bindingContext.sourceThreadBinding,
          bindingGeneration:
            evidence.sourceOccurrence.bindingContext.bindingGeneration,
          adapterContract: evidence.sourceOccurrence.descriptor.adapterContract,
          actor: providerActor.sourceExternalIdentity
        }
      }
    },
    transportEvidence: {
      kind: "external_reference",
      externalMessageReference: evidence.externalMessageReference,
      sourceOccurrence: evidence.sourceOccurrence,
      externalThreadMapping: evidence.externalThreadMapping
    },
    commitToken
  });
}

function requireExternalFactEvidence(creation: InboxV2MessageCreationCommit) {
  const sourceOccurrence = requireSourceOccurrence(creation);
  const externalMessageReference = creation.externalMessageReference;
  const externalThreadMapping = requireExternalThreadMapping(creation);
  if (externalMessageReference === null) {
    throw new Error("Expected one external Message reference.");
  }
  if (
    sourceOccurrence.origin.kind === "provider_response" ||
    sourceOccurrence.origin.kind === "provider_echo"
  ) {
    throw new Error("Expected event-backed external Message evidence.");
  }
  return {
    kind: "external_reference" as const,
    externalMessageReference,
    sourceOccurrence,
    externalThreadMapping,
    normalizedInboundEvent: sourceOccurrence.origin.normalizedInboundEvent
  };
}

async function createSourceMessage(
  repository: ReturnType<typeof createSqlInboxV2TimelineMessageRepository>,
  creation: InboxV2MessageCreationCommit,
  streamPosition: string
) {
  const resolution = creation.sourceResolutionCommit;
  const externalMessageReference = creation.externalMessageReference;
  if (resolution === null || externalMessageReference === null) {
    throw new Error("Source creation requires its resolution graph.");
  }
  return repository.withMessageCreation(
    { commit: creation, streamPosition: position(streamPosition) },
    async ({ executor }) => {
      const referenceInsert = await executor.execute(
        buildInsertInboxV2ExternalMessageReferenceSql(externalMessageReference)
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

async function executeHistoricalFixtureSql(db: HuleeDatabase, statement: SQL) {
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

async function captureLegacyMessageCreationError(
  db: HuleeDatabase,
  work: Parameters<InboxV2TimelineMessageTransactionExecutor["transaction"]>[0]
) {
  await db.transaction(async (transaction) => {
    await transaction.execute(sql`
      alter table public.inbox_v2_messages
        disable trigger inbox_v2_atomic_message_creation_constraint
    `);
    await transaction.execute(sql`
      alter table public.inbox_v2_outbound_dispatches
        disable trigger inbox_v2_atomic_outbound_dispatch_constraint
    `);
  });
  try {
    return await capturePostgresError(
      db.transaction((transaction) =>
        work(transaction as unknown as RawSqlExecutor)
      )
    );
  } finally {
    await db.transaction(async (transaction) => {
      await transaction.execute(sql`
        alter table public.inbox_v2_outbound_dispatches
          enable trigger inbox_v2_atomic_outbound_dispatch_constraint
      `);
      await transaction.execute(sql`
        alter table public.inbox_v2_messages
          enable trigger inbox_v2_atomic_message_creation_constraint
      `);
    });
  }
}

async function loadProviderSemanticOrderingHeads(
  db: HuleeDatabase,
  commit: ReturnType<typeof requireProviderSemanticOrderingCommit>
) {
  const result = await db.execute<{
    proof_token: string;
    position: string;
    revision: string;
    last_changed_stream_position: string;
  }>(sql`
    select proof_token, position, revision::text as revision,
           last_changed_stream_position::text as last_changed_stream_position
      from inbox_v2_provider_semantic_ordering_heads
     where tenant_id = ${commit.tenantId}
       and external_message_reference_id =
         ${commit.after.externalMessageReference.id}
       and semantic_family_id = ${commit.semanticFamilyId}
  `);
  return result.rows;
}

async function loadProviderSemanticOrderingHeadProvenance(
  db: HuleeDatabase,
  commit: ReturnType<typeof requireProviderSemanticOrderingCommit>
) {
  const result = await db.execute<{
    source_account_id: string;
    source_thread_binding_id: string;
    binding_generation: string;
    normalized_inbound_event_id: string;
    position: string;
    revision: string;
    last_changed_stream_position: string;
  }>(sql`
    select source_account_id, source_thread_binding_id,
           binding_generation::text as binding_generation,
           normalized_inbound_event_id, position,
           revision::text as revision,
           last_changed_stream_position::text as last_changed_stream_position
      from inbox_v2_provider_semantic_ordering_heads
     where tenant_id = ${commit.tenantId}
       and external_message_reference_id =
         ${commit.after.externalMessageReference.id}
       and semantic_family_id = ${commit.semanticFamilyId}
  `);
  return result.rows;
}

async function loadCrossAccountProviderThreadTopology(
  db: HuleeDatabase,
  input: {
    externalMessageReferenceId: string;
    bindingIds: readonly [string, string];
  }
) {
  const result = await db.execute<{
    binding_count: string;
    source_account_count: string;
    external_thread_count: string;
    external_message_scope_kind: string | null;
  }>(sql`
    select
      count(*)::text as binding_count,
      count(distinct binding_row.source_account_id)::text
        as source_account_count,
      count(distinct binding_row.external_thread_id)::text
        as external_thread_count,
      (
        select reference_row.scope_kind::text
          from inbox_v2_external_message_references reference_row
         where reference_row.tenant_id = ${tenantId}
           and reference_row.id = ${input.externalMessageReferenceId}
      ) as external_message_scope_kind
      from inbox_v2_source_thread_bindings binding_row
     where binding_row.tenant_id = ${tenantId}
       and binding_row.id in (${input.bindingIds[0]}, ${input.bindingIds[1]})
  `);
  return result.rows[0];
}

async function loadProviderLifecycleOperationCount(
  db: HuleeDatabase,
  operationIds: readonly [string, string]
): Promise<number> {
  const result = await db.execute<{ operation_count: string }>(sql`
    select count(*)::text as operation_count
      from inbox_v2_message_provider_lifecycle_operations
     where tenant_id = ${tenantId}
       and id in (${operationIds[0]}, ${operationIds[1]})
  `);
  return Number(result.rows[0]?.operation_count ?? "0");
}

async function loadProviderLifecycleOperationCountForMessage(
  db: HuleeDatabase,
  messageId: string
): Promise<number> {
  const result = await db.execute<{ operation_count: string }>(sql`
    select count(*)::text as operation_count
      from inbox_v2_message_provider_lifecycle_operations
     where tenant_id = ${tenantId}
       and message_id = ${messageId}
  `);
  return Number(result.rows[0]?.operation_count ?? "0");
}

async function loadProviderReactionPersistenceState(
  db: HuleeDatabase,
  messageId: string
) {
  const result = await db.execute<{
    reaction_count: string;
    reaction_revision: string | null;
    slot_count: string;
    slot_revision: string | null;
    transition_count: string;
    observation_count: string;
  }>(sql`
    select
      (
        select count(*)::text
          from inbox_v2_message_reactions reaction_row
         where reaction_row.tenant_id = ${tenantId}
           and reaction_row.message_id = ${messageId}
      ) as reaction_count,
      (
        select max(reaction_row.revision)::text
          from inbox_v2_message_reactions reaction_row
         where reaction_row.tenant_id = ${tenantId}
           and reaction_row.message_id = ${messageId}
      ) as reaction_revision,
      (
        select count(*)::text
          from inbox_v2_message_reaction_slot_heads slot_row
         where slot_row.tenant_id = ${tenantId}
           and slot_row.message_id = ${messageId}
      ) as slot_count,
      (
        select max(slot_row.revision)::text
          from inbox_v2_message_reaction_slot_heads slot_row
         where slot_row.tenant_id = ${tenantId}
           and slot_row.message_id = ${messageId}
      ) as slot_revision,
      (
        select count(*)::text
          from inbox_v2_message_reaction_transitions transition_row
          join inbox_v2_message_reactions reaction_row
            on reaction_row.tenant_id = transition_row.tenant_id
           and reaction_row.id = transition_row.reaction_id
         where reaction_row.tenant_id = ${tenantId}
           and reaction_row.message_id = ${messageId}
      ) as transition_count,
      (
        select count(*)::text
          from inbox_v2_message_provider_reaction_observations observation_row
          join inbox_v2_message_reaction_transitions transition_row
            on transition_row.tenant_id = observation_row.tenant_id
           and transition_row.id = observation_row.transition_id
          join inbox_v2_message_reactions reaction_row
            on reaction_row.tenant_id = transition_row.tenant_id
           and reaction_row.id = transition_row.reaction_id
         where reaction_row.tenant_id = ${tenantId}
           and reaction_row.message_id = ${messageId}
      ) as observation_count
  `);
  return result.rows[0];
}

async function loadActionAttributionCount(
  db: HuleeDatabase,
  attributionId: string
): Promise<number> {
  const result = await db.execute<{ attribution_count: string }>(sql`
    select count(*)::text as attribution_count
      from inbox_v2_action_attributions
     where tenant_id = ${tenantId}
       and id = ${attributionId}
  `);
  return Number(result.rows[0]?.attribution_count ?? "0");
}

async function loadHuleeExternalCreationTransportState(
  db: HuleeDatabase,
  messageId: string
) {
  const result = await db.execute<{
    dispatch_count: string;
    dispatch_state: string | null;
    dispatch_revision: string | null;
    dispatch_message_id: string | null;
    dispatch_route_id: string | null;
    route_consumption_count: string;
  }>(sql`
    select
      count(dispatch_row.id)::text as dispatch_count,
      max(dispatch_row.state::text) as dispatch_state,
      max(dispatch_row.revision)::text as dispatch_revision,
      max(dispatch_row.message_id) as dispatch_message_id,
      max(dispatch_row.route_id) as dispatch_route_id,
      (
        select count(*)::text
          from inbox_v2_outbound_route_consumptions consumption_row
         where consumption_row.tenant_id = ${tenantId}
           and consumption_row.consumer_kind = 'message_creation'
           and consumption_row.message_id = ${messageId}
      ) as route_consumption_count
      from inbox_v2_outbound_dispatches dispatch_row
     where dispatch_row.tenant_id = ${tenantId}
       and dispatch_row.message_id = ${messageId}
  `);
  return result.rows[0];
}

async function loadProviderReactionEvidence(
  db: HuleeDatabase,
  messageId: string
) {
  const result = await db.execute<{
    ordering_position: string;
    normalized_inbound_event_id: string;
    source_occurrence_id: string;
  }>(sql`
    select observation_row.ordering_position,
           observation_row.normalized_inbound_event_id,
           observation_row.source_occurrence_id
      from inbox_v2_message_provider_reaction_observations observation_row
      join inbox_v2_message_reaction_transitions transition_row
        on transition_row.tenant_id = observation_row.tenant_id
       and transition_row.id = observation_row.transition_id
      join inbox_v2_message_reactions reaction_row
        on reaction_row.tenant_id = transition_row.tenant_id
       and reaction_row.id = transition_row.reaction_id
     where reaction_row.tenant_id = ${tenantId}
       and reaction_row.message_id = ${messageId}
     order by observation_row.ordering_position::bigint
  `);
  return result.rows;
}

async function loadProviderResultReactionState(
  db: HuleeDatabase,
  reactionId: string
) {
  const result = await db.execute<{
    reaction_state: string;
    reaction_outcome: string | null;
    reaction_revision: string;
    reaction_stream_position: string;
    slot_state: string;
    slot_revision: string;
    transition_count: string;
    provider_result_count: string;
    route_consumption_count: string;
  }>(sql`
    select reaction_row.state_kind::text as reaction_state,
           reaction_row.external_outcome as reaction_outcome,
           reaction_row.revision::text as reaction_revision,
           reaction_row.last_changed_stream_position::text
             as reaction_stream_position,
           slot_row.state_kind::text as slot_state,
           slot_row.revision::text as slot_revision,
           (
             select count(*)::text
               from inbox_v2_message_reaction_transitions transition_row
              where transition_row.tenant_id = reaction_row.tenant_id
                and transition_row.reaction_id = reaction_row.id
           ) as transition_count,
           (
             select count(*)::text
               from inbox_v2_message_reaction_transitions transition_row
              where transition_row.tenant_id = reaction_row.tenant_id
                and transition_row.reaction_id = reaction_row.id
                and transition_row.mode = 'provider_result'
           ) as provider_result_count,
           (
             select count(*)::text
               from inbox_v2_outbound_route_consumptions consumption_row
              where consumption_row.tenant_id = reaction_row.tenant_id
                and consumption_row.consumer_kind = 'reaction'
                and consumption_row.message_id = reaction_row.message_id
           ) as route_consumption_count
      from inbox_v2_message_reactions reaction_row
      join inbox_v2_message_reaction_slot_heads slot_row
        on slot_row.tenant_id = reaction_row.tenant_id
       and slot_row.message_id = reaction_row.message_id
       and slot_row.semantic_slot_key = reaction_row.semantic_slot_key
       and slot_row.reaction_id = reaction_row.id
     where reaction_row.tenant_id = ${tenantId}
       and reaction_row.id = ${reactionId}
  `);
  return result.rows[0];
}

async function loadProviderLifecycleReplayAuditState(
  db: HuleeDatabase,
  messageId: string,
  operationId: string
) {
  const result = await db.execute<{
    operation_count: string;
    operation_revision: string | null;
    created_stream_position: string | null;
    last_changed_stream_position: string | null;
    transition_count: string;
    message_revision_count: string;
  }>(sql`
    select
      (
        select count(*)::text
          from inbox_v2_message_provider_lifecycle_operations operation_row
         where operation_row.tenant_id = ${tenantId}
           and operation_row.id = ${operationId}
           and operation_row.message_id = ${messageId}
      ) as operation_count,
      (
        select operation_row.revision::text
          from inbox_v2_message_provider_lifecycle_operations operation_row
         where operation_row.tenant_id = ${tenantId}
           and operation_row.id = ${operationId}
      ) as operation_revision,
      (
        select operation_row.created_stream_position::text
          from inbox_v2_message_provider_lifecycle_operations operation_row
         where operation_row.tenant_id = ${tenantId}
           and operation_row.id = ${operationId}
      ) as created_stream_position,
      (
        select operation_row.last_changed_stream_position::text
          from inbox_v2_message_provider_lifecycle_operations operation_row
         where operation_row.tenant_id = ${tenantId}
           and operation_row.id = ${operationId}
      ) as last_changed_stream_position,
      (
        select count(*)::text
          from inbox_v2_message_provider_lifecycle_transitions transition_row
         where transition_row.tenant_id = ${tenantId}
           and transition_row.operation_id = ${operationId}
      ) as transition_count,
      (
        select count(*)::text
          from inbox_v2_message_revisions revision_row
         where revision_row.tenant_id = ${tenantId}
           and revision_row.message_id = ${messageId}
      ) as message_revision_count
  `);
  return result.rows[0];
}

async function capturePostgresError(
  promise: Promise<unknown>
): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected PostgreSQL operation to fail.");
}

function postgresSqlState(error: unknown): string | null {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== "object" || current === null || seen.has(current)) {
      return null;
    }
    seen.add(current);
    const code = Reflect.get(current, "code");
    if (typeof code === "string") return code;
    current = Reflect.get(current, "cause");
  }
  return null;
}

function postgresErrorText(error: unknown): string {
  let current = error;
  const messages: string[] = [];
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== "object" || current === null || seen.has(current)) {
      break;
    }
    seen.add(current);
    const message = Reflect.get(current, "message");
    if (typeof message === "string") messages.push(message);
    current = Reflect.get(current, "cause");
  }
  return messages.join(" ");
}

async function loadLifecycleRowCounts(
  db: HuleeDatabase,
  messageId: string,
  contentId: string
) {
  const result = await db.execute<{
    attribution_count: string;
    contact_count: string;
    content_revision_count: string;
    message_revision_count: string;
    payload_count: string;
  }>(sql`
    select
      (
        select count(*)::text
          from inbox_v2_action_attributions
         where tenant_id = ${tenantId}
      ) as attribution_count,
      (
        select count(*)::text
          from inbox_v2_timeline_content_contact_values
         where tenant_id = ${tenantId} and content_id = ${contentId}
      ) as contact_count,
      (
        select count(*)::text
          from inbox_v2_timeline_content_revisions
         where tenant_id = ${tenantId} and content_id = ${contentId}
      ) as content_revision_count,
      (
        select count(*)::text
          from inbox_v2_message_revisions
         where tenant_id = ${tenantId} and message_id = ${messageId}
      ) as message_revision_count,
      (
        select count(*)::text
          from inbox_v2_timeline_content_payloads
         where tenant_id = ${tenantId} and content_id = ${contentId}
      ) as payload_count
  `);
  return result.rows[0];
}

function collectJsonKeys(value: unknown): string[] {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectJsonKeys);
  return Object.entries(value).flatMap(([key, item]) => [
    key,
    ...collectJsonKeys(item)
  ]);
}

function createBarrierScopedTimelineRepository(
  client: PoolClient,
  barrier: () => Promise<void>
) {
  const scopedDb = drizzle(client);
  const executor = {
    execute: scopedDb.execute.bind(scopedDb),
    transaction<TResult>(
      work: Parameters<
        InboxV2TimelineMessageTransactionExecutor["transaction"]
      >[0],
      config: Parameters<
        InboxV2TimelineMessageTransactionExecutor["transaction"]
      >[1]
    ): Promise<TResult> {
      return scopedDb.transaction(async (transaction) => {
        await barrier();
        return work(transaction as never) as Promise<TResult>;
      }, config);
    }
  } as unknown as InboxV2TimelineMessageTransactionExecutor;
  return createSqlInboxV2TimelineMessageRepository(executor);
}

function createAsyncBarrier(parties: number): () => Promise<void> {
  let arrivals = 0;
  let release: (() => void) | undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrivals += 1;
    if (arrivals === parties) release?.();
    await released;
  };
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
