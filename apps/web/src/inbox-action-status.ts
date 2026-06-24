import { CoreError } from "@hulee/core";

export type InboxRoutingActionFailureStatus = "invalid" | "permission_denied";
export type InboxRoutingActionStatus =
  | "saved"
  | InboxRoutingActionFailureStatus;
export type InboxReplyActionFailureStatus = "invalid" | "permission_denied";
export type InboxReplyActionStatus = "sent" | InboxReplyActionFailureStatus;

export function inboxRoutingActionFailureStatus(
  error: unknown
): InboxRoutingActionFailureStatus {
  return error instanceof CoreError && error.code === "permission.denied"
    ? "permission_denied"
    : "invalid";
}

export function inboxReplyActionFailureStatus(
  error: unknown
): InboxReplyActionFailureStatus {
  return error instanceof CoreError && error.code === "permission.denied"
    ? "permission_denied"
    : "invalid";
}
