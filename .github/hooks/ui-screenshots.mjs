#!/usr/bin/env node
// Shared end-of-task hook for Claude Code (Stop) and GitHub Copilot CLI (sessionEnd).
// If UI files (src/**, index.html) have uncommitted changes, regenerate the
// screenshots in docs/screenshots/ by running the Playwright workflow test (it
// saves one PNG per step). If the images changed or the test failed, ask the
// agent to refresh the Screenshots section in README.md and the screenshot table
// in CLAUDE.md. Silent when nothing changed.
import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';
let input = '';
for await (const chunk of process.stdin) input += chunk;
let payload = {};
try {
  payload = JSON.parse(input || '{}');
} catch {
  process.exit(0);
}
// Claude Code sets stop_hook_active when this hook already blocked the stop once.
// Skip it then, so the agent's README update does not trigger another run.
if (payload.stop_hook_active) process.exit(0);
const projectDir = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
const git = (args) => spawnSync('git', args, { cwd: projectDir, encoding: 'utf8' }).stdout ?? '';
// Only run when UI files differ from HEAD (modified or untracked).
const uiChanges = git(['status', '--porcelain', '--', 'src', 'index.html']).trim();
if (!uiChanges) process.exit(0);
// Regenerate the screenshots by running the E2E workflow test.
const run = spawnSync('npx', ['playwright', 'test', 'tests/e2e'], {
  cwd: projectDir,
  encoding: 'utf8',
  timeout: 200_000,
  env: { ...process.env, CI: '' },
});
const testFailed = run.status !== 0;
// Which screenshots differ from the committed versions (modified or new).
const changed = git(['status', '--porcelain', '--', 'docs/screenshots'])
  .split('\n')
  .map((line) => line.slice(3).trim())
  .filter(Boolean)
  .map((p) => basename(p));
if (!testFailed && changed.length === 0) process.exit(0);
const parts = [];
if (testFailed) {
  parts.push(
    'UI files changed and the Playwright E2E test failed, so the screenshots may be incomplete. ' +
      'Run `npx playwright test tests/e2e`, fix the failure, and re-check the screenshots.',
  );
}
if (changed.length > 0) {
  parts.push(
    `The E2E test regenerated these screenshots in docs/screenshots/: ${changed.join(', ')}. ` +
      'Review them, and if a step was added, removed or renamed, update the Screenshots section in README.md ' +
      'and the screenshot table in CLAUDE.md (Testing section) so each image is embedded under the right heading.',
  );
}
// Claude Code: block the stop once so the agent can apply the README/CLAUDE.md update.
// Copilot CLI sessionEnd: the session is already over, so the message is informational only.
process.stdout.write(JSON.stringify({ decision: 'block', reason: parts.join(' ') }));
