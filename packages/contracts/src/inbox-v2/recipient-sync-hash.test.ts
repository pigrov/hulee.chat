import { describe, expect, it } from "vitest";

import {
  buildInboxV2RecipientInvalidateInstructionHashPreimage,
  buildInboxV2SnapshotManifestDefinitionHashPreimage,
  buildInboxV2SnapshotManifestHashPreimage,
  buildInboxV2SnapshotPageHashPreimage,
  calculateInboxV2CanonicalSha256,
  calculateInboxV2RecipientInvalidateInstructionHash,
  calculateInboxV2RecipientTombstoneStateHash,
  calculateInboxV2RecipientUpsertStateHash,
  calculateInboxV2SnapshotContextHash,
  calculateInboxV2SnapshotCumulativePageChainHash,
  calculateInboxV2SnapshotManifestDefinitionHash,
  calculateInboxV2SnapshotManifestHash,
  calculateInboxV2SnapshotPageHash,
  canonicalizeInboxV2Json,
  encodeInboxV2CanonicalJson,
  INBOX_V2_MAX_CANONICAL_HASH_PREIMAGE_BYTES,
  verifyInboxV2RecipientInvalidateInstructionHash,
  verifyInboxV2RecipientTombstoneStateHash,
  verifyInboxV2RecipientUpsertStateHash,
  verifyInboxV2SnapshotContextHash,
  verifyInboxV2SnapshotCumulativePageChainHash,
  verifyInboxV2SnapshotManifestDefinitionHash,
  verifyInboxV2SnapshotManifestHash,
  verifyInboxV2SnapshotPageHash
} from "./recipient-sync-hash";
import type {
  InboxV2RecipientInvalidateInstructionHashInput,
  InboxV2RecipientTombstoneStateHashInput,
  InboxV2RecipientUpsertStateHashInput,
  InboxV2SnapshotContextHashInput,
  InboxV2SnapshotManifestDefinitionHashInput,
  InboxV2SnapshotManifestHashInput,
  InboxV2SnapshotPageHashInput
} from "./recipient-sync-hash";

const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;
const digestC = `sha256:${"c".repeat(64)}`;
const stateProtection = {
  tenantId: "tenant:tenant-1",
  purpose: "recipient_state_integrity" as const,
  keyGeneration: "recipient-state-key:g1",
  key: new Uint8Array(32).fill(0x55)
};
const wrongStateProtection = {
  ...stateProtection,
  key: new Uint8Array(32).fill(0x56)
};

const entityHashBase = {
  projectionTypeId: "core:conversation-summary",
  entity: {
    tenantId: "tenant:tenant-1",
    entityTypeId: "core:conversation",
    entityId: "conversation:conversation-1"
  },
  revision: "3",
  lastChangedStreamPosition: "90",
  timeline: null,
  stateSchemaId: "core:conversation-summary",
  stateSchemaVersion: "v1"
} as const;

function upsertInput(): InboxV2RecipientUpsertStateHashInput<{
  kind: "conversation_summary";
  title: string;
  counters: { unread: number; mentions: number };
}> {
  return {
    ...entityHashBase,
    kind: "upsert",
    value: {
      kind: "conversation_summary",
      title: "Support",
      counters: { unread: 2, mentions: 1 }
    }
  };
}

function tombstoneInput(): InboxV2RecipientTombstoneStateHashInput {
  return {
    ...entityHashBase,
    kind: "tombstone",
    reasonId: "core:privacy-erased"
  };
}

function invalidateInput(): InboxV2RecipientInvalidateInstructionHashInput {
  return {
    ...entityHashBase,
    kind: "invalidate",
    stateHash: digestA,
    reasonId: "core:targeted-fetch-required",
    targetedFetchRequired: true
  };
}

function manifestDefinitionInput(): InboxV2SnapshotManifestDefinitionHashInput {
  return {
    recipientSyncSchemaVersion: "v2",
    completeness: "complete_for_scope",
    registrations: [
      {
        projectionTypeId: "core:conversation-summary",
        entityTypeId: "core:conversation",
        stateSchemaId: "core:conversation-summary",
        stateSchemaVersion: "v1",
        valueContextValidator: {
          semanticId: "core:recipient-value.no-tenant-references",
          fingerprint: digestA
        },
        authorizationRequirements: [
          {
            permissionId: "core:conversation.read",
            resourceScopeId: "core:conversation",
            resourceResolver: {
              semanticId: "core:recipient-resource.entity",
              fingerprint: digestB
            }
          }
        ]
      },
      {
        projectionTypeId: "core:message-summary",
        entityTypeId: "core:message",
        stateSchemaId: "core:message-summary",
        stateSchemaVersion: "v1",
        valueContextValidator: {
          semanticId: "core:recipient-value.message-context",
          fingerprint: digestB
        },
        authorizationRequirements: [
          {
            permissionId: "core:message.read",
            resourceScopeId: "core:message",
            resourceResolver: {
              semanticId: "core:recipient-resource.entity",
              fingerprint: digestB
            }
          },
          {
            permissionId: "core:conversation.read",
            resourceScopeId: "core:conversation",
            resourceResolver: {
              semanticId: "core:recipient-resource.timeline-conversation",
              fingerprint: digestA
            }
          }
        ]
      }
    ],
    indexScopeIds: ["core:employee-inbox", "core:assigned-inbox"]
  };
}

const conversationSnapshotEntity = {
  tenantId: "tenant:tenant-1",
  entityTypeId: "core:conversation",
  entityId: "conversation:conversation-1"
} as const;

const messageSnapshotEntity = {
  tenantId: "tenant:tenant-1",
  entityTypeId: "core:message",
  entityId: "message:message-9"
} as const;

function manifestInput(): InboxV2SnapshotManifestHashInput {
  const manifestDefinitionHash = calculateInboxV2SnapshotManifestDefinitionHash(
    manifestDefinitionInput()
  );
  return {
    manifestDefinitionHash,
    coverage: {
      entityCount: "2",
      pageCount: "1",
      finalEntity: messageSnapshotEntity,
      pageChainRootHash: digestC
    }
  };
}

function pageHashInput(): InboxV2SnapshotPageHashInput {
  return {
    frozenContext: {
      tenantId: "tenant:tenant-1",
      scopeId: "scope:employee-1",
      snapshotId: "snapshot:snapshot-1",
      streamEpoch: "stream:epoch-0001",
      syncGeneration: "2",
      authorizationEpoch: "authorization:epoch-0001",
      schemaVersion: "v2",
      snapshotCheckpoint: "110",
      snapshotIssuedAt: "2026-07-11T09:00:00.000Z",
      manifestDefinitionHash: calculateInboxV2SnapshotManifestDefinitionHash(
        manifestDefinitionInput()
      )
    },
    position: {
      ordinal: "1",
      afterExclusive: null,
      firstInclusive: conversationSnapshotEntity,
      throughInclusive: messageSnapshotEntity,
      entityCount: "2",
      previousPageHash: null,
      previousCumulativeEntityCount: "0",
      cumulativeEntityCount: "2",
      previousCumulativePageChainHash: null
    },
    entities: [
      {
        projectionTypeId: "core:conversation-summary",
        entity: conversationSnapshotEntity,
        revision: "3",
        stateHash: digestA
      },
      {
        projectionTypeId: "core:message-summary",
        entity: messageSnapshotEntity,
        revision: "7",
        stateHash: digestB
      }
    ]
  };
}

function emptyFirstPageHashInput(): InboxV2SnapshotPageHashInput {
  const input = pageHashInput();
  return {
    ...input,
    position: {
      ordinal: "1",
      afterExclusive: null,
      firstInclusive: null,
      throughInclusive: null,
      entityCount: "0",
      previousPageHash: null,
      previousCumulativeEntityCount: "0",
      cumulativeEntityCount: "0",
      previousCumulativePageChainHash: null
    },
    entities: []
  };
}

function authorizationSnapshot() {
  return {
    tenantId: "tenant:tenant-1",
    employee: {
      tenantId: "tenant:tenant-1",
      kind: "employee",
      id: "employee:employee-1"
    },
    value: "authorization:epoch-0001",
    dependencies: {
      tenantRbacRevision: "1",
      employeeAccessRevision: "2",
      employeeInboxRelationRevision: "3",
      sharedAccessRevision: "4",
      resourceDependencies: [],
      temporalBoundaryDigest: digestA
    },
    evaluatedAt: "2026-07-11T08:59:00.000Z",
    notAfter: "2026-07-11T10:00:00.000Z",
    nextAuthorizationBoundary: null
  } as const;
}

function resumeClaims() {
  return {
    tenantId: "tenant:tenant-1",
    employee: {
      tenantId: "tenant:tenant-1",
      kind: "employee",
      id: "employee:employee-1"
    },
    scopeId: "scope:employee-1",
    streamEpoch: "stream:epoch-0001",
    syncGeneration: "2",
    authorizationEpoch: "authorization:epoch-0001",
    schemaVersion: "v2",
    resumeMode: "delta",
    scannedThrough: "110",
    issuedAt: "2026-07-11T09:00:00.000Z",
    notAfter: "2026-07-11T10:00:00.000Z"
  } as const;
}

function snapshotContextInput(): InboxV2SnapshotContextHashInput<
  ReturnType<typeof authorizationSnapshot>,
  ReturnType<typeof resumeClaims>
> {
  const manifest = manifestInput();
  return {
    tenantId: "tenant:tenant-1",
    scope: {
      id: "scope:employee-1",
      kind: "employee_inbox",
      employee: {
        tenantId: "tenant:tenant-1",
        kind: "employee",
        id: "employee:employee-1"
      }
    },
    snapshotId: "snapshot:snapshot-1",
    streamEpoch: "stream:epoch-0001",
    syncGeneration: "2",
    authorization: authorizationSnapshot(),
    schemaVersion: "v2",
    snapshotCheckpoint: "110",
    manifestHash: calculateInboxV2SnapshotManifestHash(manifest),
    coverage: manifest.coverage,
    snapshotIssuedAt: "2026-07-11T09:00:00.000Z",
    resumeClaims: resumeClaims()
  };
}

describe("Inbox V2 recipient canonical hashes", () => {
  it("uses canonical UTF-8 JSON with a stable SHA-256 golden value", () => {
    const left = { b: 2, a: 1 };
    const right = Object.assign(
      Object.create(null) as Record<string, unknown>,
      {
        a: 1,
        b: 2
      }
    );

    expect(canonicalizeInboxV2Json(left)).toBe('{"a":1,"b":2}');
    expect(canonicalizeInboxV2Json(right)).toBe('{"a":1,"b":2}');
    expect(calculateInboxV2CanonicalSha256(left)).toBe(
      "sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777"
    );

    const astral = "\u{10000}";
    const privateUse = "\ue000";
    expect(canonicalizeInboxV2Json({ [privateUse]: 2, [astral]: 1 })).toBe(
      `{"${astral}":1,"${privateUse}":2}`
    );
    expect(canonicalizeInboxV2Json({ negativeZero: -0 })).toBe(
      '{"negativeZero":0}'
    );
  });

  it("fails closed for non-JSON, ambiguous Unicode and structural traps", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const sparse = new Array(2);
    sparse[1] = "present";
    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, "value", {
      enumerable: true,
      get: () => "side effect"
    });
    const hidden = { visible: true } as Record<string, unknown>;
    Object.defineProperty(hidden, "hidden", { value: true });

    for (const value of [
      undefined,
      1n,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      new Date(),
      cycle,
      sparse,
      accessor,
      hidden,
      "\ud800",
      { "\udc00": true }
    ]) {
      expect(() => canonicalizeInboxV2Json(value)).toThrow(TypeError);
    }
  });

  it("preflights escaped UTF-8 bytes and node counts before serialization", () => {
    const maximumEscapedNulCount = Math.floor(
      (INBOX_V2_MAX_CANONICAL_HASH_PREIMAGE_BYTES - 2) / 6
    );
    expect(
      encodeInboxV2CanonicalJson("\0".repeat(maximumEscapedNulCount)).byteLength
    ).toBe(INBOX_V2_MAX_CANONICAL_HASH_PREIMAGE_BYTES);
    expect(() =>
      canonicalizeInboxV2Json("\0".repeat(maximumEscapedNulCount + 1))
    ).toThrow("byte limit");
    expect(() => canonicalizeInboxV2Json("\0".repeat(2 * 1024 * 1024))).toThrow(
      "byte limit"
    );
    expect(() =>
      canonicalizeInboxV2Json(new Array(100_001).fill(null))
    ).toThrow("node limit");
  });

  it("binds upserts with a tenant lifecycle HMAC but not delivery metadata", () => {
    const upsert = upsertInput();
    const reordered = {
      ...upsert,
      value: {
        counters: { mentions: 1, unread: 2 },
        title: "Support",
        kind: "conversation_summary" as const
      }
    };
    const stateHash = calculateInboxV2RecipientUpsertStateHash(
      upsert,
      stateProtection
    );

    expect(
      calculateInboxV2RecipientUpsertStateHash(reordered, stateProtection)
    ).toBe(stateHash);
    expect(
      verifyInboxV2RecipientUpsertStateHash(
        { ...upsert, stateHash },
        stateProtection
      )
    ).toBe(true);
    expect(
      verifyInboxV2RecipientUpsertStateHash(
        {
          ...upsert,
          stateHash,
          value: { ...upsert.value, title: "Tampered" }
        },
        stateProtection
      )
    ).toBe(false);
    expect(
      verifyInboxV2RecipientUpsertStateHash(
        { ...upsert, stateHash },
        wrongStateProtection
      )
    ).toBe(false);

    const deliveryDecorated = {
      ...upsert,
      recipientOrdinal: "99",
      sourceChangeOrdinal: "42",
      authorizationDecisionRefs: [{ id: "authorization-decision:other" }]
    };
    expect(
      calculateInboxV2RecipientUpsertStateHash(
        deliveryDecorated,
        stateProtection
      )
    ).toBe(stateHash);
  });

  it("separates recipient fingerprints by tenant, key generation and lifecycle key", () => {
    const input = upsertInput();
    const baseline = calculateInboxV2RecipientUpsertStateHash(
      input,
      stateProtection
    );
    const rotated = calculateInboxV2RecipientUpsertStateHash(input, {
      ...stateProtection,
      keyGeneration: "recipient-state-key:g2"
    });
    const otherTenantInput = {
      ...input,
      entity: { ...input.entity, tenantId: "tenant:tenant-2" }
    };
    const otherTenant = calculateInboxV2RecipientUpsertStateHash(
      otherTenantInput,
      {
        ...stateProtection,
        tenantId: "tenant:tenant-2",
        key: new Uint8Array(32).fill(0x57)
      }
    );
    expect(rotated).not.toBe(baseline);
    expect(otherTenant).not.toBe(baseline);
    expect(JSON.stringify({ fingerprint: baseline })).not.toContain("555555");
    expect(() =>
      calculateInboxV2RecipientUpsertStateHash(input, {
        ...stateProtection,
        key: new Uint8Array(31)
      })
    ).toThrow("32..128-byte");
    expect(() =>
      calculateInboxV2RecipientUpsertStateHash(input, {
        ...stateProtection,
        tenantId: "tenant:tenant-2"
      })
    ).toThrow("matching tenant");
    expect(() =>
      calculateInboxV2RecipientUpsertStateHash(input, {
        ...stateProtection,
        purpose: "invalid-purpose"
      } as never)
    ).toThrow("purpose");
  });

  it("domain-separates tombstones and verifies all tombstone semantics", () => {
    const tombstone = tombstoneInput();
    const stateHash = calculateInboxV2RecipientTombstoneStateHash(tombstone);

    expect(stateHash).not.toBe(
      calculateInboxV2RecipientUpsertStateHash(upsertInput(), stateProtection)
    );
    expect(
      verifyInboxV2RecipientTombstoneStateHash({ ...tombstone, stateHash })
    ).toBe(true);
    expect(
      verifyInboxV2RecipientTombstoneStateHash({
        ...tombstone,
        stateHash,
        reasonId: "core:different-reason"
      })
    ).toBe(false);
  });

  it("binds invalidate instructions to their expected actual state", () => {
    const invalidate = invalidateInput();
    const invalidationHash =
      calculateInboxV2RecipientInvalidateInstructionHash(invalidate);

    expect(
      buildInboxV2RecipientInvalidateInstructionHashPreimage(invalidate)
        .targetStateHash
    ).toBe(digestA);
    expect(
      verifyInboxV2RecipientInvalidateInstructionHash({
        ...invalidate,
        invalidationHash
      })
    ).toBe(true);
    expect(
      verifyInboxV2RecipientInvalidateInstructionHash({
        ...invalidate,
        stateHash: digestB,
        invalidationHash
      })
    ).toBe(false);
    expect(
      verifyInboxV2RecipientInvalidateInstructionHash({
        ...invalidate,
        reasonId: "core:changed-reason",
        invalidationHash
      })
    ).toBe(false);
  });

  it("normalizes manifest arrays and binds validator and resolver semantics", () => {
    const manifest = manifestInput();
    const definition = manifestDefinitionInput();
    const definitionHash =
      calculateInboxV2SnapshotManifestDefinitionHash(definition);
    const hash = calculateInboxV2SnapshotManifestHash(manifest);
    const reversedDefinition = {
      ...definition,
      registrations: [...definition.registrations]
        .reverse()
        .map((registration) => ({
          ...registration,
          authorizationRequirements: [
            ...registration.authorizationRequirements
          ].reverse()
        })),
      indexScopeIds: [...definition.indexScopeIds].reverse()
    };
    const reversedDefinitionHash =
      calculateInboxV2SnapshotManifestDefinitionHash(reversedDefinition);

    expect(reversedDefinitionHash).toBe(definitionHash);
    expect(
      calculateInboxV2SnapshotManifestHash({
        ...manifest,
        manifestDefinitionHash: reversedDefinitionHash
      })
    ).toBe(hash);
    expect(
      buildInboxV2SnapshotManifestDefinitionHashPreimage(
        reversedDefinition
      ).registrations.map((registration) => registration.projectionTypeId)
    ).toEqual(["core:conversation-summary", "core:message-summary"]);
    expect(
      verifyInboxV2SnapshotManifestDefinitionHash({
        ...definition,
        manifestDefinitionHash: definitionHash
      })
    ).toBe(true);
    expect(
      verifyInboxV2SnapshotManifestHash({ ...manifest, manifestHash: hash })
    ).toBe(true);
    expect(
      buildInboxV2SnapshotManifestHashPreimage(manifest).manifestDefinitionHash
    ).toBe(definitionHash);
    expect(buildInboxV2SnapshotManifestHashPreimage(manifest).coverage).toEqual(
      manifest.coverage
    );
    expect(
      calculateInboxV2SnapshotManifestHash({
        ...manifest,
        coverage: { ...manifest.coverage, entityCount: "3" }
      })
    ).not.toBe(hash);

    const changedValidator = {
      ...definition,
      registrations: definition.registrations.map((registration, index) =>
        index === 0
          ? {
              ...registration,
              valueContextValidator: {
                ...registration.valueContextValidator,
                fingerprint: digestB
              }
            }
          : registration
      )
    };
    const changedValidatorDefinitionHash =
      calculateInboxV2SnapshotManifestDefinitionHash(changedValidator);
    expect(changedValidatorDefinitionHash).not.toBe(definitionHash);
    expect(
      verifyInboxV2SnapshotManifestDefinitionHash({
        ...changedValidator,
        manifestDefinitionHash: definitionHash
      })
    ).toBe(false);
    expect(
      verifyInboxV2SnapshotManifestHash({
        ...manifest,
        manifestDefinitionHash: changedValidatorDefinitionHash,
        manifestHash: hash
      })
    ).toBe(false);
    expect(
      calculateInboxV2SnapshotManifestHash({
        ...manifest,
        manifestDefinitionHash: changedValidatorDefinitionHash
      })
    ).not.toBe(hash);

    const changedResolver = {
      ...definition,
      registrations: definition.registrations.map((registration, index) =>
        index === 1
          ? {
              ...registration,
              authorizationRequirements:
                registration.authorizationRequirements.map(
                  (requirement, requirementIndex) =>
                    requirementIndex === 0
                      ? {
                          ...requirement,
                          resourceResolver: {
                            ...requirement.resourceResolver,
                            semanticId: "core:recipient-resource.changed"
                          }
                        }
                      : requirement
                )
            }
          : registration
      )
    };
    const changedResolverDefinitionHash =
      calculateInboxV2SnapshotManifestDefinitionHash(changedResolver);
    expect(changedResolverDefinitionHash).not.toBe(definitionHash);
    expect(
      calculateInboxV2SnapshotManifestHash({
        ...manifest,
        manifestDefinitionHash: changedResolverDefinitionHash
      })
    ).not.toBe(hash);
  });

  it("rejects duplicate manifest identities instead of hashing stable-sort order", () => {
    const definition = manifestDefinitionInput();
    const registration = definition.registrations[0]!;
    const duplicateRegistration = {
      ...definition,
      registrations: [
        registration,
        {
          ...registration,
          valueContextValidator: {
            ...registration.valueContextValidator,
            fingerprint: digestB
          }
        }
      ]
    };
    expect(() =>
      calculateInboxV2SnapshotManifestDefinitionHash(duplicateRegistration)
    ).toThrow("registration identities must be unique");
    expect(
      verifyInboxV2SnapshotManifestDefinitionHash({
        ...duplicateRegistration,
        manifestDefinitionHash: digestA
      })
    ).toBe(false);

    const duplicateRequirement = {
      ...definition,
      registrations: [
        {
          ...registration,
          authorizationRequirements: [
            registration.authorizationRequirements[0]!,
            {
              ...registration.authorizationRequirements[0]!,
              resourceResolver: {
                ...registration.authorizationRequirements[0]!.resourceResolver,
                fingerprint: digestA
              }
            }
          ]
        }
      ]
    };
    expect(() =>
      calculateInboxV2SnapshotManifestDefinitionHash(duplicateRequirement)
    ).toThrow("authorization requirements must be unique");
  });

  it("binds each page to its frozen definition, full range and entity order", () => {
    const page = pageHashInput();
    const pageHash = calculateInboxV2SnapshotPageHash(page);

    expect(verifyInboxV2SnapshotPageHash({ ...page, pageHash })).toBe(true);
    expect(buildInboxV2SnapshotPageHashPreimage(page).entities).toHaveLength(2);

    for (const changed of [
      {
        ...page,
        frozenContext: {
          ...page.frozenContext,
          snapshotCheckpoint: "111"
        }
      },
      {
        ...page,
        frozenContext: {
          ...page.frozenContext,
          manifestDefinitionHash: digestC
        }
      },
      {
        ...page,
        position: { ...page.position, ordinal: "2" }
      },
      {
        ...page,
        position: {
          ...page.position,
          throughInclusive: conversationSnapshotEntity
        }
      },
      {
        ...page,
        position: {
          ...page.position,
          previousCumulativeEntityCount: "1"
        }
      },
      {
        ...page,
        position: { ...page.position, previousPageHash: digestA }
      },
      {
        ...page,
        entities: [...page.entities].reverse()
      },
      {
        ...page,
        entities: page.entities.map((entity, index) =>
          index === 1 ? { ...entity, revision: "8" } : entity
        )
      },
      {
        ...page,
        entities: page.entities.map((entity, index) =>
          index === 1 ? { ...entity, stateHash: digestC } : entity
        )
      }
    ]) {
      expect(verifyInboxV2SnapshotPageHash({ ...changed, pageHash })).toBe(
        false
      );
    }
  });

  it("chains page hashes through the previous root and cumulative count", () => {
    const pageHash = calculateInboxV2SnapshotPageHash(pageHashInput());
    const chain = {
      previousCumulativePageChainHash: null,
      pageHash,
      cumulativeEntityCount: "2"
    } as const;
    const cumulativePageChainHash =
      calculateInboxV2SnapshotCumulativePageChainHash(chain);

    expect(
      verifyInboxV2SnapshotCumulativePageChainHash({
        ...chain,
        cumulativePageChainHash
      })
    ).toBe(true);
    for (const changed of [
      { ...chain, previousCumulativePageChainHash: digestA },
      { ...chain, pageHash: digestB },
      { ...chain, cumulativeEntityCount: "3" }
    ]) {
      expect(
        verifyInboxV2SnapshotCumulativePageChainHash({
          ...changed,
          cumulativePageChainHash
        })
      ).toBe(false);
    }
  });

  it("binds final snapshot context to authorization, resume and coverage", () => {
    const snapshot = snapshotContextInput();
    const snapshotContextHash = calculateInboxV2SnapshotContextHash(snapshot);
    expect(
      verifyInboxV2SnapshotContextHash({
        ...snapshot,
        snapshotContextHash
      })
    ).toBe(true);

    for (const changed of [
      { ...snapshot, snapshotIssuedAt: "2026-07-11T09:00:01.000Z" },
      { ...snapshot, manifestHash: digestA },
      {
        ...snapshot,
        coverage: { ...snapshot.coverage, pageChainRootHash: digestA }
      },
      {
        ...snapshot,
        authorization: {
          ...snapshot.authorization,
          dependencies: {
            ...snapshot.authorization.dependencies,
            employeeAccessRevision: "9"
          }
        }
      },
      {
        ...snapshot,
        resumeClaims: { ...snapshot.resumeClaims, scannedThrough: "109" }
      }
    ]) {
      expect(
        verifyInboxV2SnapshotContextHash({
          ...changed,
          snapshotContextHash
        })
      ).toBe(false);
    }
  });

  it("produces a non-circular authoritative root for an empty first page", () => {
    const page = emptyFirstPageHashInput();
    const pageHash = calculateInboxV2SnapshotPageHash(page);
    const cumulativePageChainHash =
      calculateInboxV2SnapshotCumulativePageChainHash({
        previousCumulativePageChainHash: null,
        pageHash,
        cumulativeEntityCount: "0"
      });
    const definition = manifestDefinitionInput();
    const manifest = {
      manifestDefinitionHash:
        calculateInboxV2SnapshotManifestDefinitionHash(definition),
      coverage: {
        entityCount: "0",
        pageCount: "1",
        finalEntity: null,
        pageChainRootHash: cumulativePageChainHash
      }
    } as const;

    expect(page.position).toMatchObject({
      ordinal: "1",
      firstInclusive: null,
      throughInclusive: null,
      previousPageHash: null,
      previousCumulativePageChainHash: null,
      cumulativeEntityCount: "0"
    });
    expect(calculateInboxV2SnapshotManifestHash(manifest)).toMatch(
      /^sha256:[a-f0-9]{64}$/u
    );
    expect(cumulativePageChainHash).not.toBe(digestA);
  });
});
