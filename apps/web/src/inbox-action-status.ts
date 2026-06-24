import { CoreError } from "@hulee/core";

export type InboxRoutingActionFailureStatus = "invalid" | "permission_denied";
export type InboxRoutingActionStatus =
  | "saved"
  | InboxRoutingActionFailureStatus;

export function inboxRoutingActionFailureStatus(
  error: unknown
): InboxRoutingActionFailureStatus {
  return error instanceof CoreError && error.code === "permission.denied"
    ? "permission_denied"
    : "invalid";
}
