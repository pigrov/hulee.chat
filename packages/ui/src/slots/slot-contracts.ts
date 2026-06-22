export type UiSlotId =
  | "tenant.settings.section"
  | "integration.settings.section"
  | "client.profile.card"
  | "conversation.composer.tool"
  | "conversation.message.action"
  | "inbox.sidebar.section"
  | "admin.section"
  | "reports.section"
  | "support.case.panel";

export type UiClientKind = "web" | "mobile" | "desktop";

export type UiSlotContribution = {
  id: string;
  slot: UiSlotId;
  componentRef: string;
  titleKey?: string;
  requiredPermissions?: string[];
  supportedClients?: UiClientKind[];
  order?: number;
};

export const approvedUiSlots: readonly UiSlotId[] = [
  "tenant.settings.section",
  "integration.settings.section",
  "client.profile.card",
  "conversation.composer.tool",
  "conversation.message.action",
  "inbox.sidebar.section",
  "admin.section",
  "reports.section",
  "support.case.panel"
];

export function isApprovedUiSlot(slot: string): slot is UiSlotId {
  return approvedUiSlots.includes(slot as UiSlotId);
}
