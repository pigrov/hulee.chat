import { INBOX_V2_INITIAL_SCHEMA_VERSION } from "./schema-version";

export const INBOX_V2_RECIPIENT_SYNC_BATCH_SCHEMA_ID =
  "core:inbox-v2.recipient-sync-batch" as const;
export const INBOX_V2_RECIPIENT_SNAPSHOT_PAGE_SCHEMA_ID =
  "core:inbox-v2.recipient-snapshot-page" as const;
export const INBOX_V2_REALTIME_ENVELOPE_SCHEMA_ID =
  "core:inbox-v2.realtime-envelope" as const;
export const INBOX_V2_RECIPIENT_SYNC_ARCHIVED_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;
export const INBOX_V2_RECIPIENT_SYNC_SCHEMA_VERSION = "v2" as const;
export const INBOX_V2_MAX_SYNC_BATCH_COMMITS = 256;
export const INBOX_V2_MAX_SYNC_COMMIT_CHANGES = 256;
export const INBOX_V2_MAX_SYNC_BATCH_CHANGES = 4_096;
export const INBOX_V2_MAX_SYNC_FRAME_BYTES = 4 * 1024 * 1024;
export const INBOX_V2_MAX_RECIPIENT_VALUE_BYTES = 1024 * 1024;
