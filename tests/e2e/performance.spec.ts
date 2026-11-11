import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { LunaAPI } from '../../src/preload';
import { closeApp, launchApp } from './fixtures';

test('records workstation performance with isolated profiles', async () => {
  test.skip(process.env.LUNA_PROFILE !== '1', 'Opt-in profiling: pnpm run profile');
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(homedir(), '.luna-profile-'));
  const samples: Record<string, number>[] = [];
  try {
    for (let start = 0; start < 3000; start += 50) {
      await Promise.all(
        Array.from({ length: 50 }, (_, offset) =>
          writeFile(join(directory, `file-${start + offset}.txt`), 'fixture'),
        ),
      );
    }
    const largeFile = join(directory, 'large.log');
    await writeFile(largeFile, `${'a'.repeat(79)}\n`.repeat(62_500));
    for (let run = 0; run < 3; run++) {
      const start = performance.now();
      const launched = await launchApp();
      try {
        const { page } = launched;
        await expect(page.getByRole('tab', { name: 'Local', exact: true })).toBeVisible();
        const startupMs = performance.now() - start;
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('HeapProfiler.collectGarbage');
        const idleHeapBytes = (await cdp.send('Runtime.getHeapUsage')).usedSize;
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.start');
        await page.evaluate(() => {
          const started = performance.now();
          const state = window as unknown as { terminalReady: Promise<number> };
          state.terminalReady = new Promise((resolve) => {
            const observer = new MutationObserver(() => {
              if (!document.querySelector('.xterm-screen')) return;
              observer.disconnect();
              requestAnimationFrame(() => resolve(performance.now() - started));
            });
            observer.observe(document.body, { childList: true, subtree: true });
          });
        });
        await page.getByRole('tab', { name: 'Local', exact: true }).click();
        await expect(page.locator('.xterm-screen').first()).toBeVisible();
        const firstTerminalMs = await page.evaluate(
          () => (window as unknown as { terminalReady: Promise<number> }).terminalReady,
        );
        const cpu = (await cdp.send('Profiler.stop')).profile as {
          nodes: { id: number; callFrame: { functionName: string; url: string } }[];
          samples: number[];
          timeDeltas: number[];
        };
        const cpuTime = new Map<number, number>();
        cpu.samples.forEach((id, index) => {
          cpuTime.set(id, (cpuTime.get(id) ?? 0) + (cpu.timeDeltas[index] ?? 0));
        });
        await test.info().attach(`terminal-cpu-${run}.json`, {
          body: JSON.stringify(
            cpu.nodes
              .map((node) => ({ ...node.callFrame, microseconds: cpuTime.get(node.id) ?? 0 }))
              .sort((a, b) => b.microseconds - a.microseconds)
              .slice(0, 15),
          ),
          contentType: 'application/json',
        });
        const sessionId = await page
          .getByRole('tablist', { name: 'Local terminal tabs' })
          .getByRole('tab')
          .first()
          .getAttribute('data-tab-id');
        if (!sessionId) throw new Error('No local terminal was registered');
        const output = await page.evaluate(async (sessionId) => {
          const api = (window as unknown as { api: LunaAPI }).api;
          const start = performance.now();
          let previous = start;
          const delays: number[] = [];
          const timer = setInterval(() => {
            const now = performance.now();
            delays.push(Math.max(0, now - previous - 16));
            previous = now;
          }, 16);
          try {
            const received = await new Promise<number>((resolve, reject) => {
              let characters = 0;
              let tail = '';
              const timeout = setTimeout(() => {
                unsubscribe();
                reject(new Error(`Output profile timed out after ${characters} characters`));
              }, 20_000);
              const unsubscribe = api.localTerminal.onData((event) => {
                if (event.sessionId !== sessionId) return;
                characters += event.data.length;
                const combined = `${tail}${event.data}`;
                tail = combined.slice(-64);
                if (combined.includes('LUNA_PROFILE_DONE')) {
                  clearTimeout(timeout);
                  unsubscribe();
                  resolve(characters);
                }
              });
              const command =
                String.raw`node -e "process.stdout.write('benchmark output\n'.repeat(65536)); console.log('LUNA_PROFILE_' + 'DONE')"` +
                '\r';
              void api.localTerminal.sendData({ sessionId, data: command }).catch((error) => {
                clearTimeout(timeout);
                unsubscribe();
                reject(error);
              });
            });
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            );
            return {
              outputMs: performance.now() - start,
              outputCharacters: received,
              maxFrameDelayMs: Math.max(0, ...delays),
            };
          } finally {
            clearInterval(timer);
          }
        }, sessionId);
        const files = await page.evaluate(
          async ({ directory, largeFile }) => {
            const api = (window as unknown as { api: LunaAPI }).api;
            const lists: number[] = [];
            const reads: number[] = [];
            for (let sample = 0; sample < 3; sample++) {
              let start = performance.now();
              const entries = await api.shell.readdir(directory);
              lists.push(performance.now() - start);
              if (entries.length !== 3001) throw new Error('Incomplete directory listing');
              start = performance.now();
              const file = await api.shell.readFile(largeFile);
              reads.push(performance.now() - start);
              if (file.content.length !== 5_000_000) throw new Error('Incomplete file read');
            }
            lists.sort((a, b) => a - b);
            reads.sort((a, b) => a - b);
            return { directory3000Ms: lists[1]!, read5MBMs: reads[1]! };
          },
          { directory, largeFile },
        );
        await cdp.send('HeapProfiler.collectGarbage');
        const loadedHeapBytes = (await cdp.send('Runtime.getHeapUsage')).usedSize;
        samples.push({
          startupMs,
          firstTerminalMs,
          idleHeapBytes,
          loadedHeapBytes,
          ...output,
          ...files,
        });
      } finally {
        await closeApp(launched);
      }
    }
    const assets = await readdir('out/renderer/assets');
    const sizes: Record<string, number> = {};
    for (const name of assets.filter((name) => name.endsWith('.js')))
      sizes[name] = (await stat(join('out/renderer/assets', name))).size;
    const report = { platform: process.platform, arch: process.arch, samples, bundleBytes: sizes };
    const target = process.env.LUNA_PROFILE_OUTPUT || 'test-results/performance.json';
    await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
    await test.info().attach('performance.json', {
      body: JSON.stringify(report),
      contentType: 'application/json',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
