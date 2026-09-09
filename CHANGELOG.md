# Changelog

All notable changes to this project are documented here.

> `npm run release` regenerates this file with `auto-changelog`, which builds it
> from the commit log. Anything written here by hand is replaced at the next
> release, so the durable home for migration notes is the **Compatibility**
> section of `README.md`.

## 1.8.4

### Changed

- **These notes are written without internal names.** The entries from 1.4.0 on
  say what changed for a workflow rather than which table, field or type it moved
  through.

## 1.8.3

### Changed

- **The README is written for someone configuring the nodes**, not maintaining
  them: no endpoints, internal names or design rationale. Every field and option a
  workflow sets is still documented, as are the handler setup steps and the
  Service Catalog controller script, and the Compatibility notes now say what to
  do rather than what changed inside.

## 1.8.2

### Changed

- **The Send Response operation no longer presents itself as the AI agent tool.**
  It reads *"Send a webhook response"*, and its description names the SoFi AI
  Webhook Trigger it answers for — the old wording named a tool that no longer
  goes by that name.

## 1.8.1

### Changed

- **The package requirement is stated once, in the credential**, which is where
  both halves of the setup are configured. The trigger's own notice is gone, and
  the credential's reads *"Ensure the Servicely SoFi AI Webhook package is
  installed in the target system"*, with a link for the details.

## 1.8.0

### Changed

- **The responder's resource is called *SoFi AI Webhook*.** 1.5.0 renamed the
  trigger and left the resource answering it as *AI Agent Tool*, so the two halves
  of one feature read as two in the editor. The **Respond** notices and the wiring
  errors follow the new label, and the entry sorts last in the **Resource**
  dropdown, that list being alphabetical.

  A label change only: a saved workflow keeps the resource it selected and needs
  no edit.

## 1.7.0

### Changed

- **On Validation Error is an option rather than a field of its own.** It sits in
  the trigger's **Options**, where leaving it out means the strict answer — the
  call rejected with its validation errors — which is what the field defaulted to.

  **A workflow that had set it to *Run Workflow Anyway* loses that** and rejects
  invalid calls again until the option is added and set back. A workflow left on
  the default needs no edit.

## 1.6.0

### Added

- **The README says how to configure a webhook handler**: where the form lives in
  Servicely, what to fill in, and that the address placeholder is left alone for
  activation to replace.

### Changed

- **Activation now checks the handler the way those instructions describe it.** On
  top of a handler that is missing or holds an empty script, two more cases fail
  the activation instead of registering a tool that cannot work: a handler that is
  not active, which the service desk would not run; and a script with no address
  placeholder in it, which would not call this workflow — and, if someone pasted
  one tool's address in, would silently answer for every other tool selecting it.

## 1.5.0

### Changed

- **The AI Agent Tool trigger is now the *Servicely SoFi AI Webhook Trigger*.** A
  display-name change, reaching everything the feature is called to a person: the
  entry in the nodes panel, the name a dropped node takes on the canvas, and the
  endpoint credential's label, **Servicely SoFi AI Webhook Auth API**.

  Nothing a workflow names moved, so a saved workflow keeps working untouched. A
  node left at the old default canvas name keeps that name, and keeps registering
  its tool under it, until it is renamed by hand.

- **The trigger's Prompt field is now called Description.** A label change only —
  a saved workflow keeps the text it had.

- **Both the trigger and its credential say what the instance needs.** A notice on
  each states that the Servicely package has to be installed, since an instance
  without it shows an empty **Handler** list and nothing else to explain it.

- **The package's files and classes follow the new name.** Renames only: existing
  credentials stay attached and saved workflows keep working.


## 1.4.0

### Changed

- **The trigger runs a handler script kept in Servicely.** The **Execution Script**
  and **Path** fields are removed; a required **Handler** selector replaces them,
  offering the handlers configured on the instance. Activating the workflow reads
  the selected handler's script and registers it as the tool's script, with this
  workflow's own webhook address written into it — so one handler can serve every
  tool, and a handler edited in Servicely reaches each tool that selects it on the
  next activation.

  Nothing is registered without a script: no handler selected, one that is not
  there, or one with an empty script fails the activation rather than registering
  a tool that does nothing when the agent calls it.

  **An active workflow's endpoint moves, and a script written in the node is
  dropped** — see **Compatibility** in `README.md` for what to do about both.

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
