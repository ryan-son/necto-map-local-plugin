//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

export type Attrs = Record<string, string | boolean | number | undefined | ((event: Event) => void)>;

/// Necto's WKWebView skips buttons and checkboxes on Tab while the system's keyboard
/// navigation setting is off, which is the default. An explicit tabindex brings them back,
/// so they get 0 unless the caller says otherwise. Controls Tab should pass over, like a
/// tab or the checkbox in a list row, pass -1.
const tabStop = (tag: string, attrs: Attrs) =>
  !("tabindex" in attrs) && (tag === "button" || (tag === "input" && attrs.type === "checkbox"));

export function h(tag: string, attrs: Attrs = {}, ...children: Array<Node | string | undefined | false>): HTMLElement {
  const el = document.createElement(tag);
  if (tabStop(tag, attrs)) el.setAttribute("tabindex", "0");
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === "function") el.addEventListener(name.slice(2), value);
    else if (name === "value") (el as HTMLInputElement).value = String(value);
    else if (name === "checked") (el as HTMLInputElement).checked = Boolean(value);
    else el.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children) if (child !== undefined && child !== false) el.append(child);
  return el;
}

/// Places nodes into translated text at `{name}`, so a sentence with a button inside stays
/// one entry in the dictionary instead of pieces glued around a particle.
export function fill(text: string, parts: Record<string, Node>): Array<Node | string> {
  return text
    .split(/(\{[A-Za-z0-9_]+\})/)
    .filter((piece) => piece !== "")
    .map((piece) => (/^\{[A-Za-z0-9_]+\}$/.test(piece) ? (parts[piece.slice(1, -1)] ?? piece) : piece));
}

/// A render replaces nodes, and the field being typed in must keep its focus, caret and
/// scroll across it. Fields are found again by `data-field`.
export interface Focus { field: string; start: number | null; end: number | null; scrollTop: number }

export function captureFocus(root: HTMLElement): Focus | undefined {
  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  const field = el && root.contains(el) ? el.getAttribute("data-field") : null;
  if (!el || !field) return undefined;
  let start: number | null = null;
  let end: number | null = null;
  try { start = el.selectionStart; end = el.selectionEnd; } catch { /* number inputs have no selection range */ }
  return { field, start, end, scrollTop: el.scrollTop };
}

/// Field names carry user text such as a response name, so they are compared as values
/// rather than spliced into a selector. Returns true when focus actually moved.
export function restoreFocus(root: HTMLElement, focus: Focus | undefined): boolean {
  if (!focus) return false;
  const el = (
    [...root.querySelectorAll("[data-field]")] as Array<HTMLInputElement | HTMLTextAreaElement>
  ).find((candidate) => candidate.getAttribute("data-field") === focus.field);
  if (!el || (el as HTMLInputElement).disabled) return false;
  el.focus();
  if (document.activeElement !== el) return false;
  try {
    if (focus.start !== null) el.setSelectionRange(focus.start, focus.end ?? focus.start);
  } catch {
    /* as above */
  }
  el.scrollTop = focus.scrollTop;
  return true;
}

/// Targets with no click to wait for: a select or a text field does its work on mousedown,
/// and an inverted tap never produces a click on them either.
function takesNoClick(target: EventTarget | null): boolean {
  return !(target instanceof Element) || target.closest("select") !== null || isTextEntry(target);
}

/// Inside a text field, keys like `/` and ⌘Z belong to the field (the browser's own undo,
/// for one). Selects, checkboxes and buttons are not text fields.
const notText = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);
export function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable) return true;
  return el instanceof HTMLInputElement && !notText.has(el.type);
}

/// A focused select may have its native menu open, and replacing it drops the choice made
/// in that menu. When `fresh` rebuilds a focused select inside `scope` with the same field,
/// options and value, the old select goes back in its place. A value changed elsewhere is
/// drawn anew. It keeps the old render's handlers, so use this only where those handlers
/// read nothing the options don't show.
export function keepFocusedSelect(scope: Element | null | undefined, fresh: Element) {
  const el = document.activeElement;
  if (!(el instanceof HTMLSelectElement) || !scope?.contains(el)) return;
  const twin = fresh.querySelector(`select[data-field="${el.getAttribute("data-field")}"]`);
  const options = (s: HTMLSelectElement) => [...s.options].map((o) => `${o.value}\u0001${o.text}`).join("\u0002");
  if (!(twin instanceof HTMLSelectElement) || twin.value !== el.value) return;
  if (options(twin) === options(el)) twin.replaceWith(el);
}

/// A press released outside the window never ends here; this keeps rendering from stalling
/// for good.
const pressCapMs = 2_000;

/// Holds back renders that arrive during a press, from mousedown to its click: a save
/// result, an echo, a new request. WebKit sends a click only when mousedown and mouseup land
/// on the same attached node, so replacing nodes in between swallows the first click.
/// The hold lifts in the document's capture phase of click, so a render the click itself
/// asks for happens at once; when no click comes (the pointer was dragged off), the held
/// renders run after release.
export class PressHold {
  private pressed = false;
  private readonly waiting = new Set<() => void>();
  private cap?: ReturnType<typeof setTimeout>;

  constructor(doc: Document = document) {
    // Selects and text fields are not held. A select's macOS popup takes the mouseup and
    // the click, and an inverted tap into a text field has had its mouseup already, so
    // nothing would release the hold. Neither has a click to wait for.
    doc.addEventListener("mousedown", (e) => { if (!takesNoClick(e.target)) this.press(); }, true);
    doc.addEventListener("click", () => this.release(false), true);
    for (const type of ["mouseup", "pointerup", "pointercancel", "dragend"])
      doc.addEventListener(type, () => this.later(), true);
    doc.defaultView?.addEventListener("blur", () => this.later());
  }

  /// Defers `run` until release and returns true while a press is in progress. The same
  /// `run` is called once however often it is deferred.
  defer(run: () => void): boolean {
    if (!this.pressed) return false;
    this.waiting.add(run);
    return true;
  }

  /// `run` has just rendered, so a deferred copy of it is dropped.
  done(run: () => void) {
    this.waiting.delete(run);
  }

  private press() {
    this.pressed = true;
    clearTimeout(this.cap);
    this.cap = setTimeout(() => this.release(true), pressCapMs);
  }

  /// The click follows mouseup in the same task, so release on the next one.
  private later() {
    if (this.pressed) setTimeout(() => this.release(true), 0);
  }

  private release(flush: boolean) {
    this.pressed = false;
    clearTimeout(this.cap);
    if (flush) { this.flush(); return; }
    // If the click's handler did not render, the held renders run after it.
    if (this.waiting.size > 0) setTimeout(() => { if (!this.pressed) this.flush(); }, 0);
  }

  private flush() {
    const runs = [...this.waiting];
    this.waiting.clear();
    for (const run of runs) run();
  }
}

/// How close in time and space an early mouseup and the following mousedown must be to
/// count as one tap.
const tapGapMs = 250;
const tapSlop = 4;
const tapFixed = new WeakSet<Document>();

/// With a text field focused, Necto 0.2.0's WKWebView routes mousedown through the input
/// method (Korean input, for one) and delivers it a few milliseconds late. A trackpad tap,
/// whose press and release are nearly simultaneous, then sees mouseup (detail 0) before
/// mousedown: the page gets no click and focus moves anyway. Measured in Necto. This spots
/// that order and dispatches the click after mousedown. Selects and text fields are left
/// alone because mousedown is all they need.
export function fixInvertedTaps(doc: Document = document) {
  if (tapFixed.has(doc)) return;
  tapFixed.add(doc);
  let early: { x: number; y: number; at: number } | undefined;
  /// Whether a press is in progress. An early mouseup is one that arrives while this is
  /// false, whatever its detail. Presses that never see a mouseup (a select's popup, the
  /// context menu of a right or control click, a release outside the window) are either
  /// not counted or cleared on contextmenu and blur; a stale value costs the next tap its
  /// click.
  let down = false;
  const primary = (e: MouseEvent) => e.button === 0 && !e.ctrlKey;
  doc.addEventListener("mouseup", (e) => {
    early = primary(e) && (e.detail === 0 || !down) ? { x: e.clientX, y: e.clientY, at: Date.now() } : undefined;
    down = false;
  }, true);
  doc.addEventListener("contextmenu", () => { down = false; }, true);
  doc.defaultView?.addEventListener("blur", () => { down = false; early = undefined; });
  doc.addEventListener("mousedown", (e) => {
    const up = early;
    early = undefined;
    const target = e.target instanceof Element ? e.target : null;
    const inverted = up !== undefined && primary(e) && Date.now() - up.at <= tapGapMs
      && Math.abs(e.clientX - up.x) <= tapSlop && Math.abs(e.clientY - up.y) <= tapSlop;
    if (!inverted) { down = primary(e) && !target?.closest("select"); return; }
    if (!target || takesNoClick(target)) return;
    const { clientX, clientY, screenX, screenY } = e;
    // After the default action moves focus, where a click in the usual order would land.
    setTimeout(() => {
      if (target.isConnected)
        target.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            composed: true,
            detail: 1,
            button: 0,
            clientX,
            clientY,
            screenX,
            screenY,
          }),
        );
    }, 0);
  }, true);
}
