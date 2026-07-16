import type {
  EmployeeId,
  InboxV2SourceRegistryLifecycleLocator,
  InboxV2SourceRegistrySecretReference,
  SourceCatalogItem,
  SourceConnectionId,
  TenantId
} from "@hulee/contracts";
import {
  INBOX_V2_SOURCE_ONBOARDING_ONE_TIME_RESPONSE_SCHEMA_ID,
  INBOX_V2_SOURCE_ONBOARDING_WEBHOOK_TOKEN_FIELD_ID,
  inboxV2EntityRevisionSchema,
  inboxV2SourceThreadBindingTransitionActorSchema,
  inboxV2TenantIdSchema,
  inboxV2TimestampSchema
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import type {
  InboxV2SourceRegistryRepository,
  SourceConnectionRecord
} from "@hulee/db";
import type {
  SourceAdapterOnboardingPrepareInput,
  SourceAdapterOnboardingPrepared,
  SourceAdapterRegistration
} from "@hulee/modules";
import { randomUUID } from "node:crypto";

type SourceOnboardingContext = {
  requestId: string;
  tenantId: TenantId;
  employeeId: EmployeeId;
};

type SourceOnboardingEmployeeActor = Extract<
  SourceAdapterOnboardingPrepareInput["actor"],
  { kind: "employee" }
>;

/**
 * Resolves a current, server-issued RBAC-003 epoch for the user command. The
 * legacy internal API permission header is not authorization-epoch authority.
 */
export type SourceOnboardingAuthorizationResolver = {
  resolveSourceOnboardingAuthorization(input: {
    requestId: string;
    tenantId: TenantId;
    employeeId: EmployeeId;
    sourceName: string;
    requestedAt: Date;
  }): Promise<{
    actor: SourceOnboardingEmployeeActor;
    decision: {
      tenantId: TenantId;
      principal: {
        kind: "employee";
        employee: {
          tenantId: TenantId;
          kind: "employee";
          id: EmployeeId;
        };
      };
      resource: { kind: "tenant"; tenantId: TenantId };
      authorizationEpoch: string;
      permissionId: string;
      outcome: "allowed" | "denied";
      decidedAt: string;
      notAfter: string;
    };
  } | null>;
};

export type SourceRegistryOnboardingUnitOfWork = {
  onboardStandaloneSource(input: {
    requestId: string;
    registration: SourceAdapterRegistration;
    sourceConnection: {
      id: SourceConnectionId;
      tenantId: TenantId;
      sourceType: SourceConnectionRecord["sourceType"];
      sourceName: string;
      displayName: string;
      status: SourceConnectionRecord["status"];
      authType: SourceConnectionRecord["authType"];
      createdByEmployeeId: EmployeeId;
      updatedAt: Date;
    };
    prepared: SourceAdapterOnboardingPrepared;
  }): Promise<SourceConnectionRecord>;
};

export function createSourceRegistryOnboardingUnitOfWork(
  repository: Pick<
    InboxV2SourceRegistryRepository,
    "commitSourceConnectionOnboarding"
  >
): SourceRegistryOnboardingUnitOfWork {
  return {
    async onboardStandaloneSource(input) {
      const transition = input.prepared.authority.connection.transitions[0];

      if (
        transition === undefined ||
        input.prepared.authority.connection.transitions.length !== 1 ||
        input.prepared.authority.accounts.length !== 0 ||
        transition.payload.entityKind !== "source_connection" ||
        transition.payload.intent !== "create" ||
        transition.payload.previousState !== null ||
        transition.payload.resultingState.payload.entityKind !==
          "source_connection" ||
        transition.payload.resultingState.payload.sourceConnection.id !==
          input.prepared.authority.connection.head.payload.sourceConnection.id
      ) {
        throw new CoreError("module.unhealthy");
      }

      return repository.commitSourceConnectionOnboarding({
        declaration: input.registration.declaration,
        lifecycleBinding: input.registration.lifecycleBinding,
        transition,
        compatibilityConnection: input.sourceConnection,
        artifactWrites: input.prepared.artifactWrites,
        secretWrites: input.prepared.secretWrites,
        routeWrites: input.prepared.routeWrites
      });
    }
  };
}

export async function resolveSourceOnboardingEmployeeActor(input: {
  context: SourceOnboardingContext;
  sourceName: string;
  requestedAt: Date;
  authorizationResolver?: SourceOnboardingAuthorizationResolver;
}): Promise<SourceOnboardingEmployeeActor> {
  if (!input.authorizationResolver) {
    throw new CoreError("module.unhealthy");
  }

  const authorization =
    await input.authorizationResolver.resolveSourceOnboardingAuthorization({
      requestId: input.context.requestId,
      tenantId: input.context.tenantId,
      employeeId: input.context.employeeId,
      sourceName: input.sourceName,
      requestedAt: input.requestedAt
    });
  const parsed = inboxV2SourceThreadBindingTransitionActorSchema.safeParse(
    authorization?.actor
  );
  const decidedAt = inboxV2TimestampSchema.safeParse(
    authorization?.decision.decidedAt
  );
  const notAfter = inboxV2TimestampSchema.safeParse(
    authorization?.decision.notAfter
  );

  if (
    authorization === null ||
    !parsed.success ||
    parsed.data.kind !== "employee" ||
    parsed.data.employee.tenantId !== input.context.tenantId ||
    parsed.data.employee.id !== input.context.employeeId ||
    authorization.decision.tenantId !== input.context.tenantId ||
    authorization.decision.principal.kind !== "employee" ||
    authorization.decision.principal.employee.tenantId !==
      input.context.tenantId ||
    authorization.decision.principal.employee.id !== input.context.employeeId ||
    authorization.decision.resource.kind !== "tenant" ||
    authorization.decision.resource.tenantId !== input.context.tenantId ||
    authorization?.decision.permissionId !== "modules.manage" ||
    authorization.decision.outcome !== "allowed" ||
    authorization.decision.authorizationEpoch !==
      parsed.data.authorizationEpoch ||
    !decidedAt.success ||
    !notAfter.success ||
    Date.parse(decidedAt.data) > input.requestedAt.getTime() ||
    Date.parse(notAfter.data) <= input.requestedAt.getTime()
  ) {
    throw new CoreError("permission.denied");
  }

  return parsed.data;
}

export function createSourceAdapterOnboardingPrepareInput(input: {
  context: SourceOnboardingContext;
  actor: SourceOnboardingEmployeeActor;
  source: SourceCatalogItem;
  sourceConnectionId: SourceConnectionId;
  registration: SourceAdapterRegistration;
  displayName: string;
  publicBaseUrl?: string;
  webhookToken?: string;
  createWebhookToken(): string;
  requestedAt: Date;
}): {
  prepareInput: SourceAdapterOnboardingPrepareInput;
  expectedStandardWebhookSecretToken?: string;
} {
  const tenantId = inboxV2TenantIdSchema.parse(input.context.tenantId);
  const credentialMode = input.registration.declaration.payload.credentialMode;
  const standardWebhookSecretProfile = isStandardWebhookSecretProfile({
    registration: input.registration,
    source: input.source
  });
  let credentialBindings: readonly InboxV2SourceRegistrySecretReference[] = [];
  let ephemeralCredentials: SourceAdapterOnboardingPrepareInput["ephemeralCredentials"] =
    [];
  let expectedStandardWebhookSecretToken: string | undefined;

  if (credentialMode === "revocable_secret_binding") {
    if (!standardWebhookSecretProfile) {
      throw new CoreError("validation.failed");
    }
    expectedStandardWebhookSecretToken =
      input.webhookToken?.trim() || input.createWebhookToken();
    if (
      expectedStandardWebhookSecretToken.length < 16 ||
      expectedStandardWebhookSecretToken.length > 200
    ) {
      throw new CoreError("validation.failed");
    }
    const credentialBinding: InboxV2SourceRegistrySecretReference = {
      tenantId,
      bindingId: `source-credential:v1:${randomUUID()}`,
      revision: inboxV2EntityRevisionSchema.parse("1"),
      status: "active",
      lifecycle: sourceRegistryLifecycleLocator({
        registration: input.registration,
        copySlot: "credential_binding"
      })
    };
    credentialBindings = [credentialBinding];
    ephemeralCredentials = [
      {
        bindingId: credentialBinding.bindingId,
        material: new TextEncoder().encode(expectedStandardWebhookSecretToken)
      }
    ];
  } else if (input.webhookToken?.trim()) {
    throw new CoreError("validation.failed");
  }

  return {
    prepareInput: {
      tenantId,
      sourceName: input.source.sourceName,
      sourceConnection: {
        tenantId,
        kind: "source_connection",
        id: input.sourceConnectionId
      },
      actor: input.actor,
      requestedAt: input.requestedAt.toISOString(),
      publicBaseUrl: input.publicBaseUrl ?? "",
      displayName: input.displayName,
      artifacts: [],
      credentialBindings,
      ephemeralCredentials
    },
    ...(expectedStandardWebhookSecretToken
      ? { expectedStandardWebhookSecretToken }
      : {})
  };
}

/** Initial internal-API credential profile; other auth flows need own input. */
function isStandardWebhookSecretProfile(input: {
  registration: SourceAdapterRegistration;
  source: SourceCatalogItem;
}): boolean {
  const declaration = input.registration.declaration.payload;
  const onboarding = declaration.onboarding;
  const oneTimeResponse =
    onboarding.mode === "not_supported" ? null : onboarding.oneTimeResponse;

  return (
    declaration.credentialMode === "revocable_secret_binding" &&
    declaration.ingress.mode === "webhook" &&
    input.source.authTypes.includes("webhook_secret") &&
    oneTimeResponse?.schemaId ===
      INBOX_V2_SOURCE_ONBOARDING_ONE_TIME_RESPONSE_SCHEMA_ID &&
    oneTimeResponse.schemaVersion === "v1" &&
    oneTimeResponse.fieldIds.length === 1 &&
    oneTimeResponse.fieldIds[0] ===
      INBOX_V2_SOURCE_ONBOARDING_WEBHOOK_TOKEN_FIELD_ID
  );
}

/** Resolves only the registered standard webhook-secret response profile. */
export function resolveStandardWebhookSecretOneTimeToken(input: {
  prepared: SourceAdapterOnboardingPrepared;
  expected?: string;
}): string | undefined {
  const response = input.prepared.oneTimeResponse;

  if (!input.expected) {
    if (response !== null) {
      throw new CoreError("module.unhealthy");
    }
    return undefined;
  }

  if (
    response === null ||
    response.schemaId !==
      INBOX_V2_SOURCE_ONBOARDING_ONE_TIME_RESPONSE_SCHEMA_ID ||
    response.schemaVersion !== "v1" ||
    response.fields.length !== 1 ||
    response.fields[0]?.fieldId !==
      INBOX_V2_SOURCE_ONBOARDING_WEBHOOK_TOKEN_FIELD_ID
  ) {
    throw new CoreError("module.unhealthy");
  }

  const material = response.fields[0].value;
  let token: string;

  try {
    token = new TextDecoder("utf-8", { fatal: true }).decode(material);
  } catch {
    throw new CoreError("module.unhealthy");
  }

  if (
    token !== input.expected ||
    token.length < 16 ||
    token.length > 200 ||
    !input.prepared.secretWrites.some((write) =>
      sameBytes(write.material, material)
    )
  ) {
    throw new CoreError("module.unhealthy");
  }

  return token;
}

export function sourceAuthTypeForAdapterRegistration(input: {
  registration: SourceAdapterRegistration;
  source: SourceCatalogItem;
}): SourceConnectionRecord["authType"] {
  if (
    input.registration.declaration.payload.credentialMode ===
      "revocable_secret_binding" &&
    input.source.authTypes.includes("webhook_secret")
  ) {
    return "webhook_secret";
  }

  const authType = input.source.authTypes[0];

  if (!authType) {
    throw new CoreError("module.unhealthy");
  }

  return authType;
}

export function validateCommittedSourceOnboarding(input: {
  context: SourceOnboardingContext;
  source: SourceCatalogItem;
  sourceConnectionId: SourceConnectionId;
  record: SourceConnectionRecord;
}): void {
  if (input.record.tenantId !== input.context.tenantId) {
    throw new CoreError("tenant.boundary_violation");
  }

  if (
    input.record.id !== input.sourceConnectionId ||
    input.record.sourceName !== input.source.sourceName ||
    input.record.sourceType !== input.source.sourceType ||
    input.record.createdByEmployeeId !== input.context.employeeId
  ) {
    throw new CoreError("module.unhealthy");
  }
}

/** Best-effort lifetime bound for plaintext transient adapter material. */
export function clearSourceOnboardingTransientMaterial(input: {
  prepareInput: SourceAdapterOnboardingPrepareInput;
  prepared?: SourceAdapterOnboardingPrepared;
}): void {
  for (const credential of input.prepareInput.ephemeralCredentials) {
    credential.material.fill(0);
  }
  for (const write of input.prepared?.secretWrites ?? []) {
    write.material.fill(0);
  }
  for (const write of input.prepared?.artifactWrites ?? []) {
    write.material.fill(0);
  }
  for (const write of input.prepared?.routeWrites ?? []) {
    write.material.fill(0);
  }
  for (const field of input.prepared?.oneTimeResponse?.fields ?? []) {
    field.value.fill(0);
  }
}

function sourceRegistryLifecycleLocator(input: {
  registration: SourceAdapterRegistration;
  copySlot: "credential_binding";
}): InboxV2SourceRegistryLifecycleLocator {
  const binding = input.registration.lifecycleBinding.payload.bindings.find(
    (candidate) => candidate.copySlot === input.copySlot
  );
  const purpose = binding?.processingPurposes[0];

  if (!binding || !purpose) {
    throw new CoreError("module.unhealthy");
  }

  return {
    registry: input.registration.lifecycleBinding.payload.registry,
    copySlot: input.copySlot,
    dataClassId: binding.dataClass.id,
    storageRootId: binding.storageRoot.id,
    purposeId: purpose.id,
    lineageRevision: binding.lineageRevision
  };
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}
