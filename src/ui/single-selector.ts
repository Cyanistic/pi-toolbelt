/**
 * In-place single-select body for backend/model pickers.
 *
 * Pattern adapted from @aliou/pi-utils-settings 0.17.0 selector interactions
 * and the validated Toolbelt settings prototype. Owner component owns
 * Enter/Escape; this helper renders body lines and tracks selection index.
 * Optional search filters the option list in place.
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

export interface SingleSelectOption {
  id: string;
  label: string;
  description?: string;
}

function fit(line: string, width: number): string {
  return truncateToWidth(line, Math.max(1, width), "", true);
}

export interface SingleSelectorOptions {
  searchable?: boolean;
  maxVisible?: number;
}

/** Body-only single selector. Enter/Escape handled by the owner. */
export class SingleSelector implements Component {
  private selectedIndex: number;
  private filtered: SingleSelectOption[];
  private readonly input: Input | undefined;
  private readonly maxVisible: number;
  private readonly searchable: boolean;

  constructor(
    private readonly heading: string,
    private readonly subtitle: string,
    private readonly options: readonly SingleSelectOption[],
    private readonly theme: SettingsTheme,
    selectedIndex = 0,
    opts: SingleSelectorOptions = {},
  ) {
    this.searchable = opts.searchable === true;
    this.maxVisible = opts.maxVisible ?? 12;
    this.input = this.searchable ? new Input() : undefined;
    this.filtered = [...options];
    this.selectedIndex = Math.max(
      0,
      Math.min(selectedIndex, Math.max(0, options.length - 1)),
    );
    // Keep selection pointing at the same option id after construct.
    const initial = options[this.selectedIndex];
    if (initial) {
      const idx = this.filtered.findIndex((o) => o.id === initial.id);
      this.selectedIndex = idx >= 0 ? idx : 0;
    }
  }

  get selected(): SingleSelectOption | undefined {
    return this.filtered[this.selectedIndex];
  }

  move(delta: -1 | 1): void {
    if (this.filtered.length === 0) return;
    if (delta < 0) {
      this.selectedIndex =
        this.selectedIndex === 0
          ? this.filtered.length - 1
          : this.selectedIndex - 1;
      return;
    }
    this.selectedIndex =
      this.selectedIndex === this.filtered.length - 1
        ? 0
        : this.selectedIndex + 1;
  }

  /** Forward non-navigation keys when searchable (filter typing). */
  handleInput(data: string): void {
    if (!this.searchable || this.input === undefined) return;
    if (
      matchesKey(data, Key.up) ||
      matchesKey(data, Key.down) ||
      matchesKey(data, Key.enter) ||
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.space)
    ) {
      return;
    }
    this.input.handleInput(data);
    this.applyFilter();
  }

  invalidate(): void {}

  render(width: number): string[] {
    const lines: string[] = [];
    lines.push(
      fit(this.theme.fg("accent", this.theme.bold(this.heading)), width),
    );
    if (this.subtitle.length > 0) {
      lines.push(fit(this.theme.fg("muted", this.subtitle), width));
    }
    lines.push("");

    if (this.searchable && this.input) {
      lines.push(this.theme.hint("Search:"));
      lines.push(...this.input.render(width));
      lines.push("");
    }

    if (this.filtered.length === 0) {
      lines.push(fit(this.theme.hint("  (no options)"), width));
      return lines;
    }

    const start = Math.max(
      0,
      Math.min(
        this.selectedIndex - Math.floor(this.maxVisible / 2),
        Math.max(0, this.filtered.length - this.maxVisible),
      ),
    );
    const end = Math.min(start + this.maxVisible, this.filtered.length);
    for (let i = start; i < end; i++) {
      const opt = this.filtered[i];
      if (opt === undefined) continue;
      const sel = i === this.selectedIndex;
      const cursor = sel ? this.theme.fg("accent", ">") : " ";
      const label = sel
        ? this.theme.fg("accent", this.theme.bold(opt.label))
        : this.theme.fg("text", opt.label);
      lines.push(fit(`${cursor} ${label}`, width));
      if (opt.description !== undefined && opt.description.length > 0) {
        lines.push(
          fit(`    ${this.theme.fg("muted", opt.description)}`, width),
        );
      }
    }
    if (this.filtered.length > this.maxVisible) {
      lines.push(
        fit(
          this.theme.hint(
            `  (${this.selectedIndex + 1}/${this.filtered.length})`,
          ),
          width,
        ),
      );
    }
    return lines;
  }

  private applyFilter(): void {
    if (!this.input) return;
    const q = this.input.getValue();
    this.filtered =
      q.trim() === ""
        ? [...this.options]
        : fuzzyFilter(
            [...this.options],
            q,
            (o) => `${o.label} ${o.description ?? ""}`,
          );
    this.selectedIndex = Math.min(
      this.selectedIndex,
      Math.max(0, this.filtered.length - 1),
    );
  }
}
