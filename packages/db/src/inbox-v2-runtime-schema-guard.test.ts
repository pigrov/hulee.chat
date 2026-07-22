import { describe, expect, it } from "vitest";

import {
  assertInboxV2RuntimeSchemaEpoch,
  assertInboxV2RuntimeSchemaEpochDeclaration,
  inboxV2RuntimeSchemaContract,
  InboxV2RuntimeSchemaEpochError
} from "./inbox-v2-runtime-schema-guard";

describe("Inbox V2 runtime schema epoch guard", () => {
  it("requires the exact epoch declaration in production", () => {
    expect(() =>
      assertInboxV2RuntimeSchemaEpochDeclaration({
        runtimeEnvironment: "production",
        declaredEpoch: "preproduction-inbox-v2-1"
      })
    ).not.toThrow();
    expect(() =>
      assertInboxV2RuntimeSchemaEpochDeclaration({
        runtimeEnvironment: "production",
        declaredEpoch: undefined
      })
    ).toThrow(/runtime_schema_epoch_mismatch/u);
    expect(() =>
      assertInboxV2RuntimeSchemaEpochDeclaration({
        runtimeEnvironment: "test",
        declaredEpoch: "stale"
      })
    ).toThrow(/runtime_schema_epoch_mismatch/u);
  });

  it("accepts only the exact clean-slate journal and V2-only relation set", async () => {
    const database = fakeDatabase([
      [currentProbe()],
      inboxV2RuntimeSchemaContract.migrations.map(({ hash, createdAt }) => ({
        hash,
        created_at: createdAt
      }))
    ]);

    await expect(assertInboxV2RuntimeSchemaEpoch(database)).resolves.toEqual({
      epoch: "preproduction-inbox-v2-1",
      migrationCount: 1,
      currentInboxRelation: "inbox_v2_conversations",
      legacyInboxRelationCount: 0,
      legacyInboxTypeCount: 0
    });
  });

  it.each([
    [
      "missing journal",
      [{ ...currentProbe(), migration_relation_exists: false }],
      []
    ],
    [
      "missing V2 relation",
      [{ ...currentProbe(), current_inbox_relation_exists: false }],
      []
    ],
    [
      "retained V1 relation",
      [{ ...currentProbe(), legacy_messages_relation_exists: true }],
      []
    ],
    [
      "retained V1 enum",
      [{ ...currentProbe(), legacy_message_status_type_exists: true }],
      []
    ],
    [
      "stale migration hash",
      [currentProbe()],
      [{ hash: "stale", created_at: "1784656735719" }]
    ],
    [
      "newer migration journal",
      [currentProbe()],
      [
        ...inboxV2RuntimeSchemaContract.migrations.map(
          ({ hash, createdAt }) => ({ hash, created_at: createdAt })
        ),
        { hash: "newer", created_at: "1784656735720" }
      ]
    ]
  ])("fails closed for %s", async (_label, probe, migrations) => {
    const database = fakeDatabase([probe, migrations]);

    await expect(
      assertInboxV2RuntimeSchemaEpoch(database)
    ).rejects.toMatchObject({
      name: "InboxV2RuntimeSchemaEpochError",
      code: "inbox_v2.runtime_schema_epoch_mismatch"
    });
  });

  it("turns probe failures into a diagnosable unavailable error", async () => {
    const cause = new Error("connection refused");
    const database = {
      $client: {
        query: async () => {
          throw cause;
        }
      }
    };

    await expect(
      assertInboxV2RuntimeSchemaEpoch(database as never)
    ).rejects.toEqual(
      expect.objectContaining<Partial<InboxV2RuntimeSchemaEpochError>>({
        code: "inbox_v2.runtime_schema_unavailable",
        cause
      })
    );
  });
});

function currentProbe() {
  return {
    migration_relation_exists: true,
    current_inbox_relation_exists: true,
    legacy_conversations_relation_exists: false,
    legacy_participants_relation_exists: false,
    legacy_messages_relation_exists: false,
    legacy_delivery_relation_exists: false,
    legacy_attachments_relation_exists: false,
    legacy_conversation_type_exists: false,
    legacy_message_direction_type_exists: false,
    legacy_message_status_type_exists: false
  };
}

function fakeDatabase(results: readonly (readonly unknown[])[]) {
  let index = 0;
  return {
    $client: {
      async query() {
        return { rows: results[index++] ?? [] };
      }
    }
  } as never;
}
