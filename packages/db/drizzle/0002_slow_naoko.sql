CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"session_hash" text NOT NULL,
	"tenant_id" text,
	"employee_id" text,
	"platform_admin_account_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_admin_accounts" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_platform_admin_account_id_platform_admin_accounts_id_fk" FOREIGN KEY ("platform_admin_account_id") REFERENCES "public"."platform_admin_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_session_hash_unique" ON "sessions" USING btree ("session_hash");--> statement-breakpoint
CREATE INDEX "sessions_tenant_employee_idx" ON "sessions" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "sessions_platform_admin_idx" ON "sessions" USING btree ("platform_admin_account_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_admin_accounts_email_unique" ON "platform_admin_accounts" USING btree ("email");