import { createTranslator, type I18nMessageKey } from "@hulee/i18n";
import {
  CheckCircle2,
  ListFilter,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Route,
  Save,
  Send,
  ShieldCheck,
  UserRound,
  UsersRound
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  createSqlEmployeeDirectoryRepository,
  createSqlOrgStructureRepository,
  createSqlSecurityAuditRepository,
  createSqlTenantRbacRepository,
  type ConversationRoutingAuditRecord,
  type TenantEmployeeRecord,
  type TeamRecord,
  type WorkQueueRecord
} from "@hulee/db";
import {
  CoreError,
  resolveEffectivePermissionGrants,
  type EffectivePermissionGrant,
  type Permission,
  type PermissionActor
} from "@hulee/core";

import {
  sendReplyAction,
  updateConversationRoutingAction
} from "../src/actions";
import { resendEmailVerificationAction } from "../src/auth-actions";
import { AccessDeniedPage } from "../src/access-denied";
import {
  isTenantEmailVerificationRequired,
  type WebAccessSession
} from "../src/access";
import { AppFrame, DetailItem, SlotMount } from "../src/app-chrome";
import {
  buildConversationRoutingOptions,
  permissionActorFromTenantEmployee,
  type ConversationRoutingOptions
} from "../src/conversation-routing-options";
import { canReplyToConversation } from "../src/conversation-reply-options";
import { formatDateTime } from "../src/formatting";
import type {
  InboxReplyActionStatus,
  InboxRoutingActionStatus
} from "../src/inbox-action-status";
import {
  buildReadableInboxQueueOptions,
  resolveReadableInboxQueueFilter
} from "../src/inbox-queue-options";
import { getWebDatabase, resolveCurrentWebAccessSession } from "../src/session";
import {
  loadInboxViewModel,
  type InboxConversation,
  type InboxMessage
} from "../src/inbox-api-client";
import { navigationAccessFromTenantAdminAccess } from "../src/tenant-admin-nav";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function InboxPage({
  searchParams
}: {
  searchParams?: Promise<{
    conversationId?: string;
    emailVerification?: string;
    queueId?: string;
    assigned?: string;
    replyStatus?: string;
    routingStatus?: string;
  }>;
}): Promise<ReactNode> {
  const access = await resolveCurrentWebAccessSession();

  if (access === null) {
    redirect("/login");
  }

  const resolvedSearchParams = await searchParams;
  const employeeRepository =
    createSqlEmployeeDirectoryRepository(getWebDatabase());
  const orgStructureRepository =
    createSqlOrgStructureRepository(getWebDatabase());
  const requestedQueueId = normalizeInboxQueueFilter(
    resolvedSearchParams?.queueId
  );
  const assignedToMe = isAssignedToMeInboxFilter(
    resolvedSearchParams?.assigned
  );
  const [currentEmployee, teams, workQueues] = await Promise.all([
    employeeRepository.findEmployee({
      tenantId: access.tenantId,
      employeeId: access.employeeId
    }),
    orgStructureRepository.listTeams({
      tenantId: access.tenantId
    }),
    orgStructureRepository.listWorkQueues({
      tenantId: access.tenantId,
      activeOnly: true
    })
  ]);
  const accessSnapshot = await resolveWebAccessSnapshot({
    currentEmployee
  });

  if (!hasEffectivePermission(accessSnapshot, "inbox.read")) {
    return (
      <AccessDeniedPage
        current="inbox"
        navigationAccess={navigationAccessFromTenantAdminAccess({
          session: access,
          effectiveAccess: accessSnapshot
        })}
      />
    );
  }

  const readableWorkQueues =
    accessSnapshot === undefined
      ? []
      : buildReadableInboxQueueOptions({
          actor: accessSnapshot.actor,
          effectiveGrants: accessSnapshot.effectiveGrants,
          workQueues
        });
  const activeQueueId = resolveReadableInboxQueueFilter({
    queueId: requestedQueueId,
    workQueues: readableWorkQueues
  });
  let model: Awaited<ReturnType<typeof loadInboxViewModel>>;

  try {
    model = await loadInboxViewModel({
      selectedConversationId: resolvedSearchParams?.conversationId,
      queueId: activeQueueId,
      assignedToMe
    });
  } catch (error) {
    if (error instanceof CoreError && error.code === "permission.denied") {
      return (
        <AccessDeniedPage
          current="inbox"
          navigationAccess={navigationAccessFromTenantAdminAccess({
            session: access,
            effectiveAccess: accessSnapshot
          })}
        />
      );
    }

    throw error;
  }

  const { t, locale } = createTranslator(model.tenant.locale);
  const selectedConversation = model.selectedConversation;
  const employees =
    selectedConversation !== undefined && accessSnapshot !== undefined
      ? await employeeRepository.listEmployees({ tenantId: access.tenantId })
      : [];
  const currentInboxPath = buildInboxHref({
    conversationId: selectedConversation?.id,
    queueId: activeQueueId,
    assignedToMe
  });
  const emailVerificationNotice = resolveEmailVerificationNotice(
    resolvedSearchParams?.emailVerification
  );
  const routingActionStatus = resolveRoutingActionStatus(
    resolvedSearchParams?.routingStatus
  );
  const replyActionStatus = resolveReplyActionStatus(
    resolvedSearchParams?.replyStatus
  );
  const isTenantWriteBlocked = isTenantEmailVerificationRequired(access);
  const shouldShowEmailVerificationBanner =
    emailVerificationNotice === undefined && isTenantWriteBlocked;
  const productName = t("app.name", {
    productName: model.tenant.brand.productName
  });
  const routingOptions =
    selectedConversation && accessSnapshot
      ? resolveConversationRoutingOptions({
          access,
          accessSnapshot,
          employees,
          selectedConversation,
          teams,
          workQueues
        })
      : undefined;
  const canReplyToSelectedConversation =
    selectedConversation !== undefined &&
    accessSnapshot !== undefined &&
    canReplyToConversation({
      tenantId: access.tenantId,
      actor: accessSnapshot.actor,
      effectiveGrants: accessSnapshot.effectiveGrants,
      conversation: selectedConversation
    });
  const routingAuditRecords =
    selectedConversation && routingOptions?.canRouteConversation
      ? await createSqlSecurityAuditRepository(
          getWebDatabase()
        ).listConversationRoutingRecords({
          tenantId: access.tenantId,
          conversationId: selectedConversation.id,
          limit: 3
        })
      : [];

  return (
    <AppFrame
      brand={model.tenant.brand}
      current="inbox"
      navigationAccess={navigationAccessFromTenantAdminAccess({
        session: access,
        effectiveAccess: accessSnapshot
      })}
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
              {routingActionStatus ? (
                <p
                  className={
                    routingActionStatus === "saved" ? "formNotice" : "formError"
                  }
                >
                  {t(routingActionStatusKey(routingActionStatus))}
                </p>
              ) : null}
              {replyActionStatus ? (
                <p
                  className={
                    replyActionStatus === "sent" ? "formNotice" : "formError"
                  }
                >
                  {t(replyActionStatusKey(replyActionStatus))}
                </p>
              ) : null}
            </div>
            <Link
              className="iconButton"
              href={buildInboxHref({
                queueId: activeQueueId,
                assignedToMe
              })}
              aria-label={t("inbox.refresh")}
            >
              <RefreshCw size={17} aria-hidden="true" />
            </Link>
          </div>
        </div>
        <InboxFilterBar
          activeQueueId={activeQueueId}
          assignedToMe={assignedToMe}
          t={t}
          workQueues={readableWorkQueues}
        />
        <div className="conversationList">
          {model.conversations.length === 0 ? (
            <div className="emptyState">{t("inbox.emptyConversations")}</div>
          ) : (
            model.conversations.map((conversation) => (
              <ConversationListItem
                key={conversation.id}
                conversation={conversation}
                current={conversation.id === selectedConversation?.id}
                queueId={activeQueueId}
                assignedToMe={assignedToMe}
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

        {selectedConversation && canReplyToSelectedConversation ? (
          <form className="composer" action={sendReplyAction}>
            <input
              type="hidden"
              name="conversationId"
              value={selectedConversation.id}
            />
            <input name="returnTo" type="hidden" value={currentInboxPath} />
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
        ) : selectedConversation ? (
          <div className="composer" aria-live="polite">
            <p className="formError composerNotice">
              {t("inbox.replyUnavailable")}
            </p>
          </div>
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
        {selectedConversation && routingOptions?.canRouteConversation ? (
          <ConversationRoutingPanel
            currentEmployeeId={access.employeeId}
            employees={employees}
            locale={locale}
            routingAuditRecords={routingAuditRecords}
            routingOptions={routingOptions}
            returnTo={currentInboxPath}
            selectedConversation={selectedConversation}
            teams={teams}
            t={t}
            workQueues={workQueues}
          />
        ) : null}
        <SlotMount slot="client.profile.card" />
      </aside>
    </AppFrame>
  );
}

function InboxFilterBar({
  activeQueueId,
  assignedToMe,
  t,
  workQueues
}: {
  readonly activeQueueId?: string;
  readonly assignedToMe: boolean;
  readonly t: ReturnType<typeof createTranslator>["t"];
  readonly workQueues: readonly WorkQueueRecord[];
}): ReactNode {
  const hasActiveFilter = activeQueueId !== undefined || assignedToMe;

  return (
    <form className="inboxFilterBar" action="/" method="get">
      <select
        className="selectInput compactSelectInput"
        name="queueId"
        defaultValue={activeQueueId ?? ""}
        aria-label={t("inbox.routing.queue")}
      >
        <option value="">{t("inbox.filters.allQueues")}</option>
        {workQueues.map((queue) => (
          <option key={queue.id} value={queue.id}>
            {queue.name}
          </option>
        ))}
      </select>
      <label className="toggleRow compactToggleRow">
        <input
          type="checkbox"
          name="assigned"
          value="me"
          defaultChecked={assignedToMe}
        />
        {t("inbox.filters.assignedToMe")}
      </label>
      <button className="secondaryButton compactButton" type="submit">
        <ListFilter size={14} aria-hidden="true" />
        {t("inbox.filters.apply")}
      </button>
      {hasActiveFilter ? (
        <Link className="secondaryButton compactButton" href="/">
          {t("inbox.filters.clear")}
        </Link>
      ) : null}
    </form>
  );
}

type WebAccessSnapshot = {
  readonly actor: PermissionActor;
  readonly effectiveGrants: readonly EffectivePermissionGrant[];
};

function hasEffectivePermission(
  accessSnapshot: WebAccessSnapshot | undefined,
  permission: Permission
): boolean {
  return (
    accessSnapshot?.effectiveGrants.some(
      (grant) => grant.permission === permission
    ) ?? false
  );
}

async function resolveWebAccessSnapshot(input: {
  readonly currentEmployee: TenantEmployeeRecord | null;
}): Promise<WebAccessSnapshot | undefined> {
  if (
    input.currentEmployee === null ||
    input.currentEmployee.deactivatedAt !== null
  ) {
    return undefined;
  }

  const actor = permissionActorFromTenantEmployee(input.currentEmployee);
  const now = new Date();
  const sources = await createSqlTenantRbacRepository(
    getWebDatabase()
  ).listEffectiveAccessSources({
    actor,
    at: now
  });

  return {
    actor,
    effectiveGrants: resolveEffectivePermissionGrants({
      actor,
      roles: sources.roles,
      roleBindings: sources.roleBindings,
      directGrants: sources.directGrants,
      at: now
    })
  };
}

function resolveConversationRoutingOptions(input: {
  readonly access: WebAccessSession;
  readonly accessSnapshot: WebAccessSnapshot;
  readonly employees: readonly TenantEmployeeRecord[];
  readonly selectedConversation: InboxConversation;
  readonly teams: readonly TeamRecord[];
  readonly workQueues: readonly WorkQueueRecord[];
}): ConversationRoutingOptions {
  return buildConversationRoutingOptions({
    tenantId: input.access.tenantId,
    actor: input.accessSnapshot.actor,
    conversation: input.selectedConversation,
    effectiveGrants: input.accessSnapshot.effectiveGrants,
    employees: input.employees,
    teams: input.teams,
    workQueues: input.workQueues
  });
}

function ConversationRoutingPanel({
  currentEmployeeId,
  employees,
  locale,
  routingAuditRecords,
  routingOptions,
  returnTo,
  selectedConversation,
  teams,
  t,
  workQueues
}: {
  readonly currentEmployeeId: TenantEmployeeRecord["employeeId"];
  readonly employees: readonly TenantEmployeeRecord[];
  readonly locale: string;
  readonly routingAuditRecords: readonly ConversationRoutingAuditRecord[];
  readonly routingOptions: ConversationRoutingOptions;
  readonly returnTo: string;
  readonly selectedConversation: InboxConversation;
  readonly teams: readonly TeamRecord[];
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
  const assignedTeamOption = teams.some(
    (team) => team.id === selectedConversation.assignedTeamId
  )
    ? undefined
    : selectedConversation.assignedTeamId;
  const currentQueueOption = workQueues.some(
    (workQueue) => workQueue.id === selectedConversation.currentQueueId
  )
    ? undefined
    : selectedConversation.currentQueueId;
  const currentQueue = workQueues.find(
    (workQueue) => workQueue.id === selectedConversation.currentQueueId
  );
  const assignedEmployee = activeEmployees.find(
    (employee) =>
      employee.employeeId === selectedConversation.assignedEmployeeId
  );
  const assignedTeam = teams.find(
    (team) => team.id === selectedConversation.assignedTeamId
  );
  const currentEmployeeIsAssignable = activeEmployees.some(
    (employee) => employee.employeeId === currentEmployeeId
  );
  const isAssignedToCurrentEmployee =
    selectedConversation.assignedEmployeeId === currentEmployeeId;
  const hasAssignee =
    selectedConversation.assignedEmployeeId !== undefined ||
    selectedConversation.assignedTeamId !== undefined;
  const assignableEmployees = routingOptions.employees;
  const assignableTeams = routingOptions.teams;
  const assignableWorkQueues = routingOptions.workQueues;

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
        <DetailItem
          label={t("inbox.routing.team")}
          value={
            assignedTeam?.name ??
            selectedConversation.assignedTeamId ??
            t("inbox.routing.noTeam")
          }
        />
      </div>

      <div className="routingAuditBlock" aria-labelledby="routing-audit-title">
        <div className="sectionHeader compactSectionHeader">
          <h3 className="sectionTitle" id="routing-audit-title">
            {t("inbox.routing.audit.title")}
          </h3>
          <span className="badge">{routingAuditRecords.length}</span>
        </div>
        {routingAuditRecords.length === 0 ? (
          <p className="metaText">{t("inbox.routing.audit.empty")}</p>
        ) : (
          <div className="routingAuditList">
            {routingAuditRecords.map((record) => (
              <div className="routingAuditItem" key={record.id}>
                <div className="routingAuditHeader">
                  <time className="detailValue" dateTime={record.occurredAt}>
                    {formatDateTime(record.occurredAt, locale)}
                  </time>
                  <span className="detailLabel">
                    {t("inbox.routing.audit.changedBy", {
                      actor: formatRoutingAuditActor(
                        record.actorEmployeeId,
                        activeEmployees,
                        t
                      )
                    })}
                  </span>
                </div>
                <div className="detailGrid routingAuditGrid">
                  <DetailItem
                    label={t("inbox.routing.queue")}
                    value={formatRoutingAuditTransition({
                      metadata: record.metadata,
                      previousKey: "previousCurrentQueueId",
                      nextKey: "currentQueueId",
                      emptyLabel: t("inbox.routing.noQueue"),
                      resolveLabel: (queueId) =>
                        formatRoutingQueueLabel(queueId, workQueues)
                    })}
                  />
                  <DetailItem
                    label={t("inbox.routing.assignee")}
                    value={formatRoutingAuditTransition({
                      metadata: record.metadata,
                      previousKey: "previousAssignedEmployeeId",
                      nextKey: "assignedEmployeeId",
                      emptyLabel: t("inbox.routing.noAssignee"),
                      resolveLabel: (employeeId) =>
                        formatRoutingEmployeeLabel(employeeId, activeEmployees)
                    })}
                  />
                  <DetailItem
                    label={t("inbox.routing.team")}
                    value={formatRoutingAuditTransition({
                      metadata: record.metadata,
                      previousKey: "previousAssignedTeamId",
                      nextKey: "assignedTeamId",
                      emptyLabel: t("inbox.routing.noTeam"),
                      resolveLabel: (teamId) =>
                        formatRoutingTeamLabel(teamId, teams)
                    })}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="buttonRow routingQuickActions">
        <form className="inlineForm" action={updateConversationRoutingAction}>
          <input
            name="conversationId"
            type="hidden"
            value={selectedConversation.id}
          />
          <input name="returnTo" type="hidden" value={returnTo} />
          <input
            name="assignedEmployeeId"
            type="hidden"
            value={currentEmployeeId}
          />
          <input name="assignedTeamId" type="hidden" value="" />
          <button
            className="secondaryButton"
            disabled={
              !currentEmployeeIsAssignable ||
              !routingOptions.canAssignToCurrentEmployee ||
              isAssignedToCurrentEmployee
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
          <input name="returnTo" type="hidden" value={returnTo} />
          <input name="assignedEmployeeId" type="hidden" value="" />
          <input name="assignedTeamId" type="hidden" value="" />
          <button
            className="secondaryButton"
            disabled={!hasAssignee || !routingOptions.canClearAssignment}
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
        <input name="returnTo" type="hidden" value={returnTo} />
        <label className="fieldStack">
          <span className="detailLabel">{t("inbox.routing.queue")}</span>
          <select
            className="selectInput"
            defaultValue={selectedConversation.currentQueueId ?? ""}
            name="currentQueueId"
          >
            <option value="" disabled={!routingOptions.canClearQueue}>
              {t("inbox.routing.noQueue")}
            </option>
            {currentQueueOption ? (
              <option value={currentQueueOption}>{currentQueueOption}</option>
            ) : null}
            {assignableWorkQueues.map((workQueue) => (
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
            <option value="" disabled={!routingOptions.canClearAssignee}>
              {t("inbox.routing.noAssignee")}
            </option>
            {assignedEmployeeOption ? (
              <option value={assignedEmployeeOption}>
                {assignedEmployeeOption}
              </option>
            ) : null}
            {assignableEmployees.map((employee) => (
              <option key={employee.employeeId} value={employee.employeeId}>
                {employee.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="fieldStack">
          <span className="detailLabel">{t("inbox.routing.team")}</span>
          <select
            className="selectInput"
            defaultValue={selectedConversation.assignedTeamId ?? ""}
            name="assignedTeamId"
          >
            <option value="" disabled={!routingOptions.canClearTeam}>
              {t("inbox.routing.noTeam")}
            </option>
            {assignedTeamOption ? (
              <option value={assignedTeamOption}>{assignedTeamOption}</option>
            ) : null}
            {assignableTeams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
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

function formatRoutingAuditActor(
  actorEmployeeId: string | undefined,
  employees: readonly TenantEmployeeRecord[],
  t: ReturnType<typeof createTranslator>["t"]
): string {
  if (actorEmployeeId === undefined) {
    return t("common.unknown");
  }

  return formatRoutingEmployeeLabel(actorEmployeeId, employees);
}

function formatRoutingAuditTransition(input: {
  readonly metadata: Record<string, unknown>;
  readonly previousKey: string;
  readonly nextKey: string;
  readonly emptyLabel: string;
  readonly resolveLabel: (id: string) => string;
}): string {
  const previousValue = metadataString(input.metadata[input.previousKey]);
  const nextValue = metadataString(input.metadata[input.nextKey]);

  return `${previousValue ? input.resolveLabel(previousValue) : input.emptyLabel} -> ${
    nextValue ? input.resolveLabel(nextValue) : input.emptyLabel
  }`;
}

function formatRoutingQueueLabel(
  queueId: string,
  workQueues: readonly WorkQueueRecord[]
): string {
  return (
    workQueues.find((workQueue) => workQueue.id === queueId)?.name ?? queueId
  );
}

function formatRoutingEmployeeLabel(
  employeeId: string,
  employees: readonly TenantEmployeeRecord[]
): string {
  return (
    employees.find((employee) => employee.employeeId === employeeId)
      ?.displayName ?? employeeId
  );
}

function formatRoutingTeamLabel(
  teamId: string,
  teams: readonly TeamRecord[]
): string {
  return teams.find((team) => team.id === teamId)?.name ?? teamId;
}

function metadataString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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

function resolveRoutingActionStatus(
  value: string | undefined
): InboxRoutingActionStatus | undefined {
  if (
    value === "saved" ||
    value === "invalid" ||
    value === "permission_denied"
  ) {
    return value;
  }

  return undefined;
}

function resolveReplyActionStatus(
  value: string | undefined
): InboxReplyActionStatus | undefined {
  if (
    value === "sent" ||
    value === "invalid" ||
    value === "permission_denied"
  ) {
    return value;
  }

  return undefined;
}

function routingActionStatusKey(
  status: InboxRoutingActionStatus
): I18nMessageKey {
  switch (status) {
    case "saved":
      return "inbox.routing.status.saved";
    case "permission_denied":
      return "inbox.routing.status.permissionDenied";
    default:
      return "inbox.routing.status.invalid";
  }
}

function replyActionStatusKey(status: InboxReplyActionStatus): I18nMessageKey {
  switch (status) {
    case "sent":
      return "inbox.reply.status.sent";
    case "permission_denied":
      return "inbox.reply.status.permissionDenied";
    default:
      return "inbox.reply.status.invalid";
  }
}

function normalizeInboxQueueFilter(
  value: string | undefined
): string | undefined {
  const trimmedValue = value?.trim();

  return trimmedValue === undefined || trimmedValue === ""
    ? undefined
    : trimmedValue;
}

function isAssignedToMeInboxFilter(value: string | undefined): boolean {
  return value === "me";
}

function buildInboxHref(input: {
  readonly conversationId?: string;
  readonly queueId?: string;
  readonly assignedToMe?: boolean;
}): string {
  const searchParams = new URLSearchParams();

  if (input.conversationId) {
    searchParams.set("conversationId", input.conversationId);
  }

  if (input.queueId) {
    searchParams.set("queueId", input.queueId);
  }

  if (input.assignedToMe === true) {
    searchParams.set("assigned", "me");
  }

  const queryString = searchParams.toString();

  return queryString === "" ? "/" : `/?${queryString}`;
}

function ConversationListItem({
  conversation,
  current,
  queueId,
  assignedToMe,
  locale,
  t
}: {
  conversation: InboxConversation;
  current: boolean;
  queueId?: string;
  assignedToMe: boolean;
  locale: string;
  t: ReturnType<typeof createTranslator>["t"];
}): ReactNode {
  const queueLabel =
    conversation.currentQueueName ?? conversation.currentQueueId;
  const assigneeLabel =
    conversation.assignedEmployeeDisplayName ?? conversation.assignedEmployeeId;
  const assignedTeamLabel =
    conversation.assignedTeamName ?? conversation.assignedTeamId;

  return (
    <Link
      className="conversationLink"
      href={buildInboxHref({
        conversationId: conversation.id,
        queueId,
        assignedToMe
      })}
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
        {queueLabel ? (
          <span className="badge">
            <Route size={13} aria-hidden="true" />
            {queueLabel}
          </span>
        ) : null}
        {assigneeLabel ? (
          <span className="badge">
            <UserRound size={13} aria-hidden="true" />
            {assigneeLabel}
          </span>
        ) : null}
        {assignedTeamLabel ? (
          <span className="badge">
            <UsersRound size={13} aria-hidden="true" />
            {assignedTeamLabel}
          </span>
        ) : null}
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
