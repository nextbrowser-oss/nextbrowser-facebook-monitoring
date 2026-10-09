// The core is what the app imports into its renderer, where there is no Node.
// Anything under src/ outside src/node that reaches for a Node module breaks
// the app's build, so it is checked here rather than found there.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as core from "./index.js";

const SRC = new URL(".", import.meta.url).pathname;

describe("the core", () => {
  it("imports nothing from Node", async () => {
    const files = (await readdir(SRC)).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(5);
    for (const name of files) {
      const text = await readFile(join(SRC, name), "utf8");
      expect(text, name).not.toMatch(/from\s+["'](node:|fs|path|os|child_process)/);
      expect(text, name).not.toMatch(/\bprocess\./);
      expect(text, name).not.toMatch(/from\s+["']\.\/node\//);
    }
  });

  it("exports the pass, the rules and the state helpers", () => {
    expect(typeof core.runPass).toBe("function");
    expect(typeof core.triage).toBe("function");
    expect(core.emptyState().settings).toEqual(core.defaultSettings());
  });

  it("never acts on facebook.com: nothing is clicked, typed, submitted or fetched", async () => {
    const text = await readFile(join(SRC, "scripts.ts"), "utf8");
    expect(text).not.toMatch(/\.click\(/);
    expect(text).not.toMatch(/\.submit\(|requestSubmit|\.focus\(/);
    // The one event a script sends is the pointer passing over a time link,
    // which is when Facebook writes the post's address into it: no click, no
    // focus change, nothing the page acts on.
    const events = [...text.matchAll(/dispatchEvent\(new (\w+)\("([\w-]+)"/g)].map((match) => `${match[1]}:${match[2]}`);
    expect(events.length).toBe(text.match(/dispatchEvent/g)?.length ?? 0);
    expect(new Set(events)).toEqual(new Set(["MouseEvent:mouseover", "FocusEvent:focusin"]));
    expect(text).not.toMatch(/\bfetch\(|XMLHttpRequest/);
    expect(text).not.toMatch(/\.value\s*=/);
  });
});
