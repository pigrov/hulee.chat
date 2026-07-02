CREATE TABLE "channel_provider_validation_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"channel_type" text NOT NULL,
	"provider" text NOT NULL,
	"validation_kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"bot_token_secret_ref" text NOT NULL,
	"result_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" text,
	"error_message" text,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by_employee_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_provider_validation_jobs" ADD CONSTRAINT "channel_provider_validation_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_provider_validation_jobs_tenant_idx" ON "channel_provider_validation_jobs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "channel_provider_validation_jobs_tenant_status_idx" ON "channel_provider_validation_jobs" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "channel_provider_validation_jobs_tenant_created_idx" ON "channel_provider_validation_jobs" USING btree ("tenant_id","created_at");