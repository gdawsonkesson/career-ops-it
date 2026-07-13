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
package only after every integrity gate passes. PDF remains primary; DOCX is a
secondary non-blocking export only when the approved exporter supports it.
For each released package, copy and render the complete canonical archived JD
through `.opencode/helpers/audit-package.mjs --create-jd-pdf`; require matching
archive/package checksums and a searchable PDF before creating the manifest or
updating report and tracker linkage. Never fetch the live posting just to make
this PDF, and never change the tracker status.

After each passing manifest, call `.opencode/helpers/audit-package.mjs
--complete-lifecycle` once with the package files, canonical JD, report, and
unchanged tracker status. This shared helper alone completes package documents,
health, timeline, interview workspace, Windows Explorer open, and clipboard
copy. Use its `--append-timeline` action for later milestones; do not reimplement
any lifecycle behavior in this command.

Call the same helper's `--version-package` after each completed package and
before any material regeneration. It registers v1 and checksum-compares all
substantive package sources later. For a material revision, stop and ask exactly:
`A material application-package revision has been identified. Create version
vN? Reply APPROVE, REVISE, SKIP, or STOP.` Only `APPROVE` permits versioned v2+
files and version registration; reopening, notes, links, and identical renders
remain non-material. Never change tracker status during versioning.

Any extra user instruction is: $ARGUMENTS
