# 가져오기·내보내기와 CLI

[English](cli.md)

패널이 설정에 하는 일은 모두 `necto-cli`로도 할 수 있어요. 이 문서는 공유 파일 형식,
오퍼레이션, 그리고 실패하는 방식을 설명해요.

## 설정 공유하기

패널과 CLI는 같은 파일을 써요.

```json
{"force": true, "configuration": { … }}
```

패널의 「설정 붙여넣기」가 이 파일을 읽고, 「설정 복사」가 이 파일을 써요. 복사는 토큰을
포함해 값을 그대로 둬요. [패널이 볼 수 있는 것](usage-ko.md)을 보세요.

공유한 설정은 규칙을 옮길 뿐, 서버의 데이터를 옮기지 않아요. 목업 응답에만 있는 사이트·계정·
레코드는 그 응답을 만드는 규칙도 함께 공유해야 다른 기기에 나타나요. 예를 들면 목업한
검색이 돌려준 사이트예요.

## necto-cli 오퍼레이션

```bash
necto-cli plugin send io.github.ryan-son.maplocal maplocal.configuration.replace --device <id> --app <bundle> --input-file mocks.json
necto-cli plugin send io.github.ryan-son.maplocal maplocal.rule.setActive --device <id> --app <bundle> --input '{"baseRevision":3,"id":"login","response":"ok"}'
```

플러그인 ID는 `io.github.ryan-son.maplocal`이며 바뀌지 않아요. Necto는 ID가 다르면 승인과
저장소가 따로인 다른 플러그인으로 봐요.

모든 오퍼레이션은 입력과 출력을 `Panel/public/manifest.json`에 선언해요. 필수 키·타입·
열거값·범위까지 들어 있어요. 다음 명령이 그것을 보여 줘요.

```bash
necto-cli plugin help io.github.ryan-son.maplocal <operation> --device <id> --app <bundle>
```

입력은 설명문이 아니라 스키마를 보고 만드세요.

일반 쓰기에는 `baseRevision`이 필요해요. `maplocal.state`의 `revision`이에요.
`maplocal.configuration.replace`는 대신 `"force":true`를 보낼 수 있어요.

## 오류

데이터(`"ok":false`)로 답하는 결과는 둘뿐이에요.

| 답 | 뜻 | 할 일 |
| --- | --- | --- |
| `"reason":"conflict"` | `baseRevision`이 오래됐어요 | `maplocal.state`를 다시 읽고 재시도해요 |
| `"reason":"readOnly"` | 설정을 쓸 수 없어요 | 이유는 `issues`에 있어요 |

나머지는 호출 자체가 실패하므로 CLI가 0이 아닌 코드로 끝나요.

| 코드 | 언제 |
| --- | --- |
| `INVALID_INPUT` | 잘못된 입력. Necto가 스키마로 먼저, 앱이 다시 검사해요 |
| `OPERATION_UNAVAILABLE` | 없는 규칙이나 응답 |
| `PROVIDER_FAILED` | 저장 실패 |

앱이 낸 오류는 `details`에 `reason`, `code`, `params`, 영어 `message`, `revision`을 담아요.
코드는 바뀌지 않으며 [Fixtures/message-codes.json](../Fixtures/message-codes.json)에 있어요.

## 바인딩 버전

모든 `necto.device.maplocal.*` 바인딩은 버전 1이에요.

호출자를 깨는 변경은 새 바인딩 버전으로 내요. 키 제거나 이름 변경, 더 엄격한 스키마, 결과가
오류로 바뀌거나 그 반대가 여기에 해당해요. 선택 입력 키나 출력 필드를 더하는 것은 해당하지
않아요.
