ALTER TABLE "conversations" ADD COLUMN "current_queue_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "assigned_employee_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "assigned_team_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_current_queue_id_work_queues_id_fk" FOREIGN KEY ("current_queue_id") REFERENCES "public"."work_queues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_employee_id_employees_id_fk" FOREIGN KEY ("assigned_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_team_id_teams_id_fk" FOREIGN KEY ("assigned_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_tenant_queue_idx" ON "conversations" USING btree ("tenant_id","current_queue_id");--> statement-breakpoint
CREATE INDEX "conversations_tenant_assigned_employee_idx" ON "conversations" USING btree ("tenant_id","assigned_employee_id");--> statement-breakpoint
CREATE INDEX "conversations_tenant_assigned_team_idx" ON "conversations" USING btree ("tenant_id","assigned_team_id");