export const authSessionCookieName = "hulee_session";
export const lastTenantSlugCookieName = "hulee_last_tenant";
export const tenantLoginChoicesCookieName = "hulee_login_choices";

export const productionAuthSessionCookieName = "__Host-hulee_session";
export const productionLastTenantSlugCookieName = "__Host-hulee_last_tenant";
export const productionTenantLoginChoicesCookieName =
  "__Host-hulee_login_choices";

export type WebCookieRuntime = {
  readonly authSessionCookieName: string;
  readonly authSessionCookieReadNames: readonly string[];
  readonly lastTenantSlugCookieName: string;
  readonly lastTenantSlugCookieReadNames: readonly string[];
  readonly tenantLoginChoicesCookieName: string;
  readonly tenantLoginChoicesCookieReadNames: readonly string[];
};

export type WebCookieOptions = {
  readonly httpOnly: true;
  readonly sameSite: "lax";
  readonly secure: boolean;
  readonly path: "/";
  readonly expires: Date;
  readonly priority: "high";
};

export function resolveWebCookieRuntime(nodeEnv: string): WebCookieRuntime {
  if (nodeEnv !== "production") {
    return {
      authSessionCookieName,
      authSessionCookieReadNames: [authSessionCookieName],
      lastTenantSlugCookieName,
      lastTenantSlugCookieReadNames: [lastTenantSlugCookieName],
      tenantLoginChoicesCookieName,
      tenantLoginChoicesCookieReadNames: [tenantLoginChoicesCookieName]
    };
  }

  return {
    authSessionCookieName: productionAuthSessionCookieName,
    authSessionCookieReadNames: [
      productionAuthSessionCookieName,
      authSessionCookieName
    ],
    lastTenantSlugCookieName: productionLastTenantSlugCookieName,
    lastTenantSlugCookieReadNames: [
      productionLastTenantSlugCookieName,
      lastTenantSlugCookieName
    ],
    tenantLoginChoicesCookieName: productionTenantLoginChoicesCookieName,
    tenantLoginChoicesCookieReadNames: [
      productionTenantLoginChoicesCookieName,
      tenantLoginChoicesCookieName
    ]
  };
}

export function buildWebCookieOptions(input: {
  readonly nodeEnv: string;
  readonly expires: Date;
}): WebCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: input.nodeEnv === "production",
    path: "/",
    expires: input.expires,
    priority: "high"
  };
}
