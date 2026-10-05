//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { necto } from "@necto/bridge";

/// English source text is the key, as in Necto's built-in plugins, and the fallback for any
/// other language. Korean follows their tone (합니다체). Concepts the Network panel shares
/// use its wording, so the two panels read alike.
export const ko: Record<string, string> = {
  // Start-up
  "The Map Local panel works only inside Necto": "Map Local 패널은 Necto 안에서만 동작합니다",
  "Waiting for the app to connect…": "앱 연결을 기다리는 중…",
  "Run an app that registers Map Local, and select it in Necto":
    "Map Local을 등록한 앱을 실행하고 Necto에서 선택하세요",

  // Tabs
  Panel: "패널",
  Rules: "규칙",
  Traffic: "트래픽",

  // Header: switch, allowed hosts, unmatched requests, sharing
  "Turn on Map Local": "Map Local 켜기",
  "Map Local on": "Map Local 켜짐",
  "Map Local off": "Map Local 꺼짐",
  "Allowed hosts": "허용 호스트",
  "Only requests to these hosts can be mocked or blocked. The rest always go to the real server": "이 호스트로 가는 요청만 목업하거나 막을 수 있습니다. 나머지는 항상 실서버로 갑니다",
  "Remove from allowed hosts": "허용 호스트에서 빼기",
  "Remove {host} from allowed hosts": "{host} 허용 호스트에서 빼기",
  "Blocked by app code (can't be changed in the panel)": "앱 코드에서 차단(패널에서 바꿀 수 없음)",
  "Blocked in app code:": "앱에서 차단:",
  "+ Host": "+ 호스트",
  "Add an allowed host": "허용 호스트 추가",
  "Type a host, or pick one in the Traffic tab": "호스트를 입력하거나 트래픽 탭에서 골라 추가하세요",
  "{host} is already allowed": "{host} 호스트는 이미 허용돼 있습니다",
  "{host} is blocked by app code and can't be allowed": "{host} 호스트는 앱 코드에서 차단해 허용할 수 없습니다",
  "Can't read this as a host (e.g. api.example.com)": "호스트로 읽을 수 없습니다(예: api.example.com)",
  "Enter a Unicode host as punycode (xn--…)": "유니코드 호스트는 punycode(xn--…)로 입력하세요",
  "Requests without a rule": "규칙 없는 요청",
  "Send to the real server": "실서버로 보내기",
  "Block ({status})": "차단({status})",
  "Paste configuration": "설정 붙여넣기",
  "Copy configuration": "설정 복사",

  // Notices
  "The configuration is read-only.": "설정이 읽기 전용입니다.",
  "A mocked login session may remain in the app. Log out in the app before you turn off or delete an auth rule.":
    "목업 로그인 세션이 앱에 남아 있을 수 있습니다. 인증 규칙을 끄거나 지우기 전에 앱에서 로그아웃하세요.",
  "I've logged out": "로그아웃했습니다",
  "Couldn't save ({reason}): {message}": "저장하지 못했습니다({reason}): {message}",
  "It keeps changing elsewhere. Check what just arrived": "다른 곳에서 계속 바뀌고 있습니다. 새로 받은 내용을 확인하세요",
  Undo: "되돌리기",
  Close: "닫기",
  "Close notice": "알림 닫기",
  "Send this response to the app": "앱에 이 응답 보내기",
  "Open rule": "규칙 열기",

  // Rules list
  "Rule list": "규칙 목록",
  "+ Rule": "+ 규칙",
  "Turn on rule": "규칙 켜기",
  "New since you selected: {count}": "고른 뒤 새 요청 {count}개",
  "Map Local is on, so rules apply": "Map Local이 켜져 규칙이 적용됩니다",
  "Map Local is off, so this rule doesn't apply": "Map Local이 꺼져 있어 이 규칙은 적용되지 않습니다",
  "A code from 100 to 599": "100–599 사이의 코드",
  "Common codes": "자주 쓰는 코드",
  "Turn the rule on or off": "규칙 켜고 끄기",
  "This rule answers the requests it shares with {rule}": "{rule} 규칙에도 맞는 요청에는 이 규칙이 응답합니다",
  "{rule} answers the requests it shares with this rule": "{rule} 규칙에도 맞는 요청에는 그 규칙이 응답합니다",
  "It has more query conditions": "쿼리 조건이 더 많습니다",
  "It is higher in the list": "목록에서 더 위에 있습니다",
  "{count} more overlapping rules": "겹치는 규칙 {count}개 더",
  "Unsupported rule {id}": "미지원 규칙 {id}",
  "No rules yet — pick a request in the {traffic} and press [Mock with this response], or make one with [+ Rule]":
    "아직 규칙이 없습니다 — {traffic} 탭에서 요청을 골라 [이 응답으로 목업]을 누르거나 [+ 규칙]으로 직접 만드세요",
  // Inside the sentence above, which says 탭 itself so no particle follows the button.
  "Traffic tab": "트래픽",
  "Log out in the app before you turn off the auth rule. If a mocked token reaches the real server, a 401 can force a logout.":
    "인증 규칙을 끄기 전에 앱에서 로그아웃하세요. 목업 토큰이 실서버로 가면 401로 강제 로그아웃될 수 있습니다.",
  "Turn off": "끄기",
  "Log out in the app before you turn off Map Local. If a mocked token reaches the real server, a 401 can force a logout.":
    "Map Local을 끄기 전에 앱에서 로그아웃하세요. 목업 토큰이 실서버로 가면 401로 강제 로그아웃될 수 있습니다.",
  "Log out in the app before you remove this allowed host ({host}). If a mocked token reaches the real server, a 401 can force a logout.":
    "이 허용 호스트({host})를 빼기 전에 앱에서 로그아웃하세요. 목업 토큰이 실서버로 가면 401로 강제 로그아웃될 수 있습니다.",
  Remove: "빼기",
  "The rule {rule} is an auth rule. Once it is on, the app's next login gets a mocked token, and if that token reaches the real server, a 401 can force a logout.":
    "{rule} 규칙은 인증 규칙입니다. 켜면 앱의 다음 로그인이 목업 토큰을 받고, 그 토큰이 실서버로 가면 401로 강제 로그아웃될 수 있습니다.",
  "Log out in the app before you delete the auth rule “{rule}”. If a mocked token reaches the real server, a 401 can force a logout.":
    "{rule} 인증 규칙을 지우기 전에 앱에서 로그아웃하세요. 목업 토큰이 실서버로 가면 401로 강제 로그아웃될 수 있습니다.",
  Delete: "삭제",
  "Deleted the rule {rule}": "{rule} 규칙을 지웠습니다",
  "Couldn't undo: the rule {rule} is back": "{rule} 규칙이 다시 생겨서 되돌리지 못했습니다",

  // Rule editor
  Saved: "저장됨",
  "Delete rule": "규칙 삭제",
  "Close (Esc)": "닫기 (Esc)",
  "Close editor": "편집기 닫기",
  "Loaded an unsaved draft.": "저장되지 않은 초안을 불러왔습니다.",
  Discard: "버리기",
  Method: "메서드",
  Host: "호스트",
  "Empty means every allowed host": "비우면 허용 호스트 전체",
  Path: "경로",
  "Query conditions": "쿼리 조건",
  "Auth rule": "인증 규칙",
  "A response that hands out a login or token": "로그인·토큰을 내주는 응답입니다",
  "When on, the app shows a mocked session (🔑) while this rule responds, and you are reminded to log out in the app before you turn the rule off or delete it":
    "켜 두면 이 규칙이 응답할 때 앱에 목업 세션으로 표시하고(🔑), 규칙을 끄거나 지우기 전에 앱에서 로그아웃하라고 알립니다",
  "Response the app gets": "앱이 받는 응답",
  "The app gets the response {active} now": "앱은 지금 {active} 응답을 받습니다",
  "+ Response": "+ 응답",
  "Response {n}": "응답 {n}",
  "Delete the response “{name}”": "「{name}」 응답 삭제",
  Name: "이름",
  "Response name": "응답 이름",
  "Enter a name": "이름을 입력하세요",
  "A response with this name already exists": "같은 이름의 응답이 이미 있습니다",
  Status: "상태 코드",
  "Delay (ms)": "지연(ms)",
  "Network error": "네트워크 오류",
  None: "없음",
  "No internet connection (-1009)": "인터넷 연결 없음 (-1009)",
  "Connection lost (-1005)": "연결 끊김 (-1005)",
  "Timed out (-1001)": "시간 초과 (-1001)",
  Headers: "헤더",
  Body: "본문",
  Text: "텍스트",
  'Headers must be an object like {"name": "value"}': '헤더는 {"이름": "값"} 객체여야 합니다',
  "Couldn't read the JSON: {message}": "JSON을 읽지 못했습니다: {message}",
  '{message} — replace curly quotes (“ ”) with straight quotes (")':
    '{message} — 둥근 따옴표(“ ”)는 곧은 따옴표(")로 바꿔 주세요',
  "Deleted the response “{name}”": "「{name}」 응답을 지웠습니다",
  "Couldn't undo: the rule was deleted": "규칙이 지워져서 응답을 되돌리지 못했습니다",
  "Couldn't undo: a response named “{name}” already exists": "「{name}」 응답이 이미 있어 되돌리지 못했습니다",

  // Query conditions
  "Any query": "모든 쿼리",
  "+ Condition": "+ 조건",
  "Remove condition": "조건 지우기",
  "Remove the {key} condition": "{key} 조건 지우기",
  "Remove the empty condition": "빈 조건 지우기",
  "Query key": "쿼리 키",
  Key: "키",
  "Query value": "쿼리 값",
  Value: "값",
  "Enter a key": "키를 입력하세요",
  "A key can't contain = & ? #": "키에 = & ? #는 쓸 수 없습니다",
  "The same key already exists": "같은 키가 이미 있습니다",
  "%XX is decoded before matching — type the original characters (“{decoded}”)":
    "%XX는 풀어서 비교합니다 — 원래 글자로 입력하세요(「{decoded}」)",

  // Paste and copy the configuration
  'Configuration JSON or {"force": true, "configuration": …}': '설정 JSON 또는 {"force": true, "configuration": …}',
  Import: "가져오기",
  "Rules: {count} · allowed hosts: {hosts} · replaces the current configuration":
    "규칙 {count}개 · 허용 호스트 {hosts} · 지금 설정을 바꿉니다",
  "Imported rules: {count}": "규칙 {count}개를 가져왔습니다",
  "Not JSON: {message}": "JSON이 아닙니다: {message}",
  "The configuration has no version": "configuration에 version이 없습니다",
  'Not a configuration (an object with a version) or a {"configuration": …} envelope':
    '설정(version이 있는 객체) 또는 {"configuration": …} 봉투가 아닙니다',
  "Couldn't export: {message}": "내보내지 못했습니다: {message}",
  "Copied the configuration": "설정을 복사했습니다",
  "Copied the configuration — {warning}": "설정을 복사했습니다 — {warning}",
  "It contains values that look like tokens — check before you share it":
    "토큰처럼 보이는 값이 들어 있습니다 — 공유하기 전에 확인하세요",
  "Export configuration": "설정 내보내기",
  "The text is selected. You can also copy it with ⌘C": "글이 선택돼 있습니다. ⌘C로도 복사할 수 있습니다",
  Copy: "복사",
  "This window blocks the copy button. Keep the text selected and press ⌘C":
    "이 창에서는 복사 버튼이 막혀 있습니다. 글을 선택한 채 ⌘C를 누르세요",
  Confirm: "확인",
  Cancel: "취소",

  // List and detail split
  "List width": "목록 폭",
  "Drag or press ←→ to resize the list · double-click for the default width":
    "끌거나 ←→로 목록 폭 조절 · 두 번 누르면 기본 폭",

  // Traffic toolbar
  View: "보기",
  Endpoints: "엔드포인트",
  "By time": "시간순",
  "Find by path or query": "경로·쿼리로 찾기",
  "Allowed hosts only": "허용 호스트만",
  "No allowed hosts, so showing everything": "허용 호스트가 없어 전체를 보여 줍니다",
  "Click to show every host": "누르면 모든 호스트를 보여 줍니다",
  "Other hosts: {count}": "다른 호스트 {count}건",
  "Connection failed": "연결 실패",
  Result: "결과",
  Mocked: "목업",
  "Real server": "실서버",
  Blocked: "차단",
  Unknown: "확인 불가",
  Resume: "이어 보기",
  Pause: "일시정지",
  "Live · new requests show up at once": "실시간 · 새 요청을 바로 보여 줍니다",
  "Paused · no new requests": "일시정지됨 · 새 요청 없음",
  "Paused · new requests: {count}": "일시정지됨 · 새 요청 {count}개",
  "Mocked requests don't appear in Necto's records. Either Necto's network plugin was registered before Map Local, or the app uses a session other than URLSession.shared. Put NectoSDK.register(NectoMapLocalPlugin()) first":
    "목업 요청이 Necto 기록에 보이지 않습니다. Necto 네트워크 플러그인이 Map Local보다 먼저 등록됐거나, 앱이 URLSession.shared가 아닌 세션을 씁니다. NectoSDK.register(NectoMapLocalPlugin())을 먼저 두세요",

  // Traffic list
  "Request list": "요청 목록",
  Count: "횟수",
  Latest: "최근",
  Started: "시작 시간",
  Duration: "소요 시간",
  "{n}s ago": "{n}초 전",
  "{n}m ago": "{n}분 전",
  "{n}h ago": "{n}시간 전",
  "Waiting for the response": "응답을 기다리는 중",
  "Mocked ({rule} · {response})": "목업({rule} · {response})",
  "Mocked · rule {rule} · response {response}": "목업 · 규칙 {rule} · 응답 {response}",
  "Went to the real server without a rule": "규칙 없이 실서버로 갔습니다",
  "Blocked by Map Local: requests without a rule don't reach the network":
    "Map Local이 막았습니다: 규칙 없는 요청은 네트워크로 가지 않습니다",
  "Couldn't match this with Map Local's records, so the result is unknown":
    "Map Local 기록과 맞춰 보지 못해 결과를 알 수 없습니다",
  "Not an allowed host, so mocking and blocking don't apply": "허용 호스트가 아니라 목업·차단이 적용되지 않습니다",
  "(no query)": "(쿼리 없음)",
  "+{count} more": "외 {count}종",
  "Queries: {count}": "쿼리 {count}종",

  // Traffic detail
  "Clear selection": "선택 해제",
  "Hidden from the list because it doesn't match the current filters": "지금 필터에 맞지 않아 목록에서 숨겨졌습니다",
  "Clear filters": "필터 지우기",
  "No requests yet": "아직 요청이 없습니다",
  "Requests the app sends appear here": "앱에서 요청을 보내면 여기에 표시됩니다",
  "No requests match the filters": "필터에 맞는 요청이 없습니다",
  Newest: "최신",
  Older: "이전",
  "Newer call": "더 최신 호출",
  "Older call": "더 이전 호출",
  "New call available": "새 호출 있음",
  "Show newest": "최신 보기",
  "Register URLSessionNetworkPlugin after Map Local to see responses":
    "URLSessionNetworkPlugin을 Map Local 다음에 등록하면 응답을 볼 수 있습니다",
  "This request isn't in Necto's records, so its response can't be shown":
    "Necto 기록에 없는 요청이라 응답을 볼 수 없습니다",
  "The app has dropped this record (app relaunch or storage limit)":
    "이 기록은 앱에서 지워졌습니다(앱 재실행·보관 상한)",
  "Waiting for the response…": "응답을 기다리는 중…",
  "Loading…": "불러오는 중…",
  "Request headers": "요청 헤더",
  "Response headers": "응답 헤더",
  Truncated: "일부만 표시",
  "No response body.": "응답 본문이 없습니다.",

  // Capturing a response
  "Mock with this response": "이 응답으로 목업",
  "Add this response to the rule": "이 응답을 규칙에 추가",
  "Adds it as a response to the rule {rule}": "{rule} 규칙에 응답으로 더합니다",
  "Captured response": "캡처한 응답",
  "Map Local blocked this request, so there is no real response": "Map Local이 막은 요청이라 실제 응답이 없습니다",
  "This is already a Map Local response — edit it in the rule": "이미 Map Local 응답입니다 — 규칙에서 고치세요",
  "The request failed without a response": "응답 없이 실패한 요청입니다",
  "Still waiting for the response": "아직 응답을 기다리는 중입니다",
  "The body was cut off past 512KB": "본문이 512KB를 넘어 잘렸습니다",
  "The body isn't text, so it can't be carried over": "텍스트가 아닌 본문이라 옮길 수 없습니다",
  "Couldn't fetch the response": "응답을 가져오지 못했습니다",
  "The app code blocks this host, so it isn't mocked": "앱 코드에서 차단한 호스트라 목업되지 않습니다",
  "Add to allowed hosts ({host})": "허용 호스트에 추가 ({host})",
  "Edit the response in the rule": "규칙에서 응답을 고칩니다",
  "Leave this off to answer every request on this path, whatever the query":
    "비워 두면 쿼리와 상관없이 이 경로의 모든 요청에 응답합니다",
  "Only with this query ({query})": "이 쿼리일 때만 ({query})",
  "Makes an empty 200 JSON without a response": "응답 없이 빈 200 JSON으로 만듭니다",
  "Mock with an empty response": "빈 응답으로 목업",
  "Rule for this query only ({query})": "이 쿼리 전용 규칙 ({query})",
  "Map Local is off, so no rule applies": "Map Local이 꺼져 있어 어떤 규칙도 적용되지 않습니다",
  "The app gets this response": "앱이 받는 응답입니다",
  "Timed out": "시간 초과",
  "Connection lost": "연결 끊김",
  "No internet connection": "인터넷 연결 없음",
  "Mocking also adds {host} to the allowed hosts": "목업하면 {host} 호스트도 허용 호스트에 추가합니다",
  "No request for this rule yet — make one in the app": "이 규칙에 맞는 요청이 아직 없습니다 — 앱에서 요청하세요",
  "Latest request {time}": "최근 요청 {time}",
  "from before the last change": "마지막 변경 전 요청",
  "mocked by this rule ({response})": "이 규칙이 목업함 ({response})",
  "answered by the rule {rule}": "{rule} 규칙이 응답함",
  "went to the real server": "실서버로 감",
  "blocked by Map Local": "Map Local이 막음",
  "result unknown": "결과를 알 수 없음",
  "Show in Traffic": "트래픽에서 보기",
  "The rule {rule} didn't answer this request. Rule: {expected} · This request: {actual}":
    "{rule} 규칙이 이 요청에 응답하지 않았습니다. 규칙 조건: {expected} · 이 요청: {actual}",
  "no {key}": "{key} 없음",
  "The rule {rule} is an auth rule. Without the {key} condition it answers more login or token requests with a mocked token, and if that token reaches the real server, a 401 can force a logout.":
    "{rule} 규칙은 인증 규칙입니다. {key} 조건을 지우면 더 많은 로그인·토큰 요청에 목업 토큰으로 응답하고, 그 토큰이 실서버로 가면 401로 강제 로그아웃될 수 있습니다.",
  "Makes a rule that answers only this query, starting with the response the app gets now":
    "이 쿼리에만 응답하는 규칙을 만들고, 앱이 지금 받는 응답으로 시작합니다",
  "Add to that rule and turn it on": "그 규칙에 추가하고 켜기",
  "Adds it to the rule {rule}, makes it the response the app gets, and turns the rule on":
    "{rule} 규칙에 추가해 앱이 받는 응답으로 정하고 규칙을 켭니다",
  "Make a new rule": "새 규칙으로 만들기",
  "Added a response to the rule {rule} and turned it on — {when}": "{rule} 규칙에 응답을 추가하고 켰습니다 — {when}",
  "Rule path": "규칙 경로",
  "This path also catches: {paths}": "이 경로에도 걸립니다: {paths}",
  "Saved to the rule — {note}": "규칙에 저장했습니다 — {note}",
  "Mocking · applies from the next request": "목업 중 · 다음 요청부터 적용됩니다",
  "Added to the rule {rule} — the rule is off, so the app gets the real server's response":
    "{rule} 규칙에 추가했습니다 — 규칙이 꺼져 있어 앱은 실서버 응답을 받습니다",
  "Added to the rule {rule} — the app still gets another response":
    "{rule} 규칙에 추가했습니다 — 앱은 아직 다른 응답을 받습니다",
  "Added a response to the rule {rule}": "{rule} 규칙에 응답을 추가했습니다",
  "Created a mock for {rule} — {when}": "{rule} 목업을 만들었습니다 — {when}",
  "Created a mock for {rule} (empty 200 response) — {when}": "{rule} 목업을 만들었습니다(빈 200 응답) — {when}",
  "Applies from the next request": "다음 요청부터 적용됩니다",
  "Server headers not copied: {count}": "복사하지 않는 서버 헤더 {count}개",
  "Server headers not copied into the mock: {count}": "복사하지 않은 서버 헤더 {count}개",

  // Traffic detail: why a request a rule matches was not mocked
  "Map Local is off, so this wasn't mocked": "Map Local이 꺼져 있어 목업되지 않았습니다",
  "Turn on": "켜기",
  "{host} isn't an allowed host, so the rule {rule} didn't apply":
    "{host} 호스트는 허용 호스트가 아니라 {rule} 규칙이 적용되지 않았습니다",
  "Added to the rule {rule} — Map Local is off, so the app gets the real server's response":
    "{rule} 규칙에 추가했습니다 — Map Local이 꺼져 있어 앱은 실서버 응답을 받습니다",
  "The rule {rule} is off, so this wasn't mocked": "{rule} 규칙이 꺼져 있어 목업되지 않았습니다",
  "The app code blocks this host, so the rule {rule} never mocks it and the request goes to the real server":
    "앱 코드에서 차단한 호스트라 {rule} 규칙이 있어도 목업되지 않습니다 — 요청은 실서버로 갑니다",
  "The rule {rule} applies now — request again in the app": "지금은 {rule} 규칙이 적용됩니다 — 앱에서 다시 요청하세요",
  "The rule {rule} also matches, but {winner} takes precedence (more query conditions, or earlier in the list)":
    "{rule} 규칙도 맞지만 {winner} 규칙이 우선합니다(쿼리 조건이 더 많거나 목록에서 먼저)",

  // Messages from the app, by code (messages.ts). {key} and {place} are JSON paths
  "{key} must be an object": "{key} 값은 객체여야 합니다",
  "{key} must be an array": "{key} 값은 배열이어야 합니다",
  "{key} must be an array of strings": "{key} 값은 문자열 배열이어야 합니다",
  "{key} must be true or false": "{key} 값은 true 또는 false여야 합니다",
  "{key} must be a string": "{key} 값은 문자열이어야 합니다",
  "{key} must be an integer of {min} or more": "{key} 값은 {min} 이상의 정수여야 합니다",
  "{key} must be an integer from {min} to {max}": "{key} 값은 {min}~{max} 사이의 정수여야 합니다",
  "{key} must be one of: {choices}": "{key} 값은 다음 중 하나여야 합니다: {choices}",
  "Unsupported key in {place}: {key}": "지원하지 않는 키가 있습니다: {key} (위치: {place})",
  "{key} is required": "{key} 값이 필요합니다",
  "{key} has a value that can't be read as a host: {value}": "{key} 값을 호스트로 읽을 수 없습니다: {value}",
  "match.path must start with /": "match.path는 /로 시작해야 합니다",
  "match.path can't contain a query or a fragment; use match.query":
    "match.path에는 쿼리나 프래그먼트를 넣을 수 없습니다. match.query를 쓰세요",
  "match.path must be percent-encoded, as the app sends it: {value}":
    "match.path는 앱이 보내는 대로 퍼센트 인코딩해야 합니다: {value}",
  "responses must have at least one response": "responses에 응답이 하나 이상 있어야 합니다",
  "active must name one of the responses": "active는 responses에 있는 응답 이름이어야 합니다",
  "{key} needs a status or an error": "{key} 항목에는 status나 error가 필요합니다",
  "Duplicate id: {id}": "id가 중복됩니다: {id}",
  "Configuration version {version} is newer than this plugin supports ({supported})":
    "설정 파일의 버전({version})이 이 플러그인이 지원하는 버전({supported})보다 새 버전입니다",
  "authMocked can only be false, which clears the mocked session":
    "authMocked는 목업 세션을 해제하는 false만 보낼 수 있습니다",
  "authMocked can't be sent with other keys": "authMocked는 다른 키와 함께 보낼 수 없습니다",
  "order must list every rule id exactly once": "order에는 모든 규칙 id가 한 번씩 들어 있어야 합니다",
  "Not a write operation": "쓰기 오퍼레이션이 아닙니다",
  "No rule '{rule}'": "{rule} 규칙이 없습니다",
  "No response '{response}'": "{response} 응답이 없습니다",
  "Changed elsewhere first. Get the latest configuration and try again":
    "다른 곳에서 먼저 바꿨습니다. 최신 설정을 다시 받으세요",
  "The configuration is read-only (see issues)": "설정이 지금 읽기 전용입니다(알림 참고)",
  "Couldn't save the configuration: {error}": "설정을 저장하지 못했습니다: {error}",
  "The Map Local engine isn't running": "Map Local 엔진이 실행되고 있지 않습니다",
  "The app refused the input: {detail}": "앱이 입력을 거부했습니다: {detail}",
  "The app doesn't offer this right now: {detail}": "지금은 앱에서 이 기능을 쓸 수 없습니다: {detail}",
  "The app couldn't do it: {detail}": "앱이 요청을 처리하지 못했습니다: {detail}",
  "The app disconnected": "앱 연결이 끊겼습니다",
  "The app didn't answer in time": "앱이 제시간에 응답하지 않았습니다",
  "Couldn't read the configuration file, so it opens read-only and won't be overwritten: {error}":
    "설정 파일을 읽지 못해 덮어쓰지 않도록 읽기 전용으로 엽니다: {error}",
  "Couldn't read the configuration file, so it was moved aside to {file}":
    "설정 파일을 읽지 못해 다른 이름으로 백업했습니다: {file}",
  "Configuration version {version} is newer than this plugin, so it is read-only":
    "설정 파일의 버전({version})이 이 플러그인보다 새 버전이라 읽기 전용입니다",
  "Rule {rule}: {cause}": "규칙 {rule}: {cause}",
};

export const t = necto.createTranslator({ ko });
