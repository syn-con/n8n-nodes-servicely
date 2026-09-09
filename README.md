# n8n-nodes-servicely

[![NPM Version](https://img.shields.io/npm/v/@synergyconsulting/n8n-nodes-servicely?style=flat-square)](https://www.npmjs.com/package/@synergyconsulting/n8n-nodes-servicely)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)


An [n8n](https://n8n.io) community node for the **Servicely** ITSM/ESM platform. Your workflows can read and write records on any table (Incident, Request, User, Group, …), manage attachments, run a full-text Global Search, raise service catalog requests, and call instance controllers. A **Servicely Trigger** node starts workflows from an async queue or by polling a table, and the **Servicely SoFi AI Webhook** pair exposes a workflow as a tool the service desk agent can call.

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) · [Trigger](#trigger) · [SoFi AI Webhook](#sofi-ai-webhook) · [Examples](#examples) · [Compatibility](#compatibility)

---

## Installation

1. Go to **Settings → Community Nodes → Install**.
2. Enter `@synergyconsulting/n8n-nodes-servicely` and confirm.
3. The **Servicely** nodes and credentials become available after n8n restarts.

> Community nodes require self-hosted n8n, or n8n Cloud with verified community nodes enabled.

## Credentials

Create a **Servicely API** credential:

| Field | Notes |
|-------|-------|
| **Instance URL** | Base URL of your instance, e.g. `https://your-instance.servicely.ai`. No trailing slash. |
| **Authentication Method** | `Bearer Token`, `Basic Auth`, or `HMAC`. |
| **API Token** | For Bearer/HMAC. The full System API Token. Manage under **Administration → Integration → System API Tokens**. |
| **Username / Password** | For Basic Auth. |
| **Shared Secret** | For HMAC. |

Secrets are stored encrypted by n8n and are never written into workflow data.

The **Servicely SoFi AI Webhook Auth API** credential points the other way: it describes what an incoming tool call has to present — **Basic Auth**, **Header Auth**, or a **JWT** bearer token. See [SoFi AI Webhook](#sofi-ai-webhook).

## Operations

### Object (any table)

**Get**, **Get Many**, **Create**, **Update**, and **Delete** on any table.

- **Table** — pick it from the list, or switch to **By Name** for a name or an expression.
- **Record ID** (Get / Update / Delete) — typed or from an expression, e.g. `{{ $json.id }}`.
- **Fields to Set** (Create / Update) — pick a field from the list, or name it yourself for a dot-walked relation such as `Requestor.Email`.
- **Return All** (Get Many) — fetch every match, or set a **Limit**.

**Options** (Get / Get Many):

- **Fields** — which fields to return. Empty returns them all.
- **Display Value Fields** — reference fields returned as `{ value, displayValue }`.
- **Relation Fields** — a comma-separated list of relation paths, e.g. `Requestor.Name`.
- **Sort Field** / **Sort Descending**.

**Filtering** (Get Many):

- **Filters** — pick a field, an operator, and a value; conditions are combined with **AND**. Operators: `=`, `!=`, `startswith`, `contains`, `doesnotcontain`, `isempty`, `isnotempty`, `in`, `notIn`, `<`, `>`, `<=`, `>=`, `between`. For `in` / `notIn` / `between` enter a comma-separated list; `isempty` / `isnotempty` take no value.
- **Query (JSON)** (in *Options*) — for `OR` or nested logic. When set, it takes precedence over the simple Filters:

  ```json
  { "and": [
      { "fieldName": "Priority", "operator": "in", "value": ["1", "2"] },
      { "fieldName": "Closed", "operator": "=", "value": false }
  ] }
  ```

### Attachment

- **Upload** — attaches a binary field of the incoming item to a record.
- **Download** — fetches an attachment by id and emits it as binary.
- **List** — lists the attachments on a record.

The parent record is built for you from **Parent Table** + **Parent Record ID**.

### Global Search

Full-text search over one table.

- **Search** — search the selected table for the given text.
- **Batch Search** — the same, capped at **Limit** (default 50).

**Table** offers the tables the instance is configured to search; **Search Text** is what to match. Each hit is emitted as its own item.

### Queue

Acknowledges a message dequeued by the [Servicely Trigger](#trigger).

- **Reply Success** — mark the message as processed.
- **Reply Failure** — mark it as failed.

**Reply To** defaults to `={{ $json._servicely.replyTo }}`, so it wires itself when the trigger feeds this node. **Payload** is the response sent back to Servicely, defaulting to the incoming item.

### Service Catalog

- **Create Request** — raise a request against a published catalog item.

**Catalog Item** offers the published items by name. **Questions** then renders that item's questions as a form; pick another item and the form reloads. An answer left blank is not sent, so an optional question that was skipped stays unanswered.

The instance decides where the request lands and how each answer is stored, and answers with the request it created, so `{{ $json.TargetRecordID }}` chains into the next node.

This operation calls a `ServiceCatalog` controller on the instance, which comes with the Servicely package by default — the reference script is below, for adapting it or checking what it does.

#### The `ServiceCatalog` controller

The controller is named `ServiceCatalog` (the name is the URL segment, so it has to match exactly) and takes `catalogItem` and `answers` — the two things the node sends:

```javascript
const requestedForField = "RequestedFor"
const requestedField = "Requested"
const questionsSourceField = 'QuestionsSource'
const catalogItemRecord = TableProtected("CatalogItem", catalogItem)
if (!catalogItemRecord) {
    answer = {
        isError: true,
        error: "CatalogItem is not founded"
    };
    return;
}
const targetTable = catalogItemRecord.Table();
const nameField = catalogItemRecord.NameField();
const targetTableRecord = Table("Incident").newRecord()
if (!targetTableRecord.hasField(questionsSourceField)) {
    answer = {
        isError: true,
        error: "Target table don't has questionsSource Field"
    };
    return;
}
targetTableRecord.RequestedFor()
targetTableRecord.setFieldValue(nameField, catalogItemRecord.Name);
if (targetTableRecord.hasField(requestedForField)) {
    targetTableRecord.setFieldValue(requestedForField, user.getID());
}
if (targetTableRecord.hasField(requestedForField)) {
    targetTableRecord.setFieldValue(requestedForField, user.getID());
}
targetTableRecord.create();
Object.keys(answers).forEach((key) => {
     let answer = Table("Answer")
        .newRecord();
    answer.RelatedRecord(targetTableRecord.getID() + ":" + targetTable);
    answer.Question(key);
    answer.Answer(answers[key]);

    answer.create();
});
const checks =
    TableChecks
        .NoTableChecksNoSystemFieldsNoChecksNoEvents
        .withEvaluateFieldValues(
            true
        );
targetTableRecord.tableChecks(checks);

targetTableRecord.setFieldValue(
    questionsSourceField,
    catalogItem
);

targetTableRecord.update();

answer = {
    "Success" : true,
    "TargetTable" : targetTable,
    "TargetRecordID" : targetTableRecord.getID()
}
```

It creates the request record, writes one answer row per entry of `answers` pointing at the question it answers, attributes the request to the calling user, and answers `{ Success, TargetTable, TargetRecordID }`. On a bad catalog item id it answers `{ isError: true, error: … }`, so branch on `isError` or on `Success` rather than expecting the node to throw.

If your catalog items point at more than one table, note that this version creates the record in `Incident` — change `Table("Incident")` to `Table(targetTable)`.

### Controller

- **Invoke** — call any controller registered on the instance, for anything the resources above do not cover.

**Controller** offers the instance's controllers by name; **Body (JSON)** is passed through untouched. The answer is emitted as it comes: a list fans out to one item per entry, an object becomes one item.

## Trigger

The **Servicely Trigger** polls on the schedule set in **Poll Times**. Each poll that finds work starts one execution, emitting one item per message or record.

**Trigger On → Async Queue Message** — claims messages from a Servicely async queue.

- **Queue** — the queue to claim from.
- **Action Name** — the subject identifying which messages to claim.
- **Messages Per Poll** — how many to claim at once (default 10).
- Each item is the message payload, with `_servicely.replyTo` identifying it.

> Delivery is **at-least-once**: a claimed message may come again until it is acknowledged. Close the loop with **Queue → Reply Success / Reply Failure**.

**Trigger On → Object (Table Records)** — polls a table and emits the records matching a filter, with the same **Table**, **Limit**, **Filters** and **Options** as **Object → Get Many**. Each poll returns the current matches; it keeps no cursor, so pair a narrowing filter with something that advances state (a "processed" flag, say) to avoid re-emitting the same records.

### Request Options (both nodes)

- **Timeout (ms)** — per-request timeout (default 30000).
- **Max Retries** — retries on rate limits, server errors and network failures, with backoff (default 3; `0` disables).

## SoFi AI Webhook

The **Servicely SoFi AI Webhook Trigger** turns a workflow into a tool the Servicely service desk agent can call: it declares the tool, serves it on an endpoint, and validates the call before the workflow runs. The answer goes back through the **Servicely** node, under the **SoFi AI Webhook** resource.

| | what it does |
| --- | --- |
| **Servicely SoFi AI Webhook Trigger** | declares and serves the tool |
| **Servicely** → *SoFi AI Webhook* → *Send Response* | answers the call |

### Servicely SoFi AI Webhook (trigger)

The tool is named after the **node**, as `[n8n] <node name>`, so rename the node on the canvas and the next activation renames the tool. One node is one tool; name them after what they do, since two nodes left at the default name register two tools the agent cannot tell apart.

> **Ensure the Servicely SoFi AI Webhook package is installed in the target system.** It holds the handler scripts a tool runs — without it the **Handler** list is empty and no tool can be activated. Learn more at [synergy.eu](https://www.synergy.eu).

- **Description** — what the tool does and when to call it. The agent reads it when deciding.
- **Handler Name or ID** — the handler whose script the service desk runs for this tool, required.

  **Configure the webhook handler.** Before activating the workflow, configure a handler in Servicely:

  1. Open **Intelligent automation → Intelligent actions → n8n Webhook Handler**.
  2. Create a new handler or open an existing one.
  3. Enter a clear **Name** and optional **Description**.
  4. Set **Active** to *Yes*.
  5. Add the request logic to **Execution Script**. The script must contain the `@@WEBHOOK_URL@@` placeholder. Do not replace this placeholder manually — the n8n node replaces it with the workflow's webhook URL during activation.
  6. Save the handler.
  7. Return to n8n and select it in **Handler Name or ID**.

  The handler can be reused by multiple n8n tools because each workflow inserts its own webhook URL when it is activated.

  Workflow activation fails if the selected handler no longer exists, is inactive, has an empty script, or does not contain the required placeholder.
- **Parameters** — the tool's arguments: a **Name**, a **Type** (String, Number, Integer, Boolean), a **Required** toggle (on by default) and a **Description** the agent reads.
  - A required argument the call leaves out is rejected. Turn the toggle off and the call runs without it, the workflow simply not seeing that argument.
  - Only the presence check turns off: an argument that *is* sent still has to have the declared type.
- **`IsLiveRun`** — a boolean every tool carries on top of the declared arguments. The agent sends `true` unless the user asked for a test run, so a workflow can tell a live call from a rehearsal. It is passed through as it comes and never rejected; declaring an argument of the same name replaces it.
- **Respond** — when and how the agent is answered: *Using Servicely Node* (default), *Immediately*, or *When Last Node Finishes*.
  - *Using Servicely Node* — the call stays open until a **Servicely** node set to **SoFi AI Webhook → Send Response** runs, however long the workflow takes.
  - *Immediately* — answers as soon as the call is validated.
  - *When Last Node Finishes* — answers with the last node's data, shaped by **Response Data**.
- **Tool Timeout (Seconds)** — how long the service desk waits for an answer before giving up on the call (default 60). n8n keeps the request open for as long as the workflow runs, so this bounds the agent's wait, not the workflow's.
- **The Respond setting and the wiring have to agree.** A call that would go unanswered is refused rather than left hanging: *Using Servicely Node* with no responder in the workflow fails, and so does a responder under either other mode, n8n having already replied by the time it runs.
- **Options → On Validation Error** — respond `400` with the errors, or *Run Workflow Anyway* and pass them on in `json.validation`. Leave the option out and the call is rejected with the `400`.
- **Options → Allow Unknown Parameters** (default on) and **Coerce Types** (default off, converting e.g. the string `"12"` to `12` before validating).
- **Options → the response ones** — **Response Code**, **Response Headers**, **Response Data**, **No Response Body**, and, for a single JSON entry, **Response Content-Type** and **Response Property Name**. Each shows only under the modes it applies to; none appears under *Using Servicely Node*, where the responder carries its own.
- **Options → AI Agent Names or IDs** / **AI Assistant Names or IDs** — who the tool is offered to. Activating the workflow gives it to exactly what you select and takes it away from what you deselect; leave an option out and that side is not touched at all.
- **Options → Role Names or IDs** — the roles the tool is given.
- **Options → Mutates Ticket** — turn it on for a tool that creates, updates or deletes something, or otherwise has side effects.
- **Options → Production Restricted** — keeps the tool out of production instances.

  The last three share one rule: **an option you never add is left alone, an option you add is written as it stands.** So adding Roles and selecting nothing empties the tool's roles, while never adding it leaves whatever the service desk holds.

None of the fields take an expression: the node has no input, and its values are read when the workflow is activated.

The emitted item carries `body`, `parameters` (the declared arguments the call actually sent), `headers`, `query`, `params`, `validation`, and — with a JWT credential — the verified `jwt` payload.

The node takes both credentials: the **Servicely API** one, which backs its lists and the registration, and a **Servicely SoFi AI Webhook Auth API** one deciding what a caller has to present.

### Registration in the service desk

Activating the workflow registers it as a tool the agent can select; deactivating removes it. It never happens on a manual execution — though **Listen for test event** does register the tool, so it can be tried from the service desk while you are still building the workflow.

- The tool carries the node's name, your **Description** as its selection prompt, its declared arguments, and the handler's script with this workflow's URL in it. Re-activate after any change and the tool is brought up to date.
- Each node owns one tool, whatever else the workflow holds, and keeps it through renaming, moving and editing. Delete the node and the next activation removes its tool.
- Roles, **Mutates Ticket** and **Production Restricted** are written only when the node mentions them, so a value set in the service desk by hand survives activation.

### SoFi AI Webhook → Send Response

A resource of the **Servicely** node. It answers the call the trigger is still holding open, and is the only resource needing no **Servicely API** credential.

- **Respond With** — *Success* (status + data) or *Error* (status + message + optional details, e.g. `{{ $json.validation.errors }}`).
- **Data** — all incoming items, the first incoming item, a JSON body you write, or no data.
- **Options → Envelope** (default on) wraps the body in `{ "success": true, "data": … }`; **Message** adds a note to a success; **Response Headers** adds headers.
- Items pass through unchanged, so the workflow can carry on after answering. One call gets one answer however many items reach the node.
- The trigger must have **Respond** set to *Using Servicely Node*; under either other mode it refuses the call outright rather than leaving this node with an answer nobody is waiting for.

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
3. **Servicely → Queue → Reply Success** to acknowledge, or **Reply Failure** on an error branch.

**Expose a workflow as an agent tool**

1. **Servicely SoFi AI Webhook Trigger**, renamed on the canvas to *Create Incident* (the tool registers as `[n8n] Create Incident`), Description "Creates an incident for a user and returns its number", Handler = your webhook handler, AI Agent Names or IDs = the service desk agent.
2. *Parameters:* `shortDescription` (String, required, "What is wrong"), `priority` (Integer, **Required** off, "1 highest to 4 lowest — omit for the default").
3. *Options:* **Mutates Ticket** on, since the call creates a record.
4. **Servicely → Object → Create**, Table `Incident`, fields taken from `={{ $json.parameters.shortDescription }}` and `={{ $json.parameters.priority }}` — the second is absent when the agent omits it, so give it a default downstream.
5. **Servicely → SoFi AI Webhook → Send Response**, Respond With *Success*, Data *First Incoming Item*.

## Compatibility

- **On Validation Error moved into Options in 1.7.0.** A workflow that had set it to *Run Workflow Anyway* loses that choice and rejects invalid calls again until the option is added and set back.
- **The responder's resource is called *SoFi AI Webhook* as of 1.8.0**, and the trigger **Servicely SoFi AI Webhook Trigger** as of 1.5.0. Both are name changes: a saved workflow keeps working and only shows the new names. A node left at the old default name keeps that name until you rename it.
- **The trigger's script and path moved out of the node in 1.4.0.** The **Execution Script** and **Path** fields are gone; choose a **Handler** instead, and the script it points at is kept in Servicely. A workflow that is already active needs two things: re-activate it, because the address the tool answers on has changed, and point anything that called the old address at the new one. If you had written a script in the node, move it to a handler in Servicely and select it — the workflow cannot be activated without one.
- **The responder became a resource of the Servicely node in 1.2.0.** The separate response node is removed; what it did is now **Servicely → SoFi AI Webhook → Send Response**, with the same fields. An active workflow keeps its tool and its endpoint — only the node that answers has to be replaced: delete the old one, add a **Servicely** node in its place, copy the values across, and reconnect it. Until then the trigger refuses calls rather than leaving the agent waiting.
- **Workflows built before 0.8.0** hold node types that are no longer registered and load with unrecognised nodes. Open the workflow, replace both halves with the current pair, and re-activate it; the old tool record is then left to be deleted in the service desk.
- Requires an n8n version supporting community nodes, and the Servicely REST API **v1**.

## Resources

- [Servicely REST API docs](https://docs-servicely.atlassian.net/wiki/spaces/SD/pages/2077523978)
- [n8n community nodes](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](LICENSE.md)
