/**
 * Searchable multi-select body (baseline tool picker).
 *
 * Pattern adapted from @aliou/pi-utils-settings 0.17.0 FuzzyMultiSelector
 * and the validated Toolbelt settings prototype BaselineMultiSelect:
 * Space toggle, ^A all, ^X clear, filter, arbitrary exact-name add when the
 * query is non-empty and has no exact match. Owner owns Enter/Escape.
 *
 * MIT License - Copyright (c) 2025 Aliou Badiane
 * https://github.com/aliou/pi-utils-settings
 */

import type { Component } from "@earendil-works/pi-tui";
import {
  fuzzyFilter,
  Input,
  Key,
  matchesKey,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import type { SettingsTheme } from "./settings-theme.js";

export interface MultiSelectItem {
  id: string;
  label: string;
  checked: boolean;
  description?: string;
  /** Extra badge, e.g. "unavailable". */
  badge?: string;
}

function fit(line: string, width: number): string {
  return truncateToWidth(line, Math.max(1, width), "", true);
}

/** Body-only fuzzy multi-select. Enter/Escape handled by the owner. */
export class FuzzyMultiSelector implements Component {
  private items: MultiSelectItem[];
  private filtered: MultiSelectItem[];
  private selectedIndex = 0;
  private readonly input = new Input();
  private readonly maxVisible: number;

  constructor(
    private readonly heading: string,
    items: MultiSelectItem[],
    private readonly theme: SettingsTheme,
    maxVisible = 10,
  ) {
    this.items = items.map((item) => ({ ...item }));
    this.filtered = [...this.items];
    this.maxVisible = maxVisible;
  }

  getCheckedIds(): string[] {
    return this.items.filter((i) => i.checked).map((i) => i.id);
  }

  getFilterQuery(): string {
    return this.input.getValue();
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      if (this.filtered.length === 0) return;
      this.selectedIndex =
        this.selectedIndex === 0
          ? this.filtered.length - 1
          : this.selectedIndex - 1;
      return;
    }
    if (matchesKey(data, Key.down)) {
      if (this.filtered.length === 0) return;
      this.selectedIndex =
        this.selectedIndex === this.filtered.length - 1
          ? 0
          : this.selectedIndex + 1;
      return;
    }
    if (matchesKey(data, Key.space)) {
      const item = this.filtered[this.selectedIndex];
      if (!item) return;
      if (item.id.startsWith("__add__:")) {
        this.addCustomFromQuery();
        return;
      }
      item.checked = !item.checked;
      return;
    }
    if (matchesKey(data, Key.ctrl("a"))) {
      for (const item of this.filtered) {
        if (!item.id.startsWith("__add__:")) item.checked = true;
      }
      return;
    }
    if (matchesKey(data, Key.ctrl("x"))) {
      for (const item of this.filtered) {
        if (!item.id.startsWith("__add__:")) item.checked = false;
      }
      return;
    }
    this.input.handleInput(data);
    this.applyFilter();
  }

  /** Confirm path: if the synthetic add row is selected, add then return checks. */
  confirmSelection(): string[] {
    const item = this.filtered[this.selectedIndex];
    if (item?.id.startsWith("__add__:")) {
      this.addCustomFromQuery();
    }
    return this.getCheckedIds();
  }

  render(width: number): string[] {
    return this.renderBody(width);
  }

  private addCustomFromQuery(): void {
    const q = this.input.getValue().trim();
    if (q.length === 0) return;
    const existing = this.items.find((i) => i.id === q);
    if (existing) {
      existing.checked = true;
    } else {
      this.items.push({
        id: q,
        label: q,
        checked: true,
        description: "custom name",
      });
    }
    this.input.setValue("");
    this.applyFilter();
    const idx = this.filtered.findIndex((i) => i.id === q);
    if (idx >= 0) this.selectedIndex = idx;
  }

  private applyFilter(): void {
    const q = this.input.getValue();
    const trimmed = q.trim();
    this.filtered =
      trimmed === ""
        ? [...this.items]
        : fuzzyFilter(
            this.items,
            q,
            (i) => `${i.label} ${i.description ?? ""} ${i.badge ?? ""}`,
          );

    // Offer exact-name add when query non-empty and no exact id match.
    if (trimmed.length > 0) {
      const exact = this.items.some((i) => i.id === trimmed);
      if (!exact) {
        this.filtered = [
          ...this.filtered,
          {
            id: `__add__:${trimmed}`,
            label: `Add "${trimmed}"`,
            checked: false,
            description: "custom tool name",
          },
        ];
      }
    }

    this.selectedIndex = Math.min(
      this.selectedIndex,
      Math.max(0, this.filtered.length - 1),
    );
  }

  private renderBody(width: number): string[] {
    const lines: string[] = [];
    lines.push(
      fit(this.theme.fg("accent", this.theme.bold(this.heading)), width),
    );
    lines.push("");
    lines.push(this.theme.hint("Search:"));
    lines.push(...this.input.render(width));
    lines.push("");
    const n = this.items.filter((i) => i.checked).length;
    lines.push(this.theme.hint(`  ${n} selected`));
    lines.push("");

    if (this.filtered.length === 0) {
      lines.push(this.theme.hint("  (no matches)"));
    } else {
      const start = Math.max(
        0,
        Math.min(
          this.selectedIndex - Math.floor(this.maxVisible / 2),
          Math.max(0, this.filtered.length - this.maxVisible),
        ),
      );
      const end = Math.min(start + this.maxVisible, this.filtered.length);
      for (let i = start; i < end; i++) {
        const item = this.filtered[i];
        if (item === undefined) continue;
        const sel = i === this.selectedIndex;
        const prefix = sel ? this.theme.cursor : "  ";
        const isAdd = item.id.startsWith("__add__:");
        const box = isAdd ? "[+]" : item.checked ? "[x]" : "[ ]";
        const badge =
          item.badge !== undefined && item.badge.length > 0
            ? ` (${item.badge})`
            : "";
        const text = `${box} ${item.label}${badge}`;
        const styled = sel
          ? this.theme.value(truncateToWidth(text, width - 4, ""), true)
          : this.theme.value(truncateToWidth(text, width - 4, ""), false);
        lines.push(fit(prefix + styled, width));
      }
      if (this.filtered.length > this.maxVisible) {
        lines.push(
          this.theme.hint(
            `  (${this.selectedIndex + 1}/${this.filtered.length})`,
          ),
        );
      }
    }

    lines.push("");
    lines.push(
      this.theme.hint(
        "  Space toggle · ^A all · ^X clear · Enter confirm · Esc cancel",
      ),
    );
    return lines;
  }
}
