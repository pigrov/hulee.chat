import "./globals.css";

import { defaultBrandProfile, resolveBrandThemePreset } from "@hulee/branding";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";

const appName = defaultBrandProfile.productName;
const shortAppName = defaultBrandProfile.shortProductName ?? appName;
const defaultTheme = resolveBrandThemePreset("hulee").tokens;
const siteUrl = new URL(process.env.HULEE_SITE_BASE_URL ?? "https://hulee.ru");
const heroImage = "/marketing/hero-workspace-2-transparent.png";
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
        url: heroImage,
        width: 1200,
        height: 800,
        alt: `${appName} workspace preview`
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: appName,
    description:
      "A modular communication workspace for customer channels and internal requests.",
    images: [heroImage]
  },
  formatDetection: {
    telephone: false
  }
};

export const viewport: Viewport = {
  themeColor: defaultTheme["color.brand.primary"],
  colorScheme: "light dark"
};

const themeScript = `
(() => {
  try {
    const mode = window.localStorage.getItem("hulee-site-theme") || "system";
    const resolved =
      mode === "dark" || mode === "light"
        ? mode
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    document.documentElement.dataset.themeMode = mode;
    document.documentElement.dataset.theme = resolved;
  } catch {
    document.documentElement.dataset.themeMode = "system";
  }
})();
`;

export default function RootLayout({
  children
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <html className={sansation.variable} lang="ru" suppressHydrationWarning>
      <body className={sansation.className}>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
      </body>
    </html>
  );
}
