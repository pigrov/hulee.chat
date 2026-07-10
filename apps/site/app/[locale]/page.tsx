import { defaultBrandProfile } from "@hulee/branding";
import {
  ArrowRight,
  BarChart3,
  Building2,
  Check,
  Code2,
  Cloud,
  Database,
  Gauge,
  Globe2,
  HardDrive,
  Heart,
  KeyRound,
  LockKeyhole,
  Mail,
  MessageSquare,
  Network,
  Plug,
  ShieldCheck,
  Sparkles,
  ShoppingBag,
  Tags,
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
  | "code"
  | "cloud"
  | "database"
  | "gauge"
  | "globe"
  | "hardDrive"
  | "heart"
  | "key"
  | "lock"
  | "mail"
  | "message"
  | "network"
  | "plug"
  | "shield"
  | "shoppingBag"
  | "sparkles"
  | "tag"
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

type ChannelGroup = {
  title: string;
  icon: IconName;
  sources: string[];
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
    groups: ChannelGroup[];
    stats: ChannelStat[];
    note: string;
  };
  workflow: {
    kicker: string;
    title: string;
    summary: string;
    items: ContentItem[];
    noteLead: string;
    note: string;
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
const channelsInboxImage = {
  src: "/marketing/channels-inbox-light.png",
  darkSrc: "/marketing/channels-inbox-dark.png"
} satisfies ThemeImageAsset;
const channelMetricIcons = [
  {
    src: "/marketing/channels-metric-inbox-light.png",
    darkSrc: "/marketing/channels-metric-inbox-dark.png"
  },
  {
    src: "/marketing/channels-metric-profile-light.png",
    darkSrc: "/marketing/channels-metric-profile-dark.png"
  },
  {
    src: "/marketing/channels-metric-cloud-light.png",
    darkSrc: "/marketing/channels-metric-cloud-dark.png"
  }
] as const satisfies readonly ThemeImageAsset[];
const modelNoteIcon = {
  src: "/marketing/model-note-light.png",
  darkSrc: "/marketing/model-note-dark.png"
} satisfies ThemeImageAsset;
const channelNoteIcon = {
  src: "/marketing/channel-note-light.png",
  darkSrc: "/marketing/channel-note-dark.png"
} satisfies ThemeImageAsset;
const workflowDashboardImage = {
  src: "/marketing/workflow-dashboard-light.png",
  darkSrc: "/marketing/workflow-dashboard-dark.png"
} satisfies ThemeImageAsset;
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
  code: Code2,
  cloud: Cloud,
  database: Database,
  gauge: Gauge,
  globe: Globe2,
  hardDrive: HardDrive,
  heart: Heart,
  key: KeyRound,
  lock: LockKeyhole,
  mail: Mail,
  message: MessageSquare,
  network: Network,
  plug: Plug,
  shield: ShieldCheck,
  shoppingBag: ShoppingBag,
  sparkles: Sparkles,
  tag: Tags,
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
            <ThemeImage
              className="model-note__icon"
              src={modelNoteIcon.src}
              darkSrc={modelNoteIcon.darkSrc}
              alt=""
              width={64}
              height={64}
            />
            <p>{copy(content.pricingModel.note)}</p>
          </aside>
        </div>
      </section>

      <section className="section section--channels" id="channels">
        <div className="section__inner split channels-head">
          <div>
            <p className="section-kicker">{content.channels.kicker}</p>
            <h2>{copy(content.channels.title)}</h2>
          </div>
          <p className="section__summary">{copy(content.channels.summary)}</p>
        </div>

        <div className="channels-card">
          <div className="channels-card__content">
            <div
              className="channel-groups"
              aria-label={content.channels.kicker}
            >
              {content.channels.groups.map((group) => {
                const Icon = iconMap[group.icon];

                return (
                  <div className="channel-group" key={group.title}>
                    <span className="channel-group__icon" aria-hidden="true">
                      <Icon />
                    </span>
                    <strong>{copy(group.title)}</strong>
                    <div className="channel-group__sources">
                      {group.sources.map((source, index) => (
                        <span
                          className={`channel-source channel-source--${(index % 6) + 1}`}
                          key={source}
                        >
                          {copy(source)}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <aside className="channel-note">
              <ThemeImage
                className="channel-note__icon"
                src={channelNoteIcon.src}
                darkSrc={channelNoteIcon.darkSrc}
                alt=""
                width={64}
                height={64}
              />
              <p>{copy(content.channels.note)}</p>
            </aside>
          </div>
          <div className="channels-visual" aria-hidden="true">
            <ThemeImage
              className="channels-visual__image"
              src={channelsInboxImage.src}
              darkSrc={channelsInboxImage.darkSrc}
              alt=""
              width={1536}
              height={1536}
              sizes="(max-width: 980px) 100vw, 50vw"
            />
          </div>
        </div>

        <div className="channel-metrics" aria-label={content.channels.kicker}>
          {content.channels.stats.map((stat, index) => {
            const icon = channelMetricIcons[index];
            const Icon = iconMap[stat.icon];

            return (
              <div className="channel-metric" key={stat.title}>
                {icon ? (
                  <ThemeImage
                    className="channel-metric__icon"
                    src={icon.src}
                    darkSrc={icon.darkSrc}
                    alt=""
                    width={76}
                    height={76}
                  />
                ) : (
                  <Icon className="channel-metric__icon" aria-hidden="true" />
                )}
                <p>{copy(stat.description)}</p>
              </div>
            );
          })}
        </div>
      </section>

      <WorkflowSection content={content.workflow} />

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

function WorkflowSection({ content }: { content: LandingContent["workflow"] }) {
  return (
    <section className="section section--workflow" id="workflow">
      <div className="workflow-copy">
        <div className="workflow-copy__head">
          <p className="section-kicker">{content.kicker}</p>
          <h2>{copy(content.title)}</h2>
        </div>
        <p className="workflow-summary">{copy(content.summary)}</p>

        <div className="workflow-grid">
          {content.items.map((item, index) => {
            const Icon = iconMap[item.icon];

            return (
              <article
                className="workflow-card"
                data-workflow-card={index + 1}
                key={item.title}
              >
                <span className="workflow-card__icon" aria-hidden="true">
                  <Icon />
                </span>
                <h3>{copy(item.title)}</h3>
                <p>{copy(item.description)}</p>
              </article>
            );
          })}
        </div>
      </div>

      <div className="workflow-dashboard" aria-hidden="true">
        <ThemeImage
          className="workflow-dashboard__image"
          src={workflowDashboardImage.src}
          darkSrc={workflowDashboardImage.darkSrc}
          alt=""
          width={1536}
          height={1536}
          sizes="(max-width: 980px) 100vw, 48vw"
        />
      </div>

      <aside className="workflow-note">
        <ShieldCheck aria-hidden="true" />
        <p>
          <strong>{copy(content.noteLead)}</strong>{" "}
          <span>{copy(content.note)}</span>
        </p>
      </aside>
    </section>
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
