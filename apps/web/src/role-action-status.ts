import { CoreError } from "@hulee/core";

export type RoleActionFailureStatus = "invalid" | "permission_denied";

export function roleActionFailureStatus(
  error: unknown
): RoleActionFailureStatus {
  return error instanceof CoreError && error.code === "permission.denied"
    ? "permission_denied"
    : "invalid";
}
