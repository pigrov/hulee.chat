export const INBOX_V2_SOURCE_GATE_TASK_IDS = Object.freeze([
  "INB2-SRC-001",
  "INB2-SRC-010",
  "INB2-SRC-011",
  "INB2-SRC-002",
  "INB2-SRC-003",
  "INB2-SRC-004",
  "INB2-SRC-005",
  "INB2-SRC-006",
  "INB2-SRC-007",
  "INB2-SRC-008",
  "INB2-SRC-009"
]);

export const INBOX_V2_SOURCE_GATE_TASK_GROUPS = Object.freeze([
  taskGroup("INB2-SRC-001", "Source foundation", [
    "scripts/test/run-inbox-v2-source-gate.test.mjs",
    "packages/contracts/src/source-normalizer-contract.test.ts",
    "packages/contracts/src/source-idempotency.test.ts",
    "packages/contracts/src/source-processing.test.ts",
    "packages/contracts/src/source-identity.test.ts",
    "packages/contracts/src/source-conversation.test.ts",
    "packages/contracts/src/source-megapbx.test.ts",
    "packages/contracts/src/source-capabilities.test.ts",
    "packages/contracts/src/source-catalog.test.ts",
    "packages/db/src/repositories/sql-source-integration-repository.test.ts",
    "packages/db/src/schema/inbox-v2-identity-foundation-schema.test.ts"
  ]),
  taskGroup("INB2-SRC-010", "Source registry", [
    "packages/contracts/src/inbox-v2/source-registry.test.ts",
    "packages/modules/src/source-adapter-registry.test.ts",
    "packages/contracts/src/inbox-v2/public-boundary.test.ts",
    "packages/db/src/repositories/sql-inbox-v2-source-registry-repository.test.ts",
    "packages/db/src/schema/inbox-v2-source-registry-schema.test.ts",
    "apps/api/src/internal-integrations-service.test.ts",
    "apps/api/src/http/internal-api-handler.test.ts"
  ]),
  taskGroup("INB2-SRC-011", "Authorized source onboarding", [
    "packages/contracts/src/internal-api-v1.test.ts",
    "apps/api/src/source-registry-onboarding.test.ts",
    "apps/web/src/source-connection-client-mutation-id.server.test.ts",
    "packages/db/src/schema/inbox-v2-source-onboarding-result-migration.test.ts"
  ]),
  taskGroup("INB2-SRC-002", "Raw ingress", [
    "packages/contracts/src/inbox-v2/source-raw-ingress.test.ts",
    "apps/worker/src/source-ingress-record-and-acknowledge.test.ts",
    "packages/db/src/repositories/sql-inbox-v2-raw-ingress-repository.test.ts",
    "packages/db/src/schema/inbox-v2-source-raw-ingress-schema.test.ts"
  ]),
  taskGroup("INB2-SRC-003", "Normalization", [
    "packages/contracts/src/inbox-v2/source-normalized-ingress.test.ts",
    "apps/worker/src/source-normalization-processor.test.ts",
    "apps/worker/src/source-normalization-runtime-handler.test.ts",
    "packages/db/src/repositories/sql-inbox-v2-source-normalization-repository.test.ts",
    "packages/db/src/schema/inbox-v2-source-normalization-schema.test.ts"
  ]),
  taskGroup("INB2-SRC-004", "Identity and participant resolution", [
    "packages/contracts/src/inbox-v2/source-account-identity.test.ts",
    "packages/contracts/src/inbox-v2/source-identity-resolution.test.ts",
    "packages/contracts/src/inbox-v2/participant-identity.test.ts",
    "apps/worker/src/source-identity-resolution-processor.test.ts",
    "apps/worker/src/source-participant-materialization.test.ts",
    "apps/api/src/inbox-v2-identity-claim-command.test.ts",
    "packages/db/src/repositories/sql-inbox-v2-source-external-identity-repository.test.ts",
    "packages/db/src/repositories/sql-inbox-v2-source-identity-resolution-repository.test.ts",
    "packages/db/src/repositories/sql-inbox-v2-source-identity-resolution-lifecycle.test.ts",
    "packages/db/src/repositories/sql-inbox-v2-source-identity-claim-repository.test.ts",
    "packages/db/src/repositories/sql-inbox-v2-source-identity-claim-authorized-repository.test.ts",
    "packages/db/src/schema/inbox-v2-source-identity-resolution-schema.test.ts",
    "packages/testing/src/inbox-v2/external-scenarios.test.ts"
  ]),
  taskGroup("INB2-SRC-005", "Conversation resolution", [
    "packages/contracts/src/inbox-v2/source-conversation-resolution.test.ts",
    "packages/contracts/src/inbox-v2/source-thread-binding.test.ts",
    "apps/worker/src/source-conversation-resolution-materializer.test.ts",
    "apps/worker/src/source-conversation-resolution-plan-verifier.test.ts",
    "packages/db/src/repositories/sql-inbox-v2-source-conversation-resolution-repository.test.ts",
    "packages/db/src/repositories/sql-inbox-v2-external-thread-repository.test.ts",
    "packages/db/src/repositories/sql-inbox-v2-source-thread-binding-repository.test.ts",
    "packages/db/src/schema/inbox-v2-external-thread-schema.test.ts",
    "packages/db/src/schema/inbox-v2-source-thread-binding-schema.test.ts"
  ]),
  taskGroup("INB2-SRC-006", "Message reconciliation and late events", [
    "packages/contracts/src/inbox-v2/source-message-reconciliation.test.ts",
    "packages/contracts/src/inbox-v2/message-source-action.test.ts",
    "apps/worker/src/source-message-reconciliation-materializer.test.ts",
    "apps/worker/src/source-message-reconciliation-plan-verifier.test.ts",
    "packages/db/src/repositories/sql-inbox-v2-source-message-reconciliation-repository.test.ts",
    "packages/db/src/schema/inbox-v2-source-message-reconciliation-schema.test.ts",
    "packages/db/src/schema/inbox-v2-source-message-reconciliation-migration.test.ts"
  ]),
  taskGroup("INB2-SRC-007", "Atomic materialization", [
    "packages/contracts/src/inbox-v2/source-occurrence-materialization.test.ts",
    "packages/contracts/src/inbox-v2/timeline-source-object-commit.test.ts",
    "packages/db/src/repositories/sql-inbox-v2-source-occurrence-repository.test.ts",
    "packages/db/src/repositories/sql-inbox-v2-atomic-materialization-internal.test.ts",
    "packages/db/src/repositories/sql-inbox-v2-timeline-message-repository.test.ts",
    "packages/db/src/repositories/sql-inbox-v2-authorization-repository.test.ts",
    "packages/db/src/schema/inbox-v2-source-occurrence-schema.test.ts",
    "packages/db/src/schema/inbox-v2-atomic-provider-io-closure-migration.test.ts"
  ]),
  taskGroup("INB2-SRC-008", "Replay, DLQ, diagnostics and backpressure", [
    "packages/contracts/src/inbox-v2/source-processing-runtime.test.ts",
    "apps/worker/src/source-processing-production-activation.test.ts",
    "apps/worker/src/source-processing-runtime-coordinator.test.ts",
    "apps/worker/src/source-processing-runtime-factory.test.ts",
    "packages/db/src/repositories/sql-inbox-v2-source-processing-runtime-repository.test.ts",
    "packages/db/src/schema/inbox-v2-source-processing-runtime-schema.test.ts"
  ]),
  taskGroup("INB2-SRC-009", "Outbox lease and outcome lifecycle", [
    "apps/worker/src/inbox-v2-provider-dispatch-coordinator.test.ts",
    "packages/contracts/src/inbox-v2/outbound-dispatch.test.ts",
    "packages/contracts/src/inbox-v2/repository-foundation.test.ts",
    "packages/db/src/repositories/sql-inbox-v2-outbound-transport-repository.test.ts",
    "packages/db/src/repositories/sql-inbox-v2-repository-outbox.test.ts",
    "packages/db/src/schema/inbox-v2-repository-foundation-schema.test.ts",
    "packages/db/src/schema/inbox-v2-outbox-terminal-payload-migration.test.ts",
    "packages/db/src/index.test.ts"
  ])
]);

function taskGroup(taskId, label, testFiles) {
  return Object.freeze({
    taskId,
    label,
    testFiles: Object.freeze(testFiles)
  });
}
