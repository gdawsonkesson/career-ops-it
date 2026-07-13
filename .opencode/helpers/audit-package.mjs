#!/usr/bin/env node
/**
 * User-owned guard for the Senior IT Audit package workflow.
 * It does not generate candidate content. The agent writes a reviewable
 * Markdown resume source, then this tool rejects identity, employment,
 * certification, or education drift before package release.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));

function parseArgs(argv) {
  const values = {};
  const switches = new Set(['--inspect', '--validate-resume', '--create-manifest']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') values.help = true;
    else if (switches.has(arg)) values[arg.slice(2)] = true;
    else if (arg.startsWith('--')) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      values[arg.slice(2)] = value;
    } else throw new Error(`Unexpected argument: ${arg}`);
  }
  return values;
}

function usage() {
  return `Usage:
  node .opencode/helpers/audit-package.mjs --inspect --cv cv.md --jd <archived-jd.md>
  node .opencode/helpers/audit-package.mjs --validate-resume --cv cv.md --jd <archived-jd.md> --resume <tailored-resume.md>
  node .opencode/helpers/audit-package.mjs --create-manifest --approved APPROVE --package <folder> ...

The validator accepts a readable Markdown resume source only. PDF and DOCX are
rendered from this validated source and must not be released independently.`;
}

function read(pathValue, label) {
  const path = resolve(ROOT, pathValue);
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`${label} is not a readable file: ${pathValue}`);
  return { path, text: readFileSync(path, 'utf8').replace(/\r\n/g, '\n') };
}

function normalize(value) {
  return String(value || '').replace(/\*\*/g, '').replace(/[`_]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function section(markdown, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^##\\s+${escaped}[ \\t]*\\r?$([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, 'mi').exec(markdown)?.[1]?.trim() || '';
}

function candidateHeading(markdown) {
  const match = markdown.match(/^#\s+(.+)$/m);
  if (!match) throw new Error('cv.md must have a top-level candidate heading.');
  return match[1].trim();
}

function contactBlock(markdown) {
  const heading = candidateHeading(markdown);
  const start = markdown.indexOf(`# ${heading}`) + heading.length + 2;
  const end = markdown.search(/^##\s+/m);
  return markdown.slice(start, end === -1 ? markdown.length : end).split('\n')
    .map(line => line.trim()).filter(line => /^(Tel:|Email:|\+?\d|[A-Z][^:]*,\s*[A-Z]{2}\b)/.test(line));
}

function listRecords(body) {
  return [...body.matchAll(/^-\s+.+(?:\n {2,}[^\n]+)*/gm)].map(match => match[0].trim());
}

function roleBlocks(markdown) {
  const body = section(markdown, 'Professional Experience');
  const headings = [...body.matchAll(/^(#{3,6})\s+(.+)\s*$/gm)];
  const roles = [];
  for (let index = 0; index < headings.length; index += 1) {
    const match = headings[index];
    const level = match[1].length;
    const title = match[2].trim();
    const blockStart = match.index + match[0].length;
    const blockEnd = index + 1 < headings.length ? headings[index + 1].index : body.length;
    const block = body.slice(blockStart, blockEnd).trim();
    const metadata = block.split(/^[-*]\s+/m)[0].trim();
    const employer = /\*\*(.+?)\*\*/.exec(metadata)?.[1]?.trim() || '';
    const lines = metadata.split('\n').map(line => line.trim()).filter(Boolean)
      .filter(line => !/^\*\*.+\*\*$/.test(line));
    const dates = lines.find(line => /\b(?:19|20)\d{2}\b/.test(line) || /\bPresent\b/i.test(line)) || '';
    const location = lines.find(line => line !== dates) || '';
    const parent = [...roles].reverse().find(role => role.level < level);
    const resolvedEmployer = employer || parent?.employer || '';
    const responsibilities = [...block.matchAll(/^[-*]\s+(.+)$/gm)].map(item => item[1].trim());
    const engagementStructure = lines.filter(line => /\b(contract|consult|freelance|client|engagement|direct employment|temporary|interim)\b/i.test(line));
    roles.push({ level, title, employer: resolvedEmployer, dates, location, engagementStructure, responsibilities });
  }
  return roles;
}

function technologyTerms(markdown) {
  const technologies = section(markdown, 'Technologies');
  return [...technologies.matchAll(/^[-*]\s+(.+)$/gm)].map(item => item[1].trim());
}

function roleInventory(markdown) {
  const terms = technologyTerms(markdown);
  return roleBlocks(markdown).map((role, index) => {
    const text = `${role.title} ${role.responsibilities.join(' ')}`;
    const domains = [
      ['IT audit', /\bIT audit|audit\b/i], ['ITGC/SOX', /\bITGC|SOX\b/i],
      ['Access/change/SDLC/operations', /access management|IAM|change management|SDLC|IT operations/i],
      ['SOC/third-party assurance', /SOC report|third-party|vendor risk/i],
      ['Cloud/cybersecurity/infrastructure', /cloud|cybersecurity|infrastructure|database|server/i],
      ['Data/audit tools/reporting', /data analytics|Audit Board|Workiva|audit report|executive-level/i],
      ['Leadership/stakeholders', /\bleads?\b|stakeholder|client|executive-level|management team|collaborat/i],
    ].filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
    return {
      number: index + 1, employer: role.employer, exactJobTitle: role.title, exactDates: role.dates,
      location: role.location || 'Not stated in cv.md', hierarchyLevel: role.level,
      engagementStructure: role.engagementStructure.length ? role.engagementStructure : ['Not stated in cv.md'],
      responsibilities: role.responsibilities,
      toolsAndPlatforms: terms.filter(term => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)),
      auditControlDomains: domains,
      metricsAndAchievements: role.responsibilities.filter(item => /\d+\s*(?:%|x|hours?|days?|weeks?|months?|years?|clients?|users?)\b|\b(increased?|reduced?|improv(?:e|ed|ement)|achieved?|delivered?)\b/i.test(item)),
      leadershipAndStakeholderResponsibilities: role.responsibilities.filter(item => /\bleads?\b|stakeholder|client|executive-level|management team|collaborat/i.test(item)),
    };
  });
}

function inventory(markdown) {
  const certifications = listRecords(section(markdown, 'Certifications'));
  const education = listRecords(section(markdown, 'Education'));
  return {
    candidateHeading: candidateHeading(markdown),
    fileCandidateName: candidateHeading(markdown).split(',')[0].trim(),
    contact: contactBlock(markdown),
    certifications: certifications.map((exactSourceWording, index) => ({
      number: index + 1, exactSourceWording,
      issuingOrganisation: 'Not stated in cv.md', status: 'Not stated in cv.md', date: 'Not stated in cv.md',
    })),
    education: education.map((exactSourceWording, index) => ({
      number: index + 1, exactSourceWording,
      qualification: 'Preserved exactly in source wording', fieldOfStudy: 'Preserved exactly in source wording',
      institution: 'Preserved exactly in source wording', location: 'Not stated in cv.md', dates: 'Not stated in cv.md',
    })),
    employment: roleInventory(markdown),
  };
}

function count(haystack, needle) { return needle ? haystack.split(needle).length - 1 : 0; }

function employmentReconciliation(cvMarkdown, resumeMarkdown, jdMarkdown) {
  const sourceRoles = roleBlocks(cvMarkdown);
  const targetRoles = roleBlocks(resumeMarkdown);
  const failures = [];
  const matches = [];
  const key = (role) => `${normalize(role.employer)}|${normalize(role.title)}|${normalize(role.dates)}`;
  const sourceKeys = new Set(sourceRoles.map(key));
  const targetKeys = new Set(targetRoles.map(key));
  const sourceEmployers = new Set(sourceRoles.map(role => normalize(role.employer)));
  const targetEmployers = new Set(targetRoles.map(role => normalize(role.employer)));
  const allSourceEmployersRepresented = [...sourceEmployers].every(employer => targetEmployers.has(employer));
  const allSourceRolesRepresented = sourceRoles.every(role => targetKeys.has(key(role)));
  const noUnsupportedExperienceAdded = targetRoles.every(role => sourceKeys.has(key(role)));
  const employerNamesExact = sourceRoles.every(role => targetRoles.some(target => target.employer === role.employer));
  const jobTitlesExact = sourceRoles.every(role => targetRoles.some(target => target.title === role.title));
  const employmentDatesExact = sourceRoles.every(role => targetRoles.some(target => target.dates === role.dates));
  const chronologyIndexes = sourceRoles.map(role => targetRoles.findIndex(target => key(target) === key(role)));
  const chronologyAccurate = chronologyIndexes.every(index => index !== -1) && chronologyIndexes.every((index, position) => position === 0 || index > chronologyIndexes[position - 1]);
  let nestedConcurrentRoleStructurePreserved = true;
  let contractConsultingRelationshipsAccurate = true;
  let noResponsibilityConflation = true;
  for (const role of sourceRoles) {
    const target = targetRoles.find(item => key(item) === key(role));
    if (!target) continue;
    matches.push({ source: role, target });
    if (target.level !== role.level) nestedConcurrentRoleStructurePreserved = false;
    if (JSON.stringify(target.engagementStructure) !== JSON.stringify(role.engagementStructure)) contractConsultingRelationshipsAccurate = false;
    for (const responsibility of target.responsibilities) {
      if (!role.responsibilities.includes(responsibility)) noResponsibilityConflation = false;
    }
  }
  const noEmployerConflation = targetRoles.every(role => sourceRoles.some(source => source.employer === role.employer && source.title === role.title && source.dates === role.dates));
  const jdTerms = ['audit', 'control', 'itgc', 'sox', 'soc', 'access', 'change management', 'sdlc', 'operations', 'cloud', 'cybersecurity', 'infrastructure', 'data analytics', 'auditboard', 'audit board', 'workiva', 'executive'];
  const jd = String(jdMarkdown || '').toLowerCase();
  const relevantExperienceAppropriatelyEmphasized = matches.every(({ source, target }) => {
    const sourceText = source.responsibilities.join(' ').toLowerCase();
    const relevantTerms = jdTerms.filter(term => jd.includes(term) && sourceText.includes(term));
    return relevantTerms.length === 0 || target.responsibilities.some(item => relevantTerms.some(term => item.toLowerCase().includes(term)));
  });

  const checks = {
    allSourceEmployersRepresented, allSourceRolesRepresented, employerNamesExact, jobTitlesExact,
    employmentDatesExact, chronologyAccurate, nestedConcurrentRoleStructurePreserved,
    contractConsultingRelationshipsAccurate, noEmployerConflation, noResponsibilityConflation,
    noUnsupportedExperienceAdded, relevantExperienceAppropriatelyEmphasized,
  };
  const labels = {
    allSourceEmployersRepresented: 'All source employers represented', allSourceRolesRepresented: 'All source roles represented',
    employerNamesExact: 'Employer names exact', jobTitlesExact: 'Job titles exact', employmentDatesExact: 'Employment dates exact',
    chronologyAccurate: 'Chronology accurate', nestedConcurrentRoleStructurePreserved: 'Nested/concurrent role structure preserved',
    contractConsultingRelationshipsAccurate: 'Contract/consulting relationships accurate', noEmployerConflation: 'No employer conflation',
    noResponsibilityConflation: 'No responsibility conflation', noUnsupportedExperienceAdded: 'No unsupported experience added',
    relevantExperienceAppropriatelyEmphasized: 'Relevant experience appropriately emphasized',
  };
  for (const [name, passed] of Object.entries(checks)) if (!passed) failures.push(`${labels[name]}: FAIL`);
  return { passed: failures.length === 0, failures, checks: Object.fromEntries(Object.entries(checks).map(([name, passed]) => [name, passed ? 'PASS' : 'FAIL'])) };
}

function validateResume(cv, resume, jd) {
  const source = inventory(cv.text);
  const failures = [];
  const required = [
    ['Professional Summary', ['Professional Summary']],
    ['Core Competencies or Technical Skills', ['Core Competencies', 'Core Skills', 'Technical Skills', 'Skills']],
    ['Professional Experience', ['Professional Experience', 'Work Experience', 'Experience']],
    ['Certifications', ['Certifications']],
    ['Education', ['Education']],
  ];
  if (!resume.text.includes(`# ${source.candidateHeading}`)) failures.push('Candidate heading does not exactly match cv.md.');
  for (const contact of source.contact) if (!resume.text.includes(contact)) failures.push(`Contact information missing or changed: ${contact}`);
  for (const [label, aliases] of required) {
    if (!aliases.some(alias => new RegExp(`^##\\s+${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'mi').test(resume.text))) failures.push(`Required section missing: ${label}`);
  }
  const targetCertifications = section(resume.text, 'Certifications');
  const targetEducation = section(resume.text, 'Education');
  for (const record of source.certifications) {
    if (count(targetCertifications, record.exactSourceWording) !== 1) failures.push(`Certification must appear exactly once under Certifications: ${record.exactSourceWording}`);
    if (targetEducation.includes(record.exactSourceWording)) failures.push(`Certification appears under Education: ${record.exactSourceWording}`);
  }
  for (const record of listRecords(targetCertifications)) {
    if (!source.certifications.some(item => normalize(item.exactSourceWording) === normalize(record))) failures.push(`Unsupported or renamed certification: ${record}`);
  }
  for (const record of source.education) {
    if (count(targetEducation, record.exactSourceWording) !== 1) failures.push(`Education entry must appear exactly once under Education: ${record.exactSourceWording}`);
    if (targetCertifications.includes(record.exactSourceWording)) failures.push(`Education appears under Certifications: ${record.exactSourceWording}`);
  }
  for (const record of listRecords(targetEducation)) {
    if (!source.education.some(item => normalize(item.exactSourceWording) === normalize(record))) failures.push(`Unsupported or renamed education entry: ${record}`);
  }
  const employment = employmentReconciliation(cv.text, resume.text, jd.text);
  failures.push(...employment.failures);
  return {
    passed: failures.length === 0, failures,
    certificationReconciliation: failures.some(item => /Certification/.test(item)) ? 'FAIL' : 'PASS',
    educationReconciliation: failures.some(item => /Education/.test(item)) ? 'FAIL' : 'PASS',
    employmentReconciliation: employment.passed ? 'PASS' : 'FAIL',
    employmentChecks: employment.checks,
  };
}

function assertInPackage(packagePath, filePath, label) {
  const absolute = resolve(ROOT, filePath);
  const rel = relative(packagePath, absolute);
  if (rel === '' || rel.startsWith('..') || rel.split(sep).includes('..')) throw new Error(`${label} must be a file inside the package folder.`);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) throw new Error(`${label} does not exist: ${filePath}`);
  return rel.split(sep).join('/');
}

function createManifest(args) {
  if (args.approved !== 'APPROVE') throw new Error('Manifest creation requires --approved APPROVE.');
  const required = ['package', 'company', 'job-title', 'req-id', 'url', 'jd', 'report', 'fit', 'resume-pdf', 'resume-source', 'cover-pdf', 'cover-source', 'evaluation-reference', 'answers', 'certification-check', 'education-check', 'cover-audit', 'employment-check', 'employers-check', 'roles-check', 'employer-title-date-check', 'chronology-check', 'engagement-check', 'conflation-check', 'relevance-check', 'tracker-status'];
  for (const name of required) if (!args[name]) throw new Error(`Missing --${name} for manifest creation.`);
  for (const name of ['certification-check', 'education-check', 'cover-audit', 'employment-check', 'employers-check', 'roles-check', 'employer-title-date-check', 'chronology-check', 'engagement-check', 'conflation-check', 'relevance-check']) if (args[name] !== 'PASS') throw new Error(`--${name} must be PASS before package release.`);
  if (args['tracker-status'] !== 'Evaluated') throw new Error('Package generation must leave tracker status as Evaluated.');
  const packagePath = resolve(ROOT, args.package);
  const outputRoot = resolve(ROOT, 'output', 'applications');
  if (relative(outputRoot, packagePath).startsWith('..')) throw new Error('--package must be inside output/applications/.');
  mkdirSync(packagePath, { recursive: true });
  const files = [
    ['Tailored resume PDF', args['resume-pdf']], ['Tailored resume source', args['resume-source']],
    ['Cover letter PDF', args['cover-pdf']], ['Cover letter source', args['cover-source']],
    ['Evaluation report reference', args['evaluation-reference']], ['Application answers', args.answers],
  ].map(([label, file]) => [label, assertInPackage(packagePath, file, label)]);
  if (args['resume-html']) files.splice(2, 0, ['Tailored resume HTML', assertInPackage(packagePath, args['resume-html'], 'Tailored resume HTML')]);
  if (args['cover-html']) files.splice(files.length - 2, 0, ['Cover letter HTML', assertInPackage(packagePath, args['cover-html'], 'Cover letter HTML')]);
  if (args['resume-docx']) files.splice(1, 0, ['Tailored resume DOCX', assertInPackage(packagePath, args['resume-docx'], 'Tailored resume DOCX')]);
  if (args['cover-docx']) files.splice(files.length - 1, 0, ['Cover letter DOCX', assertInPackage(packagePath, args['cover-docx'], 'Cover letter DOCX')]);
  const cv = read('cv.md', 'cv.md');
  const checksum = createHash('sha256').update(cv.text).digest('hex');
  const lines = [
    '# Application Package Manifest', '', `- **Company:** ${args.company}`, `- **Job title:** ${args['job-title']}`,
    `- **Requisition ID:** ${args['req-id']}`, `- **Canonical URL:** ${args.url}`, `- **JD archive path:** ${args.jd}`,
    `- **Evaluation report path:** ${args.report}`, `- **Fit score:** ${args.fit}`, `- **Package generation date and time:** ${new Date().toISOString()}`,
    `- **Source cv.md SHA-256:** ${checksum}`, '- **Certification reconciliation:** PASS', '- **Education reconciliation:** PASS',
    '- **Cover-letter source audit:** PASS', '- **Employment reconciliation:** PASS', '- **All source employers represented:** PASS',
    '- **All source roles represented:** PASS', '- **Employer/title/date integrity:** PASS', '- **Chronology integrity:** PASS',
    '- **Engagement-structure integrity:** PASS', '- **No employer or responsibility conflation:** PASS',
    '- **Relevant-experience appreciation:** PASS', '- **Current tracker status:** Evaluated', '- **Package approved:** Yes', '- **Application submitted:** No', '',
    '## Generated Files', '', '- **Package manifest:** manifest.md', ...files.map(([label, file]) => `- **${label}:** ${file}`), '', '## References', '',
    `- Archived JD: ${args.jd}`, `- Evaluation report: ${args.report}`,
  ];
  const manifest = resolve(packagePath, 'manifest.md');
  writeFileSync(manifest, `${lines.join('\n')}\n`, 'utf8');
  console.log(JSON.stringify({ manifest: relative(ROOT, manifest).split(sep).join('/'), files: files.map(([, file]) => file), submitted: 'No' }, null, 2));
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || Object.keys(args).length === 0) console.log(usage());
  else if (args.inspect) {
    const cv = read(args.cv || 'cv.md', 'cv.md');
    const jd = read(args.jd, 'Archived JD');
    console.log(JSON.stringify({ source: inventory(cv.text), archivedJd: relative(ROOT, jd.path).split(sep).join('/') }, null, 2));
  } else if (args['validate-resume']) {
    if (!args.jd) throw new Error('--validate-resume requires --jd <archived-jd.md> for relevance reconciliation.');
    const result = validateResume(read(args.cv || 'cv.md', 'cv.md'), read(args.resume, 'Tailored resume source'), read(args.jd, 'Archived JD'));
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
  } else if (args['create-manifest']) createManifest(args);
  else throw new Error('Choose exactly one action: --inspect, --validate-resume, or --create-manifest.');
} catch (error) {
  console.error(`audit-package: ${error.message}`);
  process.exitCode = 1;
}
