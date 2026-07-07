ALTER TABLE "channel_sessions" ADD COLUMN "session_fingerprint" text;--> statement-breakpoint
ALTER TABLE "channel_sessions" ADD COLUMN "external_account_id" text;--> statement-breakpoint
ALTER TABLE "channel_sessions" ADD COLUMN "display_address" text;--> statement-breakpoint
ALTER TABLE "channel_sessions" ADD COLUMN "metadata" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_sessions" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "channel_sessions" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_sessions" ADD COLUMN "last_disconnected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_sessions" ADD COLUMN "last_heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_sessions" ADD COLUMN "last_inbound_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_sessions" ADD COLUMN "last_outbound_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "channel_session_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"connector_id" text NOT NULL,
	"session_id" text NOT NULL,
	"event_type" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"code" text,
	"message" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_session_events" ADD CONSTRAINT "channel_session_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_session_events" ADD CONSTRAINT "channel_session_events_connector_id_channel_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."channel_connectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_session_events" ADD CONSTRAINT "channel_session_events_session_id_channel_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."channel_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_sessions_tenant_lease_idx" ON "channel_sessions" USING btree ("tenant_id","status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "channel_sessions_tenant_heartbeat_idx" ON "channel_sessions" USING btree ("tenant_id","last_heartbeat_at");--> statement-breakpoint
CREATE INDEX "channel_session_events_tenant_idx" ON "channel_session_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "channel_session_events_tenant_connector_idx" ON "channel_session_events" USING btree ("tenant_id","connector_id","occurred_at");--> statement-breakpoint
CREATE INDEX "channel_session_events_tenant_session_idx" ON "channel_session_events" USING btree ("tenant_id","session_id","occurred_at");
