CREATE TABLE "tenant_secrets" (
	"tenant_id" text NOT NULL,
	"secret_ref" text NOT NULL,
	"purpose" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"encryption_key_ref" text DEFAULT 'local' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_secrets_tenant_id_secret_ref_pk" PRIMARY KEY("tenant_id","secret_ref")
);
--> statement-breakpoint
ALTER TABLE "tenant_secrets" ADD CONSTRAINT "tenant_secrets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_secrets_tenant_idx" ON "tenant_secrets" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_secrets_tenant_purpose_idx" ON "tenant_secrets" USING btree ("tenant_id","purpose");