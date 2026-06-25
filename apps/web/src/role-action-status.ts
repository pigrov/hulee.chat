import { CoreError } from "@hulee/core";

import { isPrivilegedActionReauthRequiredError } from "./privileged-action-policy";

export type RoleActionFailureStatus =
  | "invalid"
  | "permission_denied"
  | "reauth_required";

export function roleActionFailureStatus(
  error: unknown
): RoleActionFailureStatus {
  if (isPrivilegedActionReauthRequiredError(error)) {
    return "reauth_required";
  }

  return error instanceof CoreError && error.code === "permission.denied"
    ? "permission_denied"
    : "invalid";
}
