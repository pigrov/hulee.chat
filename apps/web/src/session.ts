import type { EmployeeId, TenantId } from "@hulee/contracts";
import {
  normalizeEmailAddress,
  type EmailValidationPolicy
} from "@hulee/contact-identity";
import {
  createDrizzlePersistenceExecutor,
  createSqlEmployeeDirectoryRepository,
  createSqlPlatformAuditRepository,
  createSqlSecurityAuditRepository,
  createSqlLocalAuthRepository,
  createSqlTenantRbacRepository,
  createTenantWorkspaceRepository,
  type AuthSessionPrincipal,
  type LocalAuthRepository,
  type PlatformAuditAction,
  type SecurityAuditAction,
  type TenantAuthAccount
} from "@hulee/db";
import {
  CoreError,
  createInternalApiSignature,
  createSequentialIdFactory,
  internalApiSignatureHeader,
  internalApiTimestampHeader,
  permissionsForSystemRoleTemplates,
  registerTenant,
  type Permission
} from "@hulee/core";
import { hashLocalPassword, verifyLocalPassword } from "@hulee/modules";
import { cookies } from "next/headers";
import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";

import {
  assertWebTenantEmailVerified,
  buildInternalApiHeaders as buildInternalApiHeadersForSession,
  resolveWebAccessSession,
  type PlatformRole,
  type WebAccessSession
} from "./access";
import { validatePasswordPolicy } from "./password-policy";
import {
  buildWebCookieOptions,
  resolveWebCookieRuntime
} from "./session-cookies";
import {
  hasEffectivePermission,
  resolveEmployeeEffectiveAccess
} from "./rbac-effective-access";
import { assertInternalApiEffectivePermissionOverride } from "./internal-api-access-policy";
import { getWebDatabase } from "./web-database";
import { resolveWebConfig, resolveWebEnv } from "./web-config";

export { resolveWebConfig, resolveWebEnv } from "./web-config";
export { getWebDatabase } from "./web-database";
export {
  authSessionCookieName,
  lastTenantSlugCookieName,
  productionAuthSessionCookieName,
  productionLastTenantSlugCookieName,
  productionTenantLoginChoicesCookieName,
  tenantLoginChoicesCookieName
} from "./session-cookies";

const sessionTtlMs = 1000 * 60 * 60 * 24 * 14;
const lastTenantSlugTtlMs = 1000 * 60 * 60 * 24 * 365;
const tenantLoginChoicesTtlMs = 1000 * 60 * 10;
const platformOnlyTenantId = "tenant:platform-admin" as TenantId;

export type ResolveCurrentWebAccessSessionOptions = {
  allowDevelopmentFallback?: boolean;
};

export type LoginLocalWebSessionInput = {
  tenantSlug?: string;
  email: string;
  password: string;
};

export type RegisterLocalTenantInput = {
  tenantSlug: string;
  tenantDisplayName: string;
  adminDisplayName?: string;
  email: string;
  password: string;
};

export type AssertCurrentWebEffectiveTenantPermissionOptions = {
  requireVerifiedEmail?: boolean;
};

export type LoginLocalWebSessionResult = {
  session: WebAccessSession;
  redirectPath: string;
  tenantAccount?: TenantAuthAccount;
};

export type TenantLoginChoice = {
  tenantSlug: string;
  tenantDisplayName: string;
};

export type TenantLoginChoices = {
  email: string;
  expiresAt: string;
  returnTo?: string;
  choices: readonly TenantLoginChoice[];
};

export class TenantLoginChoiceRequiredError extends Error {
  readonly email: string;
  readonly choices: readonly TenantLoginChoice[];

  constructor(input: { email: string; choices: readonly TenantLoginChoice[] }) {
    super("Tenant login choice is required.");
    this.name = "TenantLoginChoiceRequiredError";
    this.email = input.email;
    this.choices = input.choices;
  }
}

export async function resolveCurrentWebAccessSession(
  options: ResolveCurrentWebAccessSessionOptions = {}
): Promise<WebAccessSession | null> {
  const env = resolveWebEnv();
  const config = resolveWebConfig();
  const allowDevelopmentFallback = options.allowDevelopmentFallback ?? true;
  const token = await readSessionToken();

  if (token !== undefined) {
    const principal = await getAuthRepository().findSessionByToken(
      token,
      new Date()
    );

    if (principal !== null) {
      return webAccessSessionFromPrincipal(principal);
    }
  }

  if (
    allowDevelopmentFallback &&
    config.nodeEnv !== "production" &&
    !config.webAuthRequired
  ) {
    return resolveWebAccessSession(env);
  }

  return null;
}

export async function requireCurrentWebAccessSession(): Promise<WebAccessSession> {
  const session = await resolveCurrentWebAccessSession();

  if (session === null) {
    throw new CoreError("auth.invalid_credentials");
  }

  return session;
}

export async function assertCurrentWebEffectiveTenantPermission(
  permission: Permission,
  options: AssertCurrentWebEffectiveTenantPermissionOptions = {}
): Promise<WebAccessSession> {
  const session = await requireCurrentWebAccessSession();

  if (options.requireVerifiedEmail === true) {
    assertWebTenantEmailVerified(session);
  }

  const database = getWebDatabase();
  const accessSnapshot = await resolveEmployeeEffectiveAccess({
    tenantId: session.tenantId,
    employeeId: session.employeeId,
    employeeRepository: createSqlEmployeeDirectoryRepository(database),
    rbacRepository: createSqlTenantRbacRepository(database)
  });

  if (!hasEffectivePermission(accessSnapshot, permission)) {
    throw new CoreError("permission.denied");
  }

  return session;
}

export function isEmailNotVerifiedError(error: unknown): boolean {
  return error instanceof CoreError && error.code === "auth.email_not_verified";
}

export async function buildInternalApiHeaders(input: {
  method: string;
  path: string;
  body?: unknown;
  effectivePermissionOverride?: Permission;
}): Promise<Record<string, string>> {
  const effectivePermissionOverride =
    assertInternalApiEffectivePermissionOverride(input);
  const session =
    effectivePermissionOverride === undefined
      ? await requireCurrentWebAccessSession()
      : await assertCurrentWebEffectiveTenantPermission(
          effectivePermissionOverride
        );
  const internalSession =
    effectivePermissionOverride === undefined
      ? session
      : {
          ...session,
          permissions: [effectivePermissionOverride]
        };
  const headers = buildInternalApiHeadersForSession(internalSession);
  const config = resolveWebConfig();
  const secret = config.internalApiSecret;

  if (secret === undefined || secret.trim().length === 0) {
    if (config.nodeEnv === "production") {
      throw new CoreError("auth.invalid_credentials");
    }

    return headers;
  }

  const timestamp = new Date().toISOString();

  return {
    ...headers,
    [internalApiTimestampHeader]: timestamp,
    [internalApiSignatureHeader]: createInternalApiSignature(secret, {
      method: input.method,
      path: input.path,
      body: input.body,
      tenantId: internalSession.tenantId,
      employeeId: internalSession.employeeId,
      permissions: internalSession.permissions,
      timestamp
    })
  };
}

export async function loginLocalWebSession(
  input: LoginLocalWebSessionInput
): Promise<LoginLocalWebSessionResult> {
  const email = normalizeEmail(input.email);
  const explicitTenantSlug =
    input.tenantSlug === undefined
      ? undefined
      : await resolvePreferredTenantSlug(input.tenantSlug);
  const repository = getAuthRepository();
  const [tenantAccounts, platformAdmin] = await Promise.all([
    explicitTenantSlug === undefined
      ? repository.listTenantAccountsByEmail(email)
      : repository
          .findTenantAccount({
            tenantSlug: explicitTenantSlug,
            email
          })
          .then((account) => (account === null ? [] : [account])),
    repository.findPlatformAdminAccount(email)
  ]);
  const [tenantPasswordValidity, platformPasswordValid] = await Promise.all([
    Promise.all(
      tenantAccounts.map((account) => {
        return verifyLocalPassword(input.password, account.passwordHash);
      })
    ),
    verifyLocalPassword(input.password, platformAdmin?.passwordHash)
  ]);
  const validTenantAccounts = tenantAccounts.filter((_account, index) => {
    return tenantPasswordValidity[index] === true;
  });

  if (validTenantAccounts.length === 0 && !platformPasswordValid) {
    throw new CoreError("auth.invalid_credentials");
  }

  if (
    !platformPasswordValid &&
    explicitTenantSlug === undefined &&
    validTenantAccounts.length > 1
  ) {
    throw new TenantLoginChoiceRequiredError({
      email,
      choices: validTenantAccounts.map((account) => {
        return {
          tenantSlug: account.tenantSlug,
          tenantDisplayName: account.tenantDisplayName
        };
      })
    });
  }

  return createStoredWebSession({
    repository,
    tenantAccount: validTenantAccounts[0],
    auditAction: "auth.login.succeeded",
    platformAuditAction: "platform.auth.login.succeeded",
    platformAdmin:
      platformPasswordValid && platformAdmin
        ? {
            id: platformAdmin.id,
            email: platformAdmin.email,
            displayName: platformAdmin.displayName
          }
        : undefined,
    platformAdminAccountId: platformPasswordValid
      ? platformAdmin?.id
      : undefined
  });
}

export async function registerLocalTenant(
  input: RegisterLocalTenantInput
): Promise<LoginLocalWebSessionResult> {
  const tenantSlug = normalizeTenantSlug(input.tenantSlug);
  const email = normalizeEmail(input.email, userSuppliedEmailPolicy());
  const password = requireRegistrationPassword(input.password, email);
  const now = new Date();
  const registration = registerTenant({
    now: now.toISOString(),
    tenantSlug,
    tenantDisplayName: input.tenantDisplayName,
    productName: input.tenantDisplayName,
    adminEmail: email,
    adminDisplayName: input.adminDisplayName,
    idFactory: createSequentialIdFactory(`tenant:${tenantSlug}`)
  });
  const passwordHash = await hashLocalPassword(password);
  const repository = getAuthRepository();

  await createTenantWorkspaceRepository(
    createDrizzlePersistenceExecutor(getWebDatabase())
  ).registerTenant({
    registration,
    adminPasswordHash: passwordHash
  });

  return createStoredWebSession({
    repository,
    auditAction: "auth.registration.completed",
    tenantAccount: {
      tenantId: registration.tenant.id,
      tenantSlug: registration.tenant.slug,
      tenantDisplayName: registration.tenant.displayName,
      accountId: `account:${registration.admin.id}`,
      employeeId: registration.admin.id,
      email: registration.admin.email,
      emailVerifiedAt: null,
      displayName: registration.admin.displayName,
      passwordHash,
      systemRoleTemplateIds: registration.admin.systemRoleTemplateIds,
      permissions: permissionsForSystemRoleTemplates(
        registration.admin.systemRoleTemplateIds
      )
    }
  });
}

export async function createTenantWebSession(
  tenantAccount: TenantAuthAccount,
  options: { auditAction?: SecurityAuditAction } = {}
): Promise<LoginLocalWebSessionResult> {
  return createStoredWebSession({
    repository: getAuthRepository(),
    auditAction: options.auditAction ?? "auth.login.succeeded",
    tenantAccount
  });
}

export async function writeTenantLoginChoices(input: {
  email: string;
  choices: readonly TenantLoginChoice[];
  returnTo?: string;
}): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + tenantLoginChoicesTtlMs);
  const cookieStore = await cookies();
  const config = resolveWebConfig();
  const cookieRuntime = resolveWebCookieRuntime(config.nodeEnv);

  cookieStore.set(
    cookieRuntime.tenantLoginChoicesCookieName,
    encodeSignedPayload({
      email: normalizeEmail(input.email),
      choices: input.choices,
      returnTo: input.returnTo,
      expiresAt: expiresAt.toISOString()
    }),
    buildWebCookieOptions({
      nodeEnv: config.nodeEnv,
      expires: expiresAt
    })
  );
  deleteInactiveCookieNames(
    cookieStore,
    cookieRuntime.tenantLoginChoicesCookieName,
    [...cookieRuntime.tenantLoginChoicesCookieReadNames]
  );
}

export async function readTenantLoginChoices(): Promise<TenantLoginChoices | null> {
  const cookieStore = await cookies();
  const value = readCookieValue(
    cookieStore,
    resolveWebCookieRuntime(resolveWebConfig().nodeEnv)
      .tenantLoginChoicesCookieReadNames
  );
  const choices = value ? decodeSignedPayload(value) : null;

  if (choices === null || new Date(choices.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  return choices;
}

export async function completeTenantLoginChoice(
  tenantSlug: string
): Promise<LoginLocalWebSessionResult | null> {
  const choices = await readTenantLoginChoices();
  const selectedTenantSlug = normalizeTenantSlug(tenantSlug);

  if (
    choices === null ||
    !choices.choices.some((choice) => choice.tenantSlug === selectedTenantSlug)
  ) {
    return null;
  }

  const tenantAccount = await getAuthRepository().findTenantAccount({
    tenantSlug: selectedTenantSlug,
    email: choices.email
  });

  if (tenantAccount === null) {
    return null;
  }

  await clearTenantLoginChoices();

  return createTenantWebSession(tenantAccount, {
    auditAction: "auth.login.tenant_selected"
  }).then((result) => ({
    ...result,
    redirectPath: choices.returnTo ?? result.redirectPath
  }));
}

async function createStoredWebSession(input: {
  repository: LocalAuthRepository;
  auditAction?: SecurityAuditAction;
  platformAuditAction?: PlatformAuditAction;
  tenantAccount?: TenantAuthAccount;
  platformAdmin?: NonNullable<AuthSessionPrincipal["platformAdmin"]>;
  platformAdminAccountId?: string;
}): Promise<LoginLocalWebSessionResult> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionTtlMs);
  const token = randomBytes(32).toString("base64url");
  const sessionId = `session:${randomUUID()}`;

  await input.repository.createSession({
    id: sessionId,
    token,
    tenantId: input.tenantAccount?.tenantId,
    employeeId: input.tenantAccount?.employeeId,
    platformAdminAccountId: input.platformAdminAccountId,
    expiresAt,
    createdAt: now
  });
  if (input.tenantAccount !== undefined) {
    await recordTenantAuthAudit({
      sessionId,
      action: input.auditAction ?? "auth.login.succeeded",
      tenantAccount: input.tenantAccount,
      occurredAt: now
    });
  }
  if (
    input.platformAdmin !== undefined &&
    input.platformAdminAccountId !== undefined
  ) {
    await recordPlatformAuthAudit({
      sessionId,
      action: input.platformAuditAction ?? "platform.auth.login.succeeded",
      platformAdminAccountId: input.platformAdminAccountId,
      occurredAt: now
    });
  }
  await writeSessionToken(token, expiresAt);
  if (input.tenantAccount !== undefined) {
    await writeLastTenantSlug(input.tenantAccount.tenantSlug, now);
  }

  const session = webAccessSessionFromPrincipal({
    sessionId,
    createdAt: now,
    expiresAt,
    tenantAccount: input.tenantAccount,
    platformAdmin: input.platformAdmin
  });

  return {
    session,
    tenantAccount: input.tenantAccount,
    redirectPath: session.platformRoles.includes("platform_admin")
      ? "/platform"
      : "/"
  };
}

export async function logoutCurrentWebSession(): Promise<void> {
  const token = await readSessionToken();
  const repository = getAuthRepository();
  const now = new Date();
  const principal =
    token === undefined
      ? null
      : await repository.findSessionByToken(token, now);

  if (token !== undefined) {
    await repository.revokeSession(token, now);
  }

  if (principal?.tenantAccount !== undefined) {
    try {
      await recordTenantAuthAudit({
        sessionId: principal.sessionId,
        action: "auth.logout.succeeded",
        tenantAccount: principal.tenantAccount,
        occurredAt: now
      });
    } catch {
      // Logout must clear the browser session even if the audit sink is unavailable.
    }
  }
  if (principal?.platformAdmin !== undefined) {
    try {
      await recordPlatformAuthAudit({
        sessionId: principal.sessionId,
        action: "platform.auth.logout.succeeded",
        platformAdminAccountId: principal.platformAdmin.id,
        occurredAt: now
      });
    } catch {
      // Logout must clear the browser session even if the audit sink is unavailable.
    }
  }

  const cookieStore = await cookies();
  const cookieRuntime = resolveWebCookieRuntime(resolveWebConfig().nodeEnv);

  deleteCookieNames(cookieStore, [
    ...cookieRuntime.authSessionCookieReadNames,
    ...cookieRuntime.tenantLoginChoicesCookieReadNames
  ]);
}

export function webAccessSessionFromPrincipal(
  principal: AuthSessionPrincipal
): WebAccessSession {
  const tenantAccount = principal.tenantAccount;
  const systemRoleTemplateIds = tenantAccount?.systemRoleTemplateIds ?? [];
  const permissions = tenantAccount?.permissions ?? [];
  const platformRoles: PlatformRole[] =
    principal.platformAdmin === undefined ? [] : ["platform_admin"];

  return {
    tenantId: tenantAccount?.tenantId ?? platformOnlyTenantId,
    tenantSlug: tenantAccount?.tenantSlug,
    tenantDisplayName: tenantAccount?.tenantDisplayName,
    accountId: tenantAccount?.accountId,
    sessionId: principal.sessionId,
    sessionCreatedAt: principal.createdAt.toISOString(),
    sessionExpiresAt: principal.expiresAt.toISOString(),
    employeeId:
      tenantAccount?.employeeId ??
      (`employee:platform:${principal.platformAdmin?.id ?? "anonymous"}` as EmployeeId),
    email: tenantAccount?.email ?? principal.platformAdmin?.email,
    displayName:
      tenantAccount?.displayName ?? principal.platformAdmin?.displayName,
    avatarUrl: tenantAccount?.avatarUrl,
    emailVerifiedAt:
      tenantAccount?.emailVerifiedAt === undefined
        ? undefined
        : (tenantAccount.emailVerifiedAt?.toISOString() ?? null),
    systemRoleTemplateIds,
    permissions,
    platformRoles,
    ...(principal.platformAdmin?.id
      ? { platformAdminAccountId: principal.platformAdmin.id }
      : {})
  };
}

function getAuthRepository(): LocalAuthRepository {
  return createSqlLocalAuthRepository(getWebDatabase());
}

async function recordTenantAuthAudit(input: {
  sessionId: string;
  action: SecurityAuditAction;
  tenantAccount: TenantAuthAccount;
  occurredAt: Date;
}): Promise<void> {
  await createSqlSecurityAuditRepository(getWebDatabase()).record({
    id: `audit:${input.sessionId}:${input.action}`,
    tenantId: input.tenantAccount.tenantId,
    actorEmployeeId: input.tenantAccount.employeeId,
    action: input.action,
    entityType: "session",
    entityId: input.sessionId,
    metadata: {
      accountId: input.tenantAccount.accountId,
      surface: "web"
    },
    occurredAt: input.occurredAt
  });
}

async function recordPlatformAuthAudit(input: {
  sessionId: string;
  action: PlatformAuditAction;
  platformAdminAccountId: string;
  occurredAt: Date;
}): Promise<void> {
  await createSqlPlatformAuditRepository(getWebDatabase()).record({
    id: `platform-audit:${input.sessionId}:${input.action}`,
    actorPlatformAdminAccountId: input.platformAdminAccountId,
    action: input.action,
    entityType: "session",
    entityId: input.sessionId,
    metadata: {
      surface: "web"
    },
    occurredAt: input.occurredAt
  });
}

async function readSessionToken(): Promise<string | undefined> {
  const cookieStore = await cookies();

  return readCookieValue(
    cookieStore,
    resolveWebCookieRuntime(resolveWebConfig().nodeEnv)
      .authSessionCookieReadNames
  );
}

async function writeSessionToken(
  token: string,
  expiresAt: Date
): Promise<void> {
  const cookieStore = await cookies();
  const config = resolveWebConfig();
  const cookieRuntime = resolveWebCookieRuntime(config.nodeEnv);

  cookieStore.set(
    cookieRuntime.authSessionCookieName,
    token,
    buildWebCookieOptions({
      nodeEnv: config.nodeEnv,
      expires: expiresAt
    })
  );
  deleteInactiveCookieNames(cookieStore, cookieRuntime.authSessionCookieName, [
    ...cookieRuntime.authSessionCookieReadNames
  ]);
}

async function readLastTenantSlug(): Promise<string | undefined> {
  const cookieStore = await cookies();

  return readCookieValue(
    cookieStore,
    resolveWebCookieRuntime(resolveWebConfig().nodeEnv)
      .lastTenantSlugCookieReadNames
  );
}

async function writeLastTenantSlug(slug: string, now: Date): Promise<void> {
  const cookieStore = await cookies();
  const config = resolveWebConfig();
  const cookieRuntime = resolveWebCookieRuntime(config.nodeEnv);
  const expires = new Date(now.getTime() + lastTenantSlugTtlMs);

  cookieStore.set(
    cookieRuntime.lastTenantSlugCookieName,
    slug,
    buildWebCookieOptions({
      nodeEnv: config.nodeEnv,
      expires
    })
  );
  deleteInactiveCookieNames(
    cookieStore,
    cookieRuntime.lastTenantSlugCookieName,
    [...cookieRuntime.lastTenantSlugCookieReadNames]
  );
}

async function clearTenantLoginChoices(): Promise<void> {
  const cookieStore = await cookies();

  deleteCookieNames(
    cookieStore,
    resolveWebCookieRuntime(resolveWebConfig().nodeEnv)
      .tenantLoginChoicesCookieReadNames
  );
}

type MutableCookieStore = Awaited<ReturnType<typeof cookies>>;

function readCookieValue(
  cookieStore: MutableCookieStore,
  names: readonly string[]
): string | undefined {
  for (const name of names) {
    const value = cookieStore.get(name)?.value;

    if (value !== undefined && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

function deleteCookieNames(
  cookieStore: MutableCookieStore,
  names: readonly string[]
): void {
  for (const name of names) {
    cookieStore.delete(name);
  }
}

function deleteInactiveCookieNames(
  cookieStore: MutableCookieStore,
  activeName: string,
  names: readonly string[]
): void {
  for (const name of names) {
    if (name !== activeName) {
      cookieStore.delete(name);
    }
  }
}

export async function resolvePreferredTenantSlug(
  tenantSlug?: string
): Promise<string> {
  const env = resolveWebEnv();

  return normalizeTenantSlug(
    tenantSlug ??
      (await readLastTenantSlug()) ??
      env.HULEE_WEB_TENANT_SLUG ??
      "local"
  );
}

function encodeSignedPayload(payload: TenantLoginChoices): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );
  const signature = signPayload(encoded);

  return `${encoded}.${signature}`;
}

function decodeSignedPayload(value: string): TenantLoginChoices | null {
  const [encoded, signature] = value.split(".");

  if (
    encoded === undefined ||
    signature === undefined ||
    !isSignatureValid(encoded, signature)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    ) as unknown;

    return parseTenantLoginChoices(parsed);
  } catch {
    return null;
  }
}

function signPayload(encoded: string): string {
  return createHmac("sha256", resolveTenantLoginChoiceSecret())
    .update(encoded)
    .digest("base64url");
}

function isSignatureValid(encoded: string, signature: string): boolean {
  const expected = Buffer.from(signPayload(encoded), "base64url");
  const actual = Buffer.from(signature, "base64url");

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function parseTenantLoginChoices(value: unknown): TenantLoginChoices | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const choices = payload.choices;

  if (
    typeof payload.email !== "string" ||
    typeof payload.expiresAt !== "string" ||
    Number.isNaN(new Date(payload.expiresAt).getTime()) ||
    !Array.isArray(choices)
  ) {
    return null;
  }

  const parsedChoices = choices.flatMap((choice): TenantLoginChoice[] => {
    if (typeof choice !== "object" || choice === null) {
      return [];
    }

    const record = choice as Record<string, unknown>;

    return typeof record.tenantSlug === "string" &&
      typeof record.tenantDisplayName === "string"
      ? [
          {
            tenantSlug: record.tenantSlug,
            tenantDisplayName: record.tenantDisplayName
          }
        ]
      : [];
  });

  if (parsedChoices.length === 0) {
    return null;
  }

  return {
    email: normalizeEmail(payload.email),
    expiresAt: payload.expiresAt,
    choices: parsedChoices
  };
}

function resolveTenantLoginChoiceSecret(): string {
  const config = resolveWebConfig();
  const configured =
    config.authChoiceSecret?.trim() || config.internalApiSecret?.trim();

  return configured && configured.length > 0
    ? configured
    : "development-auth-choice-secret";
}

function normalizeEmail(
  email: string,
  policy: EmailValidationPolicy = {}
): string {
  try {
    return normalizeEmailAddress(email, policy);
  } catch {
    throw new CoreError("validation.failed");
  }
}

function normalizeTenantSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

function userSuppliedEmailPolicy(): EmailValidationPolicy {
  const config = resolveWebConfig();

  return {
    blockDisposableDomains: true,
    blockReservedDomains: config.nodeEnv === "production"
  };
}

function requireRegistrationPassword(password: string, email: string): string {
  const result = validatePasswordPolicy(password, { email });

  if (!result.valid) {
    throw new CoreError("validation.failed");
  }

  return result.password;
}
