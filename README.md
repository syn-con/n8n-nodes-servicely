# n8n-nodes-servicely

An [n8n](https://n8n.io) community node for the **Servicely** ITSM/ESM platform. It talks to the Servicely JSON REST API (v1) so your workflows can read and write records on any table (Incident, Request, User, Group, …) and manage file attachments.

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) · [Examples](#examples) · [Compatibility](#compatibility) · [Development](#development)

---

## Installation

### In n8n (community nodes)

1. Go to **Settings → Community Nodes → Install**.
2. Enter `n8n-nodes-servicely` and confirm.
3. The **Servicely** node and **Servicely API** credential become available after n8n restarts.

> Community nodes require self-hosted n8n, or n8n Cloud with verified community nodes enabled.

### Local development (run it in n8n)

With a global n8n installed (`npm install -g n8n`):

```bash
cd n8n-nodes-servicely
npm install
npm run dev
```

`npm run dev` builds the node, links it into n8n's custom-nodes directory
(`~/.n8n/custom/node_modules/n8n-nodes-servicely`), and starts n8n at
<http://localhost:5678>. n8n loads nodes at startup, so after changing code,
stop it (Ctrl+C) and re-run `npm run dev` to pick up the changes.

## Credentials

Create a **Servicely API** credential:

| Field | Notes |
|-------|-------|
| **Instance URL** | Base URL of your instance, e.g. `https://your-instance.servicely.ai`. No trailing slash, no `/v1`. |
| **Authentication Method** | `Bearer Token`, `Basic Auth`, or `HMAC`. |
| **API Token** | For Bearer/HMAC. The full System API Token (prefix + secret). Manage under **Administration → Integration → System API Tokens**. |
| **Username / Password** | For Basic Auth. |
| **Shared Secret** | For HMAC — used to sign each request with HMAC-SHA256. |

Secrets are stored encrypted by n8n and are never written into workflow data.

## Operations

### Object (any table)

| Operation | Method | Notes |
|-----------|--------|-------|
| **Get** | `GET /v1/{Table}/{id}` | Fetch a single record. |
| **Get Many** | `GET /v1/{Table}` | List records, with **Return All** (auto-paginates) or a **Limit**. |
| **Create** | `POST /v1/{Table}` | Create from **Fields to Set**. |
| **Update** | `PATCH /v1/{Table}/{id}` | Patch the given fields. |
| **Delete** | `DELETE /v1/{Table}/{id}` | Delete by id. |

**Selecting data** (Get / Get Many → *Options*):

- **Fields** — comma-separated fields to return (`id,Number,ShortDescription`).
- **Display Value Fields** — returns `{ value, displayValue }` for reference fields.
- **Relation Fields** — dot-walk relations (`Requestor.Name,Requestor.Manager.Name`).
- **Sort Field** / **Sort Descending**.

**Filtering** (Get Many):

- **Filters** — a simple builder: pick a field, operator, and value; conditions are combined with **AND**.
  - Operators: `=`, `!=`, `startswith`, `contains`, `doesnotcontain`, `isempty`, `isnotempty`, `in`, `notIn`, `<`, `>`, `<=`, `>=`, `between`.
  - For `in` / `notIn` / `between`, enter a comma-separated list. `isempty` / `isnotempty` take no value.
- **Query (JSON)** (in *Options*) — for `OR`/`NOR` or nested logic. When set, it **takes precedence** over the simple Filters. Example:

  ```json
  { "and": [
      { "fieldName": "Priority", "operator": "in", "value": ["1", "2"] },
      { "fieldName": "Closed", "operator": "=", "value": false }
  ] }
  ```

### Attachment

| Operation | Notes |
|-----------|-------|
| **Upload** | Reads a binary field from the input item and attaches it to a parent record. |
| **Download** | Fetches an attachment by id and emits it as binary output. |
| **List** | Lists the attachments on a parent record (filterable by related field). |

`Parent Record` uses Servicely's `{recordId}:{tableName}` format (e.g. `abc123:Incident`), built for you from the **Parent Table** + **Parent Record ID** fields.

> **Note on upload:** attachment upload is implemented as a direct `POST /v1/Attachment` with a base64 `Data` field. This path is not explicitly documented for inbound REST — validate it against your instance. If your instance rejects it, front the upload with a small custom controller accepting `{ mimeType, fileName, base64String, parentRecord, relatedField }`. Field names and the ParentRecord format are confirmed by the docs.

### Request Options (all operations)

- **Timeout (ms)** — per-request timeout (default 30000).
- **Max Retries** — retries on rate limits (429), server errors (5xx), and network failures, with exponential backoff + jitter (default 3; `0` disables). `Retry-After` is honored. Client errors (400/401/404/422) are never retried.

## Examples

**Get all open incidents, sorted newest first**

1. **Servicely → Object → Get Many**, Table `Incident`.
2. **Return All** on.
3. *Filters:* `State` `!=` `Closed`.
4. *Options → Sort Field* `CreatedOn`, *Sort Descending* on.

**Create an incident**

1. **Servicely → Object → Create**, Table `Incident`.
2. *Fields to Set:* `ShortDescription` = `Printer offline`, `Priority` = `2`.

**Attach a file fetched over HTTP**

1. **HTTP Request** node → downloads a file into the binary field `data`.
2. **Servicely → Attachment → Upload**, Parent Table `Incident`, Parent Record ID = the incident id, Input Binary Field `data`.

## Compatibility

- Requires an n8n version supporting community nodes (`n8nNodesApiVersion: 1`).
- Servicely REST API **v1**. Record creation returns **HTTP 200** (not 201).
- Minimum Servicely versions for optional features:
  - **Batch API** (`POST /v1/_batch`): `1.4.2-release.40`+.
  - **Bearer token as URL parameter** and **`moveAttachments`**: `1.10`+.

## Development

```bash
npm install
npm run build       # tsc → dist/ (+ copies the node icon)
npm run build:watch # tsc --watch (recompile on change)
npm run dev         # build + link into ~/.n8n/custom + start n8n
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest run
npm run test:coverage
```

Tests use dependency injection (a stub `HttpRequestFn` / mock `IServicelyClient`) rather than a live instance, so the suite runs offline. Coverage is enforced at ≥80% per file (statements, branches, functions, lines).

### Architecture

- `src/transport/` — framework-agnostic `ApiClient` (retry, rate limiting, error mapping), `AuthProvider` (Basic/Bearer/HMAC strategies), `RateLimiter` (token bucket).
- `src/handlers/` — per-resource operation routing (`object`, `attachment`) depending on the narrow `IServicelyClient` interface.
- `src/descriptions/` — n8n property trees (declarative UI).
- `src/Servicely.node.ts` — the node: decrypts credentials, builds the client, routes to a handler.
- Endpoints, operators, and header names live only in `src/constants.ts`.

## Resources

- [Servicely REST API docs](https://docs-servicely.atlassian.net/wiki/spaces/SD/pages/2077523978)
- [n8n community nodes](https://docs.n8n.io/integrations/community-nodes/)

## License

MIT
