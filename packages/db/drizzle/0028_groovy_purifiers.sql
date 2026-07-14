CREATE TYPE "public"."inbox_v2_conversation_lifecycle" AS ENUM('active', 'ended');--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_conversation_topology" AS ENUM('direct', 'group', 'case', 'object');--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_conversation_transport" AS ENUM('internal', 'external');--> statement-breakpoint
CREATE TABLE "inbox_v2_conversation_heads" (
	"tenant_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"latest_timeline_sequence" bigint DEFAULT 0 NOT NULL,
	"latest_activity_item_id" text,
	"latest_activity_timeline_sequence" bigint,
	"latest_activity_at" timestamp (3) with time zone,
	"revision" bigint DEFAULT 1 NOT NULL,
	"last_changed_stream_position" bigint NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_v2_conversation_heads_pk" PRIMARY KEY("tenant_id","conversation_id"),
	CONSTRAINT "inbox_v2_conversation_heads_timeline_sequence_check" CHECK ("inbox_v2_conversation_heads"."latest_timeline_sequence" >= 0),
	CONSTRAINT "inbox_v2_conversation_heads_activity_tuple_check" CHECK ((
        "inbox_v2_conversation_heads"."latest_activity_item_id" is null
        and "inbox_v2_conversation_heads"."latest_activity_timeline_sequence" is null
        and "inbox_v2_conversation_heads"."latest_activity_at" is null
      ) or (
        "inbox_v2_conversation_heads"."latest_activity_item_id" is not null
        and "inbox_v2_conversation_heads"."latest_activity_timeline_sequence" is not null
        and "inbox_v2_conversation_heads"."latest_activity_at" is not null
      )),
	CONSTRAINT "inbox_v2_conversation_heads_activity_item_check" CHECK ("inbox_v2_conversation_heads"."latest_activity_item_id" is null or (
        char_length("inbox_v2_conversation_heads"."latest_activity_item_id") <= 256
        and "inbox_v2_conversation_heads"."latest_activity_item_id" ~ '^timeline_item:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'
      )),
	CONSTRAINT "inbox_v2_conversation_heads_activity_sequence_check" CHECK ("inbox_v2_conversation_heads"."latest_activity_timeline_sequence" is null or (
        "inbox_v2_conversation_heads"."latest_activity_timeline_sequence" >= 1
        and "inbox_v2_conversation_heads"."latest_activity_timeline_sequence" <= "inbox_v2_conversation_heads"."latest_timeline_sequence"
      )),
	CONSTRAINT "inbox_v2_conversation_heads_revision_check" CHECK ("inbox_v2_conversation_heads"."revision" >= 1),
	CONSTRAINT "inbox_v2_conversation_heads_stream_position_check" CHECK ("inbox_v2_conversation_heads"."last_changed_stream_position" >= 1),
	CONSTRAINT "inbox_v2_conversation_heads_timestamps_check" CHECK (isfinite("inbox_v2_conversation_heads"."created_at")
        and isfinite("inbox_v2_conversation_heads"."updated_at")
        and ("inbox_v2_conversation_heads"."latest_activity_at" is null or isfinite("inbox_v2_conversation_heads"."latest_activity_at"))
        and "inbox_v2_conversation_heads"."updated_at" >= "inbox_v2_conversation_heads"."created_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_conversations" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"topology" "inbox_v2_conversation_topology" NOT NULL,
	"transport" "inbox_v2_conversation_transport" NOT NULL,
	"purpose_id" text NOT NULL,
	"lifecycle" "inbox_v2_conversation_lifecycle" DEFAULT 'active' NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"last_changed_stream_position" bigint NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_v2_conversations_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_conversations_purpose_format_check" CHECK (char_length("inbox_v2_conversations"."purpose_id") <= 256 and (
        (
          "inbox_v2_conversations"."purpose_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
          and char_length(split_part("inbox_v2_conversations"."purpose_id", ':', 2)) <= 160
        ) or (
          "inbox_v2_conversations"."purpose_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
          and char_length(split_part("inbox_v2_conversations"."purpose_id", ':', 2)) <= 80
          and char_length(split_part("inbox_v2_conversations"."purpose_id", ':', 3)) <= 160
          and split_part("inbox_v2_conversations"."purpose_id", ':', 2) not in (
            'core', 'hulee', 'module', 'platform', 'system'
          )
        )
      )),
	CONSTRAINT "inbox_v2_conversations_revision_check" CHECK ("inbox_v2_conversations"."revision" >= 1),
	CONSTRAINT "inbox_v2_conversations_stream_position_check" CHECK ("inbox_v2_conversations"."last_changed_stream_position" >= 1),
	CONSTRAINT "inbox_v2_conversations_timestamps_check" CHECK (isfinite("inbox_v2_conversations"."created_at")
        and isfinite("inbox_v2_conversations"."updated_at")
        and "inbox_v2_conversations"."updated_at" >= "inbox_v2_conversations"."created_at")
);
--> statement-breakpoint
ALTER TABLE "inbox_v2_conversation_heads" ADD CONSTRAINT "inbox_v2_conversation_heads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_conversation_heads" ADD CONSTRAINT "inbox_v2_conversation_heads_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."inbox_v2_conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_conversations" ADD CONSTRAINT "inbox_v2_conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_v2_conversation_heads_tenant_activity_idx" ON "inbox_v2_conversation_heads" USING btree ("tenant_id","latest_activity_at" DESC NULLS LAST,"conversation_id");--> statement-breakpoint
CREATE INDEX "inbox_v2_conversation_heads_tenant_updated_idx" ON "inbox_v2_conversation_heads" USING btree ("tenant_id","updated_at" DESC NULLS LAST,"conversation_id");--> statement-breakpoint
CREATE INDEX "inbox_v2_conversation_heads_tenant_stream_idx" ON "inbox_v2_conversation_heads" USING btree ("tenant_id","last_changed_stream_position","conversation_id");--> statement-breakpoint
CREATE INDEX "inbox_v2_conversations_tenant_lifecycle_updated_idx" ON "inbox_v2_conversations" USING btree ("tenant_id","lifecycle","updated_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "inbox_v2_conversations_tenant_shape_updated_idx" ON "inbox_v2_conversations" USING btree ("tenant_id","transport","topology","lifecycle","updated_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "inbox_v2_conversations_tenant_purpose_updated_idx" ON "inbox_v2_conversations" USING btree ("tenant_id","purpose_id","lifecycle","updated_at" DESC NULLS LAST,"id");