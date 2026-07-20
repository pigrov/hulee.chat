"use client";

import {
  AtSign,
  Bot,
  ChevronRight,
  ClipboardList,
  Code2,
  FileText,
  Globe,
  Inbox,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  Search,
  Send,
  Settings,
  ShoppingBag,
  Store,
  ThumbsUp,
  Users,
  Webhook,
  type LucideIcon
} from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties } from "react";

export type ChannelsShowcaseContent = {
  kicker: string;
  title: string;
  lead: string;
  tabsLabel: string;
  visualLabel: string;
  hubLabel: string;
  inboxTitle: string;
  inboxCount: string;
  categories: Array<{
    title: string;
    icon: string;
    channels: Array<{
      title: string;
      description: string;
      status: string;
      statusTone: string;
      icon: string;
    }>;
  }>;
};

type MotionPhase = "idle" | "collapsing" | "expanding";

const iconByName: Record<string, LucideIcon> = {
  api: Code2,
  at: AtSign,
  bot: Bot,
  callback: Phone,
  chat: MessageSquare,
  classifieds: ClipboardList,
  code: Code2,
  commerce: ShoppingBag,
  email: Mail,
  form: ClipboardList,
  globe: Globe,
  inbox: Inbox,
  internal: FileText,
  mail: Mail,
  marketplace: Store,
  message: MessageCircle,
  max: MessageCircle,
  messengers: MessageCircle,
  phone: Phone,
  search: Search,
  send: Send,
  settings: Settings,
  sms: MessageCircle,
  social: ThumbsUp,
  store: Store,
  telegram: Send,
  users: Users,
  vk: ThumbsUp,
  webhook: Webhook,
  whatsapp: MessageCircle
};

function getIcon(name: string): LucideIcon {
  return iconByName[name] ?? MessageCircle;
}

export function ChannelsShowcase({
  brandMark,
  content
}: {
  brandMark: string;
  content: ChannelsShowcaseContent;
}) {
  const initialIndex = Math.max(
    0,
    content.categories.findIndex((category) => category.icon === "globe")
  );
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [displayIndex, setDisplayIndex] = useState(initialIndex);
  const [phase, setPhase] = useState<MotionPhase>("idle");
  const timers = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  function selectCategory(nextIndex: number): void {
    if (nextIndex === activeIndex || phase !== "idle") {
      return;
    }

    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];

    setActiveIndex(nextIndex);
    setPhase("collapsing");

    timers.current.push(
      window.setTimeout(() => {
        setDisplayIndex(nextIndex);
        setPhase("expanding");
      }, 260)
    );

    timers.current.push(
      window.setTimeout(() => {
        setPhase("idle");
      }, 640)
    );
  }

  const category = content.categories[displayIndex] ?? content.categories[0];
  const visibleChannels = category.channels.slice(0, 6);

  return (
    <section className="channels-showcase" id="channels">
      <div className="channels-showcase__inner">
        <div className="channels-showcase__copy">
          <div className="channels-showcase__heading">
            <p className="section-kicker">{content.kicker}</p>
            <h2>{content.title}</h2>
            <p>{content.lead}</p>
          </div>

          <div
            className="channel-tabs"
            role="tablist"
            aria-label={content.tabsLabel}
          >
            {content.categories.map((item, index) => {
              const Icon = getIcon(item.icon);
              const isActive = index === activeIndex;

              return (
                <button
                  aria-selected={isActive}
                  className={`channel-tab${isActive ? " is-active" : ""}`}
                  key={item.title}
                  onClick={() => selectCategory(index)}
                  role="tab"
                  type="button"
                >
                  <span className="channel-tab__icon" aria-hidden="true">
                    <Icon size={24} strokeWidth={2} />
                  </span>
                  <span>{item.title}</span>
                  <ChevronRight
                    aria-hidden="true"
                    className="channel-tab__chevron"
                    size={18}
                    strokeWidth={2.2}
                  />
                </button>
              );
            })}
          </div>
        </div>

        <div
          aria-label={content.visualLabel}
          className={`channel-flow is-${phase}`}
          style={{ "--channel-count": visibleChannels.length } as CSSProperties}
        >
          <div className="channel-flow__backdrop" aria-hidden="true" />
          <div className="channel-flow__header">
            <span>{category.title}</span>
            <strong>{content.inboxTitle}</strong>
          </div>
          <div className="channel-cards">
            {visibleChannels.map((channel, index) => {
              const Icon = getIcon(channel.icon);
              const center = (visibleChannels.length - 1) / 2;
              const shift = Math.round((center - index) * 76);
              const style = {
                "--channel-delay": `${index * 42}ms`,
                "--channel-index": index,
                "--channel-collapse-y": `${shift}px`
              } as CSSProperties;

              return (
                <article
                  className="channel-card"
                  key={`${category.title}-${channel.title}`}
                  style={style}
                >
                  <span className="channel-card__icon" aria-hidden="true">
                    <Icon size={30} strokeWidth={2} />
                  </span>
                  <span className="channel-card__content">
                    <span className="channel-card__title">{channel.title}</span>
                    <span className="channel-card__description">
                      {channel.description}
                    </span>
                  </span>
                  <span
                    className={`channel-card__status is-${channel.statusTone}`}
                  >
                    {channel.status}
                  </span>
                  <span className="channel-card__wire" aria-hidden="true" />
                </article>
              );
            })}
          </div>

          <div className="channel-hub" aria-hidden="true">
            <Image src={brandMark} alt="" width={68} height={68} />
            <span>{content.hubLabel}</span>
          </div>

          <div className="channel-flow__beam" aria-hidden="true" />

          <div className="channel-flow__arrow" aria-hidden="true">
            <ChevronRight size={32} strokeWidth={2.2} />
          </div>

          <div className="channel-inbox" aria-hidden="true">
            <div className="channel-inbox__brand">
              <Image src={brandMark} alt="" width={38} height={38} />
              <strong>{content.hubLabel}</strong>
            </div>
            <div className="channel-inbox__body">
              <div className="channel-inbox__rail">
                {[MessageCircle, Search, Users, Settings].map((Icon, index) => (
                  <span
                    className={index === 0 ? "is-active" : undefined}
                    key={index}
                  >
                    <Icon size={18} strokeWidth={2} />
                  </span>
                ))}
              </div>
              <div className="channel-inbox__list">
                <div className="channel-inbox__head">
                  <strong>{content.inboxTitle}</strong>
                  <span>{content.inboxCount}</span>
                </div>
                {visibleChannels.map((channel, index) => {
                  const Icon = getIcon(channel.icon);

                  return (
                    <div className="channel-inbox__row" key={channel.title}>
                      <span>
                        <Icon size={18} strokeWidth={2} />
                      </span>
                      <i />
                      <time>{`1${index + 1}:${index % 2 === 0 ? "45" : "32"}`}</time>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
