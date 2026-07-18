CREATE TYPE "public"."inbox_v2_conversation_work_outcome" AS ENUM('pending_intake', 'no_work_item', 'create_work_item');--> statement-breakpoint
CREATE TABLE "inbox_v2_conversation_work_heads" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"work_item_count" bigint NOT NULL,
	"current_outcome" "inbox_v2_conversation_work_outcome" NOT NULL,
	"intake_decision_high_water" bigint NOT NULL,
	"pending_materialization_ordinal" bigint,
	"revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_conversation_work_heads_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_conversation_work_heads_conversation_unique" UNIQUE("tenant_id","conversation_id"),
	CONSTRAINT "inbox_v2_conversation_work_heads_identity_check" CHECK ("inbox_v2_conversation_work_heads"."id" = 'conversation_work_head:' || encode(
        sha256(("inbox_v2_conversation_work_heads"."tenant_id" || chr(31) || "inbox_v2_conversation_work_heads"."conversation_id")::bytea),
        'hex'
      )),
	CONSTRAINT "inbox_v2_conversation_work_heads_state_check" CHECK ("inbox_v2_conversation_work_heads"."work_item_count" >= 0
        and "inbox_v2_conversation_work_heads"."intake_decision_high_water" >= 0
        and "inbox_v2_conversation_work_heads"."revision" =
          1 + "inbox_v2_conversation_work_heads"."intake_decision_high_water" + "inbox_v2_conversation_work_heads"."work_item_count"
        and "inbox_v2_conversation_work_heads"."intake_decision_high_water" >= "inbox_v2_conversation_work_heads"."work_item_count"
        and ("inbox_v2_conversation_work_heads"."pending_materialization_ordinal" is null
          or ("inbox_v2_conversation_work_heads"."current_outcome" = 'create_work_item'
            and "inbox_v2_conversation_work_heads"."pending_materialization_ordinal" = "inbox_v2_conversation_work_heads"."work_item_count" + 1
            and "inbox_v2_conversation_work_heads"."intake_decision_high_water" >= "inbox_v2_conversation_work_heads"."pending_materialization_ordinal"))
        and (
          ("inbox_v2_conversation_work_heads"."current_outcome" = 'pending_intake'
            and "inbox_v2_conversation_work_heads"."work_item_count" = 0
            and "inbox_v2_conversation_work_heads"."intake_decision_high_water" = 0
            and "inbox_v2_conversation_work_heads"."pending_materialization_ordinal" is null)
          or ("inbox_v2_conversation_work_heads"."current_outcome" = 'no_work_item'
            and "inbox_v2_conversation_work_heads"."work_item_count" = 0
            and "inbox_v2_conversation_work_heads"."intake_decision_high_water" >= 1
            and "inbox_v2_conversation_work_heads"."pending_materialization_ordinal" is null)
          or ("inbox_v2_conversation_work_heads"."current_outcome" = 'create_work_item'
            and "inbox_v2_conversation_work_heads"."intake_decision_high_water" >= 1)
        )),
	CONSTRAINT "inbox_v2_conversation_work_heads_timestamps_check" CHECK (isfinite("inbox_v2_conversation_work_heads"."created_at")
        and isfinite("inbox_v2_conversation_work_heads"."updated_at")
        and "inbox_v2_conversation_work_heads"."updated_at" >= "inbox_v2_conversation_work_heads"."created_at")
);
--> statement-breakpoint
ALTER TABLE "inbox_v2_conversation_work_heads" ADD CONSTRAINT "inbox_v2_conversation_work_heads_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."inbox_v2_conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_v2_conversation_work_heads_state_idx" ON "inbox_v2_conversation_work_heads" USING btree ("tenant_id","current_outcome","intake_decision_high_water","conversation_id");--> statement-breakpoint
-- INB2-MSG-002_CONVERSATION_WORK_HEAD_V1
INSERT INTO public.inbox_v2_conversation_work_heads (
  tenant_id,
  id,
  conversation_id,
  work_item_count,
  current_outcome,
  intake_decision_high_water,
  pending_materialization_ordinal,
  revision,
  created_at,
  updated_at
)
SELECT
  c.tenant_id,
  'conversation_work_head:' || encode(
    sha256((c.tenant_id || chr(31) || c.id)::bytea),
    'hex'
  ),
  c.id,
  count(w.id),
  CASE WHEN count(w.id) = 0
    THEN 'pending_intake'::public.inbox_v2_conversation_work_outcome
    ELSE 'create_work_item'::public.inbox_v2_conversation_work_outcome
  END,
  count(w.id),
  null,
  1 + (2 * count(w.id)),
  c.created_at,
  greatest(c.created_at, coalesce(max(d.decided_at), c.created_at))
FROM public.inbox_v2_conversations c
LEFT JOIN public.inbox_v2_work_items w
  ON w.tenant_id = c.tenant_id AND w.conversation_id = c.id
LEFT JOIN public.inbox_v2_work_item_creation_decisions d
  ON d.tenant_id = w.tenant_id AND d.work_item_id = w.id
GROUP BY c.tenant_id, c.id, c.created_at
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Acquire capture locks in the canonical legacy writer order. These locks are
-- held to migration commit, so the final reconciliation has no visibility gap
-- and cannot deadlock a Conversation -> WorkItem -> decision transaction.
LOCK TABLE public.inbox_v2_conversations,
  public.inbox_v2_work_items,
  public.inbox_v2_work_item_creation_decisions
  IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.inbox_v2_conversation_work_head_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF tg_op = 'DELETE' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.inbox_v2_conversations c
       WHERE c.tenant_id = old.tenant_id AND c.id = old.conversation_id
    ) THEN
      RETURN old;
    END IF;
    RAISE EXCEPTION 'Conversation Work head cannot be deleted'
      USING errcode = '23514';
  END IF;

  IF tg_op = 'INSERT' THEN
    IF new.work_item_count <> 0
       OR new.current_outcome <> 'pending_intake'
       OR new.intake_decision_high_water <> 0
       OR new.pending_materialization_ordinal IS NOT NULL
       OR new.revision <> 1 THEN
      RAISE EXCEPTION 'Conversation Work head must start pending at revision one'
        USING errcode = '23514';
    END IF;
  ELSIF new.tenant_id IS DISTINCT FROM old.tenant_id
     OR new.id IS DISTINCT FROM old.id
     OR new.conversation_id IS DISTINCT FROM old.conversation_id
     OR new.created_at IS DISTINCT FROM old.created_at
     OR new.updated_at < old.updated_at
     OR NOT (
       (
         new.work_item_count = old.work_item_count
         AND old.pending_materialization_ordinal IS NULL
         AND new.intake_decision_high_water =
            old.intake_decision_high_water + 1
         AND new.revision = old.revision + 1
         AND (
           (new.current_outcome = 'no_work_item'
             AND new.pending_materialization_ordinal IS NULL)
           OR (new.current_outcome = 'create_work_item'
             AND new.pending_materialization_ordinal =
                old.work_item_count + 1)
         )
       ) OR (
         old.current_outcome = 'create_work_item'
         AND new.current_outcome = 'create_work_item'
         AND new.work_item_count = old.work_item_count + 1
         AND new.intake_decision_high_water =
            old.intake_decision_high_water
         AND new.revision = old.revision + 1
         AND old.pending_materialization_ordinal = new.work_item_count
         AND new.pending_materialization_ordinal IS NULL
       ) OR (
         new.current_outcome = 'create_work_item'
         AND new.work_item_count = old.work_item_count + 1
         AND new.intake_decision_high_water =
            old.intake_decision_high_water + 1
         AND new.revision = old.revision + 2
         AND old.pending_materialization_ordinal IS NULL
         AND new.pending_materialization_ordinal IS NULL
       )
     ) THEN
    RAISE EXCEPTION 'Conversation Work head requires one intake or materialization advance'
      USING errcode = '23514';
  END IF;

  RETURN new;
END
$function$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.inbox_v2_conversation_work_head_bootstrap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  INSERT INTO public.inbox_v2_conversation_work_heads (
    tenant_id,
    id,
    conversation_id,
    work_item_count,
    current_outcome,
    intake_decision_high_water,
    pending_materialization_ordinal,
    revision,
    created_at,
    updated_at
  ) VALUES (
    new.tenant_id,
    'conversation_work_head:' || encode(
      sha256((new.tenant_id || chr(31) || new.id)::bytea),
      'hex'
    ),
    new.id,
    0,
    'pending_intake',
    0,
    null,
    1,
    new.created_at,
    new.created_at
  ) ON CONFLICT DO NOTHING;
  RETURN new;
END
$function$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.inbox_v2_conversation_work_head_advance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_ordinal bigint;
BEGIN
  SELECT w.ordinal INTO STRICT v_ordinal
    FROM public.inbox_v2_work_items w
   WHERE w.tenant_id = new.tenant_id AND w.id = new.work_item_id;

  UPDATE public.inbox_v2_conversation_work_heads h
     SET work_item_count = h.work_item_count + 1,
         current_outcome = 'create_work_item',
         intake_decision_high_water = CASE
           WHEN h.pending_materialization_ordinal IS NULL
             THEN h.intake_decision_high_water + 1
           ELSE h.intake_decision_high_water
         END,
         pending_materialization_ordinal = NULL,
         revision = h.revision + CASE
           WHEN h.pending_materialization_ordinal IS NULL THEN 2
           ELSE 1
         END,
         updated_at = greatest(h.updated_at, new.decided_at)
   WHERE h.tenant_id = new.tenant_id
     AND h.conversation_id = new.conversation_id
     AND h.work_item_count = v_ordinal - 1
     AND (
       (h.pending_materialization_ordinal = v_ordinal
         AND h.current_outcome = 'create_work_item'
         AND h.intake_decision_high_water >= v_ordinal)
       OR h.pending_materialization_ordinal IS NULL
     )
     AND h.revision =
       1 + h.intake_decision_high_water + h.work_item_count;
  IF NOT found THEN
    RAISE EXCEPTION 'WorkItem creation lost its Conversation Work head race'
      USING errcode = '40001';
  END IF;
  RETURN new;
END
$function$;--> statement-breakpoint
CREATE TRIGGER inbox_v2_work_creation_head_advance_trigger
AFTER INSERT ON public.inbox_v2_work_item_creation_decisions
FOR EACH ROW EXECUTE FUNCTION public.inbox_v2_conversation_work_head_advance();--> statement-breakpoint
CREATE TRIGGER inbox_v2_conversations_work_head_insert_trigger
AFTER INSERT ON public.inbox_v2_conversations
FOR EACH ROW EXECUTE FUNCTION public.inbox_v2_conversation_work_head_bootstrap();--> statement-breakpoint
-- Close the additive-expand visibility gap after both capture locks are held.
-- Writers that committed before CREATE TRIGGER are included; later writers
-- wait for migration commit and then execute the compatibility trigger.
INSERT INTO public.inbox_v2_conversation_work_heads (
  tenant_id,
  id,
  conversation_id,
  work_item_count,
  current_outcome,
  intake_decision_high_water,
  pending_materialization_ordinal,
  revision,
  created_at,
  updated_at
)
SELECT
  c.tenant_id,
  'conversation_work_head:' || encode(
    sha256((c.tenant_id || chr(31) || c.id)::bytea),
    'hex'
  ),
  c.id,
  count(w.id),
  CASE WHEN count(w.id) = 0
    THEN 'pending_intake'::public.inbox_v2_conversation_work_outcome
    ELSE 'create_work_item'::public.inbox_v2_conversation_work_outcome
  END,
  count(w.id),
  NULL,
  1 + (2 * count(w.id)),
  c.created_at,
  greatest(c.created_at, coalesce(max(d.decided_at), c.created_at))
FROM public.inbox_v2_conversations c
LEFT JOIN public.inbox_v2_work_items w
  ON w.tenant_id = c.tenant_id AND w.conversation_id = c.id
LEFT JOIN public.inbox_v2_work_item_creation_decisions d
  ON d.tenant_id = w.tenant_id AND d.work_item_id = w.id
GROUP BY c.tenant_id, c.id, c.created_at
ON CONFLICT (tenant_id, conversation_id) DO UPDATE
SET work_item_count = excluded.work_item_count,
    current_outcome = excluded.current_outcome,
    intake_decision_high_water = excluded.intake_decision_high_water,
    pending_materialization_ordinal = NULL,
    revision = excluded.revision,
    updated_at = greatest(
      inbox_v2_conversation_work_heads.updated_at,
      excluded.updated_at
    );--> statement-breakpoint
CREATE TRIGGER inbox_v2_conversation_work_heads_guard_trigger
BEFORE INSERT OR UPDATE OR DELETE ON public.inbox_v2_conversation_work_heads
FOR EACH ROW EXECUTE FUNCTION public.inbox_v2_conversation_work_head_guard();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.inbox_v2_conversation_work_head_coherence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_tenant_id text;
  v_conversation_id text;
  v_head public.inbox_v2_conversation_work_heads%rowtype;
  v_work_item_count bigint;
  v_creation_count bigint;
BEGIN
  v_tenant_id := new.tenant_id;
  v_conversation_id := new.conversation_id;

  SELECT * INTO v_head
    FROM public.inbox_v2_conversation_work_heads h
   WHERE h.tenant_id = v_tenant_id
     AND h.conversation_id = v_conversation_id;
  IF NOT found THEN
    RAISE EXCEPTION 'Conversation requires one authoritative Work head'
      USING errcode = '23514';
  END IF;

  SELECT count(*) INTO v_work_item_count
    FROM public.inbox_v2_work_items w
   WHERE w.tenant_id = v_tenant_id
     AND w.conversation_id = v_conversation_id;
  SELECT count(*) INTO v_creation_count
    FROM public.inbox_v2_work_item_creation_decisions d
   WHERE d.tenant_id = v_tenant_id
     AND d.conversation_id = v_conversation_id;

  IF v_head.work_item_count <> v_work_item_count
     OR v_creation_count <> v_work_item_count
     OR v_head.intake_decision_high_water < v_creation_count
     OR v_head.pending_materialization_ordinal IS NOT NULL
     OR (v_work_item_count > 0
       AND v_head.current_outcome <> 'create_work_item') THEN
    RAISE EXCEPTION 'Conversation Work head is not coherent with intake materialization'
      USING errcode = '23514';
  END IF;
  RETURN null;
END
$function$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER inbox_v2_conversation_work_heads_coherence_constraint
AFTER INSERT OR UPDATE ON public.inbox_v2_conversation_work_heads
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.inbox_v2_conversation_work_head_coherence();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER inbox_v2_work_items_head_coherence_constraint
AFTER INSERT ON public.inbox_v2_work_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.inbox_v2_conversation_work_head_coherence();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER inbox_v2_work_creation_head_coherence_constraint
AFTER INSERT ON public.inbox_v2_work_item_creation_decisions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.inbox_v2_conversation_work_head_coherence();
