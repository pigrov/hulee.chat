import { defaultBrandProfile } from "@hulee/branding";
import type {
  InternalChannelReadiness,
  InternalChannelVisibility
} from "@hulee/contracts";
import { createSqlDeploymentChannelCatalogOverrideRepository } from "@hulee/db";
import { createTranslator } from "@hulee/i18n";
import type { I18nMessageKey } from "@hulee/i18n";
import { ArrowLeft, ImageUp, Save, Settings2 } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../src/access-denied";
import {
  canPlatformAdmin,
  navigationAccessFromSession
} from "../../../src/access";
import { AppFrame, DetailItem } from "../../../src/app-chrome";
import {
  ChannelIcon,
  resolveChannelDescription,
  resolveChannelTitle
} from "../../../src/channel-display";
import {
  updatePlatformChannelCatalogOverrideAction,
  uploadPlatformChannelIconAction
} from "../../../src/platform-channel-catalog-actions";
import {
  loadPlatformChannelCatalog,
  type PlatformChannelCatalogView
} from "../../../src/platform-channel-catalog";
import {
  getWebDatabase,
  resolveCurrentWebAccessSession
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
  const catalog = await loadPlatformChannelCatalog({
    repository: createSqlDeploymentChannelCatalogOverrideRepository(database)
  });
  const resolvedSearchParams = await searchParams;

  return (
    <AppFrame
      brand={defaultBrandProfile}
      current="platform-admin"
      frameClassName="adminFrame"
      navigationAccess={navigationAccessFromSession(access)}
      t={t}
    >
      <section
        className="adminWorkspace"
        aria-labelledby="platform-channels-title"
      >
        <header className="adminHeader">
          <div>
            <p className="eyebrow">{t("platform.controlPlane")}</p>
            <h1 className="adminTitle" id="platform-channels-title">
              {t("platform.channels.title")}
            </h1>
          </div>
          <Link className="secondaryButton" href="/platform">
            <ArrowLeft size={16} aria-hidden="true" />
            {t("platform.channels.backToPlatform")}
          </Link>
        </header>

        <div className="adminContent">
          {resolvedSearchParams?.channelCatalog ? (
            <p
              className={
                resolvedSearchParams.channelCatalog === "updated"
                  ? "formNotice"
                  : "formError"
              }
            >
              {resolvedSearchParams.channelCatalog === "updated"
                ? t("platform.channels.status.updated")
                : t("platform.channels.status.invalid")}
            </p>
          ) : null}

          <section
            className="settingsPanel"
            aria-labelledby="platform-channel-catalog-title"
          >
            <div className="sectionHeader">
              <div>
                <p className="eyebrow">{t("platform.channels.catalog")}</p>
                <h2
                  className="sectionTitle"
                  id="platform-channel-catalog-title"
                >
                  {t("platform.channels.catalogTitle")}
                </h2>
                <p className="metaText">
                  {t("platform.channels.catalogDescription")}
                </p>
              </div>
              <span className="badge">
                <Settings2 size={14} aria-hidden="true" />
                {catalog.length}
              </span>
            </div>

            <div className="managementList">
              {catalog.map((channel) => (
                <PlatformChannelCatalogRow
                  key={channel.channelType}
                  channel={channel}
                  locale={locale}
                  t={t}
                />
              ))}
            </div>
          </section>
        </div>
      </section>
    </AppFrame>
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
            maxLength={500}
            name="descriptionRu"
          />
        </label>
        <label className="fieldStack">
          <span className="detailLabel">
            {t("platform.channels.descriptionEn")}
          </span>
          <textarea
            className="textInput channelCatalogDescriptionInput"
            defaultValue={channel.descriptionOverrides.en ?? ""}
            maxLength={500}
            name="descriptionEn"
          />
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
