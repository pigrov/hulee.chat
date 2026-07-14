import type {
  InboxV2SourceExternalIdentity,
  InboxV2SourceExternalIdentityId,
  InboxV2TenantId
} from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";
import {
  buildFindInboxV2SourceExternalIdentityByIdSql,
  buildFindInboxV2SourceExternalIdentityIdByScopedKeySql,
  buildInsertInboxV2SourceExternalIdentityHeadSql,
  buildInsertInboxV2SourceExternalIdentitySql,
  buildLockInboxV2SourceExternalIdentityHeadSql,
  buildLockInboxV2SourceExternalIdentitySql,
  createSqlInboxV2SourceExternalIdentityRepository,
  type FindOrCreateInboxV2SourceExternalIdentityInput,
  type InboxV2SourceExternalIdentityTransactionExecutor,
  type RawSqlExecutor,
  type RawSqlQueryResult
} from "./sql-inbox-v2-source-external-identity-repository";

const tenantId = "tenant:db-002-a" as InboxV2TenantId;
const otherTenantId = "tenant:db-002-b" as InboxV2TenantId;
const identityId =
  "source_external_identity:provider-user-1" as InboxV2SourceExternalIdentityId;
const createdAt = "2026-07-13T12:00:00.000Z";

describe("SQL Inbox V2 source external identity repository", () => {
  it("builds tenant-scoped foundation SQL with null-safe provider scope", () => {
    const identity = canonicalIdentity(createInput());
    const insert = renderQuery(
      buildInsertInboxV2SourceExternalIdentitySql(identity)
    );
    const insertHead = renderQuery(
      buildInsertInboxV2SourceExternalIdentityHeadSql(identity)
    );
    const find = renderQuery(
      buildFindInboxV2SourceExternalIdentityByIdSql({
        tenantId,
        id: identityId
      })
    );
    const lock = renderQuery(
      buildLockInboxV2SourceExternalIdentitySql({ tenantId, id: identityId })
    );
    const headLock = renderQuery(
      buildLockInboxV2SourceExternalIdentityHeadSql({
        tenantId,
        id: identityId
      })
    );
    const scoped = renderQuery(
      buildFindInboxV2SourceExternalIdentityIdByScopedKeySql(identity)
    );

    expect(insert.sql).toContain(
      "insert into inbox_v2_source_external_identities"
    );
    expect(insert.sql).toContain("scope_source_connection_id");
    expect(insert.sql).toContain("ephemeral_raw_inbound_event_id");
    expect(insert.sql).toContain("on conflict do nothing");
    expect(insert.params).toEqual(
      expect.arrayContaining([tenantId, identityId, "ProviderUserABC"])
    );
    expect(insertHead.sql).toContain(
      "insert into inbox_v2_source_identity_claim_heads"
    );
    expect(insertHead.sql).toContain(
      "on conflict (tenant_id, source_external_identity_id) do nothing"
    );
    expect(find.sql).toContain("h.tenant_id = i.tenant_id");
    expect(find.sql).toContain("where i.tenant_id = $1");
    expect(find.sql).toContain("and i.id = $2");
    expect(lock.sql).toContain("for update");
    expect(headLock.sql).toContain("for update");
    expect(scoped.sql).toContain("i.scope_kind = 'provider'");
    expect(scoped.sql).toContain("i.scope_source_connection_id is null");
    expect(scoped.sql).toContain("i.scope_source_account_id is null");
    expect(scoped.sql).toContain("i.exact_key_digest_sha256 =");
    expect(scoped.sql).not.toContain("= null");
    expect(scoped.params.slice(0, 5)).toEqual([
      tenantId,
      identity.realm.realmId,
      identity.realm.version,
      identity.realm.canonicalizationVersion,
      identity.objectKindId
    ]);
    expect(scoped.params[5]).toBe(identity.canonicalExternalSubject);
    expect(scoped.params[6]).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("creates the identity and mandatory unresolved head, then returns an idempotent duplicate", async () => {
    const executor = new StatefulIdentityExecutor();
    const repository =
      createSqlInboxV2SourceExternalIdentityRepository(executor);
    const input = createInput();

    const created = await repository.findOrCreate(input);
    const duplicate = await repository.findOrCreate(
      createInput({ createdAt: "2026-07-13T12:01:00.000Z" })
    );
    const loaded = await repository.findById({ tenantId, id: identityId });

    expect(created).toMatchObject({ kind: "created" });
    expect(created.record).toEqual(canonicalIdentity(input));
    expect(duplicate).toMatchObject({ kind: "already_exists" });
    expect(duplicate.record.createdAt).toBe(createdAt);
    expect(loaded).toEqual(created.record);
    expect(executor.commitCount).toBe(2);
  });

  it("tolerates a mandatory head bootstrapped by the database", async () => {
    const executor = new StatefulIdentityExecutor();
    executor.bootstrapHeadOnIdentityInsert = true;
    const repository =
      createSqlInboxV2SourceExternalIdentityRepository(executor);

    const created = await repository.findOrCreate(createInput());

    expect(created).toEqual({
      kind: "created",
      record: canonicalIdentity(createInput())
    });
    expect(executor.commitCount).toBe(1);
  });

  it("keeps the same opaque identity ID isolated across tenants", async () => {
    const executor = new StatefulIdentityExecutor();
    const repository =
      createSqlInboxV2SourceExternalIdentityRepository(executor);

    const [first, second] = await Promise.all([
      repository.findOrCreate(createInput()),
      repository.findOrCreate(
        createInput({
          tenantId: otherTenantId,
          canonicalExternalSubject: "ProviderUserXYZ"
        })
      )
    ]);

    expect(first.kind).toBe("created");
    expect(second.kind).toBe("created");
    expect(
      await repository.findById({ tenantId, id: identityId })
    ).toMatchObject({ tenantId, canonicalExternalSubject: "ProviderUserABC" });
    expect(
      await repository.findById({ tenantId: otherTenantId, id: identityId })
    ).toMatchObject({
      tenantId: otherTenantId,
      canonicalExternalSubject: "ProviderUserXYZ"
    });
  });

  it("distinguishes same-ID shape conflicts from null-safe scoped-key conflicts", async () => {
    const executor = new StatefulIdentityExecutor();
    const repository =
      createSqlInboxV2SourceExternalIdentityRepository(executor);
    const first = await repository.findOrCreate(createInput());

    const identityConflict = await repository.findOrCreate(
      createInput({
        stability: {
          kind: "observation_ephemeral",
          observation: {
            tenantId,
            kind: "raw_inbound_event",
            id: "raw_inbound_event:event-conflict" as never
          },
          observationKey: "sender:conflict"
        }
      })
    );
    const scopedConflict = await repository.findOrCreate(
      createInput({
        id: "source_external_identity:provider-user-2" as never
      })
    );

    expect(first.kind).toBe("created");
    expect(identityConflict.kind).toBe("identity_conflict");
    expect(identityConflict.record.id).toBe(identityId);
    expect(scopedConflict.kind).toBe("scoped_key_conflict");
    expect(scopedConflict.record.id).toBe(identityId);
  });

  it("returns a typed conflict when one canonical identity is redeclared", async () => {
    const executor = new StatefulIdentityExecutor();
    const repository =
      createSqlInboxV2SourceExternalIdentityRepository(executor);
    const input = createInput();
    await repository.findOrCreate(input);
    const changedDeclaration = {
      ...input.identityDeclaration,
      adapterContract: {
        ...input.identityDeclaration.adapterContract,
        declarationRevision: "2" as never
      }
    };

    const sameId = await repository.findOrCreate(
      createInput({ identityDeclaration: changedDeclaration })
    );
    const sameKey = await repository.findOrCreate(
      createInput({
        id: "source_external_identity:provider-user-2" as never,
        identityDeclaration: changedDeclaration
      })
    );

    expect(sameId.kind).toBe("declaration_conflict");
    expect(sameKey.kind).toBe("declaration_conflict");
    expect(sameId.record).toEqual(sameKey.record);
  });

  it("serializes duplicate races into one winner and deterministic conflict results", async () => {
    const executor = new StatefulIdentityExecutor();
    const repository =
      createSqlInboxV2SourceExternalIdentityRepository(executor);

    const sameIdentity = await Promise.all([
      repository.findOrCreate(createInput()),
      repository.findOrCreate(createInput())
    ]);
    expect(sameIdentity.map((result) => result.kind).sort()).toEqual([
      "already_exists",
      "created"
    ]);

    const scopedRace = await Promise.all([
      repository.findOrCreate(
        createInput({
          id: "source_external_identity:race-a" as never,
          canonicalExternalSubject: "RaceSubject"
        })
      ),
      repository.findOrCreate(
        createInput({
          id: "source_external_identity:race-b" as never,
          canonicalExternalSubject: "RaceSubject"
        })
      )
    ]);
    expect(scopedRace.map((result) => result.kind).sort()).toEqual([
      "created",
      "scoped_key_conflict"
    ]);
  });

  it("scopes ephemeral identity uniqueness to the exact observation and roster key", async () => {
    const executor = new StatefulIdentityExecutor();
    const repository =
      createSqlInboxV2SourceExternalIdentityRepository(executor);
    const ephemeral = (
      id: string,
      eventId: string,
      observationKey: string
    ): FindOrCreateInboxV2SourceExternalIdentityInput =>
      createInput({
        id: id as never,
        canonicalExternalSubject: "WeakRosterLabel",
        stability: {
          kind: "observation_ephemeral",
          observation: {
            tenantId,
            kind: "raw_inbound_event",
            id: eventId as never
          },
          observationKey
        }
      });

    const first = await repository.findOrCreate(
      ephemeral(
        "source_external_identity:ephemeral-a",
        "raw_inbound_event:event-a",
        "member:1"
      )
    );
    const otherEvent = await repository.findOrCreate(
      ephemeral(
        "source_external_identity:ephemeral-b",
        "raw_inbound_event:event-b",
        "member:1"
      )
    );
    const otherMember = await repository.findOrCreate(
      ephemeral(
        "source_external_identity:ephemeral-c",
        "raw_inbound_event:event-a",
        "member:2"
      )
    );
    const exactConflict = await repository.findOrCreate(
      ephemeral(
        "source_external_identity:ephemeral-d",
        "raw_inbound_event:event-a",
        "member:1"
      )
    );

    expect([first.kind, otherEvent.kind, otherMember.kind]).toEqual([
      "created",
      "created",
      "created"
    ]);
    expect(exactConflict).toMatchObject({
      kind: "scoped_key_conflict",
      record: { id: "source_external_identity:ephemeral-a" }
    });
  });

  it("keeps connection and account scopes separate while preserving their exact owners", async () => {
    const executor = new StatefulIdentityExecutor();
    const repository =
      createSqlInboxV2SourceExternalIdentityRepository(executor);
    const connectionInput = createInput({
      id: "source_external_identity:connection-subject" as never,
      scope: {
        kind: "source_connection",
        owner: {
          tenantId,
          kind: "source_connection",
          id: "source_connection:direct-1" as never
        }
      }
    });
    const accountInput = createInput({
      id: "source_external_identity:account-subject" as never,
      scope: {
        kind: "source_account",
        owner: {
          tenantId,
          kind: "source_account",
          id: "source_account:direct-1" as never
        }
      }
    });

    const connection = await repository.findOrCreate(connectionInput);
    const account = await repository.findOrCreate(accountInput);

    expect(connection.kind).toBe("created");
    expect(account.kind).toBe("created");
    expect(connection.record.scope).toEqual(connectionInput.scope);
    expect(account.record.scope).toEqual(accountInput.scope);
  });

  it("round-trips both ephemeral observation shapes and rejects invalid strict input", async () => {
    const executor = new StatefulIdentityExecutor();
    const repository =
      createSqlInboxV2SourceExternalIdentityRepository(executor);
    const rawInput = createInput({
      id: "source_external_identity:raw-observation" as never,
      canonicalExternalSubject: "RawActor",
      stability: {
        kind: "observation_ephemeral",
        observation: {
          tenantId,
          kind: "raw_inbound_event",
          id: "raw_inbound_event:event-1" as never
        },
        observationKey: "roster:raw:1"
      }
    });
    const normalizedInput = createInput({
      id: "source_external_identity:normalized-observation" as never,
      canonicalExternalSubject: "NormalizedActor",
      stability: {
        kind: "observation_ephemeral",
        observation: {
          tenantId,
          kind: "normalized_inbound_event",
          id: "normalized_inbound_event:event-1" as never
        },
        observationKey: "roster:normalized:1"
      }
    });

    expect((await repository.findOrCreate(rawInput)).record.stability).toEqual(
      rawInput.stability
    );
    expect(
      (await repository.findOrCreate(normalizedInput)).record.stability
    ).toEqual(normalizedInput.stability);

    await expect(
      repository.findOrCreate({
        ...createInput(),
        unexpected: true
      } as never)
    ).rejects.toMatchObject({ code: "validation.failed" });
    await expect(
      repository.findOrCreate(
        createInput({
          stability: {
            kind: "observation_ephemeral",
            observation: {
              tenantId: otherTenantId,
              kind: "raw_inbound_event",
              id: "raw_inbound_event:event-1" as never
            },
            observationKey: "roster:raw:1"
          }
        })
      )
    ).rejects.toBeDefined();
  });

  it("rolls identity insertion back when mandatory head creation fails", async () => {
    const executor = new StatefulIdentityExecutor();
    const repository =
      createSqlInboxV2SourceExternalIdentityRepository(executor);
    executor.failNextHeadInsert = true;

    await expect(repository.findOrCreate(createInput())).rejects.toBeInstanceOf(
      InboxV2PersistenceInvariantError
    );
    expect(executor.rollbackCount).toBe(1);
    expect(await repository.findById({ tenantId, id: identityId })).toBeNull();

    const retry = await repository.findOrCreate(createInput());
    expect(retry.kind).toBe("created");
  });

  it("fails closed when a digest conflict has no exact raw-key match", async () => {
    const executor = new StatefulIdentityExecutor();
    const repository =
      createSqlInboxV2SourceExternalIdentityRepository(executor);
    executor.forceDigestCollisionOnNextInsert = true;

    await expect(repository.findOrCreate(createInput())).rejects.toMatchObject({
      name: "InboxV2PersistenceInvariantError"
    });
    expect(await repository.findById({ tenantId, id: identityId })).toBeNull();
  });

  it("maps every coherent source-identity claim head state", async () => {
    const executor = new StatefulIdentityExecutor();
    const repository =
      createSqlInboxV2SourceExternalIdentityRepository(executor);
    await repository.findOrCreate(createInput());

    executor.unsafeMutate(tenantId, identityId, {
      revision: "2",
      head: {
        resolutionStatus: "claimed",
        activeClaimId: "source_identity_claim:claim-1",
        latestClaimVersion: 1n
      }
    });
    await expect(
      repository.findById({ tenantId, id: identityId })
    ).resolves.toMatchObject({
      resolution: {
        status: "claimed",
        activeClaim: {
          tenantId,
          kind: "source_identity_claim",
          id: "source_identity_claim:claim-1"
        }
      },
      latestClaimVersion: "1"
    });
    await expect(
      repository.findOrCreate(
        createInput({ createdAt: "2026-07-13T12:30:00.000Z" })
      )
    ).resolves.toMatchObject({
      kind: "already_exists",
      record: {
        resolution: { status: "claimed" },
        latestClaimVersion: "1"
      }
    });

    executor.unsafeMutate(tenantId, identityId, {
      revision: "3",
      head: {
        resolutionStatus: "unresolved",
        activeClaimId: null,
        latestClaimVersion: "2"
      }
    });
    await expect(
      repository.findById({ tenantId, id: identityId })
    ).resolves.toMatchObject({
      resolution: { status: "unresolved" },
      latestClaimVersion: "2"
    });

    executor.unsafeMutate(tenantId, identityId, {
      revision: "4",
      head: {
        resolutionStatus: "conflicted",
        activeClaimId: null,
        latestClaimVersion: "3"
      }
    });
    await expect(
      repository.findById({ tenantId, id: identityId })
    ).resolves.toMatchObject({
      resolution: { status: "conflicted" },
      latestClaimVersion: "3"
    });
  });

  it("reports incomplete or corrupt aggregate rows as persistence invariants", async () => {
    const executor = new StatefulIdentityExecutor();
    const repository =
      createSqlInboxV2SourceExternalIdentityRepository(executor);
    executor.unsafeSeed(createInput(), { head: null });

    await expect(
      repository.findById({ tenantId, id: identityId })
    ).rejects.toBeInstanceOf(InboxV2PersistenceInvariantError);

    const corruptHeads: Array<{
      revision?: unknown;
      head: StoredHead;
    }> = [
      {
        head: {
          resolutionStatus: "claimed",
          activeClaimId: null,
          latestClaimVersion: "1"
        }
      },
      {
        head: {
          resolutionStatus: "claimed",
          activeClaimId: "not-a-claim-id",
          latestClaimVersion: "1"
        }
      },
      {
        head: {
          resolutionStatus: "claimed",
          activeClaimId: "source_identity_claim:claim-1",
          latestClaimVersion: null
        }
      },
      {
        head: {
          resolutionStatus: "unresolved",
          activeClaimId: "source_identity_claim:claim-1",
          latestClaimVersion: "1"
        }
      },
      {
        revision: "2",
        head: {
          resolutionStatus: "unresolved",
          activeClaimId: null,
          latestClaimVersion: null
        }
      },
      {
        head: {
          resolutionStatus: "conflicted",
          activeClaimId: null,
          latestClaimVersion: null
        }
      },
      {
        head: {
          resolutionStatus: "conflicted",
          activeClaimId: "source_identity_claim:claim-1",
          latestClaimVersion: "1"
        }
      },
      {
        head: {
          resolutionStatus: "invalid",
          activeClaimId: null,
          latestClaimVersion: "1"
        }
      },
      {
        head: {
          resolutionStatus: "unresolved",
          activeClaimId: null,
          latestClaimVersion: "0"
        }
      },
      {
        revision: "3",
        head: {
          resolutionStatus: "claimed",
          activeClaimId: "source_identity_claim:claim-1",
          latestClaimVersion: "1"
        }
      }
    ];

    for (const corrupt of corruptHeads) {
      executor.unsafeMutate(tenantId, identityId, {
        revision: corrupt.revision ?? "1",
        head: corrupt.head
      });
      await expect(
        repository.findById({ tenantId, id: identityId })
      ).rejects.toBeInstanceOf(InboxV2PersistenceInvariantError);
    }
  });

  it("rejects unsafe bigint and invalid timestamp decoding", async () => {
    const executor = new StatefulIdentityExecutor();
    const repository =
      createSqlInboxV2SourceExternalIdentityRepository(executor);
    await repository.findOrCreate(createInput());

    executor.unsafeMutate(tenantId, identityId, { revision: 1 });
    await expect(
      repository.findById({ tenantId, id: identityId })
    ).rejects.toThrow(/JavaScript number/u);

    executor.unsafeMutate(tenantId, identityId, {
      revision: "2",
      head: {
        resolutionStatus: "claimed",
        activeClaimId: "source_identity_claim:claim-1",
        latestClaimVersion: 1
      }
    });
    await expect(
      repository.findById({ tenantId, id: identityId })
    ).rejects.toThrow(/JavaScript number/u);

    executor.unsafeMutate(tenantId, identityId, {
      revision: "1",
      head: {
        resolutionStatus: "unresolved",
        activeClaimId: null,
        latestClaimVersion: null
      },
      updatedAt: "not-a-postgres-timestamp"
    });
    await expect(
      repository.findById({ tenantId, id: identityId })
    ).rejects.toBeInstanceOf(InboxV2PersistenceInvariantError);
  });
});

function createInput(
  overrides: Partial<FindOrCreateInboxV2SourceExternalIdentityInput> = {}
): FindOrCreateInboxV2SourceExternalIdentityInput {
  const inputTenantId = overrides.tenantId ?? tenantId;
  const inputCreatedAt = overrides.createdAt ?? createdAt;
  const scope = overrides.scope ?? { kind: "provider" as const };
  const identityDeclaration =
    overrides.identityDeclaration ??
    ({
      adapterContract: {
        contractId: "module:telegram-user-session:identity-contract",
        contractVersion: "v1",
        declarationRevision: "1",
        surfaceId: "module:telegram-user-session:mtproto",
        loadedByTrustedServiceId: "core:inbox-worker",
        loadedAt: createdAt
      },
      identityKind: "source_external_identity",
      realmId: "module:telegram-user-session:mtproto-user",
      realmVersion: "v1",
      canonicalizationVersion: "v1",
      objectKindId: "module:telegram-user-session:provider-user",
      scopeKind: scope.kind,
      decisionStrength:
        scope.kind === "source_account" ? "safe_default" : "authoritative"
    } as unknown as FindOrCreateInboxV2SourceExternalIdentityInput["identityDeclaration"]);
  const materializedAt = overrides.materializedAt ?? inputCreatedAt;

  return {
    tenantId: inputTenantId,
    id: identityId,
    realm: {
      realmId: "module:telegram-user-session:mtproto-user" as never,
      version: "v1" as never,
      canonicalizationVersion: "v1" as never
    },
    objectKindId:
      "module:telegram-user-session:provider-user" as FindOrCreateInboxV2SourceExternalIdentityInput["objectKindId"],
    scope,
    identityDeclaration,
    materializationAuthority:
      overrides.materializationAuthority ??
      ({
        kind: "trusted_service",
        tenantId: inputTenantId,
        trustedServiceId: "core:inbox-worker",
        authorizationToken: `identity-${String(overrides.id ?? identityId).slice(-8)}`,
        authorizedAt: materializedAt
      } as unknown as FindOrCreateInboxV2SourceExternalIdentityInput["materializationAuthority"]),
    materializedAt,
    canonicalExternalSubject: "ProviderUserABC",
    stability: { kind: "stable" },
    createdAt: inputCreatedAt,
    ...overrides
  };
}

function canonicalIdentity(
  input: FindOrCreateInboxV2SourceExternalIdentityInput
): InboxV2SourceExternalIdentity {
  return {
    tenantId: input.tenantId,
    id: input.id,
    realm: input.realm,
    objectKindId: input.objectKindId,
    scope: input.scope,
    identityDeclaration: input.identityDeclaration,
    materializationAuthority: input.materializationAuthority,
    materializedAt: input.materializedAt,
    canonicalExternalSubject: input.canonicalExternalSubject,
    stability: input.stability,
    resolution: { status: "unresolved" },
    latestClaimVersion: null,
    revision: "1" as never,
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  };
}

type StoredHead = {
  resolutionStatus: unknown;
  activeClaimId: unknown;
  latestClaimVersion: unknown;
};

type StoredIdentity = {
  tenantId: unknown;
  id: unknown;
  realmId: unknown;
  realmVersion: unknown;
  canonicalizationVersion: unknown;
  objectKindId: unknown;
  scopeKind: unknown;
  sourceConnectionId: unknown;
  sourceAccountId: unknown;
  identityDeclaration: unknown;
  declarationContractId: unknown;
  declarationContractVersion: unknown;
  declarationRevision: unknown;
  declarationSurfaceId: unknown;
  declarationLoadedByTrustedServiceId: unknown;
  declarationLoadedAt: unknown;
  materializedByTrustedServiceId: unknown;
  materializationAuthorizationToken: unknown;
  materializedAt: unknown;
  canonicalExternalSubject: unknown;
  stabilityKind: unknown;
  rawInboundEventId: unknown;
  normalizedInboundEventId: unknown;
  observationKey: unknown;
  revision: unknown;
  createdAt: unknown;
  updatedAt: unknown;
  head: StoredHead | null;
};

class StatefulIdentityExecutor implements InboxV2SourceExternalIdentityTransactionExecutor {
  readonly queries: SQL[] = [];
  commitCount = 0;
  rollbackCount = 0;
  failNextHeadInsert = false;
  forceDigestCollisionOnNextInsert = false;
  bootstrapHeadOnIdentityInsert = false;
  private state = new Map<string, StoredIdentity>();
  private transactionTail: Promise<void> = Promise.resolve();

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    return new StatefulIdentitySession(this.state, this.queries, this).execute(
      query
    );
  }

  async transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>
  ): Promise<TResult> {
    const previous = this.transactionTail;
    let release = (): void => undefined;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    const draft = structuredClone(this.state);
    const session = new StatefulIdentitySession(draft, this.queries, this);
    try {
      const result = await work(session);
      this.state = session.takeState();
      this.commitCount += 1;
      return result;
    } catch (error) {
      this.rollbackCount += 1;
      throw error;
    } finally {
      release();
    }
  }

  unsafeSeed(
    input: FindOrCreateInboxV2SourceExternalIdentityInput,
    override: Partial<StoredIdentity> = {}
  ): void {
    const stored = storedIdentity(input);
    this.state.set(storageKey(input.tenantId, input.id), {
      ...stored,
      ...override
    });
  }

  unsafeMutate(
    tenant: InboxV2TenantId,
    id: InboxV2SourceExternalIdentityId,
    override: Partial<StoredIdentity>
  ): void {
    const key = storageKey(tenant, id);
    const existing = this.state.get(key);
    if (!existing) {
      throw new Error("Expected a seeded SourceExternalIdentity.");
    }
    this.state.set(key, { ...existing, ...override });
  }
}

class StatefulIdentitySession implements RawSqlExecutor {
  constructor(
    private state: Map<string, StoredIdentity>,
    private readonly queries: SQL[],
    private readonly controls: {
      failNextHeadInsert: boolean;
      forceDigestCollisionOnNextInsert: boolean;
      bootstrapHeadOnIdentityInsert: boolean;
    }
  ) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(query);
    const rendered = renderQuery(query);
    const statement = normalizeSql(rendered.sql);

    if (
      statement.startsWith("insert into inbox_v2_source_external_identities")
    ) {
      return this.insertIdentity<Row>(rendered.params);
    }
    if (
      statement.startsWith("insert into inbox_v2_source_identity_claim_heads")
    ) {
      return this.insertHead<Row>(rendered.params);
    }
    if (statement.includes("left join inbox_v2_source_identity_claim_heads")) {
      return this.findAggregate<Row>(rendered.params);
    }
    if (statement.includes("i.realm_id =")) {
      return this.findScopedIdentityId<Row>(statement, rendered.params);
    }
    if (statement.includes("from inbox_v2_source_identity_claim_heads h")) {
      return this.lockHead<Row>(rendered.params);
    }
    if (statement.includes("from inbox_v2_source_external_identities i")) {
      return this.lockIdentity<Row>(rendered.params);
    }

    throw new Error(`Stateful fake does not understand SQL: ${rendered.sql}`);
  }

  takeState(): Map<string, StoredIdentity> {
    return this.state;
  }

  private insertIdentity<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const [
      tenant,
      id,
      realmId,
      realmVersion,
      canonicalizationVersion,
      objectKindId,
      scopeKind,
      sourceConnectionId,
      sourceAccountId,
      identityDeclaration,
      declarationContractId,
      declarationContractVersion,
      declarationRevision,
      declarationSurfaceId,
      declarationLoadedByTrustedServiceId,
      declarationLoadedAt,
      materializedByTrustedServiceId,
      materializationAuthorizationToken,
      materializedAt,
      canonicalExternalSubject,
      stabilityKind,
      rawInboundEventId,
      normalizedInboundEventId,
      observationKey,
      createdAt,
      updatedAt
    ] = params;
    const requested: StoredIdentity = {
      tenantId: tenant,
      id,
      realmId,
      realmVersion,
      canonicalizationVersion,
      objectKindId,
      scopeKind,
      sourceConnectionId,
      sourceAccountId,
      identityDeclaration,
      declarationContractId,
      declarationContractVersion,
      declarationRevision,
      declarationSurfaceId,
      declarationLoadedByTrustedServiceId,
      declarationLoadedAt,
      materializedByTrustedServiceId,
      materializationAuthorizationToken,
      materializedAt,
      canonicalExternalSubject,
      stabilityKind,
      rawInboundEventId,
      normalizedInboundEventId,
      observationKey,
      revision: "1",
      createdAt,
      updatedAt,
      head: this.controls.bootstrapHeadOnIdentityInsert
        ? {
            resolutionStatus: "unresolved",
            activeClaimId: null,
            latestClaimVersion: null
          }
        : null
    };
    const key = storageKey(String(tenant), String(id));

    if (this.controls.forceDigestCollisionOnNextInsert) {
      this.controls.forceDigestCollisionOnNextInsert = false;
      return rowsResult([]);
    }

    if (
      this.state.has(key) ||
      [...this.state.values()].some(
        (existing) => scopedKey(existing) === scopedKey(requested)
      )
    ) {
      return rowsResult([]);
    }

    this.state.set(key, requested);
    return rowsResult([{ identity_id: id }]);
  }

  private insertHead<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const [tenant, id] = params;
    const stored = this.state.get(storageKey(String(tenant), String(id)));

    if (this.controls.failNextHeadInsert) {
      this.controls.failNextHeadInsert = false;
      return rowsResult([]);
    }
    if (!stored || stored.head !== null) {
      return rowsResult([]);
    }

    stored.head = {
      resolutionStatus: "unresolved",
      activeClaimId: null,
      latestClaimVersion: null
    };
    return rowsResult([{ identity_id: id }]);
  }

  private findAggregate<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const [tenant, id] = params;
    const stored = this.state.get(storageKey(String(tenant), String(id)));
    return stored ? rowsResult([toAggregateRow(stored)]) : rowsResult([]);
  }

  private findScopedIdentityId<Row extends Record<string, unknown>>(
    statement: string,
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const [
      tenant,
      realmId,
      realmVersion,
      canonicalizationVersion,
      objectKindId
    ] = params;
    const scopeKind = statement.includes("i.scope_kind = 'provider'")
      ? "provider"
      : statement.includes("i.scope_kind = 'source_connection'")
        ? "source_connection"
        : "source_account";
    const hasOwner = scopeKind !== "provider";
    const owner = hasOwner ? params[5] : null;
    const canonicalExternalSubject = params[hasOwner ? 6 : 5];
    const stabilityParamOffset = hasOwner ? 7 : 6;
    const stabilityKind = statement.includes("i.stability_kind = 'stable'")
      ? "stable"
      : "observation_ephemeral";
    const rawObservation = statement.includes(
      "i.ephemeral_raw_inbound_event_id ="
    );
    const observationId =
      stabilityKind === "observation_ephemeral"
        ? params[stabilityParamOffset]
        : null;
    const observationKey =
      stabilityKind === "observation_ephemeral"
        ? params[stabilityParamOffset + 1]
        : null;
    const matches = [...this.state.values()].filter(
      (stored) =>
        stored.tenantId === tenant &&
        stored.realmId === realmId &&
        stored.realmVersion === realmVersion &&
        stored.canonicalizationVersion === canonicalizationVersion &&
        stored.objectKindId === objectKindId &&
        stored.scopeKind === scopeKind &&
        (scopeKind === "provider"
          ? stored.sourceConnectionId === null &&
            stored.sourceAccountId === null
          : scopeKind === "source_connection"
            ? stored.sourceConnectionId === owner &&
              stored.sourceAccountId === null
            : stored.sourceConnectionId === null &&
              stored.sourceAccountId === owner) &&
        stored.canonicalExternalSubject === canonicalExternalSubject &&
        stored.stabilityKind === stabilityKind &&
        (stabilityKind === "stable"
          ? stored.rawInboundEventId === null &&
            stored.normalizedInboundEventId === null &&
            stored.observationKey === null
          : rawObservation
            ? stored.rawInboundEventId === observationId &&
              stored.normalizedInboundEventId === null &&
              stored.observationKey === observationKey
            : stored.rawInboundEventId === null &&
              stored.normalizedInboundEventId === observationId &&
              stored.observationKey === observationKey)
    );

    return rowsResult(matches.map((stored) => ({ identity_id: stored.id })));
  }

  private lockIdentity<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const [tenant, id] = params;
    const stored = this.state.get(storageKey(String(tenant), String(id)));
    return stored ? rowsResult([{ identity_id: stored.id }]) : rowsResult([]);
  }

  private lockHead<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const [tenant, id] = params;
    const stored = this.state.get(storageKey(String(tenant), String(id)));
    return stored?.head
      ? rowsResult([{ identity_id: stored.id }])
      : rowsResult([]);
  }
}

function storedIdentity(
  input: FindOrCreateInboxV2SourceExternalIdentityInput
): StoredIdentity {
  const scope = input.scope;
  const stability = input.stability;

  return {
    tenantId: input.tenantId,
    id: input.id,
    realmId: input.realm.realmId,
    realmVersion: input.realm.version,
    canonicalizationVersion: input.realm.canonicalizationVersion,
    objectKindId: input.objectKindId,
    scopeKind: scope.kind,
    sourceConnectionId:
      scope.kind === "source_connection" ? scope.owner.id : null,
    sourceAccountId: scope.kind === "source_account" ? scope.owner.id : null,
    identityDeclaration: input.identityDeclaration,
    declarationContractId: input.identityDeclaration.adapterContract.contractId,
    declarationContractVersion:
      input.identityDeclaration.adapterContract.contractVersion,
    declarationRevision:
      input.identityDeclaration.adapterContract.declarationRevision,
    declarationSurfaceId: input.identityDeclaration.adapterContract.surfaceId,
    declarationLoadedByTrustedServiceId:
      input.identityDeclaration.adapterContract.loadedByTrustedServiceId,
    declarationLoadedAt: input.identityDeclaration.adapterContract.loadedAt,
    materializedByTrustedServiceId:
      input.materializationAuthority.trustedServiceId,
    materializationAuthorizationToken:
      input.materializationAuthority.authorizationToken,
    materializedAt: input.materializedAt,
    canonicalExternalSubject: input.canonicalExternalSubject,
    stabilityKind: stability.kind,
    rawInboundEventId:
      stability.kind === "observation_ephemeral" &&
      stability.observation.kind === "raw_inbound_event"
        ? stability.observation.id
        : null,
    normalizedInboundEventId:
      stability.kind === "observation_ephemeral" &&
      stability.observation.kind === "normalized_inbound_event"
        ? stability.observation.id
        : null,
    observationKey:
      stability.kind === "observation_ephemeral"
        ? stability.observationKey
        : null,
    revision: "1",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    head: {
      resolutionStatus: "unresolved",
      activeClaimId: null,
      latestClaimVersion: null
    }
  };
}

function toAggregateRow(stored: StoredIdentity): Record<string, unknown> {
  const observationKind =
    stored.rawInboundEventId !== null
      ? "raw_inbound_event"
      : stored.normalizedInboundEventId !== null
        ? "normalized_inbound_event"
        : null;

  return {
    identity_tenant_id: stored.tenantId,
    identity_id: stored.id,
    realm_id: stored.realmId,
    realm_version: stored.realmVersion,
    canonicalization_version: stored.canonicalizationVersion,
    object_kind_id: stored.objectKindId,
    scope_kind: stored.scopeKind,
    source_connection_id: stored.sourceConnectionId,
    source_account_id: stored.sourceAccountId,
    identity_declaration: stored.identityDeclaration,
    declaration_contract_id: stored.declarationContractId,
    declaration_contract_version: stored.declarationContractVersion,
    declaration_revision: stored.declarationRevision,
    declaration_surface_id: stored.declarationSurfaceId,
    declaration_loaded_by_trusted_service_id:
      stored.declarationLoadedByTrustedServiceId,
    declaration_loaded_at: stored.declarationLoadedAt,
    materialized_by_trusted_service_id: stored.materializedByTrustedServiceId,
    materialization_authorization_token:
      stored.materializationAuthorizationToken,
    materialized_at: stored.materializedAt,
    canonical_external_subject: stored.canonicalExternalSubject,
    stability_kind: stored.stabilityKind,
    observation_kind: observationKind,
    raw_inbound_event_id: stored.rawInboundEventId,
    normalized_inbound_event_id: stored.normalizedInboundEventId,
    observation_key: stored.observationKey,
    identity_revision: stored.revision,
    identity_created_at: stored.createdAt,
    identity_updated_at: stored.updatedAt,
    head_source_external_identity_id: stored.head === null ? null : stored.id,
    resolution_status: stored.head?.resolutionStatus ?? null,
    active_claim_id: stored.head?.activeClaimId ?? null,
    latest_claim_version: stored.head?.latestClaimVersion ?? null
  };
}

function scopedKey(stored: StoredIdentity): string {
  const owner =
    stored.scopeKind === "source_connection"
      ? stored.sourceConnectionId
      : stored.scopeKind === "source_account"
        ? stored.sourceAccountId
        : "";
  return [
    stored.tenantId,
    stored.realmId,
    stored.realmVersion,
    stored.canonicalizationVersion,
    stored.objectKindId,
    stored.scopeKind,
    owner,
    stored.canonicalExternalSubject,
    stored.stabilityKind,
    stored.rawInboundEventId ?? "",
    stored.normalizedInboundEventId ?? "",
    stored.observationKey ?? ""
  ].join("\u0000");
}

function storageKey(tenant: string, id: string): string {
  return `${tenant}\u0000${id}`;
}

function rowsResult<Row extends Record<string, unknown>>(
  rows: readonly Record<string, unknown>[]
): RawSqlQueryResult<Row> {
  return { rows: rows as readonly Row[] };
}

function renderQuery(query: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query);
}

function normalizeSql(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}
