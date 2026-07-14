import type {
  InboxV2EmployeeReference,
  InboxV2WorkItem,
  InboxV2WorkItemState,
  InboxV2WorkItemWatcherTarget,
  InboxV2WorkQueueReference
} from "./index";

declare const newState: Extract<
  InboxV2WorkItem["operationalState"],
  { state: "new" }
>;
declare const terminalState: Extract<
  InboxV2WorkItem["operationalState"],
  { state: "resolved" }
>;

const _validState: InboxV2WorkItemState = "in_progress";
const _validQueue: InboxV2WorkQueueReference = newState.activeQueue.queue;

// @ts-expect-error Recovery is a derived overlay, not a seventh lifecycle state.
const _fabricatedRecoveryState: InboxV2WorkItemState =
  "responsibility_recovery_pending";

// @ts-expect-error New work has no primary Employee.
const _newPrimary: InboxV2EmployeeReference = newState.primaryAssignment;

// @ts-expect-error Terminal work has only a final Queue snapshot, not an active Queue.
const _terminalActiveQueue: InboxV2WorkQueueReference =
  terminalState.activeQueue;

// @ts-expect-error CRM identity is not embedded in the WorkItem aggregate.
type _ForbiddenClientId = InboxV2WorkItem["clientId"];

// @ts-expect-error Watcher target is notification routing, not a permission grant.
type _ForbiddenWatcherPermissions = InboxV2WorkItemWatcherTarget["permissions"];

void _validState;
void _validQueue;
