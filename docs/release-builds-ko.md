# 배포 빌드에서 Map Local 빼기

[English](release-builds.md)

Map Local은 디버그 도구예요. 이 문서는 배포하는 빌드에서 Map Local과 Necto를 빼는 방법과,
그것을 CI에서 증명하는 방법을 설명해요.

> ⚠️ NectoSDK를 링크한 빌드는 App Store Connect 검증에서 비공개 API 사용으로 거절돼요
> (실측: `_touchesEvent`, `_setHIDEvent:` 등 7개 셀렉터).

## 배포 앱에서 Necto 빼기

이 패키지의 플러그인 코드는 Release 빌드에서 컴파일되지 않아요. 그러나 **NectoSDK는
링크되는 순간 Release 앱에 남고**, 그 빌드는 검증에서 거절돼요.

그래서 기존 앱 프로젝트는 그대로 둬요. Necto와 이 플러그인을 링크하는 **Debug 전용 앱을
별도 프로젝트로** 둬요. `Examples/SeparateProject`가 그 구성을 보여 줘요.

- `App/App.xcodeproj`는 배포 프로젝트예요. Necto를 몰라요.
- `Dev/Dev.xcodeproj`에는 Debug 구성 하나만 있어요. 같은 소스(`Shared/`)에 등록 코드만
  더해요. 번들 ID와 표시 이름을 다르게 둬요.

같은 프로젝트의 다른 타깃이나 같은 워크스페이스로 두지 않는 이유가 있어요. 패키지 해석은
프로젝트·워크스페이스 단위예요. 그러면 배포 아카이브가 플러그인 저장소에 묶여요.

아카이브를 확인하려면:

```bash
script/verify-release --include-necto <아카이브>   # OK: no traces
```

## 구성 이름 규칙

Xcode는 **구성 이름에 `debug`가 들어가면(대소문자 무관) 구성의 실제 설정과 상관없이** 패키지를
Debug로 빌드해요.

- 배포에 쓰는 구성 이름에 `debug`가 없어야 해요. `ReleaseDebuggable`이라는 빌드에는 플러그인
  코드가 들어갔어요.
- 디버그용 구성 이름에는 `debug`가 있어야 해요. `QA`·`Staging`처럼 없으면 패키지가
  Release로 빌드되어, 앱 컴파일이 이렇게 실패해요.

  ```
  cannot call value of non-function type 'module<NectoMapLocalPlugin>'
  ```

둘 다 Xcode 26에서 실측했어요.

## CI에서 막기

검사가 배포를 **막을 수 있는 곳은 CI뿐**이에요. 별도 프로젝트 구성에서는 배포 프로젝트가 이
패키지에 의존하지 않아요. 그래서 스크립트를 릴리스에서 받고, 미리 고정해 둔 해시로 확인한 뒤
실행해요.

릴리스 노트에 `verify-release`의 SHA-256이 있어요. 버전과 함께 CI 설정에 한 번 옮겨
적으세요. `verify-release.sha256` 에셋은 스크립트와 같은 곳에서 오므로, 하나를 바꿀 수 있는
사람은 둘 다 바꿀 수 있어요. 그것을 잡는 것은 여러분 저장소에 둔 해시뿐이에요.

```bash
base=https://github.com/ryan-son/necto-map-local-plugin/releases/download/0.1.0
expected=<0.1.0 릴리스 노트의 SHA-256>                      # 여러분 저장소에 고정
curl -fsSL -O "$base/verify-release"
echo "$expected  verify-release" | shasum -a 256 -c      # verify-release: OK
bash verify-release build/App.xcarchive                  # 우리 흔적
bash verify-release --include-necto build/App.xcarchive  # Necto까지
```

`xcodebuild archive`와 업로드 사이에 둬요.

| 종료 코드 | 뜻 |
| --- | --- |
| 0 | 통과 |
| 1 | 흔적 있음(`FOUND [규칙] 경로`) |
| 2 | 사용법·읽기 오류. 읽지 못한 파일·폴더가 있으면 통과로 치지 않아요 |

맞아 보이지만 막지 못하는 곳이 두 군데 있어요.

- 빌드 단계 Run Script는 샌드박스 때문에 `.app` 안을 훑지 못해요.
- 스킴 Archive post-action은 실패해도 아카이브를 막지 못해요. 보여 주기만 해요.
