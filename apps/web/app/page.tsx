import { createTranslator } from "@hulee/i18n";
import {
  MessageSquare,
  Paperclip,
  RefreshCw,
  Send,
  ShieldCheck,
  UserRound
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { sendReplyAction } from "../src/actions";
import { AccessDeniedPage } from "../src/access-denied";
import {
  canTenantPermission,
  navigationAccessFromSession,
  resolveWebAccessSession
} from "../src/access";
import { AppFrame, DetailItem, SlotMount } from "../src/app-chrome";
import { formatDateTime } from "../src/formatting";
import {
  loadInboxViewModel,
  type InboxConversation,
  type InboxMessage
} from "../src/inbox-api-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function InboxPage({
  searchParams
}: {
  searchParams?: Promise<{ conversationId?: string }>;
}): Promise<ReactNode> {
  const access = resolveWebAccessSession();

  if (!canTenantPermission(access, "inbox.read")) {
    return (
      <AccessDeniedPage
        current="inbox"
        navigationAccess={navigationAccessFromSession(access)}
      />
    );
  }

  const resolvedSearchParams = await searchParams;
  const model = await loadInboxViewModel({
    selectedConversationId: resolvedSearchParams?.conversationId
  });
  const { t, locale } = createTranslator(model.tenant.locale);
  const selectedConversation = model.selectedConversation;
  const productName = t("app.name", {
    productName: model.tenant.brand.productName
  });

  return (
    <AppFrame
      brand={model.tenant.brand}
      current="inbox"
      navigationAccess={navigationAccessFromSession(access)}
      t={t}
    >
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
      </aside>
    </AppFrame>
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
