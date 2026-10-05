# Map Local에 기여하기

[English](CONTRIBUTING.md) | 한국어

Map Local for Necto에 관심을 가져 주셔서 감사해요.

## 참고 문서

- 변경이 지켜야 할 규칙 — [AGENTS.md](AGENTS.md)
- 패널이 동작해야 하는 방식 — [docs/experience-ko.md](docs/experience-ko.md)
- 플러그인이 지금 모양인 이유 — [docs/design-ko.md](docs/design-ko.md)
- 플러그인 사용법 — [docs/usage-ko.md](docs/usage-ko.md)
- 배포 빌드에서 빼는 방법 — [docs/release-builds-ko.md](docs/release-builds-ko.md)
- 가져오기·내보내기와 CLI 계약 — [docs/cli-ko.md](docs/cli-ko.md)
- 취약점 신고 — [SECURITY-ko.md](SECURITY-ko.md)

## 영어로 작성하기

코드, 주석, 테스트 이름, 문서, 커밋 메시지는 영어로 작성해요. 문서는 필요하면 한국어 번역을
함께 둘 수 있어요.

한국어판은 원문 옆에 `X-ko.md`로 두고, 둘은 함께 바꿔요. 제목(개수와 수준), 코드 블록 수,
링크 대상 중 하나라도 다르면 `script/check-doc-pairs`가 실패해요. 영어판이 영어 문서로 거는
링크를 한국어판은 한국어 문서로 걸고, 검사는 둘을 같은 대상으로 읽어요. 한국어 문서는 Necto의
한국어 문서처럼 짧고 쉬운 해요체 문장으로 써요. 한국어 UI 문자열(패널 사전과 앱 안 배지)은 Necto
기본 플러그인처럼 합니다체를 써요. 상대 링크가 가리키는 파일이 없으면 `script/check-doc-links`가
실패해요.

커밋 메시지는 Necto처럼 [Conventional Commits](https://www.conventionalcommits.org/)를
따라요. 소문자 명령형 요약에 필요하면 스코프를 붙여요. 예:
`fix(panel): keep the selection when a filter hides it`,
`test(engine): cover query specificity`.

## 이슈

버그 신고나 기능 제안은 이슈로 남겨 주세요. 필요한 내용은 템플릿이 물어요. 버그 리포트에는
Necto 버전, 플러그인 버전, 앱 연결 방식(USB 실기기 또는 시뮬레이터), 재현 방법이 필요해요.
취약점은 [SECURITY-ko.md](SECURITY-ko.md)에 적힌 대로 비공개로 알려 주세요.

## 풀 리퀘스트

1. 저장소를 포크한 뒤 포크한 저장소를 로컬에 클론해요.

2. `main`에서 브랜치를 만들어요. 브랜치 이름은 `feature/<topic>`,
   `fix/<topic>`, `docs/<topic>`처럼 의도가 드러나게 지어요.

3. 코드를 수정하고 전체 검증을 실행해요.

   ```bash
   script/ci
   ```

   배포 빌드 제외 가드와 워크플로 액션의 커밋 고정, 문서와 한국어판의 일치와 링크를
   확인하고, 패널을 테스트·빌드하고,
   커밋된 `EmbeddedPanel.swift`가 패널 소스와 같은지 보고, `swift test`를 돌리고, 예제 앱을 아카이브해 배포 빌드에
   플러그인 흔적이 없음을 확인해요. 패널을 바꿨다면 `script/build-panel`를 실행하고
   다시 만들어진 `Sources/NectoMapLocalPlugin/EmbeddedPanel.swift`를 함께 커밋해요.

4. 브랜치를 포크에 푸시하고 이 저장소의 `main`을 대상으로 풀 리퀘스트를 열어요.
   템플릿의 Test Plan 섹션을 채워 주세요.

### 소스에서 빌드하기

```bash
cd Panel && npm ci && cd ..   # Node 22.12+. Necto 릴리스에서 @necto/bridge를 설치해요
script/build-panel            # 패널을 테스트·빌드하고 EmbeddedPanel.swift에 넣어요
swift test                    # Swift 테스트(macOS)
script/ci                     # 배포 아카이브 검사까지 CI가 돌리는 전부(Xcode 26 이상)
```

패널은 리소스 번들이 아니라 base64 문자열로 Swift 모듈 안에 넣어요. 그래서 배포 빌드에 패널
흔적이 남지 않고, `script/verify-release`로 그것을 증명할 수 있어요. 이유는
[docs/design-ko.md](docs/design-ko.md)의 「패널은 Swift 모듈 안에 실려요」에 있어요.

### 의존성은 고정하지 않아요

Necto의 디바이스 플러그인 템플릿처럼 `Package.resolved`는 커밋하지 않아요. 이 저장소는
라이브러리예요. SwiftPM은 의존 패키지의 `Package.resolved`를 무시하므로, 앱은 이 저장소가
무엇을 고정하든 `Package.swift`의 범위로 `necto`와 `swift-clocks`를 해석해요. 파일을 빼
두면 여기서 돌리는 `swift test`도 앱과 같은 방식으로 해석하므로, CI가 앱이 받는 조합을
테스트해요. 선언한 범위 밖의 Necto 릴리스는 매주 도는 `script/check-necto-latest`가
확인해요. 패널은 달라요. 빌드한 패널이 패키지 안에 실려 나가므로 재현할 수 있어야 해서
`Panel/package-lock.json`은 커밋하고 `npm ci`로 그대로 설치해요.

로컬에서는 SwiftPM이 여전히 `Package.resolved`를 만들고(git은 무시) 계속 그 파일을 써서,
로컬 `script/ci`가 CI보다 오래된 Necto를 테스트할 수 있어요. 로컬 결과를 CI 결과로 삼아야
할 때는 먼저 `swift package update`를 실행해요.

### 릴리스

`Panel/public/manifest.json`의 버전을 올리고, `CHANGELOG.md`에 `## 0.1.1` 섹션을 넣고,
[docs/release-builds-ko.md](docs/release-builds-ko.md)와 `docs/release-builds.md`의 다운로드
URL을 새 버전으로 바꾼 뒤 bare semver 태그
(`v0.1.1`이 아니라 `0.1.1`)를 푸시해요. 하나라도 빠지면 `script/prepare-release`가 태그를
거부해요. 릴리스 노트 끝에는 사용자가 CI에 고정하는 `verify-release`의 SHA-256이 붙어요.

첫 태그 전에 저장소 설정에서 GitHub의 immutable releases를 켜요. 켜지 않으면 게시된 에셋을 바꿔치기할 수 있고, 그때 알아챌 수 있는 건 고정해 둔 해시뿐이에요.

### 큰 변경은 이슈에서 먼저 논의해요

다음 변경은 이슈에서 메인테이너와 방향을 합의한 뒤 작업해 주세요.

- `Panel/public/manifest.json`에 오퍼레이션을 추가하거나 기존 오퍼레이션의 입력·출력을
  바꾸는 변경 — 패널, CLI, 저장된 설정 파일이 여기에 의존해요

- 설정 파일 형식이나 규칙이 요청에 맞는 방식을 바꾸는 변경

- 플러그인을 배포 빌드에서 빼는 방식을 바꾸는 변경

- [docs/experience-ko.md](docs/experience-ko.md)의 원칙이나 시나리오를 바꾸는 변경

재현 방법이 있는 버그 수정, 문서 수정, 테스트 추가, 한 모듈 안의 작은 개선처럼 그 밖의
변경은 이슈 없이 바로 풀 리퀘스트를 열어 주세요.

## 라이선스

기여하는 것은 기여한 내용을 [MIT 라이선스](LICENSE)로 배포하는 데 동의한다는 뜻이에요.
