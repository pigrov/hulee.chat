import type { TenantId } from "@hulee/contracts";
import {
  CoreError,
  createSequentialIdFactory,
  registerTenant
} from "@hulee/core";
import {
  createSqlLocalAuthRepository,
  createTenantRegistrationRepository,
  type InsertRowsOptions,
  type PersistenceExecutor,
  type PersistenceTable,
  type RawSqlExecutor,
  type RawSqlQueryResult
} from "@hulee/db";
import { hashLocalPassword, verifyLocalPassword } from "@hulee/modules";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { loadTenantAdminViewModel } from "./admin-view-model";

const tenantId = "tenant-1" as TenantId;

describe("tenant admin view model", () => {
  it("keeps a clean-slate registration readable by retained auth and admin startup", async () => {
    const database = new RetainedFoundationSqlHarness();
    const password = "Strong-clean-slate-password-42";
    const passwordHash = await hashLocalPassword(password);
    const registration = registerTenant({
      now: "2026-06-22T10:00:00.000Z",
      tenantSlug: "clean-auth",
      tenantDisplayName: "Clean Auth Company",
      productName: "Clean Auth Desk",
      adminEmail: "Admin@Example.test",
      adminDisplayName: "Clean Admin",
      idFactory: createSequentialIdFactory("clean-auth")
    });

    await createTenantRegistrationRepository(database).registerTenant({
      registration,
      adminPasswordHash: passwordHash
    });

    const account = await createSqlLocalAuthRepository(
      database
    ).findTenantAccount({
      tenantSlug: registration.tenant.slug,
      email: registration.admin.email
    });

    expect(account).toMatchObject({
      tenantId: registration.tenant.id,
      tenantSlug: registration.tenant.slug,
      tenantDisplayName: registration.tenant.displayName,
      employeeId: registration.admin.id,
      email: registration.admin.email,
      displayName: registration.admin.displayName,
      passwordHash,
      systemRoleTemplateIds: [],
      permissions: expect.arrayContaining(["tenant.manage", "inbox.read"])
    });
    await expect(
      verifyLocalPassword(password, account?.passwordHash)
    ).resolves.toBe(true);

    const model = await loadTenantAdminViewModel({
      tenantId: registration.tenant.id,
      database
    });

    expect(model.tenant).toMatchObject({
      tenantId: registration.tenant.id,
      displayName: registration.tenant.displayName,
      locale: registration.tenant.locale,
      timezone: registration.tenant.timezone,
      brand: {
        id: registration.brandProfile.id,
        productName: registration.brandProfile.productName
      }
    });
    expect(database.tableNames()).toEqual(
      expect.arrayContaining([
        "tenants",
        "tenant_settings",
        "tenant_brand_profiles",
        "accounts",
        "employees",
        "tenant_roles",
        "tenant_role_permissions",
        "tenant_role_bindings"
      ])
    );
    expect(database.tableNames()).not.toEqual(
      expect.arrayContaining([
        "clients",
        "conversations",
        "conversation_participants",
        "messages"
      ])
    );
    expect(database.queries).toHaveLength(2);
  });

  it("loads tenant display and brand context without inbox data", async () => {
    const model = await loadTenantAdminViewModel({
      tenantId,
      database: executor([
        {
          tenant_id: tenantId,
          display_name: "Acme",
          deployment_type: "saas_isolated",
          locale: "en",
          timezone: "Europe/Berlin",
          brand_id: "brand-1",
          product_name: "Acme Desk",
          short_product_name: "Desk",
          assets: {
            logoLight: "/assets/logo.svg",
            ignored: 123
          },
          theme_tokens: {
            "color.brand.primary": "#177f75",
            ignored: 123
          },
          links: {
            help: "https://help.example.test",
            ignored: 123
          }
        }
      ])
    });

    expect(model.tenant).toMatchObject({
      tenantId,
      displayName: "Acme",
      deploymentType: "saas_isolated",
      locale: "en",
      timezone: "Europe/Berlin",
      brand: {
        id: "brand-1",
        productName: "Acme Desk",
        shortProductName: "Desk",
        companyName: "Acme",
        assets: {
          logoLight: "/assets/logo.svg"
        },
        themeTokens: {
          "color.brand.primary": "#177f75"
        },
        links: {
          help: "https://help.example.test"
        }
      }
    });
  });

  it("fails when tenant context is missing", async () => {
    await expect(
      loadTenantAdminViewModel({
        tenantId,
        database: executor([])
      })
    ).rejects.toEqual(new CoreError("tenant.not_found"));
  });
});

function executor(rows: readonly Record<string, unknown>[]): RawSqlExecutor {
  return {
    async execute<Row extends Record<string, unknown>>() {
      return {
        rows: rows as readonly Row[]
      };
    }
  };
}

class RetainedFoundationSqlHarness
  implements PersistenceExecutor, RawSqlExecutor
{
  readonly queries: SQL[] = [];
  private readonly rowsByTable = new Map<string, Record<string, unknown>[]>();

  async insertRows<Row>(
    table: PersistenceTable<Row>,
    rows: readonly Row[],
    _options?: InsertRowsOptions
  ): Promise<void> {
    const stored = this.rowsByTable.get(table.name) ?? [];
    stored.push(...(rows as readonly Record<string, unknown>[]));
    this.rowsByTable.set(table.name, stored);
  }

  async transaction<TResult>(
    work: (transaction: PersistenceExecutor) => Promise<TResult>
  ): Promise<TResult> {
    return work(this);
  }

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(query);
    const rendered = new PgDialect().sqlToQuery(query).sql;

    if (/\binner join\s+"?accounts"?\b/u.test(rendered)) {
      return { rows: [this.authAccountRow()] as readonly Row[] };
    }

    if (/\bfrom\s+"?tenants"?\s+t\b/u.test(rendered)) {
      return { rows: [this.tenantAdminRow()] as readonly Row[] };
    }

    throw new Error(`Unexpected retained-foundation SQL: ${rendered}`);
  }

  tableNames(): string[] {
    return [...this.rowsByTable.keys()];
  }

  private authAccountRow(): Record<string, unknown> {
    const tenant = this.onlyRow("tenants");
    const account = this.onlyRow("accounts");
    const employee = this.onlyRow("employees");
    const binding = this.onlyRow("tenant_role_bindings");
    const permissions = this.rows("tenant_role_permissions")
      .filter((row) => row.roleId === binding.roleId)
      .map((row) => row.permission);

    return {
      tenant_id: tenant.id,
      tenant_slug: tenant.slug,
      tenant_display_name: tenant.displayName,
      account_id: account.id,
      employee_id: employee.id,
      email: account.email,
      email_verified_at: account.emailVerifiedAt,
      display_name: employee.displayName,
      password_hash: account.passwordHash,
      system_role_template_ids: [],
      permissions
    };
  }

  private tenantAdminRow(): Record<string, unknown> {
    const tenant = this.onlyRow("tenants");
    const settings = this.onlyRow("tenant_settings");
    const brand = this.onlyRow("tenant_brand_profiles");

    return {
      tenant_id: tenant.id,
      display_name: tenant.displayName,
      deployment_type: tenant.deploymentType,
      locale: settings.locale,
      timezone: settings.timezone,
      brand_id: brand.id,
      product_name: brand.productName,
      short_product_name: brand.shortProductName ?? null,
      assets: brand.assets,
      theme_tokens: brand.themeTokens,
      links: brand.links
    };
  }

  private onlyRow(tableName: string): Record<string, unknown> {
    const rows = this.rows(tableName);

    if (rows.length !== 1 || rows[0] === undefined) {
      throw new Error(`Expected one retained row in ${tableName}.`);
    }

    return rows[0];
  }

  private rows(tableName: string): readonly Record<string, unknown>[] {
    return this.rowsByTable.get(tableName) ?? [];
  }
}
