---
description: Run the approval-gated Senior IT Audit discovery, evaluation, and draft application cycle.
agent: build
---

Run the **Senior IT Audit Job Cycle** workflow and the binding **Senior IT
Audit Package Integrity Addendum** in `modes/_custom.md` exactly.

Before beginning, read `modes/_custom.md`, `modes/scan.md`, `modes/oferta.md`,
and `modes/apply.md`. Treat the Resume Authority Policy in `_custom.md` as
binding throughout. Execute discovery only when this command is explicitly
invoked; do not run the production workflow as part of setup or validation.

Preserve the workflow's two approval checkpoints: stop after discovery for
role selection, then stop after evaluation for role-specific `APPROVE`, `SKIP`,
or `STOP`. Never submit an application, send a message, open or fill an
application form, or mark a role `Applied` without a later explicit user
confirmation of manual submission. Use only established Career-Ops archival,
reporting, tracker, status, and follow-up workflows.

For every individually approved role, require the pre-generation inventory
review, create a separate version-safe application folder, validate the resume
with `.opencode/helpers/audit-package.mjs` against its archived JD, and release a manifest-linked
package only after every integrity gate passes.

Any extra user instruction is: $ARGUMENTS
