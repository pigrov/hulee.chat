"use client";

import {
  CalendarDays,
  CheckCircle2,
  Code2,
  Database,
  Globe2,
  Layers3,
  Lightbulb,
  Mail,
  MessageCircle,
  Minus,
  Paperclip,
  Phone,
  Plug,
  Plus,
  Send,
  ShoppingCart,
  Sparkles,
  Users
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";

type Locale = "ru" | "en" | "kk";

type CalculatorMetric = {
  title: string;
  description: string;
  icon: string;
};

type CalculatorContent = {
  kicker: string;
  title: string;
  summary: string;
  form: {
    channelsTitle: string;
    freeChannelLabel: string;
    teamTitle: string;
    teamUnit: string;
    freeAgentLabel: string;
    loadTitle: string;
    conversationsLabel: string;
    filesLabel: string;
    audioLabel: string;
    audioUnit: string;
    storageTitle: string;
    servicesTitle: string;
    noServicesLabel: string;
    primaryAction: string;
    secondaryAction: string;
    channels: string[];
    retentionOptions: string[];
    services: string[];
  };
  forecast: {
    title: string;
    rows: {
      channels: string;
      operators: string;
      storage: string;
      retention: string;
      services: string;
    };
    storageTitle: string;
    storageCapacity: string;
    noteLead: string;
    note: string;
  };
  metrics: CalculatorMetric[];
};

type CalculatorSectionProps = {
  content: CalculatorContent;
  locale: Locale;
  productName: string;
};

const channelIcons = [
  Send,
  MessageCircle,
  Users,
  Sparkles,
  Globe2,
  Mail,
  Code2,
  ShoppingCart
] satisfies LucideIcon[];

const metricIcons: Record<string, LucideIcon> = {
  database: Database,
  plug: Plug,
  users: Users
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function retentionMonthsFrom(label: string): number {
  return Number(label.match(/\d+/u)?.[0] ?? 12);
}

export function CalculatorSection({
  content,
  locale,
  productName
}: CalculatorSectionProps) {
  const [selectedChannels, setSelectedChannels] = useState(() =>
    content.form.channels.map((_, index) => index)
  );
  const [operators, setOperators] = useState(25);
  const [conversations, setConversations] = useState(50_000);
  const [files, setFiles] = useState(10_000);
  const [audioMinutes, setAudioMinutes] = useState(2_000);
  const [retentionIndex, setRetentionIndex] = useState(2);
  const [selectedServices, setSelectedServices] = useState(() =>
    content.form.services.map((_, index) => index)
  );

  const numberFormatter = useMemo(() => {
    const language =
      locale === "kk" ? "kk-KZ" : locale === "ru" ? "ru-RU" : "en-US";
    return new Intl.NumberFormat(language);
  }, [locale]);

  const copy = (text: string) => text.replaceAll("{product}", productName);
  const formatNumber = (value: number) => numberFormatter.format(value);
  const retentionLabel =
    content.form.retentionOptions[retentionIndex] ??
    content.form.retentionOptions[0];
  const retentionMonths = retentionMonthsFrom(retentionLabel);
  const storageGb =
    Math.round(
      ((conversations * 0.0028 + files * 0.02 + audioMinutes * 0.04) *
        retentionMonths) /
        12 /
        10
    ) * 10;
  const annualCapacityGb = 1000;
  const storagePercent = clamp(
    Math.round((storageGb / annualCapacityGb) * 100),
    0,
    100
  );
  const rangeProgress = ((operators - 1) / 99) * 100;
  const zeroPrice = locale === "ru" ? "0 ₽" : "$0";
  const selectedServicesText =
    selectedServices.length > 0
      ? selectedServices.map((index) => content.form.services[index]).join(", ")
      : content.form.noServicesLabel;

  const toggleChannel = (index: number) => {
    setSelectedChannels((current) =>
      current.includes(index)
        ? current.filter((item) => item !== index)
        : [...current, index].sort((a, b) => a - b)
    );
  };

  const toggleService = (index: number) => {
    setSelectedServices((current) =>
      current.includes(index)
        ? current.filter((item) => item !== index)
        : [...current, index].sort((a, b) => a - b)
    );
  };

  return (
    <section className="section section--calculator" id="calculator">
      <div className="section__inner calculator-head">
        <p className="section-kicker">{content.kicker}</p>
        <h2>{copy(content.title)}</h2>
        <p>{copy(content.summary)}</p>
      </div>

      <div className="section__inner calculator">
        <form
          className="calculator-form"
          onSubmit={(event) => event.preventDefault()}
        >
          <fieldset className="calculator-fieldset">
            <legend>{content.form.channelsTitle}</legend>
            <div className="calculator-channel-list">
              {content.form.channels.map((channel, index) => {
                const Icon = channelIcons[index] ?? MessageCircle;
                const isSelected = selectedChannels.includes(index);

                return (
                  <button
                    aria-pressed={isSelected}
                    className="calculator-chip"
                    key={channel}
                    onClick={() => toggleChannel(index)}
                    type="button"
                  >
                    <Icon aria-hidden="true" />
                    <span>{channel}</span>
                  </button>
                );
              })}
            </div>
            <p className="calculator-free-line">
              <CheckCircle2 aria-hidden="true" />
              {copy(content.form.freeChannelLabel)}
            </p>
          </fieldset>

          <fieldset className="calculator-fieldset calculator-fieldset--team">
            <legend>{content.form.teamTitle}</legend>
            <div className="calculator-team">
              <span className="calculator-control-icon" aria-hidden="true">
                <Users />
              </span>
              <div className="calculator-slider">
                <strong>
                  {copy(content.form.teamUnit).replace(
                    "{count}",
                    formatNumber(operators)
                  )}
                </strong>
                <input
                  aria-label={content.form.teamTitle}
                  max={100}
                  min={1}
                  onChange={(event) =>
                    setOperators(clamp(Number(event.target.value), 1, 100))
                  }
                  style={
                    {
                      "--calculator-range-value": `${rangeProgress}%`
                    } as CSSProperties
                  }
                  type="range"
                  value={operators}
                />
                <span>{copy(content.form.freeAgentLabel)}</span>
              </div>
              <Stepper
                ariaLabel={content.form.teamTitle}
                max={100}
                min={1}
                onChange={setOperators}
                step={1}
                value={operators}
              />
            </div>
          </fieldset>

          <fieldset className="calculator-fieldset">
            <legend>{content.form.loadTitle}</legend>
            <div className="calculator-load-grid">
              <NumberControl
                icon={MessageCircle}
                label={content.form.conversationsLabel}
                max={500000}
                min={1000}
                onChange={setConversations}
                step={1000}
                value={conversations}
              />
              <NumberControl
                icon={Paperclip}
                label={content.form.filesLabel}
                max={100000}
                min={0}
                onChange={setFiles}
                step={500}
                value={files}
              />
              <NumberControl
                icon={Phone}
                label={content.form.audioLabel}
                max={50000}
                min={0}
                onChange={setAudioMinutes}
                suffix={content.form.audioUnit}
                step={100}
                value={audioMinutes}
              />
            </div>
          </fieldset>

          <fieldset className="calculator-fieldset">
            <legend>{content.form.storageTitle}</legend>
            <div className="calculator-segments">
              {content.form.retentionOptions.map((option, index) => (
                <button
                  aria-pressed={retentionIndex === index}
                  className="calculator-segment"
                  key={option}
                  onClick={() => setRetentionIndex(index)}
                  type="button"
                >
                  {option}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="calculator-fieldset calculator-fieldset--services">
            <legend>{content.form.servicesTitle}</legend>
            <div className="calculator-services">
              {content.form.services.map((service, index) => (
                <label className="calculator-service" key={service}>
                  <input
                    checked={selectedServices.includes(index)}
                    onChange={() => toggleService(index)}
                    type="checkbox"
                  />
                  <span aria-hidden="true">
                    <CheckCircle2 />
                  </span>
                  {service}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="calculator-actions">
            <button className="button button--primary" type="button">
              <Database aria-hidden="true" />
              <span>{content.form.primaryAction}</span>
            </button>
            <button className="button button--ghost" type="button">
              <Send aria-hidden="true" />
              <span>{content.form.secondaryAction}</span>
            </button>
          </div>
        </form>

        <aside className="calculator-forecast">
          <div className="calculator-forecast__head">
            <h3>{content.forecast.title}</h3>
            <Sparkline />
          </div>

          <div className="calculator-forecast__table">
            <ForecastRow
              icon={Layers3}
              label={content.forecast.rows.channels}
              value={zeroPrice}
            />
            <ForecastRow
              icon={Users}
              label={content.forecast.rows.operators}
              value={zeroPrice}
            />
            <ForecastRow
              icon={Database}
              label={content.forecast.rows.storage}
              value={`${formatNumber(storageGb)} GB`}
            />
            <ForecastRow
              icon={CalendarDays}
              label={content.forecast.rows.retention}
              value={retentionLabel}
            />
            <ForecastRow
              icon={Sparkles}
              label={content.forecast.rows.services}
              value={selectedServicesText}
            />
          </div>

          <div className="calculator-storage-card">
            <div>
              <span>{content.forecast.storageTitle}</span>
              <strong>{formatNumber(storageGb)} GB</strong>
            </div>
            <div
              className="calculator-ring"
              style={
                {
                  "--calculator-progress": `${storagePercent}%`
                } as CSSProperties
              }
            >
              <strong>{storagePercent}%</strong>
            </div>
            <p>
              {content.forecast.storageCapacity.replace(
                "{capacity}",
                formatNumber(annualCapacityGb)
              )}
            </p>
          </div>

          <div className="calculator-note">
            <Lightbulb aria-hidden="true" />
            <p>
              <strong>{content.forecast.noteLead}</strong>{" "}
              <span>{content.forecast.note}</span>
            </p>
          </div>
        </aside>
      </div>

      <div className="section__inner calculator-metrics">
        {content.metrics.map((metric) => {
          const Icon = metricIcons[metric.icon] ?? Database;

          return (
            <article className="calculator-metric" key={metric.title}>
              <span className="calculator-metric__icon" aria-hidden="true">
                <Icon />
              </span>
              <div>
                <h3>{copy(metric.title)}</h3>
                <p>{copy(metric.description)}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function NumberControl({
  icon: Icon,
  label,
  max,
  min,
  onChange,
  step,
  suffix,
  value
}: {
  icon: LucideIcon;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  suffix?: string;
  value: number;
}) {
  return (
    <label className="calculator-number">
      <span className="calculator-number__label">
        <Icon aria-hidden="true" />
        {label}
      </span>
      <input
        max={max}
        min={min}
        onChange={(event) =>
          onChange(clamp(Number(event.target.value), min, max))
        }
        step={step}
        type="number"
        value={value}
      />
      {suffix ? (
        <span className="calculator-number__suffix">{suffix}</span>
      ) : null}
    </label>
  );
}

function Stepper({
  ariaLabel,
  max,
  min,
  onChange,
  step,
  value
}: {
  ariaLabel: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  value: number;
}) {
  return (
    <div className="calculator-stepper">
      <button
        aria-label={`${ariaLabel}: -${step}`}
        onClick={() => onChange(clamp(value - step, min, max))}
        type="button"
      >
        <Minus aria-hidden="true" />
      </button>
      <input
        aria-label={ariaLabel}
        max={max}
        min={min}
        onChange={(event) =>
          onChange(clamp(Number(event.target.value), min, max))
        }
        step={step}
        type="number"
        value={value}
      />
      <button
        aria-label={`${ariaLabel}: +${step}`}
        onClick={() => onChange(clamp(value + step, min, max))}
        type="button"
      >
        <Plus aria-hidden="true" />
      </button>
    </div>
  );
}

function ForecastRow({
  icon: Icon,
  label,
  value
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="calculator-forecast-row">
      <Icon aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Sparkline() {
  return (
    <svg
      aria-hidden="true"
      className="calculator-sparkline"
      viewBox="0 0 220 70"
    >
      <path
        d="M6 54 C32 50 46 50 68 50 C84 50 88 38 110 40 C132 42 142 36 160 42 C178 48 190 20 214 18"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="4"
      />
      <circle cx="214" cy="18" fill="currentColor" r="5" />
    </svg>
  );
}
