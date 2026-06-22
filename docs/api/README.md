# API Docs

OpenAPI and webhook schema docs will be generated here.

## Public API v1

Current MVP routes:

- `GET /v1/health`
- `POST /v1/clients`
- `POST /v1/messages/inbound`
- `POST /v1/messages/outbound`
- `GET /v1/messages/{messageId}/delivery-status`

Tenant scope is resolved from the API key. Public API requests can authenticate
with either header:

- `Authorization: Bearer <api-key>`
- `X-Hulee-Api-Key: <api-key>`

The local MVP seed creates a default development key unless
`HULEE_SEED_API_KEY` is set:

```text
hulee-local-dev-key
```

The current data-plane composition path is:

```text
API key -> tenantId
HTTP v1 handler -> public API channel adapter
PublicApiCommandService -> core external message use cases
ExternalMessageRepository -> PostgreSQL rows + event_store + outbox
```

`apps/api` exposes `createPublicApiDataPlaneHandler` for wiring the handler to a
real `HuleeDatabase` with SQL API key auth, audit logging, idempotency lookup and
tenant-scoped persistence.

Error responses use the stable versioned envelope:

```json
{
  "error": {
    "code": "validation.failed",
    "messageKey": "errors.validation.failed",
    "retryability": "not_retryable",
    "requestId": "request-1"
  }
}
```
