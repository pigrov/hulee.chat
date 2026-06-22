import type { PlatformErrorCode } from "@hulee/contracts";

export class CoreError extends Error {
  readonly code: PlatformErrorCode;

  constructor(code: PlatformErrorCode, message: string = code) {
    super(message);
    this.name = "CoreError";
    this.code = code;
  }
}
