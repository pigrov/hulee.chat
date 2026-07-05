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
import { Paintbrush, SlidersHorizontal } from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../src/access-denied";
import {
  AdminSectionFrame,
  type AdminSectionFrameItem
} from "../../../src/admin-section-frame";
import { SlotMount } from "../../../src/app-chrome";
import { loadTenantAdminViewModel } from "../../../src/admin-view-model";
import {
  buildBrandMarkLabel,
  brandProfileToCssProperties
} from "../../../src/brand-style";
import {
  BrandingPresetForms,
  BrandingSettingsForm,
  type BrandingPresetOption
} from "../../../src/branding-forms";
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
  searchParams?: Promise<{ section?: string }>;
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
  const selectedSection = resolveBrandingAdminSection(
    resolvedSearchParams?.section
  );
  const brandingActionMessages = {
    invalid: t("admin.branding.invalid"),
    internal_api_failed: t("admin.branding.internalApiFailed"),
    logo_invalid_type: t("admin.branding.logoInvalidType"),
    logo_metadata_unavailable: t("admin.branding.logoMetadataUnavailable"),
    logo_storage_unavailable: t("admin.branding.logoStorageUnavailable"),
    logo_too_large: t("admin.branding.logoTooLarge"),
    permission_denied: t("admin.branding.permissionDenied"),
    saved: t("admin.branding.saved")
  };
  const presetOptions: readonly BrandingPresetOption[] =
    brandThemeColorPresets.map((preset) => ({
      id: preset.id,
      label: t(presetLabelKey(preset.id)),
      style: brandProfileToCssProperties({
        productName: preset.id,
        themeTokens: resolveBrandThemePresetForMode(preset.id, currentThemeMode)
          .tokens
      })
    }));
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

          <BrandingPresetForms
            currentColorPresetId={currentColorPresetId}
            currentThemeMode={currentThemeMode}
            darkLabel={t("admin.branding.mode.dark")}
            label={t("admin.branding.mode")}
            lightLabel={t("admin.branding.mode.light")}
            messages={brandingActionMessages}
            presets={presetOptions}
            productName={brand.productName}
            shortProductName={brand.shortProductName}
          />
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

          <BrandingSettingsForm
            key={brandingSettingsFormKey({
              accentColor: tokenValue(currentTokens, "color.accent"),
              currentLogoUrl,
              presetId: currentColorPresetId,
              primaryColor: tokenValue(currentTokens, "color.brand.primary"),
              productName: brand.productName,
              shortProductName: brand.shortProductName,
              themeMode: currentThemeMode
            })}
            accentColor={tokenValue(currentTokens, "color.accent")}
            accentColorHelp={t("admin.branding.accentColorHelp")}
            accentColorLabel={t("admin.branding.accentColor")}
            currentLogoUrl={currentLogoUrl}
            logoCurrentLabel={t("admin.branding.logoCurrent")}
            logoLabel={t("admin.branding.logo")}
            logoRecommendation={t("admin.branding.logoRecommendation")}
            markLabel={buildBrandMarkLabel(previewBrand)}
            messages={brandingActionMessages}
            presetId={currentColorPresetId}
            previewAccentBadgeLabel={t("admin.branding.previewAccentBadge")}
            previewDescription={t("admin.branding.previewDescription")}
            previewPrimaryButtonLabel={t("admin.branding.previewPrimaryButton")}
            previewSecondaryButtonLabel={t(
              "admin.branding.previewSecondaryButton"
            )}
            previewTitle={t("admin.branding.preview")}
            primaryColor={tokenValue(currentTokens, "color.brand.primary")}
            primaryColorHelp={t("admin.branding.primaryColorHelp")}
            primaryColorLabel={t("admin.branding.primaryColor")}
            productName={brand.productName}
            productNameLabel={t("admin.branding.productName")}
            resetColorsLabel={t("admin.branding.resetColors")}
            saveLabel={t("common.save")}
            savingLabel={t("admin.branding.saving")}
            shortProductName={brand.shortProductName}
            shortProductNameLabel={t("admin.branding.shortProductName")}
            themeMode={currentThemeMode}
          />
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

function brandingSettingsFormKey(input: {
  accentColor: string;
  currentLogoUrl?: string;
  presetId: BrandThemeColorPresetId;
  primaryColor: string;
  productName: string;
  shortProductName?: string;
  themeMode: string;
}): string {
  return [
    input.themeMode,
    input.presetId,
    input.primaryColor,
    input.accentColor,
    input.productName,
    input.shortProductName ?? "",
    input.currentLogoUrl ?? ""
  ].join(":");
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
