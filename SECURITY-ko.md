# 보안

[English](SECURITY.md) | 한국어

일반 버그와 기능 요청은
[Issues](https://github.com/ryan-son/necto-map-local-plugin/issues)에 남겨 주세요.

취약점으로 보이는 문제는
[ryan-son/necto-map-local-plugin](https://github.com/ryan-son/necto-map-local-plugin/security/advisories/new)의
**Security → Advisories → Report a vulnerability**로 알려 주세요. 메인테이너만 볼 수 있는 비공개
권고가 열려요. 공개 이슈로 올리지 마세요.

캡처한 트래픽, 토큰, 쿠키, 비밀번호, 또는 그런 값이 든 설정 복사본을 넣지 마세요. 패널은 이
값을 그대로 두므로, 실제 앱에서 캡처하거나 내보낸 것에는 살아 있는 자격 증명이 실릴 수
있어요. 대신 지어낸 값으로 문제를 설명해 주세요.

플러그인 버전, Necto 버전(Mac 앱과 SDK), Xcode와 iOS 버전, 그리고 앱을 시뮬레이터에서
실행했는지 USB로 연결한 기기에서 실행했는지 적어 주세요. 안전하다면 최신 릴리스에서도
확인해 주세요. 이전 릴리스의 지원은 보장하지 않아요.

Map Local은 디버그 도구이며 운영용이 아니에요. 배포하는 빌드에서 빼 주세요.

- 패키지를 링크하면 그 패널이 모든 요청 기록을 포함해 플러그인의 디바이스 브리지 전체에
  접근해요. 직접 관리하는 빌드에만 넣으세요.
- Map Local이 켜져 있으면 Necto가 있든 없든 규칙이 적용돼요.
- `blockedHosts`는 운영을 목업하지 않게 할 뿐, 요청이 운영에 닿는 것을 막지는 않아요.

[패널이 볼 수 있는 것](docs/usage-ko.md)과
[배포 빌드에서 Map Local 빼기](docs/release-builds-ko.md)를 보세요.
