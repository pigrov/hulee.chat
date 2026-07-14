import { describe, expect, it } from "vitest";

import {
  INBOX_V2_EXTERNAL_THREAD_ALIAS_COMMIT_MAX,
  INBOX_V2_EXTERNAL_THREAD_RESOLUTION_SCHEMA_ID,
  INBOX_V2_EXTERNAL_THREAD_SCHEMA_ID,
  INBOX_V2_EXTERNAL_THREAD_SCHEMA_VERSION,
  inboxV2ExternalThreadAliasCommitSchema,
  inboxV2ExternalThreadAliasSchema,
  inboxV2ExternalThreadEnvelopeSchema,
  inboxV2ExternalThreadKeySchema,
  inboxV2ExternalThreadMappingSchema,
  inboxV2ExternalThreadResolutionEnvelopeSchema,
  inboxV2ExternalThreadResolutionSchema,
  inboxV2ExternalThreadSchema
} from "./external-thread";

const tenantId = "tenant:alpha";
const otherTenantId = "tenant:beta";
const sourceConnection = {
  tenantId,
  kind: "source_connection" as const,
  id: "source_connection:synthetic-primary"
};
const sourceAccount = {
  tenantId,
  kind: "source_account" as const,
  id: "source_account:synthetic-operator-a"
};
const secondSourceAccount = {
  tenantId,
  kind: "source_account" as const,
  id: "source_account:synthetic-operator-b"
};
const adapterContract = {
  contractId: "module:synthetic:thread-contract",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "module:synthetic:group-surface",
  loadedByTrustedServiceId: "core:routing-resolver",
  loadedAt: "2026-07-11T08:00:00.000Z"
};
const accountDeclaration = declarationFor("source_account", "safe_default");
const authoritativeAccountDeclaration = declarationFor(
  "source_account",
  "authoritative"
);
const providerDeclaration = declarationFor("provider", "authoritative");
const accountKey = keyFor({
  scope: { kind: "source_account" as const, owner: sourceAccount },
  subject: "Room:Case-Sensitive-ABC"
});
const conversation = {
  tenantId,
  id: "conversation:synthetic-group",
  topology: "group" as const,
  transport: "external" as const,
  purposeId: "core:chat",
  lifecycle: "active" as const,
  head: {
    latestTimelineSequence: "0",
    latestActivityItemId: null,
    latestActivityTimelineSequence: null,
    latestActivityAt: null,
    revision: "1",
    createdAt: "2026-07-11T08:00:00.000Z",
    updatedAt: "2026-07-11T08:00:00.000Z"
  },
  revision: "1",
  createdAt: "2026-07-11T08:00:00.000Z",
  updatedAt: "2026-07-11T08:00:00.000Z"
};
const conversationReference = {
  tenantId,
  kind: "conversation" as const,
  id: conversation.id
};
const thread = {
  tenantId,
  id: "external_thread:synthetic-group",
  key: accountKey,
  identityDeclaration: accountDeclaration,
  conversation: conversationReference,
  conversationTopology: "group" as const,
  revision: "1",
  createdAt: "2026-07-11T08:00:00.000Z",
  updatedAt: "2026-07-11T08:00:00.000Z"
};
const mapping = { tenantId, thread, conversation };
const aliasKey = keyFor({
  scope: { kind: "source_account" as const, owner: sourceAccount },
  subject: "Room:Legacy-ABC"
});
const aliasDecision = {
  actor: {
    kind: "trusted_service" as const,
    trustedServiceId: "core:routing-resolver"
  },
  policyId: "core:authoritative-thread-migration",
  policyVersion: "v1",
  reasonCodeId: "core:provider-room-upgrade",
  authoritativeEvidenceToken: "evidence.thread-alias-1",
  decidedAt: "2026-07-11T08:10:00.000Z"
};
const alias = {
  tenantId,
  id: "external_thread_alias:legacy-room",
  aliasKey,
  aliasIdentityDeclaration: authoritativeAccountDeclaration,
  canonicalThread: {
    tenantId,
    kind: "external_thread" as const,
    id: thread.id
  },
  canonicalConversation: conversationReference,
  canonicalKeySnapshot: accountKey,
  expectedCanonicalThreadRevision: "1",
  decision: aliasDecision,
  revision: "1",
  createdAt: "2026-07-11T08:10:00.000Z"
};

describe("Inbox V2 external thread contracts", () => {
  it("accepts a safe account-scoped exact thread and external mapping", () => {
    expect(inboxV2ExternalThreadSchema.safeParse(thread).success).toBe(true);
    expect(inboxV2ExternalThreadMappingSchema.safeParse(mapping).success).toBe(
      true
    );
  });

  it("preserves opaque subjects exactly and treats casing as identity", () => {
    const parsed = inboxV2ExternalThreadKeySchema.parse({
      ...accountKey,
      canonicalExternalSubject: " Room:ABC "
    });
    expect(parsed.canonicalExternalSubject).toBe(" Room:ABC ");

    expect(
      inboxV2ExternalThreadResolutionSchema.safeParse(
        makeResolution({
          resolution: "matched_canonical",
          requestedKey: {
            ...accountKey,
            canonicalExternalSubject: "room:case-sensitive-abc"
          }
        })
      ).success
    ).toBe(false);
  });

  it("rejects non-scalar opaque subjects before provider or database encoding", () => {
    expect(
      inboxV2ExternalThreadKeySchema.safeParse({
        ...accountKey,
        canonicalExternalSubject: "room😀"
      }).success
    ).toBe(true);
    expect(
      inboxV2ExternalThreadKeySchema.safeParse({
        ...accountKey,
        canonicalExternalSubject: String.fromCharCode(0xd800)
      }).success
    ).toBe(false);
  });

  it("keeps equal private subjects separate across SourceAccounts", () => {
    const secondKey = keyFor({
      scope: { kind: "source_account", owner: secondSourceAccount },
      subject: accountKey.canonicalExternalSubject
    });
    expect(inboxV2ExternalThreadKeySchema.safeParse(secondKey).success).toBe(
      true
    );
    expect(secondKey).not.toEqual(accountKey);
    expect(
      inboxV2ExternalThreadResolutionSchema.safeParse(
        makeResolution({
          resolution: "matched_canonical",
          requestedKey: secondKey
        })
      ).success
    ).toBe(false);
  });

  it("permits provider-wide scope only through authoritative pinned declaration", () => {
    const providerKey = keyFor({
      scope: { kind: "provider" },
      subject: "ProviderGroup:shared"
    });
    expect(
      inboxV2ExternalThreadSchema.safeParse({
        ...thread,
        key: providerKey,
        identityDeclaration: providerDeclaration
      }).success
    ).toBe(true);
    expect(
      inboxV2ExternalThreadSchema.safeParse({
        ...thread,
        key: providerKey,
        identityDeclaration: {
          ...providerDeclaration,
          decisionStrength: "safe_default"
        }
      }).success
    ).toBe(false);
  });

  it("restricts safe-default uncertainty to exact SourceAccount scope", () => {
    const connectionDeclaration = declarationFor(
      "source_connection",
      "authoritative"
    );
    const connectionKey = keyFor({
      scope: { kind: "source_connection", owner: sourceConnection },
      subject: "ConnectionRoom:1"
    });
    expect(
      inboxV2ExternalThreadSchema.safeParse({
        ...thread,
        key: connectionKey,
        identityDeclaration: connectionDeclaration
      }).success
    ).toBe(true);
    expect(
      inboxV2ExternalThreadSchema.safeParse({
        ...thread,
        key: connectionKey,
        identityDeclaration: {
          ...connectionDeclaration,
          decisionStrength: "safe_default"
        }
      }).success
    ).toBe(false);
  });

  it("requires exact declaration realm, canonicalization, object kind and scope", () => {
    for (const identityDeclaration of [
      { ...accountDeclaration, identityKind: "message" },
      { ...accountDeclaration, realmId: "module:synthetic:wrong-realm" },
      { ...accountDeclaration, realmVersion: "v2" },
      { ...accountDeclaration, canonicalizationVersion: "v2" },
      { ...accountDeclaration, objectKindId: "module:synthetic:wrong-kind" },
      { ...accountDeclaration, scopeKind: "provider" }
    ]) {
      expect(
        inboxV2ExternalThreadSchema.safeParse({
          ...thread,
          identityDeclaration
        }).success
      ).toBe(false);
    }
  });

  it("rejects cross-tenant scope and Conversation references", () => {
    for (const value of [
      {
        ...thread,
        key: {
          ...accountKey,
          scope: {
            kind: "source_account",
            owner: { ...sourceAccount, tenantId: otherTenantId }
          }
        }
      },
      {
        ...thread,
        conversation: { ...conversationReference, tenantId: otherTenantId }
      }
    ]) {
      expect(inboxV2ExternalThreadSchema.safeParse(value).success).toBe(false);
    }
  });

  it("rejects internal, wrong-topology and wrong-Conversation mappings", () => {
    for (const value of [
      {
        ...mapping,
        conversation: { ...conversation, transport: "internal" }
      },
      {
        ...mapping,
        conversation: { ...conversation, topology: "direct" }
      },
      {
        ...mapping,
        conversation: {
          ...conversation,
          id: "conversation:different"
        }
      }
    ]) {
      expect(inboxV2ExternalThreadMappingSchema.safeParse(value).success).toBe(
        false
      );
    }
  });

  it("keeps the exact mapping immutable", () => {
    expect(
      inboxV2ExternalThreadSchema.safeParse({ ...thread, revision: "2" })
        .success
    ).toBe(false);
    expect(
      inboxV2ExternalThreadSchema.safeParse({
        ...thread,
        updatedAt: "2026-07-11T08:01:00.000Z"
      }).success
    ).toBe(false);
  });

  it("strictly excludes Client, sender, display and routing guesses", () => {
    for (const [field, value] of [
      ["clientId", "client:guess"],
      ["senderId", "source_external_identity:guess"],
      ["title", "Same title"],
      ["phone", "+10000000000"],
      ["username", "guess"],
      ["firstAccountId", sourceAccount.id],
      ["route", { destination: "guess" }]
    ] as const) {
      expect(
        inboxV2ExternalThreadSchema.safeParse({ ...thread, [field]: value })
          .success
      ).toBe(false);
    }
  });

  it("accepts an immutable authoritative direct alias", () => {
    expect(inboxV2ExternalThreadAliasSchema.safeParse(alias).success).toBe(
      true
    );
  });

  it("pins alias and resolution decisions to the exact declaration loader", () => {
    expect(
      inboxV2ExternalThreadAliasSchema.safeParse({
        ...alias,
        decision: {
          ...aliasDecision,
          actor: {
            kind: "trusted_service",
            trustedServiceId: "core:foreign-thread-resolver"
          }
        }
      }).success
    ).toBe(false);

    for (const resolution of [
      makeResolution({ resolution: "created" }),
      makeResolution({ resolution: "matched_canonical" }),
      makeResolution({
        resolution: "matched_alias",
        requestedKey: aliasKey,
        requestIdentityDeclaration: authoritativeAccountDeclaration,
        matchedAlias: alias,
        resolvedAt: "2026-07-11T08:10:00.000Z"
      })
    ]) {
      expect(
        inboxV2ExternalThreadResolutionSchema.safeParse({
          ...resolution,
          resolvedByTrustedServiceId: "core:foreign-thread-resolver"
        }).success
      ).toBe(false);
    }
  });

  it("rejects alias self-mapping, weak evidence and alias-to-alias targets", () => {
    expect(
      inboxV2ExternalThreadAliasSchema.safeParse({
        ...alias,
        aliasKey: accountKey
      }).success
    ).toBe(false);
    expect(
      inboxV2ExternalThreadAliasSchema.safeParse({
        ...alias,
        aliasIdentityDeclaration: accountDeclaration
      }).success
    ).toBe(false);
    expect(
      inboxV2ExternalThreadAliasSchema.safeParse({
        ...alias,
        canonicalThread: {
          tenantId,
          kind: "external_thread_alias",
          id: "external_thread_alias:another"
        }
      }).success
    ).toBe(false);
  });

  it("rejects mutable or timestamp-incoherent aliases", () => {
    expect(
      inboxV2ExternalThreadAliasSchema.safeParse({ ...alias, revision: "2" })
        .success
    ).toBe(false);
    expect(
      inboxV2ExternalThreadAliasSchema.safeParse({
        ...alias,
        createdAt: "2026-07-11T08:11:00.000Z"
      }).success
    ).toBe(false);
  });

  it("binds bounded aliases to one exact canonical snapshot under CAS", () => {
    const commit = {
      tenantId,
      canonicalThreadSnapshot: thread,
      expectedCanonicalThreadRevision: "1",
      currentCanonicalThreadRevision: "1",
      aliases: [alias],
      committedAt: "2026-07-11T08:10:00.000Z"
    };
    expect(
      inboxV2ExternalThreadAliasCommitSchema.safeParse(commit).success
    ).toBe(true);
    expect(
      inboxV2ExternalThreadAliasCommitSchema.safeParse({
        ...commit,
        currentCanonicalThreadRevision: "2"
      }).success
    ).toBe(false);
    expect(
      inboxV2ExternalThreadAliasCommitSchema.safeParse({
        ...commit,
        aliases: [alias, alias]
      }).success
    ).toBe(false);
  });

  it("rejects alias commit target/key/Conversation/time mismatches", () => {
    const baseCommit = {
      tenantId,
      canonicalThreadSnapshot: thread,
      expectedCanonicalThreadRevision: "1",
      currentCanonicalThreadRevision: "1",
      aliases: [alias],
      committedAt: "2026-07-11T08:10:00.000Z"
    };
    for (const changedAlias of [
      {
        ...alias,
        canonicalThread: {
          ...alias.canonicalThread,
          id: "external_thread:different"
        }
      },
      {
        ...alias,
        canonicalConversation: {
          ...conversationReference,
          id: "conversation:different"
        }
      },
      {
        ...alias,
        canonicalKeySnapshot: {
          ...accountKey,
          canonicalExternalSubject: "Room:different"
        }
      },
      { ...alias, createdAt: "2026-07-11T08:11:00.000Z" }
    ]) {
      expect(
        inboxV2ExternalThreadAliasCommitSchema.safeParse({
          ...baseCommit,
          aliases: [changedAlias]
        }).success
      ).toBe(false);
    }
  });

  it("bounds alias commits instead of exposing a lifetime graph", () => {
    const aliases = Array.from(
      { length: INBOX_V2_EXTERNAL_THREAD_ALIAS_COMMIT_MAX + 1 },
      (_, index) => ({
        ...alias,
        id: `external_thread_alias:bounded-${index}`,
        aliasKey: {
          ...aliasKey,
          canonicalExternalSubject: `Room:Legacy-${index}`
        }
      })
    );
    expect(
      inboxV2ExternalThreadAliasCommitSchema.safeParse({
        tenantId,
        canonicalThreadSnapshot: thread,
        expectedCanonicalThreadRevision: "1",
        currentCanonicalThreadRevision: "1",
        aliases,
        committedAt: "2026-07-11T08:10:00.000Z"
      }).success
    ).toBe(false);
  });

  it("resolves created/canonical keys exactly and aliases directly", () => {
    expect(
      inboxV2ExternalThreadResolutionSchema.safeParse(
        makeResolution({ resolution: "created" })
      ).success
    ).toBe(true);
    expect(
      inboxV2ExternalThreadResolutionSchema.safeParse(
        makeResolution({ resolution: "matched_canonical" })
      ).success
    ).toBe(true);
    expect(
      inboxV2ExternalThreadResolutionSchema.safeParse(
        makeResolution({
          resolution: "matched_alias",
          requestedKey: aliasKey,
          requestIdentityDeclaration: authoritativeAccountDeclaration,
          matchedAlias: alias,
          resolvedAt: "2026-07-11T08:10:00.000Z"
        })
      ).success
    ).toBe(true);
  });

  it("rejects an alias resolution that targets another canonical mapping", () => {
    expect(
      inboxV2ExternalThreadResolutionSchema.safeParse(
        makeResolution({
          resolution: "matched_alias",
          requestedKey: aliasKey,
          requestIdentityDeclaration: authoritativeAccountDeclaration,
          matchedAlias: {
            ...alias,
            canonicalThread: {
              ...alias.canonicalThread,
              id: "external_thread:different"
            }
          },
          resolvedAt: "2026-07-11T08:10:00.000Z"
        })
      ).success
    ).toBe(false);
  });

  it("rejects alias commits and resolutions before their canonical evidence exists", () => {
    expect(
      inboxV2ExternalThreadAliasCommitSchema.safeParse({
        tenantId,
        canonicalThreadSnapshot: thread,
        expectedCanonicalThreadRevision: "1",
        currentCanonicalThreadRevision: "1",
        aliases: [
          {
            ...alias,
            decision: {
              ...aliasDecision,
              decidedAt: "2026-07-11T07:59:00.000Z"
            },
            createdAt: "2026-07-11T07:59:00.000Z"
          }
        ],
        committedAt: "2026-07-11T07:59:00.000Z"
      }).success
    ).toBe(false);
    expect(
      inboxV2ExternalThreadResolutionSchema.safeParse(
        makeResolution({
          resolution: "matched_alias",
          requestedKey: aliasKey,
          requestIdentityDeclaration: authoritativeAccountDeclaration,
          matchedAlias: alias,
          resolvedAt: "2026-07-11T08:09:59.000Z"
        })
      ).success
    ).toBe(false);
  });

  it("rejects caller-provided existing Conversation, Client and routing hints", () => {
    for (const [field, value] of [
      ["existingConversationId", "conversation:caller-choice"],
      ["clientId", "client:caller-choice"],
      ["senderId", "source_external_identity:caller-choice"],
      ["routeHint", sourceAccount.id]
    ] as const) {
      expect(
        inboxV2ExternalThreadResolutionSchema.safeParse({
          ...makeResolution({ resolution: "matched_canonical" }),
          [field]: value
        }).success
      ).toBe(false);
    }
  });

  it("uses exact strict versioned envelopes", () => {
    expect(
      inboxV2ExternalThreadEnvelopeSchema.safeParse({
        schemaId: INBOX_V2_EXTERNAL_THREAD_SCHEMA_ID,
        schemaVersion: INBOX_V2_EXTERNAL_THREAD_SCHEMA_VERSION,
        payload: thread
      }).success
    ).toBe(true);
    expect(
      inboxV2ExternalThreadResolutionEnvelopeSchema.safeParse({
        schemaId: INBOX_V2_EXTERNAL_THREAD_RESOLUTION_SCHEMA_ID,
        schemaVersion: INBOX_V2_EXTERNAL_THREAD_SCHEMA_VERSION,
        payload: makeResolution({ resolution: "matched_canonical" })
      }).success
    ).toBe(true);
    expect(
      inboxV2ExternalThreadEnvelopeSchema.safeParse({
        schemaId: INBOX_V2_EXTERNAL_THREAD_SCHEMA_ID,
        schemaVersion: "v2",
        payload: thread
      }).success
    ).toBe(false);
  });
});

function declarationFor(
  scopeKind: "provider" | "source_connection" | "source_account",
  decisionStrength: "authoritative" | "safe_default"
) {
  return {
    adapterContract,
    identityKind: "external_thread" as const,
    realmId: "module:synthetic:thread-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic:group-room",
    scopeKind,
    decisionStrength
  };
}

function keyFor(input: {
  scope:
    | { kind: "provider" }
    | { kind: "source_connection"; owner: typeof sourceConnection }
    | { kind: "source_account"; owner: typeof sourceAccount };
  subject: string;
}) {
  return {
    realm: {
      realmId: "module:synthetic:thread-realm",
      realmVersion: "v1",
      canonicalizationVersion: "v1"
    },
    scope: input.scope,
    objectKindId: "module:synthetic:group-room",
    canonicalExternalSubject: input.subject
  };
}

function makeResolution(input: {
  resolution: "created" | "matched_canonical" | "matched_alias";
  requestedKey?: ReturnType<typeof keyFor>;
  requestIdentityDeclaration?: ReturnType<typeof declarationFor>;
  matchedAlias?: typeof alias;
  resolvedAt?: string;
}) {
  return {
    tenantId,
    requestedKey: input.requestedKey ?? accountKey,
    requestIdentityDeclaration:
      input.requestIdentityDeclaration ?? accountDeclaration,
    mapping,
    resolution: input.resolution,
    matchedAlias:
      input.resolution === "matched_alias"
        ? (input.matchedAlias ?? alias)
        : null,
    resolvedByTrustedServiceId: "core:routing-resolver",
    resolutionToken: "resolution.thread-1",
    resolvedAt: input.resolvedAt ?? "2026-07-11T08:00:00.000Z"
  };
}
