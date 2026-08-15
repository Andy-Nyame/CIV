-- Trial configuration is a deliberate singleton and must contain usable values.
ALTER TABLE "TrialConfiguration"
  ADD CONSTRAINT "TrialConfiguration_singleton_check"
    CHECK ("id" = 'GLOBAL'),
  ADD CONSTRAINT "TrialConfiguration_durationDays_check"
    CHECK ("durationDays" BETWEEN 1 AND 365),
  ADD CONSTRAINT "TrialConfiguration_distinct_plans_check"
    CHECK ("trialPlanId" <> "fallbackPlanId");

-- Historical trial records keep valid ranges, limits, and terminal timestamps.
ALTER TABLE "WorkspaceTrial"
  ADD CONSTRAINT "WorkspaceTrial_date_range_check"
    CHECK ("endsAt" > "startsAt"),
  ADD CONSTRAINT "WorkspaceTrial_member_limit_check"
    CHECK ("trialMemberLimitSnapshot" IS NULL OR "trialMemberLimitSnapshot" > 0),
  ADD CONSTRAINT "WorkspaceTrial_document_limit_check"
    CHECK ("trialDocumentLimitSnapshot" IS NULL OR "trialDocumentLimitSnapshot" > 0),
  ADD CONSTRAINT "WorkspaceTrial_status_timestamp_check"
    CHECK (
      ("status" = 'ACTIVE' AND "expiredAt" IS NULL AND "cancelledAt" IS NULL AND "convertedAt" IS NULL)
      OR ("status" = 'EXPIRED' AND "expiredAt" IS NOT NULL AND "cancelledAt" IS NULL AND "convertedAt" IS NULL)
      OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "expiredAt" IS NULL AND "convertedAt" IS NULL)
      OR ("status" = 'CONVERTED' AND "convertedAt" IS NOT NULL AND "expiredAt" IS NULL AND "cancelledAt" IS NULL)
    );
