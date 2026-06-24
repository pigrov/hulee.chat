CREATE TABLE "employee_org_unit_memberships" (
	"tenant_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"org_unit_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_org_unit_memberships_tenant_id_employee_id_org_unit_id_pk" PRIMARY KEY("tenant_id","employee_id","org_unit_id")
);
--> statement-breakpoint
CREATE TABLE "employee_work_queue_memberships" (
	"tenant_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"work_queue_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_work_queue_memberships_tenant_id_employee_id_work_queue_id_pk" PRIMARY KEY("tenant_id","employee_id","work_queue_id")
);
--> statement-breakpoint
ALTER TABLE "employee_org_unit_memberships" ADD CONSTRAINT "employee_org_unit_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_org_unit_memberships" ADD CONSTRAINT "employee_org_unit_memberships_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_org_unit_memberships" ADD CONSTRAINT "employee_org_unit_memberships_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_work_queue_memberships" ADD CONSTRAINT "employee_work_queue_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_work_queue_memberships" ADD CONSTRAINT "employee_work_queue_memberships_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_work_queue_memberships" ADD CONSTRAINT "employee_work_queue_memberships_work_queue_id_work_queues_id_fk" FOREIGN KEY ("work_queue_id") REFERENCES "public"."work_queues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_org_unit_memberships_tenant_idx" ON "employee_org_unit_memberships" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "employee_org_unit_memberships_tenant_employee_idx" ON "employee_org_unit_memberships" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "employee_org_unit_memberships_tenant_org_unit_idx" ON "employee_org_unit_memberships" USING btree ("tenant_id","org_unit_id");--> statement-breakpoint
CREATE INDEX "employee_work_queue_memberships_tenant_idx" ON "employee_work_queue_memberships" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "employee_work_queue_memberships_tenant_employee_idx" ON "employee_work_queue_memberships" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "employee_work_queue_memberships_tenant_work_queue_idx" ON "employee_work_queue_memberships" USING btree ("tenant_id","work_queue_id");