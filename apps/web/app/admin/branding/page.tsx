import {
  brandThemePresets,
  resolveBrandThemeBasePresetId,
  resolveBrandThemePreset,
  resolveBrandThemePresetId,
  type BrandThemePreset,
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
import { DetailItem, SlotMount } from "../../../src/app-chrome";
import {
  applyBrandPresetAction,
  updateTenantBrandAction
} from "../../../src/actions";
import { loadTenantAdminViewModel } from "../../../src/admin-view-model";
import {
  buildBrandMarkLabel,
  brandProfileToCssProperties
} from "../../../src/brand-style";
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

const fallbackPreset = resolveBrandThemePreset("hulee");

export default async function BrandingAdminPage({
  searchParams
}: {
  searchParams?: Promise<{ brandStatus?: string }>;
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
  const currentPresetId =
    resolveBrandThemePresetId(currentTokens) ??
    resolveBrandThemeBasePresetId(currentTokens) ??
    "hulee";
  const previewBrand: BrandProfileView = {
    productName: brand.productName,
    shortProductName: brand.shortProductName,
    themeTokens: currentTokens
  };
  const statusKey = brandStatusKey(resolvedSearchParams?.brandStatus);

  return (
    <TenantAdminShell
      access={access}
      brand={model.tenant.brand}
      current="branding"
      effectiveAccess={accessSnapshot}
      sidebarContent={
        <>
          {statusKey ? (
            <DetailItem
              label={t("admin.branding.status")}
              value={t(statusKey)}
            />
          ) : null}

          <SlotMount slot="tenant.settings.section" />
        </>
      }
      t={t}
      tenantDisplayName={model.tenant.displayName}
      title={t("admin.branding")}
      titleId="branding-title"
    >
      <div className="adminStack">
        <section className="settingsPanel" aria-labelledby="brand-preset-title">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">{t("admin.branding.presets")}</p>
              <h2 className="sectionTitle" id="brand-preset-title">
                {t("admin.branding.themePreset")}
              </h2>
            </div>
            <span className="badge">
              <Paintbrush size={14} aria-hidden="true" />
              {brandThemePresets.length}
            </span>
          </div>

          <div className="brandPresetGrid">
            {brandThemePresets.map((preset) => (
              <form action={applyBrandPresetAction} key={preset.id}>
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
                    currentPresetId === preset.id ? "page" : undefined
                  }
                  style={brandProfileToCssProperties({
                    productName: preset.id,
                    themeTokens: preset.tokens
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

          <form className="settingsForm" action={updateTenantBrandAction}>
            <input name="presetId" type="hidden" value={currentPresetId} />
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
            {resolvedSearchParams?.brandStatus === "invalid" ? (
              <p className="formError">{t("admin.branding.invalid")}</p>
            ) : null}
            <button className="primaryButton" type="submit">
              <Save size={18} aria-hidden="true" />
              {t("common.save")}
            </button>
          </form>
        </section>

        <section
          className="settingsPanel brandPreviewPanel"
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
        </section>
      </div>
    </TenantAdminShell>
  );
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

function presetLabelKey(presetId: BrandThemePreset["id"]): I18nMessageKey {
  switch (presetId) {
    case "neutral":
      return "admin.branding.preset.neutral";
    case "blue":
      return "admin.branding.preset.blue";
    case "green":
      return "admin.branding.preset.green";
    case "graphite":
      return "admin.branding.preset.graphite";
    case "high-contrast":
      return "admin.branding.preset.highContrast";
    case "hulee-dark":
      return "admin.branding.preset.huleeDark";
    case "blue-dark":
      return "admin.branding.preset.blueDark";
    default:
      return "admin.branding.preset.hulee";
  }
}
