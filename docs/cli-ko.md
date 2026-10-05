# 가져오기·내보내기와 CLI

[English](cli.md)

`necto-cli`는 Necto의 CLI(명령줄 인터페이스)예요. 패널이 설정에 하는 일은 모두 `necto-cli`로도
할 수 있어요. 이 문서는 공유 파일 형식, 오퍼레이션, 그리고 실패하는 방식을 설명해요.

## 설정 공유하기

패널과 CLI는 같은 파일을 써요.

```json
{"force": true, "configuration": { … }}
```

패널의 「설정 붙여넣기」가 이 형식을 읽고, 「설정 복사」가 이 형식으로 만들어요. 복사한 설정에는
토큰을 포함한 모든 값이 가려지지 않고 그대로 들어가요.
[패널이 볼 수 있는 것](usage-ko.md#패널이-볼-수-있는-것)을 보세요.

공유한 설정에는 규칙만 들어 있고 서버의 데이터는 없어요. 목업 응답에만 있는 사이트·계정·레코드는
그 응답을 만드는 규칙까지 함께 공유해야 다른 기기에서도 보여요. 예를 들면 목업한 검색이 돌려준
사이트예요.

## necto-cli 오퍼레이션

`necto-cli`는 실행 중인 Necto 앱을 제어해요. 그래서 Necto를 열어 두고 앱을 연결해 둬야 해요.
먼저 모든 명령에 필요한 ID를 찾아요.

```bash
necto-cli device list --json
necto-cli plugin help io.github.ryan-son.maplocal --device <id> --app <bundle>
```

1. `device list --json`은 연결된 기기마다 `id`를, 그 기기의 앱마다 `bundleID`를 보여 줘요.
   이 값을 `<id>`와 `<bundle>`에 넣어요.
2. 오퍼레이션 없이 `plugin help`를 실행하면 Map Local의 오퍼레이션 목록이 나와요.

플러그인 ID는 `io.github.ryan-son.maplocal`이며 바뀌지 않아요. Necto는 ID가 다르면 권한과
저장소가 따로인 다른 플러그인으로 봐요.

| 오퍼레이션 | 호출 명령 | 하는 일 |
| --- | --- | --- |
| `maplocal.state` | `plugin send` | 설정과 그 `revision`, 엔진 상태를 돌려줘요 |
| `maplocal.state.observe` | `plugin subscribe` | `maplocal.state`와 같은 값을 지금 한 번, 그리고 바뀔 때마다 다시 보내요 |
| `maplocal.configuration.export` | `plugin send` | 토큰을 포함한 모든 값을 그대로 담아 설정 전체를 돌려줘요 |
| `maplocal.configuration.replace` | `plugin send` | 설정 전체를 바꿔요 |
| `maplocal.configuration.patch` | `plugin send` | 최상위 설정 일부(`enabled`, `allowedHosts`, `unmatched`, `order`)를 바꾸고 나머지는 그대로 둬요. 목업 세션 경고를 지우는 `authMocked:false`는 다른 키 없이 보내요 |
| `maplocal.rule.upsert` | `plugin send` | 규칙을 추가하거나, 같은 `id`의 규칙을 바꿔요 |
| `maplocal.rule.delete` | `plugin send` | 규칙을 지워요 |
| `maplocal.rule.setActive` | `plugin send` | 규칙이 요청에 응답할 때 쓰는 응답을 바꿔요 |
| `maplocal.requests.list` | `plugin send` | 앱 실행 후 최근 요청을 최대 500개까지 돌려줘요 |
| `maplocal.requests.observe` | `plugin subscribe` | 지금부터 앱이 보내는 요청마다 이벤트를 하나씩 보내요 |

`network.list`, `network.detail`, `network.observe`는 Necto 네트워크 플러그인이 기록한 내용을
돌려줘요. 앱이 그 플러그인을 등록했을 때만 쓸 수 있어요.

`maplocal.configuration.export`는 `{"configuration": …}`을 돌려줘요. 여기에 `"force": true`를
추가하면 위의 공유 파일이 돼요.

예를 들어 다음 명령은 파일로 설정을 바꾸고, 규칙의 응답을 바꾸고, Map Local을 켜요.

```bash
necto-cli plugin send io.github.ryan-son.maplocal maplocal.configuration.replace --device <id> --app <bundle> --input-file mocks.json
necto-cli plugin send io.github.ryan-son.maplocal maplocal.rule.setActive --device <id> --app <bundle> --input '{"baseRevision":3,"id":"login","response":"ok"}'
necto-cli plugin send io.github.ryan-son.maplocal maplocal.configuration.patch --device <id> --app <bundle> --input '{"baseRevision":3,"enabled":true}'
```

모든 오퍼레이션은 입력과 출력을 `Panel/public/manifest.json`에 선언해요. 필수 키·타입·
열거값·범위까지 들어 있어요. 다음 명령이 그것을 보여 줘요.

```bash
necto-cli plugin help io.github.ryan-son.maplocal <operation> --device <id> --app <bundle>
```

입력은 오퍼레이션의 설명(description)이 아니라 스키마를 보고 만드세요.

쓰기 오퍼레이션에는 모두 `baseRevision`이 필요해요. 값은 `maplocal.state`가 돌려준 `revision`,
또는 마지막으로 성공한 쓰기가 돌려준 `revision`이에요. `maplocal.configuration.replace`만 대신
`"force":true`를 보낼 수 있어요.

`plugin subscribe`와 그 `--limit`, `--timeout` 옵션처럼 `necto-cli`의 모든 명령은 Necto의
[컨트롤 소켓 문서](https://github.com/toss/necto/blob/0.2.0/docs/control-socket.md)에 있어요.

## 오류

호출은 성공했지만 결과로 `"ok":false`를 돌려주는 경우는 둘뿐이에요.

| 답 | 뜻 | 할 일 |
| --- | --- | --- |
| `"reason":"conflict"` | `baseRevision`이 오래됐어요 | `maplocal.state`를 다시 읽고 재시도해요 |
| `"reason":"readOnly"` | 설정을 쓸 수 없어요 | 이유는 `maplocal.state`의 `issues`에 있어요 |

나머지는 호출 자체가 실패하므로 CLI가 0이 아닌 종료 코드로 끝나요.

| 코드 | 언제 |
| --- | --- |
| `INVALID_INPUT` | 잘못된 입력. Necto가 스키마로 먼저, 앱이 다시 검사해요 |
| `OPERATION_UNAVAILABLE` | 없는 규칙이나 응답 |
| `PROVIDER_FAILED` | 저장 실패 |

앱이 낸 오류는 `details`에 `reason`, `code`, `params`, 영어 `message`, `revision`을 담아요.
코드는 바뀌지 않으며 [Fixtures/message-codes.json](../Fixtures/message-codes.json)에 있어요.

## 바인딩 버전

매니페스트의 오퍼레이션마다 바인딩을 적어 둬요. 바인딩은 그 오퍼레이션에 응답하는 앱 쪽 브리지예요.
예를 들면 `necto.device.maplocal.state`예요. 모든 `necto.device.maplocal.*` 바인딩은 버전
1이에요.

기존 호출자가 동작하지 않게 되는 변경은 새 바인딩 버전으로 내요. 키 제거나 이름 변경, 더 엄격한
스키마, 성공하던 결과가 오류로 바뀌거나 그 반대가 여기에 해당해요. 선택 입력 키나 출력 필드를
추가하는 것은 새 버전이 필요하지 않아요.
