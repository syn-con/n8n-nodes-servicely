# Changelog

All notable changes to this project are documented here.

> `npm run release` regenerates this file with `auto-changelog`, which builds it
> from the commit log. Anything written here by hand is replaced at the next
> release, so the durable home for migration notes is the **Compatibility**
> section of `README.md`.

## 1.4.0

### Changed

- **The AI Agent Tool trigger runs a handler script kept on the instance.**
  **Options -> Execution Script** and **Path** are removed; a required **Handler**
  selector replaces them, loaded from the instance's `C_n8n_Webhook_Handler`
  table (labelled by `C_Name`, stored by record id). Activation fetches that
  record, takes its `C_ExecutionScript`, and registers it as the tool's
  `ExecutionScript` with every `@@WEBHOOK_URL@@` resolved to this tool's webhook
  URL -- so one handler script serves every tool, each still posting to its own
  endpoint, and a script edited in the service desk reaches every tool that
  selects it on the next activation.

  Nothing is written before that script is in hand: no handler selected, a record
  that is not there, or a record with an empty script fails the activation rather
  than registering a tool that does nothing when the agent calls it.

  With **Path** gone the tool answers on `/webhook/<node id>` -- the same node id
  it is registered under, so renaming or moving the node no longer moves the URL
  the handler's script was given. **An active workflow's endpoint moves, and a
  script written in the node is dropped**; see **Compatibility** in `README.md`
  for what to do about both.

## 1.3.1

### Fixed

- **The Servicely Trigger's settings panel would not open**, failing with
  `Could not resolve parameter dependencies. Max iterations reached!` The shared
  **Request Options** fragment carried `displayOptions: { hide: { resource:
  ['aiAgentTool'] } }` — correct on the Servicely node, which has a `resource`
  parameter, and dangling on the trigger, which does not. n8n's editor orders a
  node's parameters by resolving the dependencies their `displayOptions` declare,
  and a condition naming a parameter the node has no trace of is one it can never
  resolve, so it gives up and the panel never renders.

  The resource scope now lives on the Servicely node's own property list, and the
  shared fragment is declared without `displayOptions` like every other fragment
  beside it. Both nodes show exactly the fields they showed before — nothing
  stored changes, and no workflow needs editing.

  Introduced in 1.2.0, when the AI Agent Tool responder became a resource.

  A test now walks every registered node and asserts that no `displayOptions`
  condition, and no `loadOptionsDependsOn` entry, names a parameter that node does
  not declare — the class of bug that passes every unit test and both linters
  while leaving a node unusable in the UI.

## 1.3.0

### Added

- **Service Catalog resource**, with a single **Create Request** operation: one
  `POST {instanceUrl}/controller/ServiceCatalog` carrying the catalog item and
  the answers keyed by question record id. The node does not read the catalog
  item, create the request record or write `Answer` rows — where the record goes
  and how each answer is stored is the instance's to decide, and the controller
  owns all of it. One write, so there is never a partly built request to clean up.

  - **Catalog Item** — a searchable picker over `CatalogItem`, labelled by `Name`
    rather than by `Number` as the other record pickers are: a catalog item is
    published, and recognised, under its name.
  - **Questions** — a resource mapper whose schema is every `Question` row of the
    selected item, rendered as a form. Ordered by `Order`, required only on a real
    boolean `Mandatory`/`Required`, labelled `Name [Datatype]`, and typed from the
    datatype with a plain text box as the fallback. An answer left blank is dropped
    rather than sent as an empty string.

  **This needs a controller named `ServiceCatalog` on the instance**, which
  Servicely does not ship. The README's [Service Catalog](README.md#service-catalog)
  section carries a reference script and what the node relies on it doing.

## 1.2.0

### Breaking

- **The `servicelyAiAgentTool` node is removed.** What it did — answering a call
  the Servicely AI Agent Tool Trigger let in — is now the **AI Agent Tool**
  resource of the **Servicely** node, with a single **Send Response** operation
  and the same fields under the same names.

  n8n's [verification guidelines][verification] allow a package one regular node
  plus a trigger for the same service; this package registered two regular nodes
  (`Servicely` and `ServicelyAITool`), which blocks verification.

  **Migrating a workflow:** open it, delete the *Servicely AI Agent Tool
  Response* node, put a **Servicely** node in its place with Resource *AI Agent
  Tool* and Operation *Send Response*, copy the Respond With / Data / Options
  values across, and reconnect it. Until then the trigger refuses calls with
  `No Servicely node set to "AI Agent Tool" found in the workflow` rather than
  leaving the agent waiting.

  **The trigger is untouched** — same `servicelyAiAgentToolTrigger` type, same
  parameters, same registered tool — so an active workflow keeps its tool
  registration and its endpoint. Only the node that answers has to be replaced.

- **The trigger's Respond option *Using Servicely AI Agent Tool Response Node* is
  now labelled *Using Servicely Node*.** Only the label changed; the stored value
  is unchanged, so a saved workflow keeps the mode it had and needs no edit.

### Changed

- The **Servicely API** credential is no longer asked for on the AI Agent Tool
  resource, and **Request Options** are hidden there: that resource answers an
  open request and never calls the instance.
- The trigger's wiring check now looks for a Servicely node whose Resource is
  *AI Agent Tool*, reading its parameters via `getChildNodes`. A Servicely node
  doing the tool's actual work no longer reads as the thing that answers.
- One request still gets one answer however many items reach the node: the
  response is built from the whole batch and sent once, and every item passes
  through unchanged.

## 1.1.1 and earlier

See the git history and the **Compatibility** section of `README.md`.
