import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
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

const COMPONENTS_DIR = join(__dirname, '..', '..', 'src', 'renderer', 'src', 'components');
const REPO_ROOT = join(__dirname, '..', '..');

/** Normalise forward-slash paths to the OS separator so allowlist matching works on Windows. */
function normPath(p: string): string {
  return p.split('/').join(sep);
}

/** Files where raw Tailwind palette colors are intentionally allowed. */
const COLOR_ALLOWLIST = new Set<string>([
  // Windows-style title-bar close button — OS-canonical bright red is
  // the established UX convention; the dim --color-destructive token
  // would not read as a "close window" affordance.
  normPath('src/renderer/src/components/layout/TitleBar.tsx'),
]);

/**
 * Files allowed to reference the raw `btn-icon` class.
 *
 * `IconButton` is the primitive that applies it — and, by requiring
 * `aria-label` at the type level, the reason none of the app's icon-only
 * buttons can ship silent again. It had zero consumers while twenty raw
 * `btn-icon` call sites remained, seven of which (the terminal toolbar) were
 * genuinely unlabelled.
 */
const BTN_ICON_ALLOWLIST = new Set<string>([
  normPath('src/renderer/src/components/ui/IconButton.tsx'),
]);

/**
 * Files allowed to install a focus trap directly instead of rendering through
 * `DialogShell`.
 *
 * DialogShell owns overlay, animation, stacking layer, focus trap and
 * Escape-to-close. Three dialogs each rebuilt that chrome and drifted apart —
 * two corner radii, two shadows, two title scales — before they were migrated.
 */
const FOCUS_TRAP_ALLOWLIST = new Set<string>([
  // The primitive itself.
  normPath('src/renderer/src/components/common/DialogShell.tsx'),
  // Top-aligned combobox with its own sizing and keyboard model; not a
  // centered card, so DialogShell's layouts don't express it.
  normPath('src/renderer/src/components/command-palette/CommandPalette.tsx'),
  // Not a portal dialog: an in-pane overlay covering a single terminal.
  normPath('src/renderer/src/components/terminal/TerminalPane.tsx'),
]);

/** Files where arbitrary z-[N] values are intentionally allowed. */
const Z_INDEX_ALLOWLIST = new Set<string>([
  // SettingsPanel's close button uses `relative z-[120]` for local
  // stacking inside the panel — not a global layer, so not a Z.* entry.
  normPath('src/renderer/src/components/common/SettingsPanel.tsx'),
]);

const RAW_COLOR_RE =
  /\b(?:text|bg|border|from|to|ring|fill|stroke|via|outline|caret|placeholder|accent|decoration|divide|shadow)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950)\b/;

const HEX_CLASS_RE =
  /\b(?:text|bg|border|from|to|ring|fill|stroke|via|outline|caret|placeholder|accent|decoration|divide|shadow)-\[#[0-9A-Fa-f]+(?:\/[0-9]+)?\]/;

const ARBITRARY_Z_RE = /\bz-\[[0-9]+\]/;

const RAW_BTN_ICON_RE = /\bbtn-icon\b/;

const FOCUS_TRAP_RE = /\battachFocusTrap\b/;

/**
 * `MOD_KEY` in lib/platform.ts is the single source for the chord modifier
 * symbol. It had no consumers while three components each re-derived it.
 */
const MOD_REDERIVE_RE = /isMac\s*\?\s*['\u2018\u201c]\u2318/;

/**
 * `lib/platform.ts` exists solely to centralise platform detection ("three
 * components each rolled their own"). Two of them still sniffed the user-agent
 * inline afterwards.
 */
const NAVIGATOR_PLATFORM_RE = /\bnavigator\.(?:userAgent|platform)\b/;

/**
 * Arbitrary pixel font sizes, e.g. `text-[11px]`.
 *
 * Tailwind's scale stops at text-xs (12px), so dense chrome reached for
 * arbitrary values instead — 101 of them across the renderer before this rule,
 * none checkable and none adjustable in one place. `--text-2xs` (11px),
 * `--text-3xs` (10px) and `--text-sm-plus` (13px) now cover those in
 * assets/main.css; anything else needs a new token rather than a literal.
 */
const ARBITRARY_TEXT_SIZE_RE = /\btext-\[\d+(?:\.\d+)?(?:px|rem|em)\]/;

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
    // Non-null: i < lines.length is the loop invariant.
    const line = lines[i]!;
    // Skip comment-only lines so historical notes / commit references
    // mentioning a hex value don't trigger the guard.
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue;

    if (!COLOR_ALLOWLIST.has(relPath)) {
      const m = RAW_COLOR_RE.exec(line);
      if (m) out.push({ file: relPath, line: i + 1, rule: 'raw-tailwind-color', match: m[0] });
    }
    const hex = HEX_CLASS_RE.exec(line);
    if (hex) out.push({ file: relPath, line: i + 1, rule: 'hex-class-literal', match: hex[0] });

    if (!BTN_ICON_ALLOWLIST.has(relPath)) {
      const icon = RAW_BTN_ICON_RE.exec(line);
      if (icon) out.push({ file: relPath, line: i + 1, rule: 'raw-btn-icon', match: icon[0] });
    }

    if (!FOCUS_TRAP_ALLOWLIST.has(relPath)) {
      const trap = FOCUS_TRAP_RE.exec(line);
      if (trap)
        out.push({ file: relPath, line: i + 1, rule: 'hand-rolled-dialog', match: trap[0] });
    }

    const modKey = MOD_REDERIVE_RE.exec(line);
    if (modKey)
      out.push({ file: relPath, line: i + 1, rule: 'mod-key-rederived', match: modKey[0] });

    const navPlatform = NAVIGATOR_PLATFORM_RE.exec(line);
    if (navPlatform)
      out.push({ file: relPath, line: i + 1, rule: 'platform-sniff', match: navPlatform[0] });

    if (!Z_INDEX_ALLOWLIST.has(relPath)) {
      const z = ARBITRARY_Z_RE.exec(line);
      if (z) out.push({ file: relPath, line: i + 1, rule: 'arbitrary-z-index', match: z[0] });
    }

    const textSize = ARBITRARY_TEXT_SIZE_RE.exec(line);
    if (textSize)
      out.push({ file: relPath, line: i + 1, rule: 'arbitrary-text-size', match: textSize[0] });

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

  it('renderer components use type tokens instead of arbitrary pixel font sizes', () => {
    const offenders = allViolations.filter((v) => v.rule === 'arbitrary-text-size');
    if (offenders.length > 0) {
      const report = offenders.map((v) => `  ${v.file}:${v.line}  ${v.match}`).join('\n');
      throw new Error(
        `Arbitrary font sizes leaked into components. Use text-3xs (10px), text-2xs (11px), text-xs, text-sm-plus (13px) or the standard Tailwind scale — or add a new token in assets/main.css.\n${report}`,
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

  it('icon-only buttons go through IconButton, not the raw btn-icon class', () => {
    const offenders = allViolations.filter((v) => v.rule === 'raw-btn-icon');
    if (offenders.length > 0) {
      const report = offenders
        .map((v) => `  ${v.file}:${v.line}  ${v.match} — use <IconButton> from '@/components/ui'.`)
        .join('\n');
      throw new Error(
        `Raw btn-icon usage leaked back into components. IconButton applies the class and requires an aria-label at the type level, which is what keeps icon-only controls from shipping silent to screen readers.\n${report}`,
      );
    }
    expect(offenders).toHaveLength(0);
  });

  it('modal dialogs render through DialogShell rather than trapping focus themselves', () => {
    const offenders = allViolations.filter((v) => v.rule === 'hand-rolled-dialog');
    if (offenders.length > 0) {
      const report = offenders
        .map((v) => `  ${v.file}:${v.line}  ${v.match} — render through <DialogShell> instead.`)
        .join('\n');
      throw new Error(
        `A component installed its own focus trap. DialogShell owns the overlay, animation, stacking layer, focus trap and Escape handling; hand-rolling them is how the app ended up with three different dialog radii and title scales. If this genuinely is not a centered/sheet dialog, add it to FOCUS_TRAP_ALLOWLIST with a justification.\n${report}`,
      );
    }
    expect(offenders).toHaveLength(0);
  });

  it('components use MOD_KEY and lib/platform instead of re-deriving the platform', () => {
    const offenders = allViolations.filter(
      (v) => v.rule === 'mod-key-rederived' || v.rule === 'platform-sniff',
    );
    if (offenders.length > 0) {
      const report = offenders
        .map((v) => `  ${v.file}:${v.line}  ${v.match} — import from '@/lib/platform'.`)
        .join('\n');
      throw new Error(
        `Platform detection was re-implemented in a component. lib/platform.ts exports isMac, isLinux and MOD_KEY precisely so there is one place to change.\n${report}`,
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
