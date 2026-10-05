//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { expect, test } from "vitest";
import manifest from "../public/manifest.json";

test("the manifest's assets include the build output folder", () => {
  expect(manifest.assets).toEqual(["index.html", "assets"]);
});

test("every operation in the manifest has an id and a binding for the panel to call", () => {
  for (const op of manifest.operations) {
    // The same rule as Necto's isValidIdentifier (capitals allowed, as in setActive)
    expect(op.id).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(op.binding.name.startsWith("necto.device.")).toBe(true);
  }
});
