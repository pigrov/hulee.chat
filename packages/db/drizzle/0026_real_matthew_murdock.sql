CREATE TABLE "normalized_inbound_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"raw_event_id" text NOT NULL,
	"source_connection_id" text NOT NULL,
	"source_account_id" text,
	"source_type" text NOT NULL,
	"source_name" text NOT NULL,
	"event_type" text NOT NULL,
	"direction" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"external_thread_id" text,
	"external_message_id" text,
	"external_user_id" text,
	"payload_version" text DEFAULT 'v1' NOT NULL,
	"normalized_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reply_capability" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"conversation_id" text,
	"message_id" text,
	"idempotency_key" text NOT NULL,
	"processing_status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_inbound_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"source_connection_id" text NOT NULL,
	"source_account_id" text,
	"external_event_id" text,
	"event_signature" text,
	"idempotency_key" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_timestamp" timestamp with time zone,
	"payload" jsonb NOT NULL,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processing_status" text DEFAULT 'new' NOT NULL,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"source_connection_id" text NOT NULL,
	"external_account_id" text,
	"external_account_name" text,
	"account_type" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_name" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"auth_type" text DEFAULT 'custom' NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"diagnostics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_employee_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "normalized_inbound_events" ADD CONSTRAINT "normalized_inbound_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalized_inbound_events" ADD CONSTRAINT "normalized_inbound_events_raw_event_id_raw_inbound_events_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_inbound_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalized_inbound_events" ADD CONSTRAINT "normalized_inbound_events_source_connection_id_source_connections_id_fk" FOREIGN KEY ("source_connection_id") REFERENCES "public"."source_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalized_inbound_events" ADD CONSTRAINT "normalized_inbound_events_source_account_id_source_accounts_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."source_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_inbound_events" ADD CONSTRAINT "raw_inbound_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_inbound_events" ADD CONSTRAINT "raw_inbound_events_source_connection_id_source_connections_id_fk" FOREIGN KEY ("source_connection_id") REFERENCES "public"."source_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_inbound_events" ADD CONSTRAINT "raw_inbound_events_source_account_id_source_accounts_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."source_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_accounts" ADD CONSTRAINT "source_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_accounts" ADD CONSTRAINT "source_accounts_source_connection_id_source_connections_id_fk" FOREIGN KEY ("source_connection_id") REFERENCES "public"."source_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_connections" ADD CONSTRAINT "source_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "normalized_inbound_events_tenant_idempotency_unique" ON "normalized_inbound_events" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "normalized_inbound_events_tenant_idx" ON "normalized_inbound_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "normalized_inbound_events_tenant_raw_idx" ON "normalized_inbound_events" USING btree ("tenant_id","raw_event_id");--> statement-breakpoint
CREATE INDEX "normalized_inbound_events_tenant_connection_idx" ON "normalized_inbound_events" USING btree ("tenant_id","source_connection_id","created_at");--> statement-breakpoint
CREATE INDEX "normalized_inbound_events_tenant_thread_idx" ON "normalized_inbound_events" USING btree ("tenant_id","external_thread_id");--> statement-breakpoint
CREATE INDEX "normalized_inbound_events_tenant_status_idx" ON "normalized_inbound_events" USING btree ("tenant_id","processing_status");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_inbound_events_tenant_idempotency_unique" ON "raw_inbound_events" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "raw_inbound_events_tenant_idx" ON "raw_inbound_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "raw_inbound_events_tenant_connection_idx" ON "raw_inbound_events" USING btree ("tenant_id","source_connection_id","received_at");--> statement-breakpoint
CREATE INDEX "raw_inbound_events_tenant_account_idx" ON "raw_inbound_events" USING btree ("tenant_id","source_account_id","received_at");--> statement-breakpoint
CREATE INDEX "raw_inbound_events_tenant_status_idx" ON "raw_inbound_events" USING btree ("tenant_id","processing_status");--> statement-breakpoint
CREATE INDEX "source_accounts_tenant_idx" ON "source_accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "source_accounts_tenant_connection_idx" ON "source_accounts" USING btree ("tenant_id","source_connection_id");--> statement-breakpoint
CREATE INDEX "source_accounts_tenant_external_idx" ON "source_accounts" USING btree ("tenant_id","external_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_accounts_tenant_connection_external_unique" ON "source_accounts" USING btree ("tenant_id","source_connection_id","external_account_id");--> statement-breakpoint
CREATE INDEX "source_connections_tenant_idx" ON "source_connections" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "source_connections_tenant_type_idx" ON "source_connections" USING btree ("tenant_id","source_type");--> statement-breakpoint
CREATE INDEX "source_connections_tenant_source_idx" ON "source_connections" USING btree ("tenant_id","source_name");--> statement-breakpoint
CREATE INDEX "source_connections_tenant_status_idx" ON "source_connections" USING btree ("tenant_id","status");