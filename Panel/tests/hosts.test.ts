//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { expect, test } from "vitest";
import hostCases from "../../Fixtures/host-cases.json";
import { normalizeHost, readHostInput } from "../src/hosts";

// Swift's `SharedFixtureTests` reads the same table (HostName.normalize). The engine and the panel
// produce the same string, down to the code points.
test.each(hostCases.cases)("normalizes hosts the same way as the engine: $name", (c) => {
  expect(normalizeHost(c.raw) ?? null).toBe(c.expect);
});

// The engine receives a request URL's Unicode host percent-encoded (URL.host()), so a host allowed
// in Unicode matches no request.
test.each(hostCases.cases)("the allowed-host input accepts only hosts the engine can match: $name", (c) => {
  const read = readHostInput(c.raw);
  if (c.expect === null)
    expect(read).toEqual({ problem: "호스트로 읽을 수 없습니다(예: api.example.com)" });
  else if ("panel" in c && c.panel === "punycode")
    expect(read).toEqual({ problem: "유니코드 호스트는 punycode(xn--…)로 입력하세요" });
  else expect(read).toEqual({ host: c.expect });
});
