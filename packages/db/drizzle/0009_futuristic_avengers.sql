CREATE TABLE "org_units" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"parent_org_unit_id" text,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_queues" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"owning_org_unit_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"routing_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_queues" ADD CONSTRAINT "work_queues_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_units_tenant_name_unique" ON "org_units" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "org_units_tenant_idx" ON "org_units" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "org_units_tenant_parent_idx" ON "org_units" USING btree ("tenant_id","parent_org_unit_id");--> statement-breakpoint
CREATE INDEX "org_units_tenant_status_idx" ON "org_units" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "work_queues_tenant_name_unique" ON "work_queues" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "work_queues_tenant_idx" ON "work_queues" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "work_queues_tenant_kind_idx" ON "work_queues" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE INDEX "work_queues_tenant_org_unit_idx" ON "work_queues" USING btree ("tenant_id","owning_org_unit_id");--> statement-breakpoint
CREATE INDEX "work_queues_tenant_status_idx" ON "work_queues" USING btree ("tenant_id","status");