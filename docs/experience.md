# Map Local Panel — Experience

[한국어](experience-ko.md)

## Intent

**Without taking their hands off the app, the user turns the data on the screen they are looking at into the response they want within seconds, and sees that it changed.**

There is one core loop: **look → pick → change → confirm**. Every element on screen exists either to make one step of this loop faster, or to remove an uncertainty that breaks the loop (is it on? did it apply? did it save?). An element that does neither goes.

The user is an iOS developer or QA engineer with the simulator (or a device) and Necto side by side. Their eyes and hands move between two windows. So the panel must **read at a glance** (less time with eyes off the app) and **be usable from the keyboard all the way through** (less time hunting small targets with the mouse).

## Principles

1. **One with Necto (host consistency)** — The user has already learned the Necto Network panel right next door. What is the same there is the same here.
   - Measured (Necto 0.2.0 Network panel): a table with column headers, a coloured dot before the status code (green for 2xx, red for failures and 5xx), ↑↓ to move between rows, an accent bar on the left of the selected row, the detail in a split on the right with tabs (Summary, Request, Response, cURL) and ×, and a filter field "Filter by method, host or path" with a count and "Clear".
   - ⌘F is the host's "Find in panel" — **do not intercept it.** The host offers no context menu either (only "Reload") — do not build one.
2. **The whole loop from the keyboard** — ↑↓ to move in a list (as in Necto), ⇞⇟/Home/End, Return = focus the detail's primary action, Esc = step back once (clear input → clear selection), Tab order list ↔ detail ↔ filter, and a shortcut for the primary action ("Mock with this response") shown on its button. Focus is always visible.
   - Measured (Necto 0.2.0 WKWebView, 2026-10-04): ↑↓, Return, ⌘↩ and `/` reach the panel. **⌘Z (Undo in the Edit menu) and Esc are taken by the host and never reach the panel.** So undo, close and clear always have a visible button (Undo, ×, ⓧ) as the main path, and the keys are a bonus. With WebKit's defaults Tab skips buttons, so the loop's controls get `tabindex="0"`.
   - Measured (2026-10-05): while Necto is not the active window, the first click only brings it forward and never reaches the page, in Necto's own Network panel too. Going back and forth with the simulator is the core loop, so the recipes say so once.
3. **State is always visible** — on/off, paused, how many rows the filters hide, whether a mock applied, whether it saved. Having to open something else to check is a failure.
4. **Reversible, not asked** — Delete at once and offer "Undo" (instead of a confirmation dialog). Edits autosave and say "Saved". The one exception asks first: an action that can send a token to the real server. While a mocked session may remain, that is turning off or deleting an auth rule, turning Map Local off, or removing an allowed host, while an auth rule that is on answers it. Turning an auth rule on from the traffic detail, where its tag is not in view, asks too; the rule list and editor show the tag and turn it on at once.
5. **Nothing jumps** — New data, banners and filter changes never push the list or lose the scroll position or selection. Keep the user's place. The header keeps two rows whatever it holds, so adding a host never moves the lists (measured: it moved them 25 px before).
6. **Every width has a purpose** — narrow (<640): one thing at a time (list or detail, stacked). Medium (640–1100): list and detail side by side. Wide (>1100): give the room to the detail (the body is the star). Both tabs (rules and traffic) follow the same rule.
7. **It remembers** — The view mode, the tab, the split width and the filters are remembered per viewer (localStorage; everything still works when it fails).
8. **Words people read** — The user's words instead of internal identifiers or English jargon. Truncated text shows in full on hover. Each colour has one meaning (mocked = purple, real server = grey, blocked = orange, failure/5xx = red, 4xx = yellow, 2xx = green).
9. **Accessibility** — roles (listbox/option, tablist/tab), aria-selected/pressed matching what is on screen, contrast, and respect for the Reduce Motion setting.
10. **The app says when it is not talking to the real server, and nothing otherwise** — While Map Local is on, its rules apply, with or without Necto. The app shows a badge exactly when something applies, and tapping it is the way out: it says what applies and turns Map Local off. When nothing applies, the app shows nothing.

## Scenarios × principles (success criteria)

| Scenario | Success criterion |
|---|---|
| ① On-screen data → mock | Pick a request in Traffic with ↑↓ and press the primary action once → the app requests again → the detail follows to the latest call and shows the "Mocked" badge. Possible without the mouse. After editing the response, the rule editor's "Latest request" line confirms the change where it was made (measured on a walk: 13 operations, 2 window crossings and a Resume before; 9 operations and one glance after) |
| ② Reproduce an error | In Rules, "+ Response" → status 500 → that response is exactly what the app receives (and the panel shows it) → saved |
| ③ An unfinished API | An empty rules list says what to do, and "+ Rule" lets you write the path and the response right away. The new rule answers nothing until its path is written |
| ④ Blocked or offline | Switching "Requests without a rule" to "Block" or to an error shows that state in the header, and with the rules off every request to the allowed hosts fails |
| ⑤ First run | With no allowed hosts, the screen says why nothing applies, and adding one takes one step |
| ⑥ "Why isn't it working?" | A row shows the result (mocked / real server / blocked / unknown). When a rule matches a request that was not mocked, the detail says why in one line, in the engine's order — host blocked in app code (never mocked), Map Local off [Turn on], host not allowed [Add to allowed hosts], rule off [Turn on rule], or that it applies now — and a mocked request names a matching rule that another took precedence over, only while that other rule would still win. When only a rule that is off matches and there is no response to capture, the fix is the primary action (⌘↩), never a duplicate empty rule. A request whose result is unknown is never said to apply now |
| ⑦ Sharing | "Copy configuration" and "Paste configuration" mean what their names say, and report the result |
| ⑧ A flood | The selection stays put while the list keeps flowing, the line above the list counts what came after it under the current filters, and "Show newest" catches up in one action. A list too short to scroll moves the selection down a row per arrival, so the new request is in view. "Pause" freezes the list. (Selecting used to pause the time view; the first-use test found that hid the request just made in the app) |

## Visual language (2026-10-04, "hold up next to Necto Network")

Basis: our panel already imports `@necto/bridge`'s theme.css and components.css (Panel/src/style.css:1-2). Every component the Necto Network panel uses is in there, yet we use little beyond `necto-button/field/tab`. **Use the host's components first, and add only our own domain (mocked, blocked) on top.**

- **Necto components to use**: `necto-table` (sticky header, 26px rows, hover/selection plus the accent bar on the left of the selected row), `necto-status-{ok,info,warning,danger,idle}` (coloured dot plus mono numerals), `necto-segmented` (view switch), `necto-badge`, `necto-pairs` (detail summary), `necto-tabs` (detail: Summary, Request, Response), `necto-empty`, `necto-notice` (banners), `necto-code-copy` (copying a body), `necto-resize` (split width), `necto-switch`, `necto-numeric`, and the `:focus-visible` ring.
- **Two axes, two languages**: the HTTP status uses coloured dots exactly as Necto does (2xx success · 3xx info · 4xx warning · 5xx and connection failure danger · in progress idle). The **result** uses pill badges of a different shape, so it never mixes with the status colours.
  - Mocked = `--ml-mock` purple (light fill plus text), blocked = `--ml-block` orange (light fill plus text), real server = tertiary text with no fill (the default stays quiet), unknown = tertiary text with a dashed border.
  - Principle: **the default is quiet and the exceptions stand out** — scanning the list, only mocked, blocked and errors catch the eye (preattentive processing).
- **New tokens sit in the same contrast band as Necto's palette** (measured in Necto: light 5.6–6.5:1, dark 6.1–7.8:1). Candidates: `--ml-mock` light #7b3fd0 (6.06) / dark #b691ff (6.89), `--ml-block` light ≈#a24a12 / dark #f0904a (7.14). A test pins ≥4.5:1 in both light and dark.
- **Extras**: the duration of a slow response (≥1s) in the warning colour; methods in a single colour as in Necto (colour is only for results and status — do not give colour a second meaning).
- **Start times are fixed, not localised**: `HH:MM:SS.mmm` in local time, as in Necto's Network panel. A locale's clock ("12:46:21 PM") is wider than the column and harder to compare down a list.
- **Empty lists use `necto-empty`**: the traffic list says "No requests yet" when nothing has arrived, and "No requests match the filters" with [Clear filters] when the filters hide everything — never "no requests" over requests that are only hidden (principle 8).
- **Measure light mode too** (Necto's theme setting, or `data-theme`).
