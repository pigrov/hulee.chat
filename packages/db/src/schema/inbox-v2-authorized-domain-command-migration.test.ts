import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationPath =
  "packages/db/drizzle/0040_inbox_v2_authorized_domain_command.sql";

describe("Inbox V2 authorized domain command migration", () => {
  it("adds the zero-delta domain profile without weakening relation mutations", async () => {
    const ddl = (await readFile(migrationPath, "utf8")).toLowerCase();

    expect(ddl).toContain("inb2-src-011_authorized_domain_command_v1");
    expect(ddl).toContain(
      '"revision_effect_count" = 0\n          and "inbox_v2_auth_mutation_commits"."relation_write_count" = 0'
    );
    expect(ddl).toContain(
      '"revision_effect_count" >= 1\n          and "inbox_v2_auth_mutation_commits"."relation_write_count" >= 1'
    );
    expect(ddl).toContain(
      "create or replace function public.inbox_v2_auth_domain_mutation_coherence()"
    );
    expect(ddl).toContain("set search_path = pg_catalog, public, pg_temp");
    expect(ddl).toContain(
      "when (new.revision_effect_count > 0 and new.relation_write_count > 0)"
    );
    expect(ddl).toContain(
      "execute function public.inbox_v2_auth_mutation_coherence()"
    );
    expect(ddl).toContain(
      "when (new.revision_effect_count = 0 and new.relation_write_count = 0)"
    );
    expect(ddl).toContain(
      "execute function public.inbox_v2_auth_domain_mutation_coherence()"
    );
  });

  it("seals domain commands to non-RBAC events and exact empty deltas", async () => {
    const ddl = (await readFile(migrationPath, "utf8")).toLowerCase();

    for (const fragment of [
      "domain_mutation_authorization_delta_forbidden",
      "v_authorization_event_count <> 0",
      "event_row.access_effect <> 'none'",
      "event_row.access_effect_causes <> '[]'::jsonb",
      "v_stream.audience_impact_kind <> 'none'",
      "domain_mutation_stream_manifest_incomplete",
      "domain_mutation_stream_digest_mismatch",
      "domain_mutation_audit_manifest_incomplete",
      "domain_mutation_stream_head_not_closed",
      "domain_mutation_digest_mismatch"
    ]) {
      expect(ddl).toContain(fragment);
    }

    expect(
      ddl.match(/inb2-src-011_authorized_domain_command_v1/g)
    ).toHaveLength(1);
  });
});
