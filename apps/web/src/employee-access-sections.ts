export const employeeAccessSectionIds = [
  "profile",
  "memberships",
  "roles",
  "direct_grants",
  "effective_access"
] as const;

export type EmployeeAccessSectionId = (typeof employeeAccessSectionIds)[number];

export function isEmployeeAccessSectionId(
  value: string
): value is EmployeeAccessSectionId {
  return employeeAccessSectionIds.includes(value as EmployeeAccessSectionId);
}
