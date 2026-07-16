import "./globals.css";

import { defaultBrandProfile, resolveBrandThemePreset } from "@hulee/branding";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";

const appName = defaultBrandProfile.productName;
const shortAppName = defaultBrandProfile.shortProductName ?? appName;
const defaultTheme = resolveBrandThemePreset("hulee").tokens;
const siteUrl = new URL(process.env.HULEE_SITE_BASE_URL ?? "https://hulee.ru");
const brandPreview =
  defaultBrandProfile.assets.logoLight ??
  defaultBrandProfile.assets.mark ??
  defaultBrandProfile.assets.pwaIcon ??
  "/brand/hulee-logo-3-full-transparent.png";
const sansation = localFont({
  src: [
    {
      path: "../public/fonts/sansation/sansation-light.ttf",
      weight: "300"
    },
    {
      path: "../public/fonts/sansation/sansation-regular.ttf",
      weight: "400"
    },
    {
      path: "../public/fonts/sansation/sansation-bold.ttf",
      weight: "700"
    }
  ],
  variable: "--font-sansation",
  display: "swap"
});

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: {
    default: appName,
    template: `%s | ${shortAppName}`
  },
  description:
    "Communication workspace for service, sales, and internal operations teams.",
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
  openGraph: {
    title: appName,
    description:
      "A modular communication workspace for customer channels and internal requests.",
    url: siteUrl,
    siteName: appName,
    type: "website",
    images: [
      {
        url: brandPreview,
        width: 600,
        height: 200,
        alt: `${appName} logo`
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: appName,
    description:
      "A modular communication workspace for customer channels and internal requests.",
    images: [brandPreview]
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
    <html className={sansation.variable} lang="ru" suppressHydrationWarning>
      <body className={sansation.className}>{children}</body>
    </html>
  );
}
