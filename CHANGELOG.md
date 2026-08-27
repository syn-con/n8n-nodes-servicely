# Changelog

All notable changes to this project are documented here.

> `npm run release` regenerates this file with `auto-changelog`, which builds it
> from the commit log. Anything written here by hand is replaced at the next
> release, so the durable home for migration notes is the **Compatibility**
> section of `README.md`.

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
