import type { InboxV2ExactActiveTenantPolicyAuthorityInput } from "@hulee/contracts";

import {
  lockAndValidateExactActiveInboxV2TenantPolicyAuthority,
  type InboxV2TenantPolicyAuthorityUseTransaction
} from "./sql-inbox-v2-tenant-policy-authority-repository";
import type { RawSqlExecutor } from "./sql-outbox-repository";

declare const rawExecutor: RawSqlExecutor;
declare const transactionExecutor: InboxV2TenantPolicyAuthorityUseTransaction;
declare const exactInput: InboxV2ExactActiveTenantPolicyAuthorityInput;

void lockAndValidateExactActiveInboxV2TenantPolicyAuthority(
  // @ts-expect-error policy use must be fenced by an actual transaction callback
  rawExecutor,
  exactInput
);

void lockAndValidateExactActiveInboxV2TenantPolicyAuthority(
  transactionExecutor,
  exactInput
);
