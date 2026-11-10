// Builds a pack from upstream SFZ programs (the Karoryfer libraries): each
// program is flattened to the regions Oxbeat can play at default controller
// settings (see sfz.mjs), and only the samples those regions use are fetched
// and re-encoded as 16-bit FLAC under samples/<repo>/.

import fs from "node:fs";
import path from "node:path";
import { MB, fetchRepo, flacBinary, flacEncoder, folderSize, readWav } from "./lib.mjs";
import { playableRegions, writeFlatSfz } from "./sfz.mjs";

const escape = (p) => p.replace(/([\\*?[\]!# ])/g, "\\$1");

// Sustain loop points from a WAV's smpl chunk, or null.
function smplLoop(file) {
  const b = fs.readFileSync(file);
  for (let pos = 12; pos + 8 <= b.length;) {
    const id = b.toString("ascii", pos, pos + 4);
    const size = b.readUInt32LE(pos + 4);
    if (id === "smpl" && b.readUInt32LE(pos + 8 + 28) > 0) {
      const loop = pos + 8 + 36;
      return { start: b.readUInt32LE(loop + 8), end: b.readUInt32LE(loop + 12) };
    }
    pos += 8 + size + (size & 1);
  }
  return null;
}

// repos: { key: { url, sha, license, extra?: [patterns] } }
// programs: [{ name, repo, file, defines?, defaultPath?, keep? }]
export function buildSfzPack({ repos, programs, pack, work, run }) {
  const flac = flacBinary();
  run(flac, ["--version"]);
  const encode = flacEncoder(flac, run, work);
  const base = ["*.sfz", "/LICENSE", "/license", "/LICENSE.md", "/README.md", "/readme.txt", "/Readme.txt"];
  const dirs = {};
  const parsed = [];
  for (const [key, spec] of Object.entries(repos)) dirs[key] = fetchRepo({ ...spec, patterns: base }, work, run);

  // Pass 1: parse, then check out exactly the samples each repo needs.
  const needed = Object.fromEntries(Object.keys(repos).map((k) => [k, new Set()]));
  for (const p of programs) {
    const dir = dirs[p.repo];
    const { regions, dropped, unused } = playableRegions(path.join(dir, p.file), p);
    if (!regions.length) throw new Error(`${p.name}: no playable regions`);
    parsed.push({ p, regions });
    console.log(`sfzpack: ${p.name}: ${regions.length} regions, dropped ${JSON.stringify(dropped)}`);
    if (unused.length) console.log(`sfzpack:   ignored opcodes: ${unused.join(" ")}`);
    for (const r of regions) needed[p.repo].add(r.sample);
  }
  for (const [key, spec] of Object.entries(repos)) {
    const dir = dirs[key];
    const actual = new Map(run("git", ["-C", dir, "ls-tree", "-r", "--name-only", spec.sha], { stdio: "pipe", encoding: "utf8", maxBuffer: 64 * MB })
      .split("\n").filter(Boolean).map((f) => [f.toLowerCase(), f]));
    const patterns = [...base, ...(spec.extra ?? [])];
    for (const s of needed[key]) {
      const rel = path.relative(dir, s).replace(/\\/g, "/");
      const real = actual.get(rel.toLowerCase());
      if (!real) throw new Error(`${key}: ${rel} is not in the repository`);
      patterns.push(`/${escape(real)}`);
    }
    fetchRepo({ ...spec, patterns }, work, run);
  }

  // Pass 2: encode each sample once and write the flat programs.
  const names = new Map();
  const loops = new Map();
  fs.mkdirSync(path.join(pack, "samples"), { recursive: true });
  for (const { p, regions } of parsed) {
    const dir = dirs[p.repo];
    for (const r of regions) {
      if (!names.has(r.sample)) {
        const rel = path.relative(dir, r.sample).replace(/\\/g, "/").replace(/^samples\//i, "").replace(/\.wav$/i, ".flac");
        const name = `${p.repo}/${rel}`;
        const out = path.join(pack, "samples", name);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        const { rate, channels } = readWav(r.sample);
        encode(channels, rate, out);
        names.set(r.sample, name);
        loops.set(r.sample, smplLoop(r.sample));
      }
      const o = r.opcodes;
      if (/^loop_(continuous|sustain)$/.test(o.loop_mode ?? "") && o.loop_start === undefined) {
        const loop = loops.get(r.sample);
        if (loop) Object.assign(o, { loop_start: loop.start, loop_end: loop.end });
        else delete o.loop_mode;
      }
    }
    writeFlatSfz(path.join(pack, `${p.name}.sfz`), {
      header: [
        p.name,
        `From ${repos[p.repo].url} (${repos[p.repo].sha}), ${p.file}, ${repos[p.repo].license}.`,
        "Flattened by tools/prepare/sfzpack.mjs: regions silent at default controller settings,",
        "release triggers and opcodes Oxbeat does not read are left out. Samples are 16-bit FLAC.",
      ],
      regions,
      rename: (s) => names.get(s),
    });
  }
  console.log(`sfzpack: ${names.size} samples, ${(folderSize(pack) / MB).toFixed(1)} MB`);
  return dirs;
}

// Each repo's licence and readme, as copyCredits [from, to] pairs.
export function creditFiles(dirs) {
  const files = [];
  for (const [key, dir] of Object.entries(dirs)) {
    for (const f of ["LICENSE", "license", "LICENSE.md", "README.md", "readme.txt", "Readme.txt"]) {
      if (fs.readdirSync(dir).includes(f)) files.push([path.join(dir, f), `${key}-${f}${f.includes(".") ? "" : ".txt"}`]);
    }
  }
  return files;
}
