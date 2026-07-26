/**
 * Panel — bordered container for modal content.
 *
 * Adapted from @aliou/pi-utils-ui v0.4.1 (MIT), src/containers/panel.ts.
 * Vendored locally because the published package uses extensionless internal
 * imports incompatible with this repository's mandatory NodeNext/tsconfig.json.
 *
 * MIT License — Copyright (c) 2025 Aliou Badiane
 * https://github.com/aliou/pi-utils-ui
 */

import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type BorderStyle = "square" | "round";

export interface PanelOptions {
  title?: string | Component;
  body: Component;
  footer?: Component;
  borderStyle?: (text: string) => string;
  titleStyle?: (text: string) => string;
  border?: BorderStyle;
  padding?: number;
}

interface BorderChars {
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
  left: string;
  right: string;
  footerLeft: string;
  horizontal: string;
}

const BORDERS: Record<BorderStyle, BorderChars> = {
  square: {
    topLeft: "┌",
    topRight: "┐",
    bottomLeft: "└",
    bottomRight: "┘",
    left: "│",
    right: "│",
    footerLeft: "├",
    horizontal: "─",
  },
  round: {
    topLeft: "╭",
    topRight: "╮",
    bottomLeft: "╰",
    bottomRight: "╯",
    left: "│",
    right: "│",
    footerLeft: "├",
    horizontal: "─",
  },
};

export class Panel implements Component {
  private readonly title: string | Component | undefined;
  private readonly body: Component;
  private readonly footer: Component | undefined;
  private readonly styleBorder: (text: string) => string;
  private readonly styleTitle: (text: string) => string;
  private readonly borderStyle: BorderStyle;
  private readonly padding: number;

  constructor(options: PanelOptions) {
    this.title = options.title;
    this.body = options.body;
    this.footer = options.footer;
    this.styleBorder = options.borderStyle ?? ((text: string) => text);
    this.styleTitle = options.titleStyle ?? ((text: string) => text);
    this.borderStyle = options.border ?? "square";
    this.padding = options.padding ?? 1;
  }

  render(width: number): string[] {
    const lines: string[] = [];
    const border = BORDERS[this.borderStyle];
    const innerWidth = Math.max(0, width - 2);

    lines.push(this.renderTitleLine(border, innerWidth));

    for (let i = 0; i < this.padding; i++) {
      lines.push(this.renderEmptyLine(border, innerWidth));
    }

    const contentWidth = Math.max(0, innerWidth - this.padding * 2);
    const bodyLines = this.body.render(contentWidth);
    for (const line of bodyLines) {
      lines.push(this.renderContentLine(border, innerWidth, line));
    }

    for (let i = 0; i < this.padding; i++) {
      lines.push(this.renderEmptyLine(border, innerWidth));
    }

    if (this.footer) {
      lines.push(this.renderFooterLine(border, innerWidth));
      const footerLines = this.footer.render(contentWidth);
      for (const line of footerLines) {
        lines.push(this.renderContentLine(border, innerWidth, line));
      }
    }

    lines.push(this.renderBottomLine(border, innerWidth));

    return lines;
  }

  invalidate(): void {
    this.body.invalidate();
    this.footer?.invalidate();
  }

  private renderTitleLine(border: BorderChars, innerWidth: number): string {
    if (this.title === undefined) {
      return (
        this.styleBorder(border.topLeft) +
        this.styleBorder(border.horizontal.repeat(innerWidth)) +
        this.styleBorder(border.topRight)
      );
    }

    const styledTitle =
      typeof this.title === "string"
        ? this.styleTitle(this.title)
        : (this.title.render(innerWidth)[0] ?? "");
    const titleWidth = visibleWidth(styledTitle);
    const fillWidth = Math.max(0, innerWidth - titleWidth - 2);
    const leftFill = Math.floor(fillWidth / 2);
    const rightFill = Math.ceil(fillWidth / 2);

    return (
      this.styleBorder(border.topLeft) +
      this.styleBorder(border.horizontal.repeat(Math.max(0, leftFill))) +
      " " +
      styledTitle +
      " " +
      this.styleBorder(border.horizontal.repeat(Math.max(0, rightFill))) +
      this.styleBorder(border.topRight)
    );
  }

  private renderEmptyLine(border: BorderChars, innerWidth: number): string {
    return (
      this.styleBorder(border.left) +
      " ".repeat(innerWidth) +
      this.styleBorder(border.right)
    );
  }

  private renderContentLine(
    border: BorderChars,
    innerWidth: number,
    content: string,
  ): string {
    const padded =
      " ".repeat(this.padding) +
      truncateToWidth(
        content,
        Math.max(0, innerWidth - this.padding * 2),
        "",
        true,
      ) +
      " ".repeat(this.padding);
    const inner = truncateToWidth(padded, innerWidth, "", true);
    return (
      this.styleBorder(border.left) + inner + this.styleBorder(border.right)
    );
  }

  private renderFooterLine(border: BorderChars, innerWidth: number): string {
    return (
      this.styleBorder(border.footerLeft) +
      this.styleBorder(border.horizontal.repeat(innerWidth)) +
      this.styleBorder("┤")
    );
  }

  private renderBottomLine(border: BorderChars, innerWidth: number): string {
    return (
      this.styleBorder(border.bottomLeft) +
      this.styleBorder(border.horizontal.repeat(innerWidth)) +
      this.styleBorder(border.bottomRight)
    );
  }
}
