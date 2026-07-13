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
regeneration; never overwrite another requisition's package. Keep PDF primary;
generate and validate DOCX only as a non-blocking secondary copy through an
enabled, documented exporter.

Every approved package must include a full, searchable Job Description PDF and
an exact Markdown package copy generated solely from the canonical archive in
`data/job-descriptions/`. Run `--create-jd-pdf` before the manifest, require its
checksum and PDF checks to pass, and link both files from the report and the
existing tracker row without changing its status.

After the manifest passes, make exactly one lifecycle call to the same helper:
`--complete-lifecycle`. Provide the package materials, canonical JD, report,
and unchanged tracker status. It is the sole package-completion step: it builds
the index, next steps, timeline, interview workspace, package health, optional
Windows Explorer open, and clipboard copy. Do not duplicate this logic in the
command. Later workflow milestones use `--append-timeline`; neither command
submits an application or changes status.

After lifecycle completion, register or check the package through the same
helper's `--version-package` action. It creates v1 for an initial approved
package and compares CV, archived-JD, resume-source, cover-source, intelligence,
and ATS-answer checksums thereafter. If it reports a material revision, ask
exactly: `A material application-package revision has been identified. Create
version vN? Reply APPROVE, REVISE, SKIP, or STOP.` Do not generate or register
v2+ material without `APPROVE`; use version-suffixed PDFs/DOCX files and record
the precise revision reason. Keep existing tracker status unchanged.

Any extra user instruction is: $ARGUMENTS
