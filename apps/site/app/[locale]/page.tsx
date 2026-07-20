import { defaultBrandProfile } from "@hulee/branding";
import {
  ArrowDownRight,
  ArrowRight,
  CheckCircle2,
  Cloud,
  Code2,
  Database,
  Download,
  HardDrive,
  MessageSquare,
  Network,
  ShieldCheck,
  Sparkles,
  Users,
  XCircle,
  type LucideIcon
} from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactElement } from "react";

import en from "../../content/landing.en.json";
import kk from "../../content/landing.kk.json";
import ru from "../../content/landing.ru.json";
import {
  ChannelsShowcase,
  type ChannelsShowcaseContent
} from "./channels-showcase";
import {
  ProductWorkflow,
  type ProductWorkflowContent
} from "./product-workflow";
import { ThemeToggle } from "./theme-toggle";

type Locale = "ru" | "en" | "kk";

type NavItem = {
  label: string;
  href: string;
};

type LanguageItem = {
  code: string;
  label: string;
};

type HeroMetric = {
  value?: string;
  label: string;
  icon?: string;
};

type DataItem = {
  title: string;
  description: string;
  icon: string;
};

type PricingItem = {
  title: string;
  market: string;
  hulee: string;
  metric: string;
  icon: string;
};

type PricingMetric = {
  value: string;
  label: string;
};

type LandingContent = {
  metadata: {
    title: string;
    description: string;
  };
  navigation: NavItem[];
  languages: {
    ariaLabel: string;
    options: LanguageItem[];
  };
  themeToggle: {
    label: string;
    light: string;
    dark: string;
  };
  actions: {
    signIn: string;
    primary: string;
    secondary: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    lead: string;
    imageAlt: string;
    metrics: HeroMetric[];
  };
  dataPreview: {
    kicker: string;
    title: string;
    items: DataItem[];
  };
  productWorkflow: ProductWorkflowContent;
  channelsShowcase: ChannelsShowcaseContent;
  pricingLogic: {
    kicker: string;
    title: string;
    lead: string;
    marketLabel: string;
    huleeLabel: string;
    items: PricingItem[];
    metrics: PricingMetric[];
    note: string;
  };
};

const contentByLocale: Record<Locale, LandingContent> = {
  ru,
  en,
  kk
};

type DataIconName = "cloud" | "download" | "database" | "code";
type PricingIconName = "channels" | "operators" | "dialogs" | "control";

const dataIcons: Record<DataIconName, LucideIcon> = {
  cloud: Cloud,
  download: Download,
  database: Database,
  code: Code2
};

const pricingIcons: Record<PricingIconName, LucideIcon> = {
  channels: Network,
  operators: Users,
  dialogs: MessageSquare,
  control: ShieldCheck
};

const supportedLocales = Object.keys(contentByLocale) as Locale[];
const productName = defaultBrandProfile.productName;
const brandMark =
  defaultBrandProfile.assets.mark ??
  defaultBrandProfile.assets.pwaIcon ??
  defaultBrandProfile.assets.logoLight ??
  "/brand/hulee-logo-3-transparent.png";
const heroImage = "/marketing/hero-interface-light.png";
const heroImageDark = "/marketing/hero-interface-dark.png";

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
    description: interpolateProduct(metadata.description),
    openGraph: {
      title: interpolateProduct(metadata.title),
      description: interpolateProduct(metadata.description),
      images: [
        {
          url: heroImage,
          width: 1536,
          height: 1024,
          alt: contentByLocale[locale].hero.imageAlt
        }
      ]
    }
  };
}

export default async function LandingPage({
  params
}: PageProps): Promise<ReactElement> {
  const { locale } = await params;

  if (!isLocale(locale)) {
    notFound();
  }

  const content = contentByLocale[locale];

  return (
    <main className="site-shell">
      <SiteHeader content={content} locale={locale} />
      <section className="hero-section">
        <div className="hero-section__inner">
          <div className="hero-copy">
            <p className="section-kicker">
              {interpolateProduct(content.hero.eyebrow)}
            </p>
            <h1>{interpolateProduct(content.hero.title)}</h1>
            <p className="hero-copy__lead">
              {interpolateProduct(content.hero.lead)}
            </p>
            <div className="hero-actions" aria-label={content.actions.primary}>
              <Link
                className="button button--primary"
                href="https://chat.hulee.ru/register"
              >
                <span>{content.actions.primary}</span>
                <ArrowRight aria-hidden="true" size={18} strokeWidth={2.2} />
              </Link>
              <Link className="button button--secondary" href="#product">
                <span>{content.actions.secondary}</span>
                <ArrowDownRight
                  aria-hidden="true"
                  size={18}
                  strokeWidth={2.2}
                />
              </Link>
            </div>
          </div>
          <div className="hero-visual">
            <div className="hero-visual__frame">
              <Image
                className="hero-visual__image hero-visual__image--light"
                src={heroImage}
                alt={interpolateProduct(content.hero.imageAlt)}
                width={1536}
                height={1024}
                loading="eager"
                priority
              />
              <Image
                className="hero-visual__image hero-visual__image--dark"
                src={heroImageDark}
                alt={interpolateProduct(content.hero.imageAlt)}
                width={1536}
                height={1024}
                loading="eager"
                priority
              />
            </div>
          </div>
        </div>
        <HeroMetrics metrics={content.hero.metrics} />
      </section>
      <TrustSection content={content.dataPreview} />
      <ProductWorkflow
        content={content.productWorkflow}
        darkImage={heroImageDark}
        lightImage={heroImage}
        productName={productName}
      />
      <ChannelsShowcase
        brandMark={brandMark}
        content={content.channelsShowcase}
      />
      <PricingLogic content={content.pricingLogic} />
    </main>
  );
}

function SiteHeader({
  content,
  locale
}: {
  content: LandingContent;
  locale: Locale;
}): ReactElement {
  return (
    <header className="site-header">
      <Link
        className="brand-lockup"
        href={`/${locale}`}
        aria-label={productName}
      >
        <Image
          className="brand-lockup__mark"
          src={brandMark}
          alt=""
          width={40}
          height={40}
          priority
        />
        <span>{productName}</span>
      </Link>

      <nav className="site-nav" aria-label="Site">
        {content.navigation.map((item) => (
          <Link key={item.href} href={item.href}>
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="header-actions">
        <nav
          className="language-switcher"
          aria-label={content.languages.ariaLabel}
        >
          {content.languages.options.map((item, index) => (
            <Link
              key={item.code}
              className={item.code === locale ? "is-active" : undefined}
              href={`/${item.code}`}
            >
              {item.label}
              {index < content.languages.options.length - 1 ? (
                <span aria-hidden="true">/</span>
              ) : null}
            </Link>
          ))}
        </nav>
        <ThemeToggle labels={content.themeToggle} />
        <Link className="header-login" href="https://chat.hulee.ru/login">
          {content.actions.signIn}
        </Link>
        <Link className="header-cta" href="https://chat.hulee.ru/register">
          {content.actions.primary}
        </Link>
      </div>
    </header>
  );
}

function HeroMetrics({ metrics }: { metrics: HeroMetric[] }): ReactElement {
  return (
    <section className="hero-metrics">
      {metrics.map((metric, index) => (
        <article className="hero-metric" key={`${metric.label}-${index}`}>
          <div className="hero-metric__badge">
            {metric.icon === "storage" ? (
              <HardDrive aria-hidden="true" size={30} strokeWidth={2.2} />
            ) : (
              <span>{metric.value}</span>
            )}
          </div>
          <p>{interpolateProduct(metric.label)}</p>
        </article>
      ))}
    </section>
  );
}

function TrustSection({
  content
}: {
  content: LandingContent["dataPreview"];
}): ReactElement {
  return (
    <section
      aria-labelledby="trust-section-title"
      className="trust-section"
      id="data"
    >
      <div className="trust-section__inner">
        <div className="trust-section__heading">
          <p className="section-kicker">{content.kicker}</p>
          <h2 id="trust-section-title">{content.title}</h2>
        </div>
        <div className="trust-section__items">
          {content.items.map((item, index) => {
            const Icon = dataIcons[item.icon as DataIconName] ?? Cloud;

            return (
              <article className="trust-item" key={item.title}>
                <div className="trust-item__marker" aria-hidden="true">
                  <span className="trust-item__index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="trust-item__icon">
                    <Icon size={32} strokeWidth={2} />
                  </span>
                </div>
                <div className="trust-item__copy">
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function PricingLogic({
  content
}: {
  content: LandingContent["pricingLogic"];
}): ReactElement {
  return (
    <section
      aria-labelledby="pricing-logic-title"
      className="pricing-logic"
      id="pricing"
    >
      <div className="pricing-logic__heading">
        <p className="section-kicker">{content.kicker}</p>
        <h2 id="pricing-logic-title">{content.title}</h2>
        <p>{interpolateProduct(content.lead)}</p>
      </div>

      <div className="pricing-logic__stage">
        <div className="pricing-column pricing-column--market">
          <div className="pricing-column__label">
            <XCircle aria-hidden="true" size={18} strokeWidth={2.2} />
            <span>{content.marketLabel}</span>
          </div>
          <div className="pricing-column__items">
            {content.items.map((item) => {
              const Icon =
                pricingIcons[item.icon as PricingIconName] ?? Network;

              return (
                <article className="pricing-market-card" key={item.title}>
                  <span className="pricing-card__icon" aria-hidden="true">
                    <Icon size={28} strokeWidth={2} />
                  </span>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.market}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <div className="pricing-logic__rail" aria-hidden="true">
          {content.items.map((item) => (
            <span key={item.title}>
              <ArrowRight size={22} strokeWidth={2.4} />
            </span>
          ))}
        </div>

        <div className="pricing-column pricing-column--hulee">
          <div className="pricing-column__label">
            <Sparkles aria-hidden="true" size={18} strokeWidth={2.2} />
            <span>{content.huleeLabel}</span>
          </div>
          <div className="pricing-hulee-panel">
            {content.items.map((item) => {
              const Icon =
                pricingIcons[item.icon as PricingIconName] ?? Network;

              return (
                <article className="pricing-hulee-row" key={item.title}>
                  <span className="pricing-card__icon" aria-hidden="true">
                    <Icon size={30} strokeWidth={2} />
                  </span>
                  <div>
                    <h3>{item.hulee}</h3>
                    <p>{item.title}</p>
                  </div>
                  <strong>{item.metric}</strong>
                </article>
              );
            })}
          </div>
        </div>
      </div>

      <div className="pricing-logic__mobile-pairs">
        {content.items.map((item) => {
          const Icon = pricingIcons[item.icon as PricingIconName] ?? Network;

          return (
            <article className="pricing-pair" key={item.title}>
              <span className="pricing-card__icon" aria-hidden="true">
                <Icon size={28} strokeWidth={2} />
              </span>
              <div className="pricing-pair__copy">
                <h3>{item.title}</h3>
                <p>
                  <span>{content.marketLabel}: </span>
                  {item.market}
                </p>
                <p>
                  <strong>{content.huleeLabel}: </strong>
                  {item.hulee}
                </p>
              </div>
              <strong className="pricing-pair__metric">{item.metric}</strong>
            </article>
          );
        })}
      </div>

      <div className="pricing-metrics" aria-label={content.huleeLabel}>
        {content.metrics.map((metric) => (
          <article className="pricing-metric" key={metric.label}>
            <CheckCircle2 aria-hidden="true" size={24} strokeWidth={2.2} />
            <strong>{interpolateProduct(metric.value)}</strong>
            <span>{interpolateProduct(metric.label)}</span>
          </article>
        ))}
      </div>

      <p className="pricing-logic__note">{interpolateProduct(content.note)}</p>
    </section>
  );
}
