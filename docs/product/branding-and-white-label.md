# Branding And White Label

Hulee must support branding as configuration, not as a fork of core or UI.

## Branding Levels

1. Default Hulee brand.

   Used for the standard SaaS product and internal development environments.

2. Tenant branding.

   Used when a company wants its own logo, product display name, theme token overrides and branded tenant domain inside the Hulee product.

3. White-label deployment branding.

   Used for enterprise SaaS or on-prem deployments where the visible product can use a customer-specific name, logo, domain, app icons, support/legal links and release/update channels.

## Brand Profile

Branding should be represented as a versioned brand profile:

```ts
type BrandScope = "platform" | "tenant" | "deployment";

type BrandProfile = {
  id: string;
  scope: BrandScope;
  tenantId?: string;
  productName: string;
  shortProductName?: string;
  companyName?: string;
  assets: {
    logoLight?: string;
    logoDark?: string;
    mark?: string;
    favicon?: string;
    pwaIcon?: string;
    appIcon?: string;
    splashScreen?: string;
  };
  themeTokens: Record<string, string>;
  links?: {
    help?: string;
    support?: string;
    privacy?: string;
    terms?: string;
  };
  email?: {
    senderName?: string;
    fromAddress?: string;
    templateTheme?: string;
  };
  native?: {
    appName?: string;
    bundleId?: string;
    androidApplicationId?: string;
    desktopAppId?: string;
    updateChannel?: string;
    signingProfileRef?: string;
  };
};
```

Brand assets are stored in tenant-scoped object storage or deployment-owned assets. The database stores references and metadata, not binary data.

## Resolution Rules

- Brand profile resolution happens during app bootstrap from deployment config, request host/domain and tenant context.
- Tenant branding can override platform defaults only through approved fields.
- Deployment branding can set white-label defaults for isolated SaaS and on-prem.
- UI components consume branding through app-shell/theme providers, not through hardcoded product names, logos or colors.
- Product names in UI copy should be variables in i18n messages, not hardcoded strings.
- Visual styling must still use design tokens. Company colors enter the UI by overriding token values.
- Brand changes are tenant-scoped, permission-guarded and audited.
- Brand asset paths must include tenant or deployment scope and must not leak across tenants.

## Client Application Implications

Web/PWA:

- product name, logos, favicon and PWA manifest can be resolved per tenant/deployment at runtime;
- branded domains can map to tenant or isolated deployment config;
- default Hulee branding remains the fallback.

Mobile:

- runtime content can use tenant/deployment brand profile after server selection;
- app name, bundle id and store icon are build/signing concerns and require separate release variants for full white-label distribution;
- enterprise/on-prem mobile distribution may require MDM or private tracks.

Desktop:

- runtime content can use tenant/deployment brand profile after server selection;
- installer name, app id, icon, signing and auto-update channel are packaging concerns and require a release profile;
- on-prem customers may need a customer-controlled update policy.

## MVP Scope

MVP should include:

- tenant brand profile model;
- product display name;
- light/dark logo asset references;
- favicon/PWA icon references for web;
- theme token overrides;
- brand resolution in app-shell;
- tenant admin UI for basic branding;
- audit event for brand profile updates.

MVP should not include:

- full App Store/Google Play white-label release automation;
- customer-specific desktop signing and auto-update channels;
- advanced email template editor;
- per-customer legal document hosting.

Those are v1/enterprise release pipeline work, but the data model and client bootstrap should not block them.

## Quality Rules

- No hardcoded product name in UI components.
- No hardcoded logo paths in UI components.
- No raw company colors outside brand token definitions.
- Brand assets must be validated for type, size and safe rendering.
- Brand changes must produce audit records.
