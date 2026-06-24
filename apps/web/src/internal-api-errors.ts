import { internalApiErrorResponseSchema } from "@hulee/contracts";
import { CoreError } from "@hulee/core";

export function coreErrorFromInternalApiErrorBody(
  body: unknown
): CoreError | undefined {
  const parsed = internalApiErrorResponseSchema.safeParse(body);

  return parsed.success ? new CoreError(parsed.data.error.code) : undefined;
}

export async function throwInternalApiErrorResponse(input: {
  readonly response: Response;
  readonly message: string;
}): Promise<never> {
  const coreError = coreErrorFromInternalApiErrorBody(
    await readJsonBody(input.response)
  );

  if (coreError !== undefined) {
    throw coreError;
  }

  throw new Error(`${input.message} HTTP ${input.response.status}.`);
}

async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
