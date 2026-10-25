/** CliFleet 自己的显示偏好；不参与或覆盖任何 CLI/TUI 配色。 */
export const TERMINAL_FONT_SIZE_KEY = "term_font_size";
export const TERMINAL_FONT_SIZE_EVENT = "clifleet:terminal-font-size";
export const DEFAULT_TERMINAL_FONT_SIZE = 14;
export const MIN_TERMINAL_FONT_SIZE = 9;
export const MAX_TERMINAL_FONT_SIZE = 28;

export function clampTerminalFontSize(value: number): number {
  return Math.min(MAX_TERMINAL_FONT_SIZE, Math.max(MIN_TERMINAL_FONT_SIZE, Math.round(value)));
}
