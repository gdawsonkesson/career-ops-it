# Custom Instructions — career-ops
# George Dawson, CISA — Senior IT Audit Pipeline

<!-- ============================================================
     THIS FILE IS YOURS. It will NEVER be auto-updated.
     Your rules here take precedence over system defaults.
     For WHO you are, use modes/_profile.md instead.
     ============================================================ -->

## House Rules

### Resume Authority Policy

`cv.md` is authoritative for all resume content. When a supported field
such as LinkedIn, GitHub, portfolio URL, website, or social profile is
absent from `cv.md`, treat that omission as intentional. Do not report it
as missing, recommend adding it, list it as blank, include it in validation
summaries, generate a warning, or lower fit because of it. Mention or
include it only when it already exists in `cv.md` or the user explicitly
requests it for a specific application. Application reports, validation
reports, and workflow summaries must focus only on actual errors, conflicts,
or unsupported claims.

### Pipeline Separation Policy

This repo operates TWO pipelines. They are strictly separate and must
never be mixed:

1. **Senior IT Audit Pipeline** (THIS file — active)
   - Senior IT Auditor and related IC IT audit roles only
   - Remote only — no hybrid, no onsite
   - Minimum salary $100,000 USD published or unpublished
   - No GRC, compliance-only, risk-only, or security-operations roles
   - No managerial, director, VP, or executive roles

2. **GRC Pipeline** (modes/_custom_grc.md — future, not yet active)
   - Separate workflow for GRC/compliance roles
   - Not active — do not process GRC roles in this pipeline

If a role is GRC-first, compliance-only, risk-and-compliance, or
governance-first, reject it immediately and do not queue it, evaluate it,
or generate materials for it. Log it as rejected with reason "GRC — wrong
pipeline" in the end-of-run summary.

### Remote-Only Hard Rule

**This pipeline is remote-only.** No exceptions.

- Reject ANY role that is not explicitly remote or does not clearly permit
  fully remote work for a US-based candidate.
- Do not accept hybrid, flexible, or "occasional travel" as remote.
- Do not infer remote status from vague language. If the posting does not
  clearly state remote or work-from-home, reject it.
- Cincinnati/Fairfield hybrid was previously acceptable — it is no longer
  acceptable in this pipeline. Reject all hybrid roles regardless of
  location.
- Log every location rejection with reason "Not remote — rejected" in the
  end-of-run summary.

### Salary Hard Floor

- Minimum: $100,000 USD annually.
- When salary is published and below $100,000, reject immediately.
- When salary is unpublished, do not reject — proceed with discovery.
- When salary is published and at or above $100,000, proceed.
- Preferred minimum for scoring purposes: $130,000+.

### Application Package Requirements

Every approved application must produce the following files in its
package folder `output/applications/YYYY-MM-DD_Company_Job-Title_Req-ID/`:

```
George-Dawson_Resume.md          ← tailored resume source
George-Dawson_Resume.html        ← rendered HTML
George-Dawson_Resume.pdf         ← FINAL — primary submission file
George-Dawson_Resume.docx        ← Word copy (only if docx plugin enabled)
George-Dawson_Cover-Letter.md    ← cover letter source
George-Dawson_Cover-Letter.pdf   ← FINAL cover letter
Job-Description.md               ← full archived JD (exact copy)
Job-Description.pdf              ← rendered JD PDF
Evaluation.md                    ← link to canonical evaluation report
application-answers.md           ← ATS/application question answers
manifest.md                      ← all file paths, dates, checksums
timeline.md                      ← date discovered, evaluated, applied
versions.md                      ← package version history
```

Every package must record:
- Company and job title
- Requisition ID (when available)
- Canonical job posting URL
- Date discovered
- Date evaluated
- Date package generated
- Fit score (1-5 scale)
- Resume PDF filename
- Cover letter PDF filename
- JD archive path
- Application status
- `No application submitted: Yes` until user explicitly confirms submission

### Never Auto-Submit

The agent must NEVER:
- Submit an application on behalf of the user
- Click Apply or any form submission button
- Send emails or LinkedIn messages
- Mark a role as Applied without explicit user confirmation
- Change any tracker status without explicit user confirmation

Human approval is required at every stage before evaluation, before
package generation, and before any status change.

---

## Custom Workflows

### Daily Senior IT Audit Scan

**Invocation:** `/daily-audit-scan` in OpenCode.
Discovery only. Never evaluates, generates materials, or changes status.

**Scope:**
- United States only
- Remote ONLY — no hybrid, no onsite
- Senior individual-contributor IT audit roles only
- No managerial, director, VP, or executive roles
- No GRC, compliance-only, risk-only, or security-operations roles
- Published salary must be at or above $100,000 when stated
- Unpublished salary: do not reject, proceed with discovery

**Target titles (primary):**
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
- Senior Cybersecurity Auditor (audit-focused only)
- Senior SOC 1 Auditor
- Senior SOC 2 Auditor
- Senior SOC Auditor (assurance/attestation only — not Security Operations)

**Conditional titles** (require full JD confirmation of senior IC IT audit scope):
- IT Auditor
- Information Systems Auditor
- Technology Auditor
- IT Audit Consultant
- Senior Internal Auditor

**Hard exclusions:**
- Manager, Senior Manager, Director, VP, Chief Audit Executive, Head of
  Audit, Head of IT Audit, Junior, Intern, Entry-Level, Graduate
- Risk-first, Technology Risk, Operational Risk, Enterprise Risk,
  GRC-first, Governance-first, Compliance-only, Risk-and-Compliance
- Security Operations Center, SOC Analyst, SOC Engineer, Incident
  Response, Threat Hunter, Blue Team, SIEM Engineer, MDR, XDR
- Active security clearance required
- Sponsorship required when employer cannot accept US permanent resident
- Hybrid or onsite roles (remote-only pipeline)
- Bank of America, 4 Square IT Consulting, Keurig Dr Pepper

**Procedure:**
1. Read `portals.yml`, `data/pipeline.md`, `data/scan-history.tsv`,
   and `data/applications.md`. Build deduplication set in memory.
2. Run `node scan.mjs --dry-run`. Capture results in memory only.
3. Run Tavily searches in memory only using the direct hook:
   ```powershell
   node --env-file=.env -e "(async () => { const plugin = await import('./plugins.local/tavily/index.mjs'); const jobs = await plugin.default.search(process.argv[1], { env: process.env, settings: { maxResults: 10 } }); console.log(JSON.stringify(jobs)); })().catch(error => { console.error(error.message); process.exit(1); });" "<query>"
   ```
4. Search all tracked companies and run broader searches for all primary
   title variants with "remote United States" and "United States remote"
   variants separately.
5. Filter and deduplicate in memory. Reject aggregators (Indeed, LinkedIn,
   Dice, Glassdoor, ZipRecruiter, Ladders, Built In). Apply all title,
   seniority, GRC, location (remote-only), salary, clearance, and
   sponsorship rules.
6. Verify each candidate with Playwright against the canonical employer
   posting. Confirm title, full JD, and Apply control are visible and
   active. Reject expired, unverifiable, or inconclusive postings.
7. Score verified candidates in memory:

   | Signal | Points |
   |---|---:|
   | Fully remote, United States | +20 |
   | Published salary $130,000+ | +20 |
   | Published salary $115,000–$129,999 | +15 |
   | Published salary $100,000–$114,999 | +10 |
   | Salary unpublished | +5 |
   | Exact primary target title | +20 |
   | Conditional title confirmed as senior IC IT audit | +12 |
   | Individual-contributor role | +10 |
   | Direct employer branded posting | +8 |
   | Canonical ATS posting (no branded posting available) | +5 |
   | Strong ITGC, SOX, or technology-audit alignment | +10 |
   | Strong SOC 1, SOC 2, or attestation alignment | +10 |
   | Cloud, cybersecurity, or systems-audit emphasis | +5 |
   | CISA preferred or required | +5 |
   | US permanent resident eligible | +5 |
   | Title ambiguous after full JD review | -15 |
   | Heavy financial-audit focus, limited technology scope | -15 |
   | Consulting role requiring constant client travel | -10 |
   | Hybrid or onsite (should have been rejected — fail-safe) | -50 |
   | GRC/compliance-only (should have been rejected — fail-safe) | -50 |

   Queue scores ≥70. Report scores 55–69 as borderline — not queued.
   Reject scores <55.

8. Final append: re-read `data/pipeline.md` and repeat deduplication.
   Append only verified, scored (≥70) roles in this format:
   `- [ ] URL | Company | Job title | Location | Salary if published`
   Write nothing if `verified_adds` is empty.
9. No cleanup phase. No other files modified during discovery.

**End-of-run summary must include:**
- Tracked companies searched
- Tavily searches executed
- Raw results found
- Rejections by category: aggregator, duplicate, title/seniority,
  GRC/compliance (wrong pipeline), location (not remote), salary,
  clearance, sponsorship, expired
- Roles added to pipeline with score and one-line reason
- Borderline roles not queued
- Failed or unverifiable searches

---

### Senior IT Audit Application

**Invocation:** `/audit-apply` in OpenCode.
Prepares application package for one user-selected Pending role.
Never submits, sends, or changes status without explicit confirmation.

**Procedure:**
1. Ask user to identify the Pending role. List matching entries if
   ambiguous. Do not proceed until one role is selected.
2. Read `data/pipeline.md`, `data/scan-history.tsv`,
   `data/applications.md`. Check for prior application.
3. Verify posting is still active with Playwright. Stop if expired.
4. Archive the complete JD with `node data/job-descriptions/archive-jd.mjs`
   before any evaluation.
5. Score fit 1–5 against `cv.md`, `config/profile.yml`, `modes/_profile.md`
   only. Flag conflicts between sources.
6. Create evaluation report with canonical URL, requisition ID, fit score,
   matched requirements, gaps, risks, tailoring plan.
7. Add to tracker via TSV/merge workflow. Status: `Evaluated`.
8. If fit <4.0/5, stop and require explicit APPROVE before generating
   materials.
9. If fit ≥4.0/5, generate draft package:
   - Tailored resume PDF (ATS-optimised from `cv.md`)
   - DOCX only if docx plugin enabled
   - Cover letter (when required or clearly beneficial)
   - ATS answers for common application questions
   - Read-only prefill summary
10. Final checkpoint — show all files created and exact next manual action.
    State: `No application has been submitted or marked Applied.`

---

### Senior IT Audit Job Cycle

**Invocation:** `/audit-job-cycle` in OpenCode.
Full end-to-end workflow: discovery → evaluation → package generation.

**Phase 1 — Discovery:**
Execute Daily Senior IT Audit Scan (steps 1–9 above). Remote only.
No hybrid. No GRC. $100k minimum on published salaries.

After discovery, report:
- Newly added roles (company, title, location, salary, score, URL)
- Previously pending roles (separate section)

If no qualified roles added, state clearly and stop.

Otherwise ask exactly:
`Which role or roles should I prepare? Reply with the company, pipeline number, or URL. You may also reply STOP.`

Do not proceed until user selects a role. On STOP, end workflow.

**Phase 2 — Verification & Evaluation:**
For each selected role:
- Reverify posting with Playwright (title + full JD + Apply control)
- Archive JD with `node data/job-descriptions/archive-jd.mjs`
- Deduplicate by requisition ID, canonical URL, company + title
- Score fit 1–5 against approved sources
- Create/update evaluation report and tracker (status: `Evaluated`)
- Report matched requirements, gaps, risks, knockout questions,
  tailoring plan

**Phase 3 — Package Approval Checkpoint:**
After each evaluation ask exactly:
`Fit evaluation complete. Generate application package? Reply APPROVE, SKIP, or STOP.`

If fit <4.0/5, explain threshold and require explicit APPROVE.
SKIP = leave at Evaluated. STOP = end all remaining work.

**Phase 4 — Package Generation (APPROVE only):**
- Run pre-generation inventory and checkpoint
- Validate resume source before rendering
- Generate tailored resume PDF
- Generate DOCX if docx plugin enabled
- Generate cover letter (when required or beneficial)
- Draft ATS answers in `application-answers.md`
- Create package manifest with all file paths, dates, checksums
- Run package lifecycle helper
- Create package version v1

**Phase 5 — Final Review:**
For every prepared role show:
- Company and role
- Fit score
- JD archive path
- Evaluation report path
- Resume PDF path
- DOCX path or "unavailable"
- Cover letter path
- ATS answers
- Unanswered knockout questions
- Current tracker status
- Exact next manual action

State exactly:
`No application has been submitted or marked Applied.`

**Phase 6 — Confirmed Submission Only:**
Only after user explicitly confirms manual submission:
- `node set-status.mjs <report#> Applied --note "Submitted YYYY-MM-DD"`
- `node followup-seed.mjs <report#> --date YYYY-MM-DD --json`

Never infer submission. Never change status from Evaluated to Applied
without explicit confirmation.

---

## Output Preferences

- Lead every evaluation with fit score and one-line verdict
- Show per-role token breakdown after batch runs
- Save PDFs date-first: `YYYY-MM-DD_Company_Job-Title`
- Reports in American English
- Keep cover letters under one page
- ATS answers: concise, truthful, evidence-backed from `cv.md` only

---

## Senior IT Audit Package Integrity Addendum

**Scope:** Binding for `/audit-apply` and `/audit-job-cycle`.
Supersedes any less strict package-generation language above.

**Source boundaries:**
- Candidate facts: `cv.md` only
- Job facts: archived JD only
- Never invent, enhance, combine, rename, or infer credentials
- Preserve all employment titles, employers, dates, chronology
- Preserve all certifications and education exactly as stated in `cv.md`
- Do not create project or portfolio sections unless user explicitly asks
- Employer exclusions apply to job targets only — never suppress work history

**Required resume sections (always retain when present in `cv.md`):**
1. Candidate name and contact information
2. Professional Summary
3. Core Competencies / Technical Skills
4. Professional Experience
5. Certifications
6. Education

**Pre-generation checkpoint:**
Before creating any package file:
1. Read `cv.md` and archived JD
2. Run `node .opencode/helpers/audit-package.mjs --inspect`
3. Display full certification and education inventory
4. Ask: `Generate tailored resume and cover letter? Reply APPROVE, REVISE, SKIP, or STOP.`
5. Do not create files without role-specific APPROVE

**Package folder and filenames:**
`output/applications/YYYY-MM-DD_company_job-title_req-id/`

All files use Windows-safe lowercase slugs for folder name.
Candidate file tag derived from `cv.md` name only: `George-Dawson`

**Validation gates (all must PASS before release):**
- Source certifications present exactly once, unrenamed, in own section
- Source education present exactly once, unrenamed, in own section
- No unsupported additions
- Candidate identity and contact details source-accurate
- Employment titles and dates source-accurate
- Chronology preserved
- No employer or responsibility conflation
- No unsupported experience claims

**PDF-first policy:**
PDF is always the preferred final file. DOCX is secondary.
DOCX failure never blocks a valid PDF package.

**Cover letter:**
- Generate when JD requires it or clearly beneficial
- Keep claims traceable to `cv.md`
- Keep JD claims traceable to archived JD
- No resume bullet repetition
- No generic praise
- No unsupported claims
- Sentence-by-sentence source audit before release

**Final quality gate:**
Before presenting files verify:
- Candidate name/contact accurate
- Employment titles/dates accurate
- Certifications and education reconciled
- No unsupported claims
- Company/title/requisition matches archived JD
- Windows-safe filenames
- Manifest covers every generated file
- `Application submitted: No`

State exactly:
`The files are ready for review and download. No application has been submitted or marked Applied.`

---

## Off-Limits

- Never auto-submit, auto-send, or auto-click anything
- Never edit `cv.md`, `config/profile.yml`, `modes/_profile.md`,
  `portals.yml`, or `.env` without explicit user instruction
- Never process GRC, compliance-only, or risk-only roles in this pipeline
- Never accept hybrid or onsite roles in this pipeline
- Never mark a role Applied without explicit user confirmation
- Never create duplicate tracker rows
- Never overwrite a released package file — use `_v2`, `_v3` instead
