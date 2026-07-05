import type {
  InternalChannelType,
  InternalEgressProfileStatus
} from "@hulee/contracts";
import type { createTranslator, I18nMessageKey } from "@hulee/i18n";
import type { HuleeDatabase } from "@hulee/db";
import { sql } from "drizzle-orm";
import { AlertTriangle, Building2 } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { resolveChannelTitle } from "./channel-display";
import type { PlatformChannelCatalogView } from "./platform-channel-catalog";
import type { PlatformChannelProviderPolicyView } from "./platform-channel-policies";
import {
  PlatformActionForm,
  PlatformActionSubmitButton,
  type PlatformActionMessages
} from "./platform-action-form";
import {
  platformEgressProviderRoutingModes,
  type PlatformEgressProviderPolicyView
} from "./platform-egress-policies";
import { egressProfileKindKey, egressStatusKey } from "./egress-formatting";
import { DetailItem } from "./app-chrome";
import { formatOptionalDateTime } from "./formatting";

type Translator = ReturnType<typeof createTranslator>["t"];

export type PlatformTenantSnapshot = {
  readonly tenantId: string;
  readonly slug: string;
  readonly displayName: string;
  readonly deploymentType: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type PlatformTenantRowRecord = {
  readonly tenant_id: string;
  readonly slug: string;
  readonly display_name: string;
  readonly deployment_type: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
};

export async function loadPlatformTenantSnapshots(
  database: HuleeDatabase
): Promise<PlatformTenantSnapshot[]> {
  const result = await database.execute<PlatformTenantRowRecord>(sql`
    select id as tenant_id,
           slug,
           display_name,
           deployment_type,
           created_at,
           updated_at
    from tenants
    order by created_at desc,
             display_name asc
    limit 50
  `);

  return result.rows.map((row) => ({
    tenantId: row.tenant_id,
    slug: row.slug,
    displayName: row.display_name,
    deploymentType: row.deployment_type,
    createdAt: dateLikeToIsoString(row.created_at),
    updatedAt: dateLikeToIsoString(row.updated_at)
  }));
}

export function PlatformTenantRow({
  href,
  locale,
  tenant,
  t
}: {
  href?: string;
  locale: string;
  tenant: PlatformTenantSnapshot;
  t: Translator;
}): ReactNode {
  const content = (
    <>
      <span className="metricIcon">
        <Building2 size={18} aria-hidden="true" />
      </span>
      <span>
        <span className="detailValue">{tenant.displayName}</span>
        <span className="metaText">{tenant.slug}</span>
      </span>
      <DetailItem
        label={t("platform.deploymentType")}
        value={formatDeploymentType(tenant.deploymentType, t)}
      />
      <DetailItem
        label={t("platform.tenantCreatedAt")}
        value={formatOptionalDateTime(tenant.createdAt, locale, t)}
      />
    </>
  );

  return href ? (
    <Link className="managementRow platformTenantRow" href={href}>
      {content}
    </Link>
  ) : (
    <article className="managementRow platformTenantRow">{content}</article>
  );
}

export function PlatformChannelProviderPolicy({
  channelCatalog,
  locale,
  policy,
  t
}: {
  channelCatalog: readonly PlatformChannelCatalogView[];
  locale: string;
  policy: PlatformChannelProviderPolicyView;
  t: Translator;
}): ReactNode {
  const channelTitle = formatChannelType({
    channelCatalog,
    channelType: policy.channelType,
    fallbackKey: policy.titleKey,
    locale,
    t
  });

  return (
    <PlatformActionForm
      actionKind="updateChannelProviderPolicy"
      className="managementRow channelProviderPolicyRow"
      messages={platformActionMessages(t)}
    >
      <input name="provider" type="hidden" value={policy.provider} />
      <input name="channelType" type="hidden" value={policy.channelType} />

      <div>
        <p className="detailValue">{channelTitle}</p>
        <p className="metaText">{policy.channelType}</p>
        <div className="sourceList">
          <span className="badge">
            {t(channelPolicySourceKey(policy.source))}
          </span>
        </div>
      </div>

      <label className="fieldStack">
        <span className="detailLabel">
          {t("platform.channelPolicy.inboundMode")}
        </span>
        <select
          className="selectInput"
          defaultValue={policy.inboundMode}
          name="inboundMode"
        >
          {policy.supportedInboundModes.map((mode) => (
            <option key={mode} value={mode}>
              {t(telegramModeKey(mode))}
            </option>
          ))}
        </select>
      </label>

      <label className="toggleRow">
        <input
          type="checkbox"
          name="outboundEnabled"
          defaultChecked={policy.outboundEnabled}
        />
        <span>{t("platform.channelPolicy.outboundEnabled")}</span>
      </label>

      <div className="egressProviderPolicyStatus">
        {policy.updatedAt ? (
          <DetailItem
            label={t("platform.channelPolicy.updatedAt")}
            value={formatOptionalDateTime(policy.updatedAt, locale, t)}
          />
        ) : (
          <DetailItem
            label={t("platform.channelPolicy.updatedAt")}
            value={t("common.unknown")}
          />
        )}
      </div>

      <PlatformActionSubmitButton
        className="primaryButton"
        label={t("common.save")}
      >
        {null}
      </PlatformActionSubmitButton>
    </PlatformActionForm>
  );
}

export function PlatformEgressProfile({
  locale,
  profile,
  t
}: {
  locale: string;
  profile: InternalEgressProfileStatus;
  t: Translator;
}): ReactNode {
  const failedProbeCount =
    profile.probes?.filter((probe) => probe.status === "failed").length ?? 0;

  return (
    <div className="diagnosticGrid">
      <DetailItem
        label={t("integrations.egress.profile")}
        value={profile.profileId}
      />
      <DetailItem
        label={t("integrations.egress.status")}
        value={t(egressStatusKey(profile.status))}
      />
      <DetailItem
        label={t("integrations.egress.profileKind")}
        value={t(egressProfileKindKey(profile.profileKind))}
      />
      <DetailItem
        label={t("integrations.egress.source")}
        value={t(egressSourceKey(profile.source))}
      />
      <DetailItem
        label={t("integrations.egress.checkedAt")}
        value={formatOptionalDateTime(profile.checkedAt, locale, t)}
      />
      <DetailItem
        label={t("integrations.egress.publicIp")}
        value={profile.publicIp ?? t("common.unknown")}
      />
      <DetailItem
        label={t("integrations.egress.consecutiveFailures")}
        value={String(profile.consecutiveFailures ?? 0)}
      />
      <DetailItem
        label={t("integrations.egress.failedProbes")}
        value={String(failedProbeCount)}
      />
      {profile.lastFailureAt ? (
        <DetailItem
          label={t("integrations.egress.lastFailureAt")}
          value={formatOptionalDateTime(profile.lastFailureAt, locale, t)}
        />
      ) : null}
      {profile.operatorHint ? (
        <DetailItem
          label={t("integrations.egress.operatorHint")}
          value={profile.operatorHint}
        />
      ) : null}
      {profile.alerts && profile.alerts.length > 0 ? (
        <div className="managementRow">
          <span className="detailValue">
            <AlertTriangle size={14} aria-hidden="true" />
            {t("integrations.egress.alerts")}
          </span>
          <span className="badge">
            {profile.alerts.map((alert) => alert.code).join(", ")}
          </span>
        </div>
      ) : null}
      {profile.probes && profile.probes.length > 0 ? (
        <div className="managementList">
          {profile.probes.map((probe) => (
            <ManagementRow
              key={`${probe.name}:${probe.target}`}
              label={probe.name}
              value={[
                t(egressProbeStatusKey(probe.status)),
                probe.latencyMs === undefined
                  ? undefined
                  : `${probe.latencyMs} ms`
              ]
                .filter(Boolean)
                .join(" / ")}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PlatformEgressProviderPolicy({
  channelCatalog,
  locale,
  policy,
  t
}: {
  channelCatalog: readonly PlatformChannelCatalogView[];
  locale: string;
  policy: PlatformEgressProviderPolicyView;
  t: Translator;
}): ReactNode {
  return (
    <PlatformActionForm
      actionKind="updateEgressProviderPolicy"
      className="managementRow egressProviderPolicyRow"
      messages={platformActionMessages(t)}
    >
      <input name="provider" type="hidden" value={policy.provider} />
      <div>
        <p className="detailValue">{t(policy.titleKey)}</p>
        <p className="metaText">
          {policy.supportedChannelTypes
            .map((channelType) =>
              formatChannelType({
                channelCatalog,
                channelType,
                fallbackKey: channelTypeKey(channelType),
                locale,
                t
              })
            )
            .join(", ")}
        </p>
        <div className="sourceList">
          <span className="badge">
            {t(egressPolicySourceKey(policy.source))}
          </span>
          <span className="badge">
            {t(egressPolicyApplyStateKey(policy.applyState))}
          </span>
          {policy.directRouteWarning ? (
            <span className="badge">
              <AlertTriangle size={14} aria-hidden="true" />
              {t("platform.egressPolicy.directWarning")}
            </span>
          ) : null}
        </div>
      </div>

      <label className="fieldStack">
        <span className="detailLabel">{t("platform.egressPolicy.route")}</span>
        <select
          className="selectInput"
          defaultValue={policy.routingMode}
          name="routingMode"
        >
          {platformEgressProviderRoutingModes.map((routingMode) => (
            <option key={routingMode} value={routingMode}>
              {t(egressProfileKindKey(routingMode))}
            </option>
          ))}
        </select>
      </label>

      <div className="egressProviderPolicyStatus">
        <DetailItem
          label={t("integrations.egress.profile")}
          value={policy.profileId}
        />
        <DetailItem
          label={t("integrations.egress.status")}
          value={
            policy.runtimeProfile
              ? t(egressStatusKey(policy.runtimeProfile.status))
              : t("common.unknown")
          }
        />
        <DetailItem
          label={t("integrations.egress.checkedAt")}
          value={formatOptionalDateTime(
            policy.runtimeProfile?.checkedAt,
            locale,
            t
          )}
        />
        {policy.updatedAt ? (
          <DetailItem
            label={t("platform.egressPolicy.updatedAt")}
            value={formatOptionalDateTime(policy.updatedAt, locale, t)}
          />
        ) : null}
      </div>

      <PlatformActionSubmitButton
        className="primaryButton"
        label={t("common.save")}
      >
        {null}
      </PlatformActionSubmitButton>
    </PlatformActionForm>
  );
}

export function ManagementRow({
  label,
  value
}: {
  label: string;
  value: string;
}): ReactNode {
  return (
    <div className="managementRow">
      <span className="detailValue">{label}</span>
      <span className="badge">{value}</span>
    </div>
  );
}

export function formatDeploymentType(
  deploymentType: string,
  t: Translator
): string {
  if (deploymentType === "saas_isolated") {
    return t("platform.deploymentType.saasIsolated");
  }

  if (deploymentType === "on_prem") {
    return t("platform.deploymentType.onPrem");
  }

  return t("platform.deploymentType.saasShared");
}

function dateLikeToIsoString(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function egressSourceKey(
  source: InternalEgressProfileStatus["source"]
): ReturnType<typeof egressStatusKey> {
  return `integrations.egress.source.${source}` as ReturnType<
    typeof egressStatusKey
  >;
}

function egressProbeStatusKey(
  status: NonNullable<InternalEgressProfileStatus["probes"]>[number]["status"]
): ReturnType<typeof egressStatusKey> {
  return `integrations.egress.probeStatus.${status}` as ReturnType<
    typeof egressStatusKey
  >;
}

function egressPolicySourceKey(
  source: PlatformEgressProviderPolicyView["source"]
): I18nMessageKey {
  return `platform.egressPolicy.source.${source}` as I18nMessageKey;
}

function egressPolicyApplyStateKey(
  state: PlatformEgressProviderPolicyView["applyState"]
): I18nMessageKey {
  return `platform.egressPolicy.applyState.${state}` as I18nMessageKey;
}

function channelPolicySourceKey(
  source: PlatformChannelProviderPolicyView["source"]
): I18nMessageKey {
  return `platform.channelPolicy.source.${source}` as I18nMessageKey;
}

function telegramModeKey(
  mode: PlatformChannelProviderPolicyView["inboundMode"]
): I18nMessageKey {
  return `integrations.telegram.mode.${mode}` as I18nMessageKey;
}

function channelTypeKey(
  channelType:
    | PlatformEgressProviderPolicyView["supportedChannelTypes"][number]
    | PlatformChannelProviderPolicyView["channelType"]
): I18nMessageKey {
  const keys = {
    telegram_bot: "integrations.catalog.telegramBot.title",
    telegram_qr_bridge: "integrations.catalog.telegramQr.title",
    whatsapp_qr_bridge: "integrations.catalog.whatsappQr.title",
    max_qr_bridge: "integrations.catalog.maxQr.title",
    max_bot: "integrations.catalog.maxBot.title",
    vk_community: "integrations.catalog.vkCommunity.title"
  } satisfies Record<InternalChannelType, I18nMessageKey>;

  return keys[channelType];
}

export function platformActionMessages(t: Translator): PlatformActionMessages {
  return {
    channel_catalog_invalid: t("platform.channels.status.invalid"),
    channel_catalog_updated: t("platform.channels.status.updated"),
    channel_policy_invalid: t("platform.channelPolicyStatus.invalid"),
    channel_policy_updated: t("platform.channelPolicyStatus.updated"),
    egress_policy_invalid: t("platform.egressPolicyStatus.invalid"),
    egress_policy_updated: t("platform.egressPolicyStatus.updated")
  };
}

function formatChannelType(input: {
  channelCatalog: readonly PlatformChannelCatalogView[];
  channelType: InternalChannelType;
  fallbackKey: I18nMessageKey;
  locale: string;
  t: Translator;
}): string {
  const channel = input.channelCatalog.find(
    (item) => item.channelType === input.channelType
  );

  return channel
    ? resolveChannelTitle({
        channel,
        locale: input.locale,
        t: input.t,
        fallback: input.t(input.fallbackKey)
      })
    : input.t(input.fallbackKey);
}
