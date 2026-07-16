import type {
  InboxV2SourceAccountRegistryState,
  InboxV2SourceAdapterDeclaration,
  InboxV2SourceConnectionReference,
  InboxV2SourceConnectionRegistryState,
  InboxV2SourceRegistryArtifactReference,
  InboxV2SourceRegistryLifecycleBinding,
  InboxV2SourceRegistryRelatedAuthorityReference,
  InboxV2SourceRegistrySecretReference,
  InboxV2SourceRegistryTransition,
  InboxV2Sha256Digest,
  InboxV2TenantId
} from "@hulee/contracts";
import {
  calculateInboxV2BytesSha256,
  INBOX_V2_CATALOG_REGISTRATION_SCHEMA_ID,
  INBOX_V2_INITIAL_SCHEMA_VERSION,
  INBOX_V2_SOURCE_ADAPTER_DECLARATION_SCHEMA_ID,
  inboxV2CatalogIdSchema,
  inboxV2SourceRegistryRelatedAuthorityReferenceSchema,
  inboxV2TenantIdSchema,
  inboxV2TimestampSchema,
  isInboxV2SourceAccountRegistryState,
  isInboxV2SourceAdapterDeclaration,
  isInboxV2SourceAdapterDeclarationLifecycleBinding,
  isInboxV2SourceConnectionRegistryState,
  isInboxV2SourceRegistryLifecycleBinding,
  isInboxV2SourceRegistryTransition
} from "@hulee/contracts";

type SourceRegistryActor =
  InboxV2SourceConnectionRegistryState["payload"]["createdBy"];

export type SourceAdapterEphemeralCredentialInput = Readonly<{
  bindingId: string;
  material: Uint8Array;
}>;

export type SourceAdapterOnboardingPrepareInput = Readonly<{
  tenantId: InboxV2TenantId;
  sourceName: string;
  sourceConnection: InboxV2SourceConnectionReference;
  actor: SourceRegistryActor;
  requestedAt: string;
  publicBaseUrl: string;
  displayName: string;
  artifacts: readonly InboxV2SourceRegistryArtifactReference[];
  credentialBindings: readonly InboxV2SourceRegistrySecretReference[];
  ephemeralCredentials: readonly SourceAdapterEphemeralCredentialInput[];
}>;

export type SourceAdapterTransientSecretWrite = Readonly<{
  binding: InboxV2SourceRegistrySecretReference;
  material: Uint8Array;
  materialDigest: InboxV2Sha256Digest;
}>;

export type SourceAdapterTransientArtifactWrite = Readonly<{
  artifact: InboxV2SourceRegistryArtifactReference;
  material: Uint8Array;
}>;

export type SourceAdapterTransientRouteWrite = Readonly<{
  route: Extract<
    InboxV2SourceRegistryRelatedAuthorityReference,
    { kind: "source_ingress_route" }
  >;
  material: Uint8Array;
  materialDigest: InboxV2Sha256Digest;
}>;

export type SourceAdapterOneTimeResponse = Readonly<{
  schemaId: string;
  schemaVersion: string;
  fields: readonly Readonly<{
    fieldId: string;
    value: Uint8Array;
  }>[];
}>;

export type SourceAdapterConnectionAuthority = Readonly<{
  head: InboxV2SourceConnectionRegistryState;
  transitions: readonly InboxV2SourceRegistryTransition[];
}>;

export type SourceAdapterAccountAuthority = Readonly<{
  head: InboxV2SourceAccountRegistryState;
  transitions: readonly InboxV2SourceRegistryTransition[];
}>;

export type SourceAdapterOnboardingAuthority = Readonly<{
  connection: SourceAdapterConnectionAuthority;
  accounts: readonly SourceAdapterAccountAuthority[];
  ingressRoute: InboxV2SourceRegistryRelatedAuthorityReference | null;
}>;

export type SourceAdapterOnboardingPrepared = Readonly<{
  authority: SourceAdapterOnboardingAuthority;
  artifactWrites: readonly SourceAdapterTransientArtifactWrite[];
  secretWrites: readonly SourceAdapterTransientSecretWrite[];
  routeWrites: readonly SourceAdapterTransientRouteWrite[];
  oneTimeResponse: SourceAdapterOneTimeResponse | null;
}>;

export type SourceAdapterOnboardingHandler = Readonly<{
  handlerId: string;
  prepare(
    input: SourceAdapterOnboardingPrepareInput
  ): Promise<SourceAdapterOnboardingPrepared>;
}>;

export type SourceAdapterIngressDispatchInput = Readonly<{
  tenantId: InboxV2TenantId;
  route: Extract<
    InboxV2SourceRegistryRelatedAuthorityReference,
    { kind: "source_ingress_route" }
  >;
  receivedAt: string;
  body: Uint8Array;
}>;

export type SourceAdapterIngressDispatchResult = Readonly<{
  accepted: boolean;
  diagnosticCodeId: string | null;
}>;

export type SourceAdapterIngressHandler = Readonly<{
  handlerId: string;
  dispatch(
    input: SourceAdapterIngressDispatchInput
  ): Promise<SourceAdapterIngressDispatchResult>;
}>;

export type SourceAdapterRegistration = Readonly<{
  declaration: InboxV2SourceAdapterDeclaration;
  lifecycleBinding: InboxV2SourceRegistryLifecycleBinding;
  onboardingHandler: SourceAdapterOnboardingHandler | null;
  ingressHandler: SourceAdapterIngressHandler | null;
}>;

export type SourceAdapterRegistry = Readonly<{
  get(sourceName: string): SourceAdapterOnboardingHandler | null;
  getRegistration(sourceName: string): SourceAdapterRegistration | null;
  getIngressHandler(sourceName: string): SourceAdapterIngressHandler | null;
  listSourceNames(): readonly string[];
}>;

export class SourceAdapterRegistryError extends Error {
  readonly code:
    | "source_adapter.invalid_registration"
    | "source_adapter.duplicate_registration"
    | "source_adapter.handler_missing"
    | "source_adapter.handler_mismatch"
    | "source_adapter.invalid_prepared_authority"
    | "source_adapter.invalid_ingress_input"
    | "source_adapter.invalid_ingress_result";

  constructor(
    code: SourceAdapterRegistryError["code"],
    message: string = code
  ) {
    super(message);
    this.name = "SourceAdapterRegistryError";
    this.code = code;
  }
}

const definedSourceAdapterRegistries = new WeakSet<object>();

export function isSourceAdapterRegistry(
  value: unknown
): value is SourceAdapterRegistry {
  return (
    typeof value === "object" &&
    value !== null &&
    definedSourceAdapterRegistries.has(value)
  );
}

export function createSourceAdapterRegistry(input: {
  registrations: readonly SourceAdapterRegistration[];
}): SourceAdapterRegistry {
  const registrations = new Map<string, SourceAdapterRegistration>();
  for (const registrationInput of input.registrations) {
    const registration = validateAndWrapRegistration(registrationInput);
    const sourceName = registration.declaration.payload.sourceName;
    if (registrations.has(sourceName)) {
      throw new SourceAdapterRegistryError(
        "source_adapter.duplicate_registration",
        `Duplicate source-adapter registration: ${sourceName}.`
      );
    }
    registrations.set(sourceName, registration);
  }

  const registry: SourceAdapterRegistry = Object.freeze({
    get(sourceName: string) {
      return registrations.get(sourceName)?.onboardingHandler ?? null;
    },
    getRegistration(sourceName: string) {
      return registrations.get(sourceName) ?? null;
    },
    getIngressHandler(sourceName: string) {
      return registrations.get(sourceName)?.ingressHandler ?? null;
    },
    listSourceNames() {
      return Object.freeze([...registrations.keys()].sort());
    }
  });
  definedSourceAdapterRegistries.add(registry as object);
  return registry;
}

function validateAndWrapRegistration(
  registration: SourceAdapterRegistration
): SourceAdapterRegistration {
  const declarationAuthority = registration.declaration;
  const lifecycleBindingAuthority = registration.lifecycleBinding;
  const onboardingHandlerInput = registration.onboardingHandler;
  const ingressHandlerInput = registration.ingressHandler;
  if (
    !isInboxV2SourceAdapterDeclaration(declarationAuthority) ||
    !isInboxV2SourceRegistryLifecycleBinding(lifecycleBindingAuthority) ||
    !isInboxV2SourceAdapterDeclarationLifecycleBinding({
      declaration: declarationAuthority,
      lifecycleBinding: lifecycleBindingAuthority
    })
  ) {
    throw new SourceAdapterRegistryError(
      "source_adapter.invalid_registration",
      "Source-adapter registration requires the exact authentic declaration lifecycle binding."
    );
  }
  const declaration = declarationAuthority.payload;
  if (
    declaration.lifecycleRegistry.id !==
      lifecycleBindingAuthority.payload.registry.id ||
    declaration.lifecycleRegistry.revision !==
      lifecycleBindingAuthority.payload.registry.revision ||
    declaration.lifecycleRegistry.compositionHash !==
      lifecycleBindingAuthority.payload.registry.compositionHash
  ) {
    throw new SourceAdapterRegistryError(
      "source_adapter.invalid_registration",
      "Source-adapter declaration and lifecycle binding compositions differ."
    );
  }

  const onboardingHandler = validateHandler(
    declaration.onboarding,
    onboardingHandlerInput,
    "onboarding"
  );
  const ingressHandler = validateHandler(
    declaration.ingress,
    ingressHandlerInput,
    "ingress"
  );
  const onboardingPrepare =
    onboardingHandler === null
      ? null
      : captureOnboardingPrepare(onboardingHandler);
  const ingressDispatch =
    ingressHandler === null ? null : captureIngressDispatch(ingressHandler);
  const onboardingHandlerId =
    "handlerId" in declaration.onboarding
      ? declaration.onboarding.handlerId
      : null;
  const ingressHandlerId =
    "handlerId" in declaration.ingress ? declaration.ingress.handlerId : null;

  return Object.freeze({
    declaration: declarationAuthority,
    lifecycleBinding: lifecycleBindingAuthority,
    onboardingHandler:
      onboardingHandler === null
        ? null
        : Object.freeze({
            handlerId: onboardingHandlerId!,
            async prepare(prepareInput: SourceAdapterOnboardingPrepareInput) {
              let inputSnapshot:
                | SourceAdapterOnboardingPrepareInput
                | undefined;
              let prepared: SourceAdapterOnboardingPrepared | undefined;
              let validated = false;
              try {
                assertPrepareInputSnapshotShape(prepareInput);
                inputSnapshot = snapshotPrepareInput(prepareInput);
                assertPrepareInput(declaration.sourceName, inputSnapshot);
                prepared = await invokeAndSnapshotPrepareHandler(
                  onboardingPrepare!,
                  clonePrepareInputForHandler(inputSnapshot)
                );
                assertPreparedAuthority(
                  declarationAuthority,
                  inputSnapshot,
                  prepared
                );
                validated = true;
                return prepared;
              } finally {
                zeroPrepareInputCredentials(inputSnapshot);
                if (!validated) {
                  zeroPreparedTransientMaterial(prepared);
                }
              }
            }
          }),
    ingressHandler:
      ingressHandler === null
        ? null
        : Object.freeze({
            handlerId: ingressHandlerId!,
            async dispatch(dispatchInput: SourceAdapterIngressDispatchInput) {
              assertIngressInputSnapshotShape(dispatchInput);
              const inputSnapshot = snapshotIngressInput(dispatchInput);
              try {
                assertIngressInput(inputSnapshot);
                const handlerInput = cloneIngressInputForHandler(inputSnapshot);
                try {
                  return snapshotIngressResult(
                    await ingressDispatch!(handlerInput)
                  );
                } finally {
                  zeroBytes(handlerInput.body);
                }
              } finally {
                zeroBytes(inputSnapshot.body);
              }
            }
          })
  });
}

function validateHandler<THandler extends Readonly<{ handlerId: string }>>(
  declaration:
    | Readonly<{ mode: "not_supported" }>
    | Readonly<{ mode: string; handlerId: string }>,
  handler: THandler | null,
  kind: "onboarding" | "ingress"
): THandler | null {
  if (!("handlerId" in declaration)) {
    if (handler !== null) {
      throw new SourceAdapterRegistryError(
        "source_adapter.handler_mismatch",
        `Adapter cannot register ${kind} handler for not_supported mode.`
      );
    }
    return null;
  }
  if (handler === null) {
    throw new SourceAdapterRegistryError(
      "source_adapter.handler_missing",
      `Adapter declaration requires ${kind} handler ${declaration.handlerId}.`
    );
  }
  if (handler.handlerId !== declaration.handlerId) {
    throw new SourceAdapterRegistryError(
      "source_adapter.handler_mismatch",
      `Registered ${kind} handler does not match ${declaration.handlerId}.`
    );
  }
  return handler;
}

function captureOnboardingPrepare(
  handler: SourceAdapterOnboardingHandler
): SourceAdapterOnboardingHandler["prepare"] {
  const prepare = handler.prepare;
  if (typeof prepare !== "function") {
    throw new SourceAdapterRegistryError(
      "source_adapter.handler_mismatch",
      "Registered onboarding handler has no callable prepare method."
    );
  }
  return (input) => prepare(input);
}

function captureIngressDispatch(
  handler: SourceAdapterIngressHandler
): SourceAdapterIngressHandler["dispatch"] {
  const dispatch = handler.dispatch;
  if (typeof dispatch !== "function") {
    throw new SourceAdapterRegistryError(
      "source_adapter.handler_mismatch",
      "Registered ingress handler has no callable dispatch method."
    );
  }
  return (input) => dispatch(input);
}

function assertPrepareInputSnapshotShape(
  input: SourceAdapterOnboardingPrepareInput
): void {
  if (
    !input ||
    !Array.isArray(input.artifacts) ||
    !Array.isArray(input.credentialBindings) ||
    !Array.isArray(input.ephemeralCredentials) ||
    input.ephemeralCredentials.some(
      (credential) =>
        !credential ||
        typeof credential.bindingId !== "string" ||
        !(credential.material instanceof Uint8Array)
    )
  ) {
    throw invalidPrepared("Source-adapter prepare input is malformed.");
  }
}

function assertPrepareInput(
  sourceName: string,
  input: SourceAdapterOnboardingPrepareInput
): void {
  if (
    input.sourceName !== sourceName ||
    input.sourceConnection.tenantId !== input.tenantId ||
    (input.actor.kind === "employee" &&
      input.actor.employee.tenantId !== input.tenantId) ||
    !inboxV2TimestampSchema.safeParse(input.requestedAt).success ||
    input.displayName.trim().length === 0 ||
    input.displayName.length > 200
  ) {
    throw new SourceAdapterRegistryError(
      "source_adapter.invalid_prepared_authority",
      "Source-adapter prepare input crosses registration or tenant authority."
    );
  }
  const credentialIds = new Set(
    input.credentialBindings.map((credential) => credential.bindingId)
  );
  for (const ephemeral of input.ephemeralCredentials) {
    if (
      !credentialIds.has(ephemeral.bindingId) ||
      !(ephemeral.material instanceof Uint8Array) ||
      ephemeral.material.byteLength === 0
    ) {
      throw new SourceAdapterRegistryError(
        "source_adapter.invalid_prepared_authority",
        "Ephemeral credential material requires an exact declared binding."
      );
    }
  }
}

function assertIngressInputSnapshotShape(
  input: SourceAdapterIngressDispatchInput
): void {
  if (
    !input ||
    asUnknownRecord(input.route) === null ||
    !(input.body instanceof Uint8Array)
  ) {
    throw invalidIngressInput("Source-adapter ingress input is malformed.");
  }
}

function snapshotIngressInput(
  input: SourceAdapterIngressDispatchInput
): SourceAdapterIngressDispatchInput {
  const copies: Uint8Array[] = [];
  try {
    return Object.freeze({
      tenantId: input.tenantId,
      route: deepCloneAndFreeze(input.route),
      receivedAt: input.receivedAt,
      body: copyBytes(input.body, copies)
    });
  } catch (error) {
    zeroByteCopies(copies);
    throw error;
  }
}

function cloneIngressInputForHandler(
  input: SourceAdapterIngressDispatchInput
): SourceAdapterIngressDispatchInput {
  const copies: Uint8Array[] = [];
  try {
    return {
      tenantId: input.tenantId,
      route: deepCloneValue(input.route),
      receivedAt: input.receivedAt,
      body: copyBytes(input.body, copies)
    };
  } catch (error) {
    zeroByteCopies(copies);
    throw error;
  }
}

function assertIngressInput(input: SourceAdapterIngressDispatchInput): void {
  const parsedRoute =
    inboxV2SourceRegistryRelatedAuthorityReferenceSchema.safeParse(input.route);
  if (
    !inboxV2TenantIdSchema.safeParse(input.tenantId).success ||
    !inboxV2TimestampSchema.safeParse(input.receivedAt).success ||
    !parsedRoute.success ||
    parsedRoute.data.kind !== "source_ingress_route" ||
    parsedRoute.data.status !== "active" ||
    parsedRoute.data.tenantId !== input.tenantId ||
    parsedRoute.data.sourceConnection.tenantId !== input.tenantId ||
    (parsedRoute.data.sourceAccount !== null &&
      parsedRoute.data.sourceAccount.tenantId !== input.tenantId)
  ) {
    throw invalidIngressInput(
      "Source-adapter ingress input crosses route or tenant authority."
    );
  }
}

function snapshotIngressResult(
  result: unknown
): SourceAdapterIngressDispatchResult {
  const record = asUnknownRecord(result);
  const accepted =
    record === null ? undefined : readUnknownProperty(record, "accepted");
  const diagnosticCodeId =
    record === null
      ? undefined
      : readUnknownProperty(record, "diagnosticCodeId");
  if (
    record === null ||
    Object.keys(record).some(
      (key) => key !== "accepted" && key !== "diagnosticCodeId"
    ) ||
    typeof accepted !== "boolean" ||
    (diagnosticCodeId !== null &&
      !inboxV2CatalogIdSchema.safeParse(diagnosticCodeId).success) ||
    (!accepted && diagnosticCodeId === null)
  ) {
    throw invalidIngressResult(
      "Source-adapter ingress handler returned an invalid result."
    );
  }
  return Object.freeze({
    accepted,
    diagnosticCodeId: diagnosticCodeId as string | null
  });
}

function snapshotPrepareInput(
  input: SourceAdapterOnboardingPrepareInput
): SourceAdapterOnboardingPrepareInput {
  const copies: Uint8Array[] = [];
  try {
    return Object.freeze({
      tenantId: input.tenantId,
      sourceName: input.sourceName,
      sourceConnection: deepCloneAndFreeze(input.sourceConnection),
      actor: deepCloneAndFreeze(input.actor),
      requestedAt: input.requestedAt,
      publicBaseUrl: input.publicBaseUrl,
      displayName: input.displayName,
      artifacts: Object.freeze(
        input.artifacts.map((artifact) => deepCloneAndFreeze(artifact))
      ),
      credentialBindings: Object.freeze(
        input.credentialBindings.map((binding) => deepCloneAndFreeze(binding))
      ),
      ephemeralCredentials: Object.freeze(
        input.ephemeralCredentials.map((credential) =>
          Object.freeze({
            bindingId: credential.bindingId,
            material: copyBytes(credential.material, copies)
          })
        )
      )
    });
  } catch (error) {
    zeroByteCopies(copies);
    throw error;
  }
}

function clonePrepareInputForHandler(
  input: SourceAdapterOnboardingPrepareInput
): SourceAdapterOnboardingPrepareInput {
  const copies: Uint8Array[] = [];
  try {
    return {
      tenantId: input.tenantId,
      sourceName: input.sourceName,
      sourceConnection: deepCloneValue(input.sourceConnection),
      actor: deepCloneValue(input.actor),
      requestedAt: input.requestedAt,
      publicBaseUrl: input.publicBaseUrl,
      displayName: input.displayName,
      artifacts: input.artifacts.map((artifact) => deepCloneValue(artifact)),
      credentialBindings: input.credentialBindings.map((binding) =>
        deepCloneValue(binding)
      ),
      ephemeralCredentials: input.ephemeralCredentials.map((credential) => ({
        bindingId: credential.bindingId,
        material: copyBytes(credential.material, copies)
      }))
    };
  } catch (error) {
    zeroByteCopies(copies);
    throw error;
  }
}

async function invokeAndSnapshotPrepareHandler(
  prepare: SourceAdapterOnboardingHandler["prepare"],
  handlerInput: SourceAdapterOnboardingPrepareInput
): Promise<SourceAdapterOnboardingPrepared> {
  let handlerPrepared: unknown;
  try {
    handlerPrepared = await prepare(handlerInput);
    assertPreparedSnapshotShape(handlerPrepared);
    return snapshotPrepared(handlerPrepared);
  } finally {
    zeroPrepareInputCredentials(handlerInput);
    zeroPreparedTransientMaterial(handlerPrepared);
  }
}

function zeroPrepareInputCredentials(
  input: SourceAdapterOnboardingPrepareInput | undefined
): void {
  for (const credential of input?.ephemeralCredentials ?? []) {
    zeroBytes(credential.material);
  }
}

function zeroPreparedTransientMaterial(prepared: unknown): void {
  const preparedRecord = asUnknownRecord(prepared);
  if (preparedRecord === null) {
    return;
  }
  for (const field of [
    "artifactWrites",
    "secretWrites",
    "routeWrites"
  ] as const) {
    const writes = readUnknownProperty(preparedRecord, field);
    if (!Array.isArray(writes)) {
      continue;
    }
    for (const write of writes) {
      const writeRecord = asUnknownRecord(write);
      zeroBytes(
        writeRecord === null
          ? undefined
          : readUnknownProperty(writeRecord, "material")
      );
    }
  }
  const response = asUnknownRecord(
    readUnknownProperty(preparedRecord, "oneTimeResponse")
  );
  const fields =
    response === null ? undefined : readUnknownProperty(response, "fields");
  if (!Array.isArray(fields)) {
    return;
  }
  for (const field of fields) {
    const fieldRecord = asUnknownRecord(field);
    zeroBytes(
      fieldRecord === null
        ? undefined
        : readUnknownProperty(fieldRecord, "value")
    );
  }
}

function asUnknownRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function readUnknownProperty(
  record: Record<string, unknown>,
  key: string
): unknown {
  try {
    return record[key];
  } catch {
    return undefined;
  }
}

function zeroBytes(value: unknown): void {
  if (value instanceof Uint8Array) {
    value.fill(0);
  }
}

function copyBytes(value: Uint8Array, copies: Uint8Array[]): Uint8Array {
  const copy = new Uint8Array(value);
  copies.push(copy);
  return copy;
}

function zeroByteCopies(copies: readonly Uint8Array[]): void {
  for (const copy of copies) {
    zeroBytes(copy);
  }
}

function assertPreparedSnapshotShape(
  prepared: unknown
): asserts prepared is SourceAdapterOnboardingPrepared {
  const preparedRecord = asUnknownRecord(prepared);
  const authority = asUnknownRecord(
    preparedRecord === null
      ? undefined
      : readUnknownProperty(preparedRecord, "authority")
  );
  const connection = asUnknownRecord(
    authority === null
      ? undefined
      : readUnknownProperty(authority, "connection")
  );
  const accounts =
    authority === null ? undefined : readUnknownProperty(authority, "accounts");
  const artifactWrites =
    preparedRecord === null
      ? undefined
      : readUnknownProperty(preparedRecord, "artifactWrites");
  const secretWrites =
    preparedRecord === null
      ? undefined
      : readUnknownProperty(preparedRecord, "secretWrites");
  const routeWrites =
    preparedRecord === null
      ? undefined
      : readUnknownProperty(preparedRecord, "routeWrites");

  if (
    connection === null ||
    !Array.isArray(readUnknownProperty(connection, "transitions")) ||
    !Array.isArray(accounts) ||
    accounts.some((account) => {
      const record = asUnknownRecord(account);
      return (
        record === null ||
        !Array.isArray(readUnknownProperty(record, "transitions"))
      );
    }) ||
    !Array.isArray(artifactWrites) ||
    artifactWrites.some((write) => {
      const record = asUnknownRecord(write);
      return (
        record === null ||
        asUnknownRecord(readUnknownProperty(record, "artifact")) === null ||
        !(readUnknownProperty(record, "material") instanceof Uint8Array)
      );
    }) ||
    !Array.isArray(secretWrites) ||
    secretWrites.some((write) => {
      const record = asUnknownRecord(write);
      return (
        record === null ||
        asUnknownRecord(readUnknownProperty(record, "binding")) === null ||
        !(readUnknownProperty(record, "material") instanceof Uint8Array) ||
        typeof readUnknownProperty(record, "materialDigest") !== "string"
      );
    }) ||
    !Array.isArray(routeWrites) ||
    routeWrites.some((write) => {
      const record = asUnknownRecord(write);
      return (
        record === null ||
        asUnknownRecord(readUnknownProperty(record, "route")) === null ||
        !(readUnknownProperty(record, "material") instanceof Uint8Array) ||
        typeof readUnknownProperty(record, "materialDigest") !== "string"
      );
    })
  ) {
    throw invalidPrepared("Handler returned an incomplete prepared result.");
  }

  const response = readUnknownProperty(preparedRecord!, "oneTimeResponse");
  if (response === null) {
    return;
  }
  const responseRecord = asUnknownRecord(response);
  const fields =
    responseRecord === null
      ? undefined
      : readUnknownProperty(responseRecord, "fields");
  if (
    responseRecord === null ||
    typeof readUnknownProperty(responseRecord, "schemaId") !== "string" ||
    typeof readUnknownProperty(responseRecord, "schemaVersion") !== "string" ||
    !Array.isArray(fields) ||
    fields.some((field) => {
      const record = asUnknownRecord(field);
      return (
        record === null ||
        typeof readUnknownProperty(record, "fieldId") !== "string" ||
        !(readUnknownProperty(record, "value") instanceof Uint8Array)
      );
    })
  ) {
    throw invalidPrepared("Handler returned a malformed one-time response.");
  }
}

function snapshotPrepared(
  prepared: SourceAdapterOnboardingPrepared
): SourceAdapterOnboardingPrepared {
  const copies: Uint8Array[] = [];
  try {
    const authority: SourceAdapterOnboardingAuthority = Object.freeze({
      connection: Object.freeze({
        head: prepared.authority.connection.head,
        transitions: Object.freeze([
          ...prepared.authority.connection.transitions
        ])
      }),
      accounts: Object.freeze(
        prepared.authority.accounts.map((account) =>
          Object.freeze({
            head: account.head,
            transitions: Object.freeze([...account.transitions])
          })
        )
      ),
      ingressRoute:
        prepared.authority.ingressRoute === null
          ? null
          : deepCloneAndFreeze(prepared.authority.ingressRoute)
    });
    return Object.freeze({
      authority,
      artifactWrites: Object.freeze(
        prepared.artifactWrites.map((write) =>
          Object.freeze({
            artifact: deepCloneAndFreeze(write.artifact),
            material: copyBytes(write.material, copies)
          })
        )
      ),
      secretWrites: Object.freeze(
        prepared.secretWrites.map((write) =>
          Object.freeze({
            binding: deepCloneAndFreeze(write.binding),
            material: copyBytes(write.material, copies),
            materialDigest: write.materialDigest
          })
        )
      ),
      routeWrites: Object.freeze(
        prepared.routeWrites.map((write) =>
          Object.freeze({
            route: deepCloneAndFreeze(write.route),
            material: copyBytes(write.material, copies),
            materialDigest: write.materialDigest
          })
        )
      ),
      oneTimeResponse:
        prepared.oneTimeResponse === null
          ? null
          : Object.freeze({
              schemaId: prepared.oneTimeResponse.schemaId,
              schemaVersion: prepared.oneTimeResponse.schemaVersion,
              fields: Object.freeze(
                prepared.oneTimeResponse.fields.map((field) =>
                  Object.freeze({
                    fieldId: field.fieldId,
                    value: copyBytes(field.value, copies)
                  })
                )
              )
            })
    });
  } catch (error) {
    zeroByteCopies(copies);
    throw error;
  }
}

function assertPreparedAuthority(
  declaration: InboxV2SourceAdapterDeclaration,
  input: SourceAdapterOnboardingPrepareInput,
  prepared: SourceAdapterOnboardingPrepared
): void {
  const { authority } = prepared;
  if (
    !isInboxV2SourceConnectionRegistryState(authority.connection.head) ||
    authority.accounts.some(
      (account) => !isInboxV2SourceAccountRegistryState(account.head)
    ) ||
    !isAuthenticTransitionChain(authority.connection.transitions) ||
    authority.accounts.some(
      (account) => !isAuthenticTransitionChain(account.transitions)
    )
  ) {
    throw invalidPrepared("Prepared authority contains caller-authored state.");
  }
  const head = authority.connection.head.payload;
  if (
    head.tenantId !== input.tenantId ||
    head.sourceName !== declaration.payload.sourceName ||
    head.displayName !== input.displayName ||
    head.sourceConnection.id !== input.sourceConnection.id ||
    head.adapterContract.contractId !==
      declaration.payload.adapterContract.contractId ||
    head.adapterContract.contractVersion !==
      declaration.payload.adapterContract.contractVersion ||
    !sameJson(head.createdBy, input.actor) ||
    head.createdAt !== input.requestedAt
  ) {
    throw invalidPrepared(
      "Prepared connection head does not match adapter/input authority."
    );
  }

  assertTransitionChain(
    authority.connection.head,
    authority.connection.transitions,
    input.tenantId,
    input.actor,
    input.requestedAt
  );
  const ingressRoute = authority.ingressRoute;
  const headIngressRoutes = head.relatedAuthorities.filter(
    (
      item
    ): item is Extract<
      InboxV2SourceRegistryRelatedAuthorityReference,
      { kind: "source_ingress_route" }
    > => item.kind === "source_ingress_route"
  );
  if (
    ingressRoute === null
      ? headIngressRoutes.length !== 0
      : ingressRoute.kind !== "source_ingress_route" ||
        ingressRoute.status !== "active" ||
        ingressRoute.tenantId !== input.tenantId ||
        headIngressRoutes.length !== 1 ||
        !sameJson(headIngressRoutes[0], ingressRoute)
  ) {
    throw invalidPrepared(
      "Prepared active ingress route must exactly represent the authentic connection head."
    );
  }
  if (
    (declaration.payload.ingress.mode !== "not_supported") !==
    (authority.ingressRoute !== null)
  ) {
    throw invalidPrepared(
      "Prepared ingress authority must match the registered ingress mode."
    );
  }
  const accountKeys = new Set<string>();
  for (const accountAuthority of authority.accounts) {
    const account = accountAuthority.head;
    if (
      account.payload.tenantId !== input.tenantId ||
      account.payload.sourceName !== head.sourceName ||
      account.payload.sourceConnection.id !== head.sourceConnection.id ||
      !sameJson(account.payload.createdBy, input.actor) ||
      account.payload.createdAt !== input.requestedAt
    ) {
      throw invalidPrepared("Prepared SourceAccount crosses source authority.");
    }
    if (accountKeys.has(account.payload.sourceAccount.id)) {
      throw invalidPrepared("Prepared SourceAccount heads must be unique.");
    }
    accountKeys.add(account.payload.sourceAccount.id);
    assertTransitionChain(
      account,
      accountAuthority.transitions,
      input.tenantId,
      input.actor,
      input.requestedAt
    );
  }

  const currentCredentialBindings = [
    ...head.credentialBindings,
    ...authority.accounts.flatMap(
      (account) => account.head.payload.credentialBindings
    )
  ];
  const currentArtifacts = [
    ...head.artifacts,
    ...authority.accounts.flatMap((account) => account.head.payload.artifacts)
  ];
  assertArtifactDeclarations(declaration, currentArtifacts);
  if (
    !sameUnorderedJson(
      currentCredentialBindings,
      input.credentialBindings,
      (binding) => binding.bindingId
    ) ||
    !sameUnorderedJson(
      currentArtifacts,
      input.artifacts,
      (artifact) => `${artifact.kind}\u0000${artifact.payload.recordId}`
    )
  ) {
    throw invalidPrepared(
      "Prepared authority must preserve the exact platform-allocated artifact and credential references."
    );
  }
  const artifactWriteKeys = new Set<string>();
  for (const write of prepared.artifactWrites) {
    const key = `${write.artifact.kind}\u0000${write.artifact.payload.recordId}`;
    if (
      artifactWriteKeys.has(key) ||
      !(write.material instanceof Uint8Array) ||
      write.material.byteLength === 0 ||
      calculateInboxV2BytesSha256(write.material) !==
        write.artifact.payload.digest ||
      !currentArtifacts.some((artifact) => sameJson(artifact, write.artifact))
    ) {
      throw invalidPrepared(
        "Transient artifact write lacks an exact classified authority reference."
      );
    }
    artifactWriteKeys.add(key);
  }
  if (artifactWriteKeys.size !== currentArtifacts.length) {
    throw invalidPrepared(
      "Every classified artifact must become exactly one transient artifact write."
    );
  }
  const writeIds = new Set<string>();
  for (const write of prepared.secretWrites) {
    const ephemeral = input.ephemeralCredentials.find(
      (candidate) => candidate.bindingId === write.binding.bindingId
    );
    if (
      writeIds.has(write.binding.bindingId) ||
      !(write.material instanceof Uint8Array) ||
      write.material.byteLength === 0 ||
      calculateInboxV2BytesSha256(write.material) !== write.materialDigest ||
      ephemeral === undefined ||
      !sameBytes(ephemeral.material, write.material) ||
      !currentCredentialBindings.some((binding) =>
        sameJson(binding, write.binding)
      )
    ) {
      throw invalidPrepared(
        "Transient secret write lacks an exact authoritative credential binding."
      );
    }
    writeIds.add(write.binding.bindingId);
  }
  if (writeIds.size !== input.ephemeralCredentials.length) {
    throw invalidPrepared(
      "Every ephemeral credential must become exactly one transient secret write."
    );
  }
  if (prepared.routeWrites.length !== headIngressRoutes.length) {
    throw invalidPrepared(
      "Every active ingress authority requires exactly one transient route write."
    );
  }
  for (const route of headIngressRoutes) {
    const matches = prepared.routeWrites.filter((write) =>
      sameJson(write.route, route)
    );
    if (
      matches.length !== 1 ||
      !(matches[0]!.material instanceof Uint8Array) ||
      matches[0]!.material.byteLength === 0 ||
      calculateInboxV2BytesSha256(matches[0]!.material) !==
        matches[0]!.materialDigest
    ) {
      throw invalidPrepared(
        "Transient route write lacks an exact active ingress authority reference."
      );
    }
  }
  const onboarding = declaration.payload.onboarding;
  assertOneTimeResponse(
    prepared.oneTimeResponse,
    "handlerId" in onboarding ? onboarding.oneTimeResponse : null
  );
}

function assertArtifactDeclarations(
  declaration: InboxV2SourceAdapterDeclaration,
  artifacts: readonly InboxV2SourceRegistryArtifactReference[]
): void {
  for (const [kind, reference] of [
    ["configuration", declaration.payload.configurationSchema],
    ["capability", declaration.payload.capabilitySchema],
    ["metadata", declaration.payload.metadataSchema],
    ["diagnostic", declaration.payload.diagnosticSchema]
  ] as const) {
    const matching = artifacts.filter((artifact) => artifact.kind === kind);
    if ((reference === null) !== (matching.length === 0)) {
      throw invalidPrepared(
        `Adapter ${kind} declaration and persisted artifacts must be present together.`
      );
    }
    if (
      reference !== null &&
      matching.some(
        (artifact) =>
          artifact.payload.schemaId !== reference.schemaId ||
          !reference.supportedVersions.includes(artifact.payload.schemaVersion)
      )
    ) {
      throw invalidPrepared(
        `Adapter ${kind} artifact uses an undeclared schema or version.`
      );
    }
  }
  for (const artifact of artifacts) {
    if (
      artifact.kind === "catalog_registration" &&
      (artifact.payload.schemaId !== INBOX_V2_CATALOG_REGISTRATION_SCHEMA_ID ||
        artifact.payload.schemaVersion !== INBOX_V2_INITIAL_SCHEMA_VERSION)
    ) {
      throw invalidPrepared(
        "Catalog-registration artifact must pin the canonical catalog envelope."
      );
    }
    if (
      artifact.kind === "module_registration" &&
      (artifact.payload.schemaId !==
        INBOX_V2_SOURCE_ADAPTER_DECLARATION_SCHEMA_ID ||
        artifact.payload.schemaVersion !== INBOX_V2_INITIAL_SCHEMA_VERSION)
    ) {
      throw invalidPrepared(
        "Module-registration artifact must pin the source-adapter declaration envelope."
      );
    }
  }
}

function isAuthenticTransitionChain(
  transitions: readonly InboxV2SourceRegistryTransition[]
): boolean {
  return (
    transitions.length > 0 &&
    transitions.every((transition) =>
      isInboxV2SourceRegistryTransition(transition)
    )
  );
}

function assertTransitionChain(
  head:
    | InboxV2SourceConnectionRegistryState
    | InboxV2SourceAccountRegistryState,
  transitions: readonly InboxV2SourceRegistryTransition[],
  tenantId: InboxV2TenantId,
  actor: SourceRegistryActor,
  requestedAt: string
): void {
  if (
    transitions[0]!.payload.intent !== "create" ||
    transitions[0]!.payload.previousState !== null ||
    !sameJson(transitions.at(-1)!.payload.resultingState, head)
  ) {
    throw invalidPrepared(
      "Prepared authority chain must create and terminate at its exact head."
    );
  }
  for (const [index, transition] of transitions.entries()) {
    if (
      transition.payload.tenantId !== tenantId ||
      transition.payload.entityKind !== head.payload.entityKind ||
      !sameJson(transition.payload.actor, actor) ||
      Date.parse(transition.payload.committedAt) < Date.parse(requestedAt)
    ) {
      throw invalidPrepared("Prepared transition crosses head authority.");
    }
    if (
      index > 0 &&
      !sameJson(
        transitions[index - 1]!.payload.resultingState,
        transition.payload.previousState
      )
    ) {
      throw invalidPrepared("Prepared transition chain is discontinuous.");
    }
  }
}

function assertOneTimeResponse(
  response: SourceAdapterOneTimeResponse | null,
  declaration: Readonly<{
    schemaId: string;
    schemaVersion: string;
    fieldIds: readonly string[];
  }> | null
): void {
  if ((response === null) !== (declaration === null)) {
    throw invalidPrepared(
      "One-time response must match the adapter declaration."
    );
  }
  if (response === null || declaration === null) {
    return;
  }
  if (
    response.schemaId !== declaration.schemaId ||
    response.schemaVersion !== declaration.schemaVersion ||
    !/^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$/u.test(response.schemaId) ||
    !/^v[1-9][0-9]*$/u.test(response.schemaVersion) ||
    response.fields.length > 100
  ) {
    throw invalidPrepared(
      "One-time response has an invalid versioned envelope."
    );
  }
  const fields = new Set<string>();
  for (const field of response.fields) {
    if (
      fields.has(field.fieldId) ||
      !/^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$/u.test(field.fieldId) ||
      !(field.value instanceof Uint8Array) ||
      field.value.byteLength === 0
    ) {
      throw invalidPrepared(
        "One-time response fields must be typed and unique."
      );
    }
    fields.add(field.fieldId);
  }
  if (
    fields.size !== declaration.fieldIds.length ||
    declaration.fieldIds.some((fieldId) => !fields.has(fieldId))
  ) {
    throw invalidPrepared(
      "One-time response fields do not match the adapter declaration."
    );
  }
}

function sameUnorderedJson<TValue>(
  left: readonly TValue[],
  right: readonly TValue[],
  key: (value: TValue) => string
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightByKey = new Map(right.map((value) => [key(value), value]));
  return left.every((value) => sameJson(value, rightByKey.get(key(value))));
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

function deepCloneAndFreeze<TValue>(value: TValue): TValue {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Uint8Array) {
    return new Uint8Array(value) as TValue;
  }
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((item) => deepCloneAndFreeze(item))
    ) as TValue;
  }
  const clone: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    clone[key] = deepCloneAndFreeze(item);
  }
  return Object.freeze(clone) as TValue;
}

function deepCloneValue<TValue>(value: TValue): TValue {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Uint8Array) {
    return new Uint8Array(value) as TValue;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepCloneValue(item)) as TValue;
  }
  const clone: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    clone[key] = deepCloneValue(item);
  }
  return clone as TValue;
}

function invalidPrepared(message: string): SourceAdapterRegistryError {
  return new SourceAdapterRegistryError(
    "source_adapter.invalid_prepared_authority",
    message
  );
}

function invalidIngressInput(message: string): SourceAdapterRegistryError {
  return new SourceAdapterRegistryError(
    "source_adapter.invalid_ingress_input",
    message
  );
}

function invalidIngressResult(message: string): SourceAdapterRegistryError {
  return new SourceAdapterRegistryError(
    "source_adapter.invalid_ingress_result",
    message
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
