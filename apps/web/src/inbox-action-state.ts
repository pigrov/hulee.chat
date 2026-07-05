export type InboxReplyActionCode =
  | "email_verification_required"
  | "invalid"
  | "permission_denied"
  | "sent";

export type InboxRoutingActionCode =
  | "email_verification_required"
  | "invalid"
  | "permission_denied"
  | "saved";

export type InboxReplyActionState =
  | {
      readonly status: "idle";
    }
  | {
      readonly code: "sent";
      readonly status: "success";
      readonly submittedAt: string;
    }
  | {
      readonly code: Exclude<InboxReplyActionCode, "sent">;
      readonly status: "error";
      readonly submittedAt: string;
    };

export type InboxRoutingActionState =
  | {
      readonly status: "idle";
    }
  | {
      readonly code: "saved";
      readonly status: "success";
      readonly submittedAt: string;
    }
  | {
      readonly code: Exclude<InboxRoutingActionCode, "saved">;
      readonly status: "error";
      readonly submittedAt: string;
    };

export type InboxReplyActionMessages = Record<InboxReplyActionCode, string>;
export type InboxRoutingActionMessages = Record<InboxRoutingActionCode, string>;

export const initialInboxReplyActionState: InboxReplyActionState = {
  status: "idle"
};

export const initialInboxRoutingActionState: InboxRoutingActionState = {
  status: "idle"
};

export function inboxReplyActionSuccess(
  code: Extract<InboxReplyActionState, { status: "success" }>["code"]
): InboxReplyActionState {
  return {
    code,
    status: "success",
    submittedAt: new Date().toISOString()
  };
}

export function inboxReplyActionError(
  code: Extract<InboxReplyActionState, { status: "error" }>["code"]
): InboxReplyActionState {
  return {
    code,
    status: "error",
    submittedAt: new Date().toISOString()
  };
}

export function inboxRoutingActionSuccess(
  code: Extract<InboxRoutingActionState, { status: "success" }>["code"]
): InboxRoutingActionState {
  return {
    code,
    status: "success",
    submittedAt: new Date().toISOString()
  };
}

export function inboxRoutingActionError(
  code: Extract<InboxRoutingActionState, { status: "error" }>["code"]
): InboxRoutingActionState {
  return {
    code,
    status: "error",
    submittedAt: new Date().toISOString()
  };
}
