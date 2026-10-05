//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { vi } from "vitest";

// The panel follows the host's `<html lang>`, and most assertions read Korean copy.
// Node-environment tests have no document, so the bridge falls back to
// navigator.language there.
if (typeof document !== "undefined") {
  document.documentElement.lang = "ko";
} else {
  vi.stubGlobal("navigator", { language: "ko" });
}
