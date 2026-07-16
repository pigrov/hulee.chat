export async function buildInternalApiHeaders(_input: {
  method: string;
  path: string;
  body?: unknown;
  effectivePermissionOverride?: string;
}): Promise<Record<string, string>> {
  return {
    "x-hulee-db008-runtime": "n-1"
  };
}
