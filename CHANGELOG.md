# Changelog

## 0.1.0
- Define endpoint responses in a Necto panel and apply them at once: rules, switching responses, delays, errors, and blocking or failing requests without a rule
- Rule matching on method, host, path template (`{id}`) and query conditions. When several rules match, the one with the most query conditions responds. A rule path is written percent-encoded, as requests are matched; a path with a raw space or non-ASCII characters is refused
- Traffic tab: endpoint and chronological views, status and result filters, path and query search, pause, viewing responses, and "Mock with this response" (reusing the Necto network plugin's records). Mocking also adds the request's host to the allowed hosts, and a one-line JSON body is indented for editing by its whitespace only
- Selecting a request keeps the chronological list flowing: the selection stays in place, the line above the list counts what came after it under the current filters, and "Show newest" goes to the latest. Only "Pause" freezes the list
- "Rule for this query only" makes a rule with a request's query as its conditions when a rule mocks it for every query. When a rule made from traffic doesn't answer a later request, the detail says which condition missed, and offers to drop the condition only when the rule would then answer
- The rule editor says, under the query conditions, which rule answers a request it shares with another rule and why, as the engine decides across all rules; its latest-request line shows what happened to that request and opens it in Traffic
- Responses: each tab says what it holds (status, network error, delay), a dot marks the one the app gets, "Name" renames a response, and each tab's × deletes it without making it the one the app gets. Status takes a typed code or one from "Common codes"; a code outside 100–599 is not saved
- Keyboard: ↑↓ to move through a list, ⌘↩ to mock, `/` to search. Deleting offers undo instead of asking first
- Add allowed hosts by typing them or by picking them from traffic. The header reads "Map Local on/off"; while it is off, a notice says no rule applies and the rules are dimmed
- "+ Rule" starts a rule off until its path is first edited, so an empty rule answers nothing
- "Paste configuration" shows what the pasted text holds before importing it
- Captures, configuration copies and the request log carry values as they are, as Necto's network records do. Copying the configuration warns in one line when something looks like a token
- Import and export, and necto-cli operations
- The panel follows Necto's language setting, in English or Korean. Failures and issues from the app carry a stable `code` and English text, which the panel translates; the in-app badge follows the device language
- Rules apply whenever Map Local is on, with or without Necto. The in-app badge shows only when something applies (a rule answers an allowed host, requests without a rule are blocked or failed, or a mocked session may remain), and nothing otherwise; the "no allowed hosts" badge is gone
- Tap the badge to see what applies and turn Map Local off. It writes the same switch as the panel, so the panel follows, and it reminds you to log out first when a mocked token could reach the real server. Only the pill takes touches, it sits beside the home indicator, and it hides while the keyboard is up
- Plugin ID `io.github.ryan-son.maplocal`, kept stable from this release on
- `NectoMapLocalPlugin.protocolClass`, for apps and SDKs that set a configuration's `protocolClasses` themselves: put it in front of the list to keep Map Local. The URL protocol class behind it is internal
- Strict input schemas for every operation (required keys, types, enums, limits, `additionalProperties: false`) and descriptions that say where inputs come from, so `necto-cli plugin help` and coding agents can build valid input. Output schemas declare the success and `ok:false` branches
- Only `conflict` and `readOnly` answer as `ok:false` data. Malformed input throws `INVALID_INPUT`, a missing rule or response `OPERATION_UNAVAILABLE`, a failed save `PROVIDER_FAILED`, so the CLI exits nonzero; the panel translates them. When Necto's network plugin is unavailable, the traffic tab shows Necto's reason as-is
- Contract versioning: every `necto.device.maplocal.*` binding starts at version 1. A breaking change to an operation's input, output or error model ships under a new binding version; additive changes do not
- Plugin code is excluded from Release builds, with a script that checks release archives and control builds that prove it
