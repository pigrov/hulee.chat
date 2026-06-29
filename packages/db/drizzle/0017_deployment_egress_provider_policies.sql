CREATE TABLE "deployment_egress_provider_policies" (
	"provider" text PRIMARY KEY NOT NULL,
	"routing_mode" text NOT NULL,
	"profile_id" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"supported_channel_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_profile_kinds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by_platform_admin_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deployment_egress_provider_policies" ADD CONSTRAINT "deployment_egress_provider_policies_updated_by_platform_admin_account_id_platform_admin_accounts_id_fk" FOREIGN KEY ("updated_by_platform_admin_account_id") REFERENCES "public"."platform_admin_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deployment_egress_provider_policy_profile_idx" ON "deployment_egress_provider_policies" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "deployment_egress_provider_policy_route_idx" ON "deployment_egress_provider_policies" USING btree ("routing_mode");