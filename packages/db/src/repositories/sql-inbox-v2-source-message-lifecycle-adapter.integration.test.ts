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
  INBOX_V2_TENANT_STREAM_SCHEMA_VERSION,
  calculateInboxV2CanonicalSha256,
  calculateInboxV2MessageContentDigest,
  inboxV2BigintCounterSchema,
  inboxV2DeferredMessageSourceActionEffectProofSchema,
  inboxV2DeferredMessageSourceActionSchema,
  inboxV2MessageCreationCommitSchema,
  inboxV2TimelineContentHeadOf,
  type InboxV2DeferredMessageSourceAction,
  type InboxV2DeferredMessageSourceActionEffectProof,
  type InboxV2ExternalMessageReference,
  type InboxV2MessageCreationCommit,
  type InboxV2SourceOccurrence
} from "@hulee/contracts";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  fixtureSourceCreationCommit,
  fixtureReference
} from "../../../contracts/src/inbox-v2/timeline-message-fixtures.type-fixture";
import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import { buildInsertInboxV2ExternalMessageReferenceSql } from "./sql-inbox-v2-outbound-transport-repository";
import {
  buildInsertInboxV2ActionAttributionSql,
  buildInsertInboxV2MessageReferenceContextSql,
  buildInsertInboxV2MessageRevisionSql,
  buildInsertInboxV2MessageSql,
  buildInsertInboxV2MessageTransportLinkHeadSql,
  buildInsertInboxV2MessageTransportLinkSql,
  buildInsertInboxV2TimelineContentPayloadSql,
  buildInsertInboxV2TimelineContentRevisionSql,
  buildInsertInboxV2TimelineContentSql,
  buildInsertInboxV2TimelineItemSql
} from "./sql-inbox-v2-timeline-message-repository";
import {
  createInboxV2SourceMessageLifecycleCallbacks,
  type InboxV2DeferredLifecycleSourceAction,
  type InboxV2SourceMessageLifecycleAdvancePlanner
} from "./sql-inbox-v2-source-message-lifecycle-adapter";
import {
  buildInsertInboxV2SourceMessageKeyRegistrySql,
  persistInboxV2DeferredMessageSourceActionInTransaction
} from "./sql-inbox-v2-source-message-reconciliation-repository";
import {
  deferredNormalizedEvent,
  makePendingDeferredAction
} from "./sql-inbox-v2-source-message-reconciliation-repository.test-support";
import type { RawSqlExecutor } from "./sql-outbox-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

type ClosureMode = "none" | "partial" | "exact";
type ApplySourceActionInput = Parameters<
  ReturnType<
    typeof createInboxV2SourceMessageLifecycleCallbacks
  >["applySourceAction"]
>[1];
type PlanLifecycleAdvanceInput = Parameters<
  InboxV2SourceMessageLifecycleAdvancePlanner["planLifecycleAdvance"]
>[1];

describePostgres(
  "SQL Inbox V2 source Message lifecycle closure (PostgreSQL)",
  () => {
    let db: HuleeDatabase;
    const tenantIds: string[] = [];

    beforeAll(async () => {
      db = createHuleeDatabase({ poolConfig: { max: 4 } });
      const readiness = await db.execute<{
        actions: string | null;
        revisions: string | null;
        providerOperations: string | null;
        activeProviderIndex: string | null;
      }>(sql`
        select
          to_regclass(
            'public.inbox_v2_deferred_message_source_actions'
          )::text as "actions",
          to_regclass('public.inbox_v2_message_revisions')::text
            as "revisions",
          to_regclass(
            'public.inbox_v2_message_provider_lifecycle_operations'
          )::text as "providerOperations",
          to_regclass(
            'public.inbox_v2_provider_lifecycle_active_message_unique'
          )::text as "activeProviderIndex"
      `);
      expect(readiness.rows[0]).toEqual({
        actions: "inbox_v2_deferred_message_source_actions",
        revisions: "inbox_v2_message_revisions",
        providerOperations: "inbox_v2_message_provider_lifecycle_operations",
        activeProviderIndex: "inbox_v2_provider_lifecycle_active_message_unique"
      });
    });

    afterAll(async () => {
      if (!db) return;
      for (const tenantId of tenantIds.reverse()) {
        await purgeSyntheticTenant(db, tenantId);
      }
      await closeHuleeDatabase(db);
    });

    it.each([
      ["a no-op callback", "none"],
      ["a partial change-only callback", "partial"]
    ] as const)(
      "rolls back occurrence, Message, operation and deferred action after %s",
      async (_label, mode) => {
        const fixture = await seedLifecycleFixture(db, `${mode}-${runId}`);
        tenantIds.push(fixture.tenantId);
        const before = await closureSnapshot(db, fixture);

        await expect(
          db.transaction(async (transaction) => {
            const result = await callbacksFor(fixture, mode).applySourceAction(
              rawExecutor(transaction),
              sourceActionInput(fixture)
            );
            return result;
          })
        ).rejects.toThrow(
          "Source lifecycle effect omitted or duplicated its exact stream change, event or projection closure."
        );

        expect(await closureSnapshot(db, fixture)).toEqual(before);
        expect(before).toEqual(initialSnapshot());
      },
      30_000
    );

    it("commits one exact two-change Message/provider closure with one event and projection", async () => {
      const fixture = await seedLifecycleFixture(db, `exact-${runId}`);
      tenantIds.push(fixture.tenantId);
      let closureCalls = 0;
      const callbacks = callbacksFor(fixture, "exact", () => {
        closureCalls += 1;
      });

      await expect(
        db.transaction((transaction) =>
          callbacks.applySourceAction(
            rawExecutor(transaction),
            sourceActionInput(fixture)
          )
        )
      ).resolves.toMatchObject({
        kind: "committed",
        result: {
          deferredAction: {
            id: fixture.action.id,
            revision: "2",
            state: {
              state: "applied",
              appliedMessageRevision: "2",
              effectKind: "message_lifecycle"
            }
          }
        }
      });

      expect(closureCalls).toBe(1);
      expect(await closureSnapshot(db, fixture)).toEqual({
        messageRevision: "2",
        contentRevision: "2",
        timelineRevision: "2",
        occurrenceRevision: "2",
        occurrenceState: "resolved",
        actionRevision: "2",
        actionState: "applied",
        messageRevisionRows: 2,
        providerOperations: 1,
        streamCommits: 1,
        changes: 2,
        events: 1,
        projectionIntents: 1,
        providerIoIntents: 0,
        streamPosition: "2"
      });
    }, 30_000);
  }
);

type LifecycleFixture = Readonly<{
  tenantId: string;
  creation: InboxV2MessageCreationCommit;
  target: InboxV2ExternalMessageReference;
  action: InboxV2DeferredLifecycleSourceAction;
  streamPosition: "2";
}>;

async function seedLifecycleFixture(
  db: HuleeDatabase,
  suffix: string
): Promise<LifecycleFixture> {
  const creation = inboxV2MessageCreationCommitSchema.parse(
    scopeFixture(fixtureSourceCreationCommit(), suffix)
  );
  const action = inboxV2DeferredMessageSourceActionSchema.parse(
    scopeFixture(
      makePendingDeferredAction(
        {
          kind: "edit",
          normalizedEvent: deferredNormalizedEvent(
            `source-lifecycle-closure-${suffix}`
          ),
          normalizedContentDigestSha256:
            calculateInboxV2MessageContentDigest(editedBlocks())
        },
        {
          id: `deferred_message_source_action:source-lifecycle-${suffix}`,
          occurrenceId: `source_occurrence:source-lifecycle-${suffix}`,
          position: "10",
          fingerprint: "e".repeat(64)
        }
      ),
      suffix
    )
  ) as InboxV2DeferredLifecycleSourceAction;
  const target = creation.externalMessageReference;
  const timelineItem = creation.timelineAllocation.items[0];
  const externalThread = creation.externalThreadMapping?.thread;
  if (
    target === null ||
    timelineItem === undefined ||
    externalThread === undefined ||
    creation.sourceOccurrence === null ||
    creation.originTransportLink === null ||
    creation.originTransportLinkHead === null ||
    action.action.kind !== "edit" ||
    action.sourceOccurrence.resolution.state !== "pending"
  ) {
    throw new Error("Source lifecycle closure fixture is incomplete.");
  }
  const originOccurrence = creation.sourceOccurrence;
  const originTransportLink = creation.originTransportLink;
  const originTransportLinkHead = creation.originTransportLinkHead;
  const tenantId = creation.tenantId;
  const conversation = creation.timelineAllocation.conversationAfter;
  const participant = creation.authorParticipant;
  const actor = action.sourceOccurrence.providerActor;
  if (
    participant.subject.kind !== "source_external_identity" ||
    actor?.kind !== "source_external_identity" ||
    action.sourceOccurrence.origin.kind === "provider_response"
  ) {
    throw new Error("Source lifecycle closure fixture requires event actors.");
  }
  const sourceConnectionId = `source_connection:closure-${suffix}`;
  const initialAttributionId = `action_attribution:closure-${suffix}`;
  const initialStreamPosition = inboxV2BigintCounterSchema.parse("1");
  const threadScope = externalThreadScopeColumns(externalThread.key.scope);

  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = replica`
    );
    await transaction.execute(sql`
      insert into tenants (id, slug, display_name, deployment_type)
      values (
        ${tenantId}, ${`closure-${shortDigest(suffix)}`},
        'MSG005 source closure integration', 'saas_shared'
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_tenant_stream_heads (
        tenant_id, stream_epoch, last_position, min_retained_position,
        revision, created_at, updated_at
      ) values (
        ${tenantId}, ${`stream-epoch:closure-${suffix}`}, 1, 0, 1,
        ${creation.message.createdAt}, ${creation.message.updatedAt}
      )
    `);
    await transaction.execute(sql`
      insert into source_connections (
        id, tenant_id, source_type, source_name, display_name,
        status, auth_type, capabilities, config, diagnostics, metadata
      ) values (
        ${sourceConnectionId}, ${tenantId}, 'messenger', 'synthetic',
        'MSG005 closure connection', 'active', 'custom', '{}'::jsonb,
        '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
      )
    `);
    await transaction.execute(sql`
      insert into source_accounts (
        id, tenant_id, source_connection_id, account_type,
        display_name, status, metadata
      ) values (
        ${action.semanticProof.sourceAccount.id}, ${tenantId},
        ${sourceConnectionId}, 'direct_number', 'MSG005 closure account',
        'active', '{}'::jsonb
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_external_threads (
        tenant_id, id, key_registry_id, key_registry_entry_kind,
        realm_id, realm_version, canonicalization_version,
        scope_kind, scope_source_connection_id, scope_source_account_id,
        scope_owner_key, object_kind_id,
        canonical_external_subject, identity_declaration,
        conversation_id, conversation_transport, conversation_topology,
        revision, created_at, updated_at
      ) values (
        ${tenantId}, ${target.externalThread.id},
        ${`external_thread_key_registry:closure-${suffix}`}, 'canonical',
        ${externalThread.key.realm.realmId},
        ${externalThread.key.realm.realmVersion},
        ${externalThread.key.realm.canonicalizationVersion},
        ${threadScope.kind}, ${threadScope.sourceConnectionId},
        ${threadScope.sourceAccountId}, ${threadScope.ownerKey},
        ${externalThread.key.objectKindId},
        ${externalThread.key.canonicalExternalSubject},
        ${JSON.stringify(externalThread.identityDeclaration)}::jsonb,
        ${externalThread.conversation.id}, 'external',
        ${externalThread.conversationTopology}, 1,
        ${externalThread.createdAt}, ${externalThread.updatedAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_source_thread_bindings (
        tenant_id, id, external_thread_id, source_connection_id,
        source_account_id, created_at
      ) values (
        ${tenantId}, ${action.semanticProof.sourceThreadBinding.id},
        ${target.externalThread.id}, ${sourceConnectionId},
        ${action.semanticProof.sourceAccount.id}, ${creation.message.createdAt}
      )
    `);
    await seedSourceIdentity(
      transaction,
      action.sourceOccurrence,
      sourceConnectionId
    );
    await seedInboundEvent(
      transaction,
      originOccurrence,
      sourceConnectionId,
      `${suffix}-origin`
    );
    await seedSourceOccurrence(
      transaction,
      originOccurrence,
      sourceConnectionId,
      creation.message.conversation.id
    );
    await seedInboundEvent(
      transaction,
      action.sourceOccurrence,
      sourceConnectionId,
      suffix
    );
    await seedSourceOccurrence(
      transaction,
      action.sourceOccurrence,
      sourceConnectionId,
      creation.message.conversation.id
    );
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
        ${conversation.head.latestActivityAt}, ${conversation.head.revision},
        1, ${conversation.head.createdAt}, ${conversation.head.updatedAt}
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
        subject_source_external_identity_id, revision, created_at, updated_at
      ) values (
        ${tenantId}, ${participant.id}, ${conversation.id},
        'source_external_identity', ${actor.sourceExternalIdentity.id},
        ${participant.revision}, ${participant.createdAt},
        ${participant.updatedAt}
      )
    `);
    await transaction.execute(
      buildInsertInboxV2ActionAttributionSql({
        tenantId: creation.tenantId,
        id: initialAttributionId,
        conversationId: creation.message.conversation.id,
        attribution: creation.initialRevision.actionAttribution,
        createdAt: creation.initialRevision.recordedAt
      })
    );
    await transaction.execute(
      buildInsertInboxV2TimelineContentSql({
        tenantId: creation.tenantId,
        ownerKind: "message",
        ownerId: creation.message.id,
        processingPurposeId: conversation.purposeId,
        retentionAnchorAt: timelineItem.occurredAt,
        content: creation.content,
        streamPosition: initialStreamPosition
      })
    );
    await transaction.execute(
      buildInsertInboxV2TimelineContentRevisionSql({
        tenantId: creation.tenantId,
        content: creation.content,
        transitionKind: "created",
        expectedPreviousRevision: null,
        eventId: null,
        occurredAt: timelineItem.occurredAt,
        recordedAt: creation.timelineAllocation.committedAt,
        streamPosition: initialStreamPosition
      })
    );
    const payload = buildInsertInboxV2TimelineContentPayloadSql({
      tenantId: creation.tenantId,
      contentId: creation.content.id,
      contentRevision: creation.content.revision,
      blocks:
        creation.content.state.kind === "available"
          ? creation.content.state.blocks
          : [],
      createdAt: creation.content.createdAt
    });
    if (payload !== null) await transaction.execute(payload);
    await transaction.execute(
      buildInsertInboxV2TimelineItemSql({
        item: timelineItem,
        streamPosition: initialStreamPosition
      })
    );
    await transaction.execute(
      buildInsertInboxV2MessageSql({
        message: creation.message,
        creationAttributionId: initialAttributionId,
        streamPosition: initialStreamPosition
      })
    );
    await transaction.execute(
      buildInsertInboxV2MessageReferenceContextSql(creation.message)
    );
    await transaction.execute(
      buildInsertInboxV2MessageRevisionSql({
        revision: creation.initialRevision,
        actionAttributionId: initialAttributionId,
        streamPosition: initialStreamPosition
      })
    );
    await transaction.execute(
      buildInsertInboxV2ExternalMessageReferenceSql(target)
    );
    await transaction.execute(
      buildInsertInboxV2MessageTransportLinkSql({
        link: originTransportLink,
        resultingHeadRevision: originTransportLinkHead.revision,
        streamPosition: initialStreamPosition
      })
    );
    await transaction.execute(
      buildInsertInboxV2MessageTransportLinkHeadSql({
        head: originTransportLinkHead,
        streamPosition: initialStreamPosition
      })
    );
    await transaction.execute(
      buildInsertInboxV2SourceMessageKeyRegistrySql({
        tenantId,
        externalMessageKey: action.externalMessageKey
      })
    );
    const persistedAction =
      await persistInboxV2DeferredMessageSourceActionInTransaction(
        rawExecutor(transaction),
        action
      );
    expect(persistedAction).toMatchObject({ kind: "created" });
    await transaction.execute(sql`set local session_replication_role = origin`);
  });

  return { tenantId, creation, target, action, streamPosition: "2" };
}

function callbacksFor(
  fixture: LifecycleFixture,
  mode: ClosureMode,
  onClosure?: () => void
) {
  return createInboxV2SourceMessageLifecycleCallbacks({
    planner: {
      async planLifecycleAdvance(_transaction, input) {
        return {
          kind: "planned" as const,
          plan: {
            kind: "message_lifecycle" as const,
            effectProof: providerObservedEditEffect(fixture, input),
            streamPosition: fixture.streamPosition
          }
        };
      }
    },
    effectClosure: {
      async persistEffectClosure(transaction, input) {
        onClosure?.();
        if (mode !== "none") {
          await persistCanonicalSourceLifecycleClosure(
            transaction,
            input.effectProof,
            fixture.streamPosition,
            mode === "exact"
          );
        }
        return { providerIoIntentCount: 0 };
      }
    },
    deriveResolutionToken: () =>
      `resolution:source-lifecycle-closure-${shortDigest(fixture.action.id)}`
  });
}

function sourceActionInput(fixture: LifecycleFixture): ApplySourceActionInput {
  return {
    plan: {
      intent: { kind: "source_action", deferredAction: fixture.action }
    } as ApplySourceActionInput["plan"],
    targetExternalMessageReference: fixture.target
  };
}

function providerObservedEditEffect(
  fixture: LifecycleFixture,
  input: PlanLifecycleAdvanceInput
): Extract<
  InboxV2DeferredMessageSourceActionEffectProof,
  { kind: "message_lifecycle" }
> {
  const { action, creation, target } = fixture;
  const timelineItem = creation.timelineAllocation.items[0];
  if (timelineItem === undefined || action.action.kind !== "edit") {
    throw new Error("Provider edit closure fixture is incomplete.");
  }
  const blocks = editedBlocks();
  const afterContent = {
    ...creation.content,
    state: {
      kind: "available" as const,
      blocks,
      contentDigestSha256: calculateInboxV2MessageContentDigest(blocks)
    },
    revision: "2",
    updatedAt: input.recordedAt
  };
  const afterMessage = {
    ...creation.message,
    content: inboxV2TimelineContentHeadOf(afterContent as never),
    revision: "2",
    updatedAt: input.recordedAt
  };
  const afterTimelineItem = {
    ...timelineItem,
    subject: {
      kind: "message" as const,
      message: target.message,
      messageRevision: "2"
    },
    revision: "2",
    updatedAt: input.recordedAt
  };
  const resolvedOccurrence = input.sourceOccurrenceResolution.after;
  const semanticProof = {
    ...action.semanticProof,
    capabilityId: "core:message-edit",
    externalMessageReference: fixtureReference(
      "external_message_reference",
      target.id,
      fixture.tenantId
    ),
    sourceOccurrence: fixtureReference(
      "source_occurrence",
      resolvedOccurrence.id,
      fixture.tenantId
    ),
    occurredAt: action.observedAt,
    recordedAt: input.recordedAt
  };
  if (semanticProof.ordering.kind !== "monotonic_exact") {
    throw new Error("Provider edit closure requires exact ordering.");
  }
  const semanticOrderingCommit = {
    tenantId: fixture.tenantId,
    semanticFamilyId: "core:message.lifecycle",
    before: null,
    proof: semanticProof,
    after: {
      tenantId: fixture.tenantId,
      semanticFamilyId: "core:message.lifecycle",
      externalMessageReference: semanticProof.externalMessageReference,
      sourceAccount: semanticProof.sourceAccount,
      sourceThreadBinding: semanticProof.sourceThreadBinding,
      bindingGeneration: semanticProof.bindingGeneration,
      scopeToken: semanticProof.ordering.scopeToken,
      comparatorId: semanticProof.ordering.comparatorId,
      comparatorRevision: semanticProof.ordering.comparatorRevision,
      position: semanticProof.ordering.position,
      normalizedInboundEvent: semanticProof.normalizedInboundEvent,
      proofToken: semanticProof.proofToken,
      revision: "1",
      updatedAt: input.recordedAt
    },
    committedAt: input.recordedAt
  };
  const operation = {
    tenantId: fixture.tenantId,
    id: `message_provider_lifecycle_operation:source-edit-${shortDigest(action.id)}`,
    message: target.message,
    action: "edit" as const,
    origin: "provider_observed" as const,
    externalMessageReference: semanticProof.externalMessageReference,
    sourceOccurrence: semanticProof.sourceOccurrence,
    sourceAccount: resolvedOccurrence.bindingContext.sourceAccount,
    sourceThreadBinding: resolvedOccurrence.bindingContext.sourceThreadBinding,
    bindingGeneration: resolvedOccurrence.bindingContext.bindingGeneration,
    outboundRoute: null,
    adapterContract: resolvedOccurrence.descriptor.adapterContract,
    capabilityRevision: resolvedOccurrence.descriptor.capabilityRevision,
    appActor: null,
    actionParticipant: null,
    automationCausation: null,
    outcome: { state: "observed" as const },
    deleteLocalPolicy: null,
    revision: "1",
    occurredAt: action.observedAt,
    recordedAt: input.recordedAt,
    createdAt: input.recordedAt,
    updatedAt: input.recordedAt
  };
  const providerOperationCreationCommit = {
    tenantId: fixture.tenantId,
    message: creation.message,
    timelineItem,
    externalMessageReference: target,
    sourceOccurrence: resolvedOccurrence,
    outboundRoute: null,
    outboundBindingSnapshot: null,
    actionParticipantSnapshot: null,
    providerSemanticProof: semanticProof,
    semanticOrderingCommit,
    routeConsumption: null,
    operation
  };
  return inboxV2DeferredMessageSourceActionEffectProofSchema.parse({
    kind: "message_lifecycle",
    commit: {
      tenantId: fixture.tenantId,
      beforeMessage: creation.message,
      beforeTimelineItem: timelineItem,
      contentTransition: {
        tenantId: fixture.tenantId,
        before: creation.content,
        transition: {
          kind: "edit",
          expectedRevision: "1",
          resultingRevision: "2",
          event: fixtureReference(
            "event",
            `event:source-edit-${shortDigest(action.id)}`,
            fixture.tenantId
          ),
          occurredAt: input.recordedAt
        },
        after: afterContent
      },
      providerOperation: operation,
      providerOperationCreationCommit,
      actionParticipantSnapshot: creation.authorParticipant,
      revision: {
        tenantId: fixture.tenantId,
        id: `message_revision:source-edit-${shortDigest(action.id)}`,
        message: target.message,
        timelineItem: target.timelineItem,
        expectedPreviousRevision: "1",
        messageRevision: "2",
        change: {
          kind: "edited",
          beforeContent: creation.message.content,
          afterContent: afterMessage.content,
          providerOperation: fixtureReference(
            "message_provider_lifecycle_operation",
            operation.id,
            fixture.tenantId
          )
        },
        actionAttribution: {
          actionParticipant: creation.message.authorParticipant,
          appActor: null,
          sourceOccurrence: semanticProof.sourceOccurrence,
          automationCausation: null
        },
        occurredAt: action.observedAt,
        recordedAt: input.recordedAt,
        recordRevision: "1",
        createdAt: input.recordedAt
      },
      afterMessage,
      afterTimelineItem
    }
  }) as Extract<
    InboxV2DeferredMessageSourceActionEffectProof,
    { kind: "message_lifecycle" }
  >;
}

async function persistCanonicalSourceLifecycleClosure(
  transaction: RawSqlExecutor,
  effectProof: InboxV2DeferredMessageSourceActionEffectProof,
  streamPosition: string,
  complete: boolean
): Promise<void> {
  if (effectProof.kind !== "message_lifecycle") {
    throw new Error("Expected a Message lifecycle closure proof.");
  }
  const commit = effectProof.commit;
  const providerCreation = commit.providerOperationCreationCommit;
  if (providerCreation === null) {
    throw new Error("Expected nested provider lifecycle creation.");
  }
  const tenantId = commit.tenantId;
  const messageChangeId = `change:source-message-${shortDigest(commit.revision.id)}`;
  const operationChangeId = `change:source-operation-${shortDigest(providerCreation.operation.id)}`;
  const eventId = `event:source-closure-${shortDigest(commit.revision.id)}`;
  const projectionId = `outbox_intent:source-projection-${shortDigest(commit.revision.id)}`;
  const streamCommitId = `stream_commit:source-closure-${shortDigest(commit.revision.id)}`;
  const mutationId = `mutation:source-closure-${shortDigest(commit.revision.id)}`;
  const correlationId = `correlation:source-closure-${shortDigest(commit.revision.id)}`;
  const messageStateReference = {
    tenantId,
    recordId: commit.afterMessage.id,
    schemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
    schemaVersion: INBOX_V2_MESSAGE_SCHEMA_VERSION,
    digest: calculateInboxV2CanonicalSha256(commit.afterMessage)
  };
  const messageCommitReference = {
    tenantId,
    recordId: commit.revision.id,
    schemaId: INBOX_V2_MESSAGE_REVISION_SCHEMA_ID,
    schemaVersion: INBOX_V2_MESSAGE_LIFECYCLE_SCHEMA_VERSION,
    digest: calculateInboxV2CanonicalSha256(commit.revision)
  };
  const operationReference = {
    tenantId,
    recordId: providerCreation.operation.id,
    schemaId: INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_OPERATION_SCHEMA_ID,
    schemaVersion: INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_SCHEMA_VERSION,
    digest: calculateInboxV2CanonicalSha256(providerCreation.operation)
  };
  const operationCommitReference = {
    tenantId,
    recordId: providerCreation.operation.id,
    schemaId: INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_CREATION_COMMIT_SCHEMA_ID,
    schemaVersion: INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_SCHEMA_VERSION,
    digest: calculateInboxV2CanonicalSha256(providerCreation)
  };
  const changeIds = [messageChangeId, operationChangeId];
  const eventHash = digest(`event:${eventId}`);
  const projectionHash = digest(`projection:${projectionId}`);
  const manifestDigest = digest(
    [
      `change:${messageStateReference.digest}`,
      `change:${operationReference.digest}`,
      `event:${eventHash}`,
      `intent:${projectionHash}`
    ].join("\n")
  );
  const recordedAt = commit.revision.recordedAt;

  await transaction.execute(sql`
    insert into inbox_v2_tenant_stream_commits (
      tenant_id, id, mutation_id, stream_epoch, position, previous_position,
      schema_version, correlation_id, command_ids, client_mutation_ids,
      authorization_decision_refs, change_ids, event_ids, outbox_intent_ids,
      audience_impact_kind, audience_impact_manifest, change_count,
      event_count, outbox_intent_count, manifest_digest_sha256, commit_hash,
      committed_at, created_at
    ) select
      ${tenantId}, ${streamCommitId}, ${mutationId}, head.stream_epoch,
      ${streamPosition}::bigint, head.last_position,
      ${INBOX_V2_TENANT_STREAM_SCHEMA_VERSION}, ${correlationId},
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      ${JSON.stringify(changeIds)}::jsonb,
      ${JSON.stringify([eventId])}::jsonb,
      ${JSON.stringify([projectionId])}::jsonb,
      'none', '{"kind":"none"}'::jsonb,
      2, 1, 1, ${manifestDigest},
      ${digest(`commit:${streamCommitId}`)}, ${recordedAt}, ${recordedAt}
      from inbox_v2_tenant_stream_heads head
     where head.tenant_id = ${tenantId}
       and head.last_position = 1
  `);
  await transaction.execute(sql`
    insert into inbox_v2_tenant_stream_changes (
      tenant_id, id, mutation_id, stream_commit_id, stream_position,
      ordinal, entity_type_id, entity_id, resulting_revision, timeline,
      audience, state_kind, state_schema_id, state_schema_version,
      state_reason_id, state_hash, payload_reference,
      domain_commit_reference, created_at
    ) values (
      ${tenantId}, ${messageChangeId}, ${mutationId}, ${streamCommitId},
      ${streamPosition}::bigint, 1, 'core:message',
      ${commit.afterMessage.id}, ${commit.afterMessage.revision}::bigint,
      ${JSON.stringify({
        conversation: commit.afterMessage.conversation,
        timelineSequence: commit.afterTimelineItem.timelineSequence
      })}::jsonb,
      ${commit.afterTimelineItem.visibility}, 'upsert',
      ${INBOX_V2_MESSAGE_SCHEMA_ID}, ${INBOX_V2_MESSAGE_SCHEMA_VERSION},
      null, ${messageStateReference.digest},
      ${JSON.stringify(messageStateReference)}::jsonb,
      ${JSON.stringify(messageCommitReference)}::jsonb, ${recordedAt}
    ), (
      ${tenantId}, ${operationChangeId}, ${mutationId}, ${streamCommitId},
      ${streamPosition}::bigint, 2,
      ${INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_OPERATION_ENTITY_TYPE_ID},
      ${providerCreation.operation.id},
      ${providerCreation.operation.revision}::bigint,
      ${JSON.stringify({
        conversation: commit.afterMessage.conversation,
        timelineSequence: commit.afterTimelineItem.timelineSequence
      })}::jsonb,
      ${commit.afterTimelineItem.visibility}, 'upsert',
      ${INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_OPERATION_SCHEMA_ID},
      ${INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_SCHEMA_VERSION}, null,
      ${operationReference.digest}, ${JSON.stringify(operationReference)}::jsonb,
      ${JSON.stringify(operationCommitReference)}::jsonb, ${recordedAt}
    )
  `);
  await transaction.execute(sql`
    update inbox_v2_tenant_stream_heads
       set last_position = ${streamPosition}::bigint,
           revision = revision + 1,
           updated_at = ${recordedAt}
     where tenant_id = ${tenantId}
       and last_position = 1
  `);
  if (!complete) return;
  await transaction.execute(sql`
    insert into inbox_v2_domain_events (
      tenant_id, id, mutation_id, stream_commit_id, stream_position,
      ordinal, type_id, payload_schema_id, payload_schema_version,
      change_ids, subjects, payload_reference, correlation_id, command_ids,
      client_mutation_ids, authorization_decision_refs, access_effect,
      access_effect_causes, event_hash, occurred_at, recorded_at
    ) values (
      ${tenantId}, ${eventId}, ${mutationId}, ${streamCommitId},
      ${streamPosition}::bigint, 1, 'core:message.changed',
      ${messageCommitReference.schemaId}, ${messageCommitReference.schemaVersion},
      ${JSON.stringify(changeIds)}::jsonb,
      ${JSON.stringify([
        {
          tenantId,
          entityTypeId: "core:message",
          entityId: commit.afterMessage.id
        }
      ])}::jsonb,
      ${JSON.stringify(messageCommitReference)}::jsonb, ${correlationId},
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'none', '[]'::jsonb,
      ${eventHash}, ${commit.revision.occurredAt}, ${recordedAt}
    )
  `);
  await transaction.execute(sql`
    insert into inbox_v2_outbox_intents (
      tenant_id, id, mutation_id, stream_commit_id, stream_position,
      ordinal, type_id, handler_id, effect_class, event_id,
      consumer_dedupe_key, change_ids, payload_reference,
      correlation_id, intent_hash, available_at, created_at
    ) values (
      ${tenantId}, ${projectionId}, ${mutationId}, ${streamCommitId},
      ${streamPosition}::bigint, 1, 'core:projection.update',
      'core:inbox-projection', 'projection', ${eventId},
      ${digest(`dedupe:${projectionId}`)}, ${JSON.stringify(changeIds)}::jsonb,
      null, ${correlationId}, ${projectionHash}, ${recordedAt}, ${recordedAt}
    )
  `);
}

type ClosureSnapshot = Readonly<{
  messageRevision: string;
  contentRevision: string;
  timelineRevision: string;
  occurrenceRevision: string;
  occurrenceState: string;
  actionRevision: string;
  actionState: string;
  messageRevisionRows: number;
  providerOperations: number;
  streamCommits: number;
  changes: number;
  events: number;
  projectionIntents: number;
  providerIoIntents: number;
  streamPosition: string;
}>;

async function closureSnapshot(
  db: HuleeDatabase,
  fixture: LifecycleFixture
): Promise<ClosureSnapshot> {
  const result = await db.execute<ClosureSnapshot>(sql`
    select
      message_row.revision::text as "messageRevision",
      content_row.revision::text as "contentRevision",
      timeline_row.revision::text as "timelineRevision",
      occurrence_row.revision::text as "occurrenceRevision",
      occurrence_row.resolution_state::text as "occurrenceState",
      action_row.revision::text as "actionRevision",
      action_row.state::text as "actionState",
      (select count(*)::integer
         from inbox_v2_message_revisions revision_row
        where revision_row.tenant_id = ${fixture.tenantId}
          and revision_row.message_id = ${fixture.creation.message.id})
        as "messageRevisionRows",
      (select count(*)::integer
         from inbox_v2_message_provider_lifecycle_operations operation_row
        where operation_row.tenant_id = ${fixture.tenantId}
          and operation_row.message_id = ${fixture.creation.message.id})
        as "providerOperations",
      (select count(*)::integer
         from inbox_v2_tenant_stream_commits stream_row
        where stream_row.tenant_id = ${fixture.tenantId}) as "streamCommits",
      (select count(*)::integer
         from inbox_v2_tenant_stream_changes change_row
        where change_row.tenant_id = ${fixture.tenantId}) as "changes",
      (select count(*)::integer
         from inbox_v2_domain_events event_row
        where event_row.tenant_id = ${fixture.tenantId}) as "events",
      (select count(*)::integer
         from inbox_v2_outbox_intents intent_row
        where intent_row.tenant_id = ${fixture.tenantId}
          and intent_row.effect_class = 'projection') as "projectionIntents",
      (select count(*)::integer
         from inbox_v2_outbox_intents intent_row
        where intent_row.tenant_id = ${fixture.tenantId}
          and intent_row.effect_class = 'provider_io') as "providerIoIntents",
      stream_head.last_position::text as "streamPosition"
      from inbox_v2_messages message_row
      join inbox_v2_timeline_contents content_row
        on content_row.tenant_id = message_row.tenant_id
       and content_row.id = message_row.content_id
      join inbox_v2_timeline_items timeline_row
        on timeline_row.tenant_id = message_row.tenant_id
       and timeline_row.id = message_row.timeline_item_id
      join inbox_v2_source_occurrences occurrence_row
        on occurrence_row.tenant_id = message_row.tenant_id
       and occurrence_row.id = ${fixture.action.sourceOccurrence.id}
      join inbox_v2_deferred_message_source_actions action_row
        on action_row.tenant_id = message_row.tenant_id
       and action_row.id = ${fixture.action.id}
      join inbox_v2_tenant_stream_heads stream_head
        on stream_head.tenant_id = message_row.tenant_id
     where message_row.tenant_id = ${fixture.tenantId}
       and message_row.id = ${fixture.creation.message.id}
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("Source closure snapshot is missing.");
  return row;
}

function initialSnapshot(): ClosureSnapshot {
  return {
    messageRevision: "1",
    contentRevision: "1",
    timelineRevision: "1",
    occurrenceRevision: "1",
    occurrenceState: "pending",
    actionRevision: "1",
    actionState: "pending",
    messageRevisionRows: 1,
    providerOperations: 0,
    streamCommits: 0,
    changes: 0,
    events: 0,
    projectionIntents: 0,
    providerIoIntents: 0,
    streamPosition: "1"
  };
}

async function seedInboundEvent(
  transaction: unknown,
  occurrence: InboxV2SourceOccurrence,
  sourceConnectionId: string,
  suffix: string
): Promise<void> {
  if (occurrence.origin.kind === "provider_response") {
    throw new Error("Expected an event-backed SourceOccurrence.");
  }
  const executor = rawExecutor(transaction);
  await executor.execute(sql`
    insert into raw_inbound_events (
      id, tenant_id, source_connection_id, source_account_id,
      idempotency_key, payload, headers, processing_status,
      received_at, created_at, updated_at
    ) values (
      ${occurrence.origin.rawInboundEvent.id}, ${occurrence.tenantId},
      ${sourceConnectionId}, ${occurrence.bindingContext.sourceAccount.id},
      ${`closure-raw-${shortDigest(suffix)}`}, '{}'::jsonb, '{}'::jsonb,
      'processed', ${occurrence.recordedAt}, ${occurrence.recordedAt},
      ${occurrence.recordedAt}
    )
    on conflict (id) do nothing
  `);
  await executor.execute(sql`
    insert into normalized_inbound_events (
      id, tenant_id, raw_event_id, source_connection_id,
      source_account_id, source_type, source_name, event_type,
      direction, visibility, payload_version, normalized_payload,
      reply_capability, idempotency_key, processing_status,
      created_at, updated_at
    ) values (
      ${occurrence.origin.normalizedInboundEvent.id}, ${occurrence.tenantId},
      ${occurrence.origin.rawInboundEvent.id}, ${sourceConnectionId},
      ${occurrence.bindingContext.sourceAccount.id}, 'messenger', 'synthetic',
      'message', ${occurrence.direction}, 'private', 'v1', '{}'::jsonb,
      '{}'::jsonb, ${`closure-normalized-${shortDigest(suffix)}`},
      'processed', ${occurrence.recordedAt}, ${occurrence.recordedAt}
    )
  `);
}

async function seedSourceIdentity(
  transaction: unknown,
  occurrence: InboxV2SourceOccurrence,
  sourceConnectionId: string
): Promise<void> {
  if (occurrence.providerActor?.kind !== "source_external_identity") {
    throw new Error("Expected a source external identity actor.");
  }
  const executor = rawExecutor(transaction);
  const adapter = occurrence.descriptor.adapterContract;
  const actorId = occurrence.providerActor.sourceExternalIdentity.id;
  const declaration = {
    adapterContract: adapter,
    identityKind: "source_external_identity",
    realmId: "module:synthetic:closure-actor-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic:closure-provider-user",
    scopeKind: "source_account",
    decisionStrength: "authoritative"
  };
  await executor.execute(sql`
    insert into inbox_v2_source_external_identities (
      tenant_id, id, realm_id, realm_version,
      canonicalization_version, object_kind_id, scope_kind,
      scope_source_account_id, identity_declaration,
      declaration_contract_id, declaration_contract_version,
      declaration_revision, declaration_surface_id,
      declaration_loaded_by_trusted_service_id, declaration_loaded_at,
      materialized_by_trusted_service_id,
      materialization_authorization_token, materialized_at,
      canonical_external_subject, stability_kind, revision,
      created_at, updated_at
    ) values (
      ${occurrence.tenantId}, ${actorId},
      'module:synthetic:closure-actor-realm', 'v1', 'v1',
      'module:synthetic:closure-provider-user', 'source_account',
      ${occurrence.bindingContext.sourceAccount.id},
      ${JSON.stringify(declaration)}::jsonb, ${adapter.contractId},
      ${adapter.contractVersion}, ${adapter.declarationRevision}::bigint,
      ${adapter.surfaceId}, ${adapter.loadedByTrustedServiceId},
      ${adapter.loadedAt}, ${adapter.loadedByTrustedServiceId},
      ${`materialization:closure-${shortDigest(actorId)}`},
      ${occurrence.createdAt}, ${actorId}, 'stable', 1,
      ${occurrence.createdAt}, ${occurrence.createdAt}
    )
  `);
  void sourceConnectionId;
}

async function seedSourceOccurrence(
  transaction: unknown,
  occurrence: InboxV2SourceOccurrence,
  sourceConnectionId: string,
  conversationId: string
): Promise<void> {
  if (
    occurrence.origin.kind === "provider_response" ||
    occurrence.resolution.state === "conflicted"
  ) {
    throw new Error(
      "Expected a resolved or pending event-backed SourceOccurrence."
    );
  }
  const executor = rawExecutor(transaction);
  const key = occurrence.messageKey;
  const scope = messageScopeColumns(key.scope);
  const adapter = occurrence.descriptor.adapterContract;
  const actor = occurrence.providerActor;
  const resolvedReferenceId =
    occurrence.resolution.state === "resolved"
      ? occurrence.resolution.externalMessageReference.id
      : null;
  const diagnostic =
    occurrence.resolution.state === "pending"
      ? occurrence.resolution.diagnostic
      : null;
  await executor.execute(sql`
    insert into inbox_v2_source_occurrences (
      tenant_id, id, conversation_id, external_thread_id,
      external_thread_revision, source_connection_id, source_account_id,
      source_thread_binding_id, binding_revision, binding_generation,
      account_identity_revision, account_generation,
      account_canonical_key_digest_sha256, message_realm_id,
      message_realm_version, message_canonicalization_version,
      message_scope_kind, message_scope_source_account_id,
      message_scope_source_thread_binding_id, message_object_kind_id,
      canonical_external_subject, adapter_contract_id,
      adapter_contract_version, adapter_declaration_revision,
      adapter_surface_id, adapter_loaded_by_trusted_service_id,
      adapter_loaded_at, message_decision_strength, origin_kind,
      raw_inbound_event_id, normalized_inbound_event_id,
      provider_actor_kind, provider_actor_source_external_identity_id,
      provider_system_actor_kind_id, provider_system_actor_subject,
      direction, descriptor_schema_id, descriptor_version,
      capability_revision, provider_reference_count,
      descriptor_digest_sha256, provider_timestamp_count,
       reference_portability_kind,
       reference_portability_decision_strength, resolution_state,
       resolved_external_message_reference_id, resolution_candidate_count,
       resolution_candidate_digest_sha256, resolution_diagnostic_code_id,
      resolution_diagnostic_retryable,
      resolution_diagnostic_correlation_token,
      resolution_diagnostic_safe_operator_hint_id,
      materialized_by_trusted_service_id,
      materialization_authorization_token, observed_at, recorded_at,
      revision, created_at, updated_at
    ) values (
      ${occurrence.tenantId}, ${occurrence.id}, ${conversationId},
      ${key.externalThread.id}, 1, ${sourceConnectionId},
      ${occurrence.bindingContext.sourceAccount.id},
      ${occurrence.bindingContext.sourceThreadBinding.id}, 1,
      ${occurrence.bindingContext.bindingGeneration}::bigint, 1, 1,
      ${"9".repeat(64)}, ${key.realm.realmId}, ${key.realm.realmVersion},
      ${key.realm.canonicalizationVersion}, ${scope.kind},
      ${scope.sourceAccountId}, ${scope.sourceThreadBindingId},
      ${key.objectKindId}, ${key.canonicalExternalSubject},
      ${adapter.contractId}, ${adapter.contractVersion},
      ${adapter.declarationRevision}::bigint, ${adapter.surfaceId},
      ${adapter.loadedByTrustedServiceId}, ${adapter.loadedAt},
      ${occurrence.messageIdentityDeclaration.decisionStrength},
      ${occurrence.origin.kind}, ${occurrence.origin.rawInboundEvent.id},
      ${occurrence.origin.normalizedInboundEvent.id}, ${actor?.kind ?? null},
      ${
        actor?.kind === "source_external_identity"
          ? actor.sourceExternalIdentity.id
          : null
      },
      ${actor?.kind === "provider_system" ? actor.actorKindId : null},
      ${actor?.kind === "provider_system" ? actor.actorSubject : null},
      ${occurrence.direction}, ${occurrence.descriptor.descriptorSchemaId},
      ${occurrence.descriptor.descriptorVersion},
      ${occurrence.descriptor.capabilityRevision}::bigint,
      ${occurrence.descriptor.providerReferences.length},
      ${occurrence.descriptor.descriptorDigestSha256},
      ${occurrence.providerTimestamps.length},
      ${occurrence.referencePortability.kind},
      ${occurrence.referencePortability.decisionStrength},
      ${occurrence.resolution.state}, ${resolvedReferenceId}, 0, null,
      ${diagnostic?.codeId ?? null}, ${diagnostic?.retryable ?? null},
      ${diagnostic?.correlationToken ?? null},
      ${diagnostic?.safeOperatorHintId ?? null},
      'core:source-runtime',
      ${`materialization:closure-${shortDigest(occurrence.id)}`},
      ${occurrence.observedAt}, ${occurrence.recordedAt},
      ${occurrence.revision}::bigint, ${occurrence.createdAt},
      ${occurrence.updatedAt}
    )
  `);
  for (const [
    ordinal,
    reference
  ] of occurrence.descriptor.providerReferences.entries()) {
    await executor.execute(sql`
      insert into inbox_v2_source_occurrence_provider_references (
        tenant_id, source_occurrence_id, ordinal, kind_id, subject
      ) values (
        ${occurrence.tenantId}, ${occurrence.id}, ${ordinal},
        ${reference.kindId}, ${reference.subject}
      )
    `);
  }
  for (const [ordinal, timestamp] of occurrence.providerTimestamps.entries()) {
    await executor.execute(sql`
      insert into inbox_v2_source_occurrence_provider_timestamps (
        tenant_id, source_occurrence_id, ordinal, kind_id, timestamp
      ) values (
        ${occurrence.tenantId}, ${occurrence.id}, ${ordinal},
        ${timestamp.kindId}, ${timestamp.timestamp}
      )
    `);
  }
}

function messageScopeColumns(
  scope: InboxV2DeferredMessageSourceAction["externalMessageKey"]["scope"]
) {
  return {
    kind: scope.kind,
    sourceAccountId: scope.kind === "source_account" ? scope.owner.id : null,
    sourceThreadBindingId:
      scope.kind === "source_thread_binding" ? scope.owner.id : null
  };
}

function externalThreadScopeColumns(
  scope: NonNullable<
    InboxV2MessageCreationCommit["externalThreadMapping"]
  >["thread"]["key"]["scope"]
) {
  if (scope.kind === "provider") {
    return {
      kind: scope.kind,
      sourceConnectionId: null,
      sourceAccountId: null,
      ownerKey: "provider"
    };
  }
  if (scope.kind === "source_connection") {
    return {
      kind: scope.kind,
      sourceConnectionId: scope.owner.id,
      sourceAccountId: null,
      ownerKey: scope.owner.id
    };
  }
  return {
    kind: scope.kind,
    sourceConnectionId: null,
    sourceAccountId: scope.owner.id,
    ownerKey: scope.owner.id
  };
}

function editedBlocks() {
  return [
    {
      blockKey: "body-1",
      kind: "text" as const,
      role: "body" as const,
      text: "Provider edit closed atomically",
      language: "en"
    }
  ];
}

function scopeFixture<T>(value: T, suffix: string): T {
  const tenantId = `tenant:msg005-closure-${shortDigest(suffix)}`;
  const visit = (candidate: unknown): unknown => {
    if (typeof candidate === "string") {
      if (candidate === "tenant:tenant-1") return tenantId;
      if (
        !candidate.startsWith("core:") &&
        !candidate.startsWith("module:") &&
        !candidate.startsWith("sha256:") &&
        /^[a-z][a-z0-9_]*:[A-Za-z0-9]/u.test(candidate)
      ) {
        return `${candidate}-${shortDigest(suffix)}`;
      }
      return candidate;
    }
    if (candidate === null || typeof candidate !== "object") return candidate;
    if (Array.isArray(candidate)) return candidate.map(visit);
    return Object.fromEntries(
      Object.entries(candidate).map(([key, child]) => [key, visit(child)])
    );
  };
  return visit(value) as T;
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function shortDigest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

function rawExecutor(executor: unknown): RawSqlExecutor {
  return executor as RawSqlExecutor;
}

async function purgeSyntheticTenant(
  db: HuleeDatabase,
  tenantId: string
): Promise<void> {
  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select set_config('hulee.test_cleanup_tenant', ${tenantId}, true)`
    );
    await transaction.execute(
      sql`set local session_replication_role = replica`
    );
    await transaction.execute(sql`
      do $cleanup$
      declare
        cleanup_table text;
        cleanup_tenant text := current_setting('hulee.test_cleanup_tenant');
      begin
        for cleanup_table in
          select columns.table_name
          from information_schema.columns columns
          join information_schema.tables tables
            on tables.table_schema = columns.table_schema
           and tables.table_name = columns.table_name
          where columns.table_schema = 'public'
            and columns.column_name = 'tenant_id'
            and tables.table_type = 'BASE TABLE'
            and columns.table_name <> 'tenants'
          order by columns.table_name
        loop
          execute format(
            'delete from public.%I where tenant_id = $1', cleanup_table
          ) using cleanup_tenant;
        end loop;
        delete from public.tenants where id = cleanup_tenant;
      end
      $cleanup$
    `);
    await transaction.execute(sql`set local session_replication_role = origin`);
  });
}
