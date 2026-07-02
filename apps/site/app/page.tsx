import { defaultBrandProfile } from "@hulee/branding";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Cloud,
  LockKeyhole,
  MessageSquare,
  Network,
  ShieldCheck,
  Users,
  Zap
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Image from "next/image";

type Feature = {
  title: string;
  description: string;
  Icon: LucideIcon;
};

const productName = defaultBrandProfile.productName;
const brandMark =
  defaultBrandProfile.assets.mark ??
  defaultBrandProfile.assets.pwaIcon ??
  "/icons/icon-512x512.png";
const chatBaseUrl = "https://chat.hulee.ru";

const navigation = [
  { label: "Platform", href: "#platform" },
  { label: "Deployment", href: "#deployment" },
  { label: "Operations", href: "#operations" }
];

const capabilities: Feature[] = [
  {
    title: "Shared conversation queues",
    description:
      "Bring support, sales, and account work into one operational inbox with ownership and audit trails.",
    Icon: MessageSquare
  },
  {
    title: "Channel adapters",
    description:
      "Connect customer touchpoints through explicit provider contracts instead of one-off integrations.",
    Icon: Network
  },
  {
    title: "Tenant controls",
    description:
      "Keep permissions, files, events, and data boundaries aligned with each company workspace.",
    Icon: ShieldCheck
  }
];

const deploymentModels: Feature[] = [
  {
    title: "Hosted SaaS",
    description:
      "Launch on managed infrastructure with subscription controls, upgrades, and platform operations handled centrally.",
    Icon: Cloud
  },
  {
    title: "Private deployment",
    description:
      "Run the same product core in company infrastructure with extension slots for local systems.",
    Icon: Building2
  }
];

const operatingPrinciples: Feature[] = [
  {
    title: "Events first",
    description:
      "Important actions produce event records for automation, diagnostics, and downstream modules.",
    Icon: Zap
  },
  {
    title: "Access aware",
    description:
      "Roles, teams, and client visibility are built around repeatable service operations.",
    Icon: LockKeyhole
  },
  {
    title: "Team ready",
    description:
      "Operators get fast queues and clear context while admins keep control of policies and limits.",
    Icon: Users
  }
];

const metrics = [
  { value: "2", label: "delivery models" },
  { value: "1", label: "shared product core" },
  { value: "24/7", label: "service workflows" }
];

export default function Home() {
  return (
    <main className="site">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__media" aria-hidden="true">
          <Image
            className="hero__background"
            src="/marketing/hero-workspace.png"
            alt=""
            fill
            priority
            sizes="100vw"
          />
        </div>

        <header className="site-header">
          <a className="brand-lockup" href="/" aria-label={productName}>
            <Image
              className="brand-lockup__mark"
              src={brandMark}
              alt=""
              width={40}
              height={40}
              priority
            />
            <span>{productName}</span>
          </a>

          <nav className="site-nav" aria-label="Primary navigation">
            {navigation.map((item) => (
              <a key={item.href} href={item.href}>
                {item.label}
              </a>
            ))}
          </nav>

          <a className="header-action" href={`${chatBaseUrl}/login`}>
            <span>Sign in</span>
            <ArrowRight aria-hidden="true" />
          </a>
        </header>

        <div className="hero__content">
          <p className="eyebrow">Customer communication platform</p>
          <h1 id="hero-title">{productName}</h1>
          <p className="hero__lead">
            A modular workspace for customer conversations, internal requests,
            provider channels, and service operations.
          </p>
          <div className="hero__actions" aria-label="Primary actions">
            <a
              className="button button--primary"
              href={`${chatBaseUrl}/register`}
            >
              <span>Start workspace</span>
              <ArrowRight aria-hidden="true" />
            </a>
            <a className="button button--secondary" href="#deployment">
              <span>View deployment paths</span>
              <Cloud aria-hidden="true" />
            </a>
          </div>
        </div>

        <dl className="hero__metrics" aria-label="Platform highlights">
          {metrics.map((metric) => (
            <div className="metric" key={metric.label}>
              <dt>{metric.value}</dt>
              <dd>{metric.label}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="section section--platform" id="platform">
        <div className="section__inner split">
          <div>
            <p className="section-kicker">Platform shape</p>
            <h2>
              One operating layer for customer and internal communication.
            </h2>
          </div>
          <p className="section__summary">
            The product keeps company boundaries, provider adapters,
            permissions, files, and audit behavior explicit so teams can scale
            without turning every channel into custom code.
          </p>
        </div>

        <div className="section__inner feature-grid">
          {capabilities.map((feature) => (
            <article className="feature-card" key={feature.title}>
              <feature.Icon aria-hidden="true" />
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section section--deployment" id="deployment">
        <div className="section__inner">
          <p className="section-kicker">Deployment</p>
          <h2>Start hosted, keep the path open for private infrastructure.</h2>
          <div className="deployment-grid">
            {deploymentModels.map((model) => (
              <article className="deployment-card" key={model.title}>
                <model.Icon aria-hidden="true" />
                <h3>{model.title}</h3>
                <p>{model.description}</p>
                <CheckCircle2
                  aria-hidden="true"
                  className="deployment-card__check"
                />
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--operations" id="operations">
        <div className="section__inner operations">
          <div>
            <p className="section-kicker">Operations</p>
            <h2>Built for queues, policies, diagnostics, and handoffs.</h2>
            <p>
              Service teams need a calm command surface: the same contracts that
              power channels and modules also keep deployment, usage, and access
              decisions explainable.
            </p>
          </div>

          <div className="principle-list">
            {operatingPrinciples.map((principle) => (
              <article className="principle" key={principle.title}>
                <principle.Icon aria-hidden="true" />
                <div>
                  <h3>{principle.title}</h3>
                  <p>{principle.description}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="cta" aria-label="Get started">
        <div className="cta__inner">
          <div>
            <p className="section-kicker">Next step</p>
            <h2>Open the workspace or plan a rollout.</h2>
          </div>
          <div className="cta__actions">
            <a className="button button--dark" href={`${chatBaseUrl}/login`}>
              <span>Open app</span>
              <ArrowRight aria-hidden="true" />
            </a>
            <a
              className="button button--light"
              href={`${chatBaseUrl}/register`}
            >
              <span>Create workspace</span>
              <Building2 aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
