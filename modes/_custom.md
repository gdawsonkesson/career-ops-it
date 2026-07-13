# Custom Instructions -- career-ops

<!-- ============================================================
     THIS FILE IS YOURS. It will NEVER be auto-updated.

     Put your own house rules, custom workflows, and automations
     here -- anything you want the agent to ALWAYS do (or never do).

     This is for PROCEDURAL rules ("HOW I want things done").
     For WHO you are (archetypes, narrative, comp, negotiation),
     use modes/_profile.md instead. Keeping the two separate keeps
     each one readable.

     The agent reads this file alongside the system instructions;
     your rules here take precedence over the defaults, as long as
     they don't break the Data Contract (your files are never
     touched, and we never auto-submit an application for you).

     Because this is a user-layer file, anything you write here
     survives `node update-system.mjs`. Put customizations HERE,
     not in CLAUDE.md / modes/_shared.md / other system files --
     those get overwritten on update.
     ============================================================ -->

## House Rules

<!-- Rules the agent should always follow. Examples:
     - Always write evaluation summaries in British English.
     - Never include a photo in my CV (US / ATS-first market).
     - Cap each batch run at 20 listings unless I say otherwise.
     - If a report scores below 6, skip the cover letter. -->

### Resume Authority Policy

`cv.md` is authoritative for all resume content. When a supported field such as
LinkedIn, GitHub, portfolio URL, website, or social profile is absent from
`cv.md`, treat that omission as intentional. Do not report it as missing,
recommend adding it, list it as blank, include it in validation summaries,
generate a warning, or lower fit because of it. Mention or include it only when
it already exists in `cv.md` or the user explicitly requests it for a specific
application. Application reports, validation reports, and workflow summaries
must focus only on actual errors, conflicts, or unsupported claims.

## Custom Workflows

<!-- Multi-step routines you run often, given a short name. Examples:
     - "weekly review": scan my saved portals, evaluate the new roles,
       then give me a one-paragraph summary of the top 3.
     - "prep <company>": pull the JD, generate STAR stories from
       article-digest.md, and draft 5 likely interview questions. -->

### Daily Senior IT Audit Scan

**Invocation:** In OpenCode, run `/daily-audit-scan`. In other Career-Ops
clients, say: `Run the Daily Senior IT Audit Scan workflow from
modes/_custom.md.` This is a discovery-only workflow. It must never evaluate
an offer, tailor or generate application materials, open or fill an
application, send a message, submit an application, create a report or PDF,
or change an application status. Human approval is required before any later
evaluation or application action.

**Scope:** Search United States individual-contributor roles only. Prefer
remote roles. Include hybrid roles only when the stated location and commute
expectations are reasonable. When compensation is published, require at least
$100,000; do not reject an otherwise qualified role because compensation is
unpublished.

**Target titles:**
- Senior IT Auditor
- Senior Information Systems Auditor
- Senior Information Technology Auditor
- Senior Technology Auditor
- Senior Internal IT Auditor
- Senior SOX IT Auditor
- Senior IT Audit Consultant
- IT Auditor III
- Senior IT Controls Auditor
- Senior Technology Assurance Consultant
- Senior Cybersecurity Auditor, only when audit-focused
- Senior SOC 1 Auditor
- Senior SOC 2 Auditor
- Senior SOC Auditor, only when SOC means assurance or attestation, not a
  Security Operations Center

**Conditional titles:** Consider IT Auditor, Information Systems Auditor,
Technology Auditor, IT Audit Consultant, Technology Assurance, IT Controls
Auditor, and Senior Internal Auditor only after the full description confirms
senior-level IT audit work.

**Hard exclusions:** Exclude manager, senior manager, director, vice
president, VP, chief audit executive, head of audit, head of IT audit, junior,
intern, entry-level, and graduate roles. Exclude risk-first, technology risk,
operational risk, enterprise risk, GRC-first, governance-first,
compliance-only, risk-and-compliance, Security Operations Center, SOC analyst,
SOC engineer, incident response, threat hunter, blue team, SIEM engineer,
MDR, and XDR roles. Exclude Bank of America, 4 Square IT Consulting, and
Keurig Dr Pepper. Exclude roles requiring an active security clearance, and
roles that require sponsorship when the employer cannot accept a U.S.
permanent resident.

**Procedure:**
1. **Read-only setup.** Read `portals.yml` and list every enabled
   `tracked_companies` entry and its `scan_query`; do not alter that file. Read
   `data/pipeline.md`, `data/scan-history.tsv`, and `data/applications.md`
   when present. Keep their URLs, normalized company/title pairs, requisition
   IDs, and statuses in memory as the initial deduplication set.
2. **Read-only zero-token discovery.** Run `node scan.mjs --dry-run`. Capture
   supported-provider results and web-search handoffs in memory. Never run
   `node scan.mjs` without `--dry-run` during discovery, and do not invoke the
   pipeline mode.
3. **Read-only Tavily discovery.** Do not use
   `node plugins.mjs run tavily search ...`, including with `--dry-run`; that
   CLI may append results to `data/pipeline.md`. Instead, invoke the installed
   Tavily plugin's declared `search` hook directly and retain its JSON output
   only in memory:
   ```powershell
   node --env-file=.env -e "(async () => { const plugin = await import('./plugins.local/tavily/index.mjs'); const jobs = await plugin.default.search(process.argv[1], { env: process.env, settings: { maxResults: 10 } }); console.log(JSON.stringify(jobs)); })().catch(error => { console.error(error.message); process.exit(1); });" "<query>"
   ```
   `--env-file=.env` reads the configured credential without changing or
   exposing it. If this hook is unavailable or errors, record the failed query
   and continue with the supported structured results.
4. Run the direct in-memory Tavily search for each tracked-company handoff
   using its `scan_query`. Run broader in-memory searches across direct
   employer careers pages, prioritizing canonical employer postings on these
   ATS platforms: Workday, Greenhouse, Ashby, Lever, SmartRecruiters, iCIMS,
   BambooHR, Teamtailor, Jobvite, Oracle Recruiting Cloud, UKG Recruiting, SAP
   SuccessFactors, and Rippling Careers. Search remote and United States
   variants separately for each of these exact title variants: "Senior IT
   Auditor", "Senior Information Systems Auditor", "Senior Information
   Technology Auditor", "Senior Technology Auditor", "Senior SOX IT Auditor",
   "Senior IT Controls Auditor", "Senior IT Audit Consultant", "IT Auditor
   III", "Senior Technology Assurance Consultant", "Senior Cybersecurity
   Auditor", "Senior SOC 1 Auditor", and "Senior SOC 2 Auditor". Use the
   conditional titles only as leads that require complete-description
   confirmation. Prefer an employer's canonical posting or ATS posting; use
   aggregators only to locate that posting.
5. **Filter and deduplicate in memory.** Merge the dry-run scan and Tavily
   results, canonicalize direct URLs, and reject Indeed, LinkedIn, Dice,
   Glassdoor, ZipRecruiter, Ladders, Built In, and comparable aggregators or
   search-results URLs. Deduplicate by direct URL first, then company plus
   title, then requisition ID against the initial in-memory set. Prefer one
   direct employer posting over an agency or aggregator cross-listing. Apply
   all title, seniority, management/risk/GRC/compliance/security-operations,
   location, salary, clearance, and sponsorship rules before browser work.
6. **Verify candidates without writing.** For every surviving candidate, find
   the canonical employer posting and read the complete direct job description
   as needed to confirm senior IC IT-audit scope, United States work location,
   remote or reasonable hybrid expectations, published compensation,
   exclusions, clearance requirements, and sponsorship restrictions. Do not
   infer missing compensation, remote status, responsibilities, or
   qualifications. Use Playwright against the canonical URL to confirm the
   posting is active: its title, substantive job description, and an apply
   control must be visible in the posting content. If verification is
   unavailable or inconclusive, do not queue the role; report it as unverified.
   Treat expired pages as rejected. Keep every qualified, verified result only
   in an in-memory `verified_adds` collection.
7. **Pre-pipeline quality scoring.** Score only candidates that have passed
   every hard filter and Playwright verification. Reject regardless of score:
   manager, director, VP, chief audit executive, risk-first, GRC-first,
   compliance-only, security-operations, active-clearance-required, expired,
   aggregator-only, published-salary-below-$100,000, and incompatible-location
   roles. A hybrid role outside reasonable commuting range of
   Cincinnati/Fairfield is incompatible and rejected; record its -20 location
   penalty in the summary for diagnostics, but do not treat it as eligible.

   Score each eligible role in memory using the following additive rules:

   | Signal | Points |
   |---|---:|
   | Fully remote, United States | +20 |
   | Hybrid within reasonable Cincinnati/Fairfield commuting range | +12 |
   | Published salary at least $130,000 | +20 |
   | Published salary $115,000-$129,999 | +15 |
   | Published salary $100,000-$114,999 | +10 |
   | Salary unpublished | +5 |
   | Exact primary target title | +20 |
   | Conditional title confirmed by the complete JD as senior IT audit | +12 |
   | Individual-contributor role | +10 |
   | Direct employer branded canonical posting | +8 |
   | Canonical employer ATS posting when no branded posting is available | +5 |
   | Strong ITGC, SOX, or technology-audit alignment | +10 |
   | Strong SOC 1, SOC 2, or attestation alignment | +10 |
   | Cloud, cybersecurity, or systems-audit emphasis | +5 |
   | CISA preferred or required | +5 |
   | U.S. permanent resident eligible with no sponsorship issue | +5 |
   | Title remains ambiguous after complete-JD review | -15 |
   | Heavy financial-audit focus with limited technology scope | -15 |
   | Consulting role requiring constant client travel | -10 |

   The two posting-source rows are mutually exclusive. Record the total and a
   one-line rationale in the end-of-run summary, but never add the score to
   `data/pipeline.md`. Queue only scores of 70 or higher. Report scores of
   55-69 as `borderline — not queued`; reject scores below 55.
8. **Single final append stage.** Only after every discovery, filtering,
   scoring, and Playwright verification step is complete, re-read
   `data/pipeline.md`, `data/scan-history.tsv`, and `data/applications.md` and
   repeat the complete deduplication check. Append only remaining
   `verified_adds` with a score of 70 or higher to the Pending section of
   `data/pipeline.md` in this exact format:
   `- [ ] URL | Company | Job title | Location | Salary if published`
   If `verified_adds` is empty, write nothing. Record title, duplicate, and
   expired discoveries in `data/scan-history.tsv` only through the
   repository's established scan workflow and statuses; do not invent a new
   file format. Do not create reports, tracker entries, PDFs, CVs, cover
   letters, form answers, or application submissions.
9. **No cleanup phase.** Discovery never writes to `data/pipeline.md` or any
   other user data file, so never remove temporary pipeline entries. The final
   append stage is the workflow's only permitted data mutation.

**Required end-of-run summary:** Report the tracked companies searched,
broader searches executed, raw results found, aggregator/duplicate rejections,
title/seniority rejections, management/risk/GRC/compliance/security-operations
rejections, location/salary/clearance/sponsorship/expired rejections, verified
jobs added to `data/pipeline.md`, companies and titles added, every scored role
with its score and brief reason, borderline roles not queued, and searches that
failed or could not be verified.

### Senior IT Audit Application

**Invocation:** In OpenCode, run `/audit-apply`, then identify one Pending
pipeline role by its URL, company, or line. Invocation and role selection are
the user's explicit approval to evaluate that one role and prepare draft
materials only. They are never approval to submit, send a message, or change a
status.

**Purpose:** Prepare a truthful, ATS-friendly application package for one
user-selected Pending role. Focus on job application preparation only, never
interview preparation.

**Procedure:**
1. Ask the user to identify the Pending role by URL, company, or line. If the
   identifier is ambiguous, list only matching Pending entries and ask them to
   choose one. Do not evaluate or generate anything until one role is selected.
2. Read `data/pipeline.md`, `data/scan-history.tsv`, and
   `data/applications.md` when present. Check for a matching prior application
   before any material generation.
3. Use Playwright against the employer's canonical posting to confirm the role
   remains active: title, substantive job description, and an apply control
   must be visible. If not active or verification is inconclusive, stop and
   report the reason without changing the pipeline or tracker.
4. **Archive before evaluation.** Capture the complete source-backed JD before
   any fit review, tailoring, or application preparation. Send the captured
   fields and complete posting text as JSON on stdin to
   `node data/job-descriptions/archive-jd.mjs`. Use the stable filename format
   `YYYY-MM-DD_company_job-title_requisition-id.md`; use the helper's URL hash
   identifier only when no requisition or posting ID is available. The archive
   must include the canonical URL, requisition ID when available, first
   discovered date, captured date and time, last verified date, status,
   location, work arrangement, compensation, employment type, travel,
   work-authorization language, security-clearance language, and the complete
   JD. Use `Not stated in posting` only for required archive fields absent from
   the source. On a revisit, preserve the original capture date and allow the
   helper to append a dated update only when the posting materially changed.
   Do not overwrite a different requisition.
5. Read the complete JD and assess it only against `cv.md`,
   `config/profile.yml`, and `modes/_profile.md`. If these sources conflict,
   flag the conflict and use only the claim that is explicitly supported by
   `cv.md` or `_profile.md`; never silently select placeholder or conflicting
   identity data.
6. Produce or update one application report per canonical URL/requisition. The
   report must link the archived JD path and record canonical URL, requisition
   ID, evaluation date, fit score, matched requirements, gaps, risks, and the
   tailoring plan. Store user-approved ATS answers and generated resume, DOCX,
   PDF, and cover-letter filenames in this report when created. Never mention
   intentionally omitted resume fields.
7. Create `data/applications.md` with the repository's canonical tracker header
   only when it does not exist. For the first formal evaluation, write a TSV to
   `batch/tracker-additions/` and run `node merge-tracker.mjs`; never hand-add
   an application row. Deduplicate by canonical URL, requisition ID, and
   company plus job title before creating either report or tracker addition.
   Use canonical status `Evaluated` and store requisition ID, canonical URL, JD
   archive path, discovery/evaluation dates, output filenames, follow-up date,
   and notes in the canonical Notes field. Use `node set-status.mjs` only after
   explicit user confirmation of a status change.
8. Produce an internal application review: fit score on the repository's
   1-5 scale, key matched requirements with source-backed evidence, gaps or
   risks, and a truthful tailoring plan. Never invent any experience, skill,
   certification, employer, date, metric, project, responsibility, or
   portfolio content. Do not add project or portfolio content unless the user
   explicitly requests it.
9. If fit is below 4.0/5, stop and ask for explicit approval before generating
   any materials. If fit is at least 4.0/5, prepare draft materials only:
   - Generate an ATS-friendly tailored CV PDF using the existing Career-Ops PDF
     workflow after reading the JD.
   - Run `node plugins.mjs list`; generate a DOCX only when an enabled installed
     DOCX exporter is available. Otherwise report it as unavailable.
   - Generate a cover letter only when the JD requires one or it is clearly
     beneficial; otherwise state why it was omitted.
   - Draft concise, truthful answers for common ATS questions from the JD.
   - Prepare a read-only application prefill summary. Never open, fill, or
     submit an application form.
10. Stop at a final review checkpoint. Show files created, resume filename,
   cover-letter filename when created, draft answers, unanswered knockout
   questions, and the exact next manual action. Never submit an application,
   send email or LinkedIn messages, mark a role Applied, or change any status
   without a separate explicit user confirmation.

**Safety rules:** Human approval is required before evaluation beyond discovery
and before every application status change. Never auto-submit, auto-send, or
make unsupported claims. Do not target Manager, Director, VP, or Chief Audit
Executive roles, or Bank of America, 4 Square IT Consulting, or Keurig Dr
Pepper. Do not create reports unless the user explicitly asks for an evaluation
report; the normal output is the review and draft application package only.

### Senior IT Audit Job Cycle

**Invocation:** In OpenCode, run `/audit-job-cycle`. This is the consolidated
Senior IT Audit discovery and application-preparation workflow. It preserves
the approval checkpoints below and never submits an application, sends a
message, or infers a submission.

**Resume authority:** Apply the Resume Authority Policy above throughout every
phase. Intentional omissions from `cv.md` are not gaps, risks, warnings,
recommendations, score inputs, or application-material fields.

**Phase 1 - Discovery:** Execute the **Daily Senior IT Audit Scan** procedure
in this file, steps 1 through 9, exactly. In particular, search all tracked
companies, run `node scan.mjs --dry-run`, invoke the Tavily `search` hook in
memory only, verify direct employer postings with Playwright, apply every
listed target, exclusion, location, compensation, authorization, clearance,
and quality-score rule, and keep discovery read-only until its single final
append stage. Add only Playwright-verified roles with pre-pipeline quality
scores of 70 or higher to `data/pipeline.md`; do not add temporary,
aggregator-only, duplicate, expired, or unverified entries.

Before discovery, retain the existing Pending entries in memory. After the
final append stage, report newly added roles with company, job title,
location/work arrangement, published salary when present, quality score,
one-line score reason, and canonical URL. List the previously pending roles in
a separate section. If no qualified roles were newly added, state that clearly
and stop. Otherwise ask exactly:

`Which role or roles should I prepare? Reply with the company, pipeline number, or URL. You may also reply STOP.`

Do not enter Phase 3 until the user selects one or more unambiguous roles. On
`STOP`, end the workflow without further writes.

**Phase 3 - JD archival and evaluation:** For each selected role, reverify its
canonical direct-employer posting with Playwright. Confirm the role title,
complete substantive JD, and an Apply control are visible. If any signal is
absent, stop work on that role and explain why without creating materials.

For each verified role, follow steps 2 through 8 of the **Senior IT Audit
Application** procedure above, except do not generate application materials in
this phase. This means archive the complete JD with
`node data/job-descriptions/archive-jd.mjs`, deduplicate by requisition ID,
canonical URL, and company plus title, then create or update the established
report and tracker record through the repository's canonical TSV/merge
workflow. The tracker status must be `Evaluated` only. Calculate the
source-backed 1-5 fit score against the approved sources, and report matched
requirements, gaps, risks, knockout questions, and a truthful tailoring plan.
Never create a duplicate report or tracker row.

**Phase 4 - Material-generation checkpoint:** After each role's evaluation,
ask exactly:

`Fit evaluation is complete. Generate the application package for this role? Reply APPROVE, SKIP, or STOP.`

Do not create materials without `APPROVE` for that specific role. If the fit
score is below 4.0/5, explain that it is below the repository's recommended
application threshold and require this explicit `APPROVE`; selection or a
previous approval is not sufficient. `SKIP` leaves the role at `Evaluated`.
`STOP` ends all remaining work.

**Phase 5 - Application-package preparation:** Only after the role-specific
`APPROVE`, use the established Career-Ops PDF workflow to generate an
ATS-friendly tailored resume from substantiated `cv.md` content. Do not add a
legal or alternate name, social profile, portfolio, GitHub account, project,
or unsupported claim. Run `node plugins.mjs list` and generate DOCX only when
a supported exporter is both installed and enabled. Generate a cover letter
only when required by the JD or clearly beneficial. Draft truthful ATS and
application answers and a read-only form-prefill summary. Store generated
filenames in the established report/tracker structure; store an answer as
approved only after the user explicitly approves that answer. Do not open or
fill a form, submit an application, send email or LinkedIn messages, or change
the tracker status from `Evaluated`.

**Phase 6 - Final review:** For every prepared role, end with the company and
role, fit score, JD archive path, evaluation report path, resume PDF path,
DOCX path when available, cover-letter path when created, draft ATS answers,
unanswered knockout questions, current tracker status, and the exact manual
next action. State exactly: `No application has been submitted or marked Applied.`

**Phase 7 - Confirmed manual submission only:** Only after the user later
explicitly confirms they manually submitted a specific role, use
`node set-status.mjs <report#> Applied --note "Submitted YYYY-MM-DD"` with the
confirmed application date, then run
`node followup-seed.mjs <report#> --date YYYY-MM-DD --json` to record the
appropriate follow-up date. Never infer submission or change a status from
`Evaluated` to `Applied` without that explicit confirmation.

## Output Preferences

<!-- How you like results formatted. Examples:
     - Reports: lead with the score and the one-line verdict.
     - Show the per-step token breakdown after a batch run.
     - Save PDFs date-first: YYYY-MM-DD-company.pdf -->

(none yet -- add yours above)

### Senior IT Audit Package Integrity Addendum

**Scope and precedence:** This addendum is binding for `/audit-apply` and
`/audit-job-cycle` and supersedes any less strict package-generation language
above. It uses only `cv.md` for candidate facts and the archived JD for job
facts. It never changes `cv.md`, `config/profile.yml`, `modes/_profile.md`,
`portals.yml`, `.env`, an archived JD, or an existing tracker status.

**Source and tailoring boundaries:** Do not invent, enhance, combine, rename,
or infer credentials. Preserve employment titles, employers, dates, and
chronology. Preserve all existing education and certifications even when space
is tight; do not combine certifications with education or training, and do not
describe training as a degree, certification as employment, SOC report review
as SOC examination delivery, cloud exposure as cloud-audit leadership, or a
tool/framework as experience unless `cv.md` says so. Do not create project or
portfolio sections unless the user explicitly asks. Tailoring may reorder
supported experience bullets and skills, rewrite the summary from supported
facts, and use JD terminology only for source-backed experience. It may
emphasize IT audit, ITGC, SOX, access, change, SDLC, IT operations, cloud,
cybersecurity controls, SOC review, data analytics, AuditBoard, Workiva, AWS,
GCP, and stakeholder reporting only when supported by `cv.md`.

**Required resume structure:** Every tailored resume source and rendered resume
must retain, when present in `cv.md`, distinct sections for candidate name and
contact information, Professional Summary, Core Competencies or Technical
Skills, Professional Experience, Certifications, and Education. Styling may
change, but categories may not be merged.

**Pre-generation inventory and checkpoint:** Before creating any package file:
1. Read `cv.md` and the archived JD, then run:
   `node .opencode/helpers/audit-package.mjs --inspect --cv cv.md --jd <archived-jd-path>`.
2. Display Company, job title, requisition ID, archived JD path, fit score,
   tailoring priorities, material risks/gaps, the complete certification
   inventory, and the complete education inventory. For each certification
   preserve its exact name and credential wording plus issuing organisation,
   status, and date when stated. For each education item preserve its exact
   qualification, field, institution, location, and dates when stated. Never
   infer an absent field.
3. Ask exactly: `Generate the tailored resume and cover letter using this
   verified source inventory? Reply APPROVE, REVISE, SKIP, or STOP.`
4. Do not create, modify, render, or link package materials without a
   role-specific `APPROVE`. `REVISE` returns to the inventory, `SKIP` leaves
   the role Evaluated, and `STOP` ends all remaining roles.

**Package folder and filenames:** Create one folder per approved requisition:
`output/applications/YYYY-MM-DD_company_job-title_requisition-id/`, using
Windows-safe lowercase slugs for the folder components. Derive the candidate
file tag from the candidate name in `cv.md` only; for the current heading this
is `George-Dawson`, not the credential suffix. Use Windows-safe title-cased
file components:

```text
YYYY-MM-DD_Company_Job-Title_Req-ID_George-Dawson_Resume.md
YYYY-MM-DD_Company_Job-Title_Req-ID_George-Dawson_Resume.html
YYYY-MM-DD_Company_Job-Title_Req-ID_George-Dawson_Resume.pdf
YYYY-MM-DD_Company_Job-Title_Req-ID_George-Dawson_Resume.docx  (only if supported)
YYYY-MM-DD_Company_Job-Title_Req-ID_George-Dawson_Cover-Letter.md
YYYY-MM-DD_Company_Job-Title_Req-ID_George-Dawson_Cover-Letter.pdf
YYYY-MM-DD_Company_Job-Title_Req-ID_George-Dawson_Cover-Letter.docx  (only if supported)
YYYY-MM-DD_Company_Job-Title_Req-ID_Evaluation.md  (reference to the canonical report)
application-answers.md
manifest.md
```

Never overwrite a package for another requisition. Before regenerating, check
the package manifest and source checksum. Do not create duplicate `_v1` files
when an identical package exists. After an approved revision for the same
requisition, use `_v2`, `_v3`, and so on immediately before the extension.

**Generation and reconciliation:** Write a readable Markdown resume source
first. It is the review source for the PDF and any DOCX. Before rendering,
run:
`node .opencode/helpers/audit-package.mjs --validate-resume --cv cv.md --jd <archived-jd-path> --resume <package-resume.md>`.
Release no resume when the command reports a failure. Correct and rerun until
it passes. This reconciliation confirms source certifications and education
are each present exactly once, unrenamed, in their own sections, with no
unsupported additions, and that candidate identity/contact details plus
employment titles/dates remain source-accurate. Review the output as well for
active/pending certification wording; preserve the exact source wording rather
than assigning a status that `cv.md` does not state.

**Employment inventory and reconciliation:** Before tailoring, extract every
`cv.md` Professional Experience entry, including employer, exact title, dates,
location, stated engagement structure, nested/concurrent relationship,
responsibilities, tools/platforms, audit/control domains, metrics/achievements,
and leadership/stakeholder responsibilities. Employer exclusions apply only to
future job targets; they never remove or suppress source work history.

Every source role remains represented. Condense less-relevant roles only after
preserving their exact employer, title, and dates. Do not merge employers or
roles, convert consulting/contract work to direct employment, reattribute a
role's responsibility/tool/metric, change chronology, or add unsupported work.
Assess each role for IT audit, ITGC/SOX, access/change/SDLC/operations,
SOC/third-party assurance, cloud/cybersecurity/infrastructure, data analytics/
AuditBoard/Workiva/executive reporting, and transferable leadership/stakeholder
relevance. Use that assessment to select and order source-backed bullets, not
to rewrite history.

The enhanced validator blocks release unless all results are PASS: source
employers and roles represented; exact employer names, titles, and dates;
chronology; nested/concurrent structure; contract/consulting accuracy; no
employer or responsibility conflation; no unsupported experience; and
appropriate relevance emphasis. For a materially changed released resume,
correct the source, regenerate HTML/PDF as `_v2`, `_v3`, and so on, then update
the manifest, report, and tracker references while keeping the tracker status
unchanged.

Render the ATS-friendly PDF from the validated source using the established
HTML/PDF workflow. Use `node plugins.mjs list` to detect a supported installed
and enabled DOCX exporter. Generate DOCX only when one exists; otherwise state
`DOCX unavailable; PDF generation was not blocked.` Never rename HTML, Markdown,
or PDF to create a fake DOCX.

**Cover letter and answers:** Generate a concise, job-specific cover letter
after resume approval unless the employer expressly declines it, there is no
cover-letter option and no practical benefit, or the user says not to. Use the
exact company and title. Keep candidate claims traceable to `cv.md`, JD claims
traceable to the archived JD, and distinguish demonstrated strengths from
developing exposure. Do not repeat resume bullets, use generic praise, make
unsupported company claims, or fabricate achievements, connections,
motivations, credentials, education, tools, employers, projects, or metrics.
Perform and record a sentence-by-sentence source audit before release. Draft
truthful application answers in `application-answers.md`; no form is opened,
filled, sent, or submitted.

**Manifest, report, and tracker linkage:** After every integrity gate passes,
create `manifest.md` only with:
`node .opencode/helpers/audit-package.mjs --create-manifest --approved APPROVE ...`.
Provide all required file paths and PASS results. The manifest records company,
title, requisition, canonical URL, JD/archive and report paths, score,
generation timestamp, `cv.md` SHA-256, all generated files, certification and
education reconciliation, cover-letter source audit, employment reconciliation,
all source employers and roles represented, employer/title/date integrity,
chronology integrity, engagement-structure integrity, no employer or
responsibility conflation, relevant-experience appreciation, status, approval, and
`Application submitted: No`.

Create the dated evaluation-reference file in the package linking to, rather
than duplicating or renaming, the canonical evaluation report. Update that
canonical report's `## Generated Files`/package section with every package
path, JD path, score, date, manifest, and status. Link the same paths in the
existing tracker row through `node set-status.mjs <report#> Evaluated --note
"Package: <folder>; Manifest: <manifest>; Resume PDF: <file>; Resume DOCX:
<file-or-unavailable>; Cover letter: <file>; JD: <path>; Generated:
YYYY-MM-DD"`. This preserves its current `Evaluated` status and never marks it
Applied. Do not create a duplicate tracker row.

**Final quality gate and response:** Before presenting files, verify the
candidate name/contact information, employment titles/dates, all certification
and education reconciliation results, distinct section placement, absence of
unsupported claims, exact company/title/requisition match to the archived JD,
Windows-safe required filename tags, manifest coverage of every generated file,
report/tracker linkage, and `Application submitted: No`. Stop, correct, and
rerun any failed check. Then show the resume PDF path, DOCX path or
unavailability, cover-letter path, `application-answers.md`, package folder,
and manifest path. State exactly: `The files are ready for review and download.
No application has been submitted or marked Applied.`

## Off-Limits

<!-- Things the agent must never do for you. Examples:
     - Never auto-fill or submit an application without showing me first.
     - Never edit a system file to customize my setup -- put it here. -->

(none yet -- add yours above)
