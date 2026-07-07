import { defaultBrandProfile, resolveBrandThemePreset } from "@hulee/branding";
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  const appName = defaultBrandProfile.productName;
  const shortAppName = defaultBrandProfile.shortProductName ?? appName;
  const defaultTheme = resolveBrandThemePreset("hulee").tokens;

  return {
    name: appName,
    short_name: shortAppName,
    description:
      "Communication workspace for service, sales, and internal operations teams.",
    id: "/ru",
    start_url: "/ru",
    scope: "/",
    lang: "ru",
    dir: "ltr",
    display: "standalone",
    display_override: ["standalone", "minimal-ui", "browser"],
    orientation: "portrait",
    background_color: "#f5f7fa",
    theme_color: defaultTheme["color.brand.primary"],
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/icons/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any"
      },
      {
        src: defaultBrandProfile.assets.pwaIcon ?? "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/icon-maskable-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable"
      },
      {
        src: "/icons/icon-maskable-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };
}
