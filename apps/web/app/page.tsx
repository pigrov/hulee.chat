import { createTranslator } from "@hulee/i18n";
import { createSlotRegistry, resolveSlotHost, type UiSlotId } from "@hulee/ui";
import {
  Activity,
  Inbox,
  LinkIcon,
  Plug,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Save,
  Send,
  Settings,
  ShieldCheck,
  Unlink,
  UserRound
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  deleteTelegramWebhookAction,
  refreshTelegramDiagnosticsAction,
  sendReplyAction,
  setTelegramWebhookAction,
  updateTelegramIntegrationAction
} from "../src/actions";
import {
  buildBrandMarkLabel,
  brandProfileToCssProperties
} from "../src/brand-style";
import {
  loadInboxViewModel,
  loadTelegramIntegration,
  type InboxConversation,
  type InboxMessage,
  type TelegramIntegrationViewModel
} from "../src/inbox-api-client";

const emptySlotRegistry = createSlotRegistry([]);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function InboxPage({
  searchParams
}: {
  searchParams?: Promise<{ conversationId?: string }>;
}): Promise<ReactNode> {
  const resolvedSearchParams = await searchParams;
  const model = await loadInboxViewModel({
    selectedConversationId: resolvedSearchParams?.conversationId
  });
  const telegramIntegration = await loadTelegramIntegration();
  const { t, locale } = createTranslator(model.tenant.locale);
  const selectedConversation = model.selectedConversation;
  const brandStyle = brandProfileToCssProperties(model.tenant.brand);
  const productName = t("app.name", {
    productName: model.tenant.brand.productName
  });

  return (
    <main className="appFrame" style={brandStyle}>
      <nav className="navigationRail" aria-label={productName}>
        <div className="brandMark" title={productName}>
          {buildBrandMarkLabel(model.tenant.brand)}
        </div>
        <Link
          className="railButton"
          href="/"
          aria-label={t("navigation.inbox")}
          aria-current="page"
        >
          <Inbox size={20} aria-hidden="true" />
        </Link>
        <a
          className="railButton"
          href="#admin"
          aria-label={t("navigation.admin")}
        >
          <Settings size={20} aria-hidden="true" />
        </a>
      </nav>

      <section className="queuePane" aria-labelledby="inbox-title">
        <div className="paneHeader">
          <div className="paneHeaderRow">
            <div>
              <p className="eyebrow">{productName}</p>
              <h1 className="title" id="inbox-title">
                {t("inbox.title")}
              </h1>
              <p className="metaText">{model.tenant.displayName}</p>
            </div>
            <Link
              className="iconButton"
              href="/"
              aria-label={t("inbox.refresh")}
            >
              <RefreshCw size={17} aria-hidden="true" />
            </Link>
          </div>
        </div>
        <div className="conversationList">
          {model.conversations.length === 0 ? (
            <div className="emptyState">{t("inbox.emptyConversations")}</div>
          ) : (
            model.conversations.map((conversation) => (
              <ConversationListItem
                key={conversation.id}
                conversation={conversation}
                current={conversation.id === selectedConversation?.id}
                locale={locale}
                t={t}
              />
            ))
          )}
        </div>
        <SlotMount slot="inbox.sidebar.section" />
      </section>

      <section
        className="conversationPane"
        aria-labelledby="conversation-title"
      >
        <header className="paneHeader conversationHeader">
          <div>
            <p className="eyebrow">{t("inbox.conversation")}</p>
            <h2 className="conversationTitle" id="conversation-title">
              {selectedConversation?.clientDisplayName ?? t("common.unknown")}
            </h2>
            {selectedConversation ? (
              <p className="metaText">
                {t("inbox.messageCount", {
                  count: selectedConversation.messageCount
                })}
              </p>
            ) : null}
          </div>
          <span className="badge">
            <ShieldCheck size={14} aria-hidden="true" />
            {selectedConversation?.status ?? t("common.unknown")}
          </span>
        </header>

        <div className="messageStream">
          {model.messages.length === 0 ? (
            <div className="emptyState">{t("inbox.emptyMessages")}</div>
          ) : (
            model.messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                locale={locale}
                t={t}
              />
            ))
          )}
        </div>

        {selectedConversation ? (
          <form className="composer" action={sendReplyAction}>
            <input
              type="hidden"
              name="conversationId"
              value={selectedConversation.id}
            />
            <button
              className="iconButton"
              type="button"
              aria-label={t("inbox.channels")}
            >
              <Paperclip size={17} aria-hidden="true" />
            </button>
            <textarea
              className="composerTextarea"
              name="text"
              rows={1}
              placeholder={t("inbox.replyPlaceholder")}
              required
            />
            <button
              className="sendButton"
              type="submit"
              aria-label={t("inbox.replySubmit")}
            >
              <Send size={18} aria-hidden="true" />
            </button>
            <SlotMount slot="conversation.composer.tool" />
          </form>
        ) : null}
      </section>

      <aside className="clientPane" aria-labelledby="client-title">
        <div className="paneHeader">
          <p className="eyebrow">{t("inbox.client")}</p>
          <h2 className="title" id="client-title">
            {selectedConversation?.clientDisplayName ?? t("common.unknown")}
          </h2>
        </div>
        <section className="clientSection">
          <div className="clientIdentity">
            <div className="avatar">
              <UserRound size={20} aria-hidden="true" />
            </div>
            <div>
              <div className="detailValue">
                {selectedConversation?.clientDisplayName ?? t("common.unknown")}
              </div>
              <div className="detailLabel">
                {selectedConversation?.clientId}
              </div>
            </div>
          </div>
        </section>
        <section className="clientSection detailGrid">
          <DetailItem
            label={t("inbox.source")}
            value={selectedConversation?.source ?? t("common.unknown")}
          />
          <DetailItem
            label={t("inbox.status")}
            value={selectedConversation?.status ?? t("common.unknown")}
          />
          <DetailItem
            label={t("inbox.updatedAt")}
            value={
              selectedConversation?.lastMessageAt
                ? formatDateTime(selectedConversation.lastMessageAt, locale)
                : t("common.unknown")
            }
          />
          <DetailItem
            label={t("inbox.tenant")}
            value={model.tenant.displayName}
          />
        </section>
        <SlotMount slot="client.profile.card" />
        <TelegramIntegrationPanel
          integration={telegramIntegration}
          locale={locale}
          t={t}
        />
      </aside>
    </main>
  );
}

function TelegramIntegrationPanel({
  integration,
  locale,
  t
}: {
  integration: TelegramIntegrationViewModel;
  locale: string;
  t: ReturnType<typeof createTranslator>["t"];
}): ReactNode {
  const config = integration.config;

  return (
    <section
      className="adminSection"
      id="admin"
      aria-labelledby="telegram-integration-title"
    >
      <div className="sectionHeader">
        <div>
          <p className="eyebrow">{t("admin.integrations")}</p>
          <h2 className="sectionTitle" id="telegram-integration-title">
            {t("integrations.telegram.title")}
          </h2>
        </div>
        <span className="badge">
          <Plug size={14} aria-hidden="true" />
          {t(telegramStatusKey(integration.diagnostics.status))}
        </span>
      </div>

      <form className="settingsForm" action={updateTelegramIntegrationAction}>
        <label className="toggleRow">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={integration.enabled}
          />
          <span>{t("integrations.telegram.enabled")}</span>
        </label>

        <label className="fieldStack">
          <span className="detailLabel">
            {t("integrations.telegram.channelExternalId")}
          </span>
          <input
            className="textInput"
            name="channelExternalId"
            defaultValue={config?.channelExternalId ?? "telegram-local"}
            required
          />
        </label>

        <label className="fieldStack">
          <span className="detailLabel">{t("integrations.telegram.mode")}</span>
          <select
            className="selectInput"
            name="mode"
            defaultValue={config?.mode ?? "webhook"}
          >
            <option value="webhook">
              {t("integrations.telegram.mode.webhook")}
            </option>
            <option value="polling">
              {t("integrations.telegram.mode.polling")}
            </option>
          </select>
        </label>

        <label className="fieldStack">
          <span className="detailLabel">
            {t("integrations.telegram.botToken")}
          </span>
          <input
            className="textInput"
            type="password"
            name="botToken"
            placeholder={t("integrations.telegram.botTokenPlaceholder")}
          />
        </label>

        <label className="fieldStack">
          <span className="detailLabel">
            {t("integrations.telegram.botTokenSecretRef")}
          </span>
          <input
            className="textInput"
            value={config?.botTokenSecretRef ?? ""}
            readOnly
          />
        </label>

        <label className="toggleRow">
          <input
            type="checkbox"
            name="outboundEnabled"
            defaultChecked={config?.outboundEnabled ?? false}
          />
          <span>{t("integrations.telegram.outboundEnabled")}</span>
        </label>

        <label className="fieldStack">
          <span className="detailLabel">
            {t("integrations.telegram.webhookPath")}
          </span>
          <input
            className="textInput"
            value={integration.webhookPath ?? ""}
            readOnly
          />
        </label>

        <label className="fieldStack">
          <span className="detailLabel">
            {t("integrations.telegram.publicWebhookUrl")}
          </span>
          <input
            className="textInput"
            value={integration.publicWebhookUrl ?? ""}
            readOnly
          />
        </label>

        <div className="diagnosticGrid">
          <DetailItem
            label={t("integrations.telegram.configValid")}
            value={formatBoolean(integration.diagnostics.checks.configValid, t)}
          />
          <DetailItem
            label={t("integrations.telegram.inboundWebhookReady")}
            value={formatBoolean(
              integration.diagnostics.checks.inboundWebhookReady,
              t
            )}
          />
          <DetailItem
            label={t("integrations.telegram.secretConfigured")}
            value={formatBoolean(
              integration.diagnostics.checks.botTokenSecretRefConfigured,
              t
            )}
          />
          <DetailItem
            label={t("integrations.telegram.tokenResolved")}
            value={formatOptionalBoolean(
              integration.diagnostics.checks.botTokenResolved,
              t
            )}
          />
          <DetailItem
            label={t("integrations.telegram.botApiReachable")}
            value={formatOptionalBoolean(
              integration.diagnostics.checks.botApiReachable,
              t
            )}
          />
          <DetailItem
            label={t("integrations.telegram.webhookMatchesConfig")}
            value={formatOptionalBoolean(
              integration.diagnostics.checks.webhookMatchesConfig,
              t
            )}
          />
          <DetailItem
            label={t("integrations.telegram.botIdentity")}
            value={formatTelegramBotIdentity(integration, t)}
          />
          <DetailItem
            label={t("integrations.telegram.actualWebhookUrl")}
            value={formatOptionalValue(
              integration.diagnostics.webhook?.actualUrl,
              t
            )}
          />
          <DetailItem
            label={t("integrations.telegram.pendingUpdates")}
            value={formatOptionalValue(
              integration.diagnostics.webhook?.pendingUpdateCount,
              t
            )}
          />
          <DetailItem
            label={t("integrations.telegram.pollingLastUpdate")}
            value={formatOptionalValue(
              integration.diagnostics.polling?.lastUpdateId,
              t
            )}
          />
          <DetailItem
            label={t("integrations.telegram.pollingLastRunAt")}
            value={formatOptionalDateTime(
              integration.diagnostics.polling?.lastRunAt,
              locale,
              t
            )}
          />
          <DetailItem
            label={t("integrations.telegram.pollingReceived")}
            value={formatOptionalValue(
              integration.diagnostics.polling?.receivedUpdateCount,
              t
            )}
          />
          <DetailItem
            label={t("integrations.telegram.pollingAccepted")}
            value={formatOptionalValue(
              integration.diagnostics.polling?.acceptedUpdateCount,
              t
            )}
          />
          <DetailItem
            label={t("integrations.telegram.pollingFailed")}
            value={formatOptionalValue(
              integration.diagnostics.polling?.failedUpdateCount,
              t
            )}
          />
          {integration.diagnostics.operatorHint ? (
            <DetailItem
              label={t("integrations.telegram.operatorHint")}
              value={integration.diagnostics.operatorHint}
            />
          ) : null}
        </div>

        <div className="buttonRow">
          <button className="primaryButton" type="submit">
            <Save size={16} aria-hidden="true" />
            {t("common.save")}
          </button>
        </div>
      </form>

      <div className="buttonRow">
        <form action={refreshTelegramDiagnosticsAction}>
          <button className="secondaryButton" type="submit">
            <Activity size={16} aria-hidden="true" />
            {t("integrations.telegram.refreshDiagnostics")}
          </button>
        </form>
        <form action={setTelegramWebhookAction}>
          <button className="secondaryButton" type="submit">
            <LinkIcon size={16} aria-hidden="true" />
            {t("integrations.telegram.setWebhook")}
          </button>
        </form>
        <form action={deleteTelegramWebhookAction}>
          <button className="secondaryButton" type="submit">
            <Unlink size={16} aria-hidden="true" />
            {t("integrations.telegram.deleteWebhook")}
          </button>
        </form>
      </div>
    </section>
  );
}

function ConversationListItem({
  conversation,
  current,
  locale,
  t
}: {
  conversation: InboxConversation;
  current: boolean;
  locale: string;
  t: ReturnType<typeof createTranslator>["t"];
}): ReactNode {
  return (
    <Link
      className="conversationLink"
      href={`/?conversationId=${encodeURIComponent(conversation.id)}`}
      aria-current={current ? "page" : undefined}
    >
      <div className="conversationLinkTop">
        <span className="conversationName">
          {conversation.clientDisplayName}
        </span>
        {conversation.lastMessageAt ? (
          <time className="timestamp" dateTime={conversation.lastMessageAt}>
            {formatDateTime(conversation.lastMessageAt, locale)}
          </time>
        ) : null}
      </div>
      <p className="lastMessage">
        {conversation.lastMessageText ?? t("inbox.emptyMessages")}
      </p>
      <div className="badgeRow">
        <span className="badge">
          <MessageSquare size={13} aria-hidden="true" />
          {conversation.messageCount}
        </span>
        {conversation.queuedCount > 0 ? (
          <span className="badge">
            {t("message.status.queued")} {conversation.queuedCount}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

function MessageBubble({
  message,
  locale,
  t
}: {
  message: InboxMessage;
  locale: string;
  t: ReturnType<typeof createTranslator>["t"];
}): ReactNode {
  return (
    <article className="messageBubble" data-direction={message.direction}>
      <p className="messageBody">{message.text ?? ""}</p>
      <div className="messageMeta">
        <span>{t(`message.direction.${message.direction}`)}</span>
        <span>{t(`message.status.${message.status}`)}</span>
        <time dateTime={message.createdAt}>
          {formatDateTime(message.createdAt, locale)}
        </time>
      </div>
      <SlotMount slot="conversation.message.action" />
    </article>
  );
}

function DetailItem({
  label,
  value
}: {
  label: string;
  value: string;
}): ReactNode {
  return (
    <div className="detailItem">
      <span className="detailLabel">{label}</span>
      <span className="detailValue">{value}</span>
    </div>
  );
}

function telegramStatusKey(
  status: TelegramIntegrationViewModel["diagnostics"]["status"]
):
  | "integrations.telegram.status.disabled"
  | "integrations.telegram.status.configured"
  | "integrations.telegram.status.invalid_config"
  | "integrations.telegram.status.provider_unreachable"
  | "integrations.telegram.status.webhook_mismatch" {
  return `integrations.telegram.status.${status}` as
    | "integrations.telegram.status.disabled"
    | "integrations.telegram.status.configured"
    | "integrations.telegram.status.invalid_config"
    | "integrations.telegram.status.provider_unreachable"
    | "integrations.telegram.status.webhook_mismatch";
}

function formatBoolean(
  value: boolean,
  t: ReturnType<typeof createTranslator>["t"]
): string {
  return t(value ? "common.yes" : "common.no");
}

function formatOptionalBoolean(
  value: boolean | undefined,
  t: ReturnType<typeof createTranslator>["t"]
): string {
  return value === undefined ? t("common.unknown") : formatBoolean(value, t);
}

function formatOptionalValue(
  value: number | string | undefined,
  t: ReturnType<typeof createTranslator>["t"]
): string {
  if (value === undefined || value === "") {
    return t("common.unknown");
  }

  return String(value);
}

function formatOptionalDateTime(
  value: string | undefined,
  locale: string,
  t: ReturnType<typeof createTranslator>["t"]
): string {
  return value === undefined
    ? t("common.unknown")
    : formatDateTime(value, locale);
}

function formatTelegramBotIdentity(
  integration: TelegramIntegrationViewModel,
  t: ReturnType<typeof createTranslator>["t"]
): string {
  const bot = integration.diagnostics.bot;

  if (!bot) {
    return t("common.unknown");
  }

  return bot.username ? `@${bot.username}` : bot.id;
}

function SlotMount({ slot }: { slot: UiSlotId }): ReactNode {
  const contributions = resolveSlotHost({
    registry: emptySlotRegistry,
    slot,
    client: "web"
  });

  if (contributions.length === 0) {
    return <div className="slotHost" data-ui-slot={slot} />;
  }

  return (
    <div className="slotHost" data-ui-slot={slot}>
      {contributions.map((contribution) => (
        <div
          key={contribution.id}
          data-component-ref={contribution.componentRef}
        />
      ))}
    </div>
  );
}

function formatDateTime(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
