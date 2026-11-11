#!/usr/bin/env node
// Builds Oxbeat sound packs from the recipes in packs/*.json.
//
//   node tools/build.mjs [--only <id>] [--force] [--out dist] [--no-previous]
//                        [--packs <dir>] [--prepare <dir>] [--allow-file]
//
// For every recipe it downloads the pinned upstream archives ("source", or
// several named "sources"; a URL that does not end in .zip is kept as a
// single file, checked against its "sha256" when one is given), keeps the files the pack needs or hands them to
// the recipe's prepare script in tools/prepare, writes pack.json, zips it and
// records size and sha256 in dist/index.json. Packs whose version matches the
// published index are not rebuilt: their index entry is carried over, so only
// new zips get uploaded.
//
// --packs and --prepare read recipes and scripts from other folders, and
// --allow-file accepts file:// sources; tools/build.test.mjs uses them.
//
// Needs Node 18+, plus `unzip` and `zip` (Linux/macOS) or the built-in `tar`
// (Windows).

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { retry } from "./prepare/lib.mjs";

const REPO = "matthias-peterlini/Oxbeat-beats";
const BASE_URL = `https://github.com/${REPO}/releases/download/packs/`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SAFE_ID = /^[a-z0-9_-]{1,64}$/;
// Git Bash puts GNU tar first on PATH; only the Windows one writes zips.
const WIN_TAR = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const only = option("--only", null);
const force = flag("--force");
const out = path.resolve(ROOT, option("--out", "dist"));
const work = path.join(out, ".work");
const packsDir = path.resolve(ROOT, option("--packs", "packs"));
const prepareDir = path.resolve(ROOT, option("--prepare", path.join("tools", "prepare")));
const allowFile = flag("--allow-file");
// The app downloads packs over the network on first launch; keep them small.
const MAX_ZIP = 250 * 1048576;

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function readRecipe(file) {
  const recipe = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const key of ["id", "name", "version", "category", "description", "author", "license", "sounds"]) {
    if (!recipe[key]) fail(`${path.basename(file)}: missing "${key}"`);
  }
  if (!SAFE_ID.test(recipe.id)) fail(`${recipe.id}: ids are lowercase letters, digits, - and _`);
  if (`${recipe.id}.json` !== path.basename(file)) fail(`${file}: file name must be ${recipe.id}.json`);
  if (!recipe.source === !recipe.sources) fail(`${recipe.id}: give either "source" or "sources"`);
  recipe.sources ??= [{ name: "source", url: recipe.source }];
  for (const source of recipe.sources) {
    if (!SAFE_ID.test(source.name ?? "")) fail(`${recipe.id}: source names are lowercase letters, digits, - and _`);
    const url = source.url ?? "";
    if (!url.startsWith("https://") && !(allowFile && url.startsWith("file://"))) {
      fail(`${recipe.id}: source ${source.name} must be https`);
    }
    if (source.sha256 && !/^[0-9a-f]{64}$/.test(source.sha256)) fail(`${recipe.id}: source ${source.name} has a bad sha256`);
  }
  if (new Set(recipe.sources.map((s) => s.name)).size !== recipe.sources.length) fail(`${recipe.id}: duplicate source names`);
  if (recipe.prepare && !/^[a-z0-9_-]+\.mjs$/.test(recipe.prepare)) fail(`${recipe.id}: prepare names a script in tools/prepare`);
  if (recipe.prepare && recipe.include) fail(`${recipe.id}: use either include or prepare`);
  if (!recipe.prepare && recipe.sources.length > 1) fail(`${recipe.id}: several sources need a prepare script`);
  for (const sound of recipe.sounds) {
    if (!sound.name || !sound.file) fail(`${recipe.id}: every sound needs a name and a file`);
    if (sound.file.split("/").includes("..")) fail(`${recipe.id}: ${sound.file} leaves the pack`);
    if (sound.kind && !["instrument", "drums"].includes(sound.kind)) fail(`${recipe.id}: bad kind ${sound.kind}`);
    if (sound.preset && !/^\d+:\d+$/.test(sound.preset)) fail(`${recipe.id}: preset must be bank:program`);
  }
  return recipe;
}

async function previousIndex() {
  if (flag("--no-previous")) return [];
  try {
    const response = await fetch(`${BASE_URL}index.json`);
    if (response.status === 404) return [];
    if (!response.ok) fail(`could not fetch the published index: HTTP ${response.status}`);
    return (await response.json()).packs ?? [];
  } catch (error) {
    fail(`could not fetch the published index: ${error.message}`);
  }
}

async function download(url, dest) {
  if (url.startsWith("file://")) return fs.copyFileSync(fileURLToPath(url), dest);
  try {
    const body = await retry(async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    });
    fs.writeFileSync(dest, body);
  } catch (error) {
    fail(`download failed (${error.cause?.message ?? error.message}): ${url}`);
  }
}

function extract(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (process.platform === "win32") execFileSync(WIN_TAR, ["-xf", zip, "-C", dest]);
  else execFileSync("unzip", ["-q", zip, "-d", dest]);
}

function makeZip(folder, name, dest) {
  fs.rmSync(dest, { force: true });
  if (process.platform === "win32") execFileSync(WIN_TAR, ["--format", "zip", "-cf", dest, name], { cwd: folder });
  else execFileSync("zip", ["-q", "-r", "-X", dest, name], { cwd: folder });
}

// GitHub archives wrap everything in one folder named after the repo and sha.
function unwrap(dir) {
  const entries = fs.readdirSync(dir);
  if (entries.length === 1 && fs.statSync(path.join(dir, entries[0])).isDirectory()) {
    return path.join(dir, entries[0]);
  }
  return dir;
}

function copyPack(src, dest, include) {
  if (include) {
    for (const item of include) {
      const from = path.join(src, item);
      if (!fs.existsSync(from)) fail(`included file is missing upstream: ${item}`);
      fs.cpSync(from, path.join(dest, item), { recursive: true });
    }
  } else {
    fs.cpSync(src, dest, {
      recursive: true,
      filter: (file) => !path.basename(file).startsWith(".git"),
    });
  }
}

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

async function build(recipe) {
  const dir = path.join(work, recipe.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const sources = {};
  for (const source of recipe.sources) {
    console.log(`${recipe.id}: downloading ${source.url}`);
    const into = path.join(dir, "sources", source.name);
    const isZip = new URL(source.url).pathname.toLowerCase().endsWith(".zip");
    const file = isZip
      ? path.join(dir, `${source.name}.zip`)
      : path.join(into, decodeURIComponent(path.posix.basename(new URL(source.url).pathname)));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await download(source.url, file);
    if (source.sha256 && sha256(file) !== source.sha256) fail(`${recipe.id}: ${source.url} does not match its sha256`);
    if (!isZip) {
      sources[source.name] = into;
      continue;
    }
    extract(file, into);
    fs.rmSync(file);
    sources[source.name] = unwrap(into);
  }

  const stage = path.join(dir, "stage");
  const pack = path.join(stage, recipe.id);
  fs.mkdirSync(pack, { recursive: true });
  if (recipe.prepare) {
    const script = await import(pathToFileURL(path.join(prepareDir, recipe.prepare)).href);
    const run = (cmd, cmdArgs, options = {}) =>
      execFileSync(cmd, cmdArgs, { stdio: ["ignore", "inherit", "inherit"], ...options });
    const scratch = path.join(dir, "prepare");
    fs.mkdirSync(scratch, { recursive: true });
    await script.default({ sources, pack, run, work: scratch });
  } else {
    copyPack(sources[recipe.sources[0].name], pack, recipe.include);
  }

  for (const sound of recipe.sounds) {
    if (!fs.existsSync(path.join(pack, sound.file))) fail(`${recipe.id}: ${sound.file} is not in the pack`);
  }

  const manifest = {
    id: recipe.id,
    name: recipe.name,
    version: recipe.version,
    category: recipe.category,
    author: recipe.author,
    license: recipe.license,
    description: recipe.description,
    homepage: recipe.homepage,
    sounds: recipe.sounds,
  };
  fs.writeFileSync(path.join(pack, "pack.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const file = `${recipe.id}-${recipe.version}.zip`;
  const zip = path.join(out, file);
  makeZip(stage, recipe.id, zip);
  fs.rmSync(dir, { recursive: true, force: true });

  const size = fs.statSync(zip).size;
  console.log(`${recipe.id}: ${file} (${(size / 1048576).toFixed(1)} MB)`);
  if (size > MAX_ZIP) fail(`${recipe.id}: ${file} is over ${MAX_ZIP / 1048576} MB`);
  return {
    id: recipe.id,
    name: recipe.name,
    category: recipe.category,
    description: recipe.description,
    version: recipe.version,
    license: recipe.license,
    author: recipe.author,
    size,
    url: BASE_URL + file,
    sha256: sha256(zip),
  };
}

const recipes = fs
  .readdirSync(packsDir)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => readRecipe(path.join(packsDir, name)));

if (only && !recipes.some((recipe) => recipe.id === only)) fail(`no recipe called ${only}`);
fs.mkdirSync(out, { recursive: true });

const published = await previousIndex();
const packs = [];
for (const recipe of recipes) {
  const old = published.find((entry) => entry.id === recipe.id);
  const wanted = only ? recipe.id === only : !old || old.version !== recipe.version || force;
  if (wanted) packs.push(await build(recipe));
  else if (old) packs.push({ ...old, name: recipe.name, category: recipe.category, description: recipe.description });
  else console.log(`${recipe.id}: skipped (not published yet)`);
}
fs.rmSync(work, { recursive: true, force: true });

packs.sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(path.join(out, "index.json"), `${JSON.stringify({ version: 1, packs }, null, 2)}\n`);
console.log(`index.json: ${packs.length} packs`);
