/** `{{ name }}` placeholders in a snippet template. Names can't contain `}`. */
const PLACEHOLDER_RE = /\{\{([^}]+)\}\}/g;

/** Distinct placeholder names in a snippet template, trimmed, in first-seen order. */
export function extractSnippetVariables(command: string): string[] {
  return Array.from(new Set(Array.from(command.matchAll(PLACEHOLDER_RE), (m) => m[1]!.trim())));
}

/**
 * Fill a snippet template's placeholders.
 *
 * One pass with a replacement *function*. The old loop built a RegExp from
 * each variable name — so `{{a(b}}` threw a SyntaxError and `{{file.name}}`
 * matched `{{fileXname}}` — and passed the value as a replacement *string*,
 * where `$&`, `$1` and `$$` are patterns: the command that ran was not the one
 * the user typed. Placeholders with no supplied value are left as-is.
 */
export function substituteSnippetVariables(
  command: string,
  values: Readonly<Record<string, string>>,
): string {
  return command.replace(PLACEHOLDER_RE, (whole, rawName: string) => {
    const name = rawName.trim();
    return Object.hasOwn(values, name) ? values[name]! : whole;
  });
}
