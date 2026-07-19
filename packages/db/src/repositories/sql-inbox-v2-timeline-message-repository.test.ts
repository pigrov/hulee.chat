import {
  inboxV2BigintCounterSchema,
  inboxV2ConversationIdSchema,
  inboxV2EntityRevisionSchema,
  inboxV2MessageActionAttributionSchema,
  inboxV2MessageCreationCommitSchema,
  inboxV2MessageContentBlockSchema,
  inboxV2MessageIdSchema,
  inboxV2ProviderSemanticOrderingHeadSchema,
  inboxV2ReactionSemanticSlotKeyFor,
  inboxV2TenantIdSchema,
  inboxV2TimelineItemIdSchema,
  inboxV2TimelineSequenceSchema
} from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  fixtureHuleeCreationCommit,
  fixtureInternalCreationCommit,
  fixtureSourceCreationCommit
} from "../../../contracts/src/inbox-v2/timeline-message-fixtures.type-fixture";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

import {
  actionAttributionRowMatches,
  assertInboxV2MessageCreationAuthority,
  buildAdvanceInboxV2ProviderSemanticOrderingHeadSql,
  buildInboxV2AtomicSourceMessageResolutionSql,
  buildFindInboxV2ProviderSemanticOrderingHeadSql,
  buildFindInboxV2MessageCreationDispatchSql,
  buildFindInboxV2MessageSourceOccurrenceSql,
  buildFindInboxV2OutboundRouteConsumptionSql,
  buildFindInboxV2MessageTransportFactCommitSql,
  buildInboxV2SafeGenericEnvelope,
  buildListInboxV2MessageReactionsReadSql,
  buildListInboxV2MessageTransportFactsReadSql,
  buildListInboxV2MessageTransportLinksReadSql,
  buildListInboxV2ProviderLifecycleTransitionsReadSql,
  buildInsertInboxV2MessageReactionSql,
  buildInsertInboxV2MessageTransportFactCommitSql,
  buildInsertInboxV2MessageTransportLinkSql,
  buildInsertInboxV2TimelineContentPayloadSql,
  buildInsertInboxV2OutboundRouteConsumptionSql,
  buildInsertInboxV2ProviderLifecycleOperationSql,
  buildInsertInboxV2ProviderSemanticOrderingHeadSql,
  buildInsertInboxV2ProviderReceiptObservationSql,
  buildInsertInboxV2ProviderReceiptOpaquePayloadSql,
  buildLockInboxV2OutboundRouteForConsumptionSql,
  buildLockInboxV2ProviderSemanticOrderingReferenceSql,
  buildPurgeInboxV2TimelineContentPayloadSql,
  computeInboxV2TimelineMessageCommitDigest,
  decodeInboxV2AuxiliaryReadCursor,
  decodeInboxV2AuxiliaryReadSnapshotToken,
  deriveInboxV2MessageCreationSourceOccurrenceFence,
  encodeInboxV2AuxiliaryReadCursor,
  encodeInboxV2AuxiliaryReadSnapshotToken,
  inboxV2MessageCreationSourceOccurrenceFenceRowMatches,
  mapProviderLifecycleOperationReadRow,
  mapInboxV2TimelineContentBlockRow,
  mapProviderSemanticOrderingHeadRow,
  mapQueryableReactionReadRow,
  mapQueryableTransportFactReadRow,
  messageCreationDispatchRowMatches,
  prepareInboxV2MessageCreation,
  sealInboxV2PreparedMessageCreation,
  type InboxV2MessageCreationCommit,
  type InboxV2MessageCreationDispatchRow,
  type InboxV2MessageProviderLifecycleCreationCommit,
  type InboxV2MessageReactionCommit,
  type InboxV2MessageTransportAssociationCommit,
  type InboxV2MessageTransportFactCommit,
  type InboxV2OutboundRouteConsumptionRecord
} from "./sql-inbox-v2-timeline-message-repository";

const tenantId = inboxV2TenantIdSchema.parse("tenant:db005-unit");
const messageId = inboxV2MessageIdSchema.parse("message:db005-unit");
const timelineItemId = inboxV2TimelineItemIdSchema.parse(
  "timeline_item:db005-unit"
);
const revision = inboxV2EntityRevisionSchema.parse("1");
const streamPosition = inboxV2BigintCounterSchema.parse("41");
const timelineSequence = inboxV2TimelineSequenceSchema.parse("17");
const now = "2026-07-14T09:00:00.000Z";

describe("SQL Inbox V2 timeline/message repository", () => {
  it("round-trips exact V2 attachment and extension pins without using legacy file columns", () => {
    const attachment = inboxV2MessageContentBlockSchema.parse({
      blockKey: "image-1",
      kind: "image",
      attachment: {
        state: "ready",
        attachment: {
          tenantId,
          kind: "message_attachment",
          id: "message_attachment:db005-unit-image"
        },
        file: { tenantId, kind: "file", id: "file:db005-unit-image" },
        fileRevision: "2",
        fileVersion: {
          tenantId,
          kind: "file_version",
          id: "file_version:db005-unit-image-v1"
        },
        objectVersion: {
          tenantId,
          kind: "file_object_version",
          id: "file_object_version:db005-unit-image-v1"
        }
      },
      displayName: "photo.png"
    });
    const extension = inboxV2MessageContentBlockSchema.parse({
      blockKey: "extension-1",
      kind: "extension",
      blockKindId: "core:message-extension",
      payloadSchemaId: "core:message-extension-payload",
      payloadSchemaVersion: "v1",
      payloadFile: {
        tenantId,
        kind: "file",
        id: "file:db005-unit-extension"
      },
      payloadPin: {
        state: "exact",
        fileRevision: "7",
        fileVersion: {
          tenantId,
          kind: "file_version",
          id: "file_version:db005-unit-extension-v7"
        },
        objectVersion: {
          tenantId,
          kind: "file_object_version",
          id: "file_object_version:db005-unit-extension-v7"
        }
      },
      payloadDigestSha256: "a".repeat(64),
      rendererId: "core:message-extension-renderer"
    });
    if (
      attachment.kind !== "image" ||
      attachment.attachment.state !== "ready" ||
      extension.kind !== "extension"
    ) {
      throw new Error("Exact pin fixture did not retain its block kinds.");
    }
    const insert = buildInsertInboxV2TimelineContentPayloadSql({
      tenantId,
      contentId: "timeline_content:db005-unit-pins",
      contentRevision: revision,
      blocks: [attachment, extension],
      createdAt: now
    });
    expect(insert).not.toBeNull();
    if (insert === null) return;
    const rendered = renderQuery(insert);
    const statement = normalizeSql(rendered.sql);
    for (const column of [
      "attachment_v2_file_id",
      "attachment_file_revision",
      "attachment_file_version_id",
      "attachment_object_version_id",
      "extension_payload_v2_file_id",
      "extension_payload_file_revision",
      "extension_payload_file_version_id",
      "extension_payload_object_version_id"
    ]) {
      expect(statement).toContain(column);
    }
    expect(rendered.params).toEqual(
      expect.arrayContaining([
        "file:db005-unit-image",
        "2",
        "file_version:db005-unit-image-v1",
        "file_object_version:db005-unit-image-v1",
        "file:db005-unit-extension",
        "7",
        "file_version:db005-unit-extension-v7",
        "file_object_version:db005-unit-extension-v7"
      ])
    );

    expect(
      mapInboxV2TimelineContentBlockRow(
        {
          block_key: attachment.blockKey,
          kind: attachment.kind,
          ordinal: 0,
          attachment_id: attachment.attachment.attachment.id,
          attachment_state: "ready",
          attachment_file_id: null,
          attachment_v2_file_id: attachment.attachment.file.id,
          attachment_file_revision: "2",
          attachment_file_version_id: attachment.attachment.fileVersion.id,
          attachment_object_version_id: attachment.attachment.objectVersion.id,
          attachment_failure_reason_id: null,
          display_name: attachment.displayName
        },
        [],
        tenantId
      )
    ).toEqual(attachment);
    expect(
      mapInboxV2TimelineContentBlockRow(
        {
          block_key: extension.blockKey,
          kind: extension.kind,
          ordinal: 1,
          extension_block_kind_id: extension.blockKindId,
          extension_payload_schema_id: extension.payloadSchemaId,
          extension_payload_schema_version: extension.payloadSchemaVersion,
          extension_payload_file_id: null,
          extension_payload_v2_file_id: extension.payloadFile.id,
          extension_payload_file_revision: "7",
          extension_payload_file_version_id:
            extension.payloadPin.state === "exact"
              ? extension.payloadPin.fileVersion.id
              : null,
          extension_payload_object_version_id:
            extension.payloadPin.state === "exact"
              ? extension.payloadPin.objectVersion.id
              : null,
          extension_payload_digest_sha256: extension.payloadDigestSha256,
          extension_renderer_id: extension.rendererId
        },
        [],
        tenantId
      )
    ).toEqual(extension);
  });

  it("reconstructs legacy unpinned compatibility rows explicitly", () => {
    const legacyAttachment = mapInboxV2TimelineContentBlockRow(
      {
        block_key: "legacy-file",
        kind: "file",
        ordinal: 0,
        attachment_id: "message_attachment:db005-unit-legacy",
        attachment_state: "ready",
        attachment_file_id: "file:db005-unit-legacy",
        attachment_v2_file_id: null,
        attachment_file_revision: null,
        attachment_file_version_id: null,
        attachment_object_version_id: null,
        attachment_failure_reason_id: null,
        display_name: "legacy.pdf"
      },
      [],
      tenantId
    );
    expect(legacyAttachment).toMatchObject({
      kind: "file",
      attachment: { state: "legacy_unpinned" }
    });

    const legacyExtension = mapInboxV2TimelineContentBlockRow(
      {
        block_key: "legacy-extension",
        kind: "extension",
        ordinal: 1,
        extension_block_kind_id: "core:message-extension",
        extension_payload_schema_id: "core:message-extension-payload",
        extension_payload_schema_version: "v1",
        extension_payload_file_id: "file:db005-unit-legacy-extension",
        extension_payload_v2_file_id: null,
        extension_payload_file_revision: null,
        extension_payload_file_version_id: null,
        extension_payload_object_version_id: null,
        extension_payload_digest_sha256: "b".repeat(64),
        extension_renderer_id: "core:message-extension-renderer"
      },
      [],
      tenantId
    );
    expect(legacyExtension).toMatchObject({
      kind: "extension",
      payloadPin: { state: "legacy_unpinned" }
    });
  });

  it("binds Message creation to the exact command, actor, epoch and Conversation decision", () => {
    const internalCommit = inboxV2MessageCreationCommitSchema.parse(
      fixtureInternalCreationCommit()
    );
    const externalCommit = inboxV2MessageCreationCommitSchema.parse(
      fixtureHuleeCreationCommit()
    );
    const sourceCommit = inboxV2MessageCreationCommitSchema.parse(
      fixtureSourceCreationCommit()
    );

    for (const commit of [internalCommit, externalCommit, sourceCommit]) {
      expect(() =>
        assertInboxV2MessageCreationAuthority(
          messageCreationAuthorityContext(commit),
          commit
        )
      ).not.toThrow();
    }

    const context = messageCreationAuthorityContext(internalCommit);
    expect(() =>
      assertInboxV2MessageCreationAuthority(
        { ...context, commandTypeId: "core:message.receive" },
        internalCommit
      )
    ).toThrow(/authorized command type/iu);
    expect(() =>
      assertInboxV2MessageCreationAuthority(
        {
          ...context,
          actor: { kind: "employee", employeeId: "employee:spoofed" }
        },
        internalCommit
      )
    ).toThrow(/exact allowed Conversation authorization decision/iu);
    expect(() =>
      assertInboxV2MessageCreationAuthority(
        { ...context, authorizationEpoch: "authorization:spoofed" },
        internalCommit
      )
    ).toThrow(/exact allowed Conversation authorization decision/iu);
    expect(() =>
      assertInboxV2MessageCreationAuthority(
        { ...context, occurredAt: "2026-07-14T09:00:00.001Z" },
        internalCommit
      )
    ).toThrow(/commit time must match/iu);
    expect(() =>
      assertInboxV2MessageCreationAuthority(
        {
          ...context,
          authorizationDecisionRefs: context.authorizationDecisionRefs.map(
            (decision) => ({
              ...decision,
              resource: {
                ...decision.resource,
                entityId: "conversation:spoofed"
              }
            })
          )
        } as never,
        internalCommit
      )
    ).toThrow(/exact allowed Conversation authorization decision/iu);
    expect(() =>
      assertInboxV2MessageCreationAuthority(
        {
          ...context,
          authorizationDecisionRefs: context.authorizationDecisionRefs.map(
            (decision) => ({
              ...decision,
              resourceScopeId: "core:permission-scope.tenant"
            })
          )
        } as never,
        internalCommit
      )
    ).toThrow(/exact allowed Conversation authorization decision/iu);
    expect(() =>
      assertInboxV2MessageCreationAuthority(
        {
          ...context,
          authorizationDecisionRefs: context.authorizationDecisionRefs.map(
            (decision) => ({
              ...decision,
              permissionId: "core:message.send_external"
            })
          )
        } as never,
        internalCommit
      )
    ).toThrow(/exact allowed Conversation authorization decision/iu);

    const trustedServiceCommit = {
      ...internalCommit,
      message: {
        ...internalCommit.message,
        appActor: {
          kind: "trusted_service" as const,
          trustedServiceId: "core:message-service"
        }
      }
    } as unknown as InboxV2MessageCreationCommit;
    expect(() =>
      assertInboxV2MessageCreationAuthority(
        {
          ...context,
          actor: {
            kind: "trusted_service",
            trustedServiceId: "core:spoofed-service"
          },
          authorizationDecisionRefs: context.authorizationDecisionRefs.map(
            (decision) => ({
              ...decision,
              principal: {
                kind: "trusted_service" as const,
                trustedServiceId: "core:spoofed-service"
              }
            })
          )
        } as never,
        trustedServiceCommit
      )
    ).toThrow(/authenticated command actor/iu);

    expect(() =>
      assertInboxV2MessageCreationAuthority(context, {
        ...internalCommit,
        message: {
          ...internalCommit.message,
          origin: {
            kind: "migration",
            provenance: {
              sourceSystemId: "legacy:test",
              sourceRecordId: "message:legacy",
              importedAt: now
            }
          }
        }
      } as unknown as InboxV2MessageCreationCommit)
    ).toThrow(/dedicated authorized command contract/iu);
  });

  it("independently binds an external Message to current Conversation and SourceAccount route authority", () => {
    const commit = inboxV2MessageCreationCommitSchema.parse(
      fixtureHuleeCreationCommit()
    );
    const context = messageCreationAuthorityContext(commit);
    const route = commit.outboundRoute;
    if (route === null) throw new Error("External fixture requires a route.");

    expect(() =>
      assertInboxV2MessageCreationAuthority(context, commit)
    ).not.toThrow();
    expect(() =>
      assertInboxV2MessageCreationAuthority(
        {
          ...context,
          authorizationDecisionRefs: context.authorizationDecisionRefs.filter(
            ({ permissionId }) => permissionId !== "core:source_account.use"
          )
        },
        commit
      )
    ).toThrow(/SourceAccount authorization decision/iu);
    expect(() =>
      assertInboxV2MessageCreationAuthority(
        {
          ...context,
          authorizationResourceRevisionFences:
            context.authorizationResourceRevisionFences.filter(
              ({ resourceKind }) => resourceKind !== "source_account"
            )
        },
        commit
      )
    ).toThrow(/SourceAccount authorization decision/iu);
    expect(() =>
      assertInboxV2MessageCreationAuthority(
        {
          ...context,
          authorizationResourceRevisionFences:
            context.authorizationResourceRevisionFences.filter(
              ({ resourceKind }) => resourceKind !== "conversation"
            )
        },
        commit
      )
    ).toThrow(/Conversation authorization decision/iu);

    for (const field of [
      "sourceAccountAuthorization",
      "conversationAuthorization"
    ] as const) {
      expect(() =>
        assertInboxV2MessageCreationAuthority(context, {
          ...commit,
          outboundRoute: {
            ...route,
            [field]: {
              ...route[field],
              decisionRevision: "2"
            }
          }
        } as InboxV2MessageCreationCommit)
      ).toThrow(/SourceAccount authorization decision/iu);
    }
  });

  it("binds explicit-reroute Message creation to reroute primary and Conversation reply authority", () => {
    const commit = explicitRerouteMessageCreationCommit();
    const context = explicitRerouteMessageCreationAuthorityContext(commit);

    expect(() =>
      assertInboxV2MessageCreationAuthority(context, commit)
    ).not.toThrow();
  });

  it("rejects a reroute command paired with an automatic OutboundRoute", () => {
    const commit = inboxV2MessageCreationCommitSchema.parse(
      fixtureHuleeCreationCommit()
    );
    const context = explicitRerouteMessageCreationAuthorityContext(commit);

    expect(() =>
      assertInboxV2MessageCreationAuthority(context, commit)
    ).toThrow(/explicitly rerouted OutboundRoute/iu);
  });

  it("fails explicit-reroute Message creation without the exact Conversation reply authority", () => {
    const commit = explicitRerouteMessageCreationCommit();
    const context = explicitRerouteMessageCreationAuthorityContext(commit);
    const replyDecision = context.authorizationDecisionRefs.find(
      ({ permissionId }) => permissionId === "core:message.reply_external"
    );
    if (replyDecision === undefined) throw new Error("Reply decision fixture.");

    const forgedContexts = [
      {
        ...context,
        authorizationDecisionRefs: context.authorizationDecisionRefs.filter(
          ({ id }) => id !== replyDecision.id
        )
      },
      {
        ...context,
        authorizationDecisionRefs: context.authorizationDecisionRefs.map(
          (decision) =>
            decision.id === replyDecision.id
              ? {
                  ...decision,
                  resource: {
                    ...decision.resource,
                    entityId: "conversation:forged"
                  }
                }
              : decision
        )
      },
      {
        ...context,
        authorizationResourceRevisionFences:
          context.authorizationResourceRevisionFences.filter(
            ({ resourceKind }) => resourceKind !== "conversation"
          )
      }
    ];
    for (const forged of forgedContexts) {
      expect(() =>
        assertInboxV2MessageCreationAuthority(forged as never, commit)
      ).toThrow(/Conversation reply authorization decision/iu);
    }

    const route = commit.outboundRoute;
    if (route === null) throw new Error("External route fixture.");
    expect(() =>
      assertInboxV2MessageCreationAuthority(context, {
        ...commit,
        outboundRoute: {
          ...route,
          conversationAuthorization: {
            ...route.conversationAuthorization,
            decisionRevision: "2"
          }
        }
      } as InboxV2MessageCreationCommit)
    ).toThrow(/route snapshot/iu);
  });

  it("fails explicit-reroute Message creation without exact selected SourceAccount-use authority", () => {
    const commit = explicitRerouteMessageCreationCommit();
    const context = explicitRerouteMessageCreationAuthorityContext(commit);
    const route = commit.outboundRoute;
    if (route === null) throw new Error("External route fixture.");
    const selectedUseDecision = context.authorizationDecisionRefs.find(
      (decision) =>
        decision.permissionId === "core:source_account.use" &&
        String(decision.resource.entityId) === String(route.sourceAccount.id)
    );
    if (selectedUseDecision === undefined) {
      throw new Error("Selected SourceAccount-use decision fixture.");
    }

    for (const authorizationDecisionRefs of [
      context.authorizationDecisionRefs.filter(
        ({ id }) => id !== selectedUseDecision.id
      ),
      context.authorizationDecisionRefs.map((decision) =>
        decision.id === selectedUseDecision.id
          ? {
              ...decision,
              resource: {
                ...decision.resource,
                entityId: "source_account:forged"
              }
            }
          : decision
      )
    ]) {
      expect(() =>
        assertInboxV2MessageCreationAuthority(
          { ...context, authorizationDecisionRefs } as never,
          commit
        )
      ).toThrow(/SourceAccount authorization decision/iu);
    }
  });

  it("fails explicit-reroute Message creation when the primary decision is not exact reroute authority", () => {
    const commit = explicitRerouteMessageCreationCommit();
    const context = explicitRerouteMessageCreationAuthorityContext(commit);
    const replyDecision = context.authorizationDecisionRefs.find(
      ({ permissionId }) => permissionId === "core:message.reply_external"
    );
    if (replyDecision === undefined) throw new Error("Reply decision fixture.");

    expect(() =>
      assertInboxV2MessageCreationAuthority(
        { ...context, authorizationDecisionId: replyDecision.id },
        commit
      )
    ).toThrow(/exact allowed reroute authorization decision/iu);
    expect(() =>
      assertInboxV2MessageCreationAuthority(
        {
          ...context,
          authorizationDecisionRefs: context.authorizationDecisionRefs.map(
            (decision) =>
              decision.id === context.authorizationDecisionId
                ? { ...decision, outcome: "denied" as const }
                : decision
          )
        },
        commit
      )
    ).toThrow(/exact allowed reroute authorization decision/iu);
  });

  it("requires live coordinator contexts and locks SourceOccurrence before stream allocation", async () => {
    const commit = inboxV2MessageCreationCommitSchema.parse(
      fixtureInternalCreationCommit()
    );
    const statements: string[] = [];
    const executor = messageCreationSeamExecutor(commit, statements);

    await expect(
      prepareInboxV2MessageCreation(executor as never, {
        commit
      })
    ).rejects.toThrow(/live authorized-command context/iu);
    await expect(
      sealInboxV2PreparedMessageCreation({} as never, {
        capability: Object.freeze({}) as never
      })
    ).rejects.toThrow(/live stream-position context/iu);
    expect(statements).toHaveLength(0);

    const sourceLock = renderQuery(
      buildFindInboxV2MessageSourceOccurrenceSql({
        tenantId,
        sourceOccurrenceId: "source_occurrence:db005-unit"
      })
    ).sql;
    expect(normalizeSql(sourceLock)).toContain(
      "select id, resolution_state, revision, updated_at"
    );
    expect(normalizeSql(sourceLock)).toContain("for update");
  });

  it("derives the exact pending or conflicted SourceOccurrence CAS fence from the Message commit", () => {
    const pendingCommit = inboxV2MessageCreationCommitSchema.parse(
      fixtureSourceCreationCommit()
    );
    const pendingResolution = pendingCommit.sourceResolutionCommit;
    if (pendingResolution === null) {
      throw new Error("Expected a source resolution commit fixture.");
    }
    expect(
      deriveInboxV2MessageCreationSourceOccurrenceFence(pendingCommit)
    ).toEqual({
      sourceOccurrenceId: pendingResolution.before.id,
      expectedRevision: pendingResolution.expectedRevision,
      expectedResolutionState: "pending",
      expectedUpdatedAt: pendingResolution.before.updatedAt
    });

    const resolvedReference = pendingResolution.after.resolution;
    if (resolvedReference.state !== "resolved") {
      throw new Error("Expected a resolved source occurrence fixture.");
    }
    const conflictedBefore = {
      ...pendingResolution.before,
      resolution: {
        state: "conflicted" as const,
        candidateExternalMessageReferences: [
          resolvedReference.externalMessageReference,
          {
            ...resolvedReference.externalMessageReference,
            id: "external_message_reference:conflict-candidate-2"
          }
        ],
        diagnostic: {
          codeId: "core:message-reference-conflicted",
          retryable: false,
          correlationToken: "correlation:source-reference-conflicted",
          safeOperatorHintId: "core:inspect-source-evidence"
        }
      }
    };
    const conflictedCommit = inboxV2MessageCreationCommitSchema.parse({
      ...pendingCommit,
      sourceResolutionCommit: {
        ...pendingResolution,
        before: conflictedBefore
      }
    });
    expect(
      deriveInboxV2MessageCreationSourceOccurrenceFence(conflictedCommit)
    ).toEqual({
      sourceOccurrenceId: conflictedBefore.id,
      expectedRevision: pendingResolution.expectedRevision,
      expectedResolutionState: "conflicted",
      expectedUpdatedAt: conflictedBefore.updatedAt
    });
  });

  it("rejects SourceOccurrence rows with a mismatched revision or updatedAt fence", () => {
    const commit = inboxV2MessageCreationCommitSchema.parse(
      fixtureSourceCreationCommit()
    );
    const fence = deriveInboxV2MessageCreationSourceOccurrenceFence(commit);
    if (fence === null) {
      throw new Error("Expected a source occurrence fence.");
    }
    const exactRow = {
      resolution_state: fence.expectedResolutionState,
      revision: fence.expectedRevision,
      updated_at: new Date(fence.expectedUpdatedAt)
    };
    expect(
      inboxV2MessageCreationSourceOccurrenceFenceRowMatches(exactRow, fence)
    ).toBe(true);
    expect(
      inboxV2MessageCreationSourceOccurrenceFenceRowMatches(
        { ...exactRow, revision: "2" },
        fence
      )
    ).toBe(false);
    expect(
      inboxV2MessageCreationSourceOccurrenceFenceRowMatches(
        { ...exactRow, updated_at: new Date("2026-07-14T09:00:00.001Z") },
        fence
      )
    ).toBe(false);
  });

  it("builds the source-originated atomic seal tail as VALUES-only writes", () => {
    const sourceCommit = inboxV2MessageCreationCommitSchema.parse(
      fixtureSourceCreationCommit()
    );
    const statements = buildInboxV2AtomicSourceMessageResolutionSql(
      sourceCommit
    ).map((statement) => normalizeSql(renderQuery(statement).sql));

    expect(statements).toHaveLength(3);
    expect(statements[0]).toMatch(
      /^insert into inbox_v2_external_message_references/iu
    );
    expect(statements[0]).toContain(") values (");
    expect(statements[1]).toMatch(
      /^insert into inbox_v2_source_occurrence_resolution_transitions/iu
    );
    expect(statements[2]).toMatch(/^update inbox_v2_source_occurrences/iu);
    for (const statement of statements) {
      expect(statement).not.toMatch(
        /\bselect\b|\bwith\b|\bfor\s+(?:update|share)|\bpg_[a-z0-9_]*\s*\(/iu
      );
    }

    const internalCommit = inboxV2MessageCreationCommitSchema.parse(
      fixtureInternalCreationCommit()
    );
    expect(
      buildInboxV2AtomicSourceMessageResolutionSql(internalCommit)
    ).toEqual([]);
  });

  it("keeps the generic envelope content-free and position-only", () => {
    const envelope = buildInboxV2SafeGenericEnvelope({
      tenantId,
      entityKind: "message",
      entityId: messageId,
      entityRevision: revision,
      timelineItemId,
      timelineSequence,
      streamPosition,
      changeKind: "edited",
      occurredAt: now
    });

    expect(Object.keys(envelope).sort()).toEqual(
      [
        "changeKind",
        "entityId",
        "entityKind",
        "entityRevision",
        "occurredAt",
        "streamPosition",
        "tenantId",
        "timelineItemId",
        "timelineSequence"
      ].sort()
    );
    expect(JSON.stringify(envelope)).not.toMatch(
      /content|text|body|caption|attachment|providerPayload/iu
    );
  });

  it("matches exact replay attribution with an opaque authorization epoch", () => {
    const attribution = inboxV2MessageActionAttributionSchema.parse({
      actionParticipant: {
        tenantId,
        kind: "conversation_participant",
        id: "conversation_participant:db005-unit"
      },
      appActor: {
        kind: "employee",
        employee: {
          tenantId,
          kind: "employee",
          id: "employee:db005-unit"
        },
        authorizationEpoch: "authorization:db005-opaque-epoch"
      },
      sourceOccurrence: null,
      automationCausation: null
    });

    expect(
      actionAttributionRowMatches(
        {
          action_participant_id: attribution.actionParticipant?.id,
          app_actor_kind: "employee",
          app_actor_employee_id: "employee:db005-unit",
          app_authorization_epoch: "authorization:db005-opaque-epoch",
          app_trusted_service_id: null,
          attribution_source_occurrence_id: null,
          automation_kind: null,
          automation_cause_event_id: null,
          automation_correlation_id: null,
          automation_caused_at: null,
          automation_initiating_employee_id: null,
          automation_initiating_authorization_epoch: null
        },
        attribution
      )
    ).toBe(true);
  });

  it("persists and CAS-advances the full provider semantic ordering head", () => {
    const head = providerSemanticOrderingHead();
    const next = inboxV2ProviderSemanticOrderingHeadSchema.parse({
      ...head,
      position: "92233720368547758081234567890",
      normalizedInboundEvent: {
        ...head.normalizedInboundEvent,
        id: "normalized_inbound_event:db005-ordering-next"
      },
      proofToken: "proof:db005-ordering-next",
      revision: "2",
      updatedAt: "2026-07-14T09:00:01.000Z"
    });

    const referenceLock = normalizeSql(
      renderQuery(
        buildLockInboxV2ProviderSemanticOrderingReferenceSql({
          tenantId,
          externalMessageReferenceId: head.externalMessageReference.id
        })
      ).sql
    );
    expect(referenceLock).toContain(
      "from inbox_v2_external_message_references"
    );
    expect(referenceLock).toContain("tenant_id =");
    expect(referenceLock).toContain("for update");

    const headLock = normalizeSql(
      renderQuery(
        buildFindInboxV2ProviderSemanticOrderingHeadSql({
          tenantId,
          externalMessageReferenceId: head.externalMessageReference.id,
          semanticFamilyId: head.semanticFamilyId,
          lock: true
        })
      ).sql
    );
    expect(headLock).toContain(
      "from inbox_v2_provider_semantic_ordering_heads"
    );
    expect(headLock).toContain("semantic_family_id =");
    expect(headLock).toContain("for update");

    const insert = renderQuery(
      buildInsertInboxV2ProviderSemanticOrderingHeadSql({
        head,
        streamPosition
      })
    );
    expect(normalizeSql(insert.sql)).toContain(
      "insert into inbox_v2_provider_semantic_ordering_heads"
    );
    expect(insert.params).toEqual(
      expect.arrayContaining([
        head.position,
        JSON.stringify(head),
        computeInboxV2TimelineMessageCommitDigest(head),
        streamPosition
      ])
    );

    const advance = renderQuery(
      buildAdvanceInboxV2ProviderSemanticOrderingHeadSql({
        before: head,
        after: next,
        currentLastChangedStreamPosition: streamPosition,
        streamPosition: inboxV2BigintCounterSchema.parse("42")
      })
    );
    const advanceSql = normalizeSql(advance.sql);
    expect(advanceSql).toContain(
      "update inbox_v2_provider_semantic_ordering_heads"
    );
    expect(advanceSql).toContain("head_detail_digest_sha256 =");
    expect(advanceSql).toContain("last_changed_stream_position =");
    expect(advance.params).toContain(next.position);

    expect(
      mapProviderSemanticOrderingHeadRow({
        tenant_id: head.tenantId,
        external_message_reference_id: head.externalMessageReference.id,
        semantic_family_id: head.semanticFamilyId,
        source_account_id: head.sourceAccount.id,
        source_thread_binding_id: head.sourceThreadBinding.id,
        binding_generation: BigInt(head.bindingGeneration),
        scope_token: head.scopeToken,
        comparator_id: head.comparatorId,
        comparator_revision: BigInt(head.comparatorRevision),
        position: head.position,
        normalized_inbound_event_id: head.normalizedInboundEvent.id,
        proof_token: head.proofToken,
        revision: BigInt(head.revision),
        head_detail: head,
        head_detail_digest_sha256:
          computeInboxV2TimelineMessageCommitDigest(head),
        last_changed_stream_position: BigInt(streamPosition),
        updated_at: new Date(head.updatedAt)
      })
    ).toEqual({ head, lastChangedStreamPosition: streamPosition });
  });

  it("purges classified content only through a tenant/content scoped payload delete", () => {
    const rendered = renderQuery(
      buildPurgeInboxV2TimelineContentPayloadSql({
        tenantId,
        contentId: "timeline_content:db005-unit"
      })
    );
    const statement = normalizeSql(rendered.sql);

    expect(statement).toBe(
      "delete from inbox_v2_timeline_content_payloads where tenant_id = $1 and content_id = $2"
    );
    expect(rendered.params).toEqual([tenantId, "timeline_content:db005-unit"]);
    expect(statement).not.toContain("delete from inbox_v2_timeline_contents");
    expect(statement).not.toContain("delete from inbox_v2_messages");
  });

  it("serializes one outbound route before the immutable single-use ledger insert", () => {
    const consumption: InboxV2OutboundRouteConsumptionRecord = {
      tenantId,
      consumerKind: "message_creation",
      consumerId: messageId,
      messageId,
      outboundRouteId: "outbound_route:db005-unit",
      mutationToken: "mutation-db005-unit",
      idempotencyToken: "idempotency-db005-unit",
      correlationToken: "correlation-db005-unit",
      consumedByTrustedServiceId: "core:source-runtime",
      consumedAt: now,
      revision,
      commitDigestSha256: "a".repeat(64)
    };
    const routeLock = renderQuery(
      buildLockInboxV2OutboundRouteForConsumptionSql({
        tenantId,
        outboundRouteId: consumption.outboundRouteId
      })
    );
    const replay = renderQuery(
      buildFindInboxV2OutboundRouteConsumptionSql(consumption)
    );
    const insert = renderQuery(
      buildInsertInboxV2OutboundRouteConsumptionSql(consumption)
    );

    expect(normalizeSql(routeLock.sql)).toContain(
      "from inbox_v2_outbound_routes"
    );
    expect(normalizeSql(routeLock.sql)).toContain("for update");
    expect(normalizeSql(replay.sql)).toContain(
      "outbound_route_id = $2 or ( consumer_kind = $3 and consumer_id = $4 )"
    );
    expect(normalizeSql(replay.sql)).toContain("for update");
    expect(normalizeSql(insert.sql)).toContain(
      "insert into inbox_v2_outbound_route_consumptions"
    );
    expect(insert.params).toEqual(
      expect.arrayContaining([
        tenantId,
        "message_creation",
        messageId,
        consumption.outboundRouteId,
        consumption.commitDigestSha256
      ])
    );
    expect(String(insert.params[1])).toMatch(
      /^outbound_route_consumption:[a-f0-9]{64}$/u
    );
  });

  it("matches message-creation dispatch replay by immutable identity while allowing delivery progress", () => {
    const dispatch = {
      tenantId,
      id: "outbound_dispatch:db005-unit",
      message: { tenantId, kind: "message", id: messageId },
      route: {
        tenantId,
        kind: "outbound_route",
        id: "outbound_route:db005-unit"
      },
      multiSendOperation: null,
      state: "queued",
      attemptCount: 0,
      activeAttempt: null,
      lastAttempt: null,
      retryAuthorization: null,
      revision: "1",
      createdAt: now,
      updatedAt: now
    } as NonNullable<InboxV2MessageCreationCommit["outboundDispatch"]>;
    const query = renderQuery(
      buildFindInboxV2MessageCreationDispatchSql({
        tenantId,
        messageId,
        expectedDispatch: dispatch
      })
    );
    const statement = normalizeSql(query.sql);

    expect(statement).toContain("from inbox_v2_outbound_dispatches");
    expect(statement).toContain("id = $2 or route_id = $3 or message_id = $4");
    expect(statement).toContain("limit 2 for update");
    expect(statement).not.toMatch(
      /\bstate\b|attempt_count|active_attempt_id|last_attempt_id|retry_authorization_decision_id|\brevision\b|updated_at/u
    );

    const progressedRow = {
      id: dispatch.id,
      message_id: messageId,
      conversation_id: "conversation:db005-unit",
      timeline_item_id: timelineItemId,
      route_id: dispatch.route.id,
      multi_send_operation_id: null,
      created_at: new Date(now),
      state: "accepted",
      attempt_count: 1,
      revision: 3n
    };
    const identity = {
      dispatch,
      conversationId: inboxV2ConversationIdSchema.parse(
        "conversation:db005-unit"
      ),
      timelineItemId
    };
    expect(messageCreationDispatchRowMatches(progressedRow, identity)).toBe(
      true
    );

    for (const crossed of [
      { ...progressedRow, id: "outbound_dispatch:crossed" },
      { ...progressedRow, message_id: "message:crossed" },
      { ...progressedRow, conversation_id: "conversation:crossed" },
      { ...progressedRow, timeline_item_id: "timeline_item:crossed" },
      { ...progressedRow, route_id: "outbound_route:crossed" },
      {
        ...progressedRow,
        multi_send_operation_id: "outbound_multi_send_operation:crossed"
      },
      { ...progressedRow, created_at: new Date(Date.parse(now) + 1_000) }
    ] satisfies InboxV2MessageCreationDispatchRow[]) {
      expect(messageCreationDispatchRowMatches(crossed, identity)).toBe(false);
    }

    const noDispatchQuery = renderQuery(
      buildFindInboxV2MessageCreationDispatchSql({
        tenantId,
        messageId,
        expectedDispatch: null
      })
    );
    expect(normalizeSql(noDispatchQuery.sql)).toContain(
      "where tenant_id = $1 and message_id = $2 limit 2 for update"
    );
    expect(noDispatchQuery.params).toEqual([tenantId, messageId]);
  });

  it("stores lifecycle revision-one state and bounded induction evidence separately from the mutable head", () => {
    const operation = {
      tenantId,
      id: "message_provider_lifecycle_operation:db005-unit",
      message: { tenantId, kind: "message", id: messageId },
      action: "edit",
      origin: "hulee_requested",
      externalMessageReference: {
        tenantId,
        kind: "external_message_reference",
        id: "external_message_reference:db005-unit"
      },
      sourceOccurrence: {
        tenantId,
        kind: "source_occurrence",
        id: "source_occurrence:db005-unit"
      },
      sourceAccount: {
        tenantId,
        kind: "source_account",
        id: "source_account:db005-unit"
      },
      sourceThreadBinding: {
        tenantId,
        kind: "source_thread_binding",
        id: "source_thread_binding:db005-unit"
      },
      bindingGeneration: revision,
      outboundRoute: {
        tenantId,
        kind: "outbound_route",
        id: "outbound_route:db005-unit"
      },
      adapterContract: adapterContract(),
      capabilityRevision: revision,
      appActor: {
        kind: "trusted_service",
        trustedServiceId: "core:source-runtime"
      },
      actionParticipant: null,
      automationCausation: null,
      outcome: { state: "pending" },
      deleteLocalPolicy: null,
      revision,
      occurredAt: now,
      recordedAt: now,
      createdAt: now,
      updatedAt: now
    } as const;
    const commit = {
      tenantId,
      operation,
      providerSemanticProof: null,
      semanticOrderingCommit: null
    } as unknown as InboxV2MessageProviderLifecycleCreationCommit;
    const rendered = renderQuery(
      buildInsertInboxV2ProviderLifecycleOperationSql({
        commit,
        actionAttributionId: `action_attribution:${"b".repeat(64)}`,
        streamPosition
      })
    );
    const statement = normalizeSql(rendered.sql);

    expect(statement).toContain("initial_outcome");
    expect(statement).toContain("provider_semantic_proof_detail");
    expect(statement).toContain("semantic_ordering_commit_detail");
    expect(statement).toContain("last_changed_stream_position");
    expect(rendered.params).toEqual(
      expect.arrayContaining([
        operation.id,
        "pending",
        operation.adapterContract.contractId,
        streamPosition
      ])
    );
  });

  it("keeps reaction state typed in its own table while transport links never rewrite Message or Timeline heads", () => {
    const reaction = {
      tenantId,
      id: "message_reaction:db005-unit",
      message: { tenantId, kind: "message", id: messageId },
      actor: {
        kind: "participant",
        participant: {
          tenantId,
          kind: "conversation_participant",
          id: "conversation_participant:db005-unit"
        }
      },
      capability: { kind: "internal", cardinality: "multiple_values" },
      semanticSlotKey: "v1:1:x",
      state: { kind: "active", value: { kind: "unicode", value: "👍" } },
      revision,
      createdAt: now,
      updatedAt: now
    } as unknown as InboxV2MessageReactionCommit["afterReaction"];
    const reactionInsert = renderQuery(
      buildInsertInboxV2MessageReactionSql({ reaction, streamPosition })
    );
    const link = {
      tenantId,
      id: "message_transport_occurrence_link:db005-unit",
      message: { tenantId, kind: "message", id: messageId },
      sourceOccurrence: {
        tenantId,
        kind: "source_occurrence",
        id: "source_occurrence:db005-unit"
      },
      externalMessageReference: {
        tenantId,
        kind: "external_message_reference",
        id: "external_message_reference:db005-unit"
      },
      role: "echo",
      revision,
      linkedAt: now
    } as unknown as InboxV2MessageTransportAssociationCommit["link"];
    const transportInsert = renderQuery(
      buildInsertInboxV2MessageTransportLinkSql({
        link,
        resultingHeadRevision: revision,
        streamPosition
      })
    );

    expect(normalizeSql(reactionInsert.sql)).toContain(
      "insert into inbox_v2_message_reactions"
    );
    expect(reactionInsert.params).toEqual(
      expect.arrayContaining([
        "active",
        "unicode",
        "👍",
        JSON.stringify(reaction.state)
      ])
    );
    const transportStatement = normalizeSql(transportInsert.sql);
    expect(transportStatement).toContain(
      "insert into inbox_v2_message_transport_links"
    );
    expect(transportStatement).toContain("resulting_head_revision");
    expect(transportStatement).toContain("recorded_stream_position");
    expect(transportStatement).not.toMatch(
      /update inbox_v2_(?:messages|timeline_items)/u
    );
  });

  it("stores receipt opaque values in a separately purgeable row and only digests in the durable observation", () => {
    const observation = {
      tenantId,
      id: "provider_receipt_observation:db005-unit",
      target: {
        kind: "provider_watermark",
        watermark: "opaque-watermark"
      },
      reader: {
        kind: "aggregate_only",
        aggregateKey: "opaque-reader-set"
      },
      sourceAccount: {
        tenantId,
        kind: "source_account",
        id: "source_account:db005-unit"
      },
      sourceThreadBinding: {
        tenantId,
        kind: "source_thread_binding",
        id: "source_thread_binding:db005-unit"
      },
      bindingGeneration: revision,
      adapterContract: adapterContract(),
      capabilityId: "core:message-read-receipt",
      capabilityRevision: revision,
      evidenceEvent: {
        tenantId,
        kind: "normalized_inbound_event",
        id: "normalized_inbound_event:db005-unit"
      },
      semanticProof: { proof: "bounded" },
      evidenceKindId: "core:provider-read-receipt",
      evidenceDigestSha256: "c".repeat(64),
      observedAt: now,
      recordedAt: now,
      revision
    };
    const commit = {
      tenantId,
      beforeMessage: { id: messageId },
      fact: { kind: "receipt", observation },
      commitToken: "receipt-commit-db005-unit"
    } as unknown as InboxV2MessageTransportFactCommit;
    const durable = renderQuery(
      buildInsertInboxV2ProviderReceiptObservationSql({
        commit,
        streamPosition
      })
    );
    const opaqueSql = buildInsertInboxV2ProviderReceiptOpaquePayloadSql(commit);
    if (opaqueSql === null)
      throw new Error("Expected classified receipt data.");
    const opaque = renderQuery(opaqueSql);
    const ledgerInsert = renderQuery(
      buildInsertInboxV2MessageTransportFactCommitSql({
        commit,
        streamPosition
      })
    );
    const ledgerFind = renderQuery(
      buildFindInboxV2MessageTransportFactCommitSql({
        tenantId,
        commitToken: commit.commitToken,
        observationId: observation.id
      })
    );

    expect(normalizeSql(durable.sql)).toContain(
      "provider_watermark_digest_sha256"
    );
    expect(durable.params).not.toContain("opaque-watermark");
    expect(durable.params).not.toContain("opaque-reader-set");
    expect(normalizeSql(opaque.sql)).toContain(
      "insert into inbox_v2_provider_receipt_opaque_payloads"
    );
    expect(opaque.params).toEqual(
      expect.arrayContaining(["opaque-watermark", "opaque-reader-set"])
    );
    expect(String(opaque.params[1])).toMatch(
      /^provider_receipt_opaque_payload:[a-f0-9]{64}$/u
    );
    expect(normalizeSql(ledgerInsert.sql)).toContain(
      "insert into inbox_v2_message_transport_fact_commits"
    );
    expect(normalizeSql(ledgerInsert.sql)).toContain("on conflict do nothing");
    expect(normalizeSql(ledgerInsert.sql)).toContain(
      "recorded_stream_position"
    );
    expect(normalizeSql(ledgerFind.sql)).toContain(
      "commit_row.commit_token = $2 or commit_row.observation_id = $3"
    );
    expect(normalizeSql(ledgerFind.sql)).toContain("for update of commit_row");
  });

  it("binds compact snapshots and keyset cursors to one Message without raw content", () => {
    const snapshotToken = encodeInboxV2AuxiliaryReadSnapshotToken({
      kind: "reactions",
      tenantId,
      ownerId: messageId,
      through: streamPosition,
      snapshotCreatedAt: now
    });
    expect(
      decodeInboxV2AuxiliaryReadSnapshotToken({
        token: snapshotToken,
        kind: "reactions",
        tenantId,
        ownerId: messageId
      })
    ).toEqual({
      kind: "reactions",
      through: streamPosition,
      snapshotCreatedAt: now
    });

    const cursor = encodeInboxV2AuxiliaryReadCursor({
      kind: "reactions",
      snapshotToken,
      after: ["message_reaction:db005-unit"]
    });
    expect(
      decodeInboxV2AuxiliaryReadCursor({
        cursor,
        kind: "reactions",
        snapshotToken,
        partCount: 1
      })
    ).toEqual(["message_reaction:db005-unit"]);
    expect(snapshotToken).not.toContain(tenantId);
    expect(snapshotToken).not.toContain(messageId);
    expect(cursor).not.toMatch(/messageText|body|caption|providerPayload/iu);
    expect(() =>
      decodeInboxV2AuxiliaryReadSnapshotToken({
        token: snapshotToken,
        kind: "transport_facts",
        tenantId,
        ownerId: messageId
      })
    ).toThrow(/invalid or out of scope/iu);
    expect(() =>
      decodeInboxV2AuxiliaryReadSnapshotToken({
        token: snapshotToken,
        kind: "reactions",
        tenantId: inboxV2TenantIdSchema.parse("tenant:other-db005-unit"),
        ownerId: messageId
      })
    ).toThrow(/invalid or out of scope/iu);
  });

  it("uses tenant-safe bounded keysets for all Message recovery reads", () => {
    const links = normalizeSql(
      renderQuery(
        buildListInboxV2MessageTransportLinksReadSql({
          tenantId,
          messageId,
          throughHeadRevision: inboxV2EntityRevisionSchema.parse("4"),
          afterHeadRevision: "1",
          limit: 20
        })
      ).sql
    );
    expect(links).toContain("tenant_id = $1");
    expect(links).toContain("message_id = $2");
    expect(links).toContain("resulting_head_revision > $3");
    expect(links).toContain("resulting_head_revision <= $4");
    expect(links).toContain("order by resulting_head_revision asc");

    const reactions = normalizeSql(
      renderQuery(
        buildListInboxV2MessageReactionsReadSql({
          tenantId,
          messageId,
          throughStreamPosition: "44",
          afterReactionId: "message_reaction:after",
          limit: 20
        })
      ).sql
    );
    expect(reactions).toContain("inner join lateral");
    expect(reactions).toContain("candidate.recorded_stream_position <= $1");
    expect(reactions).toContain("reaction_row.tenant_id = $2");
    expect(reactions).toContain("reaction_row.message_id = $3");
    expect(reactions).toContain('order by reaction_row.id collate "c" asc');

    const facts = normalizeSql(
      renderQuery(
        buildListInboxV2MessageTransportFactsReadSql({
          tenantId,
          messageId,
          throughStreamPosition: "45",
          after: {
            recordedAt: now,
            factKind: "delivery",
            observationId: "message_delivery_observation:after"
          },
          limit: 20
        })
      ).sql
    );
    expect(facts).toContain("from inbox_v2_message_transport_fact_commits");
    expect(facts).toContain("left join inbox_v2_message_delivery_observations");
    expect(facts).toContain("left join inbox_v2_provider_receipt_observations");
    expect(facts).toContain("commit_row.tenant_id =");
    expect(facts).toContain("commit_row.message_id =");
    expect(facts).toContain("commit_row.recorded_stream_position <=");
    expect(facts).toContain('commit_row.fact_kind::text collate "c" asc');

    const lifecycle = normalizeSql(
      renderQuery(
        buildListInboxV2ProviderLifecycleTransitionsReadSql({
          tenantId,
          operationId: "message_provider_lifecycle_operation:db005-unit",
          throughRevision: inboxV2EntityRevisionSchema.parse("5"),
          afterRevision: "2",
          limit: 20
        })
      ).sql
    );
    expect(lifecycle).toContain("tenant_id = $1");
    expect(lifecycle).toContain("operation_id = $2");
    expect(lifecycle).toContain("resulting_revision > $3");
    expect(lifecycle).toContain("resulting_revision <= $4");
    expect(lifecycle).toContain("order by resulting_revision asc");
  });

  it("reconstructs a frozen reaction with a queryable actor tombstone", () => {
    const capability = {
      kind: "external",
      capabilityId: "core:message-reaction",
      capabilityRevision: revision,
      cardinality: "multiple_values",
      adapterContract: adapterContract()
    } as const;
    const state = {
      kind: "active",
      value: { kind: "unicode", value: "👍" }
    } as const;
    const reactionId = "message_reaction:db005-purged";
    const projection = mapQueryableReactionReadRow(
      {
        reaction_row: {
          tenant_id: tenantId,
          id: reactionId,
          message_id: messageId,
          actor_kind: "unattributed_source_observation",
          actor_source_occurrence_id: "source_occurrence:db005-purged",
          actor_identity_state: "purged",
          actor_identity_data_class_id:
            "core:source_occurrence_and_external_reference",
          actor_identity_tombstone_event_id: "event:db005-purged",
          actor_identity_purged_at: now,
          capability_detail: capability,
          capability_detail_digest_sha256:
            computeInboxV2TimelineMessageCommitDigest(capability),
          semantic_slot_key: "v1:1:x",
          created_at: now
        },
        transition_row: {
          tenant_id: tenantId,
          reaction_id: reactionId,
          semantic_slot_key: "v1:1:x",
          resulting_revision: revision,
          after_state_kind: "active",
          after_state_detail: state,
          after_state_detail_digest_sha256:
            computeInboxV2TimelineMessageCommitDigest(state),
          recorded_at: now,
          recorded_stream_position: streamPosition
        }
      },
      { tenantId, messageId, throughStreamPosition: streamPosition }
    );

    expect(projection.projectionState).toBe("actor_identity_purged");
    if (projection.projectionState !== "actor_identity_purged") return;
    expect(projection.reaction.actor).toMatchObject({
      kind: "unattributed_source_observation",
      identity: {
        state: "purged",
        dataClassId: "core:source_occurrence_and_external_reference",
        tombstoneEvent: { id: "event:db005-purged" },
        purgedAt: now
      }
    });
    expect(JSON.stringify(projection)).not.toContain("opaqueActorKey");
  });

  it("maps a participant reaction without inventing a source occurrence", () => {
    const participant = {
      tenantId,
      kind: "conversation_participant" as const,
      id: "conversation_participant:db005-unit"
    };
    const actor = { kind: "participant" as const, participant };
    const capability = {
      kind: "internal" as const,
      cardinality: "multiple_values" as const
    };
    const state = {
      kind: "active" as const,
      value: { kind: "unicode" as const, value: "👍" }
    };
    const semanticSlotKey = inboxV2ReactionSemanticSlotKeyFor({
      message: { tenantId, kind: "message", id: messageId },
      actor,
      capability,
      state
    });
    const reactionId = "message_reaction:db005-participant";
    const projection = mapQueryableReactionReadRow(
      {
        reaction_row: {
          tenant_id: tenantId,
          id: reactionId,
          message_id: messageId,
          actor_kind: "participant",
          actor_participant_id: participant.id,
          actor_source_occurrence_id: null,
          capability_detail: capability,
          capability_detail_digest_sha256:
            computeInboxV2TimelineMessageCommitDigest(capability),
          semantic_slot_key: semanticSlotKey,
          created_at: now
        },
        transition_row: {
          tenant_id: tenantId,
          reaction_id: reactionId,
          semantic_slot_key: semanticSlotKey,
          resulting_revision: revision,
          after_state_kind: "active",
          after_state_detail: state,
          after_state_detail_digest_sha256:
            computeInboxV2TimelineMessageCommitDigest(state),
          recorded_at: now,
          recorded_stream_position: streamPosition
        }
      },
      { tenantId, messageId, throughStreamPosition: streamPosition }
    );

    expect(projection).toMatchObject({
      projectionState: "available",
      reaction: { actor, state, revision }
    });
  });

  it("maps one unified-ledger delivery through the public fact contract", () => {
    const commitDigest = "d".repeat(64);
    const delivery = {
      tenant_id: tenantId,
      id: "message_delivery_observation:db005-unit",
      message_id: messageId,
      fact: "accepted",
      scope_kind: "dispatch",
      scope_dispatch_id: "outbound_dispatch:db005-unit",
      scope_attempt_id: "outbound_dispatch_attempt:db005-unit",
      scope_artifact_id: null,
      scope_external_message_reference_id: null,
      scope_source_occurrence_id: null,
      scope_recipient_source_identity_id: null,
      source_account_id: "source_account:db005-unit",
      source_thread_binding_id: "source_thread_binding:db005-unit",
      binding_generation: revision,
      adapter_contract_id: adapterContract().contractId,
      adapter_contract_version: adapterContract().contractVersion,
      adapter_declaration_revision: revision,
      adapter_surface_id: adapterContract().surfaceId,
      adapter_loaded_by_trusted_service_id:
        adapterContract().loadedByTrustedServiceId,
      adapter_loaded_at: now,
      capability_id: "core:message-delivery",
      capability_revision: revision,
      evidence_kind: "provider_result",
      evidence_attempt_id: "outbound_dispatch_attempt:db005-unit",
      evidence_artifact_id: null,
      evidence_normalized_inbound_event_id: null,
      evidence_external_message_reference_id: null,
      evidence_source_occurrence_id: null,
      semantic_proof_detail: null,
      semantic_proof_digest_sha256: null,
      evidence_kind_id: "core:provider-result",
      evidence_digest_sha256: "e".repeat(64),
      failure_reason_id: null,
      commit_token: "transport-fact-db005-unit",
      commit_digest_sha256: commitDigest,
      observed_at: now,
      recorded_at: now,
      recorded_stream_position: streamPosition,
      revision
    };
    const projection = mapQueryableTransportFactReadRow(
      {
        tenant_id: tenantId,
        message_id: messageId,
        fact_kind: "delivery",
        observation_id: delivery.id,
        commit_token: delivery.commit_token,
        commit_digest_sha256: commitDigest,
        observed_at: now,
        recorded_at: now,
        recorded_stream_position: streamPosition,
        delivery_row: delivery,
        receipt_row: null,
        opaque_row: null
      },
      { tenantId, messageId, throughStreamPosition: streamPosition }
    );
    expect(projection).toMatchObject({
      projectionState: "available",
      fact: {
        kind: "delivery",
        observation: {
          id: delivery.id,
          fact: "accepted",
          message: { id: messageId }
        }
      }
    });
  });

  it("returns a digest-only receipt skeleton after classified opaque payload purge", () => {
    const commitDigest = "f".repeat(64);
    const aggregateDigest = "a".repeat(64);
    const semanticProof = providerReceiptSemanticProof();
    const receipt = {
      tenant_id: tenantId,
      id: "provider_receipt_observation:db005-purged",
      target_kind: "exact_message",
      target_message_id: messageId,
      target_external_message_reference_id:
        "external_message_reference:db005-purged",
      target_source_occurrence_id: "source_occurrence:db005-purged",
      provider_watermark_digest_sha256: null,
      read_through_provider_time: null,
      reader_kind: "aggregate_only",
      reader_source_external_identity_id: null,
      reader_aggregate_key_digest_sha256: aggregateDigest,
      opaque_payload_id: "provider_receipt_opaque_payload:db005-purged",
      opaque_data_class_id: "core:source_occurrence_and_external_reference",
      source_account_id: "source_account:db005-purged",
      source_thread_binding_id: "source_thread_binding:db005-purged",
      binding_generation: revision,
      adapter_contract_id: adapterContract().contractId,
      adapter_contract_version: adapterContract().contractVersion,
      adapter_declaration_revision: revision,
      adapter_surface_id: adapterContract().surfaceId,
      adapter_loaded_by_trusted_service_id:
        adapterContract().loadedByTrustedServiceId,
      adapter_loaded_at: now,
      capability_id: "core:message-read-receipt",
      capability_revision: revision,
      evidence_normalized_inbound_event_id:
        "normalized_inbound_event:db005-purged",
      semantic_proof_detail: semanticProof,
      semantic_proof_digest_sha256:
        computeInboxV2TimelineMessageCommitDigest(semanticProof),
      evidence_kind_id: "core:provider-read-receipt",
      evidence_digest_sha256: "b".repeat(64),
      commit_token: "receipt-purged-db005-unit",
      commit_digest_sha256: commitDigest,
      observed_at: now,
      recorded_at: now,
      recorded_stream_position: streamPosition,
      revision
    };
    const projection = mapQueryableTransportFactReadRow(
      {
        tenant_id: tenantId,
        message_id: messageId,
        fact_kind: "receipt",
        observation_id: receipt.id,
        commit_token: receipt.commit_token,
        commit_digest_sha256: commitDigest,
        observed_at: now,
        recorded_at: now,
        recorded_stream_position: streamPosition,
        delivery_row: null,
        receipt_row: receipt,
        opaque_row: null
      },
      { tenantId, messageId, throughStreamPosition: streamPosition }
    );

    expect(projection).toMatchObject({
      projectionState: "classified_payload_purged",
      fact: {
        kind: "receipt",
        observation: {
          id: receipt.id,
          reader: {
            kind: "aggregate_only",
            aggregateKey: {
              state: "purged",
              digestSha256: aggregateDigest,
              dataClassId: "core:source_occurrence_and_external_reference"
            }
          }
        }
      }
    });
    expect(JSON.stringify(projection)).not.toMatch(
      /opaque-reader|providerWatermark|aggregateKeyValue/iu
    );
    expect(() =>
      mapQueryableTransportFactReadRow(
        {
          tenant_id: tenantId,
          message_id: messageId,
          fact_kind: "receipt",
          observation_id: receipt.id,
          commit_token: receipt.commit_token,
          commit_digest_sha256: commitDigest,
          observed_at: now,
          recorded_at: now,
          recorded_stream_position: streamPosition,
          delivery_row: null,
          receipt_row: receipt,
          opaque_row: {
            tenant_id: tenantId,
            id: receipt.opaque_payload_id,
            receipt_observation_id: receipt.id,
            data_class_id: receipt.opaque_data_class_id,
            provider_watermark: null,
            reader_aggregate_key: "tampered-reader-key"
          }
        },
        { tenantId, messageId, throughStreamPosition: streamPosition }
      )
    ).toThrow(/digest mismatch/iu);
  });

  it("reconstructs current and revision-one provider lifecycle operations", () => {
    const operation = mapProviderLifecycleOperationReadRow(
      {
        tenant_id: tenantId,
        id: "message_provider_lifecycle_operation:db005-read",
        message_id: messageId,
        action: "edit",
        origin: "provider_observed",
        external_message_reference_id: "external_message_reference:db005-read",
        source_occurrence_id: "source_occurrence:db005-read",
        source_account_id: "source_account:db005-read",
        source_thread_binding_id: "source_thread_binding:db005-read",
        binding_generation: revision,
        outbound_route_id: null,
        adapter_contract_id: adapterContract().contractId,
        adapter_contract_version: adapterContract().contractVersion,
        adapter_declaration_revision: revision,
        adapter_surface_id: adapterContract().surfaceId,
        adapter_loaded_by_trusted_service_id:
          adapterContract().loadedByTrustedServiceId,
        adapter_loaded_at: now,
        capability_revision: revision,
        action_participant_id: null,
        app_actor_kind: null,
        app_actor_employee_id: null,
        app_authorization_epoch: null,
        app_trusted_service_id: null,
        automation_kind: null,
        automation_cause_event_id: null,
        automation_correlation_id: null,
        automation_caused_at: null,
        automation_initiating_employee_id: null,
        automation_initiating_authorization_epoch: null,
        initial_outcome: "observed",
        initial_outcome_retryable: null,
        initial_outcome_reason_id: null,
        initial_delete_local_effect: null,
        outcome: "observed",
        outcome_retryable: null,
        outcome_reason_id: null,
        delete_local_effect: null,
        revision,
        created_stream_position: streamPosition,
        last_changed_stream_position: streamPosition,
        occurred_at: now,
        recorded_at: now,
        created_at: now,
        updated_at: now
      },
      tenantId
    );
    expect(operation.operation).toMatchObject({
      id: "message_provider_lifecycle_operation:db005-read",
      origin: "provider_observed",
      outcome: { state: "observed" },
      revision
    });
    expect(operation.initialOperation).toEqual(operation.operation);
    expect(operation.createdStreamPosition).toBe(streamPosition);
  });

  it("computes stable canonical commit digests independent of object key order", () => {
    expect(
      computeInboxV2TimelineMessageCommitDigest({
        b: [2, 1],
        a: { y: true, x: "value" }
      })
    ).toBe(
      computeInboxV2TimelineMessageCommitDigest({
        a: { x: "value", y: true },
        b: [2, 1]
      })
    );
  });
});

function providerSemanticOrderingHead() {
  return inboxV2ProviderSemanticOrderingHeadSchema.parse({
    tenantId,
    semanticFamilyId: "core:message.lifecycle",
    externalMessageReference: {
      tenantId,
      kind: "external_message_reference",
      id: "external_message_reference:db005-ordering"
    },
    sourceAccount: {
      tenantId,
      kind: "source_account",
      id: "source_account:db005-ordering"
    },
    sourceThreadBinding: {
      tenantId,
      kind: "source_thread_binding",
      id: "source_thread_binding:db005-ordering"
    },
    bindingGeneration: revision,
    scopeToken: "ordering:db005-ordering",
    comparatorId: "core:provider-sequence",
    comparatorRevision: revision,
    position: "1",
    normalizedInboundEvent: {
      tenantId,
      kind: "normalized_inbound_event",
      id: "normalized_inbound_event:db005-ordering"
    },
    proofToken: "proof:db005-ordering",
    revision,
    updatedAt: now
  });
}

function adapterContract() {
  return {
    contractId: "module:test:adapter",
    contractVersion: "v1",
    declarationRevision: revision,
    surfaceId: "module:test:surface",
    loadedByTrustedServiceId: "core:source-runtime",
    loadedAt: now
  } as const;
}

function providerReceiptSemanticProof() {
  return {
    tenantId,
    normalizedInboundEvent: {
      tenantId,
      kind: "normalized_inbound_event",
      id: "normalized_inbound_event:db005-purged"
    },
    externalMessageReference: {
      tenantId,
      kind: "external_message_reference",
      id: "external_message_reference:db005-purged"
    },
    sourceOccurrence: {
      tenantId,
      kind: "source_occurrence",
      id: "source_occurrence:db005-purged"
    },
    sourceAccount: {
      tenantId,
      kind: "source_account",
      id: "source_account:db005-purged"
    },
    sourceThreadBinding: {
      tenantId,
      kind: "source_thread_binding",
      id: "source_thread_binding:db005-purged"
    },
    bindingGeneration: revision,
    adapterContract: adapterContract(),
    capabilityId: "core:message-read-receipt",
    capabilityRevision: revision,
    semanticId: "core:message.receipt.read",
    semanticRevision: revision,
    actor: null,
    ordering: {
      kind: "monotonic_exact",
      scopeToken: "ordering:db005-purged",
      position: "1",
      comparatorId: "core:provider-sequence",
      comparatorRevision: revision
    },
    declaredByTrustedServiceId: "core:source-runtime",
    proofToken: "proof:db005-purged",
    occurredAt: now,
    recordedAt: now,
    revision
  } as const;
}

function explicitRerouteMessageCreationCommit(): InboxV2MessageCreationCommit {
  const commit = inboxV2MessageCreationCommitSchema.parse(
    fixtureHuleeCreationCommit()
  );
  const route = commit.outboundRoute;
  if (route === null) throw new Error("External route fixture.");
  return inboxV2MessageCreationCommitSchema.parse({
    ...commit,
    outboundRoute: {
      ...route,
      selection: {
        ...route.selection,
        intent: {
          kind: "explicit_reroute",
          originalRoute: {
            tenantId: commit.tenantId,
            kind: "outbound_route",
            id: "outbound_route:message-reroute-original"
          },
          originalDispatch: {
            tenantId: commit.tenantId,
            kind: "outbound_dispatch",
            id: "outbound_dispatch:message-reroute-original"
          },
          expectedOriginalDispatchRevision: "1",
          replacementBinding: route.sourceThreadBinding,
          reasonId: "core:operator-reroute"
        },
        reason: "explicit_reroute"
      }
    }
  });
}

function messageCreationAuthorityContext(
  commit: InboxV2MessageCreationCommit
): Parameters<typeof assertInboxV2MessageCreationAuthority>[0] {
  const sourceOriginated = commit.message.origin.kind === "source_originated";
  const appActor = commit.message.appActor;
  const employeeId =
    appActor?.kind === "employee"
      ? appActor.employee.id
      : "employee:source-coordinator";
  const authorizationEpoch =
    appActor?.kind === "employee"
      ? appActor.authorizationEpoch
      : "authorization:source-coordinator";
  const authorizationDecisionId =
    "authorization-decision:message-creation-authority";
  const route = commit.outboundRoute;
  const conversationSnapshot = route?.conversationAuthorization;
  const conversationDecision = {
    tenantId: commit.tenantId,
    id: authorizationDecisionId,
    authorizationEpoch,
    principal: {
      kind: "employee" as const,
      employee: {
        tenantId: commit.tenantId,
        kind: "employee" as const,
        id: employeeId
      }
    },
    permissionId: sourceOriginated
      ? "core:message.receive_external"
      : commit.message.origin.kind === "hulee_external"
        ? "core:message.reply_external"
        : "core:message.send_internal",
    resourceScopeId: "core:conversation",
    resource: {
      tenantId: commit.tenantId,
      entityTypeId: "core:conversation",
      entityId: commit.message.conversation.id
    },
    resourceAccessRevision: "1",
    decisionRevision: conversationSnapshot?.decisionRevision ?? "1",
    decisionHash: "a".repeat(64),
    outcome: "allowed" as const,
    decidedAt: conversationSnapshot?.decidedAt ?? "2026-07-14T08:00:00.000Z",
    notAfter: conversationSnapshot?.notAfter ?? "2026-07-14T10:00:00.000Z"
  };
  const sourceAccountDecision =
    route === null
      ? null
      : {
          ...conversationDecision,
          id: "authorization-decision:message-source-account-authority",
          permissionId: "core:source_account.use",
          resourceScopeId: "core:source-account",
          resource: {
            tenantId: commit.tenantId,
            entityTypeId: "core:source-account",
            entityId: route.sourceAccount.id
          },
          decisionRevision: route.sourceAccountAuthorization.decisionRevision,
          decisionHash: "b".repeat(64),
          decidedAt: route.sourceAccountAuthorization.decidedAt,
          notAfter: route.sourceAccountAuthorization.notAfter
        };
  return {
    tenantId: commit.tenantId,
    commandTypeId: sourceOriginated
      ? "core:message.receive"
      : "core:message.send",
    actor: { kind: "employee", employeeId },
    authorizationEpoch,
    authorizationDecisionId,
    occurredAt: commit.timelineAllocation.committedAt,
    authorizationDecisionRefs: [
      conversationDecision,
      ...(sourceAccountDecision === null ? [] : [sourceAccountDecision])
    ],
    authorizationResourceRevisionFences: [
      {
        resourceKind: "conversation",
        resourceId: commit.message.conversation.id,
        resourceHeadId: "authorization-resource:message-conversation",
        expectedResourceAccessRevision: "1",
        advance: "none"
      },
      ...(route === null
        ? []
        : [
            {
              resourceKind: "source_account" as const,
              resourceId: route.sourceAccount.id,
              resourceHeadId: "authorization-resource:message-source-account",
              expectedResourceAccessRevision: "1",
              advance: "none" as const
            }
          ])
    ]
  } as unknown as Parameters<typeof assertInboxV2MessageCreationAuthority>[0];
}

function explicitRerouteMessageCreationAuthorityContext(
  commit: InboxV2MessageCreationCommit
): Parameters<typeof assertInboxV2MessageCreationAuthority>[0] {
  const context = messageCreationAuthorityContext(commit);
  const sourceDecision = context.authorizationDecisionRefs.find(
    ({ permissionId }) => permissionId === "core:source_account.use"
  );
  if (sourceDecision === undefined) {
    throw new Error("Explicit reroute requires a SourceAccount fixture.");
  }
  const rerouteDecision = {
    ...sourceDecision,
    id: "authorization-decision:message-reroute-authority",
    permissionId: "core:source.dispatch.reroute",
    decisionHash: "c".repeat(64)
  } as const;
  return {
    ...context,
    commandTypeId: "core:source.dispatch.reroute",
    authorizationDecisionId: rerouteDecision.id,
    authorizationDecisionRefs: [
      ...context.authorizationDecisionRefs,
      rerouteDecision
    ]
  } as Parameters<typeof assertInboxV2MessageCreationAuthority>[0];
}

function messageCreationSeamExecutor(
  commit: InboxV2MessageCreationCommit,
  statements: string[]
): RawSqlExecutor {
  const before = commit.timelineAllocation.conversationBefore.head;
  return {
    async execute<Row extends Record<string, unknown>>(
      query: SQL
    ): Promise<RawSqlQueryResult<Row>> {
      const statement = normalizeSql(renderQuery(query).sql);
      statements.push(statement);
      let rows: readonly Record<string, unknown>[];
      if (statement.includes("from inbox_v2_conversations c")) {
        rows = [
          {
            id: commit.message.conversation.id,
            revision: before.revision,
            latest_timeline_sequence: before.latestTimelineSequence,
            latest_activity_item_id: before.latestActivityItemId,
            latest_activity_timeline_sequence:
              before.latestActivityTimelineSequence,
            latest_activity_at: before.latestActivityAt,
            updated_at: before.updatedAt
          }
        ];
      } else if (statement.includes("from inbox_v2_messages message_row")) {
        rows = [];
      } else if (statement.includes("from inbox_v2_outbound_dispatches")) {
        rows = [];
      } else if (
        statement.includes("from inbox_v2_message_revisions revision_row")
      ) {
        rows = [];
      } else if (
        statement.includes("from inbox_v2_conversation_participants")
      ) {
        rows = [{ id: commit.authorParticipant.id }];
      } else {
        rows = [{ id: "inbox-v2-message-creation-write" }];
      }
      return { rows: rows as readonly Row[] };
    }
  };
}

function renderQuery(query: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query);
}

function normalizeSql(statement: string): string {
  return statement.replace(/\s+/gu, " ").trim().toLowerCase();
}
