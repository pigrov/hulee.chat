CREATE TABLE "employee_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by_employee_id" text NOT NULL,
	"accepted_employee_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_invitations" ADD CONSTRAINT "employee_invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_invitations" ADD CONSTRAINT "employee_invitations_invited_by_employee_id_employees_id_fk" FOREIGN KEY ("invited_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_invitations" ADD CONSTRAINT "employee_invitations_accepted_employee_id_employees_id_fk" FOREIGN KEY ("accepted_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_invitations_token_unique" ON "employee_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "employee_invitations_tenant_email_idx" ON "employee_invitations" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "employee_invitations_tenant_status_idx" ON "employee_invitations" USING btree ("tenant_id","accepted_at","revoked_at");