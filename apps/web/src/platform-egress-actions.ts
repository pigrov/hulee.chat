"use server";

import {
  internalEgressProfileKindSchema,
  internalEgressProviderSchema
} from "@hulee/contracts";
import {
  createSqlDeploymentEgressProviderPolicyRepository,
  createSqlPlatformAuditRepository,
  type DeploymentEgressProviderPolicyRecord
} from "@hulee/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";

import { assertWebPlatformAdmin } from "./access";
import { assertWebActionRequest } from "./action-security";
import { buildProviderPolicyPersistenceInput } from "./platform-egress-policies";
import {
  getWebDatabase,
  requireCurrentWebAccessSession,
  resolveWebConfig
} from "./session";

export async function updatePlatformEgressProviderPolicyAction(
  formData: FormData
): Promise<void> {
  let destination = "/platform/providers?egressPolicy=invalid";

  try {
    await assertWebActionRequest();
    const session = assertWebPlatformAdmin(
      await requireCurrentWebAccessSession()
    );
    const provider = internalEgressProviderSchema.parse(
      readRequiredFormString(formData, "provider")
    );
    const routingMode = internalEgressProfileKindSchema.parse(
      readRequiredFormString(formData, "routingMode")
    );
    const database = getWebDatabase();
    const repository =
      createSqlDeploymentEgressProviderPolicyRepository(database);
    const previous = await repository.findPolicy(provider);
    const updatedAt = new Date();
    const next = buildProviderPolicyPersistenceInput({
      config: resolveWebConfig(),
      provider,
      routingMode,
      updatedAt,
      updatedByPlatformAdminAccountId: session.platformAdminAccountId
    });

    await repository.upsertPolicy(next);
    await createSqlPlatformAuditRepository(database).record({
      id: `platform-audit:egress-policy:${provider}:${randomUUID()}`,
      actorPlatformAdminAccountId: session.platformAdminAccountId,
      action: "platform.egress_provider_policy.updated",
      entityType: "deployment_egress_provider_policy",
      entityId: provider,
      metadata: {
        surface: "web",
        previous: serializePolicyForAudit(previous),
        next: serializePolicyForAudit(next),
        runtimeApplyRequired: true
      },
      occurredAt: updatedAt
    });

    destination = "/platform/providers?egressPolicy=updated";
  } catch {
    destination = "/platform/providers?egressPolicy=invalid";
  }

  revalidatePath("/platform/providers");
  redirect(destination);
}

function serializePolicyForAudit(
  policy: DeploymentEgressProviderPolicyRecord | null
): Record<string, unknown> | null {
  if (policy === null) {
    return null;
  }

  return {
    provider: policy.provider,
    routingMode: policy.routingMode,
    profileId: policy.profileId,
    required: policy.required,
    supportedChannelTypes: policy.supportedChannelTypes,
    allowedProfileKinds: policy.allowedProfileKinds,
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
