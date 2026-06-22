import {
  isApprovedUiSlot,
  type UiClientKind,
  type UiSlotContribution,
  type UiSlotId
} from "./slot-contracts";

export type SlotRegistry = ReadonlyMap<UiSlotId, readonly UiSlotContribution[]>;

export function createSlotRegistry(
  contributions: readonly UiSlotContribution[]
): SlotRegistry {
  const registry = new Map<UiSlotId, UiSlotContribution[]>();

  for (const contribution of contributions) {
    if (!isApprovedUiSlot(contribution.slot)) {
      throw new Error(`Unknown UI slot: ${contribution.slot}`);
    }

    const current = registry.get(contribution.slot) ?? [];
    current.push(contribution);
    current.sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
    registry.set(contribution.slot, current);
  }

  return registry;
}

export function getSlotContributions(input: {
  registry: SlotRegistry;
  slot: UiSlotId;
  client: UiClientKind;
}): readonly UiSlotContribution[] {
  return (input.registry.get(input.slot) ?? []).filter((contribution) => {
    return (
      !contribution.supportedClients ||
      contribution.supportedClients.includes(input.client)
    );
  });
}
