import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createInboxV2ScenarioAuthorization,
  inboxV2CanonicalScenarioGuard,
  inboxV2ScenarioEntity,
  inboxV2ScenarioLater
} from "./scenario-fixtures";
import {
  createInboxV2ScenarioWorld,
  executeInboxV2ScenarioStep,
  getInboxV2ScenarioRecord,
  snapshotInboxV2ScenarioWorld,
  type InboxV2ScenarioStep
} from "./scenario-world";

const tenantId = "tenant:scenario-world-security";
const actorId = "employee:scenario-world-security-operator";
const recordEntity = inboxV2ScenarioEntity(
  tenantId,
  "core:employee",
  "employee:scenario-world-security-record"
);
const recordSchemaId = "module:hulee-testing:scenario-security-record";
const recordSchema = z
  .object({
    tenantId: z.string(),
    id: z.string(),
    revision: z.string(),
    label: z.string()
  })
  .strict();

describe("Inbox V2 scenario-world security invariants", () => {
  it("re-authorizes a replay before exposing its canonical result", () => {
    const initial = scenarioWorld();
    const committedStep = upsertStep({
      suffix: "replay-revocation",
      authorization: scenarioAuthorization(true),
      expectedRevision: "1",
      resultingRevision: "2",
      label: "edited"
    });
    const committed = executeInboxV2ScenarioStep(initial, committedStep);
    expect(committed.outcome).toBe("committed");
    if (committed.outcome !== "committed") return;

    const beforeReplay = snapshotInboxV2ScenarioWorld(committed.world);
    let transitionCalls = 0;
    const revokedReplay = executeInboxV2ScenarioStep(committed.world, {
      ...committedStep,
      authorization: scenarioAuthorization(false),
      transition: () => {
        transitionCalls += 1;
        throw new Error("A replay must never execute its transition.");
      }
    });

    expect(revokedReplay.outcome).toBe("rejected");
    expect("result" in revokedReplay).toBe(false);
    expect(revokedReplay.world).toBe(committed.world);
    expect(snapshotInboxV2ScenarioWorld(revokedReplay.world)).toEqual(
      beforeReplay
    );
    expect(transitionCalls).toBe(0);

    const allowedReplay = executeInboxV2ScenarioStep(committed.world, {
      ...committedStep,
      transition: () => {
        transitionCalls += 1;
        throw new Error("A replay must never execute its transition.");
      }
    });
    expect(allowedReplay.outcome).toBe("replayed");
    expect(allowedReplay.world).toBe(committed.world);
    expect(transitionCalls).toBe(0);
  });

  it("emits and applies a canonical tombstone with no retained payload", () => {
    const edited = executeInboxV2ScenarioStep(
      scenarioWorld(),
      upsertStep({
        suffix: "edit-before-tombstone",
        authorization: scenarioAuthorization(true),
        expectedRevision: "1",
        resultingRevision: "2",
        label: "edited"
      })
    );
    expect(edited.outcome).toBe("committed");
    if (edited.outcome !== "committed") return;

    const deleted = executeInboxV2ScenarioStep(
      edited.world,
      tombstoneStep({
        suffix: "canonical-tombstone",
        expectedRevision: "2",
        resultingRevision: "3"
      })
    );
    expect(deleted.outcome).toBe("committed");
    if (deleted.outcome !== "committed") return;

    expect(deleted.commit.changes[0]).toMatchObject({
      entity: recordEntity,
      resultingRevision: "3",
      state: {
        kind: "tombstone",
        reasonId: "core:scenario-security-delete"
      }
    });
    expect(deleted.commit.changes[0]!.state).not.toHaveProperty(
      "payloadReference"
    );
    expect(getInboxV2ScenarioRecord(deleted.world, recordEntity)).toMatchObject(
      {
        revision: "3",
        state: "tombstone",
        value: null
      }
    );
  });

  it("rejects stale delete, duplicate delete, stale resurrection and revival", () => {
    const edited = executeInboxV2ScenarioStep(
      scenarioWorld(),
      upsertStep({
        suffix: "conflict-edit",
        authorization: scenarioAuthorization(true),
        expectedRevision: "1",
        resultingRevision: "2",
        label: "edited"
      })
    );
    expect(edited.outcome).toBe("committed");
    if (edited.outcome !== "committed") return;
    const deleted = executeInboxV2ScenarioStep(
      edited.world,
      tombstoneStep({
        suffix: "conflict-delete",
        expectedRevision: "2",
        resultingRevision: "3"
      })
    );
    expect(deleted.outcome).toBe("committed");
    if (deleted.outcome !== "committed") return;

    const beforeConflicts = snapshotInboxV2ScenarioWorld(deleted.world);
    const conflicts = [
      executeInboxV2ScenarioStep(
        deleted.world,
        tombstoneStep({
          suffix: "stale-delete",
          expectedRevision: "2",
          resultingRevision: "3"
        })
      ),
      executeInboxV2ScenarioStep(
        deleted.world,
        tombstoneStep({
          suffix: "duplicate-delete",
          expectedRevision: "3",
          resultingRevision: "4"
        })
      ),
      executeInboxV2ScenarioStep(
        deleted.world,
        upsertStep({
          suffix: "stale-resurrection",
          authorization: scenarioAuthorization(true),
          expectedRevision: "2",
          resultingRevision: "3",
          label: "stale"
        })
      ),
      executeInboxV2ScenarioStep(
        deleted.world,
        upsertStep({
          suffix: "revival",
          authorization: scenarioAuthorization(true),
          expectedRevision: "3",
          resultingRevision: "4",
          label: "revived"
        })
      )
    ];

    for (const conflict of conflicts) {
      expect(conflict).toMatchObject({
        outcome: "conflict",
        errorCode: "revision.conflict"
      });
      expect(conflict.world).toBe(deleted.world);
      expect(snapshotInboxV2ScenarioWorld(conflict.world)).toEqual(
        beforeConflicts
      );
    }
  });
});

function scenarioWorld() {
  return createInboxV2ScenarioWorld({
    tenantId,
    records: [
      {
        entity: recordEntity,
        revision: "1",
        schemaId: recordSchemaId,
        schema: recordSchema,
        value: recordValue("1", "initial")
      }
    ]
  });
}

function scenarioAuthorization(granted: boolean) {
  return createInboxV2ScenarioAuthorization({
    tenantId,
    employeeId: actorId,
    requirements: [
      {
        id: "scenario-record-read",
        permissionId: "core:employee.directory.view",
        resource: recordEntity,
        guard: inboxV2CanonicalScenarioGuard("none")
      }
    ],
    grants: granted
      ? [
          {
            id: "scenario-record-read-grant",
            permissionId: "core:employee.directory.view"
          }
        ]
      : []
  });
}

function upsertStep(input: {
  suffix: string;
  authorization: ReturnType<typeof scenarioAuthorization>;
  expectedRevision: string;
  resultingRevision: string;
  label: string;
}): InboxV2ScenarioStep {
  return baseStep(input.suffix, input.authorization, {
    kind: "commit",
    changes: [
      {
        kind: "upsert",
        entity: recordEntity,
        expectedRevision: input.expectedRevision,
        resultingRevision: input.resultingRevision,
        schemaId: recordSchemaId,
        schema: recordSchema,
        value: recordValue(input.resultingRevision, input.label),
        audience: "staff_only"
      }
    ],
    resultEntity: recordEntity
  });
}

function tombstoneStep(input: {
  suffix: string;
  expectedRevision: string;
  resultingRevision: string;
}): InboxV2ScenarioStep {
  return baseStep(input.suffix, scenarioAuthorization(true), {
    kind: "commit",
    changes: [
      {
        kind: "tombstone",
        entity: recordEntity,
        expectedRevision: input.expectedRevision,
        resultingRevision: input.resultingRevision,
        schemaId: recordSchemaId,
        value: null,
        reasonId: "core:scenario-security-delete",
        audience: "staff_only"
      }
    ],
    resultEntity: recordEntity
  });
}

function baseStep(
  suffix: string,
  authorization: ReturnType<typeof scenarioAuthorization>,
  transition: ReturnType<InboxV2ScenarioStep["transition"]>
): InboxV2ScenarioStep {
  const token = suffix.replaceAll(/[^A-Za-z0-9]/gu, "-");
  return {
    id: suffix,
    commandId: `scenario-command:security-${token}`,
    requestId: `scenario-request:security-${token}`,
    clientMutationId: `scenario-mutation:security-${token}`,
    requestHash: `sha256:${"b".repeat(64)}`,
    committedAt: inboxV2ScenarioLater,
    authorization,
    transition: () => transition
  };
}

function recordValue(revision: string, label: string) {
  return {
    tenantId,
    id: recordEntity.entityId,
    revision,
    label
  };
}
