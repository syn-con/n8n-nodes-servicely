# n8n-nodes-servicely

An [n8n](https://n8n.io) community node for the **Servicely** ITSM/ESM platform. It talks to the Servicely JSON REST API (v1) so your workflows can read and write records on any table (Incident, Request, User, Group, …), manage file attachments, and call instance controllers directly. A companion **Servicely Trigger** node starts workflows on a schedule by dequeuing async-queue messages or polling a table by filter.

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) · [Trigger](#trigger) · [Examples](#examples) · [Compatibility](#compatibility) · [Development](#development)

---

## Installation

### In n8n (community nodes)

1. Go to **Settings → Community Nodes → Install**.
2. Enter `@syn-con/n8n-nodes-servicely` and confirm.
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
(`~/.n8n/custom/node_modules/@syn-con/n8n-nodes-servicely`), and starts n8n at
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

### Queue

Acknowledge a message dequeued by the [Servicely Trigger](#trigger) back to the Async Integration controller (`POST {instanceUrl}/controller/AsyncIntegration`) — the counterpart of the Node-RED Success/Failure reply nodes.

| Operation | Sends | Notes |
|-----------|-------|-------|
| **Reply Success** | `action: success`, `status: ok` | Mark the message as processed successfully. |
| **Reply Failure** | `action: fail`, `status: error` | Mark the message as failed. |

- **Reply To** — the message id, defaulting to `={{ $json._servicely.replyTo }}` (emitted by the trigger), so it auto-wires when the trigger feeds this node.
- **Payload** — the response payload returned to Servicely (defaults to the incoming item's `{{ $json }}`).

### Controller

Call any controller registered on the instance directly — the escape hatch for instance-specific controllers the typed resources above do not cover.

| Operation | Method | Notes |
|-----------|--------|-------|
| **Call** | `POST {instanceUrl}/controller/{ControllerName}` | Posts a raw JSON body. Controller endpoints sit at the instance root, not under `/v1`. |

- **Controller** — **From List** shows `SystemController` records, storing each record's `Name` (the URL segment) and labelling it with `Label` / `Title` / `Description` when present; or enter a controller name / expression manually.
- **Body (JSON)** — the request body, passed through untouched. It must be a JSON object; an expression may supply an object directly.

The response is emitted as-is: an array fans out to one item per entry, an object becomes one item, a scalar is wrapped as `{ data: ... }`, and an empty response yields `{ success: true }`.

> **Note on upload:** attachment upload is implemented as a direct `POST /v1/Attachment` with a base64 `Data` field. This path is not explicitly documented for inbound REST — validate it against your instance. If your instance rejects it, front the upload with a small custom controller accepting `{ mimeType, fileName, base64String, parentRecord, relatedField }`. Field names and the ParentRecord format are confirmed by the docs.

## Trigger

The **Servicely Trigger** is a polling node — n8n adds a **Poll Times** schedule and calls it on that interval. Each poll that finds work starts one execution, emitting one item per message/record.

**Trigger On → Async Queue Message** — claims messages from a Servicely Async Integration queue (`POST {instanceUrl}/controller/AsyncIntegration`, `action: "dequeue"`), the same mechanism as the Node-RED Queue node.

- **Queue** — the queue to claim from. **From List** shows `ActionProviderInstance` records with `ConnectionType = async_integration`, using each record's `ConnectionString` as the value; or enter a ConnectionString / expression manually.
- **Action Name** — the subject identifying which messages to claim. **From List** shows `Action` records for the selected queue's provider instance (`ProviderInstance` = the chosen instance's id), using each Action's `Command` as the value; or enter a command / expression manually.
- **Messages Per Poll** — max messages claimed per poll (default 10).
- Each emitted item is the message payload (a JSON object payload becomes the item's `json` directly; anything else is wrapped under `payload`). Reply metadata is attached under `_servicely` (`replyTo`, `queue`, `subject`).

> Dequeue is **at-least-once**: a claimed message may be redelivered until it is acknowledged. Close the loop with the **Queue → Reply Success / Reply Failure** operation (see [Queue](#queue)), which uses the carried `_servicely.replyTo` id.

**Trigger On → Object (Table Records)** — polls a table and emits records matching a filter, reusing the same **Filters** / **Query (JSON)** / selector / sort surface as **Object → Get Many**.

- **Table**, **Limit**, **Filters**, and **Options** (Fields / Display Value Fields / Relation Fields / Query (JSON) / Sort).
- Each poll returns the current matches (up to **Limit**); it does not track a cursor, so pair a narrowing filter with an action that advances state (e.g. set a "processed" flag) to avoid re-emitting the same records.

### Request Options (both nodes)

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

**Process an async queue**

1. **Servicely Trigger → Async Queue Message**, Queue = your queue, Action Name = the subject, Poll Times every minute.
2. Downstream nodes handle each message (`json` is the payload; `json._servicely.replyTo` identifies it).
3. **Servicely → Queue → Reply Success** to acknowledge (or **Reply Failure** on an error branch). Reply To defaults to `={{ $json._servicely.replyTo }}`.

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

Tests stub `helpers.httpRequestWithAuthentication` rather than hitting a live instance, so the suite runs offline. Coverage is enforced at ≥80% per file (statements, branches, functions, lines).

### Architecture

The layout follows n8n's `actions/` router convention: one folder per resource,
one file per operation.

```
nodes/Servicely/
  Servicely.node.ts            # thin shell: description + router
  ServicelyTrigger.node.ts     # polling trigger (no resource/operation pair)
  actions/
    router.ts                  # resolves the operation, owns the item loop
    versionDescription.ts      # INodeTypeDescription, composed from the resources
    node.type.ts               # resource → operations union the router narrows on
    common.descriptions.ts     # property fragments used by more than one operation
    object/
      index.ts                 # operation selector + shared Table field
      create.operation.ts      # each file: its own properties + execute(index)
      delete.operation.ts
      get.operation.ts
      getAll.operation.ts
      update.operation.ts
    attachment/
      index.ts
      download.operation.ts
      list.operation.ts
      upload.operation.ts
    queue/
      index.ts
      reply.ts                 # the call both reply operations share
      replyFailure.operation.ts
      replySuccess.operation.ts
    controller/
      index.ts
      call.operation.ts        # raw POST to /controller/{ControllerName}
  GenericFunctions.ts          # API request helpers + query builders
  SearchFunctions.ts           # listSearch pickers + Table/Field registry loaders
  constants.ts
  types.ts
```

- Each `*.operation.ts` exports `description` (its properties, scoped with `updateDisplayOptions`) and `execute(this, index)` handling **one** item.
- `router.ts` owns the item loop, `continueOnFail`, and error wrapping, so operations carry no boilerplate.
- `node.type.ts` makes the resource/operation pairing a compile-time union — an unregistered operation fails to build rather than at runtime.
- `credentials/ServicelyApi.credentials.ts` — its `authenticate` resolves the instance URL into `baseURL` and signs every request (Basic / Bearer / HMAC), so no node code reads credentials.
- `SearchFunctions.ts` — every **From List** picker is paginated. Servicely's list endpoints are offset-based, so each picker page returns n8n's `paginationToken` (the next page number) whenever the API filled the page; n8n asks for the next one as the user scrolls. Because the API has no text-search parameter, the typed filter is applied per page — a page emptied by filtering still hands back its token, so matches further in the table are not stranded. The **Table** picker is the exception: it is not `searchable`, so n8n loads it in one go and the paging happens internally (bounded, since it runs at design time).

Adding an operation means: add `<name>.operation.ts`, register it in the
resource's `index.ts` (export + selector option), and add it to `node.type.ts`.

## Resources

- [Servicely REST API docs](https://docs-servicely.atlassian.net/wiki/spaces/SD/pages/2077523978)
- [n8n community nodes](https://docs.n8n.io/integrations/community-nodes/)

## License

MIT
