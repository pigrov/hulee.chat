import type { EmployeeId } from "@hulee/contracts";
import {
  createDrizzlePersistenceExecutor,
  createHuleeDatabase,
  createSqlLocalAuthRepository,
  createTenantWorkspaceRepository,
  type AuthSessionPrincipal,
  type HuleeDatabase,
  type LocalAuthRepository,
  type TenantAuthAccount
} from "@hulee/db";
import {
  CoreError,
  createInternalApiSignature,
  createSequentialIdFactory,
  internalApiSignatureHeader,
  internalApiTimestampHeader,
  permissionsForRoles,
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
import { resolveWebConfig, resolveWebEnv } from "./web-config";

export { resolveWebConfig, resolveWebEnv } from "./web-config";

export const authSessionCookieName = "hulee_session";
export const lastTenantSlugCookieName = "hulee_last_tenant";
export const tenantLoginChoicesCookieName = "hulee_login_choices";

const sessionTtlMs = 1000 * 60 * 60 * 24 * 14;
const lastTenantSlugTtlMs = 1000 * 60 * 60 * 24 * 365;
const tenantLoginChoicesTtlMs = 1000 * 60 * 10;

let database: HuleeDatabase | undefined;

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

export type AssertCurrentWebTenantPermissionOptions = {
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

export async function assertCurrentWebTenantPermission(
  permission: Permission,
  options: AssertCurrentWebTenantPermissionOptions = {}
): Promise<WebAccessSession> {
  const session = await requireCurrentWebAccessSession();

  if (!session.permissions.includes(permission)) {
    throw new CoreError("permission.denied");
  }

  if (options.requireVerifiedEmail === true) {
    assertWebTenantEmailVerified(session);
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
}): Promise<Record<string, string>> {
  const session = await requireCurrentWebAccessSession();
  const headers = buildInternalApiHeadersForSession(session);
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
      tenantId: session.tenantId,
      employeeId: session.employeeId,
      permissions: session.permissions,
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
  const email = normalizeEmail(input.email);
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
      roles: registration.admin.roles,
      permissions: permissionsForRoles(registration.admin.roles)
    }
  });
}

export async function createTenantWebSession(
  tenantAccount: TenantAuthAccount
): Promise<LoginLocalWebSessionResult> {
  return createStoredWebSession({
    repository: getAuthRepository(),
    tenantAccount
  });
}

export async function writeTenantLoginChoices(input: {
  email: string;
  choices: readonly TenantLoginChoice[];
}): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + tenantLoginChoicesTtlMs);
  const cookieStore = await cookies();

  cookieStore.set(
    tenantLoginChoicesCookieName,
    encodeSignedPayload({
      email: normalizeEmail(input.email),
      choices: input.choices,
      expiresAt: expiresAt.toISOString()
    }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: resolveWebConfig().nodeEnv === "production",
      path: "/",
      expires: expiresAt
    }
  );
}

export async function readTenantLoginChoices(): Promise<TenantLoginChoices | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(tenantLoginChoicesCookieName)?.value;
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

  return createTenantWebSession(tenantAccount);
}

async function createStoredWebSession(input: {
  repository: LocalAuthRepository;
  tenantAccount?: TenantAuthAccount;
  platformAdmin?: NonNullable<AuthSessionPrincipal["platformAdmin"]>;
  platformAdminAccountId?: string;
}): Promise<LoginLocalWebSessionResult> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionTtlMs);
  const token = randomBytes(32).toString("base64url");

  await input.repository.createSession({
    id: `session:${randomUUID()}`,
    token,
    tenantId: input.tenantAccount?.tenantId,
    employeeId: input.tenantAccount?.employeeId,
    platformAdminAccountId: input.platformAdminAccountId,
    expiresAt,
    createdAt: now
  });
  await writeSessionToken(token, expiresAt);
  if (input.tenantAccount !== undefined) {
    await writeLastTenantSlug(input.tenantAccount.tenantSlug, now);
  }

  const session = webAccessSessionFromPrincipal({
    sessionId: "new-session",
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

  if (token !== undefined) {
    await getAuthRepository().revokeSession(token, new Date());
  }

  const cookieStore = await cookies();
  cookieStore.delete(authSessionCookieName);
  cookieStore.delete(tenantLoginChoicesCookieName);
}

function webAccessSessionFromPrincipal(
  principal: AuthSessionPrincipal
): WebAccessSession {
  const env = resolveWebEnv();
  const fallback = resolveWebAccessSession(env);
  const tenantRoles = principal.tenantAccount?.roles ?? [];
  const platformRoles: PlatformRole[] =
    principal.platformAdmin === undefined ? [] : ["platform_admin"];

  return {
    tenantId: principal.tenantAccount?.tenantId ?? fallback.tenantId,
    tenantSlug: principal.tenantAccount?.tenantSlug,
    tenantDisplayName: principal.tenantAccount?.tenantDisplayName,
    accountId: principal.tenantAccount?.accountId,
    employeeId:
      principal.tenantAccount?.employeeId ??
      (`employee:platform:${principal.platformAdmin?.id ?? "anonymous"}` as EmployeeId),
    email: principal.tenantAccount?.email ?? principal.platformAdmin?.email,
    emailVerifiedAt:
      principal.tenantAccount?.emailVerifiedAt === undefined
        ? undefined
        : (principal.tenantAccount.emailVerifiedAt?.toISOString() ?? null),
    tenantRoles,
    permissions: permissionsForRoles(tenantRoles),
    platformRoles
  };
}

function getAuthRepository(): LocalAuthRepository {
  return createSqlLocalAuthRepository(getWebDatabase());
}

export function getWebDatabase(): HuleeDatabase {
  const config = resolveWebConfig();

  database ??= createHuleeDatabase({
    connectionString: config.databaseUrl,
    logger: resolveWebEnv().DATABASE_LOG === "true"
  });

  return database;
}

async function readSessionToken(): Promise<string | undefined> {
  const cookieStore = await cookies();
  const token = cookieStore.get(authSessionCookieName)?.value;

  return token && token.length > 0 ? token : undefined;
}

async function writeSessionToken(
  token: string,
  expiresAt: Date
): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(authSessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: resolveWebConfig().nodeEnv === "production",
    path: "/",
    expires: expiresAt
  });
}

async function readLastTenantSlug(): Promise<string | undefined> {
  const cookieStore = await cookies();
  const slug = cookieStore.get(lastTenantSlugCookieName)?.value;

  return slug && slug.length > 0 ? slug : undefined;
}

async function writeLastTenantSlug(slug: string, now: Date): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(lastTenantSlugCookieName, slug, {
    httpOnly: true,
    sameSite: "lax",
    secure: resolveWebConfig().nodeEnv === "production",
    path: "/",
    expires: new Date(now.getTime() + lastTenantSlugTtlMs)
  });
}

async function clearTenantLoginChoices(): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.delete(tenantLoginChoicesCookieName);
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

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeTenantSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

function requireRegistrationPassword(password: string, email: string): string {
  const result = validatePasswordPolicy(password, { email });

  if (!result.valid) {
    throw new CoreError("validation.failed");
  }

  return result.password;
}
