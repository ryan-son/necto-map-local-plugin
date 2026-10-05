//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { t } from "./localization";
import { h } from "./dom";

interface Prefs { get(key: string): string | undefined; set(key: string, value: string): void }

/// One ←/→ step, the same as Necto's detail pane handle (`createDetailPane` in
/// @necto/bridge).
export const splitStep = 24;

/// The narrowest a drag can make either side. Mirrors `--ml-list-min` and
/// `--ml-detail-min` on `.ml-split` in the CSS.
export const splitMin = { list: 200, detail: 280 };

/// The remembered list width, as a fraction (0–1) of the whole split. A width remembered in
/// pixels turns into a narrow list beside an empty detail pane once the window grows.
/// Older pixel values (> 1) and anything unreadable are dropped for the CSS default.
export function readSplit(prefs: Prefs, key: string): number | undefined {
  const value = Number(prefs.get(key) || NaN);
  return Number.isFinite(value) && value > 0 && value < 1 ? value : undefined;
}

/// Keeps the list width in pixels within bounds, leaving the detail pane its minimum.
export function clampSplit(px: number, total: number): number {
  const upper = total > 0 ? total - splitMin.detail : Infinity;
  return Math.round(Math.max(splitMin.list, Math.min(px, upper)));
}

const keep = (ratio: number) => Math.round(ratio * 10000) / 10000;

export function applySplit(container: HTMLElement, ratio: number | undefined) {
  if (ratio === undefined) container.style.removeProperty("--ml-list-size");
  else container.style.setProperty("--ml-list-size", `${Math.round(ratio * 10000) / 100}%`);
}

/// The handle between the list and the detail pane. The caller owns the ratio (`width`).
/// A render replaces both the handle and the container, so a drag listens on the document
/// and applies to whichever container is on screen now (`container()`).
export function splitHandle(opts: {
  prefs: Prefs;
  key: string;
  container(): HTMLElement | null;
  value(): number | undefined;
  width(ratio: number | undefined): void;
}): HTMLElement {
  const handle = h("div", {
    class: "necto-resize ml-split-handle",
    role: "separator",
    tabindex: 0,
    "aria-orientation": "vertical",
    "aria-label": t("List width"),
    "aria-valuemin": splitMin.list,
    "data-field": `split-${opts.key.replace(/^split\./, "")}`,
    title: t("Drag or press ←→ to resize the list · double-click for the default width"),
  });
  const total = () => opts.container()?.getBoundingClientRect().width ?? 0;
  /// The list width in pixels: from the remembered ratio if there is one, otherwise as laid
  /// out by the CSS default. Unknown before layout.
  const now = () => {
    const width = total();
    const ratio = opts.value();
    if (width <= 0) return undefined;
    return ratio !== undefined
      ? clampSplit(ratio * width, width)
      : opts.container()?.firstElementChild?.getBoundingClientRect().width || undefined;
  };
  const announce = () => {
    const value = now();
    if (value === undefined) handle.removeAttribute("aria-valuenow");
    else handle.setAttribute("aria-valuenow", String(Math.round(value)));
    const width = total();
    if (width > 0)
      handle.setAttribute("aria-valuemax", String(Math.round(width - splitMin.detail)));
    else handle.removeAttribute("aria-valuemax");
  };
  const apply = (ratio: number | undefined) => {
    opts.width(ratio);
    const el = opts.container();
    if (el) applySplit(el, ratio);
    announce();
  };
  announce();
  handle.addEventListener("focus", announce);
  handle.addEventListener("keydown", (event) => {
    const e = event as KeyboardEvent;
    if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || e.metaKey || e.ctrlKey || e.altKey)
      return;
    const width = total();
    const from = now();
    if (width <= 0 || from === undefined) return;
    e.preventDefault();
    const next = keep(
      clampSplit(from + (e.key === "ArrowRight" ? splitStep : -splitStep), width) / width,
    );
    apply(next);
    opts.prefs.set(opts.key, String(next));
  });
  handle.addEventListener("pointerdown", (down) => {
    const e = down as PointerEvent;
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = opts.container()?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const total = rect?.width ?? 0;
    let last: number | undefined;
    handle.dataset.dragging = "true";
    const doc = handle.ownerDocument;
    const move = (ev: Event) => {
      // An inverted tap delivers pointerup before pointerdown, so the release has already
      // passed. Movement with no button down ends the drag.
      if (((ev as PointerEvent).buttons & 1) === 0) {
        up();
        return;
      }
      if (total <= 0) return;
      last = keep(clampSplit((ev as PointerEvent).clientX - left, total) / total);
      apply(last);
    };
    const up = () => {
      doc.removeEventListener("pointermove", move);
      doc.removeEventListener("pointerup", up);
      doc.removeEventListener("pointercancel", up);
      delete handle.dataset.dragging;
      if (last !== undefined) opts.prefs.set(opts.key, String(last));
    };
    doc.addEventListener("pointermove", move);
    doc.addEventListener("pointerup", up);
    doc.addEventListener("pointercancel", up);
  });
  handle.addEventListener("dblclick", () => {
    apply(undefined);
    opts.prefs.set(opts.key, "");
  });
  return handle;
}
