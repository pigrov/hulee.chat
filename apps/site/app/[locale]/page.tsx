import { defaultBrandProfile } from "@hulee/branding";
import {
  ArrowRight,
  BarChart3,
  Building2,
  Check,
  Cloud,
  Database,
  Gauge,
  Globe2,
  HardDrive,
  KeyRound,
  LockKeyhole,
  MessageSquare,
  Network,
  Plug,
  ShieldCheck,
  Sparkles,
  Users,
  WalletCards,
  Zap
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import en from "../../content/landing.en.json";
import kk from "../../content/landing.kk.json";
import ru from "../../content/landing.ru.json";
import { ThemeToggle } from "./theme-toggle";
import { ThemeImage } from "./theme-image";

type Locale = "ru" | "en" | "kk";

type IconName =
  | "barChart"
  | "building"
  | "check"
  | "cloud"
  | "database"
  | "gauge"
  | "globe"
  | "hardDrive"
  | "key"
  | "lock"
  | "message"
  | "network"
  | "plug"
  | "shield"
  | "sparkles"
  | "users"
  | "wallet"
  | "zap";

type ContentItem = {
  title: string;
  description: string;
  icon: IconName;
};

type ThemeImageAsset = {
  src: string;
  darkSrc?: string;
};

type Metric = {
  value: string;
  label: string;
};

type ChannelStat = {
  title: string;
  description: string;
  icon: IconName;
};

type ComparisonRow = {
  label: string;
  usual: string;
  hulee: string;
};

type Plan = {
  name: string;
  description: string;
  storage: string;
  features: string[];
};

type FaqItem = {
  question: string;
  answer: string;
};

type LandingContent = {
  metadata: {
    title: string;
    description: string;
    ogAlt: string;
  };
  navigation: Array<{ label: string; href: string }>;
  languageSwitcher: {
    ariaLabel: string;
    current: string;
  };
  themeToggle: {
    label: string;
    system: string;
    light: string;
    dark: string;
  };
  actions: {
    signIn: string;
    primary: string;
    secondary: string;
    app: string;
    register: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    lead: string;
    metrics: Metric[];
  };
  marketPain: {
    kicker: string;
    title: string;
    summary: string;
    cards: ContentItem[];
  };
  pricingModel: {
    kicker: string;
    title: string;
    summary: string;
    steps: ContentItem[];
    note: string;
  };
  channels: {
    kicker: string;
    title: string;
    summary: string;
    items: string[];
    stats: ChannelStat[];
    note: string;
  };
  workflow: {
    kicker: string;
    title: string;
    summary: string;
    items: ContentItem[];
  };
  audiences: {
    kicker: string;
    title: string;
    items: ContentItem[];
  };
  comparison: {
    kicker: string;
    title: string;
    usualLabel: string;
    huleeLabel: string;
    rows: ComparisonRow[];
  };
  calculator: {
    kicker: string;
    title: string;
    summary: string;
    inputs: string[];
    result: string;
  };
  trust: {
    kicker: string;
    title: string;
    summary: string;
    items: ContentItem[];
  };
  plans: {
    kicker: string;
    title: string;
    summary: string;
    items: Plan[];
  };
  faq: {
    kicker: string;
    title: string;
    items: FaqItem[];
  };
  cta: {
    kicker: string;
    title: string;
    summary: string;
  };
};

const localeEntries = {
  ru: ru as LandingContent,
  en: en as LandingContent,
  kk: kk as LandingContent
} satisfies Record<Locale, LandingContent>;

const supportedLocales = Object.keys(localeEntries) as Locale[];
const productName = defaultBrandProfile.productName;
const brandLockupAsset =
  defaultBrandProfile.assets.logoLight ??
  defaultBrandProfile.assets.logoDark ??
  defaultBrandProfile.assets.mark ??
  defaultBrandProfile.assets.pwaIcon ??
  "/icons/icon-512x512.png";
const heroImages = {
  ru: {
    src: "/marketing/hero-workspace-2-transparent-x2.png",
    darkSrc: "/marketing/hero-workspace-2-transparent-x2-dark.png"
  },
  en: {
    src: "/marketing/hero-workspace-2-transparent-x2-en.png",
    darkSrc: "/marketing/hero-workspace-2-transparent-x2-dark-en.png"
  },
  kk: {
    src: "/marketing/hero-workspace-2-transparent-x2-kk.png",
    darkSrc: "/marketing/hero-workspace-2-transparent-x2-dark-kk.png"
  }
} satisfies Record<Locale, ThemeImageAsset>;
const heroMetricIcons = [
  {
    src: "/marketing/hero-metric-channel-light.png",
    darkSrc: "/marketing/hero-metric-channel-dark.png"
  },
  {
    src: "/marketing/hero-metric-operator-light.png",
    darkSrc: "/marketing/hero-metric-operator-dark.png"
  },
  {
    src: "/marketing/hero-metric-storage-light.png",
    darkSrc: "/marketing/hero-metric-storage-dark.png"
  }
] as const;
const painCardImages = [
  {
    src: "/marketing/pain-channels-transparent-light.png",
    darkSrc: "/marketing/pain-channels-transparent-dark.png"
  },
  {
    src: "/marketing/pain-operators-transparent-light.png",
    darkSrc: "/marketing/pain-operators-transparent-dark.png"
  },
  {
    src: "/marketing/pain-history-transparent-light.png",
    darkSrc: "/marketing/pain-history-transparent-dark.png"
  }
] as const satisfies readonly ThemeImageAsset[];
const modelStepImages = [
  {
    src: "/marketing/model-channels-transparent-light.png",
    darkSrc: "/marketing/model-channels-transparent-dark.png"
  },
  {
    src: "/marketing/model-team-transparent-light.png",
    darkSrc: "/marketing/model-team-transparent-dark.png"
  },
  {
    src: "/marketing/model-storage-transparent-light.png",
    darkSrc: "/marketing/model-storage-transparent-dark.png"
  }
] as const satisfies readonly ThemeImageAsset[];
const chatBaseUrl = "https://chat.hulee.ru";

const iconMap: Record<IconName, LucideIcon> = {
  barChart: BarChart3,
  building: Building2,
  check: Check,
  cloud: Cloud,
  database: Database,
  gauge: Gauge,
  globe: Globe2,
  hardDrive: HardDrive,
  key: KeyRound,
  lock: LockKeyhole,
  message: MessageSquare,
  network: Network,
  plug: Plug,
  shield: ShieldCheck,
  sparkles: Sparkles,
  users: Users,
  wallet: WalletCards,
  zap: Zap
};

function isLocale(locale: string): locale is Locale {
  return supportedLocales.includes(locale as Locale);
}

function getContent(locale: string): LandingContent {
  if (!isLocale(locale)) {
    notFound();
  }

  return localeEntries[locale];
}

function copy(text: string): string {
  return text.replaceAll("{product}", productName);
}

function localizedHref(locale: Locale, href: string): string {
  if (href.startsWith("#")) {
    return `/${locale}${href}`;
  }

  return href;
}

export function generateStaticParams() {
  return supportedLocales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const content = getContent(locale);
  const typedLocale = locale as Locale;
  const heroAsset = heroImages[typedLocale] ?? heroImages.ru;
  const siteUrl = new URL(
    process.env.HULEE_SITE_BASE_URL ?? "https://hulee.ru"
  );
  const canonicalPath = `/${locale}`;

  return {
    title: copy(content.metadata.title),
    description: copy(content.metadata.description),
    alternates: {
      canonical: canonicalPath,
      languages: {
        ru: "/ru",
        en: "/en",
        kk: "/kk"
      }
    },
    openGraph: {
      title: copy(content.metadata.title),
      description: copy(content.metadata.description),
      url: new URL(canonicalPath, siteUrl),
      siteName: productName,
      type: "website",
      images: [
        {
          url: heroAsset.src,
          width: 2400,
          height: 1600,
          alt: copy(content.metadata.ogAlt)
        }
      ],
      locale
    },
    twitter: {
      card: "summary_large_image",
      title: copy(content.metadata.title),
      description: copy(content.metadata.description),
      images: [heroAsset.src]
    }
  };
}

export default async function LandingPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const content = getContent(locale);
  const typedLocale = locale as Locale;
  const heroAsset = heroImages[typedLocale] ?? heroImages.ru;

  return (
    <main className="site">
      <header className="site-header">
        <Link
          className="brand-lockup"
          href={`/${typedLocale}`}
          aria-label={productName}
        >
          <Image
            className="brand-lockup__logo"
            src={brandLockupAsset}
            alt=""
            width={150}
            height={50}
            priority
          />
        </Link>

        <nav className="site-nav" aria-label={content.languageSwitcher.current}>
          {content.navigation.map((item) => (
            <Link key={item.href} href={localizedHref(typedLocale, item.href)}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="header-tools">
          <LanguageSwitcher
            locale={typedLocale}
            labels={content.languageSwitcher}
          />
          <ThemeToggle labels={content.themeToggle} />
          <a className="header-action" href={`${chatBaseUrl}/login`}>
            <span>{content.actions.signIn}</span>
            <ArrowRight aria-hidden="true" />
          </a>
        </div>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__stage">
          <div className="hero__content">
            <p className="eyebrow">{content.hero.eyebrow}</p>
            <h1 id="hero-title">{copy(content.hero.title)}</h1>
            <p className="hero__lead">{copy(content.hero.lead)}</p>
            <div className="hero__actions" aria-label={content.actions.primary}>
              <a
                className="button button--primary"
                href={`${chatBaseUrl}/register`}
              >
                <span>{content.actions.primary}</span>
                <ArrowRight aria-hidden="true" />
              </a>
              <Link
                className="button button--secondary"
                href={`/${typedLocale}#model`}
              >
                <span>{content.actions.secondary}</span>
                <WalletCards aria-hidden="true" />
              </Link>
            </div>
          </div>

          <div className="hero__media" aria-hidden="true">
            <ThemeImage
              className="hero__background"
              src={heroAsset.src}
              darkSrc={heroAsset.darkSrc}
              alt=""
              fill
              priority
              sizes="(max-width: 980px) 100vw, 70vw"
            />
          </div>
        </div>

        <dl className="hero__metrics" aria-label={content.hero.eyebrow}>
          {content.hero.metrics.map((metric, index) => {
            const icon = heroMetricIcons[index];

            return (
              <div className="metric" key={metric.label}>
                {icon ? (
                  <ThemeImage
                    className="metric__icon"
                    src={icon.src}
                    darkSrc={icon.darkSrc}
                    alt=""
                    width={78}
                    height={78}
                    aria-hidden="true"
                  />
                ) : null}
                <div className="metric__body">
                  <dt>{metric.value}</dt>
                  <dd>{copy(metric.label)}</dd>
                </div>
              </div>
            );
          })}
        </dl>
      </section>

      <StorySection
        id="pain"
        className="section--pain"
        kicker={content.marketPain.kicker}
        title={copy(content.marketPain.title)}
        summary={copy(content.marketPain.summary)}
        items={content.marketPain.cards}
        cardImages={painCardImages}
        variant="cards"
      />

      <section className="section section--model" id="model">
        <div className="section__inner split">
          <div>
            <p className="section-kicker">{content.pricingModel.kicker}</p>
            <h2>{copy(content.pricingModel.title)}</h2>
          </div>
          <p className="section__summary">
            {copy(content.pricingModel.summary)}
          </p>
        </div>
        <div className="section__inner model-steps">
          {content.pricingModel.steps.map((step, index) => (
            <FeatureCard
              image={modelStepImages[index]}
              item={step}
              key={step.title}
              marker={String(index + 1).padStart(2, "0")}
            />
          ))}
        </div>
        <div className="section__inner">
          <aside className="model-note">
            <span className="model-note__icon" aria-hidden="true">
              <WalletCards />
            </span>
            <p>{copy(content.pricingModel.note)}</p>
          </aside>
        </div>
      </section>

      <section className="section section--channels" id="channels">
        <div className="channels-card">
          <div className="channels-card__content">
            <p className="section-kicker">{content.channels.kicker}</p>
            <h2>{copy(content.channels.title)}</h2>
            <p className="section__summary">{copy(content.channels.summary)}</p>

            <div className="channel-cloud" aria-label={content.channels.kicker}>
              {content.channels.items.map((channel) => (
                <span className="channel-pill" key={channel}>
                  <span className="channel-pill__mark" aria-hidden="true" />
                  {channel}
                </span>
              ))}
            </div>

            <dl className="channel-metrics">
              {content.channels.stats.map((stat) => {
                const Icon = iconMap[stat.icon];

                return (
                  <div className="channel-metric" key={stat.title}>
                    <Icon className="channel-metric__icon" aria-hidden="true" />
                    <div>
                      <dt>{copy(stat.title)}</dt>
                      <dd>{copy(stat.description)}</dd>
                    </div>
                  </div>
                );
              })}
            </dl>

            <aside className="channel-note">
              <ShieldCheck aria-hidden="true" />
              <p>{copy(content.channels.note)}</p>
            </aside>
          </div>
          <div className="channels-visual" aria-hidden="true">
            <span className="channels-visual__node channels-visual__node--telegram" />
            <span className="channels-visual__node channels-visual__node--whatsapp" />
            <span className="channels-visual__node channels-visual__node--vk" />
            <span className="channels-visual__node channels-visual__node--api" />
            <span className="channels-visual__node channels-visual__node--mail" />
            <span className="channels-visual__hub">
              <MessageSquare />
            </span>
          </div>
        </div>
      </section>

      <StorySection
        id="workflow"
        className="section--workflow"
        kicker={content.workflow.kicker}
        title={copy(content.workflow.title)}
        summary={copy(content.workflow.summary)}
        items={content.workflow.items}
        variant="list"
      />

      <section className="section section--audiences" id="audiences">
        <div className="section__inner">
          <p className="section-kicker">{content.audiences.kicker}</p>
          <h2>{copy(content.audiences.title)}</h2>
          <div className="audience-grid">
            {content.audiences.items.map((item) => (
              <FeatureCard item={item} key={item.title} />
            ))}
          </div>
        </div>
      </section>

      <section className="section section--comparison" id="comparison">
        <div className="section__inner">
          <p className="section-kicker">{content.comparison.kicker}</p>
          <h2>{copy(content.comparison.title)}</h2>
          <div className="comparison-table">
            <div className="comparison-table__head" aria-hidden="true">
              <span />
              <strong>{content.comparison.usualLabel}</strong>
              <strong>{productName}</strong>
            </div>
            {content.comparison.rows.map((row) => (
              <div className="comparison-row" key={row.label}>
                <span>{row.label}</span>
                <p>{copy(row.usual)}</p>
                <p>{copy(row.hulee)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--calculator" id="calculator">
        <div className="section__inner calculator">
          <div>
            <p className="section-kicker">{content.calculator.kicker}</p>
            <h2>{copy(content.calculator.title)}</h2>
            <p>{copy(content.calculator.summary)}</p>
          </div>
          <div className="calculator-panel">
            {content.calculator.inputs.map((input) => (
              <div className="calculator-line" key={input}>
                <Check aria-hidden="true" />
                <span>{input}</span>
              </div>
            ))}
            <strong>{copy(content.calculator.result)}</strong>
          </div>
        </div>
      </section>

      <StorySection
        id="trust"
        className="section--trust"
        kicker={content.trust.kicker}
        title={copy(content.trust.title)}
        summary={copy(content.trust.summary)}
        items={content.trust.items}
        variant="cards"
      />

      <section className="section section--plans" id="plans">
        <div className="section__inner split">
          <div>
            <p className="section-kicker">{content.plans.kicker}</p>
            <h2>{copy(content.plans.title)}</h2>
          </div>
          <p className="section__summary">{copy(content.plans.summary)}</p>
        </div>
        <div className="section__inner plan-grid">
          {content.plans.items.map((plan) => (
            <article className="plan-card" key={plan.name}>
              <h3>{plan.name}</h3>
              <p>{copy(plan.description)}</p>
              <strong>{plan.storage}</strong>
              <ul>
                {plan.features.map((feature) => (
                  <li key={feature}>
                    <Check aria-hidden="true" />
                    <span>{copy(feature)}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="section section--faq" id="faq">
        <div className="section__inner faq">
          <div>
            <p className="section-kicker">{content.faq.kicker}</p>
            <h2>{copy(content.faq.title)}</h2>
          </div>
          <div className="faq-list">
            {content.faq.items.map((item) => (
              <article className="faq-item" key={item.question}>
                <h3>{copy(item.question)}</h3>
                <p>{copy(item.answer)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="cta" aria-label={content.cta.kicker}>
        <div className="cta__inner">
          <div>
            <p className="section-kicker">{content.cta.kicker}</p>
            <h2>{copy(content.cta.title)}</h2>
            <p>{copy(content.cta.summary)}</p>
          </div>
          <div className="cta__actions">
            <a className="button button--dark" href={`${chatBaseUrl}/login`}>
              <span>{content.actions.app}</span>
              <ArrowRight aria-hidden="true" />
            </a>
            <a
              className="button button--light"
              href={`${chatBaseUrl}/register`}
            >
              <span>{content.actions.register}</span>
              <Building2 aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}

function LanguageSwitcher({
  locale,
  labels
}: {
  locale: Locale;
  labels: LandingContent["languageSwitcher"];
}) {
  const localeLabels: Record<Locale, string> = {
    ru: "RU",
    en: "EN",
    kk: "KZ"
  };

  return (
    <div className="language-switcher" aria-label={labels.ariaLabel}>
      {supportedLocales.map((item) => (
        <Link
          aria-current={item === locale ? "page" : undefined}
          className={item === locale ? "is-active" : undefined}
          href={`/${item}`}
          key={item}
        >
          {localeLabels[item]}
        </Link>
      ))}
    </div>
  );
}

function StorySection({
  id,
  className,
  kicker,
  title,
  summary,
  items,
  cardImages,
  variant
}: {
  id: string;
  className: string;
  kicker: string;
  title: string;
  summary: string;
  items: ContentItem[];
  cardImages?: readonly ThemeImageAsset[];
  variant: "cards" | "list";
}) {
  return (
    <section className={`section ${className}`} id={id}>
      <div className="section__inner split">
        <div>
          <p className="section-kicker">{kicker}</p>
          <h2>{title}</h2>
        </div>
        <p className="section__summary">{summary}</p>
      </div>

      <div
        className={`section__inner ${
          variant === "cards" ? "feature-grid" : "principle-list"
        }`}
      >
        {items.map((item, index) =>
          variant === "cards" ? (
            <FeatureCard
              image={cardImages?.[index]}
              item={item}
              key={item.title}
            />
          ) : (
            <FeatureRow item={item} key={item.title} />
          )
        )}
      </div>
    </section>
  );
}

function FeatureCard({
  item,
  marker,
  image
}: {
  item: ContentItem;
  marker?: string;
  image?: ThemeImageAsset;
}) {
  const Icon = iconMap[item.icon];

  return (
    <article
      className={`feature-card${image ? " feature-card--with-image" : ""}`}
    >
      {image ? (
        <>
          {marker ? (
            <span className="feature-card__marker">{marker}</span>
          ) : null}
          <ThemeImage
            className="feature-card__image"
            src={image.src}
            darkSrc={image.darkSrc}
            alt=""
            width={512}
            height={512}
            sizes="(max-width: 980px) 90vw, 32vw"
            aria-hidden="true"
          />
        </>
      ) : (
        <div className="feature-card__top">
          <Icon aria-hidden="true" />
          {marker ? <span>{marker}</span> : null}
        </div>
      )}
      <h3>{copy(item.title)}</h3>
      <p>{copy(item.description)}</p>
    </article>
  );
}

function FeatureRow({ item }: { item: ContentItem }) {
  const Icon = iconMap[item.icon];

  return (
    <article className="principle">
      <Icon aria-hidden="true" />
      <div>
        <h3>{copy(item.title)}</h3>
        <p>{copy(item.description)}</p>
      </div>
    </article>
  );
}
