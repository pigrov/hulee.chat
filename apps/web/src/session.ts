import { loadLocalEnvFile, mergeEnvSources } from "@hulee/config";
import type { EmployeeId } from "@hulee/contracts";
import {
  createHuleeDatabase,
  createSqlLocalAuthRepository,
  type AuthSessionPrincipal,
  type HuleeDatabase,
  type LocalAuthRepository
} from "@hulee/db";
import { CoreError, permissionsForRoles, type Permission } from "@hulee/core";
import { verifyLocalPassword } from "@hulee/modules";
import { cookies } from "next/headers";
import { randomBytes, randomUUID } from "node:crypto";

import {
  buildInternalApiHeaders as buildInternalApiHeadersForSession,
  resolveWebAccessSession,
  type PlatformRole,
  type WebAccessSession
} from "./access";

export const authSessionCookieName = "hulee_session";

const sessionTtlMs = 1000 * 60 * 60 * 24 * 14;
const localEnv = loadLocalEnvFile();

let database: HuleeDatabase | undefined;

export type ResolveCurrentWebAccessSessionOptions = {
  allowDevelopmentFallback?: boolean;
};

export type LoginLocalWebSessionInput = {
  email: string;
  password: string;
};

export type LoginLocalWebSessionResult = {
  session: WebAccessSession;
  redirectPath: string;
};

export async function resolveCurrentWebAccessSession(
  options: ResolveCurrentWebAccessSessionOptions = {}
): Promise<WebAccessSession | null> {
  const env = resolveWebEnv();
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
    env.NODE_ENV !== "production" &&
    !isEnabled(env.HULEE_WEB_AUTH_REQUIRED)
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
  permission: Permission
): Promise<WebAccessSession> {
  const session = await requireCurrentWebAccessSession();

  if (!session.permissions.includes(permission)) {
    throw new CoreError("permission.denied");
  }

  return session;
}

export async function buildInternalApiHeaders(): Promise<
  Record<string, string>
> {
  return buildInternalApiHeadersForSession(
    await requireCurrentWebAccessSession()
  );
}

export async function loginLocalWebSession(
  input: LoginLocalWebSessionInput
): Promise<LoginLocalWebSessionResult> {
  const email = normalizeEmail(input.email);
  const env = resolveWebEnv();
  const tenantSlug = env.HULEE_WEB_TENANT_SLUG ?? "local";
  const repository = getAuthRepository();
  const [tenantAccount, platformAdmin] = await Promise.all([
    repository.findTenantAccount({
      tenantSlug,
      email
    }),
    repository.findPlatformAdminAccount(email)
  ]);
  const [tenantPasswordValid, platformPasswordValid] = await Promise.all([
    verifyLocalPassword(input.password, tenantAccount?.passwordHash),
    verifyLocalPassword(input.password, platformAdmin?.passwordHash)
  ]);

  if (!tenantPasswordValid && !platformPasswordValid) {
    throw new CoreError("auth.invalid_credentials");
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionTtlMs);
  const token = randomBytes(32).toString("base64url");

  await repository.createSession({
    id: `session:${randomUUID()}`,
    token,
    tenantId: tenantPasswordValid ? tenantAccount?.tenantId : undefined,
    employeeId: tenantPasswordValid ? tenantAccount?.employeeId : undefined,
    platformAdminAccountId: platformPasswordValid
      ? platformAdmin?.id
      : undefined,
    expiresAt,
    createdAt: now
  });
  await writeSessionToken(token, expiresAt);

  const session = webAccessSessionFromPrincipal({
    sessionId: "new-session",
    expiresAt,
    tenantAccount: tenantPasswordValid
      ? (tenantAccount ?? undefined)
      : undefined,
    platformAdmin:
      platformPasswordValid && platformAdmin
        ? {
            id: platformAdmin.id,
            email: platformAdmin.email,
            displayName: platformAdmin.displayName
          }
        : undefined
  });

  return {
    session,
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
    employeeId:
      principal.tenantAccount?.employeeId ??
      (`employee:platform:${principal.platformAdmin?.id ?? "anonymous"}` as EmployeeId),
    tenantRoles,
    permissions: permissionsForRoles(tenantRoles),
    platformRoles
  };
}

function getAuthRepository(): LocalAuthRepository {
  const env = resolveWebEnv();

  database ??= createHuleeDatabase({
    connectionString: env.DATABASE_URL,
    logger: env.DATABASE_LOG === "true"
  });

  return createSqlLocalAuthRepository(database);
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
    secure: resolveWebEnv().NODE_ENV === "production",
    path: "/",
    expires: expiresAt
  });
}

function resolveWebEnv(): NodeJS.ProcessEnv {
  return mergeEnvSources(localEnv, process.env) as NodeJS.ProcessEnv;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isEnabled(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}
