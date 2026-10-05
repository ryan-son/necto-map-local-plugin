//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

// The keyboard model shared by the rules and traffic lists. Focus stays on the list
// container (role=listbox) and the selected row is named by aria-activedescendant. Rows
// are rebuilt whenever their signature changes, so focus on a row would vanish with the
// next request; the container survives, and a render finds it again by `data-field`
// (see dom.ts).

/// Row keys contain spaces and braces. An id only has to be unique within the document.
export const optionId = (prefix: string, key: string) => `${prefix}-${encodeURIComponent(key)}`;

export const options = (list: Element) =>
  [...list.querySelectorAll('[role="option"]:not([aria-disabled="true"])')] as HTMLElement[];

/// With nothing selected, ↓, ⇟ and Home start at the first row and ↑, ⇞ and End at the
/// last. Movement stops at either end rather than wrapping.
export function nextIndex(key: string, current: number, count: number, page: number): number | undefined {
  if (count === 0) return undefined;
  const last = count - 1;
  const clamp = (i: number) => Math.max(0, Math.min(last, i));
  switch (key) {
    case "ArrowDown": return current < 0 ? 0 : clamp(current + 1);
    case "ArrowUp": return current < 0 ? last : clamp(current - 1);
    case "PageDown": return current < 0 ? 0 : clamp(current + page);
    case "PageUp": return current < 0 ? last : clamp(current - page);
    case "Home": return 0;
    case "End": return last;
    default: return undefined;
  }
}

/// One less than the visible row count, or 10 before layout, when heights are still zero.
export function pageSize(list: HTMLElement): number {
  const row = options(list)[0]?.offsetHeight ?? 0;
  if (!row || !list.clientHeight) return 10;
  return Math.max(1, Math.floor(list.clientHeight / row) - 1);
}

/// The row a navigation key moves to. A consumed key has its default scroll prevented.
export function navigate(list: HTMLElement, e: KeyboardEvent): HTMLElement | undefined {
  if (e.altKey || e.ctrlKey || e.metaKey) return undefined;
  const all = options(list);
  const current = all.findIndex((option) => option.getAttribute("aria-selected") === "true");
  const to = nextIndex(e.key, current, all.length, pageSize(list));
  if (to === undefined) return undefined;
  e.preventDefault();
  return all[to];
}

export function selectedOption(list: Element): HTMLElement | null {
  return list.querySelector('[role="option"][aria-selected="true"]');
}

export function syncActive(list: Element | null) {
  if (!list) return;
  const id = selectedOption(list)?.id;
  if (id) list.setAttribute("aria-activedescendant", id);
  else list.removeAttribute("aria-activedescendant");
}

/// Called only after a selection made by key: new data must not move what the user is
/// looking at (principle 5 in docs/experience.md). Call it after focus and scroll are
/// restored, or the restore undoes it.
export function revealSelected(list: Element | null) {
  if (list) selectedOption(list)?.scrollIntoView?.({ block: "nearest" });
}

/// ←/→ (wrapping at the ends), Home and End in a tablist. Returns the tab to go to; the
/// caller decides whether that moves focus or selects it.
export function nextTab(e: KeyboardEvent): HTMLElement | undefined {
  const list = (e.currentTarget as HTMLElement | null)?.closest('[role="tablist"]');
  const from = (e.target as HTMLElement | null)?.closest('[role="tab"]');
  if (!list || !from || e.metaKey || e.ctrlKey || e.altKey) return undefined;
  const tabs = [...list.querySelectorAll('[role="tab"]')] as HTMLElement[];
  const at = tabs.indexOf(from as HTMLElement);
  const to = e.key === "ArrowRight" ? (at + 1) % tabs.length
    : e.key === "ArrowLeft" ? (at - 1 + tabs.length) % tabs.length
    : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
  if (to < 0) return undefined;
  e.preventDefault();
  return tabs[to];
}
