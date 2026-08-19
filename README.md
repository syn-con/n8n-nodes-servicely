# n8n-nodes-servicely

[![NPM Version](https://img.shields.io/npm/v/@synergyconsulting/n8n-nodes-servicely?style=flat-square)](https://www.npmjs.com/package/@synergyconsulting/n8n-nodes-servicely)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)


An [n8n](https://n8n.io) community node for the **Servicely** ITSM/ESM platform. It talks to the Servicely JSON REST API (v1) so your workflows can read and write records on any table (Incident, Request, User, Group, …), manage file attachments, run a full-text Global Search, and call instance controllers directly. A companion **Servicely Trigger** node starts workflows on a schedule by dequeuing async-queue messages or polling a table by filter, and the **Servicely AI Agent Tool** pair exposes a workflow as a tool the service desk agent can call.

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) · [Trigger](#trigger) · [AI Agent Tool](#ai-agent-tool) · [Examples](#examples) · [Compatibility](#compatibility) · [Development](#development)

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

The **Servicely AI Agent Tool Auth API** credential is separate and points the other way: it describes what an incoming tool call has to present (**Basic Auth**, **Header Auth**, or a **JWT** bearer token verified with a shared secret or a PEM public key). See [AI Agent Tool](#ai-agent-tool).

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

Invoke any controller registered on the instance directly — the escape hatch for instance-specific controllers the typed resources above do not cover.

| Operation | Method | Notes |
|-----------|--------|-------|
| **Invoke** | `POST {instanceUrl}/controller/{ControllerName}` | Posts a raw JSON body. Controller endpoints sit at the instance root, not under `/v1`. |

This operation was called **Call** and stored as `operation: "call"`, which is still accepted and runs exactly the same request — a workflow that names the old value does not have to be edited. n8n saves only the parameters that differ from their default, so a workflow built in the UI never held the value at all; one created through the API or imported as JSON does.

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

## AI Agent Tool
The **Servicely AI Agent Tool** node turns a workflow into a tool the Servicely service desk agent can call. It declares the tool, serves it on an HTTP `POST` endpoint, and validates the call before the workflow runs. A second node sends the answer back.

Both are **one entry in the nodes panel**. Search for *Servicely AI Agent Tool* and the card offers:

| | what it adds |
| --- | --- |
| **Triggers** → *On new Servicely AI Agent Tool event* | the trigger: declares and serves the tool |
| **Actions** → *Send a response* | the node that answers the call |

n8n builds that card by taking a node's type name, and merging into it any trigger whose type is the same plus `Trigger` — so the two are `servicelyAiAgentTool` and `servicelyAiAgentToolTrigger`, the action node carries an **Operation** of *Send Response* (a card with no actions is not merged into), and the trigger's panel label says "Trigger" while the node it drops on the canvas is still called *Servicely AI Agent Tool*. There is no way to make one node do both jobs: n8n opens a webhook for every instance of a node type that declares one, so a single node would open a dead endpoint for every response node in the workflow.

### Servicely AI Agent Tool (trigger)

The tool is exported under the **node's** name (as `[n8n] <node name>`), so the node asks for no name of its own — rename the node on the canvas and the next activation renames the tool. One node is one tool, so a workflow can declare several by holding several AI Agent Tool nodes; name them after what they do, since two nodes both left at the default "Servicely AI Agent Tool" register two tools the agent cannot tell apart.

- **Prompt** — what the tool does and when to call it. Exported with the tool, so the agent reads it when deciding.
- **Path** — the path the tool listens on, appended to the webhook base URL (the full path is served as given, without an internal webhook id).
- **Parameters** — the tool's arguments. Each row is a **Param Name**, a **Param Type** (`String`, `Number`, `Integer`, `Boolean`; defaults to String), a **Param Required** toggle (on by default) and a **Param Description** that is exported with the tool.
  - A **required** argument the call leaves out is rejected. Turn the toggle off and the call runs without it — the workflow then sees the argument *absent* from `parameters` rather than present as `null`, so its meaning is the workflow's to decide.
  - Only the presence check turns off. An argument that *is* sent is held to its declared type whether or not it had to be sent: optional means the agent may leave it out, not that it may get it wrong.
  - **Param Required** is checked here only. The tool is exported with the argument either way, so the agent is not told an argument is optional — it may keep sending it; this node simply stops rejecting the calls that do not.
  - A parameter saved before the toggle existed reads as required, which is how every declared parameter behaved until then.
- **`IsLiveRun`** — a boolean parameter every tool carries on top of the declared ones, exported last so it never reorders them. Its description tells the agent to send `true` unless the user explicitly asked for a test run, so a workflow can tell a live call from a rehearsal without each tool defining its own flag. It is the one parameter that is *not* validated: a call that omits it, or sends something other than a boolean, still runs — the value is passed on as it came, and its absence is left for the workflow to interpret rather than assumed to mean anything. It is also not treated as unknown when **Allow Unknown Parameters** is off. Declaring a row named `IsLiveRun` replaces it — type, description and position then come from that row, and it is validated like any other parameter.
- **Respond** — when and how the agent is answered, following n8n's own **Webhook** node: *Using Servicely AI Agent Tool Response Node* (default), *Immediately*, or *When Last Node Finishes*. The node never writes the response itself; it declares the mode, the status code and the data on its webhook, and n8n sends it.
  - *Using Servicely AI Agent Tool Response Node* — the request stays open until a **Servicely AI Agent Tool Response** node runs, however long the workflow takes. A branch that never reaches one never answers.
  - *Immediately* — answers as soon as this node validated the call, with `{ "success": true, "message": "Workflow was started" }` unless **Options → Response Data** or **No Response Body** says otherwise.
  - *When Last Node Finishes* — answers with the last executed node's data, shaped by **Response Data**: *First Entry JSON* (default), *All Entries*, or *No Response Body*.
- **Tool Timeout (Seconds)** — how long the *service desk* waits for this tool to answer before giving up on the call, exported with the tool as `TimeoutSeconds`. Default 60, and shown under the two modes that make the agent wait; *Immediately* has already answered, so it does not ask. It is the only deadline in play: n8n keeps the request open for as long as the workflow runs, so this bounds the agent's wait, not the workflow's — a workflow that overruns it keeps going, it just answers into a call nobody is waiting for any more.
- **The Respond setting and the wiring have to agree**, and a call that would go unanswered is refused with a `500` rather than left hanging: *Using Servicely AI Agent Tool Response Node* with no response node downstream fails with "No Servicely AI Agent Tool Response node found in the workflow", and a response node under either other mode fails with "Unused …" — n8n has already replied by the time that node runs, so its answer would go nowhere. The check runs before the caller is even authenticated.
- **On Validation Error** — respond `400` with the errors (default), or run the workflow anyway and pass them on in `json.validation`.
- **Options → Allow Unknown Parameters** (default on), **Coerce Types** (default off, converts e.g. the string `"12"` to `12` before validating), **AI Agent Names or IDs**, **AI Assistant Names or IDs**, **Role Names or IDs**, **Mutates Ticket**, **Production Restricted**, and **Execution Script**.
- **Options → the response ones** — **Response Code** (default 200), **Response Headers**, **Response Data** (a fixed body for *Immediately*), **No Response Body**, and, for *When Last Node Finishes* returning First Entry JSON, **Response Content-Type** and **Response Property Name** (answer with one property of the item instead of the whole JSON). Each shows only under the modes it applies to, and none appears under *Using Servicely AI Agent Tool Response Node* — that node carries its own status, body and headers.
- **Options → AI Agent Names or IDs** / **AI Assistant Names or IDs** — who the tool is exported to: multi-selects loaded from the instance's `SystemAIAgent` and `SystemAIAssistant` tables, each entry labelled by its **Name** and stored by its record id. Reading them needs the **Servicely API** credential; a table that cannot be answered for leaves that list empty, which is also how an instance without one reads. Activating the workflow links the tool to exactly what each selects (see below). The two are independent — selecting agents does not touch the assistants — and an option you never add is left alone entirely: that table is not even read, since a workflow that says nothing about assistants is not asking for its tool to be taken out of them. Adding an option and then emptying it *is* a statement, and unlinks the tool from everything in that table.
- **Options → Role Names or IDs** — the roles the tool is given: a multi-select loaded from the instance's `Role` table, each entry labelled by its **Name** and stored by its record id, written to the tool's own `Roles` array. Unlike the agents and assistants, this is a plain field of the tool record rather than a link held by the other side, so there is nothing to reconcile — the selection is written as it stands.
- **Options → Mutates Ticket** — whether calling the tool changes something. Turn it on for tools that create, update or delete records, send messages, trigger external automations, or otherwise cause side effects.
- **Options → Production Restricted** — whether the tool is kept out of production environments. When on, it cannot be selected, executed or modified on a production system — for keeping an AI from, say, changing the schema of a live instance.

  These three share one rule: **an option you never add is left alone, an option you add is written as it stands.** Adding Roles and selecting nothing empties the tool's roles; adding a toggle and leaving it off writes `false`. Never adding them leaves whatever the service desk holds untouched, so a flag set there by hand survives every activation. (n8n keeps a collection option a workflow added even when its value equals the option's default, which is what makes "added and off" a different thing from "absent".)
- **Options → Execution Script** — the script the service desk runs for this tool, exported with it. **Every tool gets one whether or not you add this option**: the default script posts the call's parameters to this workflow and answers with what it returns, since a tool registered without a script would do nothing. Add the option only to replace it — leaving the box blank falls back to the default, so writing a no-op means writing one.

  Every `@@WEBHOOK_URL@@` in the script is replaced with this tool's webhook URL when the workflow is activated, so a script can name its own endpoint without being edited per instance. Details:
  - It is always the **production** URL, even when a "Listen for test event" is what registered the tool. The script chooses its endpoint at call time — the default one rewrites `/webhook/` to `/webhook-test/` when `IsLiveRun` is false — so handing it a test URL would leave it deriving a test URL from a test URL.
  - A bare `@@WEBHOOK_URL@@` comes out in single quotes; one the script already wrapped in `'`, `"` or `` ` `` keeps the quotes it was written with, so `post('@@WEBHOOK_URL@@')` gives `post('https://…')` rather than a doubled pair.
  - A script that uses `@@WEBHOOK_URL@@` when n8n cannot resolve the URL fails the activation rather than registering a broken script.
  - `@@URL@@`, what the placeholder was called before it said what it stood for, is still resolved the same way, so a script written against it keeps working. New scripts should use `@@WEBHOOK_URL@@`.

None of the fields take an expression. The node has no input, and its values are read on activation — when there is no execution to resolve one against.

The emitted item carries `body`, `parameters` (the declared arguments the call actually sent, after coercion), `headers`, `query`, `params`, `validation`, and — with a JWT credential — the verified `jwt` payload.

The node takes two credentials, both required: the **Servicely API** one (it backs the AI Agents, AI Assistants and Roles lists, and the registration below) and a **Servicely AI Agent Tool Auth API** one deciding what a caller has to present. The JWT algorithm is taken from the credential, not from the token, so a caller cannot downgrade the signature.

### Registration in the service desk

Activating the workflow registers it as a tool; deactivating removes it. n8n drives this through the webhook lifecycle hooks, so it happens on activate/deactivate — never on a manual execution.

- **On activate** the registration is upserted against a `SystemAITool` record whose **Key** is the n8n **node** id: a new record gets `Key` = the node id, `Name` = `[n8n] <node name>`, `Active` = `true`, `SelectionPrompt` = the node's **Prompt**, `TimeoutSeconds` = the node's **Tool Timeout** (how long the *service desk* waits for a call to be answered — n8n itself holds the request open for as long as the workflow runs; an unusable value, such as an emptied box, registers as the default 60), `ExecutionScript` = the node's script with its URL placeholder resolved, and a `Description` naming where it came from — the node, the workflow, and a link to that workflow (`Created by the "Create Incident" node of the n8n workflow "My Workflow" (https://n8n.example.com/workflow/abc123)`) — while an existing one is patched with the same fields minus the Key. That keeps activation idempotent: a record left behind by a deactivation that could not reach the instance is updated instead of failing on a duplicate Key.
- **Three more fields are written only when the node mentions them:** `Roles`, `MutatesTicket` and `ProductionRestricted`, from the options of the same names. Each is a field a service desk may also set by hand, so an option the workflow never added is left as it is rather than overwritten on every activation — while an option that *is* there is sent as it stands, an empty selection and an off toggle included.
- **The parameters follow the tool.** Each declared parameter becomes a `SystemAIToolParameter` row with `Name`, `Type`, `Description`, `Parent` = the tool's id, and `Order` counting from 10 in steps of 10. **Param Required** is deliberately not among them — it says what this node's webhook rejects, and the parameter table is not asked to carry a column it may not have. On a re-registration the rows are read back by `Parent` and reconciled by name: a new parameter is created, one whose type, description or position moved is patched, a row whose parameter the node no longer declares is deleted, and a row that already matches is left alone. Because `Order` comes from the declared order, reordering the collection in n8n reorders the tool's arguments. The API answers a query that matched nothing with a `404` rather than an empty list, so a `404` on the read back is taken as "no rows yet" — which is what every first registration sees; a `404` on the first *write* is the parameter table not being there under that name, and says so instead.
- **The agents and assistants follow their selections.** The link lives on the holder — a `SystemAIAgent` or `SystemAIAssistant` holds a `Tools` array — so activation reads each *selected* table once (a registry whose option was never added is skipped without a request) and reconciles it against that table's selection: a record you selected that does not hold the tool is patched to include it, one that holds it but is no longer selected is patched to drop it, and a record already in the right state is not written at all. Linking and unlinking run as two tasks over two disjoint sets, per table, alongside the parameter sync. Entries are compared by id whether the instance stores them as bare ids, as references, or as a serialised list; a `404` on one record's write is that record having gone and is logged rather than failing the activation, and a table that is not there at all reads as "nothing to link".
- **On deactivate** the tool comes out of every agent's and assistant's `Tools` first, so none is left pointing at a record that is about to go — a failure there is logged and the delete goes ahead anyway. The record is then looked up by that same Key and deleted if it is there. Nothing is cached between the hooks — the Key is the tool's whole identity, so a restart or a record edited in the service desk changes nothing about what the hooks find.
- **"Listen for test event" registers the tool** like an activation does, so it can be exercised from the service desk while you are still building the workflow. Stopping the listen deliberately does *not* remove the registration: n8n tears a test webhook down exactly the way it deregisters a production one, and removing it there would deregister a workflow that is active at the same time.
- Nothing left to remove is not treated as a failure, and removal never throws: n8n clears a workflow's webhooks on the way *into* activation as well, so a throw there would block activating the workflow too. Real failures (an expired token, a 500) are logged at error level instead.
- The Key is the **node id**, so each Servicely AI Agent Tool node owns exactly one tool record and a second node in the same workflow registers a second tool of its own. The id is n8n's, and it survives everything a workflow can do to a node except deleting it — renaming it, moving it, editing its parameters — so a tool keeps its registration, and its links to agents and assistants, across all of those. Delete the node and the next activation deregisters its tool.
- Renaming the node renames the tool (`Name` is always sent), and its links survive that too, since they hang off the record rather than its name.
- A node with no id — a workflow assembled outside the editor — fails with "The node has no id yet".

### Servicely AI Agent Tool → Send a response

Added from the **Actions** half of the card; it is called *Servicely AI Agent Tool Response* once it is on the canvas.

- **Operation** — *Send Response*, the one operation. It is what the panel lists as the card's action.
- **Respond With** — *Success* (status + data) or *Error* (status + message + optional JSON details, e.g. `{{ $json.validation.errors }}`).
- **Data** — all incoming items, the first incoming item, a JSON body you write, or no data.
- **Options → Envelope** (default on) wraps the body in `{ "success": true, "data": … }` / `{ "success": false, "error": … }`; **Message** adds a note to a success; **Response Headers** adds headers.
- `204` and `304` are sent without a body. Items pass through unchanged, so the workflow can carry on after responding.
- The trigger must have **Respond** set to *Using Servicely AI Agent Tool Response Node*; under either other mode it refuses the call outright, rather than leaving this node with an answer nobody is waiting for. n8n holds the request open until this node runs, however long that takes — the trigger's **Tool Timeout** is what decides how long the service desk waits for it.

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

1. **Servicely AI Agent Tool**, renamed on the canvas to *Create Incident* (the tool registers as `[n8n] Create Incident`), Prompt "Creates an incident for a user and returns its number", Path `create-incident`, AI Agent Names or IDs = the service desk agent.
2. *Parameters:* `shortDescription` (String, required, "What is wrong"), `priority` (Integer, **Param Required** off, "1 highest to 4 lowest — omit for the default").
3. *Options:* **Mutates Ticket** on, since the call creates a record.
4. **Servicely → Object → Create**, Table `Incident`, fields taken from `={{ $json.parameters.shortDescription }}` and `={{ $json.parameters.priority }}` — the second is absent when the agent omits it, so give it a default downstream.
5. **Servicely AI Agent Tool Response**, Respond With *Success*, Data *First Incoming Item*.

## Compatibility

- **AI Agent Tool node types changed in 0.7.0** so the pair could become one entry in the nodes panel: the trigger is now `servicelyAiAgentToolTrigger` and the node that answers is `servicelyAiAgentTool`. The types published before that — `servicelyAiTool` (trigger) and `servicelyAiToolResponse` — were kept registered and hidden through the 0.7.x line and are **removed as of 0.8.0**. A workflow still on them loads with unrecognised nodes: its endpoint stops answering and its tool stays registered in the service desk until the workflow is opened, the two nodes replaced with the current pair, and the workflow re-activated (the tool re-registers under the new node's id, leaving the old record to be deleted by hand). Replace both halves together — a current trigger no longer recognises an old response node.
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
npm run lint        # eslint, including n8n's own node standards
npm test            # vitest run
npm run test:coverage
```

Tests stub `helpers.httpRequestWithAuthentication` rather than hitting a live instance, so the suite runs offline. Coverage is enforced at ≥80% per file (statements, branches, functions, lines).

`npm run lint` runs n8n's own node standards (`eslint-plugin-n8n-nodes-base`, the presets a community node is measured against) alongside the package's rules, so the check a submission faces is the check that runs here. Two rules are turned off in `eslint.config.mjs`, each with its reason: both expect the docs *slug* a credential in n8n's own repository uses, where this package holds the URL that actually helps a reader.

### Publishing

`.github/workflows/publish.yml` publishes to npm on a version change in `package.json`, from CI only — n8n requires every community node to be published by a GitHub action carrying a [provenance](https://docs.npmjs.com/generating-provenance-statements) statement, which a local `npm publish` cannot produce. The job lints, typechecks and tests before it publishes, then runs n8n's `@n8n/scan-community-package` against the published version. It needs one repository secret, `NPM_TOKEN` (an npm automation token with publish rights on the `@syn-con` scope).

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
      invoke.operation.ts      # raw POST to /controller/{ControllerName}
  GenericFunctions.ts          # API request helpers + query builders
  SearchFunctions.ts           # listSearch pickers + loadOptions loaders
                               #   (fields, AI agents, AI assistants, roles)
  constants.ts
  types.ts

nodes/ServicelyAITool/
  ServicelyAIToolTrigger.node.ts   # webhook trigger: declares + serves the tool
  ServicelyAITool.node.ts          # answers the open request
  presentation.ts                  # the names, codex and docs both nodes share
  response.ts                      # the Respond modes, as n8n's Webhook node does them
  registration.ts                  # webhookMethods: registers the tool + its parameters
  identity.ts                      # the registered tool's Key, Name and Description
  parameters.ts                    # reads the declared parameters, for both sides
  validation.ts                    # the four parameter types, coercion, body check
  authentication.ts                # Basic / Header / JWT, per the attached credential
  jwt.ts                           # JWS verification (HS/RS/PS/ES), algorithm pinned
```

- Each `*.operation.ts` exports `description` (its properties, scoped with `updateDisplayOptions`) and `execute(this, index)` handling **one** item.
- `router.ts` owns the item loop, `continueOnFail`, and error wrapping, so operations carry no boilerplate.
- `node.type.ts` makes the resource/operation pairing a compile-time union — an unregistered operation fails to build rather than at runtime.
- The file names follow n8n's `<X>` / `<X>Trigger` pairing, as `Servicely` / `ServicelyTrigger` do: `ServicelyAITool.node.ts` is the node that acts (it answers the call) and `ServicelyAIToolTrigger.node.ts` is the one that starts the workflow. The class name has to match the file's base name — n8n's loader derives the one from the other — so the two are renamed together or not at all. The node *types* pair the same way, which is what makes the editor show them as one card; `presentation.ts` owns those names, and `__tests__/presentation.test.ts` asserts each condition the editor's merge depends on, so a later rename cannot quietly split the card in two.
- `nodes/ServicelyAITool/` sits outside the `actions/` convention: neither node has a resource/operation pair. The trigger keeps only its description and the webhook handler, and everything else lives in the helper modules next to it, which is what makes them directly unit-testable. Two of them exist because the pair has to agree with itself: `presentation.ts` holds what the editor shows for both nodes, and `response.ts` holds the Respond modes the trigger declares and the Response node fulfils.
- `credentials/ServicelyApi.credentials.ts` — its `authenticate` resolves the instance URL into `baseURL` and signs every request (Basic / Bearer / HMAC), so no node code reads credentials.
- `SearchFunctions.ts` — every **From List** picker is paginated. Servicely's list endpoints are offset-based, so each picker page returns n8n's `paginationToken` (the next page number) whenever the API filled the page; n8n asks for the next one as the user scrolls. Because the API has no text-search parameter, the typed filter is applied per page — a page emptied by filtering still hands back its token, so matches further in the table are not stranded. The **Table** and **Field Name** pickers are the exception: neither is `searchable`, so n8n loads each registry in one go and filters client-side, and the paging happens internally (bounded, since it runs at design time).

Adding an operation means: add `<name>.operation.ts`, register it in the
resource's `index.ts` (export + selector option), and add it to `node.type.ts`.

## Resources

- [Servicely REST API docs](https://docs-servicely.atlassian.net/wiki/spaces/SD/pages/2077523978)
- [n8n community nodes](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](LICENSE.md)
