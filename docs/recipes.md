# Recipes

[한국어](recipes-ko.md)

Short paths for common jobs. Each one assumes the [Quick start](../README.md#quick-start)
is done: the app registers Map Local, and its panel is open in Necto. Labels are the
panel's English ones. [usage.md](usage.md) explains every control.

Every recipe ends the same way: make the app send the request again (reload, or reopen the
screen). The app shows the `Map Local` badge while something applies.

When you come back to Necto from the simulator, the first click only brings the Necto
window forward, in every Necto panel. Click again.

- [See a screen with different data](#see-a-screen-with-different-data)
- [Show an error screen](#show-an-error-screen)
- [Check a loading state](#check-a-loading-state)
- [Act as if the app were offline](#act-as-if-the-app-were-offline)
- [Build against an API that isn't ready](#build-against-an-api-that-isnt-ready)
- [Answer one query differently](#answer-one-query-differently)
- [Mock a login](#mock-a-login)
- [Share a setup](#share-a-setup)
- [Find out why a request wasn't mocked](#find-out-why-a-request-wasnt-mocked)
- [Stop mocking](#stop-mocking)

## See a screen with different data

An empty list, a long name, a case the server rarely returns.

1. In "Traffic", select the request behind the screen.
2. Press "Mock with this response" (⌘↩). The new rule starts with the response the app
   just got, and its host is added to the allowed hosts if it wasn't.
3. Press "Open rule", and edit the body. It saves as you type.
4. Request again in the app.

The line under the rule's name follows the newest request the rule is meant for, so you
confirm the change without leaving the editor: it now reads "mocked by this rule", and the
app shows your data. A request from before your last change says so, so an old answer is
never taken for the new one. "Show in Traffic" opens that request. Responses are visible
only with Necto's network plugin registered ([Capturing real responses](usage.md#capturing-real-responses)).
Without it, the button is "Mock with an empty response" and the rule starts with an empty
200 JSON body.

## Show an error screen

1. Open the request's rule: "Open rule" in the traffic detail, or the rule in "Rules".
   Make one first with the recipe above if there is none.
2. Press "+ Response". The new response sits next to the first one, and the app gets it
   from now on.
3. Set "Status" to the code your app handles, such as 500 or 401, and the body it expects.
   "Common codes" beside the field lists the usual ones. "Name" renames the response, say to
   "server down"; it is applied on Return or when you leave the field.
4. Request again in the app.

Each tab says what its response is, such as "200", "500" or "No internet connection", so
the normal and the error one are told apart at a glance.

![The rule editor with a second response set to 500, beside the app showing its error](images/recipe-error.png)

The tabs under "Response the app gets" switch what the app gets. Select the first one to go
back. Keep both, and moving between the normal and the error screen is one click. The ×
on a tab (on the shown tab, or any tab under the pointer) deletes that response without
making it the one the app gets, and Undo brings it back.

## Check a loading state

Set "Delay (ms)" on the response the app gets, for example `3000`. The app waits that long
for it, so the loading indicator stays on screen.

## Act as if the app were offline

To make every request to the allowed hosts fail, set "Requests without a rule" to "No
internet connection (-1009)". Each request no rule answers then fails with that `URLError`.
Rules still answer, so turn off the ones that should fail too. "Connection lost (-1005)" and
"Timed out (-1001)" are there too.

To fail one request only, set "Network error" on the response the app gets instead. The app gets
the error whatever the status says. Set it back to "None" to return to the response.

Map Local fails requests. It does not change what the device reports about its network, so
`NWPathMonitor` still says the device is connected. If your app shows its offline state
from that, take the device offline instead: airplane mode, or the Network Link Conditioner
(Settings › Developer on a device).

## Build against an API that isn't ready

1. Press "+ Rule". The new rule starts as `GET /`, off, and turns on when you change its
   path, so a half-made rule never answers anything.
2. Choose the method and write the path. A segment like `{id}` matches any one segment, so
   `/api/orders/{id}` answers `/api/orders/1001` and `/api/orders/1002`.
3. Leave "Host" empty to answer every allowed host, or name one.
4. Write the response you agreed on with the server team: "Status" and "Body".
5. Make sure the host is in "Allowed hosts" (the "+ Host" field in the header).

When the real API ships, turn the rule off and the app goes back to the server.

## Answer one query differently

Page 2 empty while page 1 stays as it is, or one item that fails.

When no rule answers the request yet:

1. In "Traffic", select the request with that query, such as `?page=2`.
2. If no rule answers it yet, check "Only with this query" and press "Mock with this
   response". If a rule already answers it for every query, press "Rule for this query
   only (page=2)" instead; the new rule starts with the response the app gets now.
3. Open the rule, and edit the response.

Every key of the request's query becomes a condition. If one changes on every request,
such as a cache buster `_=1696500000`, the next request says which condition the new rule
failed on, with "Remove the _ condition" beside it. The panel follows the rule only until it
first answers, so a rule for page 2 says nothing about page 3 after that.

You can also make one by hand: "+ Rule" with the same method and path, then "+ Condition"
under "Query conditions" with the key and value, such as `page` and `2`.

When several rules match, the one with more query conditions answers, so `?page=2` gets the
new rule and every other page keeps the first one
([When several rules match](usage.md#when-several-rules-match)). Each rule's editor says
so under its query conditions, and the traffic detail names the rule that took precedence.

## Mock a login

1. Make a rule for the login or token request, and turn on "Auth rule". Give it the status
   and body of a successful login.
2. Set "Requests without a rule" to "Block (421)". A request you haven't mocked then gets
   421 instead of carrying the mocked token to the real server, where it would fail with
   401 and could log the app out.
3. Log in, and mock the requests the app sends next. Each one that still gets 421 shows as
   "Blocked" in "Traffic".

While the auth rule answers, the badge reads `Map Local 🔑`, and the panel says a mocked
session may remain. **When you're done, log out in the app first**, then press "I've
logged out" in the panel. Turning the rule or Map Local off before that asks you to log out
first.

## Share a setup

To hand a teammate or QA the exact responses you used:

1. Press "Copy configuration". The text is selected in a window. Press "Copy" or ⌘C. The
   panel warns in one line when the configuration holds values that look like tokens, as
   it does with an auth rule. Check them before you share.
2. Send the text. The other person presses "Paste configuration" and pastes it. A line
   under the text says how many rules and which hosts it holds, and that it replaces their
   current configuration. Then they press "Import".

Allowed hosts, "Requests without a rule" and every rule come along. From a terminal or a
script, `necto-cli` does the same ([cli.md](cli.md)).

## Find out why a request wasn't mocked

Select the request in "Traffic". When a rule matches a request that was not mocked, the
detail says why in one line, with the fix beside it:

![The traffic detail saying a rule is off, with "Turn on rule" beside it](images/recipe-why-not-mocked.png)

| The detail says | Fix |
| --- | --- |
| Map Local is off | "Turn on" |
| The host isn't an allowed host | "Add to allowed hosts" |
| The rule is off | "Turn on rule" |
| The app code blocks this host | Nothing in the panel: the app's `blockedHosts` keeps it from being mocked |
| The rule applies now | Request again in the app |
| A rule just made from traffic didn't answer. Rule: `_=100` · This request: `_=200` | "Remove the _ condition", offered when removing it makes the rule answer this request |

When no rule matches at all, compare the method, path and query with the rule. A dimmed
host in the row means it is not an allowed host. More in [Troubleshooting](usage.md#troubleshooting).

## Stop mocking

- From the panel: turn off the "Map Local on" switch in the header.
- From the app: tap the `Map Local` badge, then "Turn off Map Local". The panel follows.

<img src="images/recipe-badge.png" alt="The badge's sheet listing the rules that apply, with Turn off Map Local" width="300">

Rules stay as they are, ready for next time. Turning Map Local back on is done from the
panel or `necto-cli`, not from the app.
