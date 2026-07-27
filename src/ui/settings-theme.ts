/**
 * Settings theme glue combining Theme with SettingsListTheme tokens.
 *
 * Pattern adapted from @aliou/pi-utils-settings 0.17.0 (MIT) getSettingsTheme
 * and the validated Toolbelt settings prototype. Direct package import is not
 * used because that package ships extensionless TS internals incompatible with
 * this repository's NodeNext typecheck - the same reason src/panel.ts is
 * vendored from @aliou/pi-utils-ui.
 *
 * MIT License - Copyright (c) 2025 Aliou Badiane
 * https://github.com/aliou/pi-utils-settings
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type { SettingsListTheme } from "@earendil-works/pi-tui";

/** Combined Theme + SettingsListTheme for Toolbelt settings/tools chrome. */
export type SettingsTheme = SettingsListTheme & Theme;

/** Merge SettingsListTheme tokens onto the active Theme prototype chain. */
export function getSettingsTheme(theme: Theme): SettingsTheme {
  const list = getSettingsListTheme();
  const combined = Object.create(theme) as SettingsTheme;
  combined.label = list.label;
  combined.value = list.value;
  combined.description = list.description;
  combined.cursor = list.cursor;
  combined.hint = list.hint;
  return combined;
}
