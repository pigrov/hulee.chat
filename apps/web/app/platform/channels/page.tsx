import type {
  InternalChannelReadiness,
  InternalChannelVisibility
} from "@hulee/contracts";
import {
  createSqlDeploymentChannelCatalogOverrideRepository,
  createSqlDeploymentChannelProviderPolicyRepository
} from "@hulee/db";
import { createTranslator } from "@hulee/i18n";
import type { I18nMessageKey } from "@hulee/i18n";
import { ImageUp, Save } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../src/access-denied";
import {
  canPlatformAdmin,
  navigationAccessFromSession
} from "../../../src/access";
import { DetailItem } from "../../../src/app-chrome";
import {
  ChannelIcon,
  resolveChannelShortDescription,
  resolveChannelTitle
} from "../../../src/channel-display";
import {
  PlatformChannelProviderPolicy,
  platformActionMessages
} from "../../../src/platform-admin-components";
import { PlatformAdminShell } from "../../../src/platform-admin-shell";
import {
  PlatformActionForm,
  PlatformActionSubmitButton
} from "../../../src/platform-action-form";
import {
  loadPlatformChannelCatalog,
  type PlatformChannelCatalogView
} from "../../../src/platform-channel-catalog";
import {
  loadPlatformChannelProviderPolicies,
  type PlatformChannelProviderPolicyView
} from "../../../src/platform-channel-policies";
import {
  getWebDatabase,
  resolveCurrentWebAccessSession,
  resolveWebConfig
} from "../../../src/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const channelVisibilities = [
  "visible",
  "hidden"
] as const satisfies readonly InternalChannelVisibility[];
const channelReadinesses = [
  "available",
  "coming_soon",
  "disabled"
] as const satisfies readonly InternalChannelReadiness[];

type Translator = ReturnType<typeof createTranslator>["t"];

export default async function PlatformChannelsPage({
  searchParams
}: {
  searchParams?: Promise<{
    channelType?: string;
  }>;
}): Promise<ReactNode> {
  const access = await resolveCurrentWebAccessSession();

  if (access === null) {
    redirect("/login");
  }

  if (!canPlatformAdmin(access)) {
    return (
      <AccessDeniedPage
        current="platform-admin"
        navigationAccess={navigationAccessFromSession(access)}
      />
    );
  }

  const { t, locale } = createTranslator("ru");
  const database = getWebDatabase();
  const [channelCatalog, channelPolicies] = await Promise.all([
    loadPlatformChannelCatalog({
      repository: createSqlDeploymentChannelCatalogOverrideRepository(database)
    }),
    loadPlatformChannelProviderPolicies({
      config: resolveWebConfig(),
      repository: createSqlDeploymentChannelProviderPolicyRepository(database)
    })
  ]);
  const resolvedSearchParams = await searchParams;
  const requestedChannelType = normalizeOptionalSearchParam(
    resolvedSearchParams?.channelType
  );
  const selectedChannel =
    selectPlatformChannel(channelCatalog, requestedChannelType) ??
    channelCatalog[0];
  const selectedChannelPolicies = selectedChannel
    ? channelPolicies.filter(
        (policy) => policy.channelType === selectedChannel.channelType
      )
    : [];

  return (
    <PlatformAdminShell
      access={access}
      current="channels"
      t={t}
      title={t("platform.channels.navTitle")}
      titleId="platform-channels-title"
    >
      <div className="adminIntegrationGrid">
        <aside
          className="settingsPanel integrationCatalog"
          aria-labelledby="platform-channel-list-title"
        >
          <div className="sectionHeader">
            <div>
              <h2 className="sectionTitle" id="platform-channel-list-title">
                {t("platform.channels.catalogTitle")}
              </h2>
            </div>
          </div>

          <nav
            className="integrationList"
            aria-label={t("platform.channels.catalogTitle")}
          >
            {channelCatalog.map((channel) => (
              <PlatformChannelListItem
                key={channel.channelType}
                channel={channel}
                current={channel.channelType === selectedChannel?.channelType}
                locale={locale}
                t={t}
              />
            ))}
          </nav>
        </aside>

        <div className="adminStack adminSectionContent">
          {selectedChannel ? (
            <PlatformChannelSettings
              channel={selectedChannel}
              channelCatalog={channelCatalog}
              channelPolicies={selectedChannelPolicies}
              locale={locale}
              t={t}
            />
          ) : null}
        </div>
      </div>
    </PlatformAdminShell>
  );
}

function PlatformChannelListItem({
  channel,
  current,
  locale,
  t
}: {
  channel: PlatformChannelCatalogView;
  current: boolean;
  locale: string;
  t: Translator;
}): ReactNode {
  const title = resolveChannelTitle({
    channel,
    locale,
    t,
    fallback: channel.channelType
  });
  const shortDescription = resolveChannelShortDescription({
    channel,
    locale,
    t
  });

  return (
    <Link
      className="integrationListItem integrationNavLink"
      href={`/platform/channels?channelType=${encodeURIComponent(
        channel.channelType
      )}`}
      aria-current={current ? "page" : undefined}
    >
      <span className="metricIcon">
        <ChannelIcon channel={channel} size="large" />
      </span>
      <div className="integrationListText">
        <h3 className="listItemTitle" title={title}>
          {title}
        </h3>
        <p className="metaText integrationListType" title={shortDescription}>
          {shortDescription}
        </p>
      </div>
      <span className="integrationListBadges">
        <span
          className="channelStatusBadge"
          data-state={channelReadinessBadgeState(channel.readiness)}
        >
          {t(channelReadinessKey(channel.readiness))}
        </span>
      </span>
    </Link>
  );
}

function PlatformChannelSettings({
  channel,
  channelCatalog,
  channelPolicies,
  locale,
  t
}: {
  channel: PlatformChannelCatalogView;
  channelCatalog: readonly PlatformChannelCatalogView[];
  channelPolicies: readonly PlatformChannelProviderPolicyView[];
  locale: string;
  t: Translator;
}): ReactNode {
  const title = resolveChannelTitle({
    channel,
    locale,
    t,
    fallback: channel.channelType
  });
  const shortDescription = resolveChannelShortDescription({
    channel,
    locale,
    t
  });

  return (
    <>
      <section
        className="settingsPanel"
        aria-labelledby="platform-channel-settings-title"
      >
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">{t("platform.channels.catalog")}</p>
            <h2 className="sectionTitle" id="platform-channel-settings-title">
              {title}
            </h2>
            <p className="metaText">{shortDescription}</p>
          </div>
          <span className="badge">
            <ChannelIcon channel={channel} />
            {channel.channelType}
          </span>
        </div>

        <div className="sourceList">
          <span className="badge">{channel.provider}</span>
          <span className="badge">
            {t(channelCatalogSourceKey(channel.source))}
          </span>
          <span className="badge">
            {t(channelReadinessKey(channel.readiness))}
          </span>
        </div>

        <PlatformActionForm
          actionKind="updateChannelCatalog"
          className="channelCatalogSettingsForm"
          messages={platformActionMessages(t)}
        >
          <input name="channelType" type="hidden" value={channel.channelType} />
          <label className="fieldStack channelCatalogDescriptionField">
            <span className="detailLabel">
              {t("platform.channels.titleRu")}
            </span>
            <input
              className="textInput"
              defaultValue={channel.titleOverrides.ru ?? ""}
              maxLength={120}
              name="titleRu"
              type="text"
            />
          </label>
          <label className="fieldStack channelCatalogDescriptionField">
            <span className="detailLabel">
              {t("platform.channels.titleEn")}
            </span>
            <input
              className="textInput"
              defaultValue={channel.titleOverrides.en ?? ""}
              maxLength={120}
              name="titleEn"
              type="text"
            />
          </label>
          <label className="fieldStack">
            <span className="detailLabel">
              {t("platform.channels.shortDescriptionRu")}
            </span>
            <input
              className="textInput"
              defaultValue={channel.shortDescriptionOverrides.ru ?? ""}
              maxLength={240}
              name="shortDescriptionRu"
              type="text"
            />
            <span className="metaText">
              {t("platform.channels.shortDescriptionHelp")}
            </span>
          </label>
          <label className="fieldStack">
            <span className="detailLabel">
              {t("platform.channels.shortDescriptionEn")}
            </span>
            <input
              className="textInput"
              defaultValue={channel.shortDescriptionOverrides.en ?? ""}
              maxLength={240}
              name="shortDescriptionEn"
              type="text"
            />
            <span className="metaText">
              {t("platform.channels.shortDescriptionHelp")}
            </span>
          </label>
          <label className="fieldStack">
            <span className="detailLabel">
              {t("platform.channels.descriptionRu")}
            </span>
            <textarea
              className="textInput channelCatalogDescriptionInput"
              defaultValue={channel.descriptionOverrides.ru ?? ""}
              maxLength={4000}
              name="descriptionRu"
            />
            <span className="metaText">
              {t("platform.channels.descriptionMarkdownHelp")}
            </span>
          </label>
          <label className="fieldStack">
            <span className="detailLabel">
              {t("platform.channels.descriptionEn")}
            </span>
            <textarea
              className="textInput channelCatalogDescriptionInput"
              defaultValue={channel.descriptionOverrides.en ?? ""}
              maxLength={4000}
              name="descriptionEn"
            />
            <span className="metaText">
              {t("platform.channels.descriptionMarkdownHelp")}
            </span>
          </label>
          <label className="fieldStack">
            <span className="detailLabel">
              {t("platform.channels.sortOrder")}
            </span>
            <input
              className="textInput"
              defaultValue={channel.sortOrder}
              max={10000}
              min={-10000}
              name="sortOrder"
              type="number"
            />
          </label>
          <label className="fieldStack">
            <span className="detailLabel">
              {t("platform.channels.visibility")}
            </span>
            <select
              className="selectInput"
              defaultValue={channel.visibility}
              name="visibility"
            >
              {channelVisibilities.map((visibility) => (
                <option key={visibility} value={visibility}>
                  {t(channelVisibilityKey(visibility))}
                </option>
              ))}
            </select>
          </label>
          <label className="fieldStack">
            <span className="detailLabel">
              {t("platform.channels.readiness")}
            </span>
            <select
              className="selectInput"
              defaultValue={channel.readiness}
              name="readiness"
            >
              {channelReadinesses.map((readiness) => (
                <option key={readiness} value={readiness}>
                  {t(channelReadinessKey(readiness))}
                </option>
              ))}
            </select>
          </label>
          <PlatformActionSubmitButton
            className="primaryButton"
            label={t("common.save")}
          >
            <Save size={16} aria-hidden="true" />
          </PlatformActionSubmitButton>
        </PlatformActionForm>

        <PlatformActionForm
          actionKind="uploadChannelIcon"
          className="channelCatalogIconForm"
          messages={platformActionMessages(t)}
          resetOnSuccess
        >
          <input name="channelType" type="hidden" value={channel.channelType} />
          <DetailItem
            label={t("platform.channels.icon")}
            value={channel.iconAssetRef ?? t("platform.channels.defaultIcon")}
          />
          <label className="fieldStack">
            <span className="detailLabel">
              {t("platform.channels.iconFile")}
            </span>
            <input
              accept="image/png,image/jpeg,image/webp"
              className="textInput"
              name="iconFile"
              type="file"
              required
            />
            <span className="metaText">{t("platform.channels.iconHelp")}</span>
          </label>
          <PlatformActionSubmitButton
            className="secondaryButton"
            label={t("platform.channels.uploadIcon")}
          >
            <ImageUp size={16} aria-hidden="true" />
          </PlatformActionSubmitButton>
        </PlatformActionForm>
      </section>

      {channelPolicies.length > 0 ? (
        <section
          className="settingsPanel"
          aria-labelledby="channel-provider-policy-title"
        >
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("platform.dataPlane")}</p>
              <h2 className="sectionTitle" id="channel-provider-policy-title">
                {t("platform.channelProviderBehavior")}
              </h2>
              <p className="metaText">
                {t("platform.channelProviderBehaviorDescription")}
              </p>
            </div>
          </div>
          <div className="managementList">
            {channelPolicies.map((policy) => (
              <PlatformChannelProviderPolicy
                key={`${policy.provider}:${policy.channelType}`}
                channelCatalog={channelCatalog}
                locale={locale}
                policy={policy}
                t={t}
              />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function normalizeOptionalSearchParam(
  value: string | undefined
): string | undefined {
  const normalized = value?.trim();

  return normalized && normalized.length > 0 ? normalized : undefined;
}

function selectPlatformChannel(
  channels: readonly PlatformChannelCatalogView[],
  requestedChannelType: string | undefined
): PlatformChannelCatalogView | undefined {
  if (!requestedChannelType) {
    return undefined;
  }

  return channels.find(
    (channel) => channel.channelType === requestedChannelType
  );
}

function channelCatalogSourceKey(
  source: PlatformChannelCatalogView["source"]
): I18nMessageKey {
  return `platform.channels.source.${source}` as I18nMessageKey;
}

function channelVisibilityKey(
  visibility: InternalChannelVisibility
): I18nMessageKey {
  return `platform.channels.visibility.${visibility}` as I18nMessageKey;
}

function channelReadinessKey(
  readiness: InternalChannelReadiness
): I18nMessageKey {
  return `integrations.channel.readiness.${readiness}` as I18nMessageKey;
}

function channelReadinessBadgeState(
  readiness: InternalChannelReadiness
): "ok" | "disabled" | "new" {
  if (readiness === "available") {
    return "ok";
  }

  if (readiness === "disabled") {
    return "disabled";
  }

  return "new";
}
