//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { necto } from "@necto/bridge";
import { bridgeAPI } from "./api";
import { connect } from "./connect";
import { localDrafts, localPrefs } from "./drafts";
import { t } from "./localization";
import { PanelModel } from "./model";
import { OrderDetector } from "./traffic/order";
import { TrafficStore } from "./traffic/store";
import { View } from "./view";

/// Necto's panel WebView blocks the clipboard API (measured 2026-10-03). The older
/// select-and-copy route is tried when it does.
async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    try {
      return copyField(field);
    } finally {
      field.remove();
    }
  }
}

function copyField(field: HTMLTextAreaElement): boolean {
  field.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  }
}

async function main() {
  // Development only: opens the panel in a browser with a stand-in host and app
  // (`npm run dev`). Dropped from the production bundle; script/build-panel checks.
  if (import.meta.env.DEV) {
    const { installMockBridge } = await import("./mock");
    installMockBridge();
  }
  // The host writes its language to <html lang> before this script runs, and reloads the
  // panel when it changes. Read it once, before the first render, and keep the page
  // declaring the language it is drawn in.
  document.documentElement.lang = necto.locale();
  const root = document.getElementById("app");
  if (!root) return;
  if (!necto.isAvailable()) {
    root.textContent = t("The Map Local panel works only inside Necto");
    return;
  }
  const api = bridgeAPI();
  let view!: View;
  // Request events are drawn by the traffic store through its own onChange.
  const model = new PanelModel(api, (reason) => (reason === "requests" ? undefined : view.render()));
  const store = new TrafficStore(() => view.refreshTraffic());
  const order = new OrderDetector();
  view = new View(root, model, {
    api,
    drafts: localDrafts(),
    copy,
    copyField,
    prefs: localPrefs(),
    traffic: { store, order },
  });
  view.render();
  // The host flushes events queued before ready(). Signal it only after the first
  // subscription is in place, so none of them arrive before there is anyone to hear them.
  await connect(api, model, view, { store, order }).firstAttempt;
  await necto.ready();
}

void main();
