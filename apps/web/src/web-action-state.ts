export type WebActionState<TCode extends string> =
  | {
      readonly status: "idle";
    }
  | {
      readonly code: TCode;
      readonly status: "success";
      readonly submittedAt: string;
    }
  | {
      readonly code: TCode;
      readonly status: "error";
      readonly submittedAt: string;
    };
