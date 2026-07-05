export type BrandingActionCode =
  | "invalid"
  | "internal_api_failed"
  | "logo_invalid_type"
  | "logo_metadata_unavailable"
  | "logo_storage_unavailable"
  | "logo_too_large"
  | "permission_denied"
  | "saved";

export type BrandingActionState =
  | {
      readonly status: "idle";
    }
  | {
      readonly code: "saved";
      readonly status: "success";
      readonly submittedAt: string;
    }
  | {
      readonly code: Exclude<BrandingActionCode, "saved">;
      readonly status: "error";
      readonly submittedAt: string;
    };

export const initialBrandingActionState: BrandingActionState = {
  status: "idle"
};
