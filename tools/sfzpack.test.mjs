// node --test "tools/*.test.mjs"
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { licenseFiles, retry, upstreamCredits } from "./prepare/lib.mjs";
import { creditFiles, resolveSamples } from "./prepare/sfzpack.mjs";

function folder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sfzpack-test-"));
  for (const name of files) fs.writeFileSync(path.join(dir, name), name);
  return dir;
}

test("licence files are found under any licence-like name", () => {
  const dir = folder(["LICENSE.txt", "copying", "Licence.md", "README.md", "notes.txt"]);
  const names = licenseFiles(dir, "repo").map(([, to]) => to).sort();
  assert.deepEqual(names, ["repo-Licence.md", "repo-LICENSE.txt", "repo-copying.txt"].sort());
});

test("a source with no licence file is an error", () => {
  const dir = folder(["README.md", "a.sfz"]);
  assert.throws(() => licenseFiles(dir, "repo"), /no licence/);
  assert.throws(() => creditFiles({ repo: dir }), /no licence/);
});

test("a licence stated in another file counts only if the statement is there", () => {
  const dir = folder(["README.md"]);
  fs.writeFileSync(path.join(dir, "README.md"), "Public Domain samples by AKAI\n");
  const stated = { statedIn: "README.md", statement: /public domain/i };
  assert.deepEqual(upstreamCredits(dir, "repo", stated).map(([, to]) => to), ["repo-README.md"]);
  assert.throws(() => upstreamCredits(dir, "repo", { statedIn: "README.md", statement: /CC0/ }), /no licence/);
  assert.throws(() => upstreamCredits(dir, "repo", { statedIn: "LICENSE", statement: /public domain/i }), /no licence/);
});

test("credit files are every licence and readme of each repo", () => {
  const dir = folder(["COPYING.md", "readme.txt", "a.sfz"]);
  assert.deepEqual(creditFiles({ repo: dir }).map(([, to]) => to).sort(), ["repo-COPYING.md", "repo-readme.txt"]);
});

test("samples resolve to the repository's own casing", () => {
  const dir = path.join(os.tmpdir(), "repo");
  const regions = [{ sample: path.join(dir, "samples/Low E.WAV") }, { sample: path.join(dir, "Samples/low e.wav") }];
  const rels = resolveSamples(regions, dir, ["Samples/Low E.wav", "readme.txt"], "repo");
  assert.deepEqual([...rels], ["Samples/Low E.wav"]);
  for (const r of regions) assert.equal(r.sample, path.join(dir, "Samples/Low E.wav"));
});

test("a sample missing from the repository is an error", () => {
  const dir = path.join(os.tmpdir(), "repo");
  assert.throws(() => resolveSamples([{ sample: path.join(dir, "gone.wav") }], dir, ["a.wav"], "repo"), /not in the repository/);
});

test("a download that drops twice succeeds on the third attempt", async () => {
  let calls = 0;
  const result = await retry(async () => {
    calls += 1;
    if (calls < 3) throw new Error("other side closed");
    return "ok";
  }, { delayMs: 0, log: () => {} });
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("a download that keeps failing gives up after three attempts", async () => {
  let calls = 0;
  await assert.rejects(retry(async () => {
    calls += 1;
    throw new Error("other side closed");
  }, { delayMs: 0, log: () => {} }), /other side closed/);
  assert.equal(calls, 3);
});
