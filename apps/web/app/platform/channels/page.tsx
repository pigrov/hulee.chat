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
import { ImageUp, MessageCircle, Save, Settings2 } from "lucide-react";
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
  resolveChannelDescription,
  resolveChannelTitle
} from "../../../src/channel-display";
import { PlatformChannelProviderPolicy } from "../../../src/platform-admin-components";
import { PlatformAdminShell } from "../../../src/platform-admin-shell";
import {
  updatePlatformChannelCatalogOverrideAction,
  uploadPlatformChannelIconAction
} from "../../../src/platform-channel-catalog-actions";
import {
  loadPlatformChannelCatalog,
  type PlatformChannelCatalogView
} from "../../../src/platform-channel-catalog";
import { loadPlatformChannelProviderPolicies } from "../../../src/platform-channel-policies";
import {
  getWebDatabase,
  resolveCurrentWebAccessSession,
  resolveWebConfig
} from "../../../src/session";
import { buildActionStatusToast } from "../../../src/toast-messages";

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
    channelPolicy?: string;
    channelCatalog?: string;
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
  const channelCatalog = await loadPlatformChannelCatalog({
    repository: createSqlDeploymentChannelCatalogOverrideRepository(database)
  });
  const channelPolicies = await loadPlatformChannelProviderPolicies({
    config: resolveWebConfig(),
    repository: createSqlDeploymentChannelProviderPolicyRepository(database)
  });
  const resolvedSearchParams = await searchParams;
  const channelPolicyToast = resolvedSearchParams?.channelPolicy
    ? buildActionStatusToast({
        id: `channel-policy:${resolvedSearchParams.channelPolicy}`,
        status: resolvedSearchParams.channelPolicy,
        titleKey: "platform.channelProviderBehavior",
        descriptionKey:
          resolvedSearchParams.channelPolicy === "updated"
            ? "platform.channelPolicyStatus.updated"
            : "platform.channelPolicyStatus.invalid",
        t
      })
    : undefined;
  const channelCatalogToast = resolvedSearchParams?.channelCatalog
    ? buildActionStatusToast({
        id: `channel-catalog:${resolvedSearchParams.channelCatalog}`,
        status: resolvedSearchParams.channelCatalog,
        titleKey: "platform.channels.title",
        descriptionKey:
          resolvedSearchParams.channelCatalog === "updated"
            ? "platform.channels.status.updated"
            : "platform.channels.status.invalid",
        t
      })
    : undefined;
  const toasts = [channelPolicyToast, channelCatalogToast].filter(
    (toast) => toast !== undefined
  );

  return (
    <PlatformAdminShell
      access={access}
      current="channels"
      t={t}
      title={t("platform.channels.navTitle")}
      titleId="platform-channels-title"
      toasts={toasts}
    >
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
          <MessageCircle size={18} aria-hidden="true" />
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

      <section
        className="settingsPanel"
        aria-labelledby="platform-channel-catalog-title"
      >
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">{t("platform.channels.catalog")}</p>
            <h2 className="sectionTitle" id="platform-channel-catalog-title">
              {t("platform.channels.catalogTitle")}
            </h2>
            <p className="metaText">
              {t("platform.channels.catalogDescription")}
            </p>
          </div>
          <span className="badge">
            <Settings2 size={14} aria-hidden="true" />
            {channelCatalog.length}
          </span>
        </div>

        <div className="managementList">
          {channelCatalog.map((channel) => (
            <PlatformChannelCatalogRow
              key={channel.channelType}
              channel={channel}
              locale={locale}
              t={t}
            />
          ))}
        </div>
      </section>
    </PlatformAdminShell>
  );
}

function PlatformChannelCatalogRow({
  channel,
  locale,
  t
}: {
  channel: PlatformChannelCatalogView;
  locale: string;
  t: Translator;
}): ReactNode {
  const title = resolveChannelTitle({
    channel,
    locale,
    t,
    fallback: channel.channelType
  });
  const description = resolveChannelDescription({ channel, locale, t });

  return (
    <article className="managementRow channelCatalogRow">
      <div className="channelCatalogIdentity">
        <span className="metricIcon">
          <ChannelIcon channel={channel} />
        </span>
        <div>
          <h3 className="listItemTitle">{title}</h3>
          <p className="metaText">{description}</p>
          <div className="sourceList">
            <span className="badge">{channel.channelType}</span>
            <span className="badge">{channel.provider}</span>
            <span className="badge">
              {t(channelCatalogSourceKey(channel.source))}
            </span>
          </div>
        </div>
      </div>

      <form
        action={updatePlatformChannelCatalogOverrideAction}
        className="channelCatalogForm"
      >
        <input name="channelType" type="hidden" value={channel.channelType} />
        <label className="fieldStack">
          <span className="detailLabel">{t("platform.channels.titleRu")}</span>
          <input
            className="textInput"
            defaultValue={channel.titleOverrides.ru ?? ""}
            maxLength={120}
            name="titleRu"
            type="text"
          />
        </label>
        <label className="fieldStack">
          <span className="detailLabel">{t("platform.channels.titleEn")}</span>
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
        <button className="primaryButton" type="submit">
          <Save size={16} aria-hidden="true" />
          {t("common.save")}
        </button>
      </form>

      <form
        action={uploadPlatformChannelIconAction}
        className="channelCatalogIconForm"
        encType="multipart/form-data"
      >
        <input name="channelType" type="hidden" value={channel.channelType} />
        <DetailItem
          label={t("platform.channels.icon")}
          value={channel.iconAssetRef ?? t("platform.channels.defaultIcon")}
        />
        <label className="fieldStack">
          <span className="detailLabel">{t("platform.channels.iconFile")}</span>
          <input
            accept="image/png,image/jpeg,image/webp"
            className="textInput"
            name="iconFile"
            type="file"
            required
          />
          <span className="metaText">{t("platform.channels.iconHelp")}</span>
        </label>
        <button className="secondaryButton" type="submit">
          <ImageUp size={16} aria-hidden="true" />
          {t("platform.channels.uploadIcon")}
        </button>
      </form>
    </article>
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
