#!/usr/bin/env node
/**
 * User-owned guard for the Senior IT Audit package workflow.
 * It does not generate candidate content. The agent writes a reviewable
 * Markdown resume source, then this tool rejects identity, employment,
 * certification, or education drift before package release.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import { chromium } from 'playwright';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));

function parseArgs(argv) {
  const values = {};
  const switches = new Set(['--inspect', '--validate-resume', '--validate-docx', '--create-jd-pdf', '--create-manifest', '--complete-lifecycle', '--append-timeline', '--version-package']);
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
  node .opencode/helpers/audit-package.mjs --validate-docx --resume <tailored-resume.md> --docx <resume.docx>
  node .opencode/helpers/audit-package.mjs --create-jd-pdf --jd <archived-jd.md> --package <folder> --date YYYY-MM-DD
  node .opencode/helpers/audit-package.mjs --create-manifest --approved APPROVE --package <folder> ...
  node .opencode/helpers/audit-package.mjs --complete-lifecycle --package <folder> --jd <archived-jd.md> --report <report.md> ...
  node .opencode/helpers/audit-package.mjs --append-timeline --package <folder> --event <event> --actor <actor> --source <source>
  node .opencode/helpers/audit-package.mjs --version-package --package <folder> --jd <archived-jd.md> --resume-source <file> --cover-source <file> ...

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

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function filenameSegment(value, fallback) {
  const cleaned = String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 100);
  return cleaned || fallback;
}

function archiveDetails(markdown) {
  const title = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim();
  if (!title) throw new Error('Archived JD is missing its top-level company and job-title heading.');
  const separator = title.indexOf(' - ');
  const company = separator === -1 ? '' : title.slice(0, separator).trim();
  const jobTitle = separator === -1 ? '' : title.slice(separator + 3).trim();
  if (!company || !jobTitle) throw new Error('Archived JD heading must use "Company - Job title".');
  const field = (label) => new RegExp(`^- ${label}: (.*)$`, 'm').exec(markdown)?.[1]?.trim() || 'Not stated in posting';
  const marker = '## Complete Job Description\n';
  const index = markdown.indexOf(marker);
  if (index === -1) throw new Error('Archived JD is missing "## Complete Job Description".');
  return {
    company,
    jobTitle,
    canonicalUrl: field('Canonical URL'),
    requisitionId: field('Requisition ID').replace(/\s*\([^)]*\)\s*$/, '').trim(),
    firstDiscoveredDate: field('First discovered date'),
    originalCaptureDate: field('Captured date and time'),
    lastVerifiedDate: field('Last verified date'),
    postingStatus: field('Posting status'),
    location: field('Location'),
    workArrangement: field('Work arrangement'),
    compensation: field('Salary or compensation range'),
    employmentType: field('Employment type'),
    travelRequirement: field('Travel requirement'),
    workAuthorization: field('Work-authorization or sponsorship language'),
    securityClearance: field('Security-clearance requirement'),
    completeDescription: markdown.slice(index + marker.length).trim(),
  };
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function inlineMarkdown(value) {
  let text = escapeHtml(value);
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  return text;
}

function markdownToHtml(markdown) {
  const output = [];
  let paragraph = [];
  let list = '';
  const flushParagraph = () => {
    if (paragraph.length) output.push(`<p>${paragraph.map(inlineMarkdown).join('<br>')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) output.push(`</${list}>`);
    list = '';
  };
  for (const line of markdown.split('\n')) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const ordered = /^\d+\.\s+(.+)$/.exec(line);
    const unordered = /^[-*]\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph(); flushList();
      const level = Math.min(6, heading[1].length + 1);
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (ordered || unordered) {
      flushParagraph();
      const nextList = ordered ? 'ol' : 'ul';
      if (list && list !== nextList) flushList();
      if (!list) { output.push(`<${nextList}>`); list = nextList; }
      output.push(`<li>${inlineMarkdown((ordered || unordered)[1])}</li>`);
    } else if (!line.trim()) {
      flushParagraph(); flushList();
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph(); flushList();
  return output.join('\n');
}

function jdHtml(details) {
  const metadata = [
    ['Canonical URL', details.canonicalUrl], ['Requisition ID', details.requisitionId],
    ['First-discovered date', details.firstDiscoveredDate], ['Original capture date', details.originalCaptureDate],
    ['Last-verified date', details.lastVerifiedDate], ['Posting status at capture', details.postingStatus],
    ['Location', details.location], ['Remote, hybrid, or onsite arrangement', details.workArrangement],
    ['Compensation', details.compensation], ['Employment type', details.employmentType],
    ['Travel requirement', details.travelRequirement], ['Work-authorization or sponsorship language', details.workAuthorization],
    ['Security-clearance requirement', details.securityClearance],
  ].map(([label, value]) => {
    const rendered = label === 'Canonical URL' && /^https?:\/\//.test(value)
      ? `<a href="${escapeHtml(value)}">${escapeHtml(value)}</a>` : escapeHtml(value);
    return `<dt>${escapeHtml(label)}</dt><dd>${rendered}</dd>`;
  }).join('');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(details.company)} - ${escapeHtml(details.jobTitle)}</title>
<style>
  @page { size: Letter; margin: 0.65in 0.7in 0.75in; }
  body { color: #111; font: 10.5pt/1.45 Arial, Helvetica, sans-serif; margin: 0; }
  h1 { font-size: 18pt; margin: 0 0 0.24in; } h2 { border-bottom: 1px solid #777; font-size: 14pt; margin: 0.28in 0 0.12in; padding-bottom: 0.04in; }
  h3 { font-size: 11.5pt; margin: 0.2in 0 0.06in; } h4, h5, h6 { font-size: 10.5pt; margin: 0.15in 0 0.04in; }
  dl { display: grid; grid-template-columns: 2.35in 1fr; gap: 0.05in 0.12in; margin: 0; } dt { font-weight: 700; } dd { margin: 0; overflow-wrap: anywhere; }
  p { margin: 0 0 0.1in; } ul, ol { margin: 0.04in 0 0.12in; padding-left: 0.24in; } li { margin-bottom: 0.04in; }
  a { color: #0645ad; text-decoration: underline; } code { font-family: "Courier New", monospace; }
</style></head><body>
<h1>${escapeHtml(details.company)} &mdash; ${escapeHtml(details.jobTitle)}</h1>
<h2>Metadata</h2><dl>${metadata}</dl>
<h2>Complete Job Description</h2>
${markdownToHtml(details.completeDescription)}
</body></html>`;
}

function resolvePackageFolder(pathValue) {
  const resolved = resolve(ROOT, pathValue);
  const outputRoot = resolve(ROOT, 'output', 'applications');
  const rel = relative(outputRoot, resolved);
  if (rel === '' || rel.startsWith('..') || rel.split(sep).includes('..')) throw new Error('--package must be inside output/applications/.');
  return resolved;
}

async function renderJdPdf(html, outputPath) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({
      path: outputPath,
      format: 'Letter',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: '<div style="width:100%;text-align:center;font:8px Arial;color:#555;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
      margin: { top: '0.65in', right: '0.7in', bottom: '0.75in', left: '0.7in' },
    });
  } finally {
    await browser.close();
  }
}

function pdfObjects(pdfBuffer) {
  const source = pdfBuffer.toString('latin1');
  return [...source.matchAll(/(\d+)\s+0\s+obj\b([\s\S]*?)endobj/g)].map(match => ({ id: match[1], body: match[2] }));
}

function pdfStream(body) {
  const match = /stream\r?\n([\s\S]*?)\r?\nendstream/.exec(body);
  if (!match) return '';
  const buffer = Buffer.from(match[1], 'latin1');
  try { return /\/FlateDecode/.test(body) ? inflateSync(buffer).toString('latin1') : buffer.toString('latin1'); }
  catch { return ''; }
}

function utf16be(hex) {
  const bytes = Buffer.from(hex, 'hex');
  let text = '';
  for (let index = 0; index + 1 < bytes.length; index += 2) text += String.fromCharCode(bytes.readUInt16BE(index));
  return text;
}

function cmap(body) {
  const map = new Map();
  const stream = pdfStream(body);
  for (const block of stream.matchAll(/beginbfchar\s*([\s\S]*?)\s*endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9A-F]+)>\s*<([0-9A-F]+)>/gi)) map.set(pair[1], utf16be(pair[2]));
  }
  for (const block of stream.matchAll(/beginbfrange\s*([\s\S]*?)\s*endbfrange/g)) {
    for (const range of block[1].matchAll(/<([0-9A-F]+)>\s*<([0-9A-F]+)>\s*<([0-9A-F]+)>/gi)) {
      const start = parseInt(range[1], 16); const end = parseInt(range[2], 16); const target = parseInt(range[3], 16);
      const width = range[1].length;
      for (let code = start; code <= end; code += 1) map.set(code.toString(16).toUpperCase().padStart(width, '0'), String.fromCharCode(target + code - start));
    }
  }
  return map;
}

function decodePdfHex(hex, map) {
  const keys = [...map.keys()].sort((left, right) => right.length - left.length);
  let decoded = '';
  for (let index = 0; index < hex.length;) {
    const key = keys.find(candidate => hex.startsWith(candidate, index));
    if (!key) { index += 2; continue; }
    decoded += map.get(key); index += key.length;
  }
  return decoded;
}

function extractPdfText(pdfBuffer) {
  const objects = pdfObjects(pdfBuffer);
  const objectById = new Map(objects.map(object => [object.id, object]));
  const mapsByFontObject = new Map();
  const fontMaps = new Map();
  for (const object of objects) {
    const toUnicode = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(object.body)?.[1];
    if (!toUnicode) continue;
    mapsByFontObject.set(object.id, cmap(objectById.get(toUnicode)?.body || ''));
  }
  for (const object of objects) {
    for (const reference of object.body.matchAll(/\/(F\d+)\s+(\d+)\s+0\s+R/g)) {
      const map = mapsByFontObject.get(reference[2]);
      if (map) fontMaps.set(reference[1], map);
    }
  }
  let text = '';
  for (const object of objects) {
    const stream = pdfStream(object.body);
    if (!/\bBT\b/.test(stream)) continue;
    let activeMap = new Map();
    const tokens = /\/(F\d+)\s+[\d.]+\s+Tf|<([0-9A-F]+)>\s*Tj|\[([^\]]*)\]\s*TJ/g;
    for (const token of stream.matchAll(tokens)) {
      if (token[1]) activeMap = fontMaps.get(token[1]) || activeMap;
      else if (token[2]) text += decodePdfHex(token[2], activeMap);
      else for (const item of token[3].matchAll(/<([0-9A-F]+)>/gi)) text += decodePdfHex(item[1], activeMap);
    }
  }
  return text;
}

function sourceText(value) {
  return normalize(String(value).replace(/^#{1,6}\s+|^[-*]\s+|^\d+\.\s+/gm, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'));
}

async function createJdPdf(args) {
  if (!args.jd || !args.package || !args.date) throw new Error('--create-jd-pdf requires --jd, --package, and --date YYYY-MM-DD.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new Error('--date must use YYYY-MM-DD.');
  const archived = read(args.jd, 'Canonical JD archive');
  const canonicalBuffer = readFileSync(archived.path);
  const details = archiveDetails(archived.text);
  const packageFolder = resolvePackageFolder(args.package);
  mkdirSync(packageFolder, { recursive: true });
  const fileBase = `${args.date}_${filenameSegment(details.company, 'Company')}_${filenameSegment(details.jobTitle, 'Job-Title')}_${filenameSegment(details.requisitionId, 'Req-ID')}_Job-Description`;
  const existing = readdirSync(packageFolder).filter(name => name === `${fileBase}.md` || new RegExp(`^${fileBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_v\\d+\\.md$`).test(name));
  const existingPdfs = readdirSync(packageFolder).filter(name => name === `${fileBase}.pdf` || new RegExp(`^${fileBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_v\\d+\\.pdf$`).test(name));
  const matching = existing.find(name => sha256(readFileSync(resolve(packageFolder, name))) === sha256(canonicalBuffer));
  const usedVersions = [...existing, ...existingPdfs].map(name => Number(/_v(\d+)\.(?:md|pdf)$/.exec(name)?.[1] || 1));
  const suffix = matching ? basename(matching, '.md').slice(fileBase.length) : usedVersions.length ? `_v${Math.max(...usedVersions) + 1}` : '';
  const markdownName = `${fileBase}${suffix}.md`;
  const pdfName = `${fileBase}${suffix}.pdf`;
  const markdownPath = resolve(packageFolder, markdownName);
  const pdfPath = resolve(packageFolder, pdfName);
  if (!existsSync(markdownPath)) copyFileSync(archived.path, markdownPath);
  const packageHash = sha256(readFileSync(markdownPath));
  if (packageHash !== sha256(canonicalBuffer)) throw new Error('Canonical JD archive and package Markdown copy checksum mismatch; package release is blocked.');
  let pdfGenerated = false;
  if (!existsSync(pdfPath)) {
    await renderJdPdf(jdHtml(details), pdfPath);
    pdfGenerated = true;
  }
  const pdfBuffer = readFileSync(pdfPath);
  if (pdfBuffer.length < 1024 || pdfBuffer.subarray(0, 4).toString('ascii') !== '%PDF') throw new Error('JD PDF did not open as a valid PDF; package release is blocked.');
  const extractedText = sourceText(extractPdfText(pdfBuffer));
  const requiredText = [...new Set(sourceText([details.company, details.jobTitle, 'Complete Job Description', details.completeDescription].join(' ')).match(/\b(?:[a-z0-9][a-z0-9-]{3,}|soc|iso|pci)\b/g) || [])];
  const missingPdfText = requiredText.find(line => !extractedText.includes(line));
  if (missingPdfText) throw new Error(`JD PDF text is not searchable or does not contain the complete archived description (${missingPdfText}); package release is blocked.`);
  const version = suffix ? suffix.slice(1) : 'v1';
  console.log(JSON.stringify({
    canonicalArchive: relative(ROOT, archived.path).split(sep).join('/'),
    packageMarkdown: relative(ROOT, markdownPath).split(sep).join('/'),
    packagePdf: relative(ROOT, pdfPath).split(sep).join('/'),
    canonicalSha256: sha256(canonicalBuffer), packageSha256: packageHash,
    checksumMatch: 'PASS', pdfGeneration: 'PASS', pdfTextSelectableSearchable: 'PASS',
    completeDescriptionPresent: 'PASS', pdfGenerated, version,
    postingStatusAtCapture: details.postingStatus, lastVerifiedDate: details.lastVerifiedDate,
  }, null, 2));
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

function docxText(docxPath) {
  const buffer = readFileSync(docxPath);
  let eocd = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65557); index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
  }
  if (eocd === -1) throw new Error('DOCX is not a ZIP/OOXML file.');
  const entries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let index = 0; index < entries; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('DOCX has an invalid ZIP central directory.');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (name === 'word/document.xml') {
      if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('DOCX has an invalid document.xml entry.');
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const data = buffer.subarray(dataStart, dataStart + compressedSize);
      const xml = method === 8 ? inflateRawSync(data).toString('utf8') : method === 0 ? data.toString('utf8') : null;
      if (!xml) throw new Error(`DOCX uses unsupported compression method ${method}.`);
      return xml.replace(/<w:tab\/>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error('DOCX is missing word/document.xml.');
}

function validateDocx(resume, docx) {
  const text = docxText(docx.path);
  const comparable = (value) => normalize(value).replace(/^-\s+/, '');
  const expected = [
    candidateHeading(resume.text), ...contactBlock(resume.text), 'Professional Summary', 'Professional Experience', 'Certifications', 'Education',
    ...roleBlocks(resume.text).flatMap(role => [role.employer, role.title, role.dates, ...role.responsibilities]),
    ...listRecords(section(resume.text, 'Certifications')), ...listRecords(section(resume.text, 'Education')),
  ].filter(Boolean).map(comparable);
  const missing = expected.filter(value => !normalize(text).includes(value));
  return {
    passed: missing.length === 0,
    genuineWordDocument: 'PASS',
    substantiveContentMatchesApprovedResume: missing.length === 0 ? 'PASS' : 'FAIL',
    missing,
  };
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
  const required = ['package', 'company', 'job-title', 'req-id', 'url', 'jd', 'jd-package-md', 'jd-pdf', 'jd-version', 'jd-pdf-generation', 'jd-pdf-text-check', 'report', 'fit', 'resume-pdf', 'resume-source', 'cover-pdf', 'cover-source', 'evaluation-reference', 'answers', 'certification-check', 'education-check', 'cover-audit', 'employment-check', 'employers-check', 'roles-check', 'employer-title-date-check', 'chronology-check', 'engagement-check', 'conflation-check', 'relevance-check', 'pdf-export-check', 'docx-export-result', 'tracker-status'];
  for (const name of required) if (!args[name]) throw new Error(`Missing --${name} for manifest creation.`);
  for (const name of ['certification-check', 'education-check', 'cover-audit', 'employment-check', 'employers-check', 'roles-check', 'employer-title-date-check', 'chronology-check', 'engagement-check', 'conflation-check', 'relevance-check']) if (args[name] !== 'PASS') throw new Error(`--${name} must be PASS before package release.`);
  if (args['pdf-export-check'] !== 'PASS') throw new Error('--pdf-export-check must be PASS before package release.');
  if (args['jd-pdf-generation'] !== 'PASS' || args['jd-pdf-text-check'] !== 'PASS') throw new Error('JD PDF generation and text checks must be PASS before package release.');
  if (!['PASS', 'FAILED', 'UNSUPPORTED'].includes(args['docx-export-result'])) throw new Error('--docx-export-result must be PASS, FAILED, or UNSUPPORTED.');
  if (args['docx-export-result'] === 'PASS' && !args['resume-docx']) throw new Error('A PASS DOCX export result requires --resume-docx.');
  if (args['tracker-status'] !== 'Evaluated') throw new Error('Package generation must leave tracker status as Evaluated.');
  const packagePath = resolvePackageFolder(args.package);
  mkdirSync(packagePath, { recursive: true });
  const canonicalJd = read(args.jd, 'Canonical JD archive');
  const details = archiveDetails(canonicalJd.text);
  if (normalize(details.company) !== normalize(args.company) || normalize(details.jobTitle) !== normalize(args['job-title']) || normalize(details.requisitionId) !== normalize(args['req-id'])) {
    throw new Error('Company, job title, or requisition ID does not match the canonical JD archive.');
  }
  const packageJdMarkdown = assertInPackage(packagePath, args['jd-package-md'], 'Package JD Markdown copy');
  const packageJdPdf = assertInPackage(packagePath, args['jd-pdf'], 'Package JD PDF');
  const expectedJdTag = `${filenameSegment(details.company, 'Company')}_${filenameSegment(details.jobTitle, 'Job-Title')}_${filenameSegment(details.requisitionId, 'Req-ID')}_Job-Description`;
  if (!packageJdMarkdown.includes(expectedJdTag) || packageJdPdf !== packageJdMarkdown.replace(/\.md$/, '.pdf')) {
    throw new Error('Package JD filenames do not match the canonical company, title, requisition, and version.');
  }
  const canonicalJdSha256 = sha256(readFileSync(canonicalJd.path));
  const packageJdSha256 = sha256(readFileSync(resolve(ROOT, args['jd-package-md'])));
  if (canonicalJdSha256 !== packageJdSha256) throw new Error('Canonical JD archive and package Markdown copy checksum mismatch; package release is blocked.');
  const jdPdfBuffer = readFileSync(resolve(ROOT, args['jd-pdf']));
  if (jdPdfBuffer.length < 1024 || jdPdfBuffer.subarray(0, 4).toString('ascii') !== '%PDF') throw new Error('Package JD PDF is missing or invalid; package release is blocked.');
  const files = [
    ['Tailored resume PDF', args['resume-pdf']], ['Tailored resume source', args['resume-source']],
    ['Cover letter PDF', args['cover-pdf']], ['Cover letter source', args['cover-source']],
    ['Full job-description PDF', args['jd-pdf']], ['Full archived job-description Markdown copy', args['jd-package-md']],
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
    `- **Canonical JD archive path:** ${relative(ROOT, canonicalJd.path).split(sep).join('/')}`,
    `- **Package JD Markdown filename:** ${packageJdMarkdown}`, `- **Package JD PDF filename:** ${packageJdPdf}`,
    `- **JD archive version:** ${args['jd-version']}`, `- **Canonical JD SHA-256:** ${canonicalJdSha256}`,
    `- **Package JD SHA-256:** ${packageJdSha256}`, '- **JD archive/package checksum match:** PASS',
    '- **JD PDF generation:** PASS', '- **JD PDF text selectable/searchable:** PASS',
    `- **Posting status at capture:** ${details.postingStatus}`, `- **Last-verified date:** ${details.lastVerifiedDate}`,
    `- **Evaluation report path:** ${args.report}`, `- **Fit score:** ${args.fit}`, `- **Package generation date and time:** ${new Date().toISOString()}`,
    `- **Source cv.md SHA-256:** ${checksum}`, '- **Certification reconciliation:** PASS', '- **Education reconciliation:** PASS',
    '- **Cover-letter source audit:** PASS', '- **Employment reconciliation:** PASS', '- **All source employers represented:** PASS',
    '- **All source roles represented:** PASS', '- **Employer/title/date integrity:** PASS', '- **Chronology integrity:** PASS',
    '- **Engagement-structure integrity:** PASS', '- **No employer or responsibility conflation:** PASS',
    '- **Relevant-experience appreciation:** PASS', `- **PDF export result:** ${args['pdf-export-check']}`,
    `- **DOCX export result:** ${args['docx-export-result']}`, `- **Preferred application resume:** ${files.find(([label]) => label === 'Tailored resume PDF')?.[1] || ''}`,
    `- **Editable resume copy:** ${args['resume-docx'] ? files.find(([label]) => label === 'Tailored resume DOCX')?.[1] || '' : 'Unavailable'}`,
    `- **Preferred cover letter:** ${files.find(([label]) => label === 'Cover letter PDF')?.[1] || ''}`,
    `- **Editable cover-letter copy:** ${args['cover-docx'] ? files.find(([label]) => label === 'Cover letter DOCX')?.[1] || '' : files.find(([label]) => label === 'Cover letter source')?.[1] || 'Unavailable'}`,
    '- **Current tracker status:** Evaluated', '- **Package approved:** Yes', '- **No application submitted:** Yes', '',
    '## Generated Files', '', '- **Package manifest:** manifest.md', ...files.map(([label, file]) => `- **${label}:** ${file}`), '', '## References', '',
    `- Archived JD: ${args.jd}`, `- Package JD Markdown: ${packageJdMarkdown}`, `- Package JD PDF: ${packageJdPdf}`,
    `- Evaluation report: ${args.report}`,
  ];
  const manifest = resolve(packagePath, 'manifest.md');
  writeFileSync(manifest, `${lines.join('\n')}\n`, 'utf8');
  console.log(JSON.stringify({ manifest: relative(ROOT, manifest).split(sep).join('/'), files: files.map(([, file]) => file), submitted: 'No' }, null, 2));
}

function relativePackagePath(packagePath, pathValue, label) {
  return assertInPackage(packagePath, pathValue, label);
}

function writeIfChanged(path, content) {
  const normalized = `${content.trimEnd()}\n`;
  if (!existsSync(path) || readFileSync(path, 'utf8') !== normalized) writeFileSync(path, normalized, 'utf8');
}

function packageRelativeLinks(markdown, sourcePath, packagePath) {
  return markdown.replace(/\]\(([^)]+)\)/g, (match, target) => {
    if (/^(?:[a-z]+:|#)/i.test(target)) return match;
    const destination = resolve(dirname(sourcePath), target);
    const rel = relative(packagePath, destination).split(sep).join('/') || './';
    return `](${rel})`;
  });
}

function timestampParts(date) {
  const iso = date.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) + 'Z' };
}

function appendTimeline(packagePath, event, actor, source, date = new Date(), key = '') {
  const timelinePath = resolve(packagePath, 'timeline.md');
  let content = existsSync(timelinePath)
    ? readFileSync(timelinePath, 'utf8').trimEnd()
    : '# Application Timeline\n\n| Date | Time | Actor | Source | Event |\n|---|---|---|---|---|';
  const marker = key ? `<!-- lifecycle:${key} -->` : '';
  if (marker && content.includes(marker)) return false;
  const stamp = timestampParts(date);
  content += `\n| ${stamp.date} | ${stamp.time} | ${actor} | ${source} | ${event} ${marker} |`;
  writeIfChanged(timelinePath, content);
  return true;
}

function blankInterviewWorkspace(packagePath) {
  const interviewPath = resolve(packagePath, 'Interview');
  mkdirSync(interviewPath, { recursive: true });
  for (const filename of ['Interview Notes.md', 'STAR Stories.md', 'Company Research.md', 'Recruiter Notes.md', 'Questions Asked.md', 'Salary Negotiation.md', 'Offer Notes.md', 'Follow-Up.md']) {
    const path = resolve(interviewPath, filename);
    if (!existsSync(path)) writeFileSync(path, `# ${filename.replace(/\.md$/, '')}\n`, 'utf8');
  }
}

function lifecycleHealth({ packagePath, details, report, resumePdf, resumeSource, resumeDocx, coverPdf, jdPdf, jdMarkdown, evaluation, intelligence, answers, manifest }) {
  const evidenceMapping = /## Matched Requirements[\s\S]*## Truthful Tailoring Plan/.test(report.text);
  const resumeText = readFileSync(resolve(packagePath, resumeSource), 'utf8').toLowerCase();
  const jdText = details.completeDescription.toLowerCase();
  const keywordOptimization = ['audit', 'control', 'soc', 'security', 'compliance', 'technology']
    .filter(term => jdText.includes(term) && resumeText.includes(term)).length >= 2;
  const checks = [
    ['Resume PDF', existsSync(resolve(packagePath, resumePdf)) ? 'PASS' : 'FAIL'],
    ['Resume DOCX', resumeDocx ? 'PASS' : 'UNSUPPORTED'],
    ['Cover Letter', existsSync(resolve(packagePath, coverPdf)) ? 'PASS' : 'FAIL'],
    ['JD PDF', existsSync(resolve(packagePath, jdPdf)) ? 'PASS' : 'FAIL'],
    ['JD Archive', existsSync(resolve(packagePath, jdMarkdown)) ? 'PASS' : 'FAIL'],
    ['Evaluation', existsSync(resolve(packagePath, evaluation)) ? 'PASS' : 'FAIL'],
    ['Application Intelligence', existsSync(resolve(packagePath, intelligence)) ? 'PASS' : 'FAIL'],
    ['ATS Answers', existsSync(resolve(packagePath, answers)) ? 'PASS' : 'FAIL'],
    ['Certification Reconciliation', /Certification reconciliation:\*\* PASS/.test(manifest) ? 'PASS' : 'FAIL'],
    ['Education Reconciliation', /Education reconciliation:\*\* PASS/.test(manifest) ? 'PASS' : 'FAIL'],
    ['Employment Reconciliation', /Employment reconciliation:\*\* PASS/.test(manifest) ? 'PASS' : 'FAIL'],
    ['Evidence Mapping', evidenceMapping ? 'PASS' : 'FAIL'],
    ['Keyword Optimization', keywordOptimization ? 'PASS' : 'FAIL'],
  ];
  return { checks, ready: checks.every(([, result]) => result === 'PASS' || result === 'UNSUPPORTED') };
}

function completeLifecycle(args) {
  const required = ['package', 'jd', 'report', 'resume-pdf', 'resume-source', 'cover-pdf', 'jd-pdf', 'jd-package-md', 'evaluation-reference', 'answers', 'tracker-status'];
  for (const name of required) if (!args[name]) throw new Error(`Missing --${name} for lifecycle completion.`);
  const packagePath = resolvePackageFolder(args.package);
  const details = archiveDetails(read(args.jd, 'Canonical JD archive').text);
  const report = read(args.report, 'Evaluation report');
  const manifestPath = resolve(packagePath, 'manifest.md');
  if (!existsSync(manifestPath)) throw new Error('manifest.md must exist before lifecycle completion.');
  const resumePdf = relativePackagePath(packagePath, args['resume-pdf'], 'Resume PDF');
  const resumeSource = relativePackagePath(packagePath, args['resume-source'], 'Resume source');
  const coverPdf = relativePackagePath(packagePath, args['cover-pdf'], 'Cover letter PDF');
  const jdPdf = relativePackagePath(packagePath, args['jd-pdf'], 'JD PDF');
  const jdMarkdown = relativePackagePath(packagePath, args['jd-package-md'], 'JD Markdown copy');
  const evaluationReference = relativePackagePath(packagePath, args['evaluation-reference'], 'Evaluation reference');
  const answerSource = relativePackagePath(packagePath, args.answers, 'Application answers');
  const resumeDocx = args['resume-docx'] ? relativePackagePath(packagePath, args['resume-docx'], 'Resume DOCX') : '';
  const coverDocx = args['cover-docx'] ? relativePackagePath(packagePath, args['cover-docx'], 'Cover-letter DOCX') : '';
  const intelligence = 'Application-Intelligence.md';
  const evaluation = 'Evaluation.md';
  const atsAnswers = 'ATS-Answers.md';
  const packageReport = packageRelativeLinks(report.text, report.path, packagePath);
  writeIfChanged(resolve(packagePath, intelligence), `# Application Intelligence\n\nThis package-local intelligence report preserves the approved evaluation source.\n\n**Canonical evaluation report:** [${basename(report.path)}](${relative(packagePath, report.path).split(sep).join('/')})\n\n---\n\n${packageReport}`);
  writeIfChanged(resolve(packagePath, evaluation), `# Evaluation\n\n- **Package evaluation reference:** [${evaluationReference}](${evaluationReference})\n- **Canonical evaluation report:** [${basename(report.path)}](${relative(packagePath, report.path).split(sep).join('/')})\n- **Fit score:** ${args.fit || 'See canonical evaluation report'}\n`);
  copyFileSync(resolve(packagePath, answerSource), resolve(packagePath, atsAnswers));
  const submitted = args['tracker-status'] === 'Applied' ? 'Yes' : 'No';
  writeIfChanged(resolve(packagePath, 'NEXT-STEPS.md'), `# Next Steps\n\n- **Company:** ${details.company}\n- **Role:** ${details.jobTitle}\n- **Application URL:** ${details.canonicalUrl}\n- **Current status:** ${args['tracker-status']}\n- **Application submitted:** ${submitted}\n\n## Files to Upload\n\n- **Preferred upload:** [Resume.pdf](${resumePdf})\n- **Optional upload:** ${coverPdf ? `[Cover Letter](${coverPdf}) if requested` : 'Not created'}\n\n## Reference Documents\n\n- [Job Description PDF](${jdPdf})\n- [Job Description Markdown](${jdMarkdown})\n- [Evaluation](${evaluation})\n- [Application Intelligence](${intelligence})\n- [ATS Answers](${atsAnswers})\n- [Manifest](manifest.md)\n\n## After Manual Submission\n\nRun:\n\n\`/audit-status applied\`\n\nor\n\n\`/audit-update-status applied\`\n`);
  blankInterviewWorkspace(packagePath);
  appendTimeline(packagePath, 'Job discovered', 'System', 'Canonical JD archive', new Date(`${details.firstDiscoveredDate}T00:00:00.000Z`), 'job-discovered');
  appendTimeline(packagePath, 'JD archived', 'System', 'Canonical JD archive', new Date(details.originalCaptureDate), 'jd-archived');
  appendTimeline(packagePath, 'Evaluation completed', 'System', 'Canonical evaluation report', statSync(report.path).mtime, 'evaluation-completed');
  appendTimeline(packagePath, 'Resume generated', 'System', 'Package resume PDF', statSync(resolve(packagePath, resumePdf)).mtime, 'resume-generated');
  appendTimeline(packagePath, 'Cover letter generated', 'System', 'Package cover-letter PDF', statSync(resolve(packagePath, coverPdf)).mtime, 'cover-letter-generated');
  appendTimeline(packagePath, 'Application package generated', 'System', 'audit-package lifecycle helper', new Date(), 'package-generated');
  const manifest = readFileSync(manifestPath, 'utf8');
  const health = lifecycleHealth({ packagePath, details, report, resumePdf, resumeSource, resumeDocx, coverPdf, jdPdf, jdMarkdown, evaluation, intelligence, answers: atsAnswers, manifest });
  if (!health.ready) throw new Error(`Package health failed: ${health.checks.filter(([, result]) => result === 'FAIL').map(([label]) => label).join(', ')}.`);
  const withoutHealth = manifest.split('\n## Package Health\n')[0].trimEnd();
  const healthText = ['## Package Health', '', ...health.checks.map(([label, result]) => `- **${label}:** ${result}`), '- **Overall Package:** READY'].join('\n');
  writeIfChanged(manifestPath, `${withoutHealth}\n\n${healthText}`);
  writeIfChanged(resolve(packagePath, 'CONTENTS.md'), `# Application Package\n\n- [Resume.pdf](${resumePdf})\n${resumeDocx ? `- [Resume.docx](${resumeDocx})\n` : ''}- [Cover-Letter.pdf](${coverPdf})\n${coverDocx ? `- [Cover-Letter.docx](${coverDocx})\n` : ''}- [Job-Description.pdf](${jdPdf})\n- [Job-Description.md](${jdMarkdown})\n- [Application-Intelligence.md](${intelligence})\n- [Evaluation.md](${evaluation})\n- [ATS-Answers.md](${atsAnswers})\n- [manifest.md](manifest.md)\n- [NEXT-STEPS.md](NEXT-STEPS.md)\n- [timeline.md](timeline.md)\n- [Interview/](Interview/)\n`);
  let explorerOpened = false;
  let clipboardWorked = false;
  if (platform() === 'win32') {
    const clipboard = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Set-Clipboard -Value $args[0]', details.canonicalUrl], { stdio: 'ignore' });
    clipboardWorked = clipboard.status === 0;
    try {
      const explorer = spawn('explorer.exe', [packagePath], { detached: true, stdio: 'ignore' });
      explorer.unref();
      explorerOpened = true;
    } catch { explorerOpened = false; }
  }
  console.log(JSON.stringify({
    package: relative(ROOT, packagePath).split(sep).join('/'), company: details.company, role: details.jobTitle,
    applicationUrl: details.canonicalUrl, currentStatus: args['tracker-status'], applicationSubmitted: submitted,
    contents: 'CONTENTS.md', nextSteps: 'NEXT-STEPS.md', timeline: 'timeline.md', interviewWorkspace: 'Interview/',
    packageHealth: 'READY', explorerOpened, clipboardWorked,
    summary: 'APPLICATION PACKAGE READY. Review, upload, and submit manually. No application has been submitted.',
  }, null, 2));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function packageVersionHistory(path) {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  const headings = [...text.matchAll(/^## v(\d+)\s+-\s+(.+)$/gm)];
  return headings.map((heading, index) => {
    const start = heading.index + heading[0].length;
    const end = index + 1 < headings.length ? headings[index + 1].index : text.length;
    const block = text.slice(start, end);
    const field = (label) => new RegExp(`^- \\*\\*${escapeRegExp(label)}:\\*\\* (.+)$`, 'm').exec(block)?.[1]?.trim() || '';
    return { version: Number(heading[1]), title: heading[2], block, field };
  });
}

function checksumRecord(args, packagePath) {
  const resumeSource = relativePackagePath(packagePath, args['resume-source'], 'Resume source');
  const coverSource = relativePackagePath(packagePath, args['cover-source'], 'Cover-letter source');
  const intelligence = relativePackagePath(packagePath, args.intelligence, 'Application Intelligence');
  const answers = relativePackagePath(packagePath, args.answers, 'ATS answers');
  const jd = read(args.jd, 'Canonical JD archive');
  return {
    'CV checksum': sha256(readFileSync(resolve(ROOT, 'cv.md'))),
    'JD checksum': sha256(readFileSync(jd.path)),
    'Resume source checksum': sha256(readFileSync(resolve(packagePath, resumeSource))),
    'Cover-letter source checksum': sha256(readFileSync(resolve(packagePath, coverSource))),
    'Intelligence-report checksum': sha256(readFileSync(resolve(packagePath, intelligence))),
    'ATS-answers checksum': sha256(readFileSync(resolve(packagePath, answers))),
    resumeSource, coverSource, intelligence, answers,
  };
}

function materialChanges(latest, checksums) {
  if (!latest) return [];
  return ['CV checksum', 'JD checksum', 'Resume source checksum', 'Cover-letter source checksum', 'Intelligence-report checksum', 'ATS-answers checksum']
    .filter(label => latest.field(label) !== checksums[label]);
}

function versionedMaterialFiles(args, packagePath) {
  const required = ['resume-pdf', 'cover-pdf', 'jd-pdf', 'jd-package-md'];
  const files = [
    ['Resume PDF', args['resume-pdf']], ['Resume source', args['resume-source']],
    ['Cover-letter PDF', args['cover-pdf']], ['Cover-letter source', args['cover-source']],
    ['Job-description PDF', args['jd-pdf']], ['Job-description Markdown', args['jd-package-md']],
    ['Application Intelligence', args.intelligence], ['ATS Answers', args.answers],
  ];
  for (const name of required) if (!args[name]) throw new Error(`Missing --${name} for package versioning.`);
  if (args['resume-docx']) files.push(['Resume DOCX', args['resume-docx']]);
  if (args['cover-docx']) files.push(['Cover-letter DOCX', args['cover-docx']]);
  return files.map(([label, file]) => [label, relativePackagePath(packagePath, file, label)]);
}

function upsertManifestVersion(manifestPath, data) {
  const existing = readFileSync(manifestPath, 'utf8');
  const healthIndex = existing.indexOf('\n## Package Health\n');
  const beforeHealth = healthIndex === -1 ? existing : existing.slice(0, healthIndex);
  const base = beforeHealth.split('\n## Package Version\n')[0].trimEnd();
  const health = healthIndex === -1 ? '' : existing.slice(healthIndex).trim();
  const versionSection = [
    '## Package Version', '', `- **Current package version:** v${data.version}`,
    `- **Previous package version:** ${data.previousVersion ? `v${data.previousVersion}` : 'None'}`,
    '- **versions.md path:** versions.md', `- **Version-generation reason:** ${data.reason}`,
    `- **CV checksum:** ${data.checksums['CV checksum']}`, `- **JD checksum:** ${data.checksums['JD checksum']}`,
    `- **Resume source checksum:** ${data.checksums['Resume source checksum']}`,
    `- **Cover-letter source checksum:** ${data.checksums['Cover-letter source checksum']}`,
    `- **Intelligence-report checksum:** ${data.checksums['Intelligence-report checksum']}`,
    `- **ATS-answers checksum:** ${data.checksums['ATS-answers checksum']}`,
    `- **Material change detected:** ${data.materialChangeDetected ? 'Yes' : 'No'}`,
  ].join('\n');
  writeIfChanged(manifestPath, [base, versionSection, health].filter(Boolean).join('\n\n'));
}

function versionPackage(args) {
  const required = ['package', 'jd', 'fit', 'tracker-status', 'resume-source', 'cover-source', 'intelligence', 'answers'];
  for (const name of required) if (!args[name]) throw new Error(`Missing --${name} for package versioning.`);
  const packagePath = resolvePackageFolder(args.package);
  const manifestPath = resolve(packagePath, 'manifest.md');
  if (!existsSync(manifestPath)) throw new Error('manifest.md must exist before version registration.');
  const checksums = checksumRecord(args, packagePath);
  const files = versionedMaterialFiles(args, packagePath);
  const historyPath = resolve(packagePath, 'versions.md');
  const history = packageVersionHistory(historyPath);
  const latest = history.at(-1);
  const changes = materialChanges(latest, checksums);
  const actor = args.actor || 'System';
  const submitted = args['tracker-status'] === 'Applied' ? 'Yes' : 'No';
  if (latest && changes.length === 0) {
    upsertManifestVersion(manifestPath, { version: latest.version, previousVersion: latest.version - 1 || 0, reason: latest.field('Reason'), checksums, materialChangeDetected: false });
    console.log(JSON.stringify({ version: `v${latest.version}`, materialChangeDetected: false, action: 'No material change; existing version retained.', versions: relative(ROOT, historyPath).split(sep).join('/') }, null, 2));
    return;
  }
  const version = latest ? latest.version + 1 : 1;
  if (version > 1 && args.approved !== 'APPROVE') {
    console.log(JSON.stringify({
      version: `v${version}`, materialChangeDetected: true, changed: changes,
      approvalRequired: true,
      prompt: `A material application-package revision has been identified. Create version v${version}? Reply APPROVE, REVISE, SKIP, or STOP.`,
    }, null, 2));
    return;
  }
  if (version > 1 && !args.reason) throw new Error('A material revision requires --reason with an exact change description.');
  if (version > 1 && !args['change-summary']) throw new Error('A material revision requires --change-summary with the exact changes.');
  if (version > 1) {
    for (const [label, file] of files.filter(([label]) => /PDF|DOCX/.test(label))) {
      if (!new RegExp(`_v${version}\\.[^.]+$`, 'i').test(file)) throw new Error(`${label} for v${version} must use the _v${version} filename suffix.`);
    }
  }
  const reason = args.reason || 'Initial approved application package';
  const changeSummary = version === 1
    ? ['Initial tailored resume', 'Initial cover letter', 'Initial ATS answers', 'Initial intelligence report']
    : args['change-summary'].split('|').map(item => item.trim()).filter(Boolean);
  const unchanged = version === 1 ? [] : ['CV checksum', 'JD checksum', 'Resume source checksum', 'Cover-letter source checksum', 'Intelligence-report checksum', 'ATS-answers checksum']
    .filter(label => !changes.includes(label));
  const timestamp = new Date().toISOString();
  const section = [
    `## v${version} - ${version === 1 ? 'Initial Package' : 'Revised Package'}`, '',
    `- **Generated:** ${timestamp}`, `- **Reason:** ${reason}`, `- **Actor:** ${actor}`,
    ...(version > 1 ? [`- **Approved by:** ${actor}`, `- **Previous version:** v${latest.version}`] : []),
    `- **CV checksum:** ${checksums['CV checksum']}`, `- **JD checksum:** ${checksums['JD checksum']}`,
    `- **Resume source checksum:** ${checksums['Resume source checksum']}`,
    `- **Cover-letter source checksum:** ${checksums['Cover-letter source checksum']}`,
    `- **Intelligence-report checksum:** ${checksums['Intelligence-report checksum']}`,
    `- **ATS-answers checksum:** ${checksums['ATS-answers checksum']}`,
    `- **Fit score:** ${args.fit}`, `- **Tracker status:** ${args['tracker-status']}`, `- **Submitted:** ${submitted}`,
    ...(submitted === 'Yes' && latest ? [`- **Earlier submitted version:** v${latest.version}; submitted files remain unchanged.`] : []),
    '- **Files:**', ...files.map(([label, file]) => `  - ${label}: ${file}`), '- **Changes:**', ...changeSummary.map(item => `  - ${item}`),
    ...(unchanged.length ? ['- **Unchanged:**', ...unchanged.map(item => `  - ${item}`)] : []),
  ].join('\n');
  const existing = existsSync(historyPath) ? readFileSync(historyPath, 'utf8').trimEnd() : '# Application Package Version History';
  writeIfChanged(historyPath, `${existing}\n\n${section}`);
  upsertManifestVersion(manifestPath, { version, previousVersion: latest?.version || 0, reason, checksums, materialChangeDetected: version > 1 });
  console.log(JSON.stringify({ version: `v${version}`, previousVersion: latest ? `v${latest.version}` : null, materialChangeDetected: version > 1, versions: relative(ROOT, historyPath).split(sep).join('/'), files: files.map(([, file]) => file), submitted }, null, 2));
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
  } else if (args['validate-docx']) {
    if (!args.resume || !args.docx) throw new Error('--validate-docx requires --resume <tailored-resume.md> and --docx <resume.docx>.');
    const result = validateDocx(read(args.resume, 'Tailored resume source'), read(args.docx, 'Resume DOCX'));
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
  } else if (args['create-jd-pdf']) await createJdPdf(args);
  else if (args['create-manifest']) createManifest(args);
  else if (args['append-timeline']) {
    if (!args.package || !args.event || !args.actor || !args.source) throw new Error('--append-timeline requires --package, --event, --actor, and --source.');
    const packagePath = resolvePackageFolder(args.package);
    if (!existsSync(packagePath)) throw new Error(`Package folder does not exist: ${args.package}`);
    appendTimeline(packagePath, args.event, args.actor, args.source);
    console.log(JSON.stringify({ timeline: relative(ROOT, resolve(packagePath, 'timeline.md')).split(sep).join('/'), event: args.event }, null, 2));
  } else if (args['complete-lifecycle']) completeLifecycle(args);
  else if (args['version-package']) versionPackage(args);
  else throw new Error('Choose exactly one action: --inspect, --validate-resume, --validate-docx, --create-jd-pdf, --create-manifest, --complete-lifecycle, --append-timeline, or --version-package.');
} catch (error) {
  console.error(`audit-package: ${error.message}`);
  process.exitCode = 1;
}
