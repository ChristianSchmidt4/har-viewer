#!/usr/bin/env node
// Shared post-tool hook for Claude Code and GitHub Copilot CLI: when
// package.json's minor version rises (vs. HEAD) and CHANGELOG.md has no
// section for the new version yet, ask the agent to update README.md,
// CLAUDE.md and CHANGELOG.md.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';

function parseSemver(text) {
  const match = /"version"\s*:\s*"(\d+)\.(\d+)\.(\d+)"/.exec(text);
  return match ? match.slice(1).map(Number) : null;
}

// Claude Code sends tool_input.file_path; Copilot CLI sends toolArgs (a JSON string) with path.
function editedPath(payload) {
  if (payload.tool_input?.file_path) return payload.tool_input.file_path;
  if (typeof payload.toolArgs === 'string') {
    try {
      return JSON.parse(payload.toolArgs).path ?? '';
    } catch {
      return '';
    }
  }
  return '';
}

let input = '';
for await (const chunk of process.stdin) input += chunk;

let payload;
try {
  payload = JSON.parse(input);
} catch {
  process.exit(0);
}

const projectDir = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
const filePath = editedPath(payload);
if (basename(filePath) !== 'package.json') process.exit(0);

const current = parseSemver(readFileSync(join(projectDir, 'package.json'), 'utf8'));
let committed;
try {
  committed = parseSemver(
    execFileSync('git', ['show', 'HEAD:package.json'], { cwd: projectDir, encoding: 'utf8' }),
  );
} catch {
  process.exit(0);
}
if (!current || !committed) process.exit(0);

const [major, minor] = current;
const [headMajor, headMinor] = committed;
if (major !== headMajor || minor <= headMinor) process.exit(0);

const version = current.join('.');
const changelogPath = join(projectDir, 'CHANGELOG.md');
if (existsSync(changelogPath) && readFileSync(changelogPath, 'utf8').includes(`## [${version}]`)) {
  process.exit(0);
}

const message =
  `package.json minor version was bumped to ${version}. Update the project docs for this release: ` +
  `add a "## [${version}]" section to CHANGELOG.md summarizing the changes since the previous version, ` +
  `and bring README.md and CLAUDE.md in line with any changed behavior, components, or workflows.`;

process.stdout.write(
  JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: message } }),
);
