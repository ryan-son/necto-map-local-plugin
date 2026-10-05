# Map Local — 설계 결정

[English](design.md)

지금 플러그인의 모양을 정하는 결정과 각각의 이유예요. 코드가 아직 따르는 결정만 적어요.
결정이 바뀌면 이 문서도 함께 고쳐요. 패널이 어떻게 보이고 동작하는지는
[experience-ko.md](experience-ko.md)가, 플러그인 사용법은 [usage-ko.md](usage-ko.md)가 정해요.

상류(Necto) 참조는 이 릴리스가 해석하는 Necto 0.2.0 기준이에요.

## 목표

Necto 패널에서 엔드포인트 응답을 정하면 실행 중인 앱이 다음 요청부터 그 응답을 받아요.
인증서도 프록시도 없고, 앱 코드는 플러그인 등록뿐이에요. 규칙이 없는 요청은 실제 서버로 가요.
프록시도 같은 일을 하지만 기기마다 인증서를 신뢰시켜야 하고 SSL 피닝 아래서는 동작하지
않아요. 프로세스 안에서 가로채면 두 문제가 모두 없어요.

## 가로채기

**`URLProtocol`을 프로세스에서 한 번 설치해요.**
`MapLocalInstaller`가 `MapLocalURLProtocol`을 등록하고(`URLSession.shared`를 덮어요)
클래스 getter `URLSessionConfiguration.default`·`.ephemeral`을 바꿔, 이후 앱이 만드는 모든
구성이 기존 프로토콜 목록을 유지한 채 우리 프로토콜을 맨 앞에 둬요
(`Sources/NectoMapLocalPlugin/MapLocalInstaller.swift`).
- getter를 바꾸는 이유: 구성으로 만든 세션은 `registerClass`를 보지 않고, 앱이 프로토콜을
  직접 넣게 하고 싶지 않아요.
- `static let` 뒤의 `method_setImplementation`인 이유: 플러그인은 여러 번 생성될 수 있어요.
  구현 교환(exchange)은 두 번째 호출에서 원래대로 돌아가고, 한 번의 교체는 유지돼요.
- 앱이 `protocolClasses`를 통째로 바꾼 구성은(일부 SDK가 그렇게 해요) 우리 프로토콜을 잃어요.
  앱은 `NectoMapLocalPlugin.protocolClass`로 되살려요. Necto가
  `NectoURLSessionCapture.protocolClass`를 내놓듯, 이것이 그 클래스를 가리키는 유일한 공개
  통로예요. `MapLocalURLProtocol` 자체는 internal이라 앱을 깨지 않고 이름을 바꾸거나 나눌 수 있어요.
- `protocolClasses` 인스턴스 getter까지 바꾸지 않는 이유: 실측해 보면 등록 전에 만든 세션과
  통째로 바꾼 목록도 덮지만, CFNetwork가 세션을 만든 뒤 그 getter를 읽기 때문에만 동작해요.
  새 OS가 바꿀 수 있는 비공개 동작이에요. 공개 `protocolClass`와 문서화한 한계가 더 안전한 선택이에요.
- 엔진은 프로세스에 하나예요(`MapLocalRuntime.installIfNeeded`,
  `Sources/MapLocalCore/MapLocalEngine.swift`). Necto가 쥔 인스턴스와 `URLProtocol`이 같은
  엔진을 읽어요. 두 번째 플러그인 인스턴스는 차단 호스트까지 포함해 그 엔진을 그대로 써요.

**결정은 요청이 아니라 태스크에 묶어요.**
`canInit(with: URLSessionTask)`는 태스크마다(리다이렉트 홉마다) 한 번 불려요. 여기서
결정하고, 규칙이 없으면 통과로 기록하고, 맞는 결정은 `TaskDecisions`에 넣어
`startLoading()`이 꺼내게 해요(`MapLocalURLProtocol.swift`).
- 요청에 새기지 않는 이유: 앱이 `currentRequest`를 복제해 URL이나 메서드를 바꿔 보내면
  옛 결정이 따라가요.
- `startLoading()`은 그사이 설정이 바뀌어도 태스크 시작 때의 결정으로 응답하고, 목업
  기록도 여기서 정확히 한 번 남겨요.
- `canInit(with: URLRequest)`는 본문 스트림을 읽지 않아요. 읽으면 매칭되지 않은 실제
  요청이 빈 본문으로 나가요.
- 응답은 `cacheStoragePolicy: .notAllowed`로 보내고 `requestIsCacheEquivalent`는 늘
  false예요. 목업이 `URLCache`에 들어가거나 거기서 나오지 않아요.
- 목업 응답에는 `X-Map-Local: <규칙>/<응답>`, 차단 응답에는 `X-Map-Local: unmocked`가
  붙어요(`Sources/MapLocalCore/Matcher.swift`). 트래픽 탭은 이 헤더로 요청의 결과를 알아요.
  규칙이든 규칙 없는 요청이든 오류로 실패한 요청은 응답이 없어 헤더도 없어요. 그 결과는
  엔진의 기록에서 오고, 실패한 상세가 그것을 뒤집지 않아요.
- 지연은 주입한 `Clock`으로 기다리고 마감 시각은 `startLoading()`에서 정해요. 테스트가
  실제 시간 없이 돌고, `Task`가 늦게 돌아도 지연이 늘지 않아요.

**이 방식에서 오는 한계**(usage-ko.md의 「알려진 한계」에도 있어요):
- `NectoSDK.register`보다 먼저 만든 세션·구성은 가로채지 않아요.
- 백그라운드 세션, `WKWebView`, WebSocket, `URLSession`을 거치지 않는 스택은 범위 밖이에요.
- 목업 `Set-Cookie`는 `HTTPCookieStorage.shared`에 들어가요. 세션 고유 쿠키 저장소에 닿는
  공개 API가 없어요.
- 목업 3xx는 리다이렉트로 따라가지 않아요.
- Necto 자체 연결은 `URLSession`이 아니라 소켓이라 Map Local이 보지 않아요.

## 호스트

**허용한 호스트가 없으면 아무것도 목업하지 않아요.**
`Matcher.decide`는 차단되지 않은 허용 호스트로 가는 요청만 봐요. 목록이 비면 아무것도
목업하지 않으므로, 패키지를 넣는 것만으로 앱의 통신이 바뀌지 않아요.

**차단 호스트는 앱 코드에서 받고, 절대 목업하지 않아요.**
`NectoMapLocalPlugin(blockedHosts:)`는 운영 서버 같은 호스트를 받아요. 패널에서 바꿀 수
없고, 허용 호스트에 있어도 건너뛰어요.
- 앱 코드인 이유: 보호가 누군가의 패널 조작에 달려 있으면 안 돼요.
- 실패시키지 않고 통과시키는 이유: 기본 환경이 운영인 Debug 빌드가 플러그인을 넣자마자
  조용히 오프라인이 돼요.
- 그래서 이름의 뜻은 「절대 목업하지 않음」이지 「절대 닿지 않음」이 아니에요. 차단 호스트로 가는
  요청은 실서버로 그대로 가요. 실측: 운영을 가리키는 새로 설치한 앱이 인증 없는 검색을 그대로
  운영으로 보냈어요. usage-ko.md와 트래픽 상세가 그렇게 말해요.

**규칙 없는 요청은 막거나 실패하게 할 수 있어요.**
`unmatched`는 `passthrough`, `block`(기본 상태 421, `Sources/MapLocalCore/Configuration.swift`의
`Unmatched.defaultBlockStatus`), `fail`(기본 오류 `notConnectedToInternet`) 중 하나예요. 둘 다
허용 호스트에만 적용돼요.
- 이유: 인증을 목업하면 목업 안 된 요청이 가짜 토큰을 실제 서버로 싣고 가 앱이 스스로
  로그아웃할 수 있어요.
- 421인 이유: 앱은 흔히 5xx를 재시도하고 401·403·404를 세션 무효로 봐요. 421은 거의
  처리하지 않으므로 빠진 목업이 그대로 드러나요.

**호스트 정규화는 한 곳에서 해요.** 허용·차단·규칙·기록 호스트에서 스킴·포트·끝 점·
대소문자를 걸어요(`HostName.normalize`). Swift와 패널이 `Fixtures/host-cases.json`의 같은
사례를 읽어요. 유니코드 호스트는 엔진이 퍼센트 인코딩된 채 받으므로 퓨니코드로 적어요.

## 매칭

메서드, 호스트(없으면 허용 호스트 전체), 경로, 쿼리 조건이 모두 맞아야 규칙이 맞아요
(`Matcher.swift`).
- 경로는 퍼센트 인코딩된 형태로 조각마다 비교해요. `{name}`은 비지 않은 아무 조각에 맞고,
  접두사에는 맞지 않아요(`Sources/MapLocalCore/PathTemplate.swift`).
- **규칙 경로는 요청처럼 퍼센트 인코딩해서 적어야 해요**: 조각마다 `{name}` 템플릿이거나
  RFC 3986 경로 문자와 `%XX`만 담아요. 그 밖의 문자가 있는 경로(`/x y`, `/검색`)는
  `pathNotEncoded`로 거절하고, 파일에 있는 그런 규칙은 적힌 그대로 두되 적용하지 않아요
  (`PathTemplate.isEncoded`, `Panel/src/traffic/match.ts`의 `isEncodedPath`,
  `Fixtures/path-cases.json`).
  - 인코딩해 주지 않고 거절하는 이유: 맞힐 하나의 인코딩이 없어요. 엔진은 앱이 URL에 적은
    그대로의 경로와 비교하고, `{name}`의 중괄호는 경로 문자가 아니어서 인코더에는 예외가
    필요하며, 그래도 끝내 맞지 않는 경로를 조용히 만들 수 있어요. 트래픽에서 만든 규칙은 이미
    앱이 보낸 경로를 담고, 코덱은 적힌 것을 고쳐 쓰지 않고 그대로 둬요.
- 쿼리 조건은 적은 키가 모두 정확히 그 값으로 있을 때 맞아요. 값은 퍼센트 인코딩을 푼 뒤
  비교하고, `+`를 공백으로 바꾸지 않으며, 같은 키는 마지막 값을 써요. 적지 않은 키는 보지
  않아요.
- **맞는 규칙이 여럿이면 구체성이 정해요**: 쿼리 조건이 더 많은 규칙이 이기고, 같으면 목록
  순서예요. 이유: 목록 순서만 쓰면 같은 경로의 일반 규칙 뒤에 둔 `?page=2` 규칙이 죽어 있었어요.
  구체성은 그런 규칙을 살리기만 하고, 순서 바꾸기 화면이 필요 없어요.
- 켜져 있고 활성 응답이 실제로 있는 규칙만 후보예요.

패널은 캡처가 어느 규칙에 들어갈지 예측하려고 매처를 TypeScript로 옮겼어요
(`Panel/src/traffic/match.ts`). 두 쪽이 `Fixtures/matcher-cases.json`을 함께 읽어 조용히
갈라지지 않아요.

## 설정

**쓰기는 기준 revision을 실어요.**
Necto는 오퍼레이션마다 별도 `Task`를 만들어 순서를 지키지 않고(Necto 0.2.0,
`Sources/NectoSDK/NectoSDKRuntime.swift`), 패널과 CLI가 동시에 쓸 수 있어요. 모든 쓰기는
`baseRevision`을 보내고, 엔진은 낡은 값을 `conflict`로 거부하며, 반영·저장·방송을 한 잠금
안에서 revision 순서로 해요(`MapLocalEngine.apply`). 패널은 쓰기를 하나씩 보내고 충돌은 한
번 재시도해요(`Panel/src/writer.ts`). 공유 파일 가져오기는 기기의 revision을 알 수 없으므로
`configuration.replace`에 `force: true`를 써요.

**앱에 저장하고, Map Local이 켜져 있으면 늘 적용해요.**
`FileConfigurationStore`는 `Application Support/NectoMapLocal/configuration.json`을 원자적으로
쓰고, 플러그인 생성 시 동기로 읽어요(`Sources/MapLocalCore/ConfigurationStore.swift`). 다시
켠 앱은 첫 요청부터 목업해요.
- 규칙은 결정적이에요. 켜져 있으면 Necto 연결과 상관없이 규칙이 적용되고, 꺼져 있으면 아무것도
  적용되지 않아요. Necto를 기다리거나 요청을 붙잡거나 어떤 패널이 열려 있는지에 기대지 않아요.
  무언가 적용되는 동안 배지가 보이고, 배지를 누르면 Map Local을 끌 수 있어요(아래 「배지와 앱 안의
  제어」).
- 이유: 실측으로 앱은 실행 후 0.1–2초 뒤에 Necto에 연결되고, 실행 직후 요청은 그 전에 나가요.
  연결에 묶으면 같은 실행이 타이밍에 따라 목업되기도 하고 안 되기도 하며, Necto가 곁에 없는
  사람은 그것을 알 수도 바꿀 수도 없어요.

**불러오다가 설정을 잃지 않아요.**
- 올바른 설정이 아닌 파일은 `configuration.corrupt-<시각>.json`으로 옮기고 빈 설정으로
  시작해요.
- 있는데 읽을 수 없는 파일(예: 첫 잠금 해제 전 데이터 보호)은 읽기 전용으로 열어, 다음
  저장이 덮어쓰지 못하게 해요.
- 더 새 버전의 파일은 읽기 전용으로 열어요.
- 이 빌드가 적용할 수 없는 규칙(모르는 키, 잘못된 타입, 중복 id)은 지원하지 않는 항목으로
  보존해 적용하지 않고, 읽은 그대로 다시 써요(`RuleEntry.unsupported`). 새 플러그인이 만든
  규칙이 옛 플러그인에서 사라지지 않아요.

**편집은 즉시 저장해요.** Necto는 앱이 다시 연결되거나 다른 패널로 옮길 때 패널 WebView를
새로 만들어요. 그래서 저장 버튼이 없어요. 필드는 짧은 디바운스 뒤 저장되고, 완성되지 않은 글은
`규칙/응답`별로 패널 `localStorage`에 둬요(`Panel/src/drafts.ts`). 상태의 `launchID`가 바뀌면
패널은 앱이 다시 켜졌음을 알아요. revision만으로는 알 수 없어요(`EngineState.launchID`).

**JSON 본문은 텍스트로 저장해요.** 패널은 JSON 모드로 쓴 본문, 캡처한 본문, 새 규칙·응답의 빈 200을
입력한 그대로, 서버가 보낸 그대로 `body`(문자열)로 저장해요. `json`(파싱한 값)은 손으로 쓴 파일을 위해 남아요.
한 줄로 온 캡처 JSON 본문은 편집하기 좋게 들여 써요(`Panel/src/json.ts`의 `indentJSON`). 공백만
바뀌고 값·키 순서·중복 키는 그대로예요. 파싱한 뒤 다시 쓰지 않으니 2^53을 넘는 숫자도 반올림되지
않아요. 들여쓰기는 쉼표 수 × 깊이만큼 커지므로, 깊이가 100을 넘거나 네 배 넘게 커질 본문은 한 줄
그대로 둬요.
- 이유: `NectoJSONValue`와 엔진의 `JSONValue`는 객체를 Swift 딕셔너리에 담아요. 그래서 파싱한
  값은 상태 에코마다 키 순서가 바뀌어 돌아왔고, 입력 중에 본문 편집기가 뒤섞였으며 서버 응답과
  비교할 수 없었어요. 브리지를 그대로 건너는 것은 문자열뿐이에요.
- 엔진은 텍스트 본문에 콘텐츠 타입을 붙이지 않으므로, 패널이 콘텐츠 타입이 없는 JSON 모드 본문에
  `Content-Type: application/json`을 붙여요(엔진이 `json`에 하던 것과 같아요). 단, 예전 `json`
  본문, 본문이 없는 응답, 편집기에서 JSON으로 바꾼 본문에만 붙여요. JSON으로 읽히기만 하는 텍스트
  본문은 콘텐츠 타입 없이 나갔으므로 그대로 둬요. 편집기는 JSON 객체나 배열로 읽히는 본문을 JSON
  모드로 열어요.
- 패널은 에코와 편집 중인 내용을 모든 객체의 키를 정렬해 비교해요. 순서만 다른 에코는 화면의
  내용을 바꾸지 않아요.

## 인증 규칙과 목업 세션

`auth` 태그가 붙은 규칙은 로그인이나 토큰을 내줘요. 그런 규칙이 응답하면 엔진은 앱에 목업
세션이 남아 있을 수 있다고 표시하고, 그 표시를 설정 옆에 저장해 다시 켜도 유지하며, 배지에
보여요(`MapLocalEngine.recordMocked`). 해제는 `configuration.patch {"authMocked": false}`로만
하고, 패널은 사용자가 로그아웃을 확인할 때 이를 보내요. 세션이 남아 있을 수 있는 동안 인증 규칙
끄기·지우기, Map Local 끄기, 인증 규칙이 응답하는 허용 호스트 빼기는 모두 한 질문(`View.askFirst`)으로
먼저 물어요. 트래픽 상세에서 인증 규칙을 켤 때도 물어요. 다음 로그인이 목업되는데 그곳에서는 태그가
보이지 않기 때문이에요. 배지의 시트도 같은 말로 같이 물어요(`Effects.sessionAtRisk`는
`View.sessionAtRisk`와 같은 판단이에요).
- 이유: 키체인에 남은 목업 세션은 목업을 끈 뒤 영문 모를 만료와 로그아웃을 일으키고, 목업
  안 된 요청이 가짜 토큰을 실제 서버로 보낼 수 있어요. 위의 차단 모드가 나머지 절반이에요.

## 배포 빌드에서 빼기

**우리 코드는 debug에서만 컴파일돼요.** `Sources/`와 `Tests/`의 모든 Swift 파일은
`#if MAP_LOCAL_ENABLED`로 감싸고, `Package.swift`는 debug 구성에서만 그 플래그를 정의해요.
`script/lint-guard`가 감싸기를 확인해요.

**Xcode는 구성 이름으로 debug를 정해요.** 구성 이름에 대소문자 무관하게 `debug`가 들어가면
구성의 실제 설정과 상관없이 패키지를 Debug로 빌드해요. Xcode 26에서 실측했고 아래 대조군
⑤가 고정하므로, [release-builds-ko.md](release-builds-ko.md)가 이름 규칙을 적어요.

**NectoSDK 자체는 링크하는 순간 배포 빌드에 남고**, App Store Connect 검증은 Necto 터치
주입이 쓰는 비공개 셀렉터 때문에 이를 거절해요(2026-10-02 실측). 그래서 TestFlight·App
Store 앱에는 release-builds-ko.md가 Debug 전용 앱 프로젝트를 따로 두라고 권해요(`Examples/SeparateProject`).
같은 프로젝트의 다른 타깃이나 같은 워크스페이스로는 부족해요. 패키지 해석이 프로젝트·
워크스페이스 단위라 배포 아카이브가 이 저장소에 묶여요.

**가정하지 않고 아카이브로 확인해요.**
`script/verify-release [--include-necto]`는 아카이브·앱·IPA에서 우리 흔적(선택하면 Necto
흔적도)을 찾고, 읽지 못한 파일을 실패로 세며, CI용으로 0·1·2로 끝나요. `script/verify-controls`는
예제를 아카이브해 대조군 다섯 개를 각각 걸려야 할 규칙과 파일까지 단언해요: 같은 타깃 배포는
통과, 같은 타깃 Debug는 우리 코드로 실패, 같은 타깃 배포는 Necto 검사로 실패, 별도 프로젝트는
Necto 검사도 통과, 이름에 debug가 든 배포 구성(`ReleaseDebuggable`)은 우리 코드로 실패. 별도 프로젝트 예시의
Debug 전용 프로젝트가 빌드되는지도 확인해요.
릴리스 워크플로는 이 패키지에 의존하지 않는 앱을 위해 `verify-release`와 체크섬을 올려요. 둘 다 릴리스 잡에서 의존성 코드가 돌기 전에 만들고, 사용자가 고정할 해시는 릴리스 노트에 실어요.
막을 수 있는 곳은 CI뿐이에요. 빌드 단계 스크립트는 스크립트 샌드박스 때문에 `.app` 안을 읽지
못하고, 스킴 post-action은 실패해도 아카이브를 막지 못해요.

디버그 심볼(dSYM)에는 빈 모듈 이름과 빌드 경로가 남아요. 지우려면 원격 패키지가 쓸 수 없는
unsafe 플래그 `-gnone`이 필요해요. `.app` 자체에는 아무것도 없어요.

## 패널은 Swift 모듈 안에 실려요

`script/embed-panel`이 `Panel/dist`를 경로 → base64 문자열 사전인 `EmbeddedPanel.swift`로
만들어요. 시작할 때 `PanelWriter`가 임시 디렉터리 아래 고정 디렉터리를 비우고 파일을 써서
`NectoPluginPanel(root:)`에 넘겨요(`Sources/NectoMapLocalPlugin/PanelWriter.swift`). Necto
템플릿은 패널을 패키지 리소스로 실어요.
- 리소스 번들이 아닌 이유: 리소스가 있는 패키지는 배포 빌드를 포함한 모든 빌드에 번들과
  번들 탐색 접근자를 만들어요. 패널을 `#if MAP_LOCAL_ENABLED` 안의 Swift 데이터로 두면 배포
  빌드에 흔적이 없어요.
- base64 문자열인 이유: 패널 크기의 `[UInt8]` 리터럴은 컴파일이 몇 배 오래 걸렸어요.
- 고정 디렉터리를 먼저 비우는 이유: Necto는 패널 디렉터리의 모든 일반 파일로 콘텐츠 해시를
  만들어요. 남은 파일이 해시를 바꾸고, 실행마다 새 디렉터리를 만들면 쌓여요.
- 쓰기에 실패하면 `panel`은 nil이에요. Necto가 읽지 못하는 경로는 NectoSDK debug 빌드의
  assert를 건드려요.
- `EmbeddedPanel.swift`는 생성물이고 커밋해요. CI가 패널을 다시 빌드해 커밋된 파일과 다르면
  실패해요.

## 실제 응답 보기: Necto 네트워크 기록

Map Local은 응답을 얻으려고 요청을 다시 보내지 않아요. 매니페스트가 Necto 자신의
`necto.device.network-records.{observe,list,detail}` 브리지에 바인딩하고, 앱이
`URLSessionNetworkPlugin`을 등록하면 그 플러그인이 이를 제공해요
(`Panel/public/manifest.json`의 `network.*` 오퍼레이션).
- 재사용하는 이유: 앱 안의 캡처 경로가 둘이 아니라 하나이고, 사용자의 Network 패널과 트래픽
  탭이 같은 기록을 봐요.
- 다른 플러그인에 바인딩하는 거예요. Necto 호스트는 디바이스 브리지를 타깃의 모든 플러그인에서
  찾지만(Necto 0.2.0, `NectoMac/Sources/NectoMacService/NectoPluginRegistry.swift`), 브리지 문서는
  앱 브리지가 한 플러그인 범위라고 적어요. 문서에 없는 동작에 기대므로, 패널은 연결마다
  `context().operations`로 사용 가능 여부를 보고 Necto의 `unavailableReason`을 보여요
  (`Panel/src/api.ts`). kind가 다르면 오류 없이 사용 불가로 떨어지므로 `PanelTests`가 다른
  플러그인 바인딩의 kind를 고정해요.
- `network-records.clear`는 바인딩하지 않아요. 사용자의 Network 패널 기록까지 지워요.

**등록 순서: Map Local 먼저, 네트워크 플러그인은 나중에.**
나중에 등록된 URLProtocol이 먼저 조회돼요. Necto 관찰자는 요청을
`URLSession(configuration: .ephemeral)`로 다시 보내요(Necto 0.2.0,
`Sources/NectoURLSessionCapture/NectoURLSessionCapture.swift`). Map Local이 먼저면 그 ephemeral
세션이 바뀐 getter로 우리 프로토콜을 받아, 목업이 Necto 기록에 목업 응답 그대로 보이고 요청마다
한 번씩 기록돼요. 반대 순서면 목업이 기록에서 사라지고 통과 요청이 두 번 기록돼요(실측). 패널은
이번 실행의 실시간 데이터에서 그 서명을 알아보고 경고해요(`Panel/src/traffic/order.ts`).

**요청마다 결과를 조심스럽게 붙여요**(`Panel/src/traffic/store.ts`):
1. 기록 상세의 `X-Map-Local` 헤더가 먼저 정해요.
2. 없으면 Necto 기록과, 메서드·정규화한 호스트·경로·쿼리가 같고 0–50ms 뒤에 온 우리 기록을
   짝지어요. 우리 기록 하나는 한 번만 써요. 위 등록 순서에서 우리 기록이 늘 Necto 기록 뒤에
   왔으므로 한쪽 창이에요.
3. 그래도 없으면, 그리고 헤더 없이 실패한 요청(목업 오류일 수 있어요)은 「모름」이에요. 틀린
   배지는 배지가 없는 것보다 나빠요.
우리 기록은 실행 안에서 `seq`를 갖고, `maplocal.requests.list`가 최근 500건을 돌려줘 늦게 연
패널도 결과를 가져요. 목록의 `lastSeq` 이하인 스트림 이벤트는 버려요.

네트워크 플러그인이 없으면 트래픽 탭은 우리 기록으로 목록을 만들고, 거기서 만든 규칙은 빈
200 JSON 응답을 가져요.

## 값은 그대로 둬요

캡처, 복사한 설정, 요청 기록은 토큰·쿠키·비밀번호를 바꾸지 않고 실어요. 「설정 복사」만,
설정이 비밀을 담은 것 같으면 한 줄로 경고해요: JWT 모양 값, `auth` 태그 규칙, Authorization·
Cookie·Set-Cookie 헤더, 또는 token·secret·password·api key·session 같은 이름의 키 아래 값
(`Panel/src/transfer.ts`). 값은 절대 바꾸지 않아요.
- 이유: 목업은 본 것을 그대로 재현하려고 있고, Necto 자신의 네트워크 기록도 원문이에요. 가림은
  그 목적과 부딪쳤고, 무엇을 가릴지 두 파서(Swift·TypeScript)를 일치시키는 비용이 보호보다 컸어요.
- 대가: 경고를 무시하면 실제 토큰이 공유하거나 커밋한 설정에 들어갈 수 있어요.
- 캡처는 `Set-Cookie`, `Content-Length`, `Content-Encoding`, `Transfer-Encoding`,
  `Connection`, `Date`, `X-Map-Local`을 빼요. 본문은 이미 풀린 채 오므로 `Content-Encoding`을
  남기면 앱이 두 번 풀려다 깨져요(`Panel/src/traffic/capture.ts`).
- 앱이 쓰지 않고 편집기만 어지럽히던 헤더도 빼요. CORS(`Access-Control-*`), `Cache-Control`,
  `Pragma`, `Expires`, `X-Frame-Options`, `X-Content-Type-Options`, `X-XSS-Protection`,
  `Strict-Transport-Security`, `Server`, 요청 id(`X-Request-Id`, `X-Message-Id` 등)이에요.
  `Content-Type`과 앱 고유 헤더는 남겨요. 상세가 뺀 개수를 말하고 마우스를 올리면 이름을
  보여 주며, 캡처 알림도 개수를 말해요. 필요한 헤더는 다시 써 넣으면 돼요.

## 현지화

- 패널의 원문은 영어이고 그것이 사전의 키예요. 한국어는 Necto 기본 플러그인처럼
  `necto.createTranslator`로 표에서 가져와요(`Panel/src/localization.ts`). 언어는 호스트가
  정하고, 패널은 `necto.locale()`로 `<html lang>`을 맞춰요.
- 엔진은 코드로 말해요. 모든 메시지는 고정된 `MessageCode`, 매개변수, 영어 문장을 가져요
  (`Sources/MapLocalCore/MapLocalMessage.swift`). 패널은 코드로 번역하고 CLI는 영어를 보여요.
  코드는 `Fixtures/message-codes.json`에 있고 두 쪽에서 확인해요.
- 기기의 배지는 앱의 현지화가 아니라 기기의 첫 선호 언어(한국어 또는 영어)를 따라요. 앱의
  현지화는 이 패키지가 정할 수 없어요(`Sources/NectoMapLocalPlugin/Badge.swift`).
- 배지 자체의 글자는 모든 언어에서 같아요(`Map Local`, `Map Local 🔑`). 읽어 주는 이름, 시트,
  시트의 메시지는 기기 언어를 따라요.

## 배지와 앱 안의 제어

**배지는 무언가 적용될 때만 보여요**(`EngineState.effects`). Map Local이 켜져 있고, 켜진 규칙이
활성 응답으로 차단되지 않은 허용 호스트에 응답하거나, 그런 호스트에서 규칙 없는 요청을 차단하거나 실패하게 하거나,
목업 세션이 남아 있을 수 있을 때요. 그 밖에는 아무것도 보이지 않아요. 대기 배지나 「허용 호스트
없음」 배지는 없어요.
- 이유: 늘 떠 있는 배지는 읽히지 않게 돼요. 앱이 실서버와 말하지 않을 때만 나타나면 배울 필요가
  없는 신호가 돼요.
- 목업 세션은 그것만으로 세어요. 응답하는 규칙이 없어도 앱은 가짜 토큰을 쥐고 있고, 로그아웃하라는
  신호가 사라지면 안 돼요.
- 시트는 응답할 수 있는 규칙만 세어요. 앞선 규칙이 언제나 이기는 규칙(메서드와 쿼리 조건이 같고,
  경로를 앞선 규칙이 덮고, 앞선 규칙이 놓치는 호스트가 없는 규칙)은 빼고 세어요(`Effects.rules`).

**누르면 Map Local을 꺼요.** 알약은 버튼이고, 시트(액션 시트, 시스템이 팝오버로 보이면 알약에
붙은 팝오버)는 적용 중인 것을 말하고 「Map Local 끄기」와 「취소」만 줘요. 끄기는 패널과 같은 쓰기,
`configuration.patch {"enabled": false}`를 시트가 열린 revision 기준으로 보내요(`BadgeControl`).
그래서 패널은 평소의 상태 스트림으로 바뀌고, 시트가 열린 동안 생긴 변경은 충돌이 되어 아무것도
쓰지 않고 지금 적용 중인 것으로 다시 물어요. 목업 토큰이 실서버로 갈 수 있으면 패널의 로그아웃
안내를 먼저 보이고, 시트가 열린 동안 그렇게 되었으면(목업 로그인은 revision을 올리지 않아요)
끄기는 쓰지 않고 그 안내와 함께 다시 물어요(`BadgeControl.confirm`). 알림이나 오가는 중인 시트
위에는 띄우지 않아요. 시트는 앱의 맨 위 컨트롤러에서 띄우고, 보통 레벨 창이 없는 장면에서는
장면의 키 창이나 맨 위 창에서, 앱 창이 아예 없으면 배지 자신의 창에서 띄워요. 그때 배지 창은
시트의 터치를 받아요(`BadgePresenter`).
- iPhone 17 Pro 시뮬레이터(iOS 26.4) 실측: 동작의 핸들러는 알림이 닫힌 뒤에 실행돼요. 그래서
  다시 묻는 시트와 실패 알림이 모두 떠요. iOS 27.0(iPhone 18 Pro)에서 다시 확인해도 같아요.
- 이유: 규칙은 Necto 없이도 적용되므로, Necto가 곁에 없는 사람도 앱에서 끌 수 있어야 해요.
  편집은 패널에 남겨요.

**알약만 터치를 받아요.** 배지 창은 알약 밖의 모든 점에서 `hitTest`가 nil을 돌려주고 키 윈도가
되지 않아요. 앱은 터치와 키보드를 그대로 가져요.

**홈 인디케이터 옆에 둬요**(`BadgeLayout`). 오른쪽, 그 줄의 가운데 높이예요. 인디케이터 옆에 들어가지
않으면 그 위에, 홈 버튼 기기에서는 상태 막대의 왼쪽 끝에 두고, 둘 다 없으면 숨겨요. 받아쓰기
키가 그 줄에 있으므로, 키보드가 자기 장면의 아래를 덮는 동안에는 숨겨요(`BadgeLayout.keyboardCovers`).
키보드 알림은 모든 장면에 가므로, 이 장면을 덮지 않는 다른 iPad 창의 키보드, 떠 있는 키보드,
하드웨어 키보드의 단축키 막대에는 숨지 않아요.
- iOS 26.4 시뮬레이터 실측: 알림의 object는 키보드가 뜬 화면이에요. 소프트웨어 키보드 높이는
  iPhone 17 Pro에서 335pt, iPad Air 11인치에서 337pt이고, 하드웨어 키보드가 붙은 iPhone은 숨김만
  알려요. iOS 27.0에서 다시 쟀어요: iPhone 18 Pro는 328pt, iPad Air 11인치(M4)는 337pt이고,
  object는 여전히 화면이에요. 안전 영역(위 62pt, 아래 34pt)과 54pt 상태 막대는 그대로예요.
  측정하지 않은 것: iPad 단축키 막대. 배지가 키보드로 보는 150pt보다 낮다고 가정했어요.
- Necto 시뮬레이션 실측: 다이내믹 아일랜드 아래 가운데에 두었을 때 푸시된 화면의 내비게이션
  제목과 팝오버 메뉴 첫 줄을 가렸어요.
- iPhone 17 Pro 시뮬레이터(iOS 26.4) 실측: 상태 막대에는 둘 수 없어요. 시스템이 시계와 표시기를
  모든 앱 창 위에 그리고, 상태 막대 영역(62pt 중 위 54pt)의 터치는 앱에 넘기지 않아요(iOS 27.0에서도
  같아요). iOS 26의
  떠 있는 검색 칸은 아래 끝에서 29pt 위, 34pt 줄 안쪽까지 내려오므로(탭 막대도 같은 높이로 가정했고 실측하지 않았어요) 배지는 인디케이터
  위가 아니라 그 아래 높이에 둬요.
- 실측하지 않음: 상태 막대가 배지의 터치도 가져갈 수 있는 홈 버튼 기기, iPad.

## 오류 모델

쓰기의 결과 중 둘만 데이터 `{"ok": false, "reason": …}`로 답해요: `conflict`(낡은
`baseRevision`)와 `readOnly`. 패널은 둘을 정상 흐름으로 다뤄요. 나머지는 모두
`NectoBridgeError`를 던져 Necto가 호출을 실패시키고 CLI가 0이 아닌 코드로 끝나요: 잘못된 입력은
`INVALID_INPUT`, 없는 규칙·응답은 `OPERATION_UNAVAILABLE`, 저장 실패는 `PROVIDER_FAILED`
(`Sources/NectoMapLocalPlugin/NectoMapLocalPlugin.swift`). 두 모양 모두 `reason`, `code`,
`params`, 영어 `message`, `revision`을 실어요.
- 이유: 모든 실패를 `ok: false`로 답하면 스크립트와 에이전트가 실패를 성공으로 읽었어요.
- 모든 오퍼레이션은 매니페스트에 엄격한 입력 스키마를 선언해, 앱에 닿기 전에 Necto가 잘못된
  입력을 거부해요. Necto를 거치지 않는 호출을 위해 앱이 다시 확인하고, `ContractTests`가 둘을
  같게 유지해요.
- 바인딩은 버전 1이에요. 호출자를 깨는 변경은 새 바인딩 버전으로 내요. 선택 입력 키나 출력
  필드를 더하는 것은 그렇지 않아요.

## 식별자와 의존성

- 플러그인 ID는 작성자 GitHub 계정 아래 역도메인인 `io.github.ryan-son.maplocal`이고 바뀌지
  않아요. Necto는 새 ID를 권한과 저장소가 따로인 다른 플러그인으로 봐요. 오퍼레이션 id는
  `maplocal.` 접두사를 유지해요.
- Necto는 `.upToNextMinor(from: "0.2.0")`으로 요구해요. 마이너 사이에 SDK 소스 API가 바뀌어
  왔으므로 범위를 넓히면 빌드가 깨질 수 있고, `exact:`는 앱 자신의 Necto 의존성과 충돌해요.
  매주 도는 `script/check-necto-latest`가 최신 Necto 태그와 그 `@necto/bridge`로 테스트하고,
  맞춘 릴리스가 필요하면 알려요.
