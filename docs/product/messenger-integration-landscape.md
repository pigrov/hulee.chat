# Messenger Integration Landscape

Status: architecture research baseline  
Last verified: 2026-07-10  
Scope: messenger access models relevant to Inbox V2; this document is not a
release commitment or a substitute for a signed provider/partner contract.

## Scope And Evidence Policy

Hulee evaluates a provider surface, not a messenger brand as a whole. A consumer
desktop client, chatbot API, phone-addressed business API and compliance archive
can expose completely different identities, conversations, history and reply
rights even when all of them use the same brand name.

A surface can enter the production catalog only when provider permission and a
programmable support boundary are established by at least one of:

- a current public provider API and terms;
- a provider-approved SDK;
- a signed partner/private API contract whose relevant behavior can be tested.

That provider authority is necessary but not sufficient: Hulee-owned contract
fixtures and live smoke evidence must also prove the capability profile for the
exact surface. Tests can prove behavior; they cannot grant legal or commercial
permission.

Installing a consumer web/desktop client, scanning its QR code, or observing a
native UI does not prove that an integration API exists. Search results,
third-party automation products and the behavior of another Hulee/RIK adapter
are discovery evidence only.

The research statuses used below are:

- `supported`: an official programmable surface is publicly documented;
- `commercial_approval`: an official public surface exists, but provider review,
  billing or account approval is required directly or through a partner;
- `partner_required`: an official surface exists, but partner access or a
  private specification is required before implementation;
- `unsupported`: no permitted programmable surface was found for this use case;
- `research`: promising, but the exact contract, region or commercial access
  still needs validation.

## Integration Access Models

| Access model                     | Meaning                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| `personal_session_bridge`        | Hulee connects a normal user account and observes the same private/group realm as that account. |
| `official_business_account`      | A bot, official account or business identity communicates through a supported provider API.     |
| `phone_addressed_business_agent` | A verified business communicates with consented customers addressed by phone or provider ID.    |
| `workspace_or_community_app`     | An app/bot participates in an enterprise, workspace or community conversation.                  |
| `archive_or_compliance_feed`     | A licensed/consented read path exposes history; it is not an outbound messaging identity.       |

These models are not interchangeable. In particular, an official bot does not
give Hulee access to the administrator's private dialogs, and an archive does
not authorize sending as an employee.

## Provider Surface Matrix

`Unknown` means that Hulee must not advertise or infer the capability until the
provider contract or a sandbox proves it.

| Provider surface                 | Access model                     | Private/1:1                                                       | Groups and roster                                            | History and receipts                                                          | Hulee status          |
| -------------------------------- | -------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------- | --------------------- |
| `viber_consumer_desktop_session` | `personal_session_bridge`        | Native client can use normal dialogs; no supported server API     | Native client supports groups; no published integration API  | Interactive device sync only; no API cursor/backfill                          | `unsupported`         |
| `viber_chatbot`                  | `official_business_account`      | Bot-to-subscriber 1:1 through token, webhook and REST API         | No private user-group surface in the published Bot API       | No published history-fetch endpoint; delivered/seen for outbound bot messages | `commercial_approval` |
| `viber_business_messages`        | `phone_addressed_business_agent` | Consent-based business/customer 1:1 through an official partner   | No private user-group synchronization promised               | Partner contract must define history/status behavior                          | `partner_required`    |
| `wechat_consumer_session`        | `personal_session_bridge`        | Normal client behavior; no public personal-account integration    | Normal client behavior; no supported group inbox API found   | No supported personal-account history/event contract                          | `unsupported`         |
| `wechat_official_account`        | `official_business_account`      | Follower/customer-service messaging under account/API rules       | Not a personal group-chat bridge                             | Service-window and account-level API rules apply                              | `supported`           |
| `wechat_customer_service`        | `official_business_account`      | WeChat Customer Service through a verified WeCom enterprise       | Not a personal group-chat bridge                             | API/sandbox validation required per selected account type                     | `supported`           |
| `wecom_customer_groups`          | `workspace_or_community_app`     | Customer-contact surface                                          | Group metadata and roster APIs; not a free-form send-as-user | Not a complete live message transport by itself                               | `research`            |
| `wecom_archive`                  | `archive_or_compliance_feed`     | Licensed and consent-dependent read path                          | Can expose eligible archived conversations                   | Read/archive semantics; never infer outbound permission                       | `research`            |
| `imo_consumer_web_session`       | `personal_session_bridge`        | Consumer web/desktop access only; no public integration API found | Consumer UI capability is not a programmable group contract  | No supported event/history contract found                                     | `unsupported`         |
| `imo_business`                   | `official_business_account`      | Official-account offering has been announced in limited markets   | Public group/inbox API contract not found                    | Webhooks/history/receipts remain unknown                                      | `partner_required`    |

## Viber Decision

### Can Hulee Follow The WhatsApp/MAX Path?

Only at the platform-shell level.

Current Hulee code can reuse tenant-scoped connector/session/challenge
persistence, encrypted session storage, leases, heartbeats, provider auth/probe
handler contracts, diagnostics and `SourceConnection`/`SourceAccount`
synchronization. Raw-event ingestion, `SourceThreadBinding` resolution,
route-pinned dispatch and outbox processing are target Inbox V2 boundaries; they
are not yet wired to long-running TG/WA/MAX direct-account message listeners and
dispatchers.

The shared challenge contract covers QR, phone, code and password shapes, but a
new provider surface still needs explicit type/schema, catalog, i18n, worker
composition, egress and allowlist changes. This is an extension seam, not
runtime plug-in discovery; provider-specific branching stays outside Inbox core.

The provider transport is not reusable:

| Boundary             | WhatsApp transport evidence in current Hulee                                             | MAX transport evidence in current Hulee                           | Viber consumer account                                 |
| -------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------ |
| Pairing              | Baileys QR/link-code API                                                                 | Provider-specific phone/code/password transport                   | QR pairs the official Desktop as a secondary device    |
| Session              | Serializable credentials and Signal key store                                            | Token/device/viewer state                                         | No published portable server-session format            |
| Event stream         | Baileys exposes socket events; Inbox listener is not composed                            | Socket/opcodes support auth/probe; Inbox listener is not composed | No supported callback/socket SDK for normal accounts   |
| Groups/history       | Transport/RIK evidence only; V2 parity is unverified and auth disables full-history sync | Transport/RIK evidence only; V2 parity is unverified              | Visible in the GUI, but no stable integration contract |
| Reconnect/diagnostic | Programmatic disconnect codes and session probes                                         | Hulee-owned provider-specific auth/probe recovery                 | Internal Desktop behavior with no integration SLA      |

WhatsApp is not a proof that every desktop QR flow is integratable: Hulee has a
specific Baileys auth/probe transport with event and session abstractions. MAX
likewise has a separate provider-specific auth/probe transport. These are
transport foundations, not completed Hulee Inbox direct-message flows. No
maintained Viber personal-account equivalent was found in the official Viber
GitHub organization, broader GitHub repository search or npm registry during the
2026-07-10 review.

The production decision is therefore:

1. Do not add or advertise `viber_qr_bridge`/`viber_personal_bridge` as a
   production connector.
2. Plan `viber_chatbot` as a token/webhook official-business adapter that needs
   commercial approval through direct Viber review or an official partner.
3. Plan `viber_business_messages` as a separate partner-backed,
   phone-addressed business adapter.
4. Do not promise private-group sync, native account history or a complete
   participant roster for either official surface unless its exact contract and
   fixtures prove them.
5. Reconsider a personal bridge only after written provider approval, a
   maintained server-side transport contract, dependency/security review and a
   separate ADR accepting support and deployment consequences.

Neither official surface connects an employee's ordinary Viber phone-number
account or synchronizes that account's private/group chat list. Business
Messages can be phone-addressed on the customer side, but the sender is a
verified business identity.

Any separately approved Desktop/GUI automation experiment must be isolated from
the shared worker: one runtime/profile per explicitly authorized test
connector/account, dedicated encrypted storage, bounded concurrency, version
pin/canary, kill switch, no automatic retry after an uncertain send, and no
production/SLA claim. GUI automation or reverse engineering alone is not a
production exit criterion. An approved provider SDK/server transport would need
its own deployment assessment instead of inheriting these Desktop assumptions.

### Official Viber Evidence

- [Viber Desktop setup](https://help.viber.com/hc/en-us/articles/9084593040285-Set-up-Viber-on-your-desktop)
  describes phone approval, QR pairing and an explicit interactive sync step;
  it describes a client device, not an API.
- [Viber REST Bot API](https://developers.viber.com/docs/api/rest-bot-api/)
  documents token/webhook messaging, subscriber IDs and delivered/seen
  callbacks for outbound bot messages. It also states that new bots are
  commercial and that phone-number messaging uses Business Messages through
  official partners.
- [Viber business messaging solutions](https://www.forbusiness.viber.com/en/messaging-solutions/)
  separates Chatbots from Business Messages and requires partner/account setup
  and customer consent for business-initiated communication.
- [Viber Terms of Service](https://www.viber.com/en/terms/viber-terms-use/)
  prohibit reverse engineering and automated access that is not expressly
  permitted.
- [Viber Fair Usage Policy](https://www.viber.com/en/terms/fair-usage-policy/)
  was last checked with the policy dated 2026-03-23. Its stated service scope is
  narrower than the general Terms, but it additionally reinforces the
  automation risk for the business/services surfaces it covers.
- The official [Viber Node bot SDK](https://github.com/Viber/viber-bot-node) and
  [Viber Python bot SDK](https://github.com/Viber/viber-bot-python) implement the
  Bot API, not personal-account sessions.

## WeChat And WeCom Decision

WeChat must not be represented by one adapter or one capability profile:

- a WeChat Official Account is a follower/service messaging surface, not the
  account administrator's normal chats;
- WeChat Customer Service through WeCom is the primary official 1:1 service
  candidate for an operator inbox;
- WeCom customer-group APIs can provide group and roster evidence but do not by
  themselves prove a general-purpose live group send transport;
- WeCom conversation archive is a separately licensed/consented read surface and
  cannot be used as reply authorization;
- no production `wechat_qr_bridge` should be offered without an explicit
  provider-approved personal-account contract.

Primary official evidence entry points are:

- [WeChat service-account message receipt](https://developers.weixin.qq.com/doc/service/guide/product/message/Receiving_standard_messages.html);
- WeCom [Customer Service overview](https://developer.work.weixin.qq.com/document/path/94638),
  [message/event receipt](https://developer.work.weixin.qq.com/document/path/94670),
  [conversation state](https://developer.work.weixin.qq.com/document/path/94669)
  and [message send](https://developer.work.weixin.qq.com/document/path/94677);
- WeCom [customer-group detail and roster](https://developer.work.weixin.qq.com/document/path/92122)
  and [conversation archive SDK](https://developer.work.weixin.qq.com/document/path/91774);
- Tencent's [WeCom product description](https://www.tencent.com.cn/en-us/business/wecom.html).

Exact service windows, certification, archive licensing/consent and regional
availability must be revalidated in `SOURCE-114` against the selected tenant and
sandbox because public documentation and entitlements vary by account/region.

## imo Decision

imo exposes consumer phone registration and web/desktop use, but this review did
not find a public bot/webhook/history API that can support Hulee's normal-account
inbox. Its current
[Terms of Service](https://imo.im/policies/terms_of_service.html) grant consumer
app use for personal, non-commercial purposes. An official
[Messenger for Business announcement](https://imo.im/en/blog/features/imo-introduce-new-feature-messenger-business)
exists, but no public multi-tenant inbox specification, sandbox or resale/SLA
contract was found.

Therefore `imo_business` remains `partner_required`, and a consumer QR/web
session remains `unsupported`. Hulee must not expose native reply until a partner
specification proves authentication, webhooks, stable identities, history,
groups/roster, outbound semantics, limits and commercial rights.

## Market Candidates And Priority

These priorities guide discovery; they do not add providers to the Inbox V2
WA/TG/MAX release gate.

| Priority | Candidate                                         | Why it is relevant                                                                                          | Next evidence gate                                                   |
| -------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| P0       | Meta Messenger and Instagram Messaging            | Large global business messaging reach and mature official APIs                                              | Confirm app review, account types, reply windows and regional policy |
| P0       | LINE Messaging API                                | Official 1:1 plus group webhooks, group IDs, roster endpoints and group replies/pushes in key Asian markets | Select target region and verify account/plan limits                  |
| P0       | Zalo Official Account/business messaging          | Strong Vietnam relevance and official business surfaces                                                     | Validate OA/group/phone-addressed scopes with current partner terms  |
| P1       | TikTok Business Messaging                         | High-potential lead/support surface tied to business accounts                                               | Confirm public/partner availability, webhooks and reply rules        |
| P1       | RCS for Business                                  | Phone-addressed verified business messaging, rich content, receipts and SMS fallback strategy               | Choose partner/carrier regions and consent/commercial model          |
| P2       | KakaoTalk Channel and Apple Messages for Business | Regional/premium customer-service channels                                                                  | Validate target-customer demand and onboarding rights                |
| Separate | Slack, Microsoft Teams, Discord and Matrix        | Valuable employee/community conversations, but a workspace/community model rather than direct phone numbers | Plan under enterprise/internal/community adapters                    |
| Watch    | Signal                                            | User demand may exist, but no official business/bot inbox API                                               | Revisit only when an official programmable surface appears           |

Official discovery entry points:

- [Meta Messenger Platform](https://developers.facebook.com/docs/messenger-platform/)
  and [Instagram Messaging API](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/);
- [LINE group and multi-person chats](https://developers.line.biz/en/docs/messaging-api/group-chats)
  and [LINE message sending](https://developers.line.biz/en/docs/messaging-api/sending-messages/);
- [Zalo developer platform](https://developers.zalo.me/);
- [TikTok for Business API documentation](https://business-api.tiktok.com/portal/docs);
- [RCS for Business](https://developers.google.com/business-communications/rcs-business-messaging);
- [KakaoTalk Channel APIs](https://developers.kakao.com/docs/latest/en/kakaotalk-channel/common)
  and [Apple Messages for Business](https://register.apple.com/messages);
- [Slack APIs](https://api.slack.com/),
  [Microsoft Graph chat](https://learn.microsoft.com/en-us/graph/api/resources/chat),
  [Discord developer documentation](https://discord.com/developers/docs/intro)
  and [Matrix Client-Server API](https://spec.matrix.org/latest/client-server-api/).

[Google Business Messages was discontinued on 2024-07-31](https://developers.google.com/business-communications/business-messages/resources/release-notes/update-on-gbm?hl=en),
so it is not a candidate; RCS for Business is the relevant Google
phone-messaging surface.

## Hulee Architecture Decisions

The following are target decisions for Inbox V2 and provider discovery, not
claims that the current direct-account messaging runtime is complete.

1. Persist the access model and capability evidence per provider surface and
   `SourceThreadBinding`, never once per brand.
2. Treat consumer QR/phone login as an onboarding UI mechanism only after a
   supported transport contract exists; QR itself is not a capability.
3. Keep provider transport, payload parsing, identity evidence and
   provider-specific diagnostic/error mapping in adapters. Shared lifecycle,
   diagnostic persistence and health aggregation remain platform-owned; Inbox
   core receives versioned normalized contracts only.
4. An unavailable/unknown capability fails closed: no composer action, no
   history promise, no group roster inference and no silent native-client
   fallback.
5. Official bot, phone-addressed business, workspace/group and archive surfaces
   use separate `sourceName`/adapter manifests even when owned by one provider.
6. Epic 8 remains the executable WA/TG/MAX personal-session matrix. Viber,
   WeChat/WeCom, imo and the wider portfolio are tracked in the general source
   integration backlog so they do not become hidden release-gate dependencies.

## Revalidation Policy

Provider terms and APIs are time-dependent. Revalidate this document before
starting an adapter, after a provider policy/API version change, and at least
quarterly while a surface is on the active roadmap. Record the date, account
type/region, official source, partner ticket or contract reference, sandbox
fixtures and the resulting capability revision. Never copy `supported` from an
old row into implementation evidence.
