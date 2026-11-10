// node --test "tools/*.test.mjs"
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { playableRegions } from "./prepare/sfz.mjs";

function program(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sfz-test-"));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

test("several #define and #include directives on one line are all read", () => {
  const dir = program({
    "main.sfz": '#define $A 60 #define $B 72\n#include "a.txt" #include "b.txt"\n',
    "a.txt": "<region> key=$A sample=a.wav\n",
    "b.txt": "<region> key=$B sample=b.wav\n",
  });
  const { regions } = playableRegions(path.join(dir, "main.sfz"));
  assert.deepEqual(regions.map((r) => r.opcodes.key), ["60", "72"]);
});

test("envelope stages set by a controller are folded in at its default value", () => {
  const dir = program({
    "main.sfz": "<control> set_cc103=127 set_cc102=0\n<global> ampeg_sustain=0 ampeg_sustain_oncc103=100 ampeg_decay=0.5 ampeg_decay_oncc102=6\n<region> key=60 sample=a.wav\n",
  });
  const [r] = playableRegions(path.join(dir, "main.sfz")).regions;
  assert.equal(r.opcodes.ampeg_sustain, "100");
  assert.equal(r.opcodes.ampeg_decay, "0.5");
});
