import { CoreError, type Permission } from "@hulee/core";

export type InternalApiRouteAccessInput = {
  readonly method: string;
  readonly path: string;
};

export type InternalApiEffectivePermissionOverrideInput =
  InternalApiRouteAccessInput & {
    readonly effectivePermissionOverride?: Permission;
  };

export function resolveRequiredInternalApiEffectivePermissionOverride(
  input: InternalApiRouteAccessInput
): Permission | undefined {
  const method = input.method.toUpperCase();
  const pathname = normalizeInternalApiPath(input.path);

  if (
    (method === "GET" || method === "PUT") &&
    pathname === "/internal/v1/tenant/brand"
  ) {
    return "tenant.manage";
  }

  if (method === "GET" && pathname === "/internal/v1/org-structure") {
    return "employees.manage";
  }

  if (
    method === "PUT" &&
    (pathname === "/internal/v1/org-structure/org-units" ||
      pathname === "/internal/v1/org-structure/work-queues")
  ) {
    return "employees.manage";
  }

  if (method === "POST" && pathname === "/internal/v1/access/decision") {
    return "roles.manage";
  }

  if (
    pathname === "/internal/v1/rbac/roles" &&
    (method === "GET" || method === "POST")
  ) {
    return "roles.manage";
  }

  if (
    /^\/internal\/v1\/rbac\/roles\/[^/]+$/.test(pathname) &&
    method === "PATCH"
  ) {
    return "roles.manage";
  }

  if (
    /^\/internal\/v1\/rbac\/roles\/[^/]+\/(archive|restore)$/.test(pathname) &&
    method === "POST"
  ) {
    return "roles.manage";
  }

  if (
    pathname === "/internal/v1/rbac/role-bindings" &&
    (method === "GET" || method === "POST")
  ) {
    return "roles.manage";
  }

  if (
    /^\/internal\/v1\/rbac\/role-bindings\/[^/]+$/.test(pathname) &&
    method === "DELETE"
  ) {
    return "roles.manage";
  }

  if (
    pathname === "/internal/v1/rbac/direct-grants" &&
    (method === "GET" || method === "POST")
  ) {
    return "roles.manage";
  }

  if (
    /^\/internal\/v1\/rbac\/direct-grants\/[^/]+$/.test(pathname) &&
    method === "DELETE"
  ) {
    return "roles.manage";
  }

  if (
    (method === "GET" &&
      (pathname === "/internal/v1/channels/catalog" ||
        pathname === "/internal/v1/channels/connectors" ||
        pathname === "/internal/v1/egress/status")) ||
    (method === "POST" && pathname === "/internal/v1/channels/connectors") ||
    (method === "POST" &&
      pathname === "/internal/v1/channels/telegram-bot/token/validate") ||
    (method === "POST" &&
      /^\/internal\/v1\/channels\/connectors\/[^/]+\/disable$/.test(
        pathname
      )) ||
    (method === "DELETE" &&
      /^\/internal\/v1\/channels\/connectors\/[^/]+$/.test(pathname)) ||
    ((method === "GET" || method === "PUT") &&
      /^\/internal\/v1\/channels\/connectors\/[^/]+\/telegram$/.test(
        pathname
      )) ||
    (method === "POST" &&
      /^\/internal\/v1\/channels\/connectors\/[^/]+\/telegram\/diagnostics$/.test(
        pathname
      )) ||
    ((method === "POST" || method === "DELETE") &&
      /^\/internal\/v1\/channels\/connectors\/[^/]+\/telegram\/webhook$/.test(
        pathname
      ))
  ) {
    return "modules.manage";
  }

  return undefined;
}

export function assertInternalApiEffectivePermissionOverride(
  input: InternalApiEffectivePermissionOverrideInput
): Permission | undefined {
  const requiredOverride =
    resolveRequiredInternalApiEffectivePermissionOverride(input);

  if (
    requiredOverride !== undefined &&
    input.effectivePermissionOverride !== requiredOverride
  ) {
    throw new CoreError("permission.denied");
  }

  return input.effectivePermissionOverride;
}

function normalizeInternalApiPath(path: string): string {
  const pathname = path.split("?")[0] ?? path;

  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }

  return pathname;
}
