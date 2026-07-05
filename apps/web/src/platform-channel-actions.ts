"use server";

import {
  internalChannelTypeSchema,
  internalEgressProviderSchema,
  internalTelegramIntegrationModeSchema
} from "@hulee/contracts";
import {
  createSqlDeploymentChannelProviderPolicyRepository,
  createSqlPlatformAuditRepository,
  type DeploymentChannelProviderPolicyRecord
} from "@hulee/db";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

import { assertWebPlatformAdmin } from "./access";
import { assertWebActionRequest } from "./action-security";
import {
  platformActionError,
  platformActionSuccess,
  type PlatformActionState
} from "./platform-action-state";
import { buildChannelProviderPolicyPersistenceInput } from "./platform-channel-policies";
import { getWebDatabase, requireCurrentWebAccessSession } from "./session";

export async function updatePlatformChannelProviderPolicyAction(
  _previousState: PlatformActionState,
  formData: FormData
): Promise<PlatformActionState> {
  try {
    await assertWebActionRequest();
    const session = assertWebPlatformAdmin(
      await requireCurrentWebAccessSession()
    );
    const provider = internalEgressProviderSchema.parse(
      readRequiredFormString(formData, "provider")
    );
    const channelType = internalChannelTypeSchema.parse(
      readRequiredFormString(formData, "channelType")
    );
    const inboundMode = internalTelegramIntegrationModeSchema.parse(
      readRequiredFormString(formData, "inboundMode")
    );
    const outboundEnabled = readFormCheckbox(formData, "outboundEnabled");
    const database = getWebDatabase();
    const repository =
      createSqlDeploymentChannelProviderPolicyRepository(database);
    const previous = await repository.findPolicy({
      provider,
      channelType
    });
    const updatedAt = new Date();
    const next = buildChannelProviderPolicyPersistenceInput({
      provider,
      channelType,
      inboundMode,
      outboundEnabled,
      updatedAt,
      updatedByPlatformAdminAccountId: session.platformAdminAccountId
    });

    await repository.upsertPolicy(next);
    await createSqlPlatformAuditRepository(database).record({
      id: `platform-audit:channel-policy:${provider}:${channelType}:${randomUUID()}`,
      actorPlatformAdminAccountId: session.platformAdminAccountId,
      action: "platform.channel_provider_policy.updated",
      entityType: "deployment_channel_provider_policy",
      entityId: `${provider}:${channelType}`,
      metadata: {
        surface: "web",
        previous: serializePolicyForAudit(previous),
        next: serializePolicyForAudit(next)
      },
      occurredAt: updatedAt
    });

    revalidatePath("/platform/channels");

    return platformActionSuccess("channel_policy_updated");
  } catch {
    return platformActionError("channel_policy_invalid");
  }
}

function serializePolicyForAudit(
  policy: DeploymentChannelProviderPolicyRecord | null
): Record<string, unknown> | null {
  if (policy === null) {
    return null;
  }

  return {
    provider: policy.provider,
    channelType: policy.channelType,
    inboundMode: policy.inboundMode,
    outboundEnabled: policy.outboundEnabled,
    updatedAt: policy.updatedAt.toISOString(),
    updatedByPlatformAdminAccountId: policy.updatedByPlatformAdminAccountId
  };
}

function readRequiredFormString(formData: FormData, name: string): string {
  const value = formData.get(name);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Form field ${name} is required.`);
  }

  return value.trim();
}

function readFormCheckbox(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}
