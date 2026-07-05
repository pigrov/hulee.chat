"use client";

import {
  buildBrandThemeTokens,
  resolveBrandThemePresetForMode,
  type BrandThemeColorPresetId,
  type BrandThemeMode
} from "@hulee/branding";
import { LoaderCircle, RotateCcw, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  type ReactNode
} from "react";

import { applyBrandPresetAction, updateTenantBrandAction } from "./actions";
import {
  initialBrandingActionState,
  type BrandingActionCode,
  type BrandingActionState
} from "./branding-action-state";
import { BrandThemeModeSelector } from "./brand-theme-mode-selector";

export type BrandingActionMessages = Record<BrandingActionCode, string>;

export type BrandingPresetOption = {
  readonly id: BrandThemeColorPresetId;
  readonly label: string;
  readonly style: CSSProperties;
};

const maxBrandLogoBytes = 2 * 1024 * 1024;
const brandLogoMediaTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

export function BrandingPresetForms({
  currentColorPresetId,
  currentThemeMode,
  darkLabel,
  label,
  lightLabel,
  messages,
  presets,
  productName,
  shortProductName
}: {
  readonly currentColorPresetId: BrandThemeColorPresetId;
  readonly currentThemeMode: BrandThemeMode;
  readonly darkLabel: string;
  readonly label: string;
  readonly lightLabel: string;
  readonly messages: BrandingActionMessages;
  readonly presets: readonly BrandingPresetOption[];
  readonly productName: string;
  readonly shortProductName?: string;
}): ReactNode {
  const router = useRouter();
  const handledStateRef = useRef<string | undefined>(undefined);
  const [state, formAction, isPending] = useActionState(
    applyBrandPresetAction,
    initialBrandingActionState
  );

  useRefreshAfterBrandingSuccess({ router, state, handledStateRef });

  return (
    <>
      <form action={formAction} className="brandThemeModeForm">
        <BrandingBaseFields
          productName={productName}
          shortProductName={shortProductName}
        />
        <input name="presetId" type="hidden" value={currentColorPresetId} />
        <fieldset className="settingsFormFieldset" disabled={isPending}>
          <BrandThemeModeSelector
            currentThemeMode={currentThemeMode}
            darkLabel={darkLabel}
            label={label}
            lightLabel={lightLabel}
          />
        </fieldset>
      </form>

      <BrandingActionNotice messages={messages} state={state} />

      <div className="brandPresetGrid">
        {presets.map((preset) => (
          <form action={formAction} key={preset.id}>
            <BrandingBaseFields
              productName={productName}
              shortProductName={shortProductName}
            />
            <input name="themeMode" type="hidden" value={currentThemeMode} />
            <button
              className="brandPresetButton"
              name="presetId"
              type="submit"
              value={preset.id}
              aria-current={
                currentColorPresetId === preset.id ? "page" : undefined
              }
              disabled={isPending}
              style={preset.style}
            >
              <span className="brandPresetSwatches" aria-hidden="true">
                <span className="brandPresetSwatch brandPresetSwatchPrimary" />
                <span className="brandPresetSwatch brandPresetSwatchAccent" />
                <span className="brandPresetSwatch brandPresetSwatchSurface" />
              </span>
              <span className="listItemTitle">{preset.label}</span>
            </button>
          </form>
        ))}
      </div>
    </>
  );
}

export function BrandingSettingsForm({
  accentColor,
  accentColorLabel,
  currentLogoUrl,
  logoCurrentLabel,
  logoLabel,
  logoRecommendation,
  markLabel,
  messages,
  presetId,
  previewAccentBadgeLabel,
  previewDescription,
  previewPrimaryButtonLabel,
  previewSecondaryButtonLabel,
  previewTitle,
  primaryColor,
  primaryColorHelp,
  primaryColorLabel,
  productName,
  productNameLabel,
  resetColorsLabel,
  saveLabel,
  savingLabel,
  accentColorHelp,
  shortProductName,
  shortProductNameLabel,
  themeMode
}: {
  readonly accentColor: string;
  readonly accentColorHelp: string;
  readonly accentColorLabel: string;
  readonly currentLogoUrl?: string;
  readonly logoCurrentLabel: string;
  readonly logoLabel: string;
  readonly logoRecommendation: string;
  readonly markLabel: string;
  readonly messages: BrandingActionMessages;
  readonly presetId: BrandThemeColorPresetId;
  readonly previewAccentBadgeLabel: string;
  readonly previewDescription: string;
  readonly previewPrimaryButtonLabel: string;
  readonly previewSecondaryButtonLabel: string;
  readonly previewTitle: string;
  readonly primaryColor: string;
  readonly primaryColorHelp: string;
  readonly primaryColorLabel: string;
  readonly productName: string;
  readonly productNameLabel: string;
  readonly resetColorsLabel: string;
  readonly saveLabel: string;
  readonly savingLabel: string;
  readonly shortProductName?: string;
  readonly shortProductNameLabel: string;
  readonly themeMode: BrandThemeMode;
}): ReactNode {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const logoObjectUrlRef = useRef<string | null>(null);
  const handledStateRef = useRef<string | undefined>(undefined);
  const [state, formAction, isPending] = useActionState(
    updateTenantBrandAction,
    initialBrandingActionState
  );
  const [productNameValue, setProductNameValue] = useState(productName);
  const [shortProductNameValue, setShortProductNameValue] = useState(
    shortProductName ?? ""
  );
  const [primaryColorValue, setPrimaryColorValue] = useState(primaryColor);
  const [accentColorValue, setAccentColorValue] = useState(accentColor);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [clientErrorCode, setClientErrorCode] =
    useState<BrandingActionCode | null>(null);
  const defaultBrandColors = useMemo(() => {
    const preset = resolveBrandThemePresetForMode(presetId, themeMode);

    return {
      accentColor: preset.tokens["color.accent"] ?? accentColor,
      primaryColor: preset.tokens["color.brand.primary"] ?? primaryColor
    };
  }, [accentColor, presetId, primaryColor, themeMode]);
  const canResetBrandColors =
    primaryColorValue !== defaultBrandColors.primaryColor ||
    accentColorValue !== defaultBrandColors.accentColor;
  const notice =
    clientErrorCode !== null
      ? {
          message: messages[clientErrorCode],
          variant: "error"
        }
      : state.status === "idle"
        ? undefined
        : {
            message: messages[state.code],
            variant: state.status === "success" ? "success" : "error"
          };
  const previewLogoUrl = logoPreviewUrl ?? currentLogoUrl;
  const previewMarkLabel = buildPreviewBrandMarkLabel({
    markLabel,
    productName: productNameValue,
    shortProductName: shortProductNameValue
  });
  const previewProductName = productNameValue.trim() || productName;
  const previewStyle = useMemo(() => {
    const previewTokens = buildBrandThemeTokens({
      accentColor: accentColorValue,
      mode: themeMode,
      presetId,
      primaryColor: primaryColorValue
    });

    return {
      "--hulee-color-brand-primary": primaryColorValue,
      "--hulee-color-brand-foreground": previewTokens["color.brand.foreground"],
      "--hulee-color-accent": accentColorValue
    } as CSSProperties;
  }, [accentColorValue, presetId, primaryColorValue, themeMode]);

  const clearLogoPreview = useCallback(() => {
    if (logoObjectUrlRef.current !== null) {
      URL.revokeObjectURL(logoObjectUrlRef.current);
      logoObjectUrlRef.current = null;
    }

    setLogoPreviewUrl(null);
  }, []);

  const handleLogoFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];

      clearLogoPreview();
      setClientErrorCode(null);

      if (file === undefined) {
        return;
      }

      const errorCode = validateBrandLogoFile(file);

      if (errorCode !== null) {
        event.currentTarget.value = "";
        setClientErrorCode(errorCode);
        return;
      }

      const previewUrl = URL.createObjectURL(file);
      logoObjectUrlRef.current = previewUrl;
      setLogoPreviewUrl(previewUrl);
    },
    [clearLogoPreview]
  );

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    const file = fileInputRef.current?.files?.[0];
    const errorCode = file === undefined ? null : validateBrandLogoFile(file);

    if (errorCode === null) {
      setClientErrorCode(null);
      return;
    }

    event.preventDefault();
    setClientErrorCode(errorCode);
  }, []);

  const handleResetBrandColors = useCallback(() => {
    setPrimaryColorValue(defaultBrandColors.primaryColor);
    setAccentColorValue(defaultBrandColors.accentColor);
    setClientErrorCode(null);
  }, [defaultBrandColors]);

  useRefreshAfterBrandingSuccess({
    onSuccess: () => {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      clearLogoPreview();
    },
    router,
    state,
    handledStateRef
  });

  useEffect(() => clearLogoPreview, [clearLogoPreview]);

  return (
    <form
      action={formAction}
      className="settingsForm brandingSettingsForm"
      onSubmit={handleSubmit}
    >
      <input name="themeMode" type="hidden" value={themeMode} />
      <input name="presetId" type="hidden" value={presetId} />
      <fieldset className="settingsFormFieldset" disabled={isPending}>
        <label className="fieldStack">
          <span className="detailLabel">{productNameLabel}</span>
          <input
            className="textInput"
            name="productName"
            type="text"
            value={productNameValue}
            onChange={(event) => setProductNameValue(event.currentTarget.value)}
            required
          />
        </label>
        <label className="fieldStack">
          <span className="detailLabel">{shortProductNameLabel}</span>
          <input
            className="textInput"
            name="shortProductName"
            type="text"
            value={shortProductNameValue}
            onChange={(event) =>
              setShortProductNameValue(event.currentTarget.value)
            }
          />
        </label>
        <div className="brandLogoUploadGrid">
          <div
            className="brandLogoPreviewSurface"
            aria-label={logoCurrentLabel}
          >
            {previewLogoUrl ? (
              <img
                className="brandLogoPreviewImage"
                src={previewLogoUrl}
                alt=""
              />
            ) : (
              <div className="brandMark" aria-hidden="true">
                {previewMarkLabel}
              </div>
            )}
          </div>
          <label className="fieldStack">
            <span className="detailLabel">{logoLabel}</span>
            <input
              ref={fileInputRef}
              className="fileInput"
              name="brandLogoFile"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleLogoFileChange}
            />
            <span className="metaText">{logoRecommendation}</span>
          </label>
        </div>
        <div className="brandColorGrid">
          <BrandColorField
            color={primaryColorValue}
            help={primaryColorHelp}
            label={primaryColorLabel}
            name="primaryColor"
            onChange={setPrimaryColorValue}
            sampleKind="primary"
          />
          <BrandColorField
            color={accentColorValue}
            help={accentColorHelp}
            label={accentColorLabel}
            name="accentColor"
            onChange={setAccentColorValue}
            sampleKind="accent"
          />
        </div>
        <div className="brandColorActions">
          <button
            className="secondaryButton"
            type="button"
            disabled={isPending || !canResetBrandColors}
            onClick={handleResetBrandColors}
          >
            <RotateCcw size={18} aria-hidden="true" />
            {resetColorsLabel}
          </button>
        </div>
      </fieldset>

      <div
        className="brandPreviewPanel"
        aria-labelledby="brand-preview-title"
        style={previewStyle}
      >
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">{previewTitle}</p>
            <h2 className="sectionTitle" id="brand-preview-title">
              {previewProductName}
            </h2>
            <p className="metaText">{previewDescription}</p>
          </div>
          <div className="brandMark" aria-label={previewProductName}>
            {previewLogoUrl ? (
              <img
                className="brandLogoPreviewImage"
                src={previewLogoUrl}
                alt=""
              />
            ) : (
              previewMarkLabel
            )}
          </div>
        </div>

        <div className="brandPreviewSurface">
          <div className="brandPreviewExample" data-kind="primary">
            <span className="brandPreviewExampleLabel">
              {primaryColorLabel}
            </span>
            <p className="metaText">{primaryColorHelp}</p>
            <button className="primaryButton" type="button">
              {previewPrimaryButtonLabel}
            </button>
          </div>
          <div className="brandPreviewExample" data-kind="accent">
            <span className="brandPreviewAccentBadge">
              {previewAccentBadgeLabel}
            </span>
            <span className="brandPreviewExampleLabel">{accentColorLabel}</span>
            <p className="metaText">{accentColorHelp}</p>
            <button
              className="secondaryButton brandPreviewAccentButton"
              type="button"
            >
              {previewSecondaryButtonLabel}
            </button>
          </div>
        </div>
      </div>

      <button className="primaryButton" disabled={isPending} type="submit">
        {isPending ? (
          <LoaderCircle
            className="buttonSpinner"
            size={18}
            aria-hidden="true"
          />
        ) : (
          <Save size={18} aria-hidden="true" />
        )}
        {isPending ? savingLabel : saveLabel}
      </button>

      {notice ? (
        <p
          className="actionStateNotice"
          data-variant={notice.variant}
          role={notice.variant === "error" ? "alert" : "status"}
        >
          {notice.message}
        </p>
      ) : null}
    </form>
  );
}

function BrandColorField({
  color,
  help,
  label,
  name,
  onChange,
  sampleKind
}: {
  readonly color: string;
  readonly help: string;
  readonly label: string;
  readonly name: string;
  readonly onChange: (value: string) => void;
  readonly sampleKind: "accent" | "primary";
}): ReactNode {
  return (
    <label className="fieldStack brandColorField">
      <span className="detailLabel">{label}</span>
      <span className="brandColorControl">
        <span
          className="brandColorSample"
          data-kind={sampleKind}
          style={{ "--brand-color-sample": color } as CSSProperties}
          aria-hidden="true"
        />
        <input
          className="colorInput"
          name={name}
          type="color"
          value={color}
          onChange={(event) => onChange(event.currentTarget.value)}
          onInput={(event) => onChange(event.currentTarget.value)}
        />
        <span className="brandColorValue">{color}</span>
      </span>
      <span className="metaText">{help}</span>
    </label>
  );
}

function validateBrandLogoFile(
  file: File
): Extract<BrandingActionCode, "logo_invalid_type" | "logo_too_large"> | null {
  if (!brandLogoMediaTypes.has(file.type)) {
    return "logo_invalid_type";
  }

  if (file.size <= 0 || file.size > maxBrandLogoBytes) {
    return "logo_too_large";
  }

  return null;
}

function buildPreviewBrandMarkLabel(input: {
  readonly markLabel: string;
  readonly productName: string;
  readonly shortProductName: string;
}): string {
  const source =
    input.shortProductName.trim().length > 0
      ? input.shortProductName
      : input.productName;
  const label = source
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return label.length > 0 ? label : input.markLabel;
}

function BrandingBaseFields({
  productName,
  shortProductName
}: {
  readonly productName: string;
  readonly shortProductName?: string;
}): ReactNode {
  return (
    <>
      <input name="productName" type="hidden" value={productName} />
      <input
        name="shortProductName"
        type="hidden"
        value={shortProductName ?? ""}
      />
    </>
  );
}

function BrandingActionNotice({
  messages,
  state
}: {
  readonly messages: BrandingActionMessages;
  readonly state: BrandingActionState;
}): ReactNode {
  if (state.status === "idle") {
    return null;
  }

  return (
    <p
      className="actionStateNotice"
      data-variant={state.status === "success" ? "success" : "error"}
      role="status"
    >
      {messages[state.code]}
    </p>
  );
}

function useRefreshAfterBrandingSuccess({
  handledStateRef,
  onSuccess,
  router,
  state
}: {
  readonly handledStateRef: React.MutableRefObject<string | undefined>;
  readonly onSuccess?: () => void;
  readonly router: ReturnType<typeof useRouter>;
  readonly state: BrandingActionState;
}): void {
  useEffect(() => {
    if (
      state.status !== "success" ||
      handledStateRef.current === state.submittedAt
    ) {
      return;
    }

    handledStateRef.current = state.submittedAt;
    onSuccess?.();
    router.refresh();
  }, [handledStateRef, onSuccess, router, state]);
}
