import { defaultBrandProfile, type BrandProfile } from "./brand-profile";
import { mergeTokenOverrides } from "./token-overrides";

export type BrandResolutionInput = {
  platform?: BrandProfile;
  deployment?: BrandProfile;
  tenant?: BrandProfile;
};

export function resolveBrandProfile(input: BrandResolutionInput): BrandProfile {
  const platform = input.platform ?? defaultBrandProfile;
  const deployment = input.deployment;
  const tenant = input.tenant;
  const resolved: BrandProfile = {
    ...platform,
    ...deployment,
    ...tenant,
    id: tenant?.id ?? deployment?.id ?? platform.id,
    scope: tenant?.scope ?? deployment?.scope ?? platform.scope,
    assets: {
      ...platform.assets,
      ...deployment?.assets,
      ...tenant?.assets
    },
    themeTokens: mergeTokenOverrides(
      platform.themeTokens,
      deployment?.themeTokens,
      tenant?.themeTokens
    ),
    links: {
      ...platform.links,
      ...deployment?.links,
      ...tenant?.links
    }
  };

  return resolved;
}
