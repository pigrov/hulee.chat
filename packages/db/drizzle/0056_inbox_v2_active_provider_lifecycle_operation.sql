-- INBOX_V2_ACTIVE_PROVIDER_LIFECYCLE_MIGRATION_FINALIZED_V1
CREATE UNIQUE INDEX "inbox_v2_provider_lifecycle_active_message_unique" ON "inbox_v2_message_provider_lifecycle_operations" USING btree ("tenant_id","message_id") WHERE "inbox_v2_message_provider_lifecycle_operations"."origin" = 'hulee_requested'
          and "inbox_v2_message_provider_lifecycle_operations"."outcome" in (
            'pending', 'accepted', 'outcome_unknown'
          );
