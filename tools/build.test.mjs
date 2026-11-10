// node --test "tools/*.test.mjs"
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), "build.mjs");
const WIN_TAR = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");

function zip(folder, name, dest) {
  if (process.platform === "win32") execFileSync(WIN_TAR, ["--format", "zip", "-cf", dest, name], { cwd: folder });
  else execFileSync("zip", ["-q", "-r", dest, name], { cwd: folder });
}

function unzip(file, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (process.platform === "win32") execFileSync(WIN_TAR, ["-xf", file, "-C", dest]);
  else execFileSync("unzip", ["-q", file, "-d", dest]);
}

// Two upstream "archives" wrapped in a folder like GitHub's, a recipe that
// combines them and a prepare script.
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oxbeat-build-test-"));
  for (const [name, file, text] of [
    ["one", "a.sfz", "<region> sample=a.wav"],
    ["two", "b.txt", "licence two"],
  ]) {
    const src = path.join(dir, "upstream", name);
    fs.mkdirSync(path.join(src, `${name}-abc123`), { recursive: true });
    fs.writeFileSync(path.join(src, `${name}-abc123`, file), text);
    zip(src, `${name}-abc123`, path.join(dir, `${name}.zip`));
  }
  fs.mkdirSync(path.join(dir, "packs"));
  fs.mkdirSync(path.join(dir, "prepare"));
  fs.writeFileSync(
    path.join(dir, "prepare", "combine.mjs"),
    `import fs from "node:fs";
import path from "node:path";
export default async function prepare({ sources, pack, run }) {
  if (typeof run !== "function") throw new Error("run is missing");
  fs.copyFileSync(path.join(sources.one, "a.sfz"), path.join(pack, "Combined.sfz"));
  fs.mkdirSync(path.join(pack, "credits"));
  fs.copyFileSync(path.join(sources.two, "b.txt"), path.join(pack, "credits", "two.txt"));
}
`,
  );
  const recipe = {
    id: "combo",
    name: "Combo",
    version: "1.2.3",
    category: "Keyboards",
    description: "Test pack.",
    author: "Tests",
    license: "CC0 1.0",
    homepage: "https://example.com/combo",
    sources: [
      { name: "one", url: pathToFileURL(path.join(dir, "one.zip")).href },
      { name: "two", url: pathToFileURL(path.join(dir, "two.zip")).href },
    ],
    prepare: "combine.mjs",
    sounds: [{ name: "Combined", file: "Combined.sfz", category: "Strings" }],
  };
  fs.writeFileSync(path.join(dir, "packs", "combo.json"), JSON.stringify(recipe));
  return dir;
}

function build(dir, extra = []) {
  return spawnSync(
    process.execPath,
    [BUILD, "--packs", path.join(dir, "packs"), "--prepare", path.join(dir, "prepare"),
      "--out", path.join(dir, "dist"), "--no-previous", ...extra],
    { encoding: "utf8", timeout: 60_000 },
  );
}

test("sources and prepare build one zip with categories in pack.json", () => {
  const dir = fixture();
  const result = build(dir, ["--allow-file"]);
  assert.equal(result.status, 0, result.stderr + result.stdout);

  const file = path.join(dir, "dist", "combo-1.2.3.zip");
  assert.ok(fs.existsSync(file), "zip was written");
  unzip(file, path.join(dir, "unpacked"));
  const pack = path.join(dir, "unpacked", "combo");
  assert.equal(fs.readFileSync(path.join(pack, "Combined.sfz"), "utf8"), "<region> sample=a.wav");
  assert.equal(fs.readFileSync(path.join(pack, "credits", "two.txt"), "utf8"), "licence two");

  const manifest = JSON.parse(fs.readFileSync(path.join(pack, "pack.json"), "utf8"));
  assert.equal(manifest.category, "Keyboards");
  assert.equal(manifest.homepage, "https://example.com/combo");
  assert.equal(manifest.sounds[0].category, "Strings");

  const index = JSON.parse(fs.readFileSync(path.join(dir, "dist", "index.json"), "utf8"));
  assert.equal(index.packs[0].category, "Keyboards");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("file:// sources need --allow-file", () => {
  const dir = fixture();
  const result = build(dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /https/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a prepare script that leaves out a sound fails the build", () => {
  const dir = fixture();
  const recipe = JSON.parse(fs.readFileSync(path.join(dir, "packs", "combo.json"), "utf8"));
  recipe.sounds.push({ name: "Missing", file: "Missing.sfz" });
  fs.writeFileSync(path.join(dir, "packs", "combo.json"), JSON.stringify(recipe));
  const result = build(dir, ["--allow-file"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing\.sfz is not in the pack/);
  fs.rmSync(dir, { recursive: true, force: true });
});
