CREATE TABLE "direct_permission_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"permission" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text,
	"reason" text NOT NULL,
	"created_by_employee_id" text,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_role_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"role_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text,
	"created_by_employee_id" text,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_role_permissions" (
	"tenant_id" text NOT NULL,
	"role_id" text NOT NULL,
	"permission" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_role_permissions_tenant_id_role_id_permission_pk" PRIMARY KEY("tenant_id","role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "tenant_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_by_employee_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "direct_permission_grants" ADD CONSTRAINT "direct_permission_grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_permission_grants" ADD CONSTRAINT "direct_permission_grants_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_permission_grants" ADD CONSTRAINT "direct_permission_grants_created_by_employee_id_employees_id_fk" FOREIGN KEY ("created_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_role_bindings" ADD CONSTRAINT "tenant_role_bindings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_role_bindings" ADD CONSTRAINT "tenant_role_bindings_role_id_tenant_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."tenant_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_role_bindings" ADD CONSTRAINT "tenant_role_bindings_created_by_employee_id_employees_id_fk" FOREIGN KEY ("created_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_role_permissions" ADD CONSTRAINT "tenant_role_permissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_role_permissions" ADD CONSTRAINT "tenant_role_permissions_role_id_tenant_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."tenant_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_roles" ADD CONSTRAINT "tenant_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_roles" ADD CONSTRAINT "tenant_roles_created_by_employee_id_employees_id_fk" FOREIGN KEY ("created_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "direct_permission_grants_tenant_idx" ON "direct_permission_grants" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "direct_permission_grants_tenant_employee_idx" ON "direct_permission_grants" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "direct_permission_grants_tenant_permission_idx" ON "direct_permission_grants" USING btree ("tenant_id","permission");--> statement-breakpoint
CREATE INDEX "direct_permission_grants_tenant_active_idx" ON "direct_permission_grants" USING btree ("tenant_id","revoked_at","expires_at");--> statement-breakpoint
CREATE INDEX "tenant_role_bindings_tenant_idx" ON "tenant_role_bindings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_role_bindings_tenant_role_idx" ON "tenant_role_bindings" USING btree ("tenant_id","role_id");--> statement-breakpoint
CREATE INDEX "tenant_role_bindings_tenant_subject_idx" ON "tenant_role_bindings" USING btree ("tenant_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "tenant_role_bindings_tenant_active_idx" ON "tenant_role_bindings" USING btree ("tenant_id","revoked_at","expires_at");--> statement-breakpoint
CREATE INDEX "tenant_role_permissions_tenant_idx" ON "tenant_role_permissions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_role_permissions_tenant_role_idx" ON "tenant_role_permissions" USING btree ("tenant_id","role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_roles_tenant_name_unique" ON "tenant_roles" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "tenant_roles_tenant_idx" ON "tenant_roles" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_roles_tenant_status_idx" ON "tenant_roles" USING btree ("tenant_id","status");