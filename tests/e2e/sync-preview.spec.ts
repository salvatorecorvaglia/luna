import { rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { expect, test } from '@playwright/test';
import type { LunaAPI } from '../../src/preload';
import { closeApp, type LaunchedApp, launchApp } from './fixtures';

let launched: LaunchedApp;
let server: Server;
let endpoint: string;
let filePath = '';
let fileName = '';
let modifiedAt = '';
const ENTRY_COUNT = 10000;

test.beforeAll(async () => {
  // A disposable S3-compatible listing endpoint; no uploads are executed.
  server = createServer((request, response) => {
    const url = new URL(request.url!, 'http://localhost');
    if (!url.searchParams.has('list-type')) {
      response.writeHead(200, { 'Content-Type': 'application/xml' });
      response.end(
        '<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Buckets><Bucket><Name>bucket</Name></Bucket></Buckets></ListAllMyBucketsResult>',
      );
      return;
    }
    const start = Number(url.searchParams.get('continuation-token') || 0);
    const end = Math.min(start + 1000, ENTRY_COUNT);
    const entries = Array.from({ length: end - start }, (_, index) => {
      const number = start + index;
      const key = number === 0 ? fileName : `file-${String(number).padStart(5, '0')}.txt`;
      return `<Contents><Key>${key}</Key><Size>7</Size><LastModified>${modifiedAt}</LastModified><StorageClass>STANDARD</StorageClass></Contents>`;
    }).join('');
    response.writeHead(200, { 'Content-Type': 'application/xml' });
    response.end(
      `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>bucket</Name><Prefix></Prefix><KeyCount>${end - start}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>${end < ENTRY_COUNT}</IsTruncated>${end < ENTRY_COUNT ? `<NextContinuationToken>${end}</NextContinuationToken>` : ''}${entries}</ListBucketResult>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  launched = await launchApp({ persistTestCredentials: true });
  const file = await launched.page.evaluate(async () => {
    const api = (window as unknown as { api: LunaAPI }).api;
    const name = `luna-e2e-preview-${crypto.randomUUID()}.txt`;
    const home = await api.shell.homeDir();
    const path = await api.shell.joinPath(home, name);
    await api.shell.writeFile(path, `${'a'.repeat(10000)}\nsecond\nthird`);
    const entry = (await api.shell.readdir(home)).find((file) => file.name === name)!;
    return { name, path, mtime: entry.modifiedAt };
  });
  filePath = file.path;
  fileName = file.name;
  modifiedAt = new Date(file.mtime * 1000).toISOString();
  await launched.page.evaluate(async (endpoint) => {
    const api = (window as unknown as { api: LunaAPI }).api;
    await api.connections.create({
      name: 'Phase 4 S3 fixture',
      provider: 's3',
      endpoint,
      region: 'us-east-1',
      defaultBucket: 'bucket',
      forcePathStyle: true,
      accessKeyId: 'test',
      secretAccessKey: 'test',
    });
  }, endpoint);
  await launched.page.reload();
  await launched.page.getByRole('button', { name: /^Phase 4 S3 fixture / }).click();
  await launched.page.getByRole('option', { name: /^bucket\b/ }).dblclick();
});
test.afterAll(async () => {
  if (launched) await closeApp(launched);
  if (filePath) await rm(filePath, { force: true });
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
});

test('wrapped preview gutter follows actual text layout and search restores editor focus', async () => {
  const { page } = launched;
  await page.getByRole('tab', { name: 'SFTP', exact: true }).click();
  await page.getByRole('button', { name: 'Filter files', exact: true }).first().click();
  await page
    .getByRole('textbox', { name: 'Filter files in current directory' })
    .first()
    .fill(fileName);
  await page.getByRole('option').filter({ hasText: fileName }).first().dblclick();
  const editor = page.getByRole('textbox', { name: 'File contents' });
  await expect(editor).toBeVisible();
  await page.getByRole('button', { name: 'Word wrap', exact: true }).click();
  const difference = () =>
    editor.evaluate((element) => {
      const editor = element as HTMLTextAreaElement;
      const spacer = document.querySelector<HTMLElement>('[data-line-number]')?.parentElement;
      if (!spacer) return Infinity;
      const style = getComputedStyle(editor);
      const height =
        editor.scrollHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      return Math.abs(spacer.offsetHeight - height);
    });
  await expect.poll(difference).toBeLessThanOrEqual(2);
  await editor.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.locator('[data-line-number="2"]')).toBeVisible();
  const originalSize = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await page.setViewportSize({ width: 1050, height: 700 });
  await expect.poll(difference).toBeLessThanOrEqual(2);
  await page.setViewportSize(originalSize);
  await expect.poll(difference).toBeLessThanOrEqual(2);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Search in file' })).toBeFocused();
  await page.getByRole('button', { name: 'Close file search' }).click();
  await expect(editor).toBeFocused();
  await page.getByRole('button', { name: 'Close preview' }).click();
});

test('large sync comparisons stay virtualized and offscreen conflicts are reachable by keyboard', async () => {
  const { page } = launched;
  await page.getByRole('button', { name: 'Sync Folders', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Differential Folder Synchronizer' });
  await dialog.getByRole('combobox', { name: 'Sync rule:' }).selectOption('bi-directional');
  const review = dialog.getByRole('button', { name: 'Review next unresolved conflict' });
  await expect(review).toBeEnabled();
  await review.focus();
  await review.press('Enter');
  const choice = dialog.getByRole('combobox', { name: `Resolve conflict for ${fileName}` });
  await expect(choice).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Execute Sync' })).toBeDisabled();
  await choice.selectOption('skip');
  await expect(dialog.getByRole('button', { name: 'Execute Sync' })).toBeEnabled();
  const table = dialog.getByRole('table', { name: 'Folder comparison' });
  expect(Number(await table.getAttribute('aria-rowcount'))).toBeGreaterThanOrEqual(ENTRY_COUNT + 1);
  expect(await table.getByRole('row').count()).toBeLessThan(35);
  await dialog.getByRole('region', { name: 'Folder comparison results' }).evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(table.getByText('file-09999.txt', { exact: true })).toBeVisible();
  expect(await table.getByRole('row').count()).toBeLessThan(35);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});
