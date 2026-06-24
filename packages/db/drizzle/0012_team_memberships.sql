CREATE TABLE "employee_team_memberships" (
	"tenant_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"team_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"role_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_team_memberships_tenant_id_employee_id_team_id_pk" PRIMARY KEY("tenant_id","employee_id","team_id")
);
--> statement-breakpoint
ALTER TABLE "employee_team_memberships" ADD CONSTRAINT "employee_team_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_team_memberships" ADD CONSTRAINT "employee_team_memberships_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_team_memberships" ADD CONSTRAINT "employee_team_memberships_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_team_memberships_tenant_idx" ON "employee_team_memberships" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "employee_team_memberships_tenant_employee_idx" ON "employee_team_memberships" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "employee_team_memberships_tenant_team_idx" ON "employee_team_memberships" USING btree ("tenant_id","team_id");--> statement-breakpoint
CREATE INDEX "employee_team_memberships_tenant_status_idx" ON "employee_team_memberships" USING btree ("tenant_id","status");