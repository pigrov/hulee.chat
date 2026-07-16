import { defaultBrandProfile } from "@hulee/branding";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { ReactElement } from "react";

import en from "../../content/landing.en.json";
import kk from "../../content/landing.kk.json";
import ru from "../../content/landing.ru.json";

type Locale = "ru" | "en" | "kk";

type LandingContent = {
  metadata: {
    title: string;
    description: string;
  };
  placeholder: {
    kicker: string;
    title: string;
    lead: string;
    action: string;
  };
};

const contentByLocale: Record<Locale, LandingContent> = {
  ru,
  en,
  kk
};

const supportedLocales = Object.keys(contentByLocale) as Locale[];
const productName = defaultBrandProfile.productName;
const brandLogo =
  defaultBrandProfile.assets.logoLight ??
  defaultBrandProfile.assets.logoDark ??
  defaultBrandProfile.assets.mark ??
  defaultBrandProfile.assets.pwaIcon ??
  "/brand/hulee-logo-3-full-transparent.png";

type PageProps = {
  params: Promise<{
    locale: string;
  }>;
};

function isLocale(locale: string): locale is Locale {
  return locale in contentByLocale;
}

function interpolateProduct(value: string): string {
  return value.replaceAll("{product}", productName);
}

export function generateStaticParams(): Array<{ locale: Locale }> {
  return supportedLocales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params
}: PageProps): Promise<Metadata> {
  const { locale } = await params;

  if (!isLocale(locale)) {
    return {};
  }

  const metadata = contentByLocale[locale].metadata;

  return {
    title: interpolateProduct(metadata.title),
    description: interpolateProduct(metadata.description)
  };
}

export default async function PlaceholderPage({
  params
}: PageProps): Promise<ReactElement> {
  const { locale } = await params;

  if (!isLocale(locale)) {
    notFound();
  }

  const content = contentByLocale[locale].placeholder;

  return (
    <main className="placeholder-site">
      <section className="placeholder-hero" aria-labelledby="placeholder-title">
        <Image
          className="placeholder-logo"
          src={brandLogo}
          alt={productName}
          width={240}
          height={80}
          priority
        />
        <p className="placeholder-kicker">
          {interpolateProduct(content.kicker)}
        </p>
        <h1 id="placeholder-title">{interpolateProduct(content.title)}</h1>
        <p className="placeholder-lead">{interpolateProduct(content.lead)}</p>
        <a className="placeholder-action" href="https://chat.hulee.ru/login">
          {content.action}
        </a>
      </section>
    </main>
  );
}
