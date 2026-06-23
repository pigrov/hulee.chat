CREATE TABLE "auth_rate_limit_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "auth_rate_limit_buckets_reset_idx" ON "auth_rate_limit_buckets" USING btree ("reset_at");