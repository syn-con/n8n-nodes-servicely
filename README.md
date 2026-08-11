# n8n-nodes-servicely

An [n8n](https://n8n.io) community node for the **Servicely** ITSM/ESM platform. It talks to the Servicely JSON REST API (v1) so your workflows can read and write records on any table (Incident, Request, User, Group, …), manage file attachments, run a full-text Global Search, and call instance controllers directly. A companion **Servicely Trigger** node starts workflows on a schedule by dequeuing async-queue messages or polling a table by filter, and the **Servicely AI Tool** pair exposes a workflow as a tool the service desk agent can call.

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) · [Trigger](#trigger) · [AI Tool](#ai-tool) · [Examples](#examples) · [Compatibility](#compatibility) · [Development](#development)

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

The **Servicely AI Tool Auth API** credential is separate and points the other way: it describes what an incoming tool call has to present (**Basic Auth**, **Header Auth**, or a **JWT** bearer token verified with a shared secret or a PEM public key). See [AI Tool](#ai-tool).

## Operations

### Object (any table)

| Operation | Method | Notes |
|-----------|--------|-------|
| **Get** | `GET /v1/{Table}/{id}` | Fetch a single record. |
| **Get Many** | `GET /v1/{Table}` | List records, with **Return All** (auto-paginates) or a **Limit**. |
| **Create** | `POST /v1/{Table}` | Create from **Fields to Set**. |
| **Update** | `PATCH /v1/{Table}/{id}` | Patch the given fields. |
| **Delete** | `DELETE /v1/{Table}/{id}` | Delete by id. |

**Choosing the table and its fields:**

- **Table** — **From List** reads the instance's `TableDefinition` registry and stores each row's `Table` value: the API table name that goes into `/v1/{Table}`. Or switch to **By Name** for a table name / expression.
- **Record ID** (Get / Update / Delete) — a plain id field, typed or from an expression (`{{ $json.id }}`). There is no picker: the table is arbitrary, so an id coming from an upstream node wires straight through instead of being hunted for in a list.
- **Field Name** (in **Filters** and **Fields to Set**) — **From List** shows the selected table's fields: the table name is resolved to its `TableDefinition` id, then `FieldDefinition` rows with that `TableId` are listed. Or switch to **By Name** for anything the registry cannot list: a dot-walked relation (`Requestor.Email`), or a field on a table that is itself set by expression.

**Selecting data** (Get / Get Many → *Options*):

The field entries are dropdowns loaded from the selected table's `FieldDefinition` rows — no typing field names by hand. Change the **Table** and the lists reload. A table set by an expression cannot be resolved at design time, so the dropdown comes up empty; switch the parameter to an expression there and pass a comma-separated list (which is also what workflows saved before these dropdowns keep sending).

- **Fields** — multi-select of the fields to return. Empty means the API default (every field).
- **Display Value Fields** — multi-select of reference fields to return as `{ value, displayValue }`.
- **Relation Fields** — still a typed comma-separated list (`Requestor.Name,Requestor.Manager.Name`): the registry holds one table's own fields, while a relation path walks through other tables.
- **Sort Field** (single-select of the same field list) / **Sort Descending**.

**Filtering** (Get Many):

- **Filters** — a simple builder: pick a field (from the list or by name), an operator, and a value; conditions are combined with **AND**.
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

**Attachment ID** (Download) is a plain id field like **Record ID** — typed or from an expression (`{{ $json.id }}`), with no picker, since the id normally comes from an upstream List or Upload.

### Global Search

Full-text search over one table through the instance's Global Search controller (`POST {instanceUrl}/controller/GlobalSearch`) rather than through a `/v1` query.

| Operation | Body | Notes |
|-----------|------|-------|
| **Search** | `{ request_type: "search", table_class, text }` | Search one table for the given text. |
| **Batch Search** | `{ request_type: "batch_search", table_class, text, limit }` | Same request, capped at **Limit** (default 50). |

- **Table** — **From List** posts `{"request_type": "search_config"}` to the same controller and lists the tables it is configured to search, taking each entry's `table` as both label and value (its `id` is not used). That value is sent as `table_class`. Or switch to **By Name** for a table class / expression.
- **Search Text** — the text to match.

The response is emitted like any other controller answer: a list of hits fans out to one item per hit, an object becomes one item, a scalar is wrapped as `{ data: ... }`, and an empty response yields `{ success: true }`.

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

## AI Tool

The **Servicely AI Tool** node turns a workflow into a tool the Servicely service desk agent can call. It declares the tool, serves it on an HTTP `POST` endpoint, and validates the call before the workflow runs. The **Servicely AI Tool Response** node sends the answer back.

### Servicely AI Tool (trigger)

- **Name** — the name the tool is exported under in the service desk, e.g. `create_incident`.
- **Prompt** — what the tool does and when to call it. Exported with the tool, so the agent reads it when deciding.
- **AI Agents** — the agents the tool is exported to, a multi-select loaded from the instance's `SystemAIAgent` table: each entry is labelled by its **Name** and stored by its record id. Reading the list needs the **Servicely API** credential; an instance that cannot answer leaves the list empty. Activating the workflow links the tool to those agents (see below).
- **Path** — the path the tool listens on, appended to the webhook base URL (the full path is served as given, without an internal webhook id).
- **Parameters** — the tool's arguments. Each row is a **Param Name**, a **Param Type** (`String`, `Number`, `Integer`, `Boolean`; defaults to String) and a **Param Description** that is exported with the tool. Every declared parameter is required, and a call missing one is rejected.
- **Respond** — *Using Servicely AI Tool Response Node* (default), *Immediately*, or *When Last Node Finishes*.
- **Response Node Timeout (Seconds)** / **Workflow Timeout (Seconds)** — the same setting under the two waiting modes, named after what it waits for: the response node, or the last node finishing. How long the caller waits before getting a `504`; the workflow keeps running, only the caller stops waiting. Default 60. *Immediately* has already answered, so it shows no timeout.
- **On Validation Error** — respond `400` with the errors (default), or run the workflow anyway and pass them on in `json.validation`.
- **Options → Allow Unknown Parameters** (default on) and **Coerce Types** (default off, converts e.g. the string `"12"` to `12` before validating).

None of the fields take an expression. The node has no input, and its values are read on activation — when there is no execution to resolve one against.

The emitted item carries `body`, `parameters` (the declared arguments, after coercion), `headers`, `query`, `params`, `validation`, and — with a JWT credential — the verified `jwt` payload.

The node takes two credentials, both required: the **Servicely API** one (it backs the AI Agents list and the registration below) and a **Servicely AI Tool Auth API** one deciding what a caller has to present. The JWT algorithm is taken from the credential, not from the token, so a caller cannot downgrade the signature.

### Registration in the service desk

Activating the workflow registers it as a tool; deactivating removes it. n8n drives this through the webhook lifecycle hooks, so it happens on activate/deactivate — never on a manual execution.

- **On activate** the registration is upserted against a `SystemAITool` record whose **Key** is the n8n workflow id: a new record gets `Key` = the workflow id, `Name` = `[n8n] <workflow name>`, `Active` = `true`, `SelectionPrompt` = the node's **Prompt**, `TimeoutSeconds` = the node's timeout and a generated `Description`, while an existing one is patched with the same fields minus the Key. That keeps activation idempotent — a record left behind by a deactivation that could not reach the instance, or a second AI Tool node in the same workflow, updates it instead of failing on a duplicate Key.
- **The parameters follow the tool.** Each declared parameter becomes a `SystemAIToolParameter` row with `Name`, `Type`, `Description`, `Parent` = the tool's id, and `Order` counting from 10 in steps of 10. On a re-registration the rows are read back by `Parent` and reconciled by name: a new parameter is created, one whose type, description or position moved is patched, a row whose parameter the node no longer declares is deleted, and a row that already matches is left alone. Because `Order` comes from the declared order, reordering the collection in n8n reorders the tool's arguments. The API answers a query that matched nothing with a `404` rather than an empty list, so a `404` on the read back is taken as "no rows yet" — which is what every first registration sees; a `404` on the first *write* is the parameter table not being there under that name, and says so instead.
- **The agents follow the selection.** The link lives on the agent — a `SystemAIAgent` holds a `Tools` array — so activation reads the agent table once and reconciles it: an agent you selected that does not hold the tool is patched to include it, an agent that holds it but is no longer selected is patched to drop it, and an agent already in the right state is not written at all. Linking and unlinking run as two tasks over two disjoint sets of agents, alongside the parameter sync. Entries are compared by id whether the instance stores them as bare ids, as references, or as a serialised list; a `404` on one agent's write is that agent having gone and is logged rather than failing the activation.
- **On deactivate** the tool comes out of every agent's `Tools` first, so none is left pointing at a record that is about to go — a failure there is logged and the delete goes ahead anyway. The record is then looked up by that same Key and deleted if it is there. Nothing is cached between the hooks — the Key is the tool's whole identity, so a restart or a record edited in the service desk changes nothing about what the hooks find.
- **"Listen for test event" registers the tool** like an activation does, so it can be exercised from the service desk while you are still building the workflow. Stopping the listen deliberately does *not* remove the registration: n8n tears a test webhook down exactly the way it deregisters a production one, and removing it there would deregister a workflow that is active at the same time.
- Nothing left to remove is not treated as a failure, and removal never throws: n8n clears a workflow's webhooks on the way *into* activation as well, so a throw there would block activating the workflow too. Real failures (an expired token, a 500) are logged at error level instead.
- The Key is the **workflow id**, so a workflow owns at most one tool record. A second Servicely AI Tool node in the same workflow finds the first one's record already there and registers nothing.
- A workflow that has never been saved has no id yet, and activating it fails with "The workflow has no id yet".

### Servicely AI Tool Response

- **Respond With** — *Success* (status + data) or *Error* (status + message + optional JSON details, e.g. `{{ $json.validation.errors }}`).
- **Data** — all incoming items, the first incoming item, a JSON body you write, or no data.
- **Options → Envelope** (default on) wraps the body in `{ "success": true, "data": … }` / `{ "success": false, "error": … }`; **Message** adds a note to a success; **Response Headers** adds headers.
- `204` and `304` are sent without a body. Items pass through unchanged, so the workflow can carry on after responding.

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

**Expose a workflow as an agent tool**

1. **Servicely AI Tool**, Name `create_incident`, Prompt "Creates an incident for a user and returns its number", AI Agents = the service desk agent, Path `create-incident`.
2. *Parameters:* `shortDescription` (String, "What is wrong"), `priority` (Integer, "1 highest to 4 lowest").
3. **Servicely → Object → Create**, Table `Incident`, fields taken from `={{ $json.parameters.shortDescription }}` and `={{ $json.parameters.priority }}`.
4. **Servicely AI Tool Response**, Respond With *Success*, Data *First Incoming Item*.

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
    globalSearch/
      index.ts
      request.ts               # the Table + Search Text pair and the POST both share
      search.operation.ts
      batchSearch.operation.ts
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

nodes/ServicelyAITool/
  ServicelyAITool.node.ts          # webhook trigger: declares + serves the tool
  ServicelyAIToolResponse.node.ts  # answers the open request
  registration.ts                  # webhookMethods: registers the tool + its parameters
  parameters.ts                    # reads the declared parameters, for both sides
  validation.ts                    # the four parameter types, coercion, body check
  authentication.ts                # Basic / Header / JWT, per the attached credential
  jwt.ts                           # JWS verification (HS/RS/PS/ES), algorithm pinned
```

- Each `*.operation.ts` exports `description` (its properties, scoped with `updateDisplayOptions`) and `execute(this, index)` handling **one** item.
- `router.ts` owns the item loop, `continueOnFail`, and error wrapping, so operations carry no boilerplate.
- `node.type.ts` makes the resource/operation pairing a compile-time union — an unregistered operation fails to build rather than at runtime.
- `nodes/ServicelyAITool/` sits outside the `actions/` convention: neither node has a resource/operation pair. The trigger keeps only the description and the webhook handler, the rest lives in the three helper modules next to it, which is what makes them directly unit-testable.
- `credentials/ServicelyApi.credentials.ts` — its `authenticate` resolves the instance URL into `baseURL` and signs every request (Basic / Bearer / HMAC), so no node code reads credentials.
- `SearchFunctions.ts` — every **From List** picker is paginated. Servicely's list endpoints are offset-based, so each picker page returns n8n's `paginationToken` (the next page number) whenever the API filled the page; n8n asks for the next one as the user scrolls. Because the API has no text-search parameter, the typed filter is applied per page — a page emptied by filtering still hands back its token, so matches further in the table are not stranded. The **Table** and **Field Name** pickers are the exception: neither is `searchable`, so n8n loads each registry in one go and filters client-side, and the paging happens internally (bounded, since it runs at design time).

Adding an operation means: add `<name>.operation.ts`, register it in the
resource's `index.ts` (export + selector option), and add it to `node.type.ts`.

## Resources

- [Servicely REST API docs](https://docs-servicely.atlassian.net/wiki/spaces/SD/pages/2077523978)
- [n8n community nodes](https://docs.n8n.io/integrations/community-nodes/)

## License

MIT
