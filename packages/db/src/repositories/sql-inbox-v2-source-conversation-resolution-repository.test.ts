import {
  inboxV2BigintCounterSchema,
  inboxV2ExternalThreadMappingSchema,
  inboxV2SourceConversationMaterializationPlanSchema,
  inboxV2SourceNormalizedEventForIdentityResolutionSchema,
  inboxV2SourceThreadBindingCurrentProjectionSchema,
  type InboxV2ExternalThreadKey,
  type InboxV2ExternalThreadMapping,
  type InboxV2SourceConversationMaterializationPlan,
  type InboxV2SourceNormalizedEventForIdentityResolution,
  type InboxV2SourceThreadBindingCurrentProjection
} from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { computeInboxV2SourceThreadBindingRouteDescriptorDigest } from "./sql-inbox-v2-source-thread-binding-repository";
import {
  buildFindInboxV2SourceConversationAccountIdentitySql,
  createSqlInboxV2SourceConversationResolutionRepository,
  type InboxV2SourceConversationResolutionTransactionExecutor
} from "./sql-inbox-v2-source-conversation-resolution-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const tenantId = "tenant:src005";
const loadedAt = "2026-07-17T08:00:00.000Z";
const recordedAt = "2026-07-17T08:01:00.000Z";
const verifiedAt = "2026-07-17T08:01:30.000Z";
const materializedAt = "2026-07-17T08:02:00.000Z";
const sourceConnection = {
  tenantId,
  kind: "source_connection" as const,
  id: "source_connection:src005"
};
const adapterContract = {
  contractId: "module:synthetic-source:src005",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "module:synthetic-source:direct-messenger",
  loadedByTrustedServiceId: "core:source-runtime",
  loadedAt
};

describe("SQL Inbox V2 source Conversation resolution repository", () => {
  it("builds one exact tenant/account identity lookup", () => {
    const rendered = renderQuery(
      buildFindInboxV2SourceConversationAccountIdentitySql({
        tenantId,
        sourceAccountId: "source_account:one"
      })
    );
    expect(normalizeSql(rendered.sql)).toContain(
      "from public.inbox_v2_source_account_identities"
    );
    expect(normalizeSql(rendered.sql)).toContain(
      "where tenant_id = $1 and source_account_id = $2"
    );
    expect(rendered.params).toEqual([tenantId, "source_account:one"]);
  });

  it("fails closed on a rejected or throwing plan authorization before transaction", async () => {
    const plan = directPlan("unauthorized");
    for (const verify of [
      () => false,
      () => {
        throw new Error("invalid signature");
      }
    ]) {
      const executor = new ResolutionExecutor([plan]);
      const repository = createSqlInboxV2SourceConversationResolutionRepository(
        executor,
        {
          planAuthorizationVerifier: { verify }
        }
      );
      await expect(
        repository.resolve({ plan, streamPosition: position("40") })
      ).rejects.toMatchObject({ code: "permission.denied" });
      expect(executor.transactionConfigs).toHaveLength(0);
    }
  });

  it("creates thread, Conversation and conservative account-local binding in one transaction", async () => {
    const plan = directPlan("one");
    const executor = new ResolutionExecutor([plan]);
    let candidateMapping: InboxV2ExternalThreadMapping | null = null;
    let candidateBinding: InboxV2SourceThreadBindingCurrentProjection | null =
      null;
    const repository = createSqlInboxV2SourceConversationResolutionRepository(
      executor,
      {
        planAuthorizationVerifier: allowPlan,
        dependencies: {
          readNormalizedEvent: async (transaction) => {
            expect(transaction).toBe(executor);
            return eventFromPlan(plan);
          },
          findExternalThread: async (transaction) => {
            expect(transaction).toBe(executor);
            return { kind: "not_found" };
          },
          resolveExternalThread: async (transaction, input) => {
            expect(transaction).toBe(executor);
            expect(input.streamPosition).toBe("41");
            candidateMapping = input.mapping;
            return { kind: "created", mapping: input.mapping };
          },
          findBinding: async (transaction, input, options) => {
            expect(transaction).toBe(executor);
            expect(input).toEqual({
              tenantId,
              externalThreadId: plan.candidateExternalThreadId,
              sourceAccountId: plan.source.sourceAccount.id
            });
            expect(options).toEqual({ lock: true });
            return null;
          },
          resolveBinding: async (transaction, commit) => {
            expect(transaction).toBe(executor);
            candidateBinding = commit.initialProjection;
            expect(commit.sourceAccountIdentity.state).toBe("verified");
            return { kind: "created", projection: commit.initialProjection };
          }
        }
      }
    );

    const result = await repository.resolve({
      plan,
      streamPosition: position("41")
    });

    expect(result).toMatchObject({
      outcome: "resolved",
      threadResolution: "created",
      bindingResolution: "created",
      externalThreadMapping: {
        thread: {
          id: plan.candidateExternalThreadId,
          key: plan.source.thread.key
        },
        conversation: {
          id: plan.candidateConversationId,
          topology: "direct",
          transport: "external",
          purposeId: "core:chat"
        }
      },
      sourceThreadBinding: {
        binding: {
          id: plan.candidateSourceThreadBindingId,
          remoteAccess: { state: "observed" },
          administrative: { state: "disabled" },
          runtimeHealth: { state: "unknown" },
          historySync: {
            state: "not_started",
            receiveCursor: null,
            historyCursor: null,
            providerWatermark: null
          },
          providerAccess: { roleIds: [] }
        }
      }
    });
    expect(candidateMapping).not.toBeNull();
    expect(candidateBinding).not.toBeNull();
    expect(executor.transactionConfigs).toEqual([
      { isolationLevel: "read committed" }
    ]);
    expect(executor.committed).toBe(1);
    expect(executor.rolledBack).toBe(0);
  });

  it("replays a canonical mapping and evolved binding without candidate writes", async () => {
    const plan = directPlan("replay");
    const executor = new ResolutionExecutor([plan]);
    const first = materializedFixture(plan);
    const evolvedBinding = {
      ...first.binding,
      binding: {
        ...first.binding.binding,
        revision: "2" as never,
        updatedAt: "2026-07-17T08:03:00.000Z",
        routeDescriptor: {
          ...first.binding.binding.routeDescriptor,
          descriptorRevision: "2" as never,
          destinationSubject: "Route:Evolved",
          descriptorDigestSha256: "c".repeat(64)
        }
      }
    };
    let writes = 0;
    const repository = createSqlInboxV2SourceConversationResolutionRepository(
      executor,
      {
        planAuthorizationVerifier: allowPlan,
        dependencies: {
          readNormalizedEvent: async () => eventFromPlan(plan),
          findExternalThread: async () => ({
            kind: "found",
            reservationKind: "canonical",
            mapping: first.mapping,
            matchedAlias: null
          }),
          resolveExternalThread: async () => {
            writes += 1;
            throw new Error("unexpected mapping write");
          },
          findBinding: async () => evolvedBinding,
          resolveBinding: async () => {
            writes += 1;
            throw new Error("unexpected binding write");
          }
        }
      }
    );

    const result = await repository.resolve({
      plan,
      streamPosition: position("42")
    });

    expect(result).toMatchObject({
      outcome: "resolved",
      threadResolution: "matched_canonical",
      bindingResolution: "already_exists",
      sourceThreadBinding: { binding: { revision: "2" } },
      resolvedAt: "2026-07-17T08:03:00.000Z"
    });
    expect(writes).toBe(0);
  });

  it("replays an immutable revision-1 route across stable adapter metadata and attribute order", async () => {
    const initial = withRouteSnapshot(directPlan("stable-route"), {
      attributes: [
        { attributeId: "module:synthetic-source:z", value: "z-value" },
        { attributeId: "module:synthetic-source:a", value: "a-value" }
      ]
    });
    const fixture = materializedFixture(initial);
    const plan = withRouteSnapshot(initial, {
      adapterContract: {
        ...initial.source.adapterContract,
        declarationRevision: "9",
        loadedByTrustedServiceId: "core:source-runtime-v2",
        loadedAt: "2026-07-17T08:00:30.000Z"
      } as InboxV2SourceConversationMaterializationPlan["source"]["adapterContract"],
      attributes: [...initial.routeDescriptor.attributes].reverse()
    });
    const executor = new ResolutionExecutor([plan]);
    let writes = 0;
    const dependencies = {
      readNormalizedEvent: async () => eventFromPlan(plan),
      reserveExternalThreadKey: async () => reservedMapping(fixture.mapping),
      acquireBindingTarget: async () => undefined,
      findExternalThread: async () => ({
        kind: "found" as const,
        reservationKind: "canonical" as const,
        mapping: fixture.mapping,
        matchedAlias: null
      }),
      resolveExternalThread: async () => {
        writes += 1;
        throw new Error("unexpected mapping write");
      },
      findBinding: async () => fixture.binding,
      resolveBinding: async () => {
        writes += 1;
        throw new Error("unexpected binding write");
      }
    };
    const repository = createSqlInboxV2SourceConversationResolutionRepository(
      executor,
      { planAuthorizationVerifier: allowPlan, dependencies }
    );

    const result = await repository.resolve({
      plan,
      streamPosition: position("42")
    });

    expect(result).toMatchObject({
      outcome: "resolved",
      threadResolution: "matched_canonical",
      bindingResolution: "already_exists",
      sourceThreadBinding: {
        binding: {
          revision: "1",
          routeDescriptor: initial.routeDescriptor
        }
      }
    });
    expect(writes).toBe(0);

    const changedAttributeBinding = structuredClone(fixture.binding);
    changedAttributeBinding.binding.routeDescriptor.attributes[0]!.value =
      "different-value";
    const conflictRepository =
      createSqlInboxV2SourceConversationResolutionRepository(executor, {
        planAuthorizationVerifier: allowPlan,
        dependencies: {
          ...dependencies,
          findBinding: async () => changedAttributeBinding
        }
      });
    await expect(
      conflictRepository.resolve({ plan, streamPosition: position("42") })
    ).resolves.toMatchObject({
      outcome: "conflict",
      conflictCode: "source.conversation_resolution.binding_conflict"
    });
  });

  it("linearizes existing-binding replay against the current verified account authority", async () => {
    const plan = directPlan("identity-linearization");
    const executor = new ResolutionExecutor([plan]);
    const fixture = materializedFixture(plan);
    const repository = createSqlInboxV2SourceConversationResolutionRepository(
      executor,
      {
        planAuthorizationVerifier: allowPlan,
        dependencies: {
          readNormalizedEvent: async () => eventFromPlan(plan),
          reserveExternalThreadKey: async () => {
            executor.resolutionOrder.push("key");
            return reservedMapping(fixture.mapping);
          },
          acquireBindingTarget: async () => {
            executor.resolutionOrder.push("target");
          },
          findExternalThread: async () => {
            executor.resolutionOrder.push("mapping");
            return {
              kind: "found",
              reservationKind: "canonical",
              mapping: fixture.mapping,
              matchedAlias: null
            };
          },
          resolveExternalThread: async () => {
            throw new Error("unexpected mapping write");
          },
          findBinding: async () => {
            executor.resolutionOrder.push("binding");
            const current = executor.identities.get(
              plan.source.sourceAccount.id
            );
            if (current === undefined)
              throw new Error("missing fixture identity");
            executor.identities.set(plan.source.sourceAccount.id, {
              ...current,
              state: "conflicted"
            });
            return fixture.binding;
          },
          resolveBinding: async () => {
            throw new Error("unexpected binding write");
          }
        }
      }
    );

    await expect(
      repository.resolve({ plan, streamPosition: position("42") })
    ).resolves.toMatchObject({
      outcome: "conflict",
      conflictCode: "source.conversation_resolution.account_identity_conflict"
    });
    expect(executor.identityStatements).toHaveLength(2);
    expect(executor.identityStatements[0]).not.toContain("for share");
    expect(executor.identityStatements[1]).toContain("for share");
    expect(executor.resolutionOrder).toEqual([
      "identity",
      "key",
      "target",
      "binding",
      "identity"
    ]);
  });

  it("rejects an unchanged revision-1 route after an unrelated binding transition", async () => {
    const plan = directPlan("route-race");
    const executor = new ResolutionExecutor([plan]);
    const fixture = materializedFixture(plan);
    const conflictingBinding = {
      ...fixture.binding,
      binding: {
        ...fixture.binding.binding,
        revision: "2" as never,
        updatedAt: "2026-07-17T08:03:00.000Z",
        routeDescriptor: {
          ...fixture.binding.binding.routeDescriptor,
          destinationSubject: "Route:Concurrent-Conflict",
          descriptorDigestSha256: "d".repeat(64)
        }
      }
    };
    const repository = createSqlInboxV2SourceConversationResolutionRepository(
      executor,
      {
        planAuthorizationVerifier: allowPlan,
        dependencies: {
          readNormalizedEvent: async () => eventFromPlan(plan),
          findExternalThread: async () => ({
            kind: "found",
            reservationKind: "canonical",
            mapping: fixture.mapping,
            matchedAlias: null
          }),
          resolveExternalThread: async () => {
            throw new Error("unexpected mapping write");
          },
          findBinding: async () => conflictingBinding,
          resolveBinding: async () => {
            throw new Error("unexpected binding write");
          }
        }
      }
    );

    await expect(
      repository.resolve({ plan, streamPosition: position("42") })
    ).resolves.toMatchObject({
      outcome: "conflict",
      conflictCode: "source.conversation_resolution.binding_conflict"
    });
  });

  it("classifies canonical topology and adapter-surface conflicts before binding lookup", async () => {
    const plan = directPlan("mapping-conflict");
    const fixture = materializedFixture(plan);
    const cases = [
      {
        expected: "source.conversation_resolution.topology_conflict" as const,
        mapping: inboxV2ExternalThreadMappingSchema.parse({
          ...fixture.mapping,
          thread: {
            ...fixture.mapping.thread,
            conversationTopology: "group" as const
          },
          conversation: {
            ...fixture.mapping.conversation,
            topology: "group" as const
          }
        })
      },
      {
        expected:
          "source.conversation_resolution.adapter_surface_conflict" as const,
        mapping: inboxV2ExternalThreadMappingSchema.parse({
          ...fixture.mapping,
          thread: {
            ...fixture.mapping.thread,
            identityDeclaration: {
              ...fixture.mapping.thread.identityDeclaration,
              adapterContract: {
                ...fixture.mapping.thread.identityDeclaration.adapterContract,
                surfaceId: "module:synthetic-source:other-surface"
              }
            }
          }
        })
      }
    ];

    for (const candidate of cases) {
      const executor = new ResolutionExecutor([plan]);
      let bindingReads = 0;
      const repository = createSqlInboxV2SourceConversationResolutionRepository(
        executor,
        {
          planAuthorizationVerifier: allowPlan,
          dependencies: {
            readNormalizedEvent: async () => eventFromPlan(plan),
            findExternalThread: async () => ({
              kind: "found",
              reservationKind: "canonical",
              mapping: candidate.mapping,
              matchedAlias: null
            }),
            findBinding: async () => {
              bindingReads += 1;
              return null;
            }
          }
        }
      );
      await expect(
        repository.resolve({ plan, streamPosition: position("42") })
      ).resolves.toMatchObject({
        outcome: "conflict",
        conflictCode: candidate.expected
      });
      expect(bindingReads).toBe(1);
    }
  });

  it("rejects provisional and conflicted account authorities before mapping", async () => {
    const plan = directPlan("account-state");
    for (const [state, expectedCode] of [
      [
        "provisional",
        "source.conversation_resolution.account_identity_not_verified"
      ],
      ["conflicted", "source.conversation_resolution.account_identity_conflict"]
    ] as const) {
      const executor = new ResolutionExecutor([plan]);
      const current = executor.identities.get(plan.source.sourceAccount.id);
      if (current === undefined) throw new Error("missing fixture identity");
      executor.identities.set(plan.source.sourceAccount.id, {
        ...current,
        state
      });
      let mappingReads = 0;
      const repository = createSqlInboxV2SourceConversationResolutionRepository(
        executor,
        {
          planAuthorizationVerifier: allowPlan,
          dependencies: {
            readNormalizedEvent: async () => eventFromPlan(plan),
            findBinding: async () => null,
            findExternalThread: async () => {
              mappingReads += 1;
              return { kind: "not_found" };
            }
          }
        }
      );
      await expect(
        repository.resolve({ plan, streamPosition: position("42") })
      ).resolves.toMatchObject({
        outcome: "conflict",
        conflictCode: expectedCode
      });
      expect(mappingReads).toBe(0);
    }
  });

  it("shares a provider group mapping across accounts but creates one binding per account", async () => {
    const firstPlan = groupPlan("group-account-1", "group-shared");
    const secondPlan = groupPlan("group-account-2", "group-shared");
    const executor = new ResolutionExecutor([firstPlan, secondPlan]);
    const state = new InMemoryResolutionState();
    const repository = createSqlInboxV2SourceConversationResolutionRepository(
      executor,
      {
        planAuthorizationVerifier: allowPlan,
        dependencies: state.dependencies(
          new Map([
            [
              firstPlan.source.normalizedInboundEvent.id,
              eventFromPlan(firstPlan)
            ],
            [
              secondPlan.source.normalizedInboundEvent.id,
              eventFromPlan(secondPlan)
            ]
          ])
        )
      }
    );

    const first = await repository.resolve({
      plan: firstPlan,
      streamPosition: position("43")
    });
    const second = await repository.resolve({
      plan: secondPlan,
      streamPosition: position("44")
    });

    expect(first).toMatchObject({
      outcome: "resolved",
      threadResolution: "created",
      bindingResolution: "created"
    });
    expect(second).toMatchObject({
      outcome: "resolved",
      threadResolution: "matched_canonical",
      bindingResolution: "created"
    });
    if (first.outcome !== "resolved" || second.outcome !== "resolved") {
      throw new Error("Expected both group plans to resolve.");
    }
    expect(second.externalThreadMapping.thread.id).toBe(
      first.externalThreadMapping.thread.id
    );
    expect(second.sourceThreadBinding.binding.id).not.toBe(
      first.sourceThreadBinding.binding.id
    );
    expect(state.mappingCount).toBe(1);
    expect(state.bindingCount).toBe(2);
  });

  it("keeps account-scoped private chats separate across accounts", async () => {
    const firstPlan = directPlan("private-account-1", "Private:Peer");
    const secondPlan = directPlan("private-account-2", "Private:Peer");
    const executor = new ResolutionExecutor([firstPlan, secondPlan]);
    const state = new InMemoryResolutionState();
    const events = new Map([
      [firstPlan.source.normalizedInboundEvent.id, eventFromPlan(firstPlan)],
      [secondPlan.source.normalizedInboundEvent.id, eventFromPlan(secondPlan)]
    ]);
    const repository = createSqlInboxV2SourceConversationResolutionRepository(
      executor,
      {
        planAuthorizationVerifier: allowPlan,
        dependencies: state.dependencies(events)
      }
    );

    const first = await repository.resolve({
      plan: firstPlan,
      streamPosition: position("45")
    });
    const second = await repository.resolve({
      plan: secondPlan,
      streamPosition: position("46")
    });

    expect(first).toMatchObject({
      outcome: "resolved",
      threadResolution: "created"
    });
    expect(second).toMatchObject({
      outcome: "resolved",
      threadResolution: "created"
    });
    if (first.outcome !== "resolved" || second.outcome !== "resolved") {
      throw new Error("Expected both private plans to resolve.");
    }
    expect(second.externalThreadMapping.thread.id).not.toBe(
      first.externalThreadMapping.thread.id
    );
    expect(state.mappingCount).toBe(2);
    expect(state.bindingCount).toBe(2);
  });

  it("rolls back a newly created mapping when binding materialization conflicts", async () => {
    const plan = directPlan("rollback");
    const executor = new ResolutionExecutor([plan]);
    const repository = createSqlInboxV2SourceConversationResolutionRepository(
      executor,
      {
        planAuthorizationVerifier: allowPlan,
        dependencies: {
          readNormalizedEvent: async () => eventFromPlan(plan),
          findExternalThread: async () => ({ kind: "not_found" }),
          resolveExternalThread: async (_transaction, input) => ({
            kind: "created",
            mapping: input.mapping
          }),
          findBinding: async () => null,
          resolveBinding: async () => ({
            kind: "source_account_identity_conflict"
          })
        }
      }
    );

    const result = await repository.resolve({
      plan,
      streamPosition: position("47")
    });

    expect(result).toMatchObject({
      outcome: "conflict",
      conflictCode: "source.conversation_resolution.account_identity_conflict"
    });
    expect(executor.committed).toBe(0);
    expect(executor.rolledBack).toBe(1);
  });

  it("rejects caller projection drift before any mapping/binding write", async () => {
    const plan = directPlan("projection-conflict");
    const executor = new ResolutionExecutor([plan]);
    let writes = 0;
    const drifted = {
      ...eventFromPlan(plan),
      safeEnvelopeHmacSha256: `hmac-sha256:${"f".repeat(64)}`
    };
    const repository = createSqlInboxV2SourceConversationResolutionRepository(
      executor,
      {
        planAuthorizationVerifier: allowPlan,
        dependencies: {
          readNormalizedEvent: async () => drifted,
          findExternalThread: async () => {
            writes += 1;
            return { kind: "not_found" };
          },
          resolveExternalThread: async () => {
            writes += 1;
            throw new Error("unexpected mapping write");
          },
          findBinding: async () => {
            writes += 1;
            return null;
          },
          resolveBinding: async () => {
            writes += 1;
            throw new Error("unexpected binding write");
          }
        }
      }
    );

    await expect(
      repository.resolve({ plan, streamPosition: position("48") })
    ).resolves.toMatchObject({
      outcome: "conflict",
      conflictCode: "source.conversation_resolution.source_projection_conflict"
    });
    expect(writes).toBe(0);
  });

  it("retries only serialization/deadlock SQLSTATEs and preserves the caller stream position", async () => {
    const plan = directPlan("retry");
    const executor = new ResolutionExecutor([plan], ["40001", "40P01"]);
    let seenPosition: string | null = null;
    const repository = createSqlInboxV2SourceConversationResolutionRepository(
      executor,
      {
        planAuthorizationVerifier: allowPlan,
        dependencies: {
          readNormalizedEvent: async () => eventFromPlan(plan),
          findExternalThread: async () => ({ kind: "not_found" }),
          resolveExternalThread: async (_transaction, input) => {
            seenPosition = input.streamPosition;
            return { kind: "created", mapping: input.mapping };
          },
          findBinding: async () => null,
          resolveBinding: async (_transaction, commit) => ({
            kind: "created",
            projection: commit.initialProjection
          })
        }
      }
    );

    await expect(
      repository.resolve({ plan, streamPosition: position("49") })
    ).resolves.toMatchObject({ outcome: "resolved" });
    expect(executor.transactionConfigs).toHaveLength(3);
    expect(seenPosition).toBe("49");

    const permanent = new ResolutionExecutor([plan], ["23505"]);
    const permanentRepository =
      createSqlInboxV2SourceConversationResolutionRepository(permanent, {
        planAuthorizationVerifier: allowPlan
      });
    await expect(
      permanentRepository.resolve({ plan, streamPosition: position("50") })
    ).rejects.toMatchObject({ code: "23505" });
    expect(permanent.transactionConfigs).toHaveLength(1);
  });

  it("rejects a zero/fake tenant-stream position before opening a transaction", async () => {
    const plan = directPlan("zero-position");
    const executor = new ResolutionExecutor([plan]);
    const repository = createSqlInboxV2SourceConversationResolutionRepository(
      executor,
      { planAuthorizationVerifier: allowPlan }
    );

    await expect(
      repository.resolve({ plan, streamPosition: "0" as never })
    ).rejects.toThrow(/positive tenant-stream position/iu);
    expect(executor.transactionConfigs).toHaveLength(0);
  });
});

class ResolutionExecutor implements InboxV2SourceConversationResolutionTransactionExecutor {
  readonly transactionConfigs: Array<{
    isolationLevel: "read committed";
  }> = [];
  readonly identities = new Map<string, Record<string, unknown>>();
  readonly identityStatements: string[] = [];
  readonly resolutionOrder: string[] = [];
  committed = 0;
  rolledBack = 0;

  constructor(
    plans: readonly InboxV2SourceConversationMaterializationPlan[],
    private readonly transactionErrors: string[] = []
  ) {
    for (const plan of plans) {
      this.identities.set(plan.source.sourceAccount.id, identityRow(plan));
    }
  }

  async transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult> {
    this.transactionConfigs.push(config);
    const code = this.transactionErrors.shift();
    if (code !== undefined) throw Object.assign(new Error(code), { code });
    try {
      const result = await work(this);
      this.committed += 1;
      return result;
    } catch (error) {
      this.rolledBack += 1;
      throw error;
    }
  }

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    const rendered = renderQuery(query);
    const statement = normalizeSql(rendered.sql);
    if (statement.includes("pg_advisory_xact_lock")) {
      return rows<Row>([]);
    }
    if (statement.includes("inbox_v2_external_thread_key_registry")) {
      return rows<Row>([]);
    }
    if (statement.includes("inbox_v2_source_account_identities")) {
      this.resolutionOrder.push("identity");
      this.identityStatements.push(statement);
      const sourceAccountId = String(rendered.params.at(-1));
      const row = this.identities.get(sourceAccountId);
      return rows<Row>(row === undefined ? [] : [row]);
    }
    throw new Error(`Unexpected SQL in resolution executor: ${statement}`);
  }
}

class InMemoryResolutionState {
  private readonly mappings = new Map<string, InboxV2ExternalThreadMapping>();
  private readonly bindings = new Map<
    string,
    InboxV2SourceThreadBindingCurrentProjection
  >();

  get mappingCount(): number {
    return this.mappings.size;
  }

  get bindingCount(): number {
    return this.bindings.size;
  }

  dependencies(
    events: ReadonlyMap<
      string,
      InboxV2SourceNormalizedEventForIdentityResolution
    >
  ) {
    return {
      readNormalizedEvent: async (
        _transaction: RawSqlExecutor,
        input: { normalizedEventId: string }
      ) => events.get(input.normalizedEventId) ?? null,
      reserveExternalThreadKey: async (
        _transaction: RawSqlExecutor,
        input: { key: InboxV2ExternalThreadKey }
      ) => {
        const mapping = this.mappings.get(keyFingerprint(input.key));
        return mapping === undefined
          ? ({ kind: "not_found" } as const)
          : ({
              kind: "reserved",
              reservation: {
                tenantId: mapping.tenantId,
                id: `external_thread_key:${"a".repeat(64)}`,
                entryKind: "canonical",
                key: mapping.thread.key,
                keyDigest: "a".repeat(64),
                canonicalThreadId: mapping.thread.id,
                canonicalConversationId: mapping.conversation.id
              }
            } as const);
      },
      findExternalThread: async (
        _transaction: RawSqlExecutor,
        input: { key: InboxV2ExternalThreadKey }
      ) => {
        const mapping = this.mappings.get(keyFingerprint(input.key));
        return mapping === undefined
          ? ({ kind: "not_found" } as const)
          : ({
              kind: "found",
              reservationKind: "canonical",
              mapping,
              matchedAlias: null
            } as const);
      },
      resolveExternalThread: async (
        _transaction: RawSqlExecutor,
        input: { mapping: InboxV2ExternalThreadMapping }
      ) => {
        const fingerprint = keyFingerprint(input.mapping.thread.key);
        const existing = this.mappings.get(fingerprint);
        if (existing !== undefined) {
          return { kind: "already_exists", mapping: existing } as const;
        }
        this.mappings.set(fingerprint, input.mapping);
        return { kind: "created", mapping: input.mapping } as const;
      },
      acquireBindingTarget: async () => undefined,
      findBinding: async (
        _transaction: RawSqlExecutor,
        input: { externalThreadId: string; sourceAccountId: string }
      ) => this.bindings.get(bindingKey(input)) ?? null,
      resolveBinding: async (
        _transaction: RawSqlExecutor,
        commit: {
          initialProjection: InboxV2SourceThreadBindingCurrentProjection;
        }
      ) => {
        const projection = commit.initialProjection;
        const key = bindingKey({
          externalThreadId: projection.binding.externalThread.id,
          sourceAccountId: projection.binding.sourceAccount.id
        });
        const existing = this.bindings.get(key);
        if (existing !== undefined) {
          return { kind: "already_exists", projection: existing } as const;
        }
        this.bindings.set(key, projection);
        return { kind: "created", projection } as const;
      }
    };
  }
}

function directPlan(
  suffix: string,
  subject = `Private:${suffix}`
): InboxV2SourceConversationMaterializationPlan {
  return makePlan({
    suffix,
    topology: "direct",
    scope: "source_account",
    subject
  });
}

function groupPlan(
  suffix: string,
  subject: string
): InboxV2SourceConversationMaterializationPlan {
  return makePlan({ suffix, topology: "group", scope: "provider", subject });
}

function withRouteSnapshot(
  plan: InboxV2SourceConversationMaterializationPlan,
  input: {
    adapterContract?: InboxV2SourceConversationMaterializationPlan["source"]["adapterContract"];
    attributes: Array<{ attributeId: string; value: string }>;
  }
): InboxV2SourceConversationMaterializationPlan {
  const adapterContract = input.adapterContract ?? plan.source.adapterContract;
  const routeWithoutDigest = {
    ...plan.routeDescriptor,
    adapterContract,
    attributes: input.attributes,
    descriptorDigestSha256: "0".repeat(64)
  };
  const routeDescriptor = {
    ...routeWithoutDigest,
    descriptorDigestSha256:
      computeInboxV2SourceThreadBindingRouteDescriptorDigest(
        routeWithoutDigest as never
      )
  };
  return inboxV2SourceConversationMaterializationPlanSchema.parse({
    ...plan,
    source: {
      ...plan.source,
      adapterContract,
      thread: {
        ...plan.source.thread,
        identityDeclaration: {
          ...plan.source.thread.identityDeclaration,
          adapterContract
        }
      }
    },
    routeDescriptor,
    materializedByTrustedServiceId: adapterContract.loadedByTrustedServiceId,
    materializationToken: `${plan.materializationToken}-route-snapshot`
  });
}

function makePlan(input: {
  suffix: string;
  topology: "direct" | "group";
  scope: "provider" | "source_account";
  subject: string;
}): InboxV2SourceConversationMaterializationPlan {
  const sourceAccount = {
    tenantId,
    kind: "source_account" as const,
    id: `source_account:${input.suffix}`
  };
  const rawInboundEvent = {
    tenantId,
    kind: "raw_inbound_event" as const,
    id: `raw_inbound_event:${input.suffix}`
  };
  const normalizedInboundEvent = {
    tenantId,
    kind: "normalized_inbound_event" as const,
    id: `normalized_inbound_event:${input.suffix}`
  };
  const threadKey = {
    realm: {
      realmId: "module:synthetic-source:thread-realm",
      realmVersion: "v1",
      canonicalizationVersion: "v1"
    },
    scope:
      input.scope === "provider"
        ? ({ kind: "provider" } as const)
        : ({ kind: "source_account", owner: sourceAccount } as const),
    objectKindId: "module:synthetic-source:chat",
    canonicalExternalSubject: input.subject
  };
  const threadDeclaration = {
    adapterContract,
    identityKind: "external_thread" as const,
    realmId: threadKey.realm.realmId,
    realmVersion: threadKey.realm.realmVersion,
    canonicalizationVersion: threadKey.realm.canonicalizationVersion,
    objectKindId: threadKey.objectKindId,
    scopeKind: input.scope,
    decisionStrength:
      input.scope === "provider"
        ? ("authoritative" as const)
        : ("safe_default" as const)
  };
  const source = {
    tenantId,
    rawInboundEvent,
    normalizedInboundEvent,
    sourceConnection,
    sourceAccount,
    domain: "core:inbox-v2.normalized-event-safe-envelope" as const,
    schemaId: "core:inbox-v2.normalized-event-envelope" as const,
    schemaVersion: "v1" as const,
    safeEnvelopeHmacSha256: `hmac-sha256:${"a".repeat(64)}`,
    adapterContract,
    thread: {
      sourceConnection,
      sourceAccount,
      identityDeclaration: threadDeclaration,
      key: threadKey,
      observedExternalSubject: threadKey.canonicalExternalSubject
    },
    recordedAt
  };
  const routeWithoutDigest = {
    adapterContract,
    descriptorSchemaId: "module:synthetic-source:direct-route",
    descriptorVersion: "v1",
    descriptorRevision: "1" as const,
    destinationKindId: "module:synthetic-source:peer",
    destinationSubject: `Route:${input.suffix}`,
    attributes: []
  };
  const routeDescriptor = {
    ...routeWithoutDigest,
    descriptorDigestSha256:
      computeInboxV2SourceThreadBindingRouteDescriptorDigest({
        ...routeWithoutDigest,
        descriptorDigestSha256: "0".repeat(64)
      } as never)
  };
  return inboxV2SourceConversationMaterializationPlanSchema.parse({
    source,
    topology: input.topology,
    purposeId: "core:chat",
    routeDescriptor,
    candidateConversationId: `conversation:${input.suffix}`,
    candidateExternalThreadId: `external_thread:${input.suffix}`,
    candidateSourceThreadBindingId: `source_thread_binding:${input.suffix}`,
    candidateRemoteAccessEpisodeId: `source_thread_binding_remote_access_episode:${input.suffix}`,
    capabilityEntries: [],
    historySyncState: "not_started",
    namespaceGeneration: "namespace-generation-v1",
    materializedByTrustedServiceId: "core:source-runtime",
    materializationToken: `materialization-token-${input.suffix}`,
    materializedAt
  });
}

function eventFromPlan(
  plan: InboxV2SourceConversationMaterializationPlan
): InboxV2SourceNormalizedEventForIdentityResolution {
  return inboxV2SourceNormalizedEventForIdentityResolutionSchema.parse({
    ...plan.source,
    identityObservations: [],
    rosterObservation: null
  });
}

function identityRow(
  plan: InboxV2SourceConversationMaterializationPlan
): Record<string, unknown> {
  const sourceAccount = plan.source.sourceAccount;
  const declaration = {
    adapterContract: plan.source.adapterContract,
    identityKind: "source_account",
    realmId: "module:synthetic-source:account-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic-source:user-account",
    scopeKind: "source_connection",
    decisionStrength: "authoritative"
  };
  return {
    tenant_id: plan.source.tenantId,
    source_account_id: sourceAccount.id,
    source_connection_id: plan.source.sourceConnection.id,
    state: "verified",
    identity_declaration: declaration,
    canonical_realm_id: declaration.realmId,
    canonical_realm_version: declaration.realmVersion,
    canonicalization_version: declaration.canonicalizationVersion,
    canonical_object_kind_id: declaration.objectKindId,
    canonical_scope_kind: "source_connection",
    canonical_scope_source_connection_id: plan.source.sourceConnection.id,
    canonical_external_subject: `Account:${sourceAccount.id}`,
    verified_decision_actor_trusted_service_id:
      plan.source.adapterContract.loadedByTrustedServiceId,
    verified_decision_policy_id: "core:verified-provider-account",
    verified_decision_policy_version: "v1",
    verified_decision_reason_code_id: "core:account-verified",
    verified_decision_verification_evidence_token: `identity-evidence-${sourceAccount.id}`,
    verified_decision_decided_at: verifiedAt,
    account_generation: "1",
    revision: "1",
    created_at: loadedAt,
    updated_at: verifiedAt
  };
}

function materializedFixture(
  plan: InboxV2SourceConversationMaterializationPlan
): {
  mapping: InboxV2ExternalThreadMapping;
  binding: InboxV2SourceThreadBindingCurrentProjection;
} {
  const mapping = inboxV2ExternalThreadMappingSchema.parse({
    tenantId: plan.source.tenantId,
    thread: {
      tenantId: plan.source.tenantId,
      id: plan.candidateExternalThreadId,
      key: plan.source.thread.key,
      identityDeclaration: plan.source.thread.identityDeclaration,
      conversation: {
        tenantId: plan.source.tenantId,
        kind: "conversation" as const,
        id: plan.candidateConversationId
      },
      conversationTopology: plan.topology,
      revision: "1" as never,
      createdAt: plan.materializedAt,
      updatedAt: plan.materializedAt
    },
    conversation: {
      tenantId: plan.source.tenantId,
      id: plan.candidateConversationId,
      topology: plan.topology,
      transport: "external" as const,
      purposeId: plan.purposeId,
      lifecycle: "active" as const,
      head: {
        latestTimelineSequence: "0" as never,
        latestActivityItemId: null,
        latestActivityTimelineSequence: null,
        latestActivityAt: null,
        revision: "1" as never,
        createdAt: plan.materializedAt,
        updatedAt: plan.materializedAt
      },
      revision: "1" as never,
      createdAt: plan.materializedAt,
      updatedAt: plan.materializedAt
    }
  });
  const identity = identityRow(plan);
  const accountDeclaration = identity.identity_declaration as Record<
    string,
    unknown
  >;
  const evidence = [plan.source.normalizedInboundEvent];
  const bindingValue = {
    tenantId: plan.source.tenantId,
    id: plan.candidateSourceThreadBindingId,
    externalThread: {
      tenantId: plan.source.tenantId,
      kind: "external_thread" as const,
      id: plan.candidateExternalThreadId
    },
    sourceConnection: plan.source.sourceConnection,
    sourceAccount: plan.source.sourceAccount,
    accountIdentitySnapshot: {
      status: "verified" as const,
      sourceConnection: plan.source.sourceConnection,
      sourceAccount: plan.source.sourceAccount,
      declaration: accountDeclaration,
      realmId: identity.canonical_realm_id,
      canonicalExternalSubject: identity.canonical_external_subject,
      accountGeneration: "1" as never,
      verificationEvidence: evidence,
      verifiedAt
    },
    bindingGeneration: "1" as never,
    remoteAccess: {
      state: "observed" as const,
      evidenceAuthority: "direct_observation" as const,
      revision: "1" as never,
      since: materializedAt,
      evidence
    },
    administrative: {
      state: "disabled" as const,
      revision: "1" as never,
      changedAt: materializedAt
    },
    runtimeHealth: {
      state: "unknown" as const,
      revision: "1" as never,
      checkedAt: materializedAt,
      diagnostic: null
    },
    historySync: {
      state: plan.historySyncState,
      revision: "1" as never,
      receiveCursor: null,
      historyCursor: null,
      providerWatermark: null,
      lastDurableRawEvent: null,
      updatedAt: materializedAt,
      diagnostic: null
    },
    providerAccess: {
      revision: "1" as never,
      roleIds: [],
      evidence,
      observedAt: materializedAt
    },
    capabilities: {
      adapterContract,
      revision: "1" as never,
      capturedAt: materializedAt,
      entries: []
    },
    routeDescriptor: plan.routeDescriptor,
    revision: "1" as never,
    createdAt: materializedAt,
    updatedAt: materializedAt
  };
  const binding = inboxV2SourceThreadBindingCurrentProjectionSchema.parse({
    binding: bindingValue,
    currentRemoteAccessEpisode: {
      tenantId: plan.source.tenantId,
      id: plan.candidateRemoteAccessEpisodeId,
      binding: {
        tenantId: plan.source.tenantId,
        kind: "source_thread_binding",
        id: plan.candidateSourceThreadBindingId
      },
      state: "observed",
      startedAt: materializedAt,
      endedAt: null,
      startEvidence: evidence,
      endEvidence: [],
      revision: "1" as never,
      createdAt: materializedAt,
      updatedAt: materializedAt
    }
  });
  return {
    mapping,
    binding
  };
}

function reservedMapping(mapping: InboxV2ExternalThreadMapping) {
  return {
    kind: "reserved" as const,
    reservation: {
      tenantId: mapping.tenantId,
      id: `external_thread_key:${"a".repeat(64)}`,
      entryKind: "canonical" as const,
      key: mapping.thread.key,
      keyDigest: "a".repeat(64),
      canonicalThreadId: mapping.thread.id,
      canonicalConversationId: mapping.conversation.id
    }
  };
}

function keyFingerprint(key: InboxV2ExternalThreadKey): string {
  return JSON.stringify([
    key.realm.realmId,
    key.realm.realmVersion,
    key.realm.canonicalizationVersion,
    key.scope.kind,
    key.scope.kind === "provider" ? null : key.scope.owner.tenantId,
    key.scope.kind === "provider" ? null : key.scope.owner.id,
    key.objectKindId,
    key.canonicalExternalSubject
  ]);
}

function bindingKey(input: {
  externalThreadId: unknown;
  sourceAccountId: unknown;
}): string {
  return `${String(input.externalThreadId)}\u0000${String(input.sourceAccountId)}`;
}

function renderQuery(query: SQL): { sql: string; params: unknown[] } {
  const rendered = new PgDialect().sqlToQuery(query);
  return { sql: rendered.sql, params: [...rendered.params] };
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLowerCase();
}

function rows<Row extends Record<string, unknown>>(
  values: readonly Record<string, unknown>[]
): RawSqlQueryResult<Row> {
  return { rows: values as Row[] };
}

function position(value: string) {
  return inboxV2BigintCounterSchema.parse(value);
}

const allowPlan = Object.freeze({
  verify: (_plan: InboxV2SourceConversationMaterializationPlan) => true
});
