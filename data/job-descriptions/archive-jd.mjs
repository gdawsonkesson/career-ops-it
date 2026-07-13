#!/usr/bin/env node
/**
 * User-owned Career-Ops JD archive helper.
 * Reads one JSON payload from stdin and writes or updates a stable Markdown
 * snapshot without touching pipeline or tracker data.
 */
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ARCHIVE_DIR = dirname(fileURLToPath(import.meta.url));

function fail(message) {
  console.error(message);
  process.exit(1);
}

function cleanSegment(value, fallback) {
  const cleaned = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function stableId(payload) {
  if (payload.requisitionId) return cleanSegment(payload.requisitionId, 'posting');
  return createHash('sha256').update(payload.canonicalUrl).digest('hex').slice(0, 10);
}

function field(value) {
  return value && String(value).trim() ? String(value).trim() : 'Not stated in posting';
}

function metaLine(label, value) {
  return `- ${label}: ${field(value)}`;
}

function renderInitial(payload, capturedAt, identifier) {
  return [
    `# ${payload.company} - ${payload.jobTitle}`,
    '',
    metaLine('Canonical URL', payload.canonicalUrl),
    metaLine('Requisition ID', payload.requisitionId || identifier),
    metaLine('First discovered date', payload.firstDiscoveredDate),
    metaLine('Captured date and time', capturedAt),
    metaLine('Last verified date', payload.lastVerifiedDate),
    metaLine('Posting status', payload.postingStatus),
    metaLine('Location', payload.location),
    metaLine('Work arrangement', payload.workArrangement),
    metaLine('Salary or compensation range', payload.compensation),
    metaLine('Employment type', payload.employmentType),
    metaLine('Travel requirement', payload.travelRequirement),
    metaLine('Work-authorization or sponsorship language', payload.workAuthorization),
    metaLine('Security-clearance requirement', payload.securityClearance),
    '',
    '## Complete Job Description',
    '',
    payload.completeDescription.trim(),
    '',
  ].join('\n');
}

function getMeta(content, label) {
  const match = content.match(new RegExp(`^- ${label}: (.*)$`, 'm'));
  return match ? match[1] : null;
}

function replaceMeta(content, label, value) {
  const line = metaLine(label, value);
  const pattern = new RegExp(`^- ${label}: .*$`, 'm');
  return pattern.test(content) ? content.replace(pattern, line) : content;
}

function initialDescription(content) {
  const marker = '## Complete Job Description\n';
  const start = content.indexOf(marker);
  if (start < 0) return '';
  const remainder = content.slice(start + marker.length);
  const update = remainder.indexOf('\n## Update - ');
  return (update < 0 ? remainder : remainder.slice(0, update)).trim();
}

function materiallyChanged(existing, payload) {
  return initialDescription(existing).replace(/\r\n/g, '\n').trim() !== payload.completeDescription.replace(/\r\n/g, '\n').trim();
}

function appendUpdate(content, payload, capturedAt) {
  return [
    content.trimEnd(),
    '',
    `## Update - ${capturedAt}`,
    '',
    metaLine('Last verified date', payload.lastVerifiedDate),
    metaLine('Posting status', payload.postingStatus),
    metaLine('Location', payload.location),
    metaLine('Work arrangement', payload.workArrangement),
    metaLine('Salary or compensation range', payload.compensation),
    metaLine('Employment type', payload.employmentType),
    metaLine('Travel requirement', payload.travelRequirement),
    metaLine('Work-authorization or sponsorship language', payload.workAuthorization),
    metaLine('Security-clearance requirement', payload.securityClearance),
    '',
    '### Complete Job Description',
    '',
    payload.completeDescription.trim(),
    '',
  ].join('\n');
}

const input = await new Promise(resolve => {
  let text = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { text += chunk; });
  process.stdin.on('end', () => resolve(text));
});

if (!input.trim()) fail('Archive payload must be provided as JSON on stdin.');

let payload;
try {
  payload = JSON.parse(input);
} catch {
  fail('Archive payload is not valid JSON.');
}

for (const key of ['company', 'jobTitle', 'canonicalUrl', 'firstDiscoveredDate', 'lastVerifiedDate', 'postingStatus', 'completeDescription']) {
  if (!payload[key] || !String(payload[key]).trim()) fail(`Archive payload is missing ${key}.`);
}

const identifier = stableId(payload);
const capturedAt = payload.capturedAt || new Date().toISOString();
const filename = `${payload.firstDiscoveredDate}_${cleanSegment(payload.company, 'company')}_${cleanSegment(payload.jobTitle, 'job')}_${identifier}.md`;
mkdirSync(ARCHIVE_DIR, { recursive: true });

const matches = readdirSync(ARCHIVE_DIR)
  .filter(name => name.endsWith(`_${identifier}.md`))
  .map(name => join(ARCHIVE_DIR, name));

if (matches.length > 1) fail(`Multiple archives found for identifier ${identifier}. Resolve manually before updating.`);

let archivePath = join(ARCHIVE_DIR, filename);
let result = 'created';
if (matches.length === 1) {
  archivePath = matches[0];
  const existing = readFileSync(archivePath, 'utf8');
  const existingUrl = getMeta(existing, 'Canonical URL');
  if (existingUrl && existingUrl !== payload.canonicalUrl) {
    fail(`Refusing to overwrite a different posting with identifier ${identifier}.`);
  }
  if (materiallyChanged(existing, payload)) {
    writeFileSync(archivePath, appendUpdate(existing, payload, capturedAt), 'utf8');
    result = 'updated';
  } else {
    writeFileSync(archivePath, replaceMeta(existing, 'Last verified date', payload.lastVerifiedDate), 'utf8');
    result = 'verified-unchanged';
  }
} else if (!existsSync(archivePath)) {
  writeFileSync(archivePath, renderInitial(payload, capturedAt, identifier), 'utf8');
} else {
  fail(`Refusing to overwrite existing archive ${basename(archivePath)}.`);
}

console.log(JSON.stringify({
  result,
  path: `data/job-descriptions/${basename(archivePath)}`,
  identifier,
}));
