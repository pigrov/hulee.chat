import { createTranslator } from "@hulee/i18n";
import {
  CheckCircle2,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Route,
  Save,
  Send,
  ShieldCheck,
  UserRound
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  createSqlEmployeeDirectoryRepository,
  createSqlOrgStructureRepository,
  type TenantEmployeeRecord,
  type WorkQueueRecord
} from "@hulee/db";

import {
  sendReplyAction,
  updateConversationRoutingAction
} from "../src/actions";
import { resendEmailVerificationAction } from "../src/auth-actions";
import { AccessDeniedPage } from "../src/access-denied";
import {
  canTenantPermission,
  isTenantEmailVerificationRequired,
  navigationAccessFromSession
} from "../src/access";
import { AppFrame, DetailItem, SlotMount } from "../src/app-chrome";
import { formatDateTime } from "../src/formatting";
import { getWebDatabase, resolveCurrentWebAccessSession } from "../src/session";
import {
  loadInboxViewModel,
  type InboxConversation,
  type InboxMessage
} from "../src/inbox-api-client";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function InboxPage({
  searchParams
}: {
  searchParams?: Promise<{
    conversationId?: string;
    emailVerification?: string;
  }>;
}): Promise<ReactNode> {
  const access = await resolveCurrentWebAccessSession();

  if (access === null) {
    redirect("/login");
  }

  if (!canTenantPermission(access, "inbox.read")) {
    return (
      <AccessDeniedPage
        current="inbox"
        navigationAccess={navigationAccessFromSession(access)}
      />
    );
  }

  const resolvedSearchParams = await searchParams;
  const canAssignConversations = canTenantPermission(
    access,
    "conversation.assign"
  );
  const employeeRepository =
    createSqlEmployeeDirectoryRepository(getWebDatabase());
  const orgStructureRepository =
    createSqlOrgStructureRepository(getWebDatabase());
  const [model, employees, workQueues] = await Promise.all([
    loadInboxViewModel({
      selectedConversationId: resolvedSearchParams?.conversationId
    }),
    canAssignConversations
      ? employeeRepository.listEmployees({ tenantId: access.tenantId })
      : Promise.resolve<readonly TenantEmployeeRecord[]>([]),
    canAssignConversations
      ? orgStructureRepository.listWorkQueues({
          tenantId: access.tenantId,
          activeOnly: true
        })
      : Promise.resolve<readonly WorkQueueRecord[]>([])
  ]);
  const { t, locale } = createTranslator(model.tenant.locale);
  const selectedConversation = model.selectedConversation;
  const currentInboxPath = selectedConversation
    ? `/?conversationId=${encodeURIComponent(selectedConversation.id)}`
    : "/";
  const emailVerificationNotice = resolveEmailVerificationNotice(
    resolvedSearchParams?.emailVerification
  );
  const isTenantWriteBlocked = isTenantEmailVerificationRequired(access);
  const shouldShowEmailVerificationBanner =
    emailVerificationNotice === undefined && isTenantWriteBlocked;
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
              {emailVerificationNotice ? (
                <p
                  className={
                    emailVerificationNotice === "sent"
                      ? "formNotice"
                      : "formError"
                  }
                >
                  {t(
                    `auth.emailVerification.status.${emailVerificationNotice}`
                  )}
                </p>
              ) : null}
              {shouldShowEmailVerificationBanner ? (
                <form
                  className="inlineNoticeForm"
                  action={resendEmailVerificationAction}
                >
                  <input
                    name="returnTo"
                    type="hidden"
                    value={currentInboxPath}
                  />
                  <p className="formNotice">
                    {t("auth.emailVerification.status.pending")}
                  </p>
                  <button className="secondaryButton" type="submit">
                    {t("auth.emailVerification.resend")}
                  </button>
                </form>
              ) : null}
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
              disabled={isTenantWriteBlocked}
              aria-label={t("inbox.channels")}
            >
              <Paperclip size={17} aria-hidden="true" />
            </button>
            <textarea
              className="composerTextarea"
              name="text"
              rows={1}
              placeholder={t("inbox.replyPlaceholder")}
              disabled={isTenantWriteBlocked}
              required
            />
            <button
              className="sendButton"
              type="submit"
              disabled={isTenantWriteBlocked}
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
        {selectedConversation && canAssignConversations ? (
          <ConversationRoutingPanel
            currentEmployeeId={access.employeeId}
            employees={employees}
            selectedConversation={selectedConversation}
            t={t}
            workQueues={workQueues}
          />
        ) : null}
        <SlotMount slot="client.profile.card" />
      </aside>
    </AppFrame>
  );
}

function ConversationRoutingPanel({
  currentEmployeeId,
  employees,
  selectedConversation,
  t,
  workQueues
}: {
  readonly currentEmployeeId: TenantEmployeeRecord["employeeId"];
  readonly employees: readonly TenantEmployeeRecord[];
  readonly selectedConversation: InboxConversation;
  readonly t: ReturnType<typeof createTranslator>["t"];
  readonly workQueues: readonly WorkQueueRecord[];
}): ReactNode {
  const activeEmployees = employees.filter(
    (employee) => employee.deactivatedAt === null
  );
  const assignedEmployeeOption = activeEmployees.some(
    (employee) =>
      employee.employeeId === selectedConversation.assignedEmployeeId
  )
    ? undefined
    : selectedConversation.assignedEmployeeId;
  const currentQueue = workQueues.find(
    (workQueue) => workQueue.id === selectedConversation.currentQueueId
  );
  const assignedEmployee = activeEmployees.find(
    (employee) =>
      employee.employeeId === selectedConversation.assignedEmployeeId
  );
  const currentEmployeeIsAssignable = activeEmployees.some(
    (employee) => employee.employeeId === currentEmployeeId
  );
  const isAssignedToCurrentEmployee =
    selectedConversation.assignedEmployeeId === currentEmployeeId;
  const hasAssignee =
    selectedConversation.assignedEmployeeId !== undefined ||
    selectedConversation.assignedTeamId !== undefined;

  return (
    <section className="clientSection" aria-labelledby="routing-title">
      <div className="sectionHeader compactSectionHeader">
        <div>
          <p className="eyebrow">{t("inbox.routing.eyebrow")}</p>
          <h2 className="sectionTitle" id="routing-title">
            {t("inbox.routing.title")}
          </h2>
          <p className="metaText">{t("inbox.routing.description")}</p>
        </div>
        <span className="badge">
          <Route size={14} aria-hidden="true" />
          {t("inbox.routing.current")}
        </span>
      </div>

      <div className="detailGrid routingCurrentGrid">
        <DetailItem
          label={t("inbox.routing.queue")}
          value={currentQueue?.name ?? t("inbox.routing.noQueue")}
        />
        <DetailItem
          label={t("inbox.routing.assignee")}
          value={
            assignedEmployee?.displayName ??
            selectedConversation.assignedEmployeeId ??
            t("inbox.routing.noAssignee")
          }
        />
      </div>

      <div className="buttonRow routingQuickActions">
        <form className="inlineForm" action={updateConversationRoutingAction}>
          <input
            name="conversationId"
            type="hidden"
            value={selectedConversation.id}
          />
          <input
            name="assignedEmployeeId"
            type="hidden"
            value={currentEmployeeId}
          />
          <input name="assignedTeamId" type="hidden" value="" />
          <button
            className="secondaryButton"
            disabled={
              !currentEmployeeIsAssignable || isAssignedToCurrentEmployee
            }
            type="submit"
          >
            <CheckCircle2 size={14} aria-hidden="true" />
            {t("inbox.routing.assignToMe")}
          </button>
        </form>
        <form className="inlineForm" action={updateConversationRoutingAction}>
          <input
            name="conversationId"
            type="hidden"
            value={selectedConversation.id}
          />
          <input name="assignedEmployeeId" type="hidden" value="" />
          <input name="assignedTeamId" type="hidden" value="" />
          <button
            className="secondaryButton"
            disabled={!hasAssignee}
            type="submit"
          >
            {t("inbox.routing.clearAssignee")}
          </button>
        </form>
      </div>

      <form
        className="settingsForm routingForm"
        action={updateConversationRoutingAction}
      >
        <input
          name="conversationId"
          type="hidden"
          value={selectedConversation.id}
        />
        <input name="assignedTeamId" type="hidden" value="" />
        <label className="fieldStack">
          <span className="detailLabel">{t("inbox.routing.queue")}</span>
          <select
            className="selectInput"
            defaultValue={selectedConversation.currentQueueId ?? ""}
            name="currentQueueId"
          >
            <option value="">{t("inbox.routing.noQueue")}</option>
            {workQueues.map((workQueue) => (
              <option key={workQueue.id} value={workQueue.id}>
                {workQueue.name}
              </option>
            ))}
          </select>
        </label>
        <label className="fieldStack">
          <span className="detailLabel">{t("inbox.routing.assignee")}</span>
          <select
            className="selectInput"
            defaultValue={selectedConversation.assignedEmployeeId ?? ""}
            name="assignedEmployeeId"
          >
            <option value="">{t("inbox.routing.noAssignee")}</option>
            {assignedEmployeeOption ? (
              <option value={assignedEmployeeOption}>
                {assignedEmployeeOption}
              </option>
            ) : null}
            {activeEmployees.map((employee) => (
              <option key={employee.employeeId} value={employee.employeeId}>
                {employee.displayName}
              </option>
            ))}
          </select>
        </label>
        <button className="secondaryButton" type="submit">
          <Save size={14} aria-hidden="true" />
          {t("inbox.routing.save")}
        </button>
      </form>
    </section>
  );
}

function resolveEmailVerificationNotice(
  value: string | undefined
): "sent" | "not_configured" | "provider_failed" | "required" | undefined {
  if (
    value === "sent" ||
    value === "not_configured" ||
    value === "provider_failed" ||
    value === "required"
  ) {
    return value;
  }

  return undefined;
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
