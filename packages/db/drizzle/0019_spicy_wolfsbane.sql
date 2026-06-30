CREATE TABLE "deployment_channel_provider_policies" (
	"provider" text NOT NULL,
	"channel_type" text NOT NULL,
	"inbound_mode" text NOT NULL,
	"outbound_enabled" boolean DEFAULT true NOT NULL,
	"updated_by_platform_admin_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployment_channel_provider_policies_pk" PRIMARY KEY("provider","channel_type")
);
--> statement-breakpoint
ALTER TABLE "deployment_channel_provider_policies" ADD CONSTRAINT "deployment_channel_provider_policies_updated_by_platform_admin_account_id_platform_admin_accounts_id_fk" FOREIGN KEY ("updated_by_platform_admin_account_id") REFERENCES "public"."platform_admin_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deployment_channel_provider_policy_provider_idx" ON "deployment_channel_provider_policies" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "deployment_channel_provider_policy_channel_idx" ON "deployment_channel_provider_policies" USING btree ("channel_type");