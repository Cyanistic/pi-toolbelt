/**
 * Shared non-overlay frame for Toolbelt Settings and Tools Manager.
 *
 * Pattern adapted from @aliou/pi-utils-settings 0.17.0 / @aliou/pi-utils-ui
 * panel chrome and the validated Toolbelt settings prototype (scope tabs,
 * status line, context-sensitive footer). Reuses the attributed local Panel.
 *
 * MIT License - Copyright (c) 2025 Aliou Badiane
 * https://github.com/aliou/pi-utils-settings
 * https://github.com/aliou/pi-utils-ui
 */

import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Panel } from "../panel.js";
import type { SettingsTheme } from "./settings-theme.js";

export type FrameTabMode =
  | {
      kind: "scopes";
      active: "global" | "project";
      globalDirty: boolean;
      projectDirty: boolean;
    }
  | { kind: "session" };

export interface ToolbeltFrameOptions {
  title: string;
  theme: SettingsTheme;
  tabs: FrameTabMode;
  /** Body lines already width-fitted by the caller. */
  body: Component;
  status?: string;
  footer: string;
}

function fit(line: string, width: number): string {
  return truncateToWidth(line, Math.max(1, width), "", true);
}

function scopeLabel(name: "global" | "project", dirty: boolean): string {
  const base = name === "global" ? "Global" : "Project";
  return dirty ? `${base}*` : base;
}

/** Render Global/Project tabs or a Session label above the body. */
export function renderFrameTabs(
  theme: SettingsTheme,
  tabs: FrameTabMode,
  width: number,
): string[] {
  const lines: string[] = [];

  if (tabs.kind === "session") {
    const tab = theme.fg("accent", theme.bold(" Session "));
    const rest = theme.fg("dim", "  (tool activation is session-scoped)");
    lines.push(fit(tab + rest, width));
    lines.push(
      fit(
        theme.fg("border", "─".repeat(Math.max(4, Math.min(width, 28)))),
        width,
      ),
    );
    return lines;
  }

  const gLabel = scopeLabel("global", tabs.globalDirty);
  const pLabel = scopeLabel("project", tabs.projectDirty);
  const gActive = tabs.active === "global";
  const pActive = tabs.active === "project";

  const gTab = gActive
    ? theme.fg("accent", theme.bold(` ${gLabel} `))
    : theme.fg("dim", ` ${gLabel} `);
  const pTab = pActive
    ? theme.fg("accent", theme.bold(` ${pLabel} `))
    : theme.fg("dim", ` ${pLabel} `);

  lines.push(fit(`${gTab}  ${pTab}`, width));

  const gW = visibleWidth(` ${gLabel} `);
  const pW = visibleWidth(` ${pLabel} `);
  const gap = 2;
  let underline = "";
  if (gActive) {
    underline =
      theme.fg("accent", "─".repeat(gW)) + " ".repeat(gap) + " ".repeat(pW);
  } else {
    underline =
      " ".repeat(gW) + " ".repeat(gap) + theme.fg("accent", "─".repeat(pW));
  }
  lines.push(fit(underline, width));
  return lines;
}

/**
 * Compose the full bordered frame: title, tabs, body, optional status, footer.
 * Callers supply a body Component; tabs/status/footer are rendered here.
 */
export class ToolbeltFrame implements Component {
  constructor(private readonly options: ToolbeltFrameOptions) {}

  invalidate(): void {
    this.options.body.invalidate();
  }

  render(width: number): string[] {
    const { theme, title, tabs, body, status, footer } = this.options;

    const composedBody: Component = {
      invalidate: () => body.invalidate(),
      render: (w: number) => {
        const lines: string[] = [];
        lines.push(...renderFrameTabs(theme, tabs, w));
        lines.push("");
        lines.push(...body.render(w));
        if (status !== undefined && status.length > 0) {
          lines.push("");
          lines.push(fit(theme.fg("warning", status), w));
        }
        return lines;
      },
    };

    const footerComponent: Component = {
      invalidate: () => {},
      render: (w: number) => [fit(theme.fg("dim", footer), w)],
    };

    const panel = new Panel({
      title,
      body: composedBody,
      footer: footerComponent,
      border: "round",
      padding: 1,
      borderStyle: (text: string) => theme.fg("border", text),
      titleStyle: (text: string) => theme.fg("accent", theme.bold(text)),
    });
    return panel.render(width);
  }
}
