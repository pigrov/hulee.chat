import { createHmac } from "node:crypto";

import type {
  InboxV2FileAccessSnapshot,
  InboxV2FileObjectPin
} from "@hulee/core";
import { describe, expect, it, vi } from "vitest";

import {
  createInboxV2FileDownloadTicketService,
  InboxV2FileDownloadTicketError,
  type InboxV2FileDownloadAccessRecord,
  type InboxV2FileDownloadAccessRepository,
  type InboxV2FileDownloadPrincipalIdentity
} from "./inbox-v2-file-download-ticket";

const secret = "download-ticket-test-secret-that-is-at-least-32-bytes";
const authorizationEpoch = "11";
const principalIdentity: InboxV2FileDownloadPrincipalIdentity = {
  tenantId: "tenant:one",
  principalId: "employee:one"
};
const pin: InboxV2FileObjectPin = {
  tenantId: principalIdentity.tenantId,
  fileId: "file:one",
  fileRevision: "3",
  fileVersionId: "file_version:one",
  objectVersionId: "file_object_version:one"
};
const parentLinkId = "file_parent_link:one";

function snapshot(): InboxV2FileAccessSnapshot {
  return {
    pin,
    authorizationAction: "view",
    objectState: "ready",
    retentionState: "available",
    activeHoldIds: [],
    retainedPurposeIds: [],
    parentSet: {
      revision: "2",
      completeness: "complete",
      completenessRevision: "2",
      liveParentCount: 1
    },
    parentLinks: [
      {
        tenantId: pin.tenantId,
        linkId: parentLinkId,
        linkRevision: "2",
        fileVersionId: pin.fileVersionId,
        objectVersionId: pin.objectVersionId,
        parentKind: "message",
        parentId: "message:one",
        parentRevision: "7",
        contentRevision: "5",
        blockKey: "attachment-1",
        visibility: "external",
        state: "live",
        current: true,
        permission: "allowed"
      }
    ]
  };
}

function record(
  overrides: Partial<InboxV2FileDownloadAccessRecord> = {}
): InboxV2FileDownloadAccessRecord {
  return {
    currentAuthorizationEpoch: authorizationEpoch,
    snapshot: snapshot(),
    storageRootId: "root:primary",
    storageKey: "tenants/opaque/object-key",
    storageVersionId: "s3-version-17",
    checksumSha256:
      "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    fileName: "photo.jpg",
    mediaType: "image/jpeg",
    sizeBytes: 42,
    ...overrides
  };
}

function repository(
  loader: () => InboxV2FileDownloadAccessRecord | null = () => record()
): InboxV2FileDownloadAccessRepository & {
  loadCurrentAccess: ReturnType<typeof vi.fn>;
} {
  return { loadCurrentAccess: vi.fn(async () => loader()) };
}

function resignTicket(
  ticket: string,
  mutate: (payload: Record<string, unknown>) => Record<string, unknown>
): string {
  const [payloadPart] = ticket.split(".");
  const payload = JSON.parse(
    Buffer.from(payloadPart!, "base64url").toString("utf8")
  ) as Record<string, unknown>;
  const mutatedPayloadPart = Buffer.from(
    JSON.stringify(mutate(payload)),
    "utf8"
  ).toString("base64url");
  const signature = createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(mutatedPayloadPart, "utf8")
    .digest("base64url");
  return `${mutatedPayloadPart}.${signature}`;
}

describe("Inbox V2 file download tickets", () => {
  it("keeps storage coordinates out of the ticket and reauthorizes on redeem", async () => {
    const repo = repository();
    const service = createInboxV2FileDownloadTicketService({
      repository: repo,
      secret,
      now: () => new Date("2026-07-18T12:00:00.000Z"),
      nonce: () => "fixed-download-ticket-nonce"
    });

    const issued = await service.issue(principalIdentity, {
      pin,
      parentLinkId
    });
    expect(issued.ticket).not.toContain("tenants/opaque/object-key");
    expect(issued.downloadUrl).not.toContain("tenants/opaque/object-key");
    await expect(
      service.redeem(principalIdentity, { ticket: issued.ticket })
    ).resolves.toMatchObject({
      pin,
      storageRootId: "root:primary",
      storageKey: "tenants/opaque/object-key",
      storageVersionId: "s3-version-17",
      checksumSha256:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000"
    });
    expect(repo.loadCurrentAccess).toHaveBeenCalledTimes(2);
    expect(repo.loadCurrentAccess).toHaveBeenLastCalledWith({
      principal: principalIdentity,
      pin,
      parentLinkId
    });
  });

  it("rejects a modified ticket before loading current access", async () => {
    const repo = repository();
    const service = createInboxV2FileDownloadTicketService({
      repository: repo,
      secret,
      now: () => new Date("2026-07-18T12:00:00.000Z"),
      nonce: () => "fixed-download-ticket-nonce"
    });
    const issued = await service.issue(principalIdentity, {
      pin,
      parentLinkId
    });
    repo.loadCurrentAccess.mockClear();

    await expect(
      service.redeem(principalIdentity, {
        ticket: `${issued.ticket.slice(0, -1)}x`
      })
    ).rejects.toEqual(new InboxV2FileDownloadTicketError("ticket_invalid"));
    expect(repo.loadCurrentAccess).not.toHaveBeenCalled();
  });

  it("rejects validly signed non-canonical payloads before repository access", async () => {
    const repo = repository();
    const service = createInboxV2FileDownloadTicketService({
      repository: repo,
      secret,
      now: () => new Date("2026-07-18T12:00:00.000Z"),
      nonce: () => "fixed-download-ticket-nonce"
    });
    const issued = await service.issue(principalIdentity, {
      pin,
      parentLinkId
    });
    repo.loadCurrentAccess.mockClear();

    const tickets = [
      resignTicket(issued.ticket, (payload) => ({
        ...payload,
        unexpectedAuthority: true
      })),
      resignTicket(issued.ticket, (payload) => ({
        ...payload,
        expiresAtMs: (payload.issuedAtMs as number) + 301_000
      })),
      resignTicket(issued.ticket, (payload) => ({
        ...payload,
        pin: {
          ...(payload.pin as Record<string, unknown>),
          storageKey: "must-not-be-accepted"
        }
      }))
    ];

    for (const ticket of tickets) {
      await expect(
        service.redeem(principalIdentity, { ticket })
      ).rejects.toEqual(new InboxV2FileDownloadTicketError("ticket_invalid"));
    }
    expect(repo.loadCurrentAccess).not.toHaveBeenCalled();
  });

  it("rejects expiration and a different principal before repository access", async () => {
    let current = new Date("2026-07-18T12:00:00.000Z");
    const repo = repository();
    const service = createInboxV2FileDownloadTicketService({
      repository: repo,
      secret,
      ttlSeconds: 10,
      now: () => current,
      nonce: () => "fixed-download-ticket-nonce"
    });
    const issued = await service.issue(principalIdentity, {
      pin,
      parentLinkId
    });
    repo.loadCurrentAccess.mockClear();

    await expect(
      service.redeem(
        { ...principalIdentity, principalId: "employee:two" },
        { ticket: issued.ticket }
      )
    ).rejects.toEqual(
      new InboxV2FileDownloadTicketError("ticket_principal_mismatch")
    );
    current = new Date("2026-07-18T12:00:11.000Z");
    await expect(
      service.redeem(principalIdentity, { ticket: issued.ticket })
    ).rejects.toEqual(new InboxV2FileDownloadTicketError("ticket_expired"));
    expect(repo.loadCurrentAccess).not.toHaveBeenCalled();
  });

  it("fails redemption when permission or current visibility was revoked", async () => {
    let current = record();
    const repo = repository(() => current);
    const service = createInboxV2FileDownloadTicketService({
      repository: repo,
      secret,
      now: () => new Date("2026-07-18T12:00:00.000Z"),
      nonce: () => "fixed-download-ticket-nonce"
    });
    const issued = await service.issue(principalIdentity, {
      pin,
      parentLinkId
    });
    current = record({
      snapshot: {
        ...snapshot(),
        parentLinks: [{ ...snapshot().parentLinks[0]!, permission: "denied" }]
      }
    });

    await expect(
      service.redeem(principalIdentity, { ticket: issued.ticket })
    ).rejects.toEqual(new InboxV2FileDownloadTicketError("file_access_denied"));
  });

  it.each([
    ["quarantined object", { objectState: "quarantined" as const }],
    ["expired retention", { retentionState: "expired" as const }]
  ])("fails redemption after %s", async (_label, snapshotOverride) => {
    let current = record();
    const repo = repository(() => current);
    const service = createInboxV2FileDownloadTicketService({
      repository: repo,
      secret,
      now: () => new Date("2026-07-18T12:00:00.000Z"),
      nonce: () => "fixed-download-ticket-nonce"
    });
    const issued = await service.issue(principalIdentity, {
      pin,
      parentLinkId
    });
    current = record({
      snapshot: { ...snapshot(), ...snapshotOverride }
    });

    await expect(
      service.redeem(principalIdentity, { ticket: issued.ticket })
    ).rejects.toEqual(new InboxV2FileDownloadTicketError("file_access_denied"));
  });

  it("fails on parent/content revision drift after the URL was issued", async () => {
    let current = record();
    const repo = repository(() => current);
    const service = createInboxV2FileDownloadTicketService({
      repository: repo,
      secret,
      now: () => new Date("2026-07-18T12:00:00.000Z"),
      nonce: () => "fixed-download-ticket-nonce"
    });
    const issued = await service.issue(principalIdentity, {
      pin,
      parentLinkId
    });
    current = record({
      snapshot: {
        ...snapshot(),
        parentLinks: [{ ...snapshot().parentLinks[0]!, contentRevision: "6" }]
      }
    });

    await expect(
      service.redeem(principalIdentity, { ticket: issued.ticket })
    ).rejects.toEqual(new InboxV2FileDownloadTicketError("file_state_changed"));
  });

  it("binds issuance and redemption to the current authorization epoch", async () => {
    let current = record();
    const repo = repository(() => current);
    const service = createInboxV2FileDownloadTicketService({
      repository: repo,
      secret,
      now: () => new Date("2026-07-18T12:00:00.000Z"),
      nonce: () => "fixed-download-ticket-nonce"
    });
    const issued = await service.issue(principalIdentity, {
      pin,
      parentLinkId
    });
    current = record({ currentAuthorizationEpoch: "12" });

    await expect(
      service.redeem(principalIdentity, { ticket: issued.ticket })
    ).rejects.toEqual(
      new InboxV2FileDownloadTicketError("ticket_authorization_stale")
    );
  });
});
