import { describe, expect, it } from "vitest";

import type {
  NormalizedInboundEventId,
  RawInboundEventId,
  SourceAccountId,
  SourceConnectionId,
  TenantId
} from "./index";
import {
  normalizeSourceIdentityCandidates,
  normalizeSourceIdentityResolverInput,
  sourceIdentityResolverInputSchema
} from "./source-identity";

const tenantId = "tenant_source" as TenantId;
const sourceConnectionId = "source_connection:telegram:1" as SourceConnectionId;
const sourceAccountId = "source_account:telegram:bot" as SourceAccountId;
const rawEventId = "raw_evt_1" as RawInboundEventId;
const normalizedEventId = "norm_evt_1" as NormalizedInboundEventId;

describe("source identity resolver input", () => {
  it("normalizes source context and identity candidates for resolver handoff", () => {
    expect(
      normalizeSourceIdentityResolverInput({
        tenantId,
        sourceConnectionId,
        sourceAccountId,
        sourceType: "messenger",
        sourceName: "telegram_user_session",
        sourceEventType: "message",
        sourceVisibility: "private",
        externalThreadId: "thread-1",
        externalUserId: "tg-user-100",
        rawEventId,
        normalizedEventId,
        occurredAt: new Date("2026-07-09T08:00:00.000Z"),
        candidates: [
          {
            kind: "username",
            value: "@customer",
            confidence: "strong",
            sourceField: "from.username"
          },
          {
            kind: "phone",
            value: "+79990000000",
            confidence: "verified",
            sourceField: "contact.phone"
          },
          {
            kind: "phone",
            value: "+79990000000",
            confidence: "weak",
            sourceField: "message.text"
          }
        ],
        profileSnapshot: {
          firstName: "Dmitry"
        }
      })
    ).toEqual({
      tenantId,
      sourceConnectionId,
      sourceAccountId,
      sourceType: "messenger",
      sourceName: "telegram_user_session",
      sourceEventType: "message",
      sourceVisibility: "private",
      externalThreadId: "thread-1",
      externalUserId: "tg-user-100",
      rawEventId,
      normalizedEventId,
      occurredAt: "2026-07-09T08:00:00.000Z",
      candidates: [
        {
          kind: "phone",
          value: "+79990000000",
          confidence: "verified",
          sourceField: "contact.phone"
        },
        {
          kind: "external_user",
          value: "tg-user-100",
          confidence: "strong",
          sourceField: "externalUserId"
        },
        {
          kind: "username",
          value: "@customer",
          confidence: "strong",
          sourceField: "from.username"
        }
      ],
      profileSnapshot: {
        firstName: "Dmitry"
      }
    });
  });

  it("deduplicates candidates and keeps the highest confidence value", () => {
    expect(
      normalizeSourceIdentityCandidates([
        {
          kind: "email",
          value: "Customer@Example.test",
          confidence: "weak"
        },
        {
          kind: "email",
          value: "customer@example.test",
          confidence: "verified",
          sourceField: "profile.email"
        },
        {
          kind: "display_name",
          value: "Customer",
          confidence: "weak"
        }
      ])
    ).toEqual([
      {
        kind: "email",
        value: "customer@example.test",
        confidence: "verified",
        sourceField: "profile.email"
      },
      {
        kind: "display_name",
        value: "Customer",
        confidence: "weak"
      }
    ]);
  });

  it("rejects resolver inputs without usable identity candidates", () => {
    expect(() =>
      normalizeSourceIdentityResolverInput({
        tenantId,
        sourceConnectionId,
        sourceType: "form",
        sourceName: "website_form",
        sourceEventType: "lead",
        sourceVisibility: "private",
        candidates: [
          {
            kind: "display_name",
            value: " "
          }
        ]
      })
    ).toThrow();
  });

  it("validates resolver input shape at the contract boundary", () => {
    expect(() =>
      sourceIdentityResolverInputSchema.parse({
        tenantId,
        sourceConnectionId,
        sourceType: "messenger",
        sourceName: "telegram",
        sourceEventType: "message",
        sourceVisibility: "private",
        candidates: [
          {
            kind: "unknown",
            value: "customer"
          }
        ]
      })
    ).toThrow();
  });
});
