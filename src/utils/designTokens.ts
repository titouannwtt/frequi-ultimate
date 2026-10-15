/** Fallback stack for chart text when the self-hosted font is not loaded (section 6.2). */
export const CHART_FONT_FALLBACK = 'ui-monospace, monospace';

/**
 * Read a design token (a CSS custom property) from the computed style, for code that cannot use
 * `var()` such as ECharts options. Returns `fallback` when the token is not defined.
 */
export function readCssToken(
  name: string,
  fallback = '',
  el: Element = document.documentElement,
): string {
  const value = getComputedStyle(el).getPropertyValue(name.startsWith('--') ? name : `--${name}`);
  return value.trim() || fallback;
}
