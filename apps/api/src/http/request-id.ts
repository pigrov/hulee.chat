export type RequestHeaders = Record<string, string | undefined> | undefined;

const requestIdHeader = "x-request-id";
const maximumRequestIdLength = 128;
const requestIdPattern = /^[A-Za-z0-9._:-]+$/;

export function resolveRequestId(input: {
  headers: RequestHeaders;
  requestIdFactory: () => string;
}): string {
  const headerRequestId = headerValue(input.headers, requestIdHeader)?.trim();

  return headerRequestId !== undefined && isSafeRequestId(headerRequestId)
    ? headerRequestId
    : input.requestIdFactory();
}

export function isSafeRequestId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= maximumRequestIdLength &&
    requestIdPattern.test(value)
  );
}

function headerValue(
  headers: RequestHeaders,
  name: string
): string | undefined {
  if (headers === undefined) {
    return undefined;
  }

  const lowerName = name.toLowerCase();

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) {
      return value;
    }
  }

  return undefined;
}
