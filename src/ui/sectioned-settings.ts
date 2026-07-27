/**
 * Section headers and setting rows with effective-source labels.
 *
 * Pattern adapted from @aliou/pi-utils-settings 0.17.0 settings list chrome
 * and the validated Toolbelt settings prototype (Scope Focus layout).
 *
 * MIT License - Copyright (c) 2025 Aliou Badiane
 * https://github.com/aliou/pi-utils-settings
 */

import { truncateToWidth } from "@earendil-works/pi-tui";
import type { SettingsTheme } from "./settings-theme.js";

export type ValueSourceLabel = "Default" | "Global" | "Project" | "Action";

export interface SettingsRow {
  id: string;
  label: string;
  /** Primary value text (already plain; styling applied here). */
  value: string;
  /** Effective source badge, when applicable. */
  source?: ValueSourceLabel;
  /** Dim secondary note, e.g. inherited annotation. */
  note?: string;
}

export interface SettingsSection {
  title: string;
  rows: SettingsRow[];
}

function fit(line: string, width: number): string {
  return truncateToWidth(line, Math.max(1, width), "", true);
}

function sourceColor(theme: SettingsTheme, source: ValueSourceLabel): string {
  if (source === "Project") return theme.fg("accent", `[${source}]`);
  if (source === "Global") return theme.fg("success", `[${source}]`);
  if (source === "Action") return theme.fg("dim", `[${source}]`);
  return theme.fg("dim", `[${source}]`);
}

/** Flatten sections into a stable navigable row list. */
export function flattenSettingsRows(
  sections: readonly SettingsSection[],
): SettingsRow[] {
  const rows: SettingsRow[] = [];
  for (const section of sections) {
    for (const row of section.rows) rows.push(row);
  }
  return rows;
}

/**
 * Render sectioned settings with a single selected index across all rows.
 * Returns body lines only (no tabs/footer).
 */
export function renderSectionedSettings(
  theme: SettingsTheme,
  sections: readonly SettingsSection[],
  selectedIndex: number,
  width: number,
): string[] {
  const lines: string[] = [];
  let index = 0;

  for (const section of sections) {
    if (section.rows.length === 0) continue;
    lines.push(fit(theme.fg("dim", section.title), width));
    for (const row of section.rows) {
      const sel = index === selectedIndex;
      const cursor = sel ? theme.fg("accent", ">") : " ";
      const label = sel
        ? theme.fg("accent", theme.bold(row.label.padEnd(14)))
        : theme.fg("text", row.label.padEnd(14));
      const value = sel
        ? theme.fg("accent", row.value)
        : theme.fg("text", row.value);
      const note =
        row.note !== undefined && row.note.length > 0
          ? theme.fg("dim", `  ${row.note}`)
          : "";
      lines.push(fit(`${cursor} ${label}  ${value}${note}`, width));
      if (row.source !== undefined) {
        lines.push(fit(`    source ${sourceColor(theme, row.source)}`, width));
      }
      index += 1;
    }
    lines.push("");
  }

  // Drop trailing blank from last section.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
