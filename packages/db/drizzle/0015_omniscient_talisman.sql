CREATE TABLE "channel_auth_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"connector_id" text NOT NULL,
	"challenge_type" text NOT NULL,
	"status" text NOT NULL,
	"public_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_payload_encrypted" text,
	"error_code" text,
	"error_message" text,
	"expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by_employee_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_connectors" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"channel_type" text NOT NULL,
	"channel_class" text NOT NULL,
	"provider" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'onboarding' NOT NULL,
	"health_status" text DEFAULT 'unknown' NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"onboarding_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"diagnostics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_employee_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"connector_id" text NOT NULL,
	"session_key" text NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"session_encrypted" text,
	"public_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"challenge_type" text,
	"challenge_expires_at" timestamp with time zone,
	"last_connected_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_auth_challenges" ADD CONSTRAINT "channel_auth_challenges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_auth_challenges" ADD CONSTRAINT "channel_auth_challenges_connector_id_channel_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."channel_connectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_connectors" ADD CONSTRAINT "channel_connectors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_sessions" ADD CONSTRAINT "channel_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_sessions" ADD CONSTRAINT "channel_sessions_connector_id_channel_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."channel_connectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_auth_challenges_tenant_idx" ON "channel_auth_challenges" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "channel_auth_challenges_tenant_connector_idx" ON "channel_auth_challenges" USING btree ("tenant_id","connector_id");--> statement-breakpoint
CREATE INDEX "channel_auth_challenges_tenant_status_idx" ON "channel_auth_challenges" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "channel_auth_challenges_tenant_created_idx" ON "channel_auth_challenges" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "channel_connectors_tenant_idx" ON "channel_connectors" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "channel_connectors_tenant_type_idx" ON "channel_connectors" USING btree ("tenant_id","channel_type");--> statement-breakpoint
CREATE INDEX "channel_connectors_tenant_status_idx" ON "channel_connectors" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_sessions_tenant_connector_key_unique" ON "channel_sessions" USING btree ("tenant_id","connector_id","session_key");--> statement-breakpoint
CREATE INDEX "channel_sessions_tenant_idx" ON "channel_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "channel_sessions_tenant_connector_idx" ON "channel_sessions" USING btree ("tenant_id","connector_id");--> statement-breakpoint
CREATE INDEX "channel_sessions_tenant_status_idx" ON "channel_sessions" USING btree ("tenant_id","status");--> statement-breakpoint
INSERT INTO "channel_connectors" (
	"id",
	"tenant_id",
	"channel_type",
	"channel_class",
	"provider",
	"display_name",
	"status",
	"health_status",
	"capabilities",
	"onboarding_state",
	"config",
	"diagnostics",
	"created_by_employee_id",
	"created_at",
	"updated_at"
)
SELECT
	'telegram_bot:' || "tenant_id",
	"tenant_id",
	'telegram_bot',
	'bot_bridge',
	'telegram',
	'Telegram Bot',
	CASE WHEN "enabled" THEN 'connected' ELSE 'disabled' END,
	CASE
		WHEN NOT "enabled" THEN 'unknown'
		WHEN "diagnostics" ->> 'status' = 'configured' THEN 'healthy'
		WHEN "diagnostics" ->> 'status' IN ('provider_unreachable', 'webhook_mismatch') THEN 'degraded'
		WHEN "diagnostics" ->> 'status' = 'invalid_config' THEN 'unhealthy'
		ELSE 'unknown'
	END,
	'{"inbound":true,"outbound":true,"attachmentsMetadata":true}'::jsonb,
	'{}'::jsonb,
	"config",
	"diagnostics",
	NULL,
	"created_at",
	"updated_at"
FROM "tenant_modules"
WHERE "module_id" = 'channel-telegram'
ON CONFLICT ("id") DO NOTHING;
