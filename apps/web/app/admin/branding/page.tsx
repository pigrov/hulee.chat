import {
  brandThemeColorPresets,
  resolveBrandThemeColorPresetId,
  resolveBrandThemeMode,
  resolveBrandThemePreset,
  resolveBrandThemePresetForMode,
  type BrandThemeColorPresetId,
  type BrandThemeTokenName,
  type BrandThemeTokens
} from "@hulee/branding";
import {
  createSqlEmployeeDirectoryRepository,
  createSqlTenantRbacRepository
} from "@hulee/db";
import { createTranslator, type I18nMessageKey } from "@hulee/i18n";
import { Paintbrush, Save, SlidersHorizontal } from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../src/access-denied";
import {
  AdminSectionFrame,
  type AdminSectionFrameItem
} from "../../../src/admin-section-frame";
import { SlotMount } from "../../../src/app-chrome";
import {
  applyBrandPresetAction,
  updateTenantBrandAction
} from "../../../src/actions";
import { loadTenantAdminViewModel } from "../../../src/admin-view-model";
import {
  buildBrandMarkLabel,
  brandProfileToCssProperties
} from "../../../src/brand-style";
import { BrandThemeModeSelector } from "../../../src/brand-theme-mode-selector";
import {
  getWebDatabase,
  resolveCurrentWebAccessSession
} from "../../../src/session";
import {
  hasEffectivePermission,
  resolveEmployeeEffectiveAccess
} from "../../../src/rbac-effective-access";
import { TenantAdminShell } from "../../../src/tenant-admin-shell";
import { navigationAccessFromTenantAdminAccess } from "../../../src/tenant-admin-nav";
import { buildActionStatusToast } from "../../../src/toast-messages";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BrandProfileView = {
  productName: string;
  shortProductName?: string;
  themeTokens: Record<string, string>;
};

const brandingAdminSectionIds = ["presets", "settings"] as const;

type BrandingAdminSectionId = (typeof brandingAdminSectionIds)[number];

const fallbackPreset = resolveBrandThemePreset("hulee");

export default async function BrandingAdminPage({
  searchParams
}: {
  searchParams?: Promise<{ brandStatus?: string; section?: string }>;
}): Promise<ReactNode> {
  const access = await resolveCurrentWebAccessSession();

  if (access === null) {
    redirect("/login");
  }

  const database = getWebDatabase();
  const employeeRepository = createSqlEmployeeDirectoryRepository(database);
  const rbacRepository = createSqlTenantRbacRepository(database);
  const accessSnapshot = await resolveEmployeeEffectiveAccess({
    tenantId: access.tenantId,
    employeeId: access.employeeId,
    employeeRepository,
    rbacRepository
  });

  if (!hasEffectivePermission(accessSnapshot, "tenant.manage")) {
    const adminAccess = {
      session: access,
      effectiveAccess: accessSnapshot
    };

    return (
      <AccessDeniedPage
        current="tenant-admin"
        navigationAccess={navigationAccessFromTenantAdminAccess(adminAccess)}
      />
    );
  }

  const [model, resolvedSearchParams] = await Promise.all([
    loadTenantAdminViewModel({ tenantId: access.tenantId, database }),
    searchParams
  ]);
  const { t } = createTranslator(model.tenant.locale);
  const brand = model.tenant.brand;
  const currentTokens = resolveCurrentTokens(brand.themeTokens);
  const currentColorPresetId =
    resolveBrandThemeColorPresetId(currentTokens) ?? "hulee";
  const currentThemeMode = resolveBrandThemeMode(currentTokens);
  const currentLogoUrl =
    brand.assets?.mark ?? brand.assets?.logoLight ?? brand.assets?.logoDark;
  const previewBrand: BrandProfileView = {
    productName: brand.productName,
    shortProductName: brand.shortProductName,
    themeTokens: currentTokens
  };
  const statusKey = brandStatusKey(resolvedSearchParams?.brandStatus);
  const selectedSection = resolveBrandingAdminSection(
    resolvedSearchParams?.section
  );
  const brandStatusToast =
    resolvedSearchParams?.brandStatus && statusKey
      ? buildActionStatusToast({
          id: `brand-status:${resolvedSearchParams.brandStatus}`,
          status: resolvedSearchParams.brandStatus,
          titleKey: "admin.branding.status",
          descriptionKey: statusKey,
          t
        })
      : undefined;
  const brandingAdminSections: readonly AdminSectionFrameItem<BrandingAdminSectionId>[] =
    [
      {
        id: "presets",
        title: t("admin.branding.themePreset"),
        href: brandingAdminSectionHref("presets"),
        icon: <Paintbrush size={18} aria-hidden="true" />
      },
      {
        id: "settings",
        title: t("admin.branding.productAndColors"),
        href: brandingAdminSectionHref("settings"),
        icon: <SlidersHorizontal size={18} aria-hidden="true" />
      }
    ];

  return (
    <TenantAdminShell
      access={access}
      brand={model.tenant.brand}
      current="branding"
      effectiveAccess={accessSnapshot}
      sidebarContent={<SlotMount slot="tenant.settings.section" />}
      t={t}
      tenantDisplayName={model.tenant.displayName}
      title={t("admin.branding")}
      titleId="branding-title"
      toasts={brandStatusToast ? [brandStatusToast] : []}
    >
      <AdminSectionFrame
        ariaLabel={t("admin.branding")}
        navTitle={t("admin.branding")}
        sections={brandingAdminSections}
        selectedSection={selectedSection}
      >
        <section
          className="settingsPanel"
          aria-labelledby="brand-preset-title"
          hidden={selectedSection !== "presets"}
        >
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.branding.presets")}</p>
              <h2 className="sectionTitle" id="brand-preset-title">
                {t("admin.branding.themePreset")}
              </h2>
            </div>
            <span className="badge">
              <Paintbrush size={14} aria-hidden="true" />
              {brandThemeColorPresets.length}
            </span>
          </div>

          <form action={applyBrandPresetAction} className="brandThemeModeForm">
            <input name="section" type="hidden" value="presets" />
            <input name="productName" type="hidden" value={brand.productName} />
            <input
              name="shortProductName"
              type="hidden"
              value={brand.shortProductName ?? ""}
            />
            <input name="presetId" type="hidden" value={currentColorPresetId} />
            <BrandThemeModeSelector
              currentThemeMode={currentThemeMode}
              darkLabel={t("admin.branding.mode.dark")}
              label={t("admin.branding.mode")}
              lightLabel={t("admin.branding.mode.light")}
            />
          </form>

          <div className="brandPresetGrid">
            {brandThemeColorPresets.map((preset) => (
              <form action={applyBrandPresetAction} key={preset.id}>
                <input name="section" type="hidden" value="presets" />
                <input
                  name="themeMode"
                  type="hidden"
                  value={currentThemeMode}
                />
                <input
                  name="productName"
                  type="hidden"
                  value={brand.productName}
                />
                <input
                  name="shortProductName"
                  type="hidden"
                  value={brand.shortProductName ?? ""}
                />
                <button
                  className="brandPresetButton"
                  name="presetId"
                  type="submit"
                  value={preset.id}
                  aria-current={
                    currentColorPresetId === preset.id ? "page" : undefined
                  }
                  style={brandProfileToCssProperties({
                    productName: preset.id,
                    themeTokens: resolveBrandThemePresetForMode(
                      preset.id,
                      currentThemeMode
                    ).tokens
                  })}
                >
                  <span className="brandPresetSwatches" aria-hidden="true">
                    <span className="brandPresetSwatch brandPresetSwatchPrimary" />
                    <span className="brandPresetSwatch brandPresetSwatchAccent" />
                    <span className="brandPresetSwatch brandPresetSwatchSurface" />
                  </span>
                  <span className="listItemTitle">
                    {t(presetLabelKey(preset.id))}
                  </span>
                </button>
              </form>
            ))}
          </div>
        </section>

        <section
          className="settingsPanel"
          aria-labelledby="brand-settings-title"
          hidden={selectedSection !== "settings"}
        >
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.branding.custom")}</p>
              <h2 className="sectionTitle" id="brand-settings-title">
                {t("admin.branding.productAndColors")}
              </h2>
            </div>
            <span className="badge">
              <SlidersHorizontal size={14} aria-hidden="true" />
              {t("admin.branding.tokens")}
            </span>
          </div>

          <form action={updateTenantBrandAction} className="settingsForm">
            <input name="section" type="hidden" value="settings" />
            <input name="themeMode" type="hidden" value={currentThemeMode} />
            <input name="presetId" type="hidden" value={currentColorPresetId} />
            <label className="fieldStack">
              <span className="detailLabel">
                {t("admin.branding.productName")}
              </span>
              <input
                className="textInput"
                name="productName"
                type="text"
                defaultValue={brand.productName}
                required
              />
            </label>
            <label className="fieldStack">
              <span className="detailLabel">
                {t("admin.branding.shortProductName")}
              </span>
              <input
                className="textInput"
                name="shortProductName"
                type="text"
                defaultValue={brand.shortProductName ?? ""}
              />
            </label>
            <div className="brandLogoUploadGrid">
              <div
                className="brandLogoPreviewSurface"
                aria-label={t("admin.branding.logoCurrent")}
              >
                {currentLogoUrl ? (
                  <img
                    className="brandLogoPreviewImage"
                    src={currentLogoUrl}
                    alt=""
                  />
                ) : (
                  <div className="brandMark" aria-hidden="true">
                    {buildBrandMarkLabel(previewBrand)}
                  </div>
                )}
              </div>
              <label className="fieldStack">
                <span className="detailLabel">{t("admin.branding.logo")}</span>
                <input
                  className="fileInput"
                  name="brandLogoFile"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                />
                <span className="metaText">
                  {t("admin.branding.logoRecommendation")}
                </span>
              </label>
            </div>
            <div className="brandColorGrid">
              <label className="fieldStack">
                <span className="detailLabel">
                  {t("admin.branding.primaryColor")}
                </span>
                <input
                  className="colorInput"
                  name="primaryColor"
                  type="color"
                  defaultValue={tokenValue(
                    currentTokens,
                    "color.brand.primary"
                  )}
                />
              </label>
              <label className="fieldStack">
                <span className="detailLabel">
                  {t("admin.branding.accentColor")}
                </span>
                <input
                  className="colorInput"
                  name="accentColor"
                  type="color"
                  defaultValue={tokenValue(currentTokens, "color.accent")}
                />
              </label>
            </div>
            <button className="primaryButton" type="submit">
              <Save size={18} aria-hidden="true" />
              {t("common.save")}
            </button>
          </form>

          <div
            className="brandPreviewPanel"
            aria-labelledby="brand-preview-title"
            style={brandProfileToCssProperties(previewBrand)}
          >
            <div className="sectionHeader">
              <div>
                <p className="eyebrow">{t("admin.branding.preview")}</p>
                <h2 className="sectionTitle" id="brand-preview-title">
                  {brand.productName}
                </h2>
              </div>
              <div className="brandMark" aria-label={brand.productName}>
                {buildBrandMarkLabel(previewBrand)}
              </div>
            </div>

            <div className="brandPreviewSurface">
              <div>
                <p className="eyebrow">{t("inbox.queue")}</p>
                <h3 className="listItemTitle">{t("inbox.conversation")}</h3>
                <p className="metaText">{t("message.status.queued")}</p>
              </div>
              <button className="primaryButton" type="button">
                {t("inbox.replySubmit")}
              </button>
            </div>
          </div>
        </section>
      </AdminSectionFrame>
    </TenantAdminShell>
  );
}

function brandingAdminSectionHref(section: BrandingAdminSectionId): string {
  return `/admin/branding?section=${encodeURIComponent(section)}`;
}

function resolveBrandingAdminSection(
  value: string | undefined
): BrandingAdminSectionId {
  return isBrandingAdminSectionId(value) ? value : "presets";
}

function isBrandingAdminSectionId(
  value: string | undefined
): value is BrandingAdminSectionId {
  return brandingAdminSectionIds.some((section) => section === value);
}

function resolveCurrentTokens(
  tokens: Record<string, string>
): BrandThemeTokens {
  return Object.keys(tokens).length === 0
    ? fallbackPreset.tokens
    : {
        ...fallbackPreset.tokens,
        ...tokens
      };
}

function tokenValue(
  tokens: BrandThemeTokens,
  tokenName: BrandThemeTokenName
): string {
  return tokens[tokenName] ?? fallbackPreset.tokens[tokenName] ?? "#000000";
}

function brandStatusKey(
  status: string | undefined
): I18nMessageKey | undefined {
  switch (status) {
    case "saved":
      return "admin.branding.saved";
    case "invalid":
      return "admin.branding.invalid";
    default:
      return undefined;
  }
}

function presetLabelKey(presetId: BrandThemeColorPresetId): I18nMessageKey {
  switch (presetId) {
    case "neutral":
      return "admin.branding.preset.neutral";
    case "blue":
      return "admin.branding.preset.blue";
    case "green":
      return "admin.branding.preset.green";
    case "red":
      return "admin.branding.preset.red";
    case "orange":
      return "admin.branding.preset.orange";
    case "amber":
      return "admin.branding.preset.amber";
    case "violet":
      return "admin.branding.preset.violet";
    case "rose":
      return "admin.branding.preset.rose";
    case "cyan":
      return "admin.branding.preset.cyan";
    case "graphite":
      return "admin.branding.preset.graphite";
    case "high-contrast":
      return "admin.branding.preset.highContrast";
    default:
      return "admin.branding.preset.hulee";
  }
}
