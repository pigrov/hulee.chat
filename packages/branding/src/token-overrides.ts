export function mergeTokenOverrides(
  ...sources: Array<Record<string, string> | undefined>
): Record<string, string> {
  return Object.assign({}, ...sources);
}
