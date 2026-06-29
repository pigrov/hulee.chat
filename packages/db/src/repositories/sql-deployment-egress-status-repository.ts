import type {
  InternalEgressAlertSeverity,
  InternalEgressProfileKind,
  InternalEgressProfileStatus,
  InternalEgressStatus,
  PlatformErrorCode
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type DeploymentEgressProbeResult = NonNullable<
  InternalEgressProfileStatus["probes"]
>[number];

export type DeploymentEgressAlert = NonNullable<
  InternalEgressProfileStatus["alerts"]
>[number];

export type DeploymentEgressStatusSnapshot = {
  profileId: string;
  profileKind: InternalEgressProfileKind;
  status: InternalEgressStatus;
  checkedAt: Date;
  lastReadyAt?: Date;
  lastFailureAt?: Date;
  consecutiveFailures: number;
  alertSeverity: InternalEgressAlertSeverity;
  lastErrorCode?: PlatformErrorCode;
  operatorHint?: string;
  publicIp?: string;
  probes: readonly DeploymentEgressProbeResult[];
  alerts: readonly DeploymentEgressAlert[];
  workerId?: string;
};

export type ListDeploymentEgressStatusSnapshotsInput = {
  profileIds?: readonly string[];
  limit?: number;
};

export type UpsertDeploymentEgressStatusSnapshotInput =
  DeploymentEgressStatusSnapshot;

export type DeploymentEgressStatusRepository = {
  listLatestSnapshots(
    input?: ListDeploymentEgressStatusSnapshotsInput
  ): Promise<DeploymentEgressStatusSnapshot[]>;
  upsertSnapshot(
    input: UpsertDeploymentEgressStatusSnapshotInput
  ): Promise<void>;
};

type DeploymentEgressStatusSnapshotRow = {
  profile_id: string;
  profile_kind: string;
  status: string;
  checked_at: Date | string;
  last_ready_at: Date | string | null;
  last_failure_at: Date | string | null;
  consecutive_failures: number;
  alert_severity: string;
  last_error_code: string | null;
  operator_hint: string | null;
  public_ip: string | null;
  details: unknown;
};

type DeploymentEgressStatusSnapshotDetails = {
  probes?: readonly DeploymentEgressProbeResult[];
  alerts?: readonly DeploymentEgressAlert[];
  workerId?: string;
};

export function createSqlDeploymentEgressStatusRepository(
  executor: RawSqlExecutor | HuleeDatabase
): DeploymentEgressStatusRepository {
  const rawExecutor = executor as RawSqlExecutor;

  return {
    async listLatestSnapshots(input = {}) {
      const result =
        await rawExecutor.execute<DeploymentEgressStatusSnapshotRow>(
          buildListDeploymentEgressStatusSnapshotsSql(input)
        );

      return result.rows.map(mapDeploymentEgressStatusSnapshotRow);
    },

    async upsertSnapshot(input) {
      await rawExecutor.execute(
        buildUpsertDeploymentEgressStatusSnapshotSql(input)
      );
    }
  };
}

export function buildListDeploymentEgressStatusSnapshotsSql(
  input: ListDeploymentEgressStatusSnapshotsInput = {}
): SQL {
  const limit = input.limit ?? 20;
  const profileIds = input.profileIds?.filter((profileId) => {
    return profileId.trim().length > 0;
  });

  return sql`
    select profile_id,
           profile_kind,
           status,
           checked_at,
           last_ready_at,
           last_failure_at,
           consecutive_failures,
           alert_severity,
           last_error_code,
           operator_hint,
           public_ip,
           details
    from deployment_egress_status_snapshots
    where ${profileIds && profileIds.length > 0 ? sql`profile_id = any(${profileIds})` : sql`true`}
    order by checked_at desc,
             profile_id asc
    limit ${limit}
  `;
}

export function buildUpsertDeploymentEgressStatusSnapshotSql(
  input: UpsertDeploymentEgressStatusSnapshotInput
): SQL {
  const details: DeploymentEgressStatusSnapshotDetails = {
    probes: input.probes,
    alerts: input.alerts,
    ...(input.workerId ? { workerId: input.workerId } : {})
  };

  return sql`
    insert into deployment_egress_status_snapshots (
      profile_id,
      profile_kind,
      status,
      checked_at,
      last_ready_at,
      last_failure_at,
      consecutive_failures,
      alert_severity,
      last_error_code,
      operator_hint,
      public_ip,
      details,
      created_at,
      updated_at
    )
    values (
      ${input.profileId},
      ${input.profileKind},
      ${input.status},
      ${input.checkedAt},
      ${input.lastReadyAt ?? null},
      ${input.lastFailureAt ?? null},
      ${input.consecutiveFailures},
      ${input.alertSeverity},
      ${input.lastErrorCode ?? null},
      ${input.operatorHint ?? null},
      ${input.publicIp ?? null},
      ${JSON.stringify(details)}::jsonb,
      ${input.checkedAt},
      ${input.checkedAt}
    )
    on conflict (profile_id) do update
    set profile_kind = excluded.profile_kind,
        status = excluded.status,
        checked_at = excluded.checked_at,
        last_ready_at = excluded.last_ready_at,
        last_failure_at = excluded.last_failure_at,
        consecutive_failures = excluded.consecutive_failures,
        alert_severity = excluded.alert_severity,
        last_error_code = excluded.last_error_code,
        operator_hint = excluded.operator_hint,
        public_ip = excluded.public_ip,
        details = excluded.details,
        updated_at = excluded.updated_at
  `;
}

function mapDeploymentEgressStatusSnapshotRow(
  row: DeploymentEgressStatusSnapshotRow
): DeploymentEgressStatusSnapshot {
  const details = parseDetails(row.details);

  return {
    profileId: row.profile_id,
    profileKind: row.profile_kind as InternalEgressProfileKind,
    status: row.status as InternalEgressStatus,
    checkedAt: toDate(row.checked_at),
    ...(row.last_ready_at ? { lastReadyAt: toDate(row.last_ready_at) } : {}),
    ...(row.last_failure_at
      ? { lastFailureAt: toDate(row.last_failure_at) }
      : {}),
    consecutiveFailures: row.consecutive_failures,
    alertSeverity: row.alert_severity as InternalEgressAlertSeverity,
    ...(row.last_error_code
      ? { lastErrorCode: row.last_error_code as PlatformErrorCode }
      : {}),
    ...(row.operator_hint ? { operatorHint: row.operator_hint } : {}),
    ...(row.public_ip ? { publicIp: row.public_ip } : {}),
    probes: details.probes ?? [],
    alerts: details.alerts ?? [],
    ...(details.workerId ? { workerId: details.workerId } : {})
  };
}

function parseDetails(value: unknown): DeploymentEgressStatusSnapshotDetails {
  if (!value || typeof value !== "object") {
    return {};
  }

  const record = value as Record<string, unknown>;

  return {
    probes: Array.isArray(record.probes)
      ? (record.probes as DeploymentEgressProbeResult[])
      : [],
    alerts: Array.isArray(record.alerts)
      ? (record.alerts as DeploymentEgressAlert[])
      : [],
    workerId: typeof record.workerId === "string" ? record.workerId : undefined
  };
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
