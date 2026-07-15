import { describe, expect, it } from "vitest";

import {
  INBOX_V2_MEMBERSHIP_DB_RETRY_POLICY,
  INBOX_V2_MEMBERSHIP_PRIVILEGE_AUDIT_SQL,
  INBOX_V2_MEMBERSHIP_PRIVILEGE_BOUNDARY_SQL
} from "./inbox-v2/membership-privilege-boundary";

const SQL = INBOX_V2_MEMBERSHIP_PRIVILEGE_BOUNDARY_SQL;
const REVISION_TABLES = [
  "inbox_v2_conversation_membership_heads",
  "inbox_v2_conversation_membership_commits",
  "inbox_v2_participant_membership_episodes",
  "inbox_v2_participant_membership_transitions"
] as const;

describe("Inbox V2 membership database privilege boundary", () => {
  it("bootstraps isolated NOLOGIN group roles without an owner-membership path", () => {
    for (const role of [
      "hulee_inbox_v2_membership_owner",
      "hulee_inbox_v2_runtime",
      "hulee_inbox_v2_membership_repair"
    ]) {
      expect(SQL).toMatch(
        new RegExp(
          `create role ${role}\\s+` +
            "nologin nosuperuser nocreatedb nocreaterole\\s+" +
            "inherit noreplication nobypassrls",
          "s"
        )
      );
      expect(SQL).toMatch(
        new RegExp(
          `alter role ${role}\\s+with nologin nosuperuser nocreatedb nocreaterole\\s+` +
            "inherit noreplication nobypassrls",
          "s"
        )
      );
    }

    expect(SQL).toContain("membership_owner_role_must_not_be_inherited");
    expect(SQL).toMatch(
      /pg_has_role\(\s*'hulee_inbox_v2_runtime',\s*'hulee_inbox_v2_membership_owner',\s*'MEMBER'/s
    );
    expect(SQL).toMatch(
      /pg_has_role\(\s*'hulee_inbox_v2_membership_repair',\s*'hulee_inbox_v2_membership_owner',\s*'MEMBER'/s
    );
    expect(SQL).toMatch(
      /revoke create on schema public\s+from[\s\S]*hulee_inbox_v2_runtime[\s\S]*hulee_inbox_v2_membership_repair/s
    );
  });

  it("denies every direct revision-table mutation while preserving SELECT", () => {
    const revokeBlock = blockBetween(
      "revoke all privileges on table",
      "grant select on table"
    );
    const selectBlock = blockBetween(
      "grant select on table",
      "grant select, insert, update, delete on table"
    );
    const ownerBlock = blockBetween(
      "grant select, insert, update, delete on table",
      "create or replace function"
    );

    for (const table of REVISION_TABLES) {
      expect(revokeBlock).toContain(`public.${table}`);
      expect(selectBlock).toContain(`public.${table}`);
      expect(ownerBlock).toContain(`public.${table}`);
    }
    expect(revokeBlock).toContain("from public");
    expect(revokeBlock).toContain("hulee_inbox_v2_runtime");
    expect(revokeBlock).toContain("hulee_inbox_v2_membership_repair");
    expect(selectBlock).not.toMatch(
      /\b(?:insert|update|delete|truncate|references|trigger)\b/u
    );
    expect(ownerBlock).toContain("hulee_inbox_v2_membership_owner");
    expect(SQL).toMatch(
      /grant select on table\s+public\.inbox_v2_conversation_participants,\s+public\.inbox_v2_conversations,\s+public\.employees,[\s\S]*to hulee_inbox_v2_membership_owner/s
    );
    expect(SQL).toMatch(
      /grant update on table\s+public\.inbox_v2_conversation_participants,\s+public\.employees,\s+public\.inbox_v2_provider_membership_ordering_heads\s+to hulee_inbox_v2_membership_owner/s
    );
    expect(SQL).toContain("membership_lock_target_privileges_invalid");
  });

  it("uses fixed-search-path SECURITY DEFINER head-lock and mutation entrypoints", () => {
    expect(SQL).toMatch(
      /create or replace function public\.inbox_v2_lock_conversation_membership_head_v1\([\s\S]*?\)\s*returns bigint\s*language plpgsql\s*security definer\s*set search_path = pg_catalog, public, pg_temp/s
    );
    expect(SQL).toMatch(
      /create or replace function public\.inbox_v2_lock_participant_membership_mutation_v1\([\s\S]*?\)\s*returns bigint\s*language plpgsql\s*security definer\s*set search_path = pg_catalog, public, pg_temp/s
    );
    expect(SQL).toMatch(
      /create or replace function public\.inbox_v2_apply_participant_membership_mutation_v1\(\s*checked_payload jsonb\s*\)[\s\S]*?returns bigint\s*language plpgsql\s*security definer\s*set search_path = pg_catalog, public, pg_temp/s
    );
    expect(SQL).toMatch(
      /alter function public\.inbox_v2_lock_participant_membership_mutation_v1\([\s\S]*?\) owner to hulee_inbox_v2_membership_owner/s
    );
    expect(SQL).toMatch(
      /grant create on schema public to hulee_inbox_v2_membership_owner;[\s\S]*alter function[\s\S]*revoke create on schema public from hulee_inbox_v2_membership_owner;/s
    );
    expect(SQL).toMatch(
      /revoke all privileges on function[\s\S]*?from public/s
    );
    expect(SQL).toMatch(
      /grant execute on function\s+public\.inbox_v2_lock_conversation_membership_head_v1\(text, text\)\s+to hulee_inbox_v2_runtime,\s*hulee_inbox_v2_membership_repair/s
    );
    expect(SQL).toMatch(
      /grant execute on function\s+public\.inbox_v2_apply_participant_membership_mutation_v1\(jsonb\)\s+to hulee_inbox_v2_runtime,\s*hulee_inbox_v2_membership_repair/s
    );
    expect(SQL).toMatch(
      /revoke all privileges on function\s+public\.inbox_v2_lock_participant_membership_mutation_v1\([\s\S]*?from public,\s+hulee_inbox_v2_runtime,\s+hulee_inbox_v2_membership_repair/s
    );
    expect(SQL).not.toMatch(
      /set_config|current_setting\('inbox_v2\.|current_setting\('app\./u
    );
    expect(SQL).toMatch(
      /pg_catalog\.pg_proc[\s\S]*procedure_row\.prosecdef[\s\S]*procedure_row\.proconfig @>[\s\S]*search_path=pg_catalog, public, pg_temp/s
    );
    expect(SQL).toMatch(
      /pg_catalog\.aclexplode[\s\S]*privilege_row\.grantee = 0[\s\S]*privilege_row\.privilege_type = 'EXECUTE'/s
    );
  });

  it("rejects non-READ-COMMITTED transactions using PostgreSQL state", () => {
    expect(SQL).toMatch(
      /current_setting\('transaction_isolation'\) <> 'read committed'/u
    );
    expect(SQL).toContain("errcode = '25001'");
    expect(SQL).toContain("inbox_v2.membership_requires_read_committed");
    expect(SQL).not.toMatch(/set transaction isolation level/u);
  });

  it("accepts only closed v1 payloads and performs the fixed atomic writes", () => {
    expect(SQL).toContain("checked_payload ?& allowed_keys");
    expect(SQL).toContain("checked_payload - allowed_keys <> '{}'::jsonb");
    expect(SQL).toContain("membership_mutation_payload_shape_invalid");
    expect(SQL).toContain("mutation_version <> 1");
    expect(SQL).toContain("pg_catalog.isfinite(mutation_occurred_at)");
    expect(SQL).toContain("clock_timestamp() + interval '5 minutes'");
    for (const write of [
      "insert into public.inbox_v2_conversation_membership_commits",
      "insert into public.inbox_v2_participant_membership_episodes",
      "insert into public.inbox_v2_participant_membership_transitions",
      "update public.inbox_v2_participant_membership_episodes",
      "update public.inbox_v2_conversation_membership_heads"
    ]) {
      expect(SQL).toContain(write);
    }
  });

  it("locks head, Employee fence, participant and episode in ADR 0010 order", () => {
    const functionBody = blockBetween(
      "as $function$",
      "$function$;",
      SQL.indexOf("inbox_v2_lock_participant_membership_mutation_v1")
    );
    const headLock = functionBody.indexOf(
      "from public.inbox_v2_conversation_membership_heads"
    );
    const employeeLock = functionBody.indexOf(
      "for no key update of employee_row"
    );
    const participantLock = functionBody.indexOf(
      "from public.inbox_v2_conversation_participants participant_row",
      employeeLock + 1
    );
    const episodeLock = functionBody.lastIndexOf(
      "from public.inbox_v2_participant_membership_episodes episode_row"
    );

    expect(headLock).toBeGreaterThanOrEqual(0);
    expect(functionBody.indexOf("for update", headLock)).toBeGreaterThan(
      headLock
    );
    expect(employeeLock).toBeGreaterThan(headLock);
    expect(participantLock).toBeGreaterThan(employeeLock);
    expect(episodeLock).toBeGreaterThan(participantLock);
    expect(functionBody.indexOf("for update", episodeLock)).toBeGreaterThan(
      episodeLock
    );
  });

  it("keeps deactivation checks for open internal membership but allows closure", () => {
    expect(SQL).toMatch(
      /checked_origin_kind = 'hulee_internal_command'[\s\S]*for no key update of employee_row/s
    );
    expect(SQL).toMatch(
      /checked_target_state in \('pending', 'active'\)[\s\S]*locked_employee_deactivated_at is not null/s
    );
    expect(SQL).toContain("locked_conversation_transport <> 'internal'");
  });

  it("publishes the bounded ADR 0010 retry policy", () => {
    expect(INBOX_V2_MEMBERSHIP_DB_RETRY_POLICY).toEqual({
      maxAttempts: 3,
      retryableSqlStates: ["40P01", "40001"]
    });
  });

  it("exports a catalog audit for migration and live privilege verification", () => {
    const auditSql = INBOX_V2_MEMBERSHIP_PRIVILEGE_AUDIT_SQL;

    expect(auditSql).toContain("pg_catalog.has_table_privilege");
    expect(auditSql).toContain("database_roles_restricted");
    expect(auditSql).toContain("direct_mutation_denied");
    expect(auditSql).toContain("revision_select_allowed");
    expect(auditSql).toContain("lock_target_privileges_safe");
    expect(auditSql).toContain("entrypoint_security_definer");
    expect(auditSql).toContain("head_lock_entrypoint_safe");
    expect(auditSql).toContain("entrypoint_fixed_writes");
    expect(auditSql).toContain("entrypoint_search_path_fixed");
    expect(auditSql).toContain("entrypoint_owner_isolated");
    expect(auditSql).toContain("entrypoint_public_execute_denied");
    expect(auditSql).toContain("entrypoint_expected_execute_allowed");
    expect(auditSql).toContain("lock_helper_not_executable");
    expect(auditSql).toContain("owner_role_not_inherited");
    for (const privilege of [
      "INSERT",
      "UPDATE",
      "DELETE",
      "TRUNCATE",
      "REFERENCES",
      "TRIGGER"
    ]) {
      expect(auditSql).toContain(`('${privilege}')`);
    }
  });
});

function blockBetween(start: string, end: string, fromIndex = 0): string {
  const startIndex = SQL.indexOf(start, fromIndex);
  const endIndex = SQL.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return SQL.slice(startIndex, endIndex);
}
