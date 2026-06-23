CREATE TABLE "platform_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_platform_admin_account_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_audit_log" ADD CONSTRAINT "platform_audit_log_actor_platform_admin_account_id_platform_admin_accounts_id_fk" FOREIGN KEY ("actor_platform_admin_account_id") REFERENCES "public"."platform_admin_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_audit_log_actor_idx" ON "platform_audit_log" USING btree ("actor_platform_admin_account_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_audit_log_entity_idx" ON "platform_audit_log" USING btree ("entity_type","entity_id");