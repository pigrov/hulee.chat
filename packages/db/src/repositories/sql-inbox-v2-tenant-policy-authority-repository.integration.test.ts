import {
  inboxV2ActivateTenantPolicyVersionCommandSchema,
  inboxV2ApproveTenantPolicyVersionCommandSchema,
  inboxV2ConversationClientLinkPolicyIdSchema,
  inboxV2ExactActiveTenantPolicyAuthorityInputSchema,
  inboxV2IdentityClaimPolicyIdSchema,
  inboxV2RevokeTenantPolicyVersionCommandSchema,
  inboxV2TenantIdSchema,
  type InboxV2ExactActiveTenantPolicyAuthorityInput,
  type InboxV2TenantPolicyFamily
} from "@hulee/contracts";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import {
  createSqlInboxV2TenantPolicyAuthorityRepository,
  lockAndValidateExactActiveInboxV2TenantPolicyAuthority,
  type InboxV2TenantPolicyAuthorityUseTransaction
} from "./sql-inbox-v2-tenant-policy-authority-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const tenantA = inboxV2TenantIdSchema.parse(`tenant:db002-policy-a-${runId}`);
const tenantB = inboxV2TenantIdSchema.parse(`tenant:db002-policy-b-${runId}`);
const employeeA = `employee:db002-policy-a-${runId}`;
const employeeB = `employee:db002-policy-b-${runId}`;
const t0 = "2026-07-14T05:00:00.000Z";
const t1 = "2026-07-14T05:01:00.000Z";
const t2 = "2026-07-14T05:02:00.000Z";
const t3 = "2026-07-14T05:03:00.000Z";
const t4 = "2026-07-14T05:04:00.000Z";
const digest = "a".repeat(64);

// This opt-in suite requires a disposable DATABASE_URL. It never mutates the
// schema; randomized fixture rows live until the disposable database is dropped.
describePostgres(
  "SQL Inbox V2 tenant policy authority repository (PostgreSQL)",
  () => {
    let db: HuleeDatabase;
    let primaryPolicyId: ReturnType<
      typeof inboxV2IdentityClaimPolicyIdSchema.parse
    >;

    beforeAll(async () => {
      db = createHuleeDatabase();
      const readiness = await db.execute<{
        versions: string | null;
        heads: string | null;
        transitions: string | null;
        exact_anchor: string | null;
        deferred_seal: boolean | null;
      }>(sql`
        select
          to_regclass('public.inbox_v2_tenant_policy_versions')::text
            as versions,
          to_regclass('public.inbox_v2_tenant_policy_activation_heads')::text
            as heads,
          to_regclass(
            'public.inbox_v2_tenant_policy_activation_transitions'
          )::text as transitions,
          (
            select constraint_row.conname
            from pg_catalog.pg_constraint constraint_row
            where constraint_row.conname =
              'inbox_v2_tenant_policy_transition_exact_authority_unique'
          ) as exact_anchor,
          (
            select trigger_row.tgdeferrable and trigger_row.tginitdeferred
            from pg_catalog.pg_trigger trigger_row
            where trigger_row.tgname =
              'inbox_v2_tenant_policy_transition_materialized_constraint'
          ) as deferred_seal
      `);
      expect(readiness.rows[0]).toEqual({
        versions: "inbox_v2_tenant_policy_versions",
        heads: "inbox_v2_tenant_policy_activation_heads",
        transitions: "inbox_v2_tenant_policy_activation_transitions",
        exact_anchor:
          "inbox_v2_tenant_policy_transition_exact_authority_unique",
        deferred_seal: true
      });

      await seedTenantAndEmployee(db, tenantA, employeeA, "a");
      await seedTenantAndEmployee(db, tenantB, employeeB, "b");
      primaryPolicyId = claimPolicyId("primary");
    });

    afterAll(async () => {
      if (!db) return;
      await closeHuleeDatabase(db);
    });

    it.each([
      ["source_identity_claim", "claim"],
      ["conversation_client_link", "client-link"]
    ] as const)(
      "approves and activates one exact %s policy anchor",
      async (family, suffix) => {
        const policyId =
          family === "source_identity_claim"
            ? claimPolicyId(suffix)
            : clientLinkPolicyId(suffix);
        const repository = createSqlInboxV2TenantPolicyAuthorityRepository(db);
        const approved = await repository.approveVersion(
          approveCommand({ family, policyId })
        );
        expect(approved).toMatchObject({
          kind: "approved",
          authority: {
            family,
            policyId,
            policyVersion: "v1",
            definitionDigestSha256: digest,
            approvedTrustedServiceId: "core:identity-resolver"
          }
        });

        const activated = await repository.activateVersion(
          activateCommand({ family, policyId })
        );
        expect(activated).toMatchObject({
          kind: "activated",
          activation: { state: "active", revision: "1" },
          transition: {
            operation: "activate",
            expectedHeadRevision: null,
            resultingHeadRevision: "1"
          }
        });

        const history = await db.execute<{
          operation: string;
          state: string;
          revision: string;
        }>(sql`
          select
            operation,
            resulting_state as state,
            resulting_head_revision::text as revision
          from inbox_v2_tenant_policy_activation_transitions
          where tenant_id = ${tenantA}
            and family = ${family}
            and policy_id = ${policyId}
        `);
        expect(history.rows).toEqual([
          { operation: "activate", state: "active", revision: "1" }
        ]);
      }
    );

    it("rejects cross-tenant approval actors at the composite database boundary", async () => {
      const policyId = claimPolicyId("cross-tenant");
      const error = await captureError(
        db.execute(sql`
          insert into inbox_v2_tenant_policy_versions (
            tenant_id, family, policy_id, policy_version,
            definition_contract_version, definition_digest_sha256,
            approved_trusted_service_id, approved_by_employee_id,
            approved_at, revision, created_at, updated_at
          ) values (
            ${tenantA}, 'source_identity_claim', ${policyId}, 'v1', 'v1',
            ${digest}, 'core:identity-resolver', ${employeeB}, ${t1}, 1,
            ${t1}, ${t1}
          )
        `)
      );
      expect(sqlState(error)).toBe("23514");
      expect(errorText(error)).toContain("tenant_policy_approver_invalid");
    });

    it("validates tenant, family, version, contract, digest and service exactly", async () => {
      await approveAndActivate(db, primaryPolicyId);
      const exact = exactInput(primaryPolicyId);

      await db.transaction(async (transaction) => {
        await expect(
          lockAndValidateExactActiveInboxV2TenantPolicyAuthority(
            transaction as unknown as InboxV2TenantPolicyAuthorityUseTransaction,
            exact
          )
        ).resolves.toMatchObject({ kind: "locked", headRevision: "1" });
      });

      const cases: ReadonlyArray<
        readonly [Partial<InboxV2ExactActiveTenantPolicyAuthorityInput>, string]
      > = [
        [{ tenantId: tenantB }, "policy_not_found"],
        [
          {
            family: "conversation_client_link",
            policyId: clientLinkPolicyId("wrong-family")
          },
          "policy_not_found"
        ],
        [{ policyVersion: "v2" as never }, "policy_version_conflict"],
        [
          { definitionContractVersion: "v2" as never },
          "definition_contract_version_conflict"
        ],
        [
          { definitionDigestSha256: "b".repeat(64) as never },
          "definition_digest_conflict"
        ],
        [
          { approvedTrustedServiceId: "core:other-resolver" as never },
          "trusted_service_conflict"
        ],
        [{ expectedHeadRevision: "2" as never }, "head_revision_conflict"],
        [{ occurredAt: t1 }, "occurred_before_activation"]
      ];
      for (const [overrides, kind] of cases) {
        await db.transaction(async (transaction) => {
          await expect(
            lockAndValidateExactActiveInboxV2TenantPolicyAuthority(
              transaction as unknown as InboxV2TenantPolicyAuthorityUseTransaction,
              { ...exact, ...overrides } as never
            )
          ).resolves.toMatchObject({ kind });
        });
      }
    });

    it("blocks direct mutation and enforces reciprocal transition/head commits", async () => {
      const versionUpdate = await captureError(
        db.execute(sql`
          update inbox_v2_tenant_policy_versions
          set definition_digest_sha256 = ${"c".repeat(64)}
          where tenant_id = ${tenantA}
            and family = 'source_identity_claim'
            and policy_id = ${primaryPolicyId}
            and policy_version = 'v1'
        `)
      );
      expect(sqlState(versionUpdate)).toBe("23514");
      expect(errorText(versionUpdate)).toContain(
        "tenant_policy_version_immutable"
      );

      const transitionDelete = await captureError(
        db.execute(sql`
          delete from inbox_v2_tenant_policy_activation_transitions
          where tenant_id = ${tenantA}
            and family = 'source_identity_claim'
            and policy_id = ${primaryPolicyId}
            and resulting_head_revision = 1
        `)
      );
      expect(sqlState(transitionDelete)).toBe("23514");
      expect(errorText(transitionDelete)).toContain(
        "tenant_policy_activation_transition_immutable"
      );

      const headWithoutTransition = await captureError(
        db.execute(sql`
          update inbox_v2_tenant_policy_activation_heads
          set state = 'revoked',
              revoked_by_employee_id = ${employeeA},
              revoked_at = ${t4},
              revision = 2,
              updated_at = ${t4}
          where tenant_id = ${tenantA}
            and family = 'source_identity_claim'
            and policy_id = ${primaryPolicyId}
        `)
      );
      expect(sqlState(headWithoutTransition)).toBe("23514");
      expect(errorText(headWithoutTransition)).toContain(
        "tenant_policy_activation_transition_missing"
      );

      const transitionWithoutHead = await captureError(
        db.transaction(async (transaction) => {
          await transaction.execute(sql`
            insert into inbox_v2_tenant_policy_activation_transitions (
              tenant_id, family, policy_id, operation,
              expected_head_revision, resulting_head_revision,
              previous_state, previous_policy_version,
              previous_definition_contract_version,
              previous_definition_digest_sha256,
              previous_approved_trusted_service_id, resulting_state,
              resulting_policy_version,
              resulting_definition_contract_version,
              resulting_definition_digest_sha256,
              resulting_approved_trusted_service_id, actor_employee_id,
              occurred_at, created_at
            ) values (
              ${tenantA}, 'source_identity_claim', ${primaryPolicyId},
              'revoke', 1, 2, 'active', 'v1', 'v1', ${digest},
              'core:identity-resolver', 'revoked', 'v1', 'v1', ${digest},
              'core:identity-resolver', ${employeeA}, ${t4}, ${t4}
            )
          `);
        })
      );
      expect(sqlState(transitionWithoutHead)).toBe("23514");
      expect(errorText(transitionWithoutHead)).toContain(
        "tenant_policy_activation_transition_unmaterialized"
      );
    });

    it("converges concurrent first activation to one winner and a typed CAS loser", async () => {
      const policyId = claimPolicyId("activation-race");
      const repository = createSqlInboxV2TenantPolicyAuthorityRepository(db);
      await expect(
        repository.approveVersion(approveCommand({ policyId }))
      ).resolves.toMatchObject({ kind: "approved" });

      const results = await Promise.all([
        repository.activateVersion(activateCommand({ policyId })),
        repository.activateVersion(activateCommand({ policyId }))
      ]);
      expect(results.map((result) => result.kind).sort()).toEqual([
        "activated",
        "head_revision_conflict"
      ]);
      const rows = await db.execute<{ count: string }>(sql`
        select count(*)::text as count
        from inbox_v2_tenant_policy_activation_transitions
        where tenant_id = ${tenantA}
          and family = 'source_identity_claim'
          and policy_id = ${policyId}
      `);
      expect(rows.rows[0]?.count).toBe("1");
    });

    it("serializes revoke behind an exact policy-use lock and then rejects backdated use", async () => {
      let announceLocked: (() => void) | undefined;
      const locked = new Promise<void>((resolve) => {
        announceLocked = resolve;
      });
      let releaseUse: (() => void) | undefined;
      const release = new Promise<void>((resolve) => {
        releaseUse = resolve;
      });

      const useTransaction = db.transaction(async (transaction) => {
        const result =
          await lockAndValidateExactActiveInboxV2TenantPolicyAuthority(
            transaction as unknown as InboxV2TenantPolicyAuthorityUseTransaction,
            exactInput(primaryPolicyId)
          );
        expect(result.kind).toBe("locked");
        announceLocked?.();
        await release;
      });
      await locked;

      const revokePromise = createSqlInboxV2TenantPolicyAuthorityRepository(
        db
      ).revokeVersion(
        revokeCommand({ policyId: primaryPolicyId, revokedAt: t4 })
      );
      expect(await waitForBlockedPolicyHeadLock(db)).toBe(true);
      releaseUse?.();
      await useTransaction;
      await expect(revokePromise).resolves.toMatchObject({
        kind: "revoked",
        activation: { state: "revoked", revision: "2" }
      });

      await db.transaction(async (transaction) => {
        await expect(
          lockAndValidateExactActiveInboxV2TenantPolicyAuthority(
            transaction as unknown as InboxV2TenantPolicyAuthorityUseTransaction,
            {
              ...exactInput(primaryPolicyId),
              occurredAt: t1
            } as never
          )
        ).resolves.toEqual({
          kind: "policy_inactive",
          currentHeadRevision: "2"
        });
      });
    });
  }
);

async function approveAndActivate(
  db: HuleeDatabase,
  policyId: ReturnType<typeof inboxV2IdentityClaimPolicyIdSchema.parse>
): Promise<void> {
  const repository = createSqlInboxV2TenantPolicyAuthorityRepository(db);
  const approved = await repository.approveVersion(
    approveCommand({ policyId })
  );
  expect(approved.kind).toBe("approved");
  const activated = await repository.activateVersion(
    activateCommand({ policyId })
  );
  expect(activated.kind).toBe("activated");
}

function approveCommand(input: {
  family?: InboxV2TenantPolicyFamily;
  policyId:
    | ReturnType<typeof inboxV2IdentityClaimPolicyIdSchema.parse>
    | ReturnType<typeof inboxV2ConversationClientLinkPolicyIdSchema.parse>;
}) {
  return inboxV2ApproveTenantPolicyVersionCommandSchema.parse({
    tenantId: tenantA,
    family: input.family ?? "source_identity_claim",
    policyId: input.policyId,
    policyVersion: "v1",
    definitionContractVersion: "v1",
    definitionDigestSha256: digest,
    approvedTrustedServiceId: "core:identity-resolver",
    approvedBy: { tenantId: tenantA, kind: "employee", id: employeeA },
    approvedAt: t1
  });
}

function activateCommand(input: {
  family?: InboxV2TenantPolicyFamily;
  policyId:
    | ReturnType<typeof inboxV2IdentityClaimPolicyIdSchema.parse>
    | ReturnType<typeof inboxV2ConversationClientLinkPolicyIdSchema.parse>;
}) {
  return inboxV2ActivateTenantPolicyVersionCommandSchema.parse({
    tenantId: tenantA,
    family: input.family ?? "source_identity_claim",
    policyId: input.policyId,
    policyVersion: "v1",
    expectedHeadRevision: null,
    activatedBy: { tenantId: tenantA, kind: "employee", id: employeeA },
    activatedAt: t2
  });
}

function revokeCommand(input: {
  policyId: ReturnType<typeof inboxV2IdentityClaimPolicyIdSchema.parse>;
  revokedAt?: string;
}) {
  return inboxV2RevokeTenantPolicyVersionCommandSchema.parse({
    tenantId: tenantA,
    family: "source_identity_claim",
    policyId: input.policyId,
    policyVersion: "v1",
    expectedHeadRevision: "1",
    revokedBy: { tenantId: tenantA, kind: "employee", id: employeeA },
    revokedAt: input.revokedAt ?? t4
  });
}

function exactInput(
  policyId: ReturnType<typeof inboxV2IdentityClaimPolicyIdSchema.parse>
) {
  return inboxV2ExactActiveTenantPolicyAuthorityInputSchema.parse({
    tenantId: tenantA,
    family: "source_identity_claim",
    policyId,
    policyVersion: "v1",
    definitionContractVersion: "v1",
    definitionDigestSha256: digest,
    approvedTrustedServiceId: "core:identity-resolver",
    expectedHeadRevision: "1",
    occurredAt: t3
  });
}

function claimPolicyId(suffix: string) {
  return inboxV2IdentityClaimPolicyIdSchema.parse(
    `core:db002.policy-${suffix}-${runId}`
  );
}

function clientLinkPolicyId(suffix: string) {
  return inboxV2ConversationClientLinkPolicyIdSchema.parse(
    `core:db002.client-link-${suffix}-${runId}`
  );
}

async function seedTenantAndEmployee(
  db: HuleeDatabase,
  tenantId: typeof tenantA,
  employeeId: string,
  suffix: string
): Promise<void> {
  await db.execute(sql`
    insert into tenants (id, slug, display_name, deployment_type)
    values (
      ${tenantId}, ${`db002-policy-${suffix}-${runId}`},
      ${`DB002 policy tenant ${suffix}`}, 'saas_shared'
    )
  `);
  await db.execute(sql`
    insert into employees (
      id, tenant_id, email, display_name, profile, created_at, updated_at
    ) values (
      ${employeeId}, ${tenantId},
      ${`db002-policy-${suffix}-${runId}@example.test`},
      ${`DB002 policy actor ${suffix}`}, '{}'::jsonb, ${t0}, ${t0}
    )
  `);
}

async function waitForBlockedPolicyHeadLock(
  db: HuleeDatabase
): Promise<boolean> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const waiting = await db.execute<{ waiting: string }>(sql`
      select count(*)::text as waiting
      from pg_catalog.pg_stat_activity activity_row
      where activity_row.datname = current_database()
        and activity_row.pid <> pg_backend_pid()
        and activity_row.wait_event_type = 'Lock'
        and activity_row.query like
          '%inbox_v2_tenant_policy_activation_heads%'
    `);
    if (waiting.rows[0]?.waiting !== "0") return true;
    await delay(25);
  }
  return false;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected PostgreSQL operation to fail.");
}

function sqlState(error: unknown): string | null {
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

function errorText(error: unknown): string {
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
