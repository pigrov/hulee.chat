import "./globals.css";

import { defaultBrandProfile, resolveBrandThemePreset } from "@hulee/branding";
import type { Metadata } from "next";
import type { Viewport } from "next";
import type { ReactNode } from "react";

const appName = defaultBrandProfile.productName;
const shortAppName = defaultBrandProfile.shortProductName ?? appName;
const defaultTheme = resolveBrandThemePreset("hulee").tokens;

export const metadata: Metadata = {
  title: {
    default: appName,
    template: `%s | ${shortAppName}`
  },
  description: "Tenant communication workspace",
  applicationName: appName,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: defaultBrandProfile.assets.favicon ?? "/favicon.ico",
        sizes: "any"
      },
      {
        url: "/favicon-32x32.png",
        sizes: "32x32",
        type: "image/png"
      },
      {
        url: "/favicon-16x16.png",
        sizes: "16x16",
        type: "image/png"
      }
    ],
    apple: [
      {
        url: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png"
      }
    ]
  },
  appleWebApp: {
    capable: true,
    title: shortAppName,
    statusBarStyle: "default"
  },
  formatDetection: {
    telephone: false
  }
};

export const viewport: Viewport = {
  themeColor: defaultTheme["color.brand.primary"],
  colorScheme: "light dark"
};

export default function RootLayout({
  children
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
