import type {
  ClientId,
  ConversationId,
  EmployeeId,
  EventId,
  MessageId,
  TenantId
} from "@hulee/contracts";

export type IdFactory = {
  tenantId(): TenantId;
  employeeId(): EmployeeId;
  clientId(): ClientId;
  conversationId(): ConversationId;
  messageId(): MessageId;
  eventId(type: string): EventId;
  stringId(prefix: string): string;
};

export function createSequentialIdFactory(seed = "mvp"): IdFactory {
  const counters = new Map<string, number>();

  function next(prefix: string): string {
    const value = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, value);
    return `${prefix}_${seed}_${value}`;
  }

  return {
    tenantId: () => next("tenant") as TenantId,
    employeeId: () => next("employee") as EmployeeId,
    clientId: () => next("client") as ClientId,
    conversationId: () => next("conversation") as ConversationId,
    messageId: () => next("message") as MessageId,
    eventId: (type) => next(`event_${type.replaceAll(".", "_")}`) as EventId,
    stringId: (prefix) => next(prefix)
  };
}
