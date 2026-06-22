CREATE TYPE "public"."conversation_type" AS ENUM('client_direct', 'client_group', 'internal_direct', 'internal_group', 'support_case', 'intake');--> statement-breakpoint
CREATE TYPE "public"."deployment_type" AS ENUM('saas_shared', 'saas_isolated', 'on_prem');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('received', 'queued', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'processing', 'processed', 'failed');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"actor_employee_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"client_id" text NOT NULL,
	"type" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"display_name" text NOT NULL,
	"source" text NOT NULL,
	"responsible_employee_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_participants" (
	"tenant_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_participants_tenant_id_conversation_id_employee_id_pk" PRIMARY KEY("tenant_id","conversation_id","employee_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"type" "conversation_type" NOT NULL,
	"client_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_roles" (
	"tenant_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_roles_tenant_id_employee_id_role_pk" PRIMARY KEY("tenant_id","employee_id","role")
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"account_id" text,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_store" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"type" text NOT NULL,
	"version" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"idempotency_key" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"media_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_diagnostics" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"module_id" text NOT NULL,
	"status" text NOT NULL,
	"last_error_code" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_delivery_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"message_id" text NOT NULL,
	"status" text NOT NULL,
	"provider_message_id" text,
	"error_code" text,
	"retryable" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"direction" "message_direction" NOT NULL,
	"text" text,
	"status" "message_status" NOT NULL,
	"idempotency_key" text NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "module_catalog" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"client_kind" text NOT NULL,
	"endpoint_token_hash" text NOT NULL,
	"app_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"event_type" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"event_id" text NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error_code" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_admin_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_brand_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"media_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_brand_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"product_name" text NOT NULL,
	"short_product_name" text,
	"assets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"theme_tokens" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"links" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"domain" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_entitlements" (
	"tenant_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'license' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_entitlements_tenant_id_key_value_pk" PRIMARY KEY("tenant_id","key","value")
);
--> statement-breakpoint
CREATE TABLE "tenant_modules" (
	"tenant_id" text NOT NULL,
	"module_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"diagnostics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_modules_tenant_id_module_id_pk" PRIMARY KEY("tenant_id","module_id")
);
--> statement-breakpoint
CREATE TABLE "tenant_settings" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"locale" text NOT NULL,
	"timezone" text NOT NULL,
	"region" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_usage_policies" (
	"tenant_id" text NOT NULL,
	"entitlement" text NOT NULL,
	"included" integer NOT NULL,
	"soft_limit" integer,
	"hard_limit" integer,
	"reset_period" text DEFAULT 'monthly' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_usage_policies_tenant_id_entitlement_pk" PRIMARY KEY("tenant_id","entitlement")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"deployment_type" "deployment_type" DEFAULT 'saas_shared' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_period_summaries" (
	"tenant_id" text NOT NULL,
	"entitlement" text NOT NULL,
	"period_key" text NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_period_summaries_tenant_id_entitlement_period_key_pk" PRIMARY KEY("tenant_id","entitlement","period_key")
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entitlement" text NOT NULL,
	"quantity" integer NOT NULL,
	"period_key" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"url" text NOT NULL,
	"events" jsonb NOT NULL,
	"secret_ref" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_employee_id_employees_id_fk" FOREIGN KEY ("actor_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_responsible_employee_id_employees_id_fk" FOREIGN KEY ("responsible_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_roles" ADD CONSTRAINT "employee_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_roles" ADD CONSTRAINT "employee_roles_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_store" ADD CONSTRAINT "event_store_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_diagnostics" ADD CONSTRAINT "integration_diagnostics_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_delivery_attempts" ADD CONSTRAINT "message_delivery_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_delivery_attempts" ADD CONSTRAINT "message_delivery_attempts_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_endpoints" ADD CONSTRAINT "notification_endpoints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_endpoints" ADD CONSTRAINT "notification_endpoints_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_event_id_event_store_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event_store"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_api_keys" ADD CONSTRAINT "tenant_api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_brand_assets" ADD CONSTRAINT "tenant_brand_assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_brand_profiles" ADD CONSTRAINT "tenant_brand_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD CONSTRAINT "tenant_domains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_entitlements" ADD CONSTRAINT "tenant_entitlements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_usage_policies" ADD CONSTRAINT "tenant_usage_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_period_summaries" ADD CONSTRAINT "usage_period_summaries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_tenant_email_unique" ON "accounts" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "accounts_tenant_idx" ON "accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "audit_log_tenant_entity_idx" ON "audit_log" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "client_contacts_tenant_client_idx" ON "client_contacts" USING btree ("tenant_id","client_id");--> statement-breakpoint
CREATE INDEX "client_contacts_tenant_value_idx" ON "client_contacts" USING btree ("tenant_id","value");--> statement-breakpoint
CREATE INDEX "clients_tenant_idx" ON "clients" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "conversation_participants_tenant_idx" ON "conversation_participants" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "conversations_tenant_idx" ON "conversations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "employee_roles_tenant_idx" ON "employee_roles" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "employees_tenant_idx" ON "employees" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "event_store_tenant_type_idx" ON "event_store" USING btree ("tenant_id","type");--> statement-breakpoint
CREATE INDEX "event_store_tenant_occurred_idx" ON "event_store" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "files_tenant_storage_key_unique" ON "files" USING btree ("tenant_id","storage_key");--> statement-breakpoint
CREATE INDEX "files_tenant_idx" ON "files" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "integration_diagnostics_tenant_module_idx" ON "integration_diagnostics" USING btree ("tenant_id","module_id");--> statement-breakpoint
CREATE INDEX "message_delivery_attempts_tenant_message_idx" ON "message_delivery_attempts" USING btree ("tenant_id","message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_tenant_idempotency_unique" ON "messages" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "messages_tenant_conversation_idx" ON "messages" USING btree ("tenant_id","conversation_id");--> statement-breakpoint
CREATE INDEX "module_catalog_type_idx" ON "module_catalog" USING btree ("type");--> statement-breakpoint
CREATE INDEX "notification_endpoints_tenant_employee_idx" ON "notification_endpoints" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_events_tenant_dedupe_unique" ON "notification_events" USING btree ("tenant_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notification_events_tenant_employee_idx" ON "notification_events" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "outbox_tenant_status_idx" ON "outbox" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "outbox_tenant_next_attempt_idx" ON "outbox" USING btree ("tenant_id","next_attempt_at");--> statement-breakpoint
CREATE INDEX "teams_tenant_idx" ON "teams" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_api_keys_tenant_idx" ON "tenant_api_keys" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_brand_assets_tenant_idx" ON "tenant_brand_assets" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_brand_profiles_tenant_idx" ON "tenant_brand_profiles" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_domains_domain_unique" ON "tenant_domains" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "tenant_domains_tenant_idx" ON "tenant_domains" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_entitlements_tenant_idx" ON "tenant_entitlements" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_modules_tenant_idx" ON "tenant_modules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_settings_tenant_idx" ON "tenant_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_usage_policies_tenant_idx" ON "tenant_usage_policies" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_unique" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "usage_period_summaries_tenant_idx" ON "usage_period_summaries" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_records_idempotency_unique" ON "usage_records" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "usage_records_tenant_period_idx" ON "usage_records" USING btree ("tenant_id","period_key");--> statement-breakpoint
CREATE INDEX "webhook_subscriptions_tenant_idx" ON "webhook_subscriptions" USING btree ("tenant_id");