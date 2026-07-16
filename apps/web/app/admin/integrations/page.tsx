import { createTranslator } from "@hulee/i18n";
import type { I18nMessageKey } from "@hulee/i18n";
import {
  createSqlEmployeeDirectoryRepository,
  createSqlTenantRbacRepository
} from "@hulee/db";
import type {
  InternalChannelAuthChallenge,
  InternalChannelCatalogItem,
  InternalChannelConnectorSummary,
  InternalSourceCatalogCategory,
  InternalSourceCatalogItem,
  InternalSourceConnectionSummary
} from "@hulee/contracts";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Building2,
  Clock3,
  Code2,
  FileText,
  Mail,
  MessageCircle,
  PhoneCall,
  ShoppingBag,
  Star,
  Users
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDeniedPage } from "../../../src/access-denied";
import { SlotMount } from "../../../src/app-chrome";
import { loadTenantAdminViewModel } from "../../../src/admin-view-model";
import { ChannelConnectorCreateForm } from "../../../src/channel-connector-create-form";
import { ChannelConnectorLifecycleActions } from "../../../src/channel-connector-lifecycle-actions";
import { ChannelConnectorSettingsForm } from "../../../src/channel-connector-settings-form";
import { ChannelAuthChallengePanel } from "../../../src/channel-auth-challenge-panel";
import {
  ChannelIcon,
  resolveChannelDescription,
  resolveChannelShortDescription,
  resolveChannelTitle
} from "../../../src/channel-display";
import {
  loadChannelCatalog,
  loadChannelAuthChallenge,
  loadChannelConnectors,
  loadSourceCatalog,
  loadSourceConnections,
  loadTelegramIntegration,
  type TelegramIntegrationViewModel
} from "../../../src/inbox-api-client";
import {
  getWebDatabase,
  resolveCurrentWebAccessSession
} from "../../../src/session";
import { MarkdownContent } from "../../../src/markdown";
import { formatOptionalDateTime } from "../../../src/formatting";
import {
  hasEffectivePermission,
  resolveEmployeeEffectiveAccess
} from "../../../src/rbac-effective-access";
import { LocalDateTime } from "../../../src/local-date-time";
import { TelegramBotCatalogConnectForm } from "../../../src/telegram-bot-catalog-connect-form";
import { TelegramIntegrationPanel } from "../../../src/telegram-integration-panel";
import { TenantAdminShell } from "../../../src/tenant-admin-shell";
import { navigationAccessFromTenantAdminAccess } from "../../../src/tenant-admin-nav";
import { SourceConnectionCreateForm } from "../../../src/source-connection-create-form";
import { createSourceConnectionClientMutationId } from "../../../src/source-connection-client-mutation-id.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function IntegrationsAdminPage({
  searchParams
}: {
  searchParams?: Promise<{
    challengeId?: string;
    connectorId?: string;
    channelType?: string;
    connectionPendingAt?: string;
    sourceConnectionId?: string;
    sourceName?: string;
  }>;
}): Promise<ReactNode> {
  const access = await resolveCurrentWebAccessSession();

  if (access === null) {
    redirect("/login");
  }

  const database = getWebDatabase();
  const employeeRepository = createSqlEmployeeDirectoryRepository(database);
  const rbacRepository = createSqlTenantRbacRepository(database);
  const accessSnapshot = await resolveEmployeeEffectiveAccess({
    tenantId: access.tenantId,
    employeeId: access.employeeId,
    employeeRepository,
    rbacRepository
  });

  if (!hasEffectivePermission(accessSnapshot, "modules.manage")) {
    const adminAccess = {
      session: access,
      effectiveAccess: accessSnapshot
    };

    return (
      <AccessDeniedPage
        current="tenant-admin"
        navigationAccess={navigationAccessFromTenantAdminAccess(adminAccess)}
      />
    );
  }

  const internalApiAccess = {
    effectivePermissionOverride: "modules.manage" as const
  };
  const resolvedSearchParams = await searchParams;
  const requestedConnectorId = normalizeOptionalSearchParam(
    resolvedSearchParams?.connectorId
  );
  const requestedChannelType = normalizeOptionalSearchParam(
    resolvedSearchParams?.channelType
  );
  const requestedSourceName = normalizeOptionalSearchParam(
    resolvedSearchParams?.sourceName
  );
  const requestedSourceConnectionId = normalizeOptionalSearchParam(
    resolvedSearchParams?.sourceConnectionId
  );
  const connectionPendingAt = normalizeOptionalSearchParam(
    resolvedSearchParams?.connectionPendingAt
  );
  const requestedChallengeId = normalizeOptionalSearchParam(
    resolvedSearchParams?.challengeId
  );
  const [
    model,
    channelCatalog,
    sourceCatalog,
    sourceConnections,
    channelConnectors
  ] = await Promise.all([
    loadTenantAdminViewModel({ tenantId: access.tenantId, database }),
    loadChannelCatalog(internalApiAccess),
    loadSourceCatalog(internalApiAccess),
    loadSourceConnections(internalApiAccess),
    loadChannelConnectors(internalApiAccess)
  ]);
  const { t, locale } = createTranslator(model.tenant.locale);
  const selectedConnector =
    selectChannelConnector({
      connectors: channelConnectors.connectors,
      requestedConnectorId
    }) ??
    selectChannelConnectorBySourceConnectionId({
      connectors: channelConnectors.connectors,
      requestedSourceConnectionId
    });
  const connectorSourceConnectionIds = new Set(
    channelConnectors.connectors.flatMap((connector) =>
      connector.sourceConnectionId ? [connector.sourceConnectionId] : []
    )
  );
  const sourceCatalogNames = new Set(
    sourceCatalog.sources.map((source) => source.sourceName)
  );
  const visibleSourceConnections = sourceConnections.connections.filter(
    (connection) =>
      sourceCatalogNames.has(connection.sourceName) &&
      !connectorSourceConnectionIds.has(connection.sourceConnectionId)
  );
  const sourceCatalogGroups = sourceCatalog.categories
    .map((category) => ({
      category,
      sources: sourceCatalog.sources.filter(
        (source) => source.category === category.category
      )
    }))
    .filter((group) => group.sources.length > 0);
  const selectedSourceConnection = requestedSourceConnectionId
    ? visibleSourceConnections.find(
        (connection) =>
          connection.sourceConnectionId === requestedSourceConnectionId
      )
    : undefined;
  const requestedSource = requestedSourceName
    ? sourceCatalog.sources.find(
        (source) => source.sourceName === requestedSourceName
      )
    : undefined;
  const selectedConnectorSource = selectedConnector
    ? findSourceForChannelType(
        sourceCatalog.sources,
        selectedConnector.channelType
      )
    : undefined;
  const requestedChannelSource = requestedChannelType
    ? findSourceForChannelType(sourceCatalog.sources, requestedChannelType)
    : undefined;
  const selectedSource = selectedSourceConnection
    ? sourceCatalog.sources.find(
        (source) => source.sourceName === selectedSourceConnection.sourceName
      )
    : (selectedConnectorSource ??
      requestedChannelSource ??
      requestedSource ??
      sourceCatalog.sources.find(
        (source) => source.readiness === "available"
      ) ??
      sourceCatalog.sources[0]);
  const selectedSourceName = selectedSource?.sourceName;
  const selectedSourceChannelTypes = new Set(
    selectedSource?.channelTypes ?? []
  );
  const selectedConnectorId = selectedConnector?.connectorId;
  const selectedSourceChannels = channelCatalog.channels.filter(
    (channel) =>
      channel.readiness === "available" &&
      selectedSourceChannelTypes.has(channel.channelType)
  );
  const selectedCatalogChannel =
    selectedConnector === undefined && requestedChannelType
      ? selectedSourceChannels.find(
          (channel) => channel.channelType === requestedChannelType
        )
      : undefined;
  const selectedTelegramIntegration =
    selectedConnector?.channelType === "telegram_bot"
      ? await loadTelegramIntegration(internalApiAccess, {
          connectorId: selectedConnector.connectorId
        })
      : undefined;
  const integrationContent = selectedSourceConnection ? (
    <SourceConnectionDetailPanel
      connection={selectedSourceConnection}
      locale={locale}
      t={t}
    />
  ) : selectedConnector?.channelType === "telegram_bot" ? (
    <TelegramIntegrationPanel
      integration={
        selectedTelegramIntegration ?? createEmptyTelegramIntegrationViewModel()
      }
      initialConnectionSubmittedAt={
        selectedConnector.connectorId === requestedConnectorId
          ? connectionPendingAt
          : undefined
      }
      locale={locale}
      t={t}
    />
  ) : selectedConnector ? (
    <GenericChannelConnectorPanel
      catalog={channelCatalog.channels}
      challenge={
        selectedConnector.channelClass === "user_bridge" && requestedChallengeId
          ? await loadOptionalChannelAuthChallenge({
              challengeId: requestedChallengeId,
              connectorId: selectedConnector.connectorId,
              options: internalApiAccess
            })
          : undefined
      }
      connector={selectedConnector}
      locale={locale}
      sourceName={selectedSourceName}
      t={t}
    />
  ) : selectedCatalogChannel ? (
    <ChannelCatalogDetailPanel
      channel={selectedCatalogChannel}
      locale={locale}
      sourceName={selectedSourceName}
      t={t}
    />
  ) : selectedSource ? (
    <SourceCatalogDetailPanel
      clientMutationId={createSourceConnectionClientMutationId()}
      locale={locale}
      methods={selectedSourceChannels}
      source={selectedSource}
      t={t}
    />
  ) : (
    <NoSourceSelectedPanel t={t} />
  );

  return (
    <TenantAdminShell
      access={access}
      brand={model.tenant.brand}
      current="integrations"
      effectiveAccess={accessSnapshot}
      t={t}
      tenantDisplayName={model.tenant.displayName}
      title={t("admin.integrations")}
      titleId="admin-title"
    >
      <div className="adminIntegrationGrid">
        <aside
          className="settingsPanel integrationCatalog"
          aria-labelledby="integration-channel-list-title"
        >
          <div className="sectionHeader">
            <div>
              <h2 className="sectionTitle" id="integration-channel-list-title">
                {t("admin.integrations.sourceList")}
              </h2>
            </div>
          </div>

          <nav
            className="integrationList"
            aria-label={t("admin.integrations.sourceList")}
          >
            <SourceCatalogNavigation
              catalog={channelCatalog.channels}
              connectors={channelConnectors.connectors}
              connections={visibleSourceConnections}
              currentConnectorId={selectedConnectorId}
              currentSourceConnectionId={requestedSourceConnectionId}
              currentSourceName={selectedSourceName}
              groups={sourceCatalogGroups}
              locale={locale}
              t={t}
            />
          </nav>
        </aside>

        <div className="adminStack">
          {integrationContent}
          <SlotMount slot="integration.settings.section" />
        </div>
      </div>
    </TenantAdminShell>
  );
}

type Translator = ReturnType<typeof createTranslator>["t"];
function SourceCatalogNavigation({
  catalog,
  connectors,
  connections,
  currentConnectorId,
  currentSourceConnectionId,
  currentSourceName,
  groups,
  locale,
  t
}: {
  catalog: readonly InternalChannelCatalogItem[];
  connectors: readonly InternalChannelConnectorSummary[];
  connections: readonly InternalSourceConnectionSummary[];
  currentConnectorId?: string;
  currentSourceConnectionId?: string;
  currentSourceName?: string;
  groups: readonly {
    category: InternalSourceCatalogCategory;
    sources: readonly InternalSourceCatalogItem[];
  }[];
  locale: string;
  t: Translator;
}): ReactNode {
  const sources = groups.flatMap((group) => group.sources);
  const hasConnections = connections.length > 0 || connectors.length > 0;

  return (
    <>
      <div className="integrationListGroup">
        <h3 className="detailLabel">
          {t("admin.integrations.connectedIntegrations")}
        </h3>
        {hasConnections ? (
          <>
            {connectors.map((connector) => (
              <ConnectorListItem
                key={connector.connectorId}
                catalog={catalog}
                connector={connector}
                current={connector.connectorId === currentConnectorId}
                locale={locale}
                sourceName={
                  findSourceForChannelType(sources, connector.channelType)
                    ?.sourceName
                }
                t={t}
              />
            ))}
            {connections.map((connection) => (
              <SourceConnectionListItem
                key={connection.sourceConnectionId}
                connection={connection}
                current={
                  connection.sourceConnectionId === currentSourceConnectionId
                }
                t={t}
              />
            ))}
          </>
        ) : (
          <p className="metaText">
            {t("admin.integrations.noConnectedIntegrations")}
          </p>
        )}
      </div>
      {groups.map((group) => (
        <div className="integrationListGroup" key={group.category.category}>
          <h3 className="detailLabel">
            {t(group.category.titleKey as I18nMessageKey)}
          </h3>
          {group.sources.map((source) => (
            <SourceCatalogListItem
              key={source.sourceName}
              current={source.sourceName === currentSourceName}
              source={source}
              t={t}
            />
          ))}
        </div>
      ))}
    </>
  );
}

function findSourceForChannelType(
  sources: readonly InternalSourceCatalogItem[],
  channelType: string
): InternalSourceCatalogItem | undefined {
  return sources.find((source) => source.channelTypes?.includes(channelType));
}

function channelConnectorHref({
  connectorId,
  sourceName
}: {
  connectorId: string;
  sourceName?: string;
}): string {
  const params = new URLSearchParams({
    connectorId
  });

  if (sourceName) {
    params.set("sourceName", sourceName);
  }

  return `/admin/integrations?${params.toString()}`;
}

function channelCatalogHref({
  channelType,
  sourceName
}: {
  channelType: string;
  sourceName?: string;
}): string {
  const params = new URLSearchParams({
    channelType
  });

  if (sourceName) {
    params.set("sourceName", sourceName);
  }

  return `/admin/integrations?${params.toString()}`;
}

function SourceConnectionListItem({
  connection,
  current,
  t
}: {
  connection: InternalSourceConnectionSummary;
  current: boolean;
  t: Translator;
}): ReactNode {
  return (
    <Link
      className="integrationListItem integrationNavLink"
      href={`/admin/integrations?sourceConnectionId=${encodeURIComponent(
        connection.sourceConnectionId
      )}`}
      aria-current={current ? "page" : undefined}
    >
      <span className="metricIcon">
        <SourceIcon sourceType={connection.sourceType} />
      </span>
      <div className="integrationListText">
        <h3 className="listItemTitle" title={connection.displayName}>
          {connection.displayName}
        </h3>
        <p
          className="metaText integrationListType"
          title={connection.sourceName}
        >
          {connection.sourceName}
        </p>
      </div>
      <span className="integrationListBadges">
        <SourceConnectionStatusBadge status={connection.status} t={t} />
      </span>
    </Link>
  );
}

function SourceCatalogListItem({
  current,
  source,
  t
}: {
  current: boolean;
  source: InternalSourceCatalogItem;
  t: Translator;
}): ReactNode {
  const title = resolveSourceTitle(source, t);
  const description = resolveSourceShortDescription(source, t);

  return (
    <Link
      className="integrationListItem integrationNavLink"
      href={`/admin/integrations?sourceName=${encodeURIComponent(
        source.sourceName
      )}`}
      aria-current={current ? "page" : undefined}
    >
      <span className="metricIcon">
        <SourceIcon sourceType={source.sourceType} />
      </span>
      <div className="integrationListText">
        <h3 className="listItemTitle" title={title}>
          {title}
        </h3>
        <p className="metaText integrationListType" title={description}>
          {description}
        </p>
      </div>
      <span className="integrationListBadges">
        <SourceReadinessBadge readiness={source.readiness} t={t} />
      </span>
    </Link>
  );
}

function SourceCatalogDetailPanel({
  clientMutationId,
  locale,
  methods,
  source,
  t
}: {
  clientMutationId: string;
  locale: string;
  methods: readonly InternalChannelCatalogItem[];
  source: InternalSourceCatalogItem;
  t: Translator;
}): ReactNode {
  const title = resolveSourceTitle(source, t);
  const description = t(source.descriptionKey as I18nMessageKey);
  const canConnect = source.readiness === "available";

  return (
    <section className="settingsPanel" aria-labelledby="source-detail-title">
      <div className="sectionHeader">
        <div>
          <p className="eyebrow">{t("admin.integrations.sourceSettings")}</p>
          <h2 className="sectionTitle" id="source-detail-title">
            {title}
          </h2>
          <p className="metaText">{description}</p>
        </div>
        <SourceReadinessBadge readiness={source.readiness} t={t} />
      </div>

      {!canConnect ? (
        <p className="actionStateNotice" data-variant="info" role="status">
          {t("admin.integrations.sourceConnectionPlanned")}
        </p>
      ) : source.setupMode === "channel_connector" ? (
        <div className="integrationListGroup">
          <h3 className="detailLabel">
            {t("admin.integrations.connectionMethods")}
          </h3>
          {methods.length > 0 ? (
            methods.map((method) => (
              <CatalogListItem
                key={method.channelType}
                channel={method}
                current={false}
                locale={locale}
                sourceName={source.sourceName}
                t={t}
              />
            ))
          ) : (
            <p className="metaText">
              {t("admin.integrations.noConnectionMethods")}
            </p>
          )}
        </div>
      ) : source.setupMode === "source_connection" ? (
        <SourceConnectionCreateForm
          clientMutationId={clientMutationId}
          defaultDisplayName={title}
          label={t("admin.integrations.createSourceConnection")}
          messages={{
            created: t("admin.integrations.sourceActionStatus.created"),
            displayName: t("admin.integrations.sourceField.displayName"),
            email_verification_required: t(
              "auth.emailVerification.status.required"
            ),
            invalid: t("admin.integrations.actionStatus.invalid"),
            module_unhealthy: t(
              "admin.integrations.sourceActionStatus.moduleUnhealthy"
            ),
            permission_denied: t("admin.roles.actionStatus.permissionDenied"),
            webhookToken: t("admin.integrations.sourceField.webhookToken")
          }}
          sourceName={source.sourceName}
        />
      ) : (
        <p className="actionStateNotice" data-variant="info" role="status">
          {t("admin.integrations.sourceConnectionPlanned")}
        </p>
      )}
    </section>
  );
}

function SourceConnectionDetailPanel({
  connection,
  locale,
  t
}: {
  connection: InternalSourceConnectionSummary;
  locale: string;
  t: Translator;
}): ReactNode {
  return (
    <section
      className="settingsPanel"
      aria-labelledby="source-connection-title"
    >
      <div className="sectionHeader">
        <div>
          <p className="eyebrow">{t("admin.integrations.sourceSettings")}</p>
          <h2 className="sectionTitle" id="source-connection-title">
            {connection.displayName}
          </h2>
          <p className="metaText">{connection.sourceName}</p>
        </div>
        <SourceConnectionStatusBadge status={connection.status} t={t} />
      </div>

      <div className="detailGrid sourceCatalogDetailGrid">
        <SourceDetailItem
          label={t("admin.integrations.sourceField.sourceType")}
          value={connection.sourceType}
        />
        <SourceDetailItem
          label={t("admin.integrations.sourceField.authType")}
          value={t(sourceAuthTypeKey(connection.authType))}
        />
        <SourceDetailItem
          label={t("admin.integrations.sourceField.webhookPath")}
          value={connection.webhookPath ?? t("common.unknown")}
        />
        <SourceDetailItem
          label={t("admin.integrations.sourceField.webhookUrl")}
          value={connection.webhookUrl ?? t("common.unknown")}
        />
        <SourceDetailItem
          label={t("admin.integrations.sourceField.webhookSecretRef")}
          value={connection.webhookSecretRef ?? t("common.unknown")}
        />
        <SourceDetailItem
          label={t("admin.integrations.sourceField.updatedAt")}
          value={formatOptionalDateTime(connection.updatedAt, locale, t)}
        />
      </div>
    </section>
  );
}

function SourceDetailItem({
  label,
  value
}: {
  label: string;
  value: string;
}): ReactNode {
  return (
    <div className="detailItem">
      <span className="detailLabel">{label}</span>
      <strong className="detailValue">{value}</strong>
    </div>
  );
}

function NoSourceSelectedPanel({ t }: { t: Translator }): ReactNode {
  return (
    <section className="settingsPanel" aria-labelledby="source-empty-title">
      <div className="sectionHeader">
        <div>
          <p className="eyebrow">{t("admin.integrations.sourceSettings")}</p>
          <h2 className="sectionTitle" id="source-empty-title">
            {t("admin.integrations.selectSource")}
          </h2>
          <p className="metaText">
            {t("admin.integrations.selectSourceDescription")}
          </p>
        </div>
      </div>
    </section>
  );
}

function ChannelCatalogDetailPanel({
  channel,
  locale,
  sourceName,
  t
}: {
  channel: InternalChannelCatalogItem;
  locale: string;
  sourceName?: string;
  t: Translator;
}): ReactNode {
  const title = resolveChannelTitle({
    channel,
    locale,
    t,
    fallback: channel.channelType
  });
  const description = resolveChannelDescription({ channel, locale, t });

  return (
    <section className="settingsPanel" aria-label={title}>
      <MarkdownContent value={description} />

      {channel.channelType === "telegram_bot" ? (
        <TelegramBotCatalogConnectForm
          channelType="telegram_bot"
          labels={{
            botToken: t("integrations.telegram.botToken"),
            botTokenPlaceholder: t("integrations.telegram.botTokenPlaceholder"),
            connect: t("admin.integrations.connectChannel"),
            connecting: t("integrations.telegram.connectionConnecting"),
            invalidToken: t("integrations.telegram.invalidTokenFormat")
          }}
          messages={{
            duplicateLink: t("admin.integrations.telegramTokenDuplicateLink"),
            invalid: t("admin.integrations.actionStatus.invalid"),
            telegramTokenCheckUnavailable: t(
              "admin.integrations.telegramTokenCheckUnavailable"
            ),
            telegramTokenDuplicate: t(
              "admin.integrations.telegramTokenDuplicate"
            ),
            telegramTokenInvalid: t("admin.integrations.telegramTokenInvalid")
          }}
          sourceName={sourceName}
        />
      ) : (
        <ChannelConnectorCreateForm
          channelType={channel.channelType}
          label={t("admin.integrations.createChannel")}
          messages={{
            created: t("admin.integrations.actionStatus.created"),
            email_verification_required: t(
              "auth.emailVerification.status.required"
            ),
            invalid: t("admin.integrations.actionStatus.invalid"),
            permission_denied: t("admin.roles.actionStatus.permissionDenied")
          }}
          sourceName={sourceName}
        />
      )}
    </section>
  );
}

function GenericChannelConnectorPanel({
  catalog,
  challenge,
  connector,
  locale,
  sourceName,
  t
}: {
  catalog: readonly InternalChannelCatalogItem[];
  challenge?: InternalChannelAuthChallenge;
  connector: InternalChannelConnectorSummary;
  locale: string;
  sourceName?: string;
  t: Translator;
}): ReactNode {
  const channel = catalog.find(
    (item) => item.channelType === connector.channelType
  );
  const step = resolveGenericChannelStep({ channel, challenge, connector });
  const authStepKind = isAuthChallengeStep(step.kind) ? step.kind : undefined;
  const connectionState = genericChannelConnectionState(connector);
  const problemMessage = genericChannelProblemMessage(connector, t);
  const pendingDirectAuth =
    connector.channelClass === "user_bridge" &&
    connector.status !== "connected" &&
    connector.status !== "disabled" &&
    connector.status !== "deleted" &&
    authStepKind !== undefined;
  const pendingDirectQrAuth = pendingDirectAuth && authStepKind === "qr_code";
  const showAuthChallenge =
    connector.status !== "connected" &&
    connector.status !== "disabled" &&
    connector.status !== "deleted" &&
    authStepKind !== undefined;

  return (
    <section
      className="settingsPanel"
      aria-label={pendingDirectAuth ? connector.displayName : undefined}
      aria-labelledby={pendingDirectAuth ? undefined : "channel-detail-title"}
    >
      {pendingDirectAuth ? null : (
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">{t("admin.integrations.channelSettings")}</p>
            <h2 className="sectionTitle" id="channel-detail-title">
              {connector.displayName}
            </h2>
          </div>
          <GenericChannelConnectionBadge state={connectionState} t={t} />
        </div>
      )}

      {pendingDirectAuth ? null : (
        <ChannelConnectorSettingsForm
          connectorId={connector.connectorId}
          defaultDisplayName={connector.displayName}
          labels={{
            displayName: t("integrations.channel.displayName"),
            save: t("integrations.channel.saveSettings"),
            saving: t("integrations.channel.savingSettings")
          }}
          lifecycleActions={
            <GenericChannelLifecycleActions connector={connector} t={t} />
          }
          messages={{
            invalid: t("admin.integrations.actionStatus.invalid"),
            saved: t("admin.integrations.actionStatus.saved")
          }}
        />
      )}

      {!pendingDirectAuth && problemMessage ? (
        <p
          className="telegramConnectionNotice"
          data-variant="error"
          role="status"
        >
          {problemMessage}
        </p>
      ) : null}

      {pendingDirectAuth ? null : (
        <GenericChannelCompactStatus
          connector={connector}
          locale={locale}
          t={t}
        />
      )}

      {showAuthChallenge ? (
        <ChannelAuthChallengePanel
          autoStart={
            pendingDirectQrAuth &&
            challenge === undefined &&
            !hasAlternateDirectAccountAuth(connector.channelType)
          }
          cancelDeletesConnector={pendingDirectAuth}
          channelType={connector.channelType}
          challenge={challenge}
          challengeType={resolveChallengeType({
            challenge,
            stepKind: authStepKind
          })}
          connectorId={connector.connectorId}
          locale={locale}
          sourceName={sourceName}
          stepKind={authStepKind}
          t={t}
        />
      ) : null}
    </section>
  );
}

function hasAlternateDirectAccountAuth(channelType: string): boolean {
  return (
    channelType === "telegram_qr_bridge" || channelType === "whatsapp_qr_bridge"
  );
}

type GenericChannelConnectionState = "ok" | "error" | "new";

function GenericChannelConnectionBadge({
  state,
  t
}: {
  state: GenericChannelConnectionState;
  t: Translator;
}): ReactNode {
  return (
    <span className="telegramConnectionBadge" data-state={state}>
      {t(`integrations.channel.connectionBadge.${state}` as I18nMessageKey)}
    </span>
  );
}

function genericChannelConnectionState(
  connector: InternalChannelConnectorSummary
): GenericChannelConnectionState {
  if (connector.activeAuthChallenge) {
    return "new";
  }

  if (
    connector.status === "failed" ||
    connector.status === "degraded" ||
    connector.status === "reauth_required" ||
    connector.healthStatus === "degraded" ||
    connector.healthStatus === "unhealthy"
  ) {
    return "error";
  }

  if (connector.status === "connected") {
    return "ok";
  }

  return "new";
}

function genericChannelProblemMessage(
  connector: InternalChannelConnectorSummary,
  t: Translator
): string | undefined {
  if (connector.status === "reauth_required") {
    return t("integrations.channel.connectionProblem.reauthRequired");
  }

  if (connector.status === "failed") {
    return t("integrations.channel.connectionProblem.failed");
  }

  if (
    connector.status === "degraded" ||
    connector.healthStatus === "degraded"
  ) {
    return t("integrations.channel.connectionProblem.degraded");
  }

  if (connector.healthStatus === "unhealthy") {
    return t("integrations.channel.connectionProblem.unhealthy");
  }

  return undefined;
}

function GenericChannelCompactStatus({
  connector,
  locale,
  t
}: {
  connector: InternalChannelConnectorSummary;
  locale: string;
  t: Translator;
}): ReactNode {
  return (
    <div className="telegramStatusCard">
      <h3 className="telegramStatusTitle">
        {t("integrations.channel.connectionStatusTitle")}
      </h3>
      <div className="telegramStatusMetrics">
        <GenericChannelStatusMetric
          icon="session"
          label={t("integrations.channel.connectionMetric.sessionState")}
          value={channelSessionStatusLabel(connector.session?.status, t)}
        />
        <GenericChannelStatusMetric
          icon="checked"
          label={t("integrations.channel.connectionMetric.lastCheckedAt")}
          locale={locale}
          value={connector.session?.lastHeartbeatAt}
          fallback={formatOptionalDateTime(
            connector.session?.lastHeartbeatAt,
            locale,
            t
          )}
        />
        <GenericChannelStatusMetric
          icon="inbound"
          label={t("integrations.channel.connectionMetric.inboundReceivedAt")}
          locale={locale}
          value={connector.session?.lastInboundAt}
          fallback={formatOptionalDateTime(
            connector.session?.lastInboundAt,
            locale,
            t
          )}
        />
        <GenericChannelStatusMetric
          icon="outbound"
          label={t("integrations.channel.connectionMetric.outboundSentAt")}
          locale={locale}
          value={connector.session?.lastOutboundAt}
          fallback={formatOptionalDateTime(
            connector.session?.lastOutboundAt,
            locale,
            t
          )}
        />
      </div>
    </div>
  );
}

function GenericChannelStatusMetric({
  fallback,
  icon,
  label,
  locale,
  value
}: {
  fallback?: string;
  icon: "inbound" | "outbound" | "session" | "checked";
  label: string;
  locale?: string;
  value?: string;
}): ReactNode {
  const Icon =
    icon === "inbound"
      ? ArrowDown
      : icon === "outbound"
        ? ArrowUp
        : icon === "checked"
          ? Clock3
          : Activity;

  return (
    <div className="telegramStatusMetric">
      <span className="telegramStatusIcon" aria-hidden="true">
        <Icon size={22} />
      </span>
      <span className="telegramStatusBody">
        <span className="telegramStatusLabel">{label}</span>
        <strong className="telegramStatusValue">
          {fallback && locale ? (
            <LocalDateTime fallback={fallback} locale={locale} value={value} />
          ) : (
            value
          )}
        </strong>
      </span>
    </div>
  );
}

function channelSessionStatusLabel(
  status: string | undefined,
  t: Translator
): string {
  return t(channelSessionStatusKey(status));
}

function channelSessionStatusKey(status: string | undefined): I18nMessageKey {
  switch (status) {
    case "not_started":
    case "pending_auth":
    case "connected":
    case "reconnecting":
    case "disconnected":
    case "revoked":
    case "error":
      return `integrations.channel.sessionStatus.${status}` as I18nMessageKey;
    default:
      return "integrations.channel.sessionStatus.unknown";
  }
}

function GenericChannelLifecycleActions({
  connector,
  t
}: {
  connector: InternalChannelConnectorSummary;
  t: Translator;
}): ReactNode {
  return (
    <ChannelConnectorLifecycleActions
      connectorId={connector.connectorId}
      labels={{
        deleteConnector: t("integrations.channel.deleteConnector"),
        disableConnector: t("integrations.channel.disableConnector"),
        enableConnector: t("integrations.channel.enableConnector")
      }}
      messages={{
        deleted: t("admin.integrations.actionStatus.deleted"),
        disabled: t("admin.integrations.actionStatus.disabled"),
        enabled: t("admin.integrations.actionStatus.enabled"),
        invalid: t("admin.integrations.actionStatus.invalid")
      }}
      status={connector.status}
    />
  );
}

function ConnectorListItem({
  connector,
  catalog,
  current,
  locale,
  sourceName,
  t
}: {
  connector: InternalChannelConnectorSummary;
  catalog: readonly InternalChannelCatalogItem[];
  current: boolean;
  locale: string;
  sourceName?: string;
  t: Translator;
}): ReactNode {
  const channel = catalog.find(
    (item) => item.channelType === connector.channelType
  );
  const channelTypeTitle = channel
    ? resolveChannelTitle({
        channel,
        locale,
        t,
        fallback: connector.channelType
      })
    : connector.channelType;
  const badgeState = connectorListBadgeState(connector);

  return (
    <Link
      className="integrationListItem integrationNavLink"
      href={channelConnectorHref({
        connectorId: connector.connectorId,
        sourceName
      })}
      aria-current={current ? "page" : undefined}
    >
      <span className="metricIcon">
        <ChannelIcon
          channel={channel}
          channelClass={connector.channelClass}
          size="large"
        />
      </span>
      <div className="integrationListText">
        <h3 className="listItemTitle" title={connector.displayName}>
          {connector.displayName}
        </h3>
        <p className="metaText integrationListType" title={channelTypeTitle}>
          {channelTypeTitle}
        </p>
      </div>
      <span className="integrationListBadges">
        <span className="channelStatusBadge" data-state={badgeState}>
          {t(connectorListBadgeKey(badgeState))}
        </span>
      </span>
    </Link>
  );
}

function CatalogListItem({
  channel,
  current,
  locale,
  sourceName,
  t
}: {
  channel: InternalChannelCatalogItem;
  current: boolean;
  locale: string;
  sourceName?: string;
  t: Translator;
}): ReactNode {
  return (
    <Link
      className="integrationListItem integrationNavLink"
      href={channelCatalogHref({
        channelType: channel.channelType,
        sourceName
      })}
      aria-current={current ? "page" : undefined}
    >
      <span className="metricIcon">
        <ChannelIcon channel={channel} size="large" />
      </span>
      <div>
        <h3 className="listItemTitle">
          {resolveChannelTitle({
            channel,
            locale,
            t,
            fallback: channel.channelType
          })}
        </h3>
        <p className="metaText">
          {resolveChannelShortDescription({ channel, locale, t })}
        </p>
      </div>
    </Link>
  );
}

function SourceIcon({
  sourceType
}: {
  sourceType: InternalSourceCatalogItem["sourceType"];
}): ReactNode {
  const Icon =
    sourceType === "messenger"
      ? MessageCircle
      : sourceType === "social"
        ? Users
        : sourceType === "marketplace"
          ? ShoppingBag
          : sourceType === "review"
            ? Star
            : sourceType === "form"
              ? FileText
              : sourceType === "email"
                ? Mail
                : sourceType === "phone"
                  ? PhoneCall
                  : sourceType === "api"
                    ? Code2
                    : Building2;

  return <Icon size={24} strokeWidth={1.6} />;
}

function SourceReadinessBadge({
  readiness,
  t
}: {
  readiness: InternalSourceCatalogItem["readiness"];
  t: Translator;
}): ReactNode {
  return (
    <span
      className="channelStatusBadge"
      data-state={sourceReadinessState(readiness)}
    >
      {t(sourceReadinessKey(readiness))}
    </span>
  );
}

function SourceConnectionStatusBadge({
  status,
  t
}: {
  status: InternalSourceConnectionSummary["status"];
  t: Translator;
}): ReactNode {
  return (
    <span className="channelStatusBadge" data-state={sourceStatusState(status)}>
      {t(sourceConnectionStatusKey(status))}
    </span>
  );
}

function sourceReadinessState(
  readiness: InternalSourceCatalogItem["readiness"]
): ConnectorListBadgeState {
  if (readiness === "available") {
    return "ok";
  }

  if (readiness === "disabled") {
    return "disabled";
  }

  return "new";
}

function sourceStatusState(
  status: InternalSourceConnectionSummary["status"]
): ConnectorListBadgeState {
  if (status === "active") {
    return "ok";
  }

  if (status === "disabled" || status === "deleted") {
    return "disabled";
  }

  if (status === "degraded" || status === "error") {
    return "error";
  }

  return "new";
}

function resolveSourceTitle(
  source: InternalSourceCatalogItem,
  t: Translator
): string {
  return t(source.titleKey as I18nMessageKey);
}

function resolveSourceShortDescription(
  source: InternalSourceCatalogItem,
  t: Translator
): string {
  return t(
    (source.shortDescriptionKey ?? source.descriptionKey) as I18nMessageKey
  );
}

function sourceReadinessKey(
  value: InternalSourceCatalogItem["readiness"]
): I18nMessageKey {
  return `admin.integrations.sourceReadiness.${value}` as I18nMessageKey;
}

function sourceConnectionStatusKey(
  value: InternalSourceConnectionSummary["status"]
): I18nMessageKey {
  return `admin.integrations.sourceStatus.${value}` as I18nMessageKey;
}

function sourceAuthTypeKey(
  value: InternalSourceCatalogItem["authTypes"][number]
): I18nMessageKey {
  return `sources.authType.${value}` as I18nMessageKey;
}

type ConnectorListBadgeState = "ok" | "error" | "disabled" | "new";

function connectorListBadgeState(
  connector: InternalChannelConnectorSummary
): ConnectorListBadgeState {
  if (connector.activeAuthChallenge) {
    return "new";
  }

  if (
    connector.status === "failed" ||
    connector.status === "degraded" ||
    connector.status === "reauth_required" ||
    connector.healthStatus === "degraded" ||
    connector.healthStatus === "unhealthy"
  ) {
    return "error";
  }

  if (connector.status === "connected") {
    return "ok";
  }

  if (connector.status === "disabled") {
    return "disabled";
  }

  return "new";
}

function connectorListBadgeKey(state: ConnectorListBadgeState): I18nMessageKey {
  return `admin.integrations.connectorBadge.${state}` as I18nMessageKey;
}

function selectChannelConnector(input: {
  connectors: readonly InternalChannelConnectorSummary[];
  requestedConnectorId?: string;
}): InternalChannelConnectorSummary | undefined {
  if (!input.requestedConnectorId) {
    return undefined;
  }

  return input.connectors.find(
    (connector) => connector.connectorId === input.requestedConnectorId
  );
}

function selectChannelConnectorBySourceConnectionId(input: {
  connectors: readonly InternalChannelConnectorSummary[];
  requestedSourceConnectionId?: string;
}): InternalChannelConnectorSummary | undefined {
  if (!input.requestedSourceConnectionId) {
    return undefined;
  }

  return input.connectors.find(
    (connector) =>
      connector.sourceConnectionId === input.requestedSourceConnectionId
  );
}

async function loadOptionalChannelAuthChallenge(input: {
  challengeId: string;
  connectorId: string;
  options: { effectivePermissionOverride: "modules.manage" };
}): Promise<InternalChannelAuthChallenge | undefined> {
  try {
    const response = await loadChannelAuthChallenge(
      {
        challengeId: input.challengeId,
        connectorId: input.connectorId
      },
      input.options
    );

    return response.challenge;
  } catch {
    return undefined;
  }
}

function resolveGenericChannelStep(input: {
  challenge?: InternalChannelAuthChallenge;
  channel: InternalChannelCatalogItem | undefined;
  connector: InternalChannelConnectorSummary;
}): {
  id: string;
  kind: InternalChannelCatalogItem["onboarding"]["steps"][number]["kind"];
} {
  const challengeStepKind = resolveChallengeStepKind(input.challenge);

  if (challengeStepKind) {
    return (
      findStepByKind(input.channel, challengeStepKind) ?? {
        id: challengeStepKind,
        kind: challengeStepKind
      }
    );
  }

  if (input.connector.status === "connected") {
    return (
      findStepByKind(input.channel, "complete") ?? {
        id: "complete",
        kind: "complete"
      }
    );
  }

  return (
    findStepByKind(input.channel, "qr_code") ??
    findStepByKind(input.channel, "phone_number") ??
    findStepByKind(input.channel, "waiting") ?? {
      id: "waiting",
      kind: "waiting"
    }
  );
}

function resolveChallengeStepKind(
  challenge: InternalChannelAuthChallenge | undefined
):
  | "qr_code"
  | "phone_number"
  | "verification_code"
  | "password"
  | "waiting"
  | "complete"
  | undefined {
  if (!challenge) {
    return undefined;
  }

  if (challenge.status === "succeeded") {
    return "complete";
  }

  if (challenge.status === "requires_code") {
    return "verification_code";
  }

  if (challenge.status === "requires_password") {
    return "password";
  }

  if (
    (challenge.status === "pending" || challenge.status === "waiting") &&
    challenge.challengeType === "qr"
  ) {
    return "qr_code";
  }

  if (challenge.status === "pending" || challenge.status === "waiting") {
    return "waiting";
  }

  return undefined;
}

function findStepByKind(
  channel: InternalChannelCatalogItem | undefined,
  kind: InternalChannelCatalogItem["onboarding"]["steps"][number]["kind"]
):
  | {
      id: string;
      kind: InternalChannelCatalogItem["onboarding"]["steps"][number]["kind"];
    }
  | undefined {
  return channel?.onboarding.steps.find((step) => step.kind === kind);
}

function isAuthChallengeStep(
  kind: InternalChannelCatalogItem["onboarding"]["steps"][number]["kind"]
): kind is
  | "qr_code"
  | "phone_number"
  | "verification_code"
  | "password"
  | "waiting"
  | "complete" {
  return (
    kind === "qr_code" ||
    kind === "phone_number" ||
    kind === "verification_code" ||
    kind === "password" ||
    kind === "waiting" ||
    kind === "complete"
  );
}

function resolveChallengeType(input: {
  challenge?: InternalChannelAuthChallenge;
  stepKind:
    | "qr_code"
    | "phone_number"
    | "verification_code"
    | "password"
    | "waiting"
    | "complete";
}): InternalChannelAuthChallenge["challengeType"] {
  if (input.challenge) {
    return input.challenge.challengeType;
  }

  if (
    input.stepKind === "phone_number" ||
    input.stepKind === "verification_code"
  ) {
    return "phone_code";
  }

  if (input.stepKind === "password") {
    return "password";
  }

  if (input.stepKind === "qr_code") {
    return "qr";
  }

  return "reauth";
}

function normalizeOptionalSearchParam(
  value: string | undefined
): string | undefined {
  const normalized = value?.trim();

  return normalized && normalized.length > 0 ? normalized : undefined;
}

function createEmptyTelegramIntegrationViewModel(): TelegramIntegrationViewModel {
  return {
    moduleId: "channel-telegram",
    enabled: false,
    diagnostics: {
      status: "disabled",
      checkedAt: new Date().toISOString(),
      checks: {
        moduleEnabled: false,
        configValid: false,
        inboundWebhookReady: false,
        outboundEnabled: false,
        botTokenSecretRefConfigured: false
      }
    }
  };
}
