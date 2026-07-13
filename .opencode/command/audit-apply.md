---
description: Prepare a truthful, draft-only Senior IT Audit application package for one selected pending role.
agent: build
---

Run the **Senior IT Audit Application** workflow and the binding **Senior IT
Audit Package Integrity Addendum** in `modes/_custom.md` exactly.

First ask the user to identify one Pending pipeline role by URL, company, or
line unless `$ARGUMENTS` unambiguously identifies it. This command prepares
draft materials only. Never submit an application, send a message, fill a form,
mark a role Applied, or change an application status. Read the full job
description and verify liveness with Playwright before any tailoring.

Do not generate any package file until the role-specific pre-generation
checkpoint has been shown and the user replies `APPROVE`. Before release, run
the user-owned `.opencode/helpers/audit-package.mjs` resume validation with
the archived JD, including its employment reconciliation, and
create the required package manifest. Use versioned files for approved
regeneration; never overwrite another requisition's package.

Any extra user instruction is: $ARGUMENTS
