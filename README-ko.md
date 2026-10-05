# Map Local for Necto

[English](README.md) | 한국어

[Necto](https://github.com/toss/necto) 패널에서 엔드포인트의 응답을 정하면, 앱은 다음
요청부터 그 응답을 받아요.

![목업된 요청을 고른 트래픽 탭과, 그 옆에서 목업된 빈 목록과 Map Local 배지를 보여주는 앱](docs/images/map-local.png)

> ⚠️ **TestFlight·App Store로 배포한다면 먼저
> [배포 빌드에서 Map Local 빼기](docs/release-builds-ko.md)를 읽으세요.** NectoSDK를 링크한
> 빌드는 App Store Connect 검증에서 비공개 API 사용으로 거절돼요
> (실측: `_touchesEvent`, `_setHIDEvent:` 등 7개 셀렉터).

이럴 때 써요.

- 화면을 다른 데이터, 에러, 느린 응답, 끊긴 연결로 보고 싶을 때
- 아직 없는 API로 먼저 개발할 때
- 특정 페이지나 항목 하나만 다르게 응답하고 싶을 때
- 테스트 계정 없이 로그인을 목업할 때
- 내가 쓴 응답을 QA에게 그대로 넘길 때

[목적별 사용법](docs/recipes-ko.md)에 각각의 짧은 단계가 있어요. 알아 둘 점은 이래요.

- 프록시 도구의 Map Local 기능처럼 쓰지만, 인증서를 설치하거나 프록시를 설정할 필요가
  없어요. SSL 피닝을 쓰는 앱에서도 동작해요. 기본으로는 어떤 규칙도 응답하지 않는 요청이
  실서버로 가요([규칙이 적용되는 방식](docs/usage-ko.md#규칙이-적용되는-방식)).
- 규칙은 메서드, 호스트, `/users/{id}` 같은 경로 템플릿, 쿼리 조건으로 맞춰요
  ([규칙 매칭](docs/usage-ko.md#규칙-매칭)). 규칙 하나에 응답을 여러 개 두고 바꿔 가며 쓸 수
  있고, 응답마다 지연이나 오류를 넣을 수 있어요. 허용 호스트로 가는 규칙 없는 요청을
  차단하거나 실패하게 할 수도 있어요([규칙 없는 요청](docs/usage-ko.md#규칙-없는-요청)).
- 「트래픽」 탭은 앱이 보낸 요청과 그 요청에 무엇이 응답했는지 보여 줘요. 요청 하나를 한
  번에 규칙으로 만들 수 있어요. Necto 네트워크 플러그인을 등록했다면 규칙이 실제 응답으로
  시작해요([트래픽 탭](docs/usage-ko.md#트래픽-탭)).
- Map Local이 켜져 있고 앱에 영향을 주는 동안 앱에 배지가 보여요. 배지를 누르면 Map Local을
  끌 수 있어요([배지](docs/usage-ko.md#배지)).
- Release 빌드에는 플러그인 코드가 컴파일되지 않아요. CI(지속적 통합)에서 `verify-release`를
  돌리면 아카이브에 플러그인 흔적이 없는지 확인할 수 있어요
  ([배포 빌드에서 Map Local 빼기](docs/release-builds-ko.md)).
- Necto의 CLI(명령줄 인터페이스)인 `necto-cli`로도 패널이 설정에 하는 일을 모두 할 수 있어요. 설정을
  파일로 공유할 수도 있어요([가져오기·내보내기와 CLI](docs/cli-ko.md)).

## 빠른 시작

이 절차는 TestFlight·App Store에 올리지 않는 사내·로컬 전용 앱을 기준으로 해요. 다 따라
하면 패널에서 고친 응답이 앱 화면에 보여요.

### 요구 사항

- [Necto](https://github.com/toss/necto) 0.2.x(0.2.0 이상 0.3.0 미만). Mac 앱과 앱이
  링크하는 SDK 모두예요. 패키지는 `.upToNextMinor(from: "0.2.0")`을 선언해요. Necto의 새
  마이너 버전(0.3.0 등)에는 이 플러그인의 대응 릴리스가 필요해요.
- 앱은 iOS 17 이상. 엔진과 테스트는 macOS 14에서도 빌드돼요.
- Xcode 26 이상. 빌드 구성 이름 규칙과 배포 검사는 Xcode 26에서 실측했고, Xcode 27.1
  베타에서도 통과해요. CI는 Xcode 26에서 돌아요.
- Node.js 22.12 이상. 패널을 소스에서 빌드할 때만 필요해요.

### 단계

1. 앱에 패키지 두 개를 추가해요. 이 패키지(`0.1.0`부터)와
   [Necto](https://github.com/toss/necto)(`0.2.x`)예요. 이 패키지의 `NectoMapLocalPlugin`과
   Necto의 `NectoSDK`를 앱 타깃에 링크해요. 앱은 플러그인을 등록할 때 `NectoSDK`를 불러요.
   Xcode에서는 File → Add Package Dependencies를 써요. `Package.swift`라면:
   ```swift
   dependencies: [
       .package(url: "https://github.com/ryan-son/necto-map-local-plugin.git", from: "0.1.0"),
       .package(url: "https://github.com/toss/necto.git", .upToNextMinor(from: "0.2.0")),
   ],
   // 앱 타깃의 dependencies
   .product(name: "NectoMapLocalPlugin", package: "necto-map-local-plugin"),
   .product(name: "NectoSDK", package: "necto"),
   ```
2. 앱 시작 시점에 Map Local을 등록해요. Necto 네트워크 플러그인은 선택이에요. Map Local
   뒤에 등록하면 실제 응답을 보고 그 응답으로 규칙을 시작할 수 있어요. 대신 치르는 비용이
   있어요([실제 응답 캡처하기](docs/usage-ko.md#실제-응답-캡처하기)).
   ```swift
   #if DEBUG
   import NectoSDK
   import NectoMapLocalPlugin
   import NectoURLSessionCapture
   #endif

   // App.init 등 가장 이른 시점
   #if DEBUG
   NectoSDK.register(NectoMapLocalPlugin())
   NectoSDK.register(URLSessionNetworkPlugin())  // 선택, Map Local 뒤에
   NectoSDK.start()
   #endif
   ```
3. 이름에 `Debug`가 들어간 빌드 구성으로 빌드해요. 대소문자는 가리지 않아요. `Staging`처럼
   다른 이름이면 패키지가 Release로 빌드되어 앱이 컴파일되지 않아요
   ([빌드 구성 이름 규칙 따르기](docs/release-builds-ko.md#빌드-구성-이름-규칙-따르기)).
4. [Necto 앱](https://github.com/toss/necto/blob/main/docs/install.md) 0.2.x를 설치하고
   실행해요. 내 iOS 앱을 실행한 뒤, Necto에서 기기 → 앱 → **Map Local**을 열어요. 내 앱이
   연결될 때까지 패널에 「앱 연결을 기다리는 중…」이 보이고, 연결되면 「규칙」과 「트래픽」
   탭이 보여요.
5. 「트래픽」 탭에서 요청을 고르고 「이 응답으로 목업」을 눌러요(네트워크 플러그인이 없으면
   「빈 응답으로 목업」). 목업하면 그 요청의 호스트도 허용 호스트에 추가돼요. 허용 호스트는
   Map Local이 요청에 응답할 수 있는 호스트예요. 앱에 `Map Local` 배지가 나타나요. 「규칙」
   탭에서 응답을 고쳐요.
6. 앱이 그 요청을 다시 보내게 해요(새로 고침, 또는 화면을 다시 열기). 고친 응답이 앱에
   보여요.

패널에서 바꾼 내용은 즉시 앱에 저장되고, 다음 요청부터 적용돼요. Map Local이 켜져 있으면
앱을 다시 실행한 뒤에도, Necto 앱을 닫아 둔 동안에도 규칙이 적용돼요.

잘 안 되면 [문제 해결](docs/troubleshooting-ko.md#증상-찾기)에서 증상을 찾아보세요. 나머지는
[docs/usage-ko.md](docs/usage-ko.md)에 있어요.

## 알려진 한계

다음은 Map Local이 앱의 요청을 가로채지 못하게 할 수 있어요.

- 앱이 `NectoSDK.register`보다 먼저 만든 세션과 먼저 읽은 세션 설정(`URLSessionConfiguration`)은
  가로채지 않아요. `URLSession.shared`는 앱이 먼저 썼어도 가로채요. 앱 시작의 가장 이른
  시점에 등록하세요.
- 일부 SDK처럼 `protocolClasses`를 통째로 바꾼 세션 설정에서는 Map Local이 빠져요. 목록 맨
  앞에 `NectoMapLocalPlugin.protocolClass`를 다시 넣으세요.
- `URLSession` 위에 만든 라이브러리(예: Alamofire, Moya)도 위 두 항목과 같은 조건에서
  가로채요. 라이브러리가 세션을 만들기 전에 등록하고, 라이브러리가 `protocolClasses`를
  바꾼다면 맨 앞에 `NectoMapLocalPlugin.protocolClass`를 넣으세요.

이 밖에 Map Local은 백그라운드 세션과 `WKWebView`를 가로채지 않고, 목업 3xx를 따라가지 않으며,
목업 응답의 `Set-Cookie`를 항상 `HTTPCookieStorage.shared`에 저장해요. 이유와
`protocolClasses`를 되살리는 코드를 포함한 전체 목록은
[알려진 한계](docs/usage-ko.md#알려진-한계)에 있어요.

## 문서

- [목적별 사용법](docs/recipes-ko.md): 자주 하는 일의 짧은 단계
- [사용법](docs/usage-ko.md): 매칭, 트래픽 탭, 호스트, 배지, 키보드
- [문제 해결](docs/troubleshooting-ko.md): 증상별 확인 사항, 요청이 목업되지 않은 이유
- [배포 빌드](docs/release-builds-ko.md): Necto 빼기, 빌드 구성 이름 규칙, CI에서 릴리스 막기
- [가져오기·내보내기와 CLI](docs/cli-ko.md): 파일 형식, 오퍼레이션, 오류
- 기여자 안내: [경험](docs/experience-ko.md) · [설계](docs/design-ko.md) ·
  [처음 쓰는 사람 테스트](docs/first-use-test-ko.md) · [검증 기록(영문)](docs/verification-log.md)
- [보안](SECURITY-ko.md) · [변경 기록(영문)](CHANGELOG.md)
- Necto 자체 안내: [github.com/toss/necto](https://github.com/toss/necto/tree/main/docs)

## 기여하기

누구든 기여를 환영해요. 소스에서 빌드하는 방법, 이슈 신고, 풀 리퀘스트는
[기여 안내](CONTRIBUTING-ko.md)([English](CONTRIBUTING.md))를 보세요.

## 라이선스

MIT. [LICENSE](LICENSE)를 보세요. 내장된 패널에는 서드파티 코드가 들어 있어요.
[THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)를 보세요.
