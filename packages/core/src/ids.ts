import type { EmployeeId, EventId, TenantId } from "@hulee/contracts";

export type IdFactory = {
  tenantId(): TenantId;
  employeeId(): EmployeeId;
  eventId(type: string): EventId;
  stringId(prefix: string): string;
};

export function createSequentialIdFactory(seed = "core"): IdFactory {
  const counters = new Map<string, number>();

  function next(prefix: string): string {
    const value = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, value);
    return `${prefix}_${seed}_${value}`;
  }

  return {
    tenantId: () => next("tenant") as TenantId,
    employeeId: () => next("employee") as EmployeeId,
    eventId: (type) => next(`event_${type.replaceAll(".", "_")}`) as EventId,
    stringId: (prefix) => next(prefix)
  };
}
