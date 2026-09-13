import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Z } from '../../src/renderer/src/lib/z-layers';

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

/**
 * Tailwind's *scale* z-utilities, which this guard used to miss entirely: it
 * only matched bracketed `z-[N]`. Six plain `z-10`/`z-20`/`z-30` utilities were
 * live across four components as a result, and they were mutually inconsistent
 * — the terminal's hover action bar (z-30) painted over the disconnect overlay
 * (z-20) it was supposed to sit beneath. Layer order belongs in z-layers.ts
 * whichever spelling is used.
 */
const PLAIN_Z_RE = /\bz-(?:0|10|20|30|40|50|auto)\b/;

/** Files where a bare z-utility is local stacking, not app layering. */
const PLAIN_Z_ALLOWLIST = new Set<string>([
  // `relative z-10` lifts the tooltip's text above its own background layer
  // inside the same component. Not a participant in app-level stacking.
  normPath('src/renderer/src/components/common/HelpTooltip.tsx'),
]);

const RAW_BTN_ICON_RE = /\bbtn-icon\b/;

/**
 * The four button *variant* classes, which must come from <Button> rather than
 * being applied by hand — the same rule `btn-icon` already has for IconButton.
 *
 * Button existed with **zero consumers** while 22 call sites applied these
 * classes directly, which is exactly the state the btn-icon guard was added to
 * fix ("It had zero consumers while twenty raw btn-icon call sites remained").
 * The cost was not cosmetic: Button is where the loading affordance lives —
 * spinner beside the label, label text unchanged so the width does not shift,
 * aria-busy set — and with nobody using it, three dialogs hand-rolled their own
 * busy state and the rest simply had none.
 *
 * This deliberately does not police every raw <button> in the codebase. A
 * terminal tab, a file row, a roving-tabindex option and a toggle are all
 * legitimately buttons that are not design-system *buttons*, and forcing them
 * onto a variant class would be wrong.
 */
const RAW_BTN_VARIANT_RE = /\bbtn-(?:primary|outline|ghost|destructive)\b/;

/** Only the primitive itself may name the variant classes. */
const BTN_VARIANT_ALLOWLIST = new Set<string>([
  normPath('src/renderer/src/components/ui/Button.tsx'),
]);

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

    if (!BTN_VARIANT_ALLOWLIST.has(relPath)) {
      const variant = RAW_BTN_VARIANT_RE.exec(line);
      if (variant)
        out.push({ file: relPath, line: i + 1, rule: 'raw-btn-variant', match: variant[0] });
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

    if (!PLAIN_Z_ALLOWLIST.has(relPath)) {
      const plainZ = PLAIN_Z_RE.exec(line);
      if (plainZ) out.push({ file: relPath, line: i + 1, rule: 'plain-z-index', match: plainZ[0] });
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
      const relPath = relative(REPO_ROOT, file);

      // A file that renders through DialogShell inherits role and aria-modal
      // from the primitive; it only has to supply the name. Checked separately
      // from the `attachFocusTrap` case so a component can migrate to the
      // primitive without tripping a rule about markup it no longer owns.
      const usesDialogShell = /<DialogShell\b/.test(source);
      // Matched as a call, not as a bare word: the substring check this used to
      // do also matched the identifier inside a comment, so documenting the
      // guard in a component was enough to trip it.
      const trapsFocusItself = /\battachFocusTrap\s*\(/.test(source);

      if (!usesDialogShell && !trapsFocusItself) continue;

      const missing: string[] = [];
      if (usesDialogShell) {
        if (!/ariaLabelledBy=/.test(source) && !/aria-label=/.test(source)) {
          missing.push('ariaLabelledBy (or aria-label)');
        }
      } else {
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

  it('layer order comes from z-layers.ts, in either Tailwind spelling', () => {
    const offenders = allViolations.filter((v) => v.rule === 'plain-z-index');
    if (offenders.length > 0) {
      const report = offenders
        .map((v) => `  ${v.file}:${v.line}  ${v.match} — use a Z.* token from '@/lib/z-layers'.`)
        .join('\n');
      throw new Error(
        `Bare Tailwind z-utilities bypass the layer table. They are how the terminal action bar (z-30) ended up painting over the disconnect alertdialog (z-20).\n${report}`,
      );
    }
    expect(offenders).toHaveLength(0);
  });

  it('assigns every layer token a distinct value', () => {
    // hostKeyDialog and tooltipOverlay were both z-[100], so whether a help
    // tooltip could cover a host-key MITM warning came down to DOM order.
    const byValue = new Map<string, string[]>();
    for (const [name, value] of Object.entries(Z)) {
      byValue.set(value, [...(byValue.get(value) ?? []), name]);
    }
    const collisions = [...byValue.entries()]
      .filter(([, names]) => names.length > 1)
      .map(([value, names]) => `  ${value} shared by ${names.join(', ')}`);

    if (collisions.length > 0) {
      throw new Error(
        `Two layers with the same z-index leave their relative order to DOM order, which is exactly what a layer table exists to decide.\n${collisions.join('\n')}`,
      );
    }
    expect(collisions).toHaveLength(0);
  });

  /**
   * The gap that let FilePreview ship as a modal with no role, no aria-modal and
   * no focus trap: both dialog guards keyed off a marker it lacked. The
   * modal-role check only looks at files containing `attachFocusTrap`, and the
   * hand-rolled-dialog check looks for the same string — so a component that
   * simply rendered its own full-screen overlay and trapped nothing was invisible
   * to both.
   */
  it('full-screen overlays render through DialogShell', () => {
    const offenders: string[] = [];
    for (const file of walk(COMPONENTS_DIR)) {
      const relPath = relative(REPO_ROOT, file);
      if (FOCUS_TRAP_ALLOWLIST.has(normPath(relPath))) continue;

      const source = readFileSync(file, 'utf8');
      // A fixed, inset overlay carrying an app-level layer token is a modal,
      // whatever it calls itself.
      const hasFixedOverlay = /fixed inset-(?:0|2|x-0|y-0)\b/.test(source);
      const hasModalLayer =
        /\$\{Z\.(?:modal|panel|confirm|hostKeyDialog)\}|Z\.(?:modal|panel|confirm|hostKeyDialog)\b/.test(
          source,
        );
      if (!hasFixedOverlay || !hasModalLayer) continue;
      if (source.includes('DialogShell')) continue;

      offenders.push(
        `  ${relPath} — full-screen overlay at a modal layer, but does not render through DialogShell`,
      );
    }

    if (offenders.length > 0) {
      throw new Error(
        `A modal that opts out of DialogShell also opts out of role="dialog", aria-modal and the focus trap — and out of the guards above, which key off DialogShell/attachFocusTrap.\n${offenders.join('\n')}`,
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

  it('button variants go through Button, not the raw btn-* classes', () => {
    const offenders = allViolations.filter((v) => v.rule === 'raw-btn-variant');
    if (offenders.length > 0) {
      const report = offenders
        .map(
          (v) =>
            `  ${v.file}:${v.line}  ${v.match} — use <Button variant="…"> from '@/components/ui'.`,
        )
        .join('\n');
      throw new Error(
        `Raw button-variant classes bypass the Button primitive, which is where the loading affordance (spinner + aria-busy + stable label width) lives. Button previously had zero consumers while 22 call sites applied these classes by hand.\n${report}`,
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
