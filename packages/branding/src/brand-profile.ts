export type BrandScope = "platform" | "tenant" | "deployment";

export type BrandAssets = {
  logoLight?: string;
  logoDark?: string;
  mark?: string;
  favicon?: string;
  pwaIcon?: string;
  appIcon?: string;
  splashScreen?: string;
};

export type BrandLinks = {
  help?: string;
  support?: string;
  privacy?: string;
  terms?: string;
};

export type BrandProfile = {
  id: string;
  scope: BrandScope;
  tenantId?: string;
  productName: string;
  shortProductName?: string;
  companyName?: string;
  assets: BrandAssets;
  themeTokens: Record<string, string>;
  links?: BrandLinks;
};

export const defaultBrandProfile: BrandProfile = {
  id: "platform-default",
  scope: "platform",
  productName: "Hulee",
  shortProductName: "Hulee",
  assets: {},
  themeTokens: {}
};
