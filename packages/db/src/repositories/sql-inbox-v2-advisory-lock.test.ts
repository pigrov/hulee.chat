import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildInboxV2AdvisoryLockKeySql,
  buildInboxV2AdvisoryXactLockSql
} from "./sql-inbox-v2-advisory-lock";

describe("Inbox V2 PostgreSQL advisory lock key", () => {
  it("hashes separate typed JSON-array elements without an invalid NUL text parameter", () => {
    const rendered = new PgDialect().sqlToQuery(
      buildInboxV2AdvisoryXactLockSql(["tenant:one", "run:one", "revision:1"])
    );
    expect(rendered.sql).toContain("jsonb_build_array(");
    expect(rendered.sql).toContain("$1::text, $2::text, $3::text");
    expect(rendered.params).toEqual(["tenant:one", "run:one", "revision:1"]);
    expect(rendered.params.join("")).not.toContain("\u0000");
  });

  it("preserves structural field boundaries instead of delimiter concatenation", () => {
    const dialect = new PgDialect();
    const left = dialect.sqlToQuery(
      buildInboxV2AdvisoryLockKeySql(["tenant:a:b", "job:c"])
    );
    const right = dialect.sqlToQuery(
      buildInboxV2AdvisoryLockKeySql(["tenant:a", "b:job:c"])
    );
    expect(left.sql).toBe(right.sql);
    expect(left.params).not.toEqual(right.params);
  });
});
