CREATE TABLE "deployment_egress_status_snapshots" (
	"profile_id" text PRIMARY KEY NOT NULL,
	"profile_kind" text NOT NULL,
	"status" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"last_ready_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"alert_severity" text DEFAULT 'none' NOT NULL,
	"last_error_code" text,
	"operator_hint" text,
	"public_ip" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "deployment_egress_status_checked_idx" ON "deployment_egress_status_snapshots" USING btree ("checked_at");--> statement-breakpoint
CREATE INDEX "deployment_egress_status_status_idx" ON "deployment_egress_status_snapshots" USING btree ("status");
