// Builds a pack from upstream SFZ programs (the Karoryfer libraries): each
// program is flattened to the regions Oxbeat can play at default controller
// settings (see sfz.mjs), and only the samples those regions use are fetched
// and re-encoded as 16-bit FLAC under samples/<repo>/.

import fs from "node:fs";
import path from "node:path";
import { CREDIT_PATTERNS, MB, fetchRepo, flacBinary, flacEncoder, folderSize, readWav, upstreamCredits } from "./lib.mjs";
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

// SFZ programs name samples in any casing, which only works on a
// case-insensitive filesystem. Point each region's sample at the path as the
// repository spells it (`tree`: `git ls-tree` names) and return those paths.
export function resolveSamples(regions, dir, tree, key) {
  const actual = new Map(tree.map((f) => [f.toLowerCase(), f]));
  const rels = new Set();
  for (const r of regions) {
    const rel = path.relative(dir, r.sample).replace(/\\/g, "/");
    const real = actual.get(rel.toLowerCase());
    if (!real) throw new Error(`${key}: ${rel} is not in the repository`);
    r.sample = path.join(dir, real);
    rels.add(real);
  }
  return rels;
}

// repos: { key: { url, sha, license, extra?: [patterns] } }
// programs: [{ name, repo, file, defines?, defaultPath?, keep? }]
export function buildSfzPack({ repos, programs, pack, work, run }) {
  const flac = flacBinary();
  run(flac, ["--version"]);
  const encode = flacEncoder(flac, run, work);
  const base = ["*.sfz", ...CREDIT_PATTERNS];
  const dirs = {};
  const parsed = [];
  for (const [key, spec] of Object.entries(repos)) dirs[key] = fetchRepo({ ...spec, patterns: base }, work, run);

  // Pass 1: parse, resolve every sample to the repository's own casing (pass 2
  // and the output SFZ use that path), then check out exactly those samples.
  const needed = Object.fromEntries(Object.keys(repos).map((k) => [k, []]));
  for (const p of programs) {
    const dir = dirs[p.repo];
    const { regions, dropped, unused } = playableRegions(path.join(dir, p.file), p);
    if (!regions.length) throw new Error(`${p.name}: no playable regions`);
    parsed.push({ p, regions });
    console.log(`sfzpack: ${p.name}: ${regions.length} regions, dropped ${JSON.stringify(dropped)}`);
    if (unused.length) console.log(`sfzpack:   ignored opcodes: ${unused.join(" ")}`);
    needed[p.repo].push(...regions);
  }
  for (const [key, spec] of Object.entries(repos)) {
    const dir = dirs[key];
    const tree = run("git", ["-C", dir, "ls-tree", "-r", "--name-only", spec.sha], { stdio: "pipe", encoding: "utf8", maxBuffer: 64 * MB })
      .split("\n").filter(Boolean);
    const rels = resolveSamples(needed[key], dir, tree, key);
    fetchRepo({ ...spec, patterns: [...base, ...(spec.extra ?? []), ...[...rels].map((s) => `/${escape(s)}`)] }, work, run);
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

// Each repo's licences and readmes, as copyCredits [from, to] pairs. Throws
// when a repo has no licence file.
export function creditFiles(dirs) {
  return Object.entries(dirs).flatMap(([key, dir]) => upstreamCredits(dir, key));
}
