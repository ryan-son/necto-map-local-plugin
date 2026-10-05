# Verification Log

What each release was checked on in a real Necto, and what was not. Tests and `script/ci`
cover logic; they cannot show that the app connected over USB, that the panel survived a
reconnect, or that it reads well in light mode. Necto's harness guide asks plugin authors
to keep this evidence and to say which checks they could not run
([Necto: harness, "Evidence to keep"](https://github.com/toss/necto/blob/main/docs/harness.md)).

Add an entry before tagging a release. Copy the template, fill in every row, and write
"not verified" with the reason when a check was not run. A blank row is not a pass.

## Template

```markdown
## <version> — <date>

Build: <commit> · Necto <version> (Mac app and SDK) · Xcode <version> · <macOS version>
Targets: <simulator and OS> · <device and OS, or "none">

### Automated

| Check | Result |
| --- | --- |
| `script/ci` (guard, workflow pins, panel, embed diff, swift test, release checks, controls) | exit <code> |
| `swift test` | <n> tests |
| `cd Panel && npx vitest run` | <n> tests |
| Release workflow on GitHub (tag check, CI, assets) | <run link, or not run> |

### In Necto

| Check | Result | Build | Notes |
| --- | --- | --- | --- |
| App connected over USB on a device, not only the simulator | | | |
| The panel rendered data that started in the app (rules, traffic) | | | |
| A mock applied from the next request, with no relaunch | | | |
| Disconnect fails pending calls instead of hanging | | | |
| Reconnect (relaunch the app) without restarting Necto | | | |
| Light appearance | | | |
| Dark appearance | | | |
| Light/dark switch with the panel open, without reloading | | | |
| Default text size | | | |
| Larger text size (Necto's zoom) | | | |
| Narrow panel (under 640 px): stacked list and detail, both tabs | | | |
| Wide panel (over 1100 px) | | | |
| English (Necto language setting) | | | |
| Korean | | | |
| Device badge text follows the device language | | | |
| CLI: `plugin list`, `plugin help`, a write and a refused write | | | |
| With and without Necto's network plugin registered | | | |

### Simulation results

<Scenario runs from docs/experience.md, with what passed, what failed and where the user
hesitated.>

### Not verified

<Each check above that was not run, and why.>
```

## 0.1.0 — not tagged yet

Build: 7133677 (branch `feature/traffic-tab`) for the automated checks. The checks in Necto
ran on earlier builds of this branch, named per row, and were rerun on 4897c81 in the new
environment below ("Rerun on the release candidate").
Necto 0.2.0 (Mac app and SDK) · Xcode 26, then Xcode 27.1 beta from 2026-10-06.
Targets: iOS simulator (iPhone 17 Pro, iOS 26.4; iPhone 18 Pro, iOS 27.0 for the rerun), and
a device (iPhone 17 Pro, iOS 26.6.1) where a row says so.

### Automated

| Check | Result |
| --- | --- |
| `script/ci` | exit 0 at 7133677, including the six release controls (five archives and the Debug-only project build) |
| `swift test` | 160 tests in 19 suites |
| `cd Panel && npx vitest run` | 1115 tests |
| Release workflow on GitHub | not run: the repository has no remote yet, so neither `ci.yml` nor `release.yml` has run on GitHub. `script/prepare-release` and `script/lint-workflows` are covered by `script/test-verify-release` locally |

### In Necto

| Check | Result | Build | Notes |
| --- | --- | --- | --- |
| App connected on a device | pass | 25fd352 | iPhone 17 Pro, iOS 26.6.1. Necto listed the device and the app; a rule copied from the simulator with `necto-cli` mocked `GET` on a real site. The connection was not over the USB cable (the device was absent from the Mac's USB list); a cabled run was not recorded |
| The panel rendered data that started in the app | pass | 4226166 and later | Rules and traffic both filled from the app |
| A mock applied from the next request, with no relaunch | pass | 4226166, 0ffd186 | Captured response, then a 500 response; specificity picked the `?page=1` rule |
| Disconnect fails pending calls instead of hanging | not verified | — | |
| Reconnect without restarting Necto | partial | 0d01030 | After a relaunch with the new plugin ID the panel loaded with rules intact. A plain relaunch with the panel open was not recorded as its own check |
| Light appearance | pass | 25fd352 | macOS switched to light. Status dots, result pills, the 4xx tint and the primary button stay legible. Contrast is also pinned by `Panel/tests/tokens.test.ts` |
| Dark appearance | pass | 6c550b7 to 147b6af | All UX-pass checks ran in dark |
| Light/dark switch with the panel open | not verified | — | |
| Default text size | pass | 6c550b7 and later | |
| Larger text size (Necto's zoom) | pass | 25fd352 | 16 pt: controls, chips, selects and captions scale with the rest after the font-scale fix |
| Narrow panel (under 640 px) | pass | 6c550b7 | About 440 px: stacked list and detail on both tabs |
| Wide panel (over 1100 px) | partial | 6c550b7 | About 1050 px, just under the wide breakpoint |
| English | pass | d1605f4 | Necto language set to English. The header's share group wraps to a second line at about 970 px |
| Korean | pass | d1605f4 | System language |
| Device badge text follows the device language | pass | 25fd352, 1064076 | Korean on a Korean device and simulator. English on the simulator with the app launched with `-AppleLanguages (en)`: "Mock rules applying: 4", "Turn off Map Local" |
| Badge shows only when something applies, and the app turns Map Local off | pass | 83648cd | Simulator: tapping the badge opened 「Map Local / 목업 규칙 1개가 적용 중입니다 / GET /api/devices」; 끄기 removed the badge and the panel header showed 꺼짐 at once |
| Badge sheet: asking again and the failure alert appear after the first sheet closes | pass | 42db8d2 | Throwaway UIKit harness, iPhone 17 Pro simulator (iOS 26.4), XCUITest: in an action's handler the alert is already dismissed (`presentedViewController` nil, alert out of the window), so a sheet presented again through the badge's guard and a failure alert both appeared. A sheet presented from a window above the status bar that never becomes key took the tap. Not run with the plugin itself |
| Badge keyboard scope | partial | 5043f2e | Measured on iOS 26.4 simulators: the keyboard notification's object is the screen; software keyboard 335 pt (iPhone 17 Pro), 337 pt (iPad Air 11-inch). The iPad shortcut bar and multiple windows were not observed; `BadgeLayoutTests` covers them from assumed frames |
| App launch requests are mocked | pass | 25fd352 | Probe app: requests at 115–560 ms after launch were mocked on the simulator and the device, while Necto attached 63–2020 ms after launch (it probes every 2 s) |
| CLI: list, help, a write and a refused write | pass | 0d01030 | `plugin list` shows `io.github.ryan-son.maplocal` 0.1.0; `plugin help` prints the descriptions; `requests.list` with limit 9999 and `configuration.patch` without `baseRevision` fail with `INVALID_INPUT` and exit 1 |
| With and without Necto's network plugin registered | partial | 4226166 and later | With the plugin in the documented order: pass. Without it, and in the reverse order with its warning, not rerun on 0.1.0 code |

Measured host behaviour that shaped the panel (recorded in [experience.md](experience.md)):
⌘Z and Esc never reach the panel; WebKit's Tab skips buttons; with a text field focused,
mouseup arrives before mousedown, so the panel synthesizes the click (verified at 867dff9).

### Rerun on the release candidate — 2026-10-06, build 4897c81

macOS 27.0.1 (M4 Max), Xcode 27.1 beta, Necto 0.2.0, iPhone 18 Pro simulator (iOS 27.0). A
demo app with an orders list on a local server (`127.0.0.1:8765`), registering Map Local
and then Necto's network plugin; the repository's QuickStart example for the case without it.

| Check | Result | Notes |
| --- | --- | --- |
| App connected on a device | not rerun | No device at hand on the new machine; the 25fd352 run on iOS 26.6.1 stands |
| The panel rendered data that started in the app | pass | Rules and traffic from the app |
| A mock applied from the next request, with no relaunch | pass | A 500 response made the one the app gets showed on the next Reload |
| Disconnect fails pending calls instead of hanging | partial | Necto removes the panel the moment the app goes ("No app connected"), so no panel call is left waiting; `necto-cli` to the gone app fails in 0.03 s with `TARGET_DISCONNECTED`. A call in flight at the instant of disconnect was not reproduced |
| Reconnect without restarting Necto | pass | The app was killed and relaunched twice; the panel came back on the new launch's traffic each time |
| Light appearance | pending | Needs macOS switched to light |
| Dark appearance | pass | All checks in this table |
| Light/dark switch with the panel open | pending | Needs macOS switched with the panel open |
| Default text size | pass | 13 pt |
| Larger text size (Necto's zoom) | pass | 16 pt: header, lists and the editor scale; the precedence line wraps; "Common codes" fits |
| Narrow panel (under 640 px) | pass | About 550 px: list over detail on both tabs; the share group moves to a second header row |
| Wide panel (over 1100 px) | pass | About 1117 px: list beside detail on both tabs |
| English | pass | Necto set to English |
| Korean | pass | Necto in the system language (Korean) before switching |
| Device badge text follows the device language | pass | Korean by default; English with `-AppleLanguages (en)` |
| Badge shows only when something applies, and the app turns Map Local off | pass | "Turn off Map Local" in the sheet removed the badge; the panel showed "Map Local off", the notice and the dimmed rules at once |
| The status bar keeps its touches | pass | Throwaway scene-based app: taps at 30 and 45 pt never reached the app, taps at 56 and 81 pt did, as on iOS 26.4 |
| Badge sheet: asking again and the failure alert appear after the first sheet closes | partial | On iOS 27 an alert action's handler runs after the alert is gone and can present the next alert (same app); the badge's own sheet flow was not rerun |
| Badge keyboard scope | partial | Inputs remeasured on iOS 27 (keyboard 328 pt on the iPhone, 337 pt on the iPad Air); the in-app hide while typing was not rerun |
| App launch requests are mocked | pass | The demo's launch request for the orders came back mocked after each relaunch |
| CLI: list, help, a write and a refused write | pass | `plugin list` and `plugin help` as before; a replace with a stale `baseRevision` answered `ok:false`, `conflict`, exit 0 |
| With and without Necto's network plugin registered | pass | With it: responses shown and captured. Without it (QuickStart): requests listed, and the detail says to register `URLSessionNetworkPlugin` after Map Local with Necto's reason. The reverse order was not rerun |
| Screenshots in the docs | retaken | The four images were retaken on this build in this environment |

### Simulation results

Hands-on run on 2026-10-04/05 with a production app's Debug build against its development
server (production hosts blocked in app code), personas from [experience.md](experience.md).

| Task | Result |
| --- | --- |
| Fill an empty installed-device list from a captured response | pass, about 12 steps; repeated on the device |
| Reproduce a 500 error | pass, about 8 steps |
| Diagnose "why wasn't it mocked" with Map Local off | pass after the fix: the detail names the reason and offers the action |
| Copy a configuration to another device | pass with `necto-cli` export and replace |
| Find a request in a burst | pass on the probe app (earlier run) |

Recipe walk on 2026-10-05, build 1064076: every recipe in [recipes.md](recipes.md) followed
as written on a demo app against a local server (`127.0.0.1`), on the simulator. All ten
reached their result. Found on the way and fixed:

- A choice made in a menu was lost when an edit's save landed while the menu was open: the
  redraw replaced the select (fixed in 1064076, observed fixed in Necto).
- Steps the recipes had wrong: the rule editor opens with "Open rule", not by itself;
  "Copy configuration" opens a window with "Copy"; after a mocked login, "I've logged out"
  in the panel ends the session reminder.
- Host behaviour, now in the recipes: while Necto is not the active window, the first click
  only brings it forward, in Necto's own Network panel too.
- No way to take a whole API offline: an error was set per response. "Requests without a
  rule" gained the three response errors (663b7f2). Followed in Necto: with "No internet
  connection (-1009)" and the order rules off, the app showed its offline message, the
  traffic row read "Connection failed" and "Blocked", and the badge sheet listed "No
  internet connection: requests without a rule".
- An adversarial review of that change found a failed request turning from "Blocked" to
  "Unknown" once its detail loaded, and a focused menu keeping a value changed elsewhere;
  both fixed with tests in 149ed5e. Observed in Necto: selecting the failed request kept
  "Blocked", with the line saying its rule is off.
- "Paste configuration" with ⌘V, pressed by hand since the automation cannot paste: the
  text arrived and imported. Pressing Import on the empty field first left "Not JSON" under
  the pasted text, so Import now stays off until there is text, the error goes once the
  text changes, and a line shows what the text holds before Import (67ece5c). Observed:
  "Rules: 2 · allowed hosts: api.example.com, cdn.example.com · replaces the current
  configuration", then "Imported rules: 2".
- Three changes from the walk, each followed again in Necto against a server that sends
  one-line JSON (0b4afe1, 9dbd75e, e7c5369): a captured body opened indented; a page=2
  request mocked by a rule for every query offered "Rule for this query only (page=2)",
  and from the next request page 2 got the new rule and page 1 the old one; "+ Rule" made
  `GET /` off, and typing the path turned it on. An adversarial review found eight
  problems in them, fixed with tests in 4e6ac8e; observed in Necto: once the answering
  rule was off, the button no longer showed.
- A rule made with "Only with this query" from a request carrying a cache buster `_=…`
  never answered again, silently. It now says why on the next request (c4abc9b). An
  adversarial review found the first version could blame a rule for a page it was never
  meant for and offer a removal that made the rule lose for good; fixed with tests in
  77ed646. Observed in Necto: the next request showed "Rule: _=… · This request: _=…"
  beside the capture actions, "Remove the _ condition" removed it, and the request after
  was mocked.
- Movement on the "different data" recipe, from the walk's screen positions: 13 operations
  per loop, 2 window crossings, a Rules↔Traffic round trip and a Resume, and adding a host
  moved the lists 25 px. Now the rule editor shows the latest request the rule is meant for,
  following it while the traffic list is paused, and the header keeps two rows. Observed in
  Necto: adding a host left the tab bar at the same place; with the editor open and the
  traffic paused, reloading the app turned the line into "mocked by this rule" with the new
  time. Measured for one scenario only; the others are left for the next version.

Open from the walk: a request already mocked by a rule for every query offers only "Open
rule", so a rule for one query is made with "+ Rule" and "+ Condition"; a captured body
keeps the server's single line; a rule made with "+ Rule" keeps the ID of its first path
(`get`, `get-2`).

Findings fixed before this entry: JSON key order lost through the bridge, no reason line,
a duplicate rule when an off rule matched, controls that did not scale with text size,
the badge covering app titles, blocked hosts read as allowed, noisy captured headers.

### First-use test — 2026-10-05, build 811e910

Tester: a fresh agent with no context, who knew Necto but not this panel, working only from
the screen ([first-use-test.md](first-use-test.md)). Not a person: it doesn't tire or skim,
so read this as a lower bound on where a person gets stuck. App: an orders list with pages
on a local server.

| Task | Done | Actions | First move | Hesitations | Wrong turns | Hint |
| --- | --- | --- | --- | --- | --- | --- |
| 1 Empty list | yes | 10 | Traffic tab, then the empty-state link | "Path to create", "Headers left out: 3"; no Save button, a faint "Saved" | 2 swallowed clicks | none |
| 2 Error 500 and back | yes | 9 | "+ Response" | Is the selected tab the one the app gets? "Back to normal" meant the real server, so it turned the rule off | 2 swallowed clicks | none |
| 3 Three-second load | yes | 14 | Body type menu, for a "real but slow" mode | Delay exists only on a mocked response; had to capture the real response into the rule first | Body type and Error menus, 3 swallowed clicks | none |
| 4 Page 2 only | yes | 13 | "Load more" in the app | Which rule wins, "any query" or page=2? Nothing says | the form moved 15 px under the cursor after an edit | none |
| 5 Turn it all off | yes | 4 | the On switch | Does Off mean real server or block? Do allowed hosts still apply? | 1 swallowed click | none |

Their words: "Match path" for "Path to create"; "Network error" for "Error"; a "Map Local
off — rules paused" banner.

Answers: (1) Task 3: "slow" is something the real server does, and nothing points to
capturing the real response before Delay can help. (2) Viewing a response tab also makes it
live, with nothing marking the live one; selecting a traffic row paused the list; "Rule for
this query only" copied the mocked response and its delay rather than page 2's real data;
with Map Local off every rule still looked active and the editor still said "mocked by this
rule"; which rule wins is never stated; what allowed hosts gate stayed unclear. (3) Start in
Traffic and use the detail's buttons, which know the existing rules; trust the editor's
status line.

Defects found: the first click into Necto after the simulator was swallowed seven times
(Necto's own window behaviour); selecting a traffic row pausing the list (also hit on the
recipe walk); the editor's status line wrapping to two lines and moving the form.

Fixed before the rerun (38a2cda..63e9c0d): the latest-request line stays on one line; with
Map Local off a notice says no rule applies and the rules are dimmed; the response the app
gets has a dot on its tab; "Rule path", "Network error", "Server headers not copied" and
hover text for allowed hosts and the rule checkbox; the editor says which rule answers a
request two rules share; selecting no longer pauses the time view, and the strip counts
what came after the selection with "Show newest". Each was checked in Necto on 63e9c0d.

### First-use test, rerun — 2026-10-05, build 63e9c0d

A second fresh agent, same brief, same app and start state. It wrote one line of its notes
with a shell command, against the brief; nothing else outside the screen.

| Task | Done | Actions (first run) | Hesitations | Wrong turns | Hint |
| --- | --- | --- | --- | --- | --- |
| 1 Empty list | yes | 10 (10) | "Mock with this response" opens no editor; no Save button | none | none |
| 2 Error 500 and back | yes | 10 (9) | Does the dot mean served or selected? How to get the real list back after editing the captured response | the Status arrows step the number (200 → 199) instead of listing codes | none |
| 3 Three-second load | yes | 9 (14) | Delay exists only on a mocked response, and the captured response had been edited | the captured response tab | none |
| 4 Page 2 only | yes | 11 (13) | Would the broad rule hide the page=2 rule? The editor answered on screen | none | none |
| 5 Turn it all off | yes | 4 (4) | Does "everything" include deleting rules and the allowed host? | none | none |

Swallowed first clicks into Necto: 5 (7). Gone since the first run: the paused list, the
moving form, the question of which rule wins, the active-looking rules with Map Local off.

Their words: "Create rule" for "Mock with this response"; "Intercepted hosts" for "Allowed
hosts"; "Delay real response" or "Throttle"; "Map Local: On" for the master switch; response
tabs named by what they hold ("Real 200 (20:09)") rather than "Captured response 2". "Rule
for this query only" was "exactly my words".

Answers: (1) Task 3, again: "the real list, just slow" needs the captured response back,
and once edited it is gone with no way back but capturing again from Traffic. (2) "Mock with
this response" and "Rule for this query only" don't open the rule; the Status arrows
step; a rule for one query keeps the mocked response's delay and is named "Captured
response 2"; each rule's switch stays green while Map Local is off (only the notice said
otherwise); "On" beside "Allowed hosts" reads like a switch for the host list. (3) Start in
Traffic, use the detail's buttons and the editor's latest-request line.

Defects found: none new that block a task. Open for the next version: delaying the real
server (Task 3 in both runs), opening the rule after a capture, the Status control, the
master switch's place, and the per-rule switches while Map Local is off. Also seen while
checking: pressing "Turn on" in the off notice removes the notice and moves the rule list
up by its height under the pointer.

Acted on after the rerun (e13315d..7133677), each checked in Necto on 837218c: the header
switch reads "Map Local on/off" apart from the allowed hosts; the editor's rule switch is
muted while Map Local is off; "Turn on" in the notice leaves a same-height confirmation
until the pointer leaves the panel (the first rule row stayed at the same y); Status is a
text field with a "Common codes" menu, since WKWebView shows no datalist (checked: typing
and the down arrow showed nothing); a response is renamed in "Name" on Return; each tab
deletes its own response without making it live, and Undo restores it. Found while
checking: pausing on "5" while typing 503 saved 5 and the refusal pushed the editor down;
codes outside 100–599 are no longer saved. Left as they are: opening the rule after a
capture (its detail's primary action is already "Open rule"), and delaying the real server
(next version).

### After the toolchain change — 2026-10-06, build 4ce885d

macOS 27.0.1 and Xcode 27.1 beta (Swift 6.4) replaced macOS 26 and Xcode 26; the iOS 26.4
simulator runtime is gone. On this toolchain `script/ci` exits 0, release controls ① to ⑥
included (swift 160, vitest 1115). On an iPhone 18 Pro simulator (iOS 27.0) the QuickStart
example registers with Necto 0.2.0, takes a configuration from necto-cli, shows the badge, and
a request to an allowed host gets the rule's response (`200 {"mocked": true}`). Found there:
a URL in a localized `Button` title becomes a link on iOS 27 and opens Safari instead of
running the action, so the example's title is now `Text(verbatim:)`. Xcode 27 ships no
Simulator app; DeviceHub shows the simulator. The badge layout inputs were remeasured on
iOS 27.0 with a throwaway scene-based app: an iPhone 18 Pro keeps the 402×874pt screen, the
62pt/34pt safe area and the 54pt status bar, and its keyboard is 328pt (335pt on iOS 26.4);
an iPad Air 11-inch (M4) is unchanged. Not remeasured: whether the status bar keeps touches,
and when an alert action's handler runs. iOS 27 also stops an app without the UIScene
lifecycle at launch (`_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`), which
the first, non-scene measurement app hit.

### Not verified

- A cabled USB run on the device, and any device run on the release candidate.
- A call in flight at the instant the app disconnects.
- The badge on home-button iPhones, iPad, with the keyboard up, and above a tab bar; the save-failure alert from the badge sheet.
- The reverse registration order warning, and the panel without the network plugin, on
  the 0.1.0 code.
- Any run of the GitHub workflows, and App Store Connect validation of the
  separate-project example.
