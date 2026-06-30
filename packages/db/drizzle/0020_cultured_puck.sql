CREATE TABLE "deployment_channel_catalog_overrides" (
	"channel_type" text PRIMARY KEY NOT NULL,
	"title_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"icon_asset_ref" text,
	"sort_order" integer,
	"visibility" text DEFAULT 'visible' NOT NULL,
	"readiness" text,
	"updated_by_platform_admin_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deployment_channel_catalog_overrides" ADD CONSTRAINT "deployment_channel_catalog_overrides_updated_by_platform_admin_account_id_platform_admin_accounts_id_fk" FOREIGN KEY ("updated_by_platform_admin_account_id") REFERENCES "public"."platform_admin_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deployment_channel_catalog_override_visibility_idx" ON "deployment_channel_catalog_overrides" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "deployment_channel_catalog_override_sort_idx" ON "deployment_channel_catalog_overrides" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "deployment_channel_catalog_override_readiness_idx" ON "deployment_channel_catalog_overrides" USING btree ("readiness");