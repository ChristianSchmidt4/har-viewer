// End-to-end tests: drive the real app in Chromium through the whole workflow
// (import -> open -> filter/highlight/columns -> export -> reload -> delete).
// Run with `npm run test:e2e`. Nothing is uploaded: the fixture is generated
// in the test and handed to the file input.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const DB_NAME = 'Workflow DB';
const DB_COMMENT = 'e2e comment';

// A small HAR with GET/POST requests and request/response bodies of varying size.
const fixtureHar = () => {
  const entry = (
    method: string,
    url: string,
    status: number,
    mimeType: string,
    reqBody: string | null,
    resBody: string,
  ) => ({
    startedDateTime: '2023-01-01T12:00:00.000Z',
    time: 42,
    request: {
      method,
      url,
      httpVersion: 'HTTP/1.1',
      headers: [],
      cookies: [],
      queryString: [],
      headersSize: -1,
      bodySize: reqBody ? reqBody.length : 0,
      ...(reqBody ? { postData: { mimeType, text: reqBody } } : {}),
    },
    response: {
      status,
      statusText: '',
      httpVersion: 'HTTP/1.1',
      headers: [],
      cookies: [],
      content: { size: resBody.length, mimeType: 'text/plain', text: resBody },
      redirectURL: '',
      headersSize: -1,
      bodySize: resBody.length,
    },
    cache: {},
    timings: { send: 1, wait: 30, receive: 11 },
  });

  return {
    log: {
      version: '1.2',
      creator: { name: 'e2e', version: '1' },
      comment: 'fixture comment from the file',
      entries: [
        entry('GET', 'https://example.com/a', 200, 'text/html', null, 'hello'),
        entry('POST', 'https://api.example.org/items', 201, 'application/json', '{"name":"widget"}', '{"ok":true}'),
        entry('POST', 'https://api.example.org/upload', 200, 'text/plain', 'x'.repeat(20_000), 'y'.repeat(4096)),
        entry('GET', 'https://example.com/missing', 404, 'text/plain', null, 'not found'),
      ],
    },
  };
};

const rows = (page: Page) => page.locator('#requests-table-body tr[data-entry-id]');
const dbRow = (page: Page, name: string) => page.locator('li.db-row', { hasText: name });

// Dropping a file runs the import; the name/comment dialog appears once it is read.
const importFile = async (page: Page, file: { name: string; buffer: Buffer }) => {
  await page.locator('#har-file-input').setInputFiles({ name: file.name, mimeType: 'application/json', buffer: file.buffer });
};

const answerNameDialog = async (page: Page, name: string, comment: string) => {
  const dialog = page.locator('dialog.choice-dialog');
  await expect(dialog).toBeVisible();
  const inputs = dialog.locator('input.choice-text-input');
  await inputs.nth(0).fill(name);
  await inputs.nth(1).fill(comment);
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
};

test.describe('HAR viewer workflow', () => {
  test('import, inspect, filter, highlight, export, reload and delete a database', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#drop-screen')).toBeVisible();

    // Import: the database appears in the list and the name/comment dialog asks for details.
    const har = Buffer.from(JSON.stringify(fixtureHar()));
    await importFile(page, { name: 'workflow.har', buffer: har });
    await answerNameDialog(page, DB_NAME, DB_COMMENT);

    await expect(page.locator('#error-message.visible')).toContainText('finished');
    await expect(dbRow(page, DB_NAME)).toHaveAttribute('data-state', 'complete');

    // Open the database: the request table shows all four entries.
    await dbRow(page, DB_NAME).locator('.db-open').click();
    await expect(page.locator('#har-content')).toBeVisible();
    await expect(rows(page)).toHaveCount(4);
    await expect(page.locator('#file-info')).toContainText(DB_NAME);
    await expect(page.locator('#file-info')).toContainText('4 requests');

    // Highlight rule (Enter adds it): the 404 row gets the red class.
    await page.locator('#highlight-input').fill('status:>=400 => red');
    await page.locator('#highlight-input').press('Enter');
    await expect(page.locator('tr.hl-red')).toHaveCount(1);

    // Filter (applied on Enter): only the two POST requests remain.
    await page.locator('#request-filter').fill('method:post');
    await page.locator('#request-filter').press('Enter');
    await expect(rows(page)).toHaveCount(2);

    // Export: downloads only the filtered entries, with the stored comment.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#export-btn').click(),
    ]);
    expect(download.suggestedFilename()).toBe(`${DB_NAME}.filtered.har`);
    const exported = JSON.parse(readFileSync((await download.path())!, 'utf8'));
    expect(exported.log.entries).toHaveLength(2);
    expect(exported.log.entries.every((e: { request: { method: string } }) => e.request.method === 'POST')).toBe(true);
    expect(exported.log.comment).toBe(DB_COMMENT);

    // Custom column from a request header expression.
    await page.locator('#custom-col-input').fill('reqheader:content-type');
    await page.locator('#custom-col-input').press('Enter');
    await expect(page.locator('th.col-custom')).toHaveCount(1);

    // Clear the filter and select two requests: the aggregate Timeline view appears.
    await page.locator('#request-filter').fill('');
    await page.locator('#request-filter').press('Enter');
    await expect(rows(page)).toHaveCount(4);
    await rows(page).nth(0).locator('td').nth(4).click();
    await expect(page.locator('#detail-content')).toBeVisible();
    await rows(page).nth(1).locator('td').nth(4).click({ modifiers: ['Control'] });
    await expect(page.locator('#detail-panel')).toContainText('Timeline');

    // Persisted view: the filter is saved and restored after a reload.
    await page.locator('#request-filter').fill('method:post');
    await page.locator('#request-filter').press('Enter');
    await expect(rows(page)).toHaveCount(2);
    await page.reload();
    await expect(page.locator('#drop-screen')).toBeVisible();
    await dbRow(page, DB_NAME).locator('.db-open').click();
    await expect(rows(page)).toHaveCount(2);
    await expect(page.locator('#request-filter')).toHaveValue('method:post');
    await expect(page.locator('#highlight-rules')).toContainText('status:>=400');
    await expect(page.locator('th.col-custom')).toHaveCount(1);

    // Back to the start page and delete the database.
    await page.locator('#load-new-btn').click();
    await dbRow(page, DB_NAME).locator('.db-delete').click();
    const confirm = page.locator('dialog.choice-dialog');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(dbRow(page, DB_NAME)).toHaveCount(0);
    await expect(page.locator('.db-list-empty')).toBeVisible();
  });

  test('reports a file that is not valid JSON and keeps it as an incomplete database', async ({ page }) => {
    await page.goto('/');
    await importFile(page, { name: 'broken.har', buffer: Buffer.from('this is not json') });

    await expect(page.locator('#error-message.visible')).toContainText('failed');
    await expect(dbRow(page, 'broken.har')).toHaveAttribute('data-state', 'incomplete');
    await expect(dbRow(page, 'broken.har').locator('.db-open')).toBeDisabled();
  });
});

