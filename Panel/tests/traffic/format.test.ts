//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { expect, test } from "vitest";
import { formatClock, formatDuration } from "../../src/traffic/format";

test.each([
  [0, "<1ms"],
  [0.61297416, "<1ms"],
  [1, "1ms"],
  [11.6, "12ms"],
  [999.4, "999ms"],
  [999.6, "1.0s"],
  [1000, "1.0s"],
  [1192.09289, "1.2s"],
  [12345, "12.3s"],
])("shows a duration of %f ms briefly as %s", (ms, text) => {
  expect(formatDuration(ms)).toBe(text);
});

test.each([
  ["03:04:05.006", new Date(2026, 0, 2, 3, 4, 5, 6)],
  ["00:00:00.000", new Date(2026, 0, 2, 0, 0, 0, 0)],
  ["23:59:59.999", new Date(2026, 0, 2, 23, 59, 59, 999)],
  ["12:46:21.050", new Date(2026, 0, 2, 12, 46, 21, 50)],
])("shows a start time as fixed-width local %s, never a localised form like 12:46:21 PM", (text, date) => {
  expect(formatClock(date.getTime())).toBe(text);
});
