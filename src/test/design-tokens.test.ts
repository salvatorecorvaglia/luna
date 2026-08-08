import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Token-coverage guard.
 *
 * Fails when renderer components leak raw color literals, raw Tailwind
 * palette classes, or hardcoded arbitrary z-index values. The point is to
 * make design-system drift impossible to ship silently: any new component
 * that bypasses the tokens in `assets/main.css` or the layers in
 * `lib/z-layers.ts` will fail this test.
 *
 * When you genuinely need an exception (terminal themes need raw hex, the
 * Windows-style close-button uses the OS-canonical red), add the file to
 * the corresponding allowlist below with a brief justification.
 */

const COMPONENTS_DIR = join(__dirname, '..', 'renderer', 'src', 'components');
const REPO_ROOT = join(__dirname, '..', '..');

/** Files where raw Tailwind palette colors are intentionally allowed. */
const COLOR_ALLOWLIST = new Set<string>([
  // Windows-style title-bar close button — OS-canonical bright red is
  // the established UX convention; the dim --color-destructive token
  // would not read as a "close window" affordance.
  'src/renderer/src/components/layout/TitleBar.tsx',
]);

/** Files where arbitrary z-[N] values are intentionally allowed. */
const Z_INDEX_ALLOWLIST = new Set<string>([
  // SettingsPanel's close button uses `relative z-[120]` for local
  // stacking inside the panel — not a global layer, so not a Z.* entry.
  'src/renderer/src/components/common/SettingsPanel.tsx',
]);

const RAW_COLOR_RE =
  /\b(?:text|bg|border|from|to|ring|fill|stroke|via|outline|caret|placeholder|accent|decoration|divide|shadow)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950)\b/;

const HEX_CLASS_RE =
  /\b(?:text|bg|border|from|to|ring|fill|stroke|via|outline|caret|placeholder|accent|decoration|divide|shadow)-\[#[0-9A-Fa-f]+(?:\/[0-9]+)?\]/;

const ARBITRARY_Z_RE = /\bz-\[[0-9]+\]/;

/**
 * `--color-destructive` is a *fill* (30.6% lightness). Using it as a text
 * color scores ~1.8:1 against --color-background — well under WCAG AA — and
 * that is exactly what ~30 call sites did, including the host-key dialog's
 * MITM warning. `text-destructive-fg` is the ink counterpart.
 *
 * Matches bare `text-destructive` (optionally with an opacity modifier) but
 * not the two legitimate suffixed tokens: `text-destructive-fg` (the ink) and
 * `text-destructive-foreground` (the on-fill pair).
 */
const DESTRUCTIVE_INK_RE = /\btext-destructive(?![-\w])/;

/**
 * Renderer code must reach IPC through `getApi()` (services/api.ts), never the
 * `window.api` global. The seam exists so component tests can inject a fake
 * without mutating a global; it previously eroded to 1-of-138 adoption because
 * nothing enforced it.
 */
const WINDOW_API_RE = /\bwindow\.api\b/;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      yield* walk(full);
    } else if (/\.(tsx|ts)$/.test(entry) && !/\.test\.(tsx|ts)$/.test(entry)) {
      yield full;
    }
  }
}

interface Violation {
  file: string;
  line: number;
  rule: string;
  match: string;
}

function scan(file: string): Violation[] {
  const relPath = relative(REPO_ROOT, file);
  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n');
  const out: Violation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comment-only lines so historical notes / commit references
    // mentioning a hex value don't trigger the guard.
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue;

    if (!COLOR_ALLOWLIST.has(relPath)) {
      const m = RAW_COLOR_RE.exec(line);
      if (m) out.push({ file: relPath, line: i + 1, rule: 'raw-tailwind-color', match: m[0] });
    }
    const hex = HEX_CLASS_RE.exec(line);
    if (hex) out.push({ file: relPath, line: i + 1, rule: 'hex-class-literal', match: hex[0] });

    if (!Z_INDEX_ALLOWLIST.has(relPath)) {
      const z = ARBITRARY_Z_RE.exec(line);
      if (z) out.push({ file: relPath, line: i + 1, rule: 'arbitrary-z-index', match: z[0] });
    }

    const ink = DESTRUCTIVE_INK_RE.exec(line);
    if (ink)
      out.push({ file: relPath, line: i + 1, rule: 'destructive-fill-as-ink', match: ink[0] });

    const globalApi = WINDOW_API_RE.exec(line);
    if (globalApi)
      out.push({ file: relPath, line: i + 1, rule: 'window-api-global', match: globalApi[0] });
  }
  return out;
}

describe('design-token coverage', () => {
  const allViolations: Violation[] = [];
  for (const file of walk(COMPONENTS_DIR)) {
    allViolations.push(...scan(file));
  }

  it('renderer components use design tokens instead of raw Tailwind colors', () => {
    const offenders = allViolations.filter((v) => v.rule === 'raw-tailwind-color');
    if (offenders.length > 0) {
      const report = offenders
        .map(
          (v) =>
            `  ${v.file}:${v.line}  ${v.match} — use a token (text-success/text-warning/text-destructive/text-info/text-brand-*).`,
        )
        .join('\n');
      throw new Error(
        `Raw Tailwind palette classes leaked into components. Replace with semantic tokens from assets/main.css, or add the file to COLOR_ALLOWLIST in this test with a justification.\n${report}`,
      );
    }
    expect(offenders).toHaveLength(0);
  });

  it('renderer components do not embed hex literals in className utilities', () => {
    const offenders = allViolations.filter((v) => v.rule === 'hex-class-literal');
    if (offenders.length > 0) {
      const report = offenders.map((v) => `  ${v.file}:${v.line}  ${v.match}`).join('\n');
      throw new Error(
        `Hex-literal arbitrary classes leaked into components. Add a token in assets/main.css and reference it instead.\n${report}`,
      );
    }
    expect(offenders).toHaveLength(0);
  });

  it('renderer components use text-destructive-fg for destructive text', () => {
    const offenders = allViolations.filter((v) => v.rule === 'destructive-fill-as-ink');
    if (offenders.length > 0) {
      const report = offenders
        .map((v) => `  ${v.file}:${v.line}  ${v.match} — use text-destructive-fg.`)
        .join('\n');
      throw new Error(
        `--color-destructive is a surface fill and fails WCAG AA as a text color (~1.8:1 on the app background). Use text-destructive-fg for text; keep bg-destructive/border-destructive for fills.\n${report}`,
      );
    }
    expect(offenders).toHaveLength(0);
  });

  it('renderer components reach IPC through the getApi() seam', () => {
    const offenders = allViolations.filter((v) => v.rule === 'window-api-global');
    if (offenders.length > 0) {
      const report = offenders
        .map((v) => `  ${v.file}:${v.line}  ${v.match} — import { getApi } from '@/services/api'.`)
        .join('\n');
      throw new Error(
        `The window.api global leaked back into components. Call getApi() instead so tests can inject a fake without mutating globals.\n${report}`,
      );
    }
    expect(offenders).toHaveLength(0);
  });

  /**
   * A component that installs a focus trap is, by definition, a modal: it is
   * deliberately holding keyboard focus against the rest of the page. Assistive
   * technology only learns that from `role="dialog"` + `aria-modal="true"`, and
   * only gets a usable name from `aria-labelledby`.
   *
   * Seven of the fourteen trap-installing dialogs declared none of it, so a
   * screen reader announced an unlabelled `<div>` while the user's keyboard was
   * confined to it. Biome's a11y ruleset — which would have flagged this — is
   * largely disabled in biome.json, so this guard is what holds the line.
   */
  it('every focus-trapping dialog declares its modal role and an accessible name', () => {
    const offenders: string[] = [];
    for (const file of walk(COMPONENTS_DIR)) {
      const source = readFileSync(file, 'utf8');
      if (!source.includes('attachFocusTrap')) continue;

      const relPath = relative(REPO_ROOT, file);
      const missing: string[] = [];
      // `alertdialog` is the correct role for a modal that interrupts with an
      // important message — the host-key MITM warning and the terminal error
      // overlay both use it deliberately.
      if (!/role="(?:dialog|alertdialog)"/.test(source)) {
        missing.push('role="dialog" (or "alertdialog")');
      }
      if (!/aria-modal="true"/.test(source)) missing.push('aria-modal="true"');
      if (!/aria-labelledby=/.test(source) && !/aria-label=/.test(source)) {
        missing.push('aria-labelledby (or aria-label)');
      }
      if (missing.length > 0) offenders.push(`  ${relPath} — missing ${missing.join(', ')}`);
    }

    if (offenders.length > 0) {
      throw new Error(
        `Focus-trapping dialogs must be announced as modals. Add role="dialog" aria-modal="true" and point aria-labelledby at the dialog's heading id.\n${offenders.join('\n')}`,
      );
    }
    expect(offenders).toHaveLength(0);
  });

  it('renderer components use Z.* constants instead of hardcoded z-[N]', () => {
    const offenders = allViolations.filter((v) => v.rule === 'arbitrary-z-index');
    if (offenders.length > 0) {
      const report = offenders
        .map((v) => `  ${v.file}:${v.line}  ${v.match} — import Z from '@/lib/z-layers'.`)
        .join('\n');
      throw new Error(
        `Arbitrary z-index leaked into components. Use a Z.* constant from lib/z-layers.ts (or add a new layer there) instead.\n${report}`,
      );
    }
    expect(offenders).toHaveLength(0);
  });
});
