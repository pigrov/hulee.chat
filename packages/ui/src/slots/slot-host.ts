import { getSlotContributions, type SlotRegistry } from "./slot-registry";
import type {
  UiClientKind,
  UiSlotContribution,
  UiSlotId
} from "./slot-contracts";

export type SlotHostInput = {
  registry: SlotRegistry;
  slot: UiSlotId;
  client: UiClientKind;
};

export function resolveSlotHost(
  input: SlotHostInput
): readonly UiSlotContribution[] {
  return getSlotContributions(input);
}
