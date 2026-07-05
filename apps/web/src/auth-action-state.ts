export type AuthActionCode =
  | "forgot_password_sent"
  | "invalid_credentials"
  | "invite_invalid"
  | "registration_invalid"
  | "reset_invalid"
  | "reset_password_policy";

export type AuthActionState =
  | {
      readonly status: "idle";
    }
  | {
      readonly code: "forgot_password_sent";
      readonly status: "success";
      readonly submittedAt: string;
    }
  | {
      readonly code: Exclude<AuthActionCode, "forgot_password_sent">;
      readonly status: "error";
      readonly submittedAt: string;
    };

export type AuthActionMessages = Record<AuthActionCode, string>;

export const initialAuthActionState: AuthActionState = {
  status: "idle"
};

export function authActionSuccess(
  code: Extract<AuthActionState, { status: "success" }>["code"]
): AuthActionState {
  return {
    code,
    status: "success",
    submittedAt: new Date().toISOString()
  };
}

export function authActionError(
  code: Extract<AuthActionState, { status: "error" }>["code"]
): AuthActionState {
  return {
    code,
    status: "error",
    submittedAt: new Date().toISOString()
  };
}
