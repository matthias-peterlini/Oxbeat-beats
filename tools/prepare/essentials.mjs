// Prepares "Oxbeat Essentials", the pack Oxbeat downloads on first launch.
//
// It combines, at pinned commits:
//   - Salamander Grand Piano (5 of 16 velocity layers, 44.1 kHz/16-bit, 10 s tails)
//   - Greg Sullivan's Wurlitzer EP200 (E-Pianos)
//   - VSCO 2 Community Edition: upright, organ, strings, winds, brass, percussion
//     (no SFZ upstream at that commit, so one is written per instrument)
//   - Sam's Sonor drums, as Drums.sfz
//   - GeneralUser GS, for GM sounds the samples above do not cover
//
// The GitHub archives of the sample libraries are several GB, so they are
// fetched with a sparse, blobless git clone. Set OXBEAT_GIT_CACHE to a folder to
// keep those clones between builds (each one is named after its repo).
//
// Needs git and flac (FLAC 1.3+). Set FLAC to the flac binary if it is not on PATH.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MB = 1048576;

const REPOS = {
  salamander: {
    url: "https://github.com/sfzinstruments/SalamanderGrandPiano",
    sha: "3382bf9496bba2486f5ab0de55a264d1dfc38404",
    patterns: ["/LICENSE", "/README.md", ...[1, 5, 9, 13, 16].map((v) => `/Samples/*v${v}.flac`)],
  },
  epianos: {
    url: "https://github.com/sfzinstruments/GregSullivan.E-Pianos",
    sha: "8c3e581acda3594b553948ff0222d4f84a698376",
    patterns: ["/LICENSE", "/README.md", "/Wurlitzer EP200/"],
  },
  vsco: {
    url: "https://github.com/sgossner/VSCO-2-CE",
    sha: "440300901dfe9275fd84e0b7763af1f8443ae62e",
    patterns: [
      "/LICENSE", "/README.md", "/Readme.txt",
      "/Keys/Upright Nr1/", "/Keys/Organ/Quiet/",
      "/Strings/Harp/", "/Strings/Violin Section/susVib/", "/Strings/Viola Section/susvib/",
      "/Strings/Cello Section/susvib/", "/Strings/Solo Contrabass/SusNV/",
      "/Woodwinds/Flute/susNV/", "/Woodwinds/Oboe/Sus/", "/Woodwinds/Clarinet/susLong/",
      "/Brass/F Horn/sus/", "/Brass/Trumpet/sus/", "/Brass/Tenor Trombone/sus/",
      "/Percussion/Glock/", "/Percussion/Marimba/", "/Percussion/Timpani/",
    ],
  },
};

// Budgets from the plan, in MB of FLAC in the zip.
const BUDGETS = {
  piano: 110, epiano: 20, keys: 25, strings: 40, orchestra: 25, percussion: 10, drums: 35, gm: 32,
};

// ---------------------------------------------------------------- tools

function flacBinary() {
  if (process.env.FLAC) return process.env.FLAC;
  if (process.platform === "win32") {
    const winget = path.join(os.homedir(), "AppData", "Local", "Microsoft", "WinGet", "Packages");
    if (fs.existsSync(winget)) {
      for (const dir of fs.readdirSync(winget).filter((d) => d.startsWith("Xiph.FLAC"))) {
        for (const sub of fs.readdirSync(path.join(winget, dir))) {
          const exe = path.join(winget, dir, sub, "Win64", "flac.exe");
          if (fs.existsSync(exe)) return exe;
        }
      }
    }
  }
  return "flac";
}

function fetchRepo(spec, work, run) {
  const name = spec.url.split("/").pop();
  const dir = path.join(process.env.OXBEAT_GIT_CACHE || work, name);
  if (!fs.existsSync(path.join(dir, ".git"))) {
    run("git", ["clone", "--filter=blob:none", "--no-checkout", "--sparse", spec.url, dir]);
  }
  try {
    run("git", ["-C", dir, "cat-file", "-e", `${spec.sha}^{commit}`], { stdio: "ignore" });
  } catch {
    run("git", ["-C", dir, "fetch", "--filter=blob:none", "origin", spec.sha]);
  }
  run("git", ["-C", dir, "sparse-checkout", "set", "--no-cone", ...spec.patterns]);
  run("git", ["-C", dir, "-c", "core.autocrlf=false", "checkout", "--quiet", "--detach", spec.sha]);
  return dir;
}

// ---------------------------------------------------------------- WAV

function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${file}: not a WAV file`);
  }
  let fmt;
  let data;
  for (let pos = 12; pos + 8 <= b.length;) {
    const id = b.toString("ascii", pos, pos + 4);
    const size = b.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt ") {
      fmt = {
        format: b.readUInt16LE(body),
        channels: b.readUInt16LE(body + 2),
        rate: b.readUInt32LE(body + 4),
        bits: b.readUInt16LE(body + 14),
      };
      if (fmt.format === 0xfffe) fmt.format = b.readUInt16LE(body + 24);
    } else if (id === "data") {
      data = { start: body, size: Math.min(size, b.length - body) };
    }
    pos = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error(`${file}: missing fmt or data`);
  const { format, channels, bits } = fmt;
  const width = bits / 8;
  const frames = Math.floor(data.size / (width * channels));
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  let o = data.start;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++, o += width) {
      let v;
      if (format === 3 && bits === 32) v = b.readFloatLE(o);
      else if (format === 3 && bits === 64) v = b.readDoubleLE(o);
      else if (bits === 16) v = b.readInt16LE(o) / 32768;
      else if (bits === 24) v = (((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) << 8) >> 8) / 8388608;
      else if (bits === 32) v = b.readInt32LE(o) / 2147483648;
      else if (bits === 8) v = (b[o] - 128) / 128;
      else throw new Error(`${file}: unsupported ${bits}-bit format ${format}`);
      out[c][i] = v;
    }
  }
  return { rate: fmt.rate, channels: out };
}

// 16-bit PCM with TPDF dither.
function writeWav(file, rate, channels) {
  const n = channels[0].length;
  const ch = channels.length;
  const b = Buffer.alloc(44 + n * ch * 2);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + n * ch * 2, 4);
  b.write("WAVEfmt ", 8, "ascii");
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(ch, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * ch * 2, 28);
  b.writeUInt16LE(ch * 2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36, "ascii");
  b.writeUInt32LE(n * ch * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++, o += 2) {
      const v = Math.round(channels[c][i] * 32767 + Math.random() - Math.random());
      b.writeInt16LE(Math.max(-32768, Math.min(32767, v)), o);
    }
  }
  fs.writeFileSync(file, b);
}

// ---------------------------------------------------------------- DSP

// Polyphase windowed-sinc resampler for rational ratios (48000 -> 44100 is 147/160).
function resampler(from, to, half = 16) {
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = gcd(from, to);
  const up = to / g;
  const down = from / g;
  const cutoff = 0.5 * Math.min(1, to / from) * 0.95; // cycles per input sample
  const table = [];
  for (let k = 0; k < up; k++) {
    const frac = k / up;
    const taps = new Float64Array(2 * half);
    let sum = 0;
    for (let j = 0; j < 2 * half; j++) {
      const t = j - half + 1 - frac;
      const x = 2 * cutoff * t;
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.42 + 0.5 * Math.cos((Math.PI * t) / half) + 0.08 * Math.cos((2 * Math.PI * t) / half);
      taps[j] = 2 * cutoff * sinc * (Math.abs(t) < half ? w : 0);
      sum += taps[j];
    }
    for (let j = 0; j < taps.length; j++) taps[j] /= sum;
    table.push(taps);
  }
  return (input, frames) => {
    const out = new Float32Array(frames);
    for (let n = 0; n < frames; n++) {
      const pos = n * down;
      const i = Math.floor(pos / up);
      const taps = table[pos % up];
      let acc = 0;
      for (let j = 0; j < taps.length; j++) {
        const idx = i - half + 1 + j;
        if (idx >= 0 && idx < input.length) acc += input[idx] * taps[j];
      }
      out[n] = acc;
    }
    return out;
  };
}

const peakOf = (channels) => {
  let p = 0;
  for (const ch of channels) for (const v of ch) p = Math.max(p, Math.abs(v));
  return p;
};

function slice(channels, start, end) {
  return channels.map((ch) => ch.slice(start, end));
}

// Drop the silence before the attack, keeping a few ms in front of it.
function trimLead(channels, rate, db = -40) {
  const limit = peakOf(channels) * 10 ** (db / 20);
  let first = channels[0].length;
  for (const ch of channels) {
    const i = ch.findIndex((v) => Math.abs(v) > limit);
    if (i >= 0) first = Math.min(first, i);
  }
  return slice(channels, Math.max(0, first - Math.round(0.01 * rate)));
}

// Cut at `seconds` (or where the sound has died away), then fade out.
function tail(channels, rate, seconds, fade = 0.2, db = -72) {
  const limit = peakOf(channels) * 10 ** (db / 20);
  let last = 0;
  for (const ch of channels) {
    for (let i = ch.length - 1; i > last; i--) if (Math.abs(ch[i]) > limit) { last = i; break; }
  }
  const end = Math.min(Math.round(seconds * rate), last + Math.round(0.05 * rate), channels[0].length);
  const out = slice(channels, 0, end);
  const n = Math.min(Math.round(fade * rate), end);
  for (const ch of out) {
    for (let i = 0; i < n; i++) ch[end - n + i] *= Math.cos(((i + 1) / n) * (Math.PI / 2));
  }
  return out;
}

const mono = (channels) => {
  if (channels.length === 1) return channels;
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
  return [out];
};

// A crossfaded sustain loop: the last `fade` seconds before the loop end blend
// into the audio just before the loop start, so the jump back is seamless.
function sustainLoop(channels, rate, { loopFrom = 1.0, loopTo = 4.0, fade = 0.1 } = {}) {
  const len = channels[0].length;
  const end = Math.min(Math.round(loopTo * rate), len - 1 - Math.round(0.05 * rate));
  const start = Math.min(Math.round(loopFrom * rate), Math.floor(end * 0.4));
  const x = Math.min(Math.round(fade * rate), Math.floor((end - start) / 2), start);
  if (end <= 0 || x < 64) return { channels, loop: null };
  const out = slice(channels, 0, end + 1);
  for (let c = 0; c < out.length; c++) {
    const src = channels[c];
    for (let i = 0; i < x; i++) {
      const t = ((i + 1) / x) * (Math.PI / 2);
      const a = end - x + 1 + i;
      out[c][a] = src[a] * Math.cos(t) + src[start - x + 1 + i] * Math.sin(t);
    }
  }
  return { channels: out, loop: { start, end } };
}

// ---------------------------------------------------------------- mapping

const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// `octave` is the MIDI note of C0 divided by 12: 1 when C4 = 60, 2 when C3 = 60.
function noteNumber(name, octave) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note name ${name}`);
  return (Number(m[3]) + octave) * 12 + SEMI[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
}

// Key ranges halfway between neighbouring roots; the outer ones reach an octave further.
function keyRanges(roots) {
  const sorted = [...new Set(roots)].sort((a, b) => a - b);
  const ranges = new Map();
  sorted.forEach((root, i) => {
    const lo = i === 0 ? Math.max(0, root - 12) : Math.floor((sorted[i - 1] + root) / 2) + 1;
    const hi = i === sorted.length - 1 ? Math.min(127, root + 12) : Math.floor((root + sorted[i + 1]) / 2);
    ranges.set(root, [lo, hi]);
  });
  return ranges;
}

function velRanges(count) {
  return Array.from({ length: count }, (_, j) => [j === 0 ? 1 : Math.floor((j * 127) / count) + 1, Math.floor(((j + 1) * 127) / count)]);
}

function writeSfz(file, { title, credit, slug, global, regions }) {
  const lines = [
    `// ${title}`,
    `// ${credit}`,
    "// Generated by tools/prepare/essentials.mjs (github.com/matthias-peterlini/Oxbeat-beats).",
    "",
    "<control>",
    `default_path=samples/${slug}/`,
    "",
    `<global> ${Object.entries(global).map(([k, v]) => `${k}=${v}`).join(" ")}`,
    "",
  ];
  for (const r of regions) lines.push(`<region> ${Object.entries(r).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
}

function folderSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? folderSize(p) : fs.statSync(p).size;
  }
  return total;
}

// ---------------------------------------------------------------- instruments

const VSCO_CREDIT = "Samples: VS Chamber Orchestra Community Edition by Versilian Studios (CC0 1.0).";

// File-name parsers return { root, layer, rr } or null. Layers sort soft to loud.
const note = (re, octave, extra = () => ({})) => (file) => {
  const m = re.exec(file);
  return m ? { root: noteNumber(m[1], octave), layer: m[2] ? Number(m[2]) : 0, rr: 1, ...extra(m) } : null;
};

const SUSTAIN = { mode: "loop", stereo: false, release: 0.3, veltrack: 60 };

const VSCO = [
  {
    name: "Upright Piano", slug: "upright", group: "keys", dir: "Keys/Upright Nr1", mode: "decay", stereo: true,
    seconds: 5, release: 0.4, veltrack: 50,
    parse: note(/^UR1_([A-G]#?\d)_(pp|mf|f)_RR([12])\.wav$/, 1, (m) => ({ layer: ["pp", "mf", "f"].indexOf(m[2]), rr: Number(m[3]) })),
  },
  {
    name: "Organ", slug: "organ", group: "keys", dir: "Keys/Organ/Quiet", ...SUSTAIN, release: 0.15, veltrack: 20,
    parse: (file) => {
      const m = /^NT5_Man3Quiet_(\d+)_rr1\.wav$/.exec(file);
      return m ? { root: Number(m[1]) - 86, layer: 0, rr: 1 } : null;
    },
  },
  { name: "Violins", slug: "violins", group: "strings", dir: "Strings/Violin Section/susVib", ...SUSTAIN, parse: note(/^VlnEns_susVib_([A-G]#?\d)_v(\d)\.wav$/, 2) },
  { name: "Violas", slug: "violas", group: "strings", dir: "Strings/Viola Section/susvib", ...SUSTAIN, parse: note(/^ViolaEns_susvib_([A-G]#?\d)_v(\d)_1\.wav$/, 2) },
  { name: "Cellos", slug: "cellos", group: "strings", dir: "Strings/Cello Section/susvib", ...SUSTAIN, parse: note(/^susvib_([A-G]#?\d)_v(\d)_1\.wav$/, 2) },
  { name: "Double Bass", slug: "double-bass", group: "strings", dir: "Strings/Solo Contrabass/SusNV", ...SUSTAIN, parse: note(/^BKCtbss_SusNV_([A-G]#?\d)_v(\d)_rr1\.wav$/, 2) },
  {
    name: "Harp", slug: "harp", group: "strings", dir: "Strings/Harp", mode: "decay", stereo: false, seconds: 5, release: 0.8, veltrack: 80,
    parse: note(/^KSHarp_([A-G]#?\d)_(?:mf|f|mp)\.wav$/, 1),
  },
  { name: "Flute", slug: "flute", group: "orchestra", dir: "Woodwinds/Flute/susNV", ...SUSTAIN, parse: note(/^LDFlute_susNV_([A-G]#?\d)_v(\d)_1\.wav$/, 2) },
  { name: "Oboe", slug: "oboe", group: "orchestra", dir: "Woodwinds/Oboe/Sus", ...SUSTAIN, parse: note(/^Oboe_Sus_([A-G]#?\d)_v(\d)_Main\.wav$/, 2) },
  { name: "Clarinet", slug: "clarinet", group: "orchestra", dir: "Woodwinds/Clarinet/susLong", ...SUSTAIN, parse: note(/^DCClar_susLong_([A-G]#?\d)_v(\d)_rr1_sum\.wav$/, 2) },
  { name: "Trumpet", slug: "trumpet", group: "orchestra", dir: "Brass/Trumpet/sus", ...SUSTAIN, parse: note(/^Sum_SHTrumpet_sus_([A-G]#?\d)_v(\d)_rr1\.wav$/, 2) },
  { name: "French Horn", slug: "horn", group: "orchestra", dir: "Brass/F Horn/sus", ...SUSTAIN, parse: note(/^MOHorn_sus_([A-G]#?\d)_v(\d)_1\.wav$/, 2) },
  { name: "Trombone", slug: "trombone", group: "orchestra", dir: "Brass/Tenor Trombone/sus", ...SUSTAIN, parse: note(/^tenortbn_sus_([A-G]#?\d)_v(\d)_1\.wav$/, 2) },
  {
    name: "Glockenspiel", slug: "glockenspiel", group: "percussion", dir: "Percussion/Glock", mode: "oneshot", stereo: false, seconds: 3, veltrack: 90,
    parse: note(/^glock_medium_([A-G]#?\d)\.wav$/, 2),
  },
  {
    name: "Marimba", slug: "marimba", group: "percussion", dir: "Percussion/Marimba", mode: "oneshot", stereo: false, seconds: 2.5, veltrack: 90,
    parse: note(/^Marimba_hit_Outrigger_([A-G]#?\d)_loud_01\.wav$/, 2),
  },
  {
    // Each drum is tuned to one pitch. These are the measured principal (1,1)
    // modes, as [nearest key, cents to reach it]: F2+45, A#2+75, C#3+50, E3+40, F#3+60.
    name: "Timpani", slug: "timpani", group: "percussion", dir: "Percussion/Timpani", mode: "oneshot", stereo: false, seconds: 3, veltrack: 60,
    roundRobin: true,
    parse: (file) => {
      const m = /^Timpani(\d)_Hit_v(\d)_rr(\d)_Sum\.wav$/.exec(file);
      const roots = { 1: [41, -45], 2: [47, 25], 3: [50, 50], 4: [52, -40], 5: [55, 40] };
      return m ? { root: roots[m[1]][0], tune: roots[m[1]][1], layer: Number(m[2]), rr: Number(m[3]) } : null;
    },
  },
];

function buildVsco(inst, root, pack, work, encode) {
  const dir = path.join(root, inst.dir);
  const found = new Map(); // "root/layer/rr" -> file
  for (const file of fs.readdirSync(dir).sort()) {
    const hit = inst.parse(file);
    if (hit) found.set(`${hit.root}/${hit.layer}/${hit.rr}`, { ...hit, file });
  }
  // Without round robins, keep the lowest-numbered take of each note and layer.
  let takes = [...found.values()];
  if (!inst.roundRobin) {
    const best = new Map();
    for (const t of takes.sort((a, b) => a.rr - b.rr)) {
      const key = `${t.root}/${t.layer}`;
      if (!best.has(key)) best.set(key, t);
    }
    takes = [...best.values()];
  }
  if (!takes.length) throw new Error(`${inst.name}: no samples matched in ${inst.dir}`);

  const out = path.join(pack, "samples", inst.slug);
  fs.mkdirSync(out, { recursive: true });
  const keys = keyRanges(takes.map((t) => t.root));
  const regions = [];
  for (const [rootKey, [lokey, hikey]] of [...keys].sort((a, b) => a[0] - b[0])) {
    const forRoot = takes.filter((t) => t.root === rootKey);
    const layers = [...new Set(forRoot.map((t) => t.layer))].sort((a, b) => a - b);
    const vels = velRanges(layers.length);
    for (const t of forRoot.sort((a, b) => a.layer - b.layer || a.rr - b.rr)) {
      const wav = readWav(path.join(dir, t.file));
      let ch = trimLead(inst.stereo ? wav.channels.slice(0, 2) : mono(wav.channels), wav.rate);
      let loop = null;
      if (inst.mode === "loop") ({ channels: ch, loop } = sustainLoop(ch, wav.rate));
      else ch = tail(ch, wav.rate, inst.seconds, inst.mode === "oneshot" ? 0.3 : 0.2);
      const name = `${t.root}_v${t.layer}${inst.roundRobin ? `_rr${t.rr}` : ""}`;
      encode(ch, wav.rate, path.join(out, `${name}.flac`));
      const [lovel, hivel] = vels[layers.indexOf(t.layer)];
      const region = { sample: `${name}.flac`, lokey, hikey, pitch_keycenter: rootKey, lovel, hivel };
      if (t.tune) region.tune = t.tune;
      if (loop) Object.assign(region, { loop_mode: "loop_continuous", loop_start: loop.start, loop_end: loop.end });
      if (inst.mode === "oneshot") region.loop_mode = "one_shot";
      if (inst.roundRobin) {
        const rrs = forRoot.filter((o) => o.layer === t.layer).length;
        if (rrs > 1) Object.assign(region, { seq_length: rrs, seq_position: t.rr });
      }
      regions.push(region);
    }
  }
  const global = { amp_veltrack: inst.veltrack };
  if (inst.mode !== "oneshot") global.ampeg_release = inst.release;
  if (inst.mode === "loop") global.ampeg_attack = 0.005;
  writeSfz(path.join(pack, `${inst.name}.sfz`), {
    title: `${inst.name} - Oxbeat Essentials`, credit: VSCO_CREDIT, slug: inst.slug, global, regions,
  });
  console.log(`essentials: ${inst.name}: ${regions.length} regions`);
}

// Salamander: velocity layer -> velocity range kept.
const PIANO_LAYERS = [[1, 1, 34], [5, 35, 56], [9, 57, 80], [13, 81, 112], [16, 113, 127]];
const PIANO_NOTES = ["A0", "C1", "D#1", "F#1", "A1", "C2", "D#2", "F#2", "A2", "C3", "D#3", "F#3", "A3",
  "C4", "D#4", "F#4", "A4", "C5", "D#5", "F#5", "A5", "C6", "D#6", "F#6", "A6", "C7", "D#7", "F#7", "A7", "C8"];

function buildPiano(root, pack, work, run, flac, encode) {
  const out = path.join(pack, "samples", "piano");
  fs.mkdirSync(out, { recursive: true });
  const resample = resampler(48000, 44100);
  const roots = PIANO_NOTES.map((n) => noteNumber(n, 1));
  const keys = keyRanges(roots);
  keys.set(roots[0], [21, keys.get(roots[0])[1]]);
  keys.set(roots.at(-1), [keys.get(roots.at(-1))[0], 108]);
  const regions = [];
  const tmp = path.join(work, "piano.wav");
  for (const [i, noteName] of PIANO_NOTES.entries()) {
    for (const [layer, lovel, hivel] of PIANO_LAYERS) {
      run(flac, ["-d", "-s", "-f", "-o", tmp, path.join(root, "Samples", `${noteName}v${layer}.flac`)]);
      const wav = readWav(tmp);
      let ch = wav.channels;
      if (wav.rate !== 44100) {
        const keep = Math.min(ch[0].length, Math.round(10.1 * wav.rate));
        const frames = Math.floor((keep * 44100) / wav.rate);
        ch = ch.map((c) => resample(c.subarray(0, keep + 32), frames));
      }
      ch = tail(ch, 44100, 10, 0.2);
      const name = `${noteName.replace("#", "s")}v${layer}`;
      encode(ch, 44100, path.join(out, `${name}.flac`));
      const [lokey, hikey] = keys.get(roots[i]);
      regions.push({ sample: `${name}.flac`, lokey, hikey, pitch_keycenter: roots[i], lovel, hivel });
    }
    console.log(`essentials: Grand Piano: ${noteName}`);
  }
  fs.rmSync(tmp, { force: true });
  writeSfz(path.join(pack, "Grand Piano.sfz"), {
    title: "Grand Piano - Oxbeat Essentials",
    credit: "Samples: Salamander Grand Piano V3 by Alexander Holm (CC BY 3.0), SFZ by sfzinstruments.",
    slug: "piano",
    // Salamander's own mapping tracks velocity gently; release samples are left out.
    global: { amp_veltrack: 30, ampeg_release: 0.8 },
    regions,
  });
}

function buildEpiano(root, pack) {
  const src = path.join(root, "Wurlitzer EP200");
  const out = path.join(pack, "samples", "e-piano");
  fs.cpSync(path.join(src, "Samples"), out, { recursive: true });
  let sfz = fs.readFileSync(path.join(src, "Wurlitzer EP200.sfz"), "utf8");
  const patched = sfz
    .replace("default_path=Samples/", "default_path=samples/e-piano/")
    // Velocity is tracked through CC99 upstream; Oxbeat reads the plain opcodes.
    .replace(/^amp_veltrack=0$/m, "amp_veltrack=100\nampeg_release=0.15");
  if (patched === sfz || !patched.includes("amp_veltrack=100")) throw new Error("Wurlitzer EP200.sfz changed upstream");
  sfz = patched;
  fs.writeFileSync(path.join(pack, "E-Piano.sfz"), sfz);
}

function buildDrums(root, pack) {
  fs.cpSync(path.join(root, "Samples"), path.join(pack, "samples", "drums"), { recursive: true });
  const sfz = fs.readFileSync(path.join(root, "SamsSonor.sfz"), "utf8");
  const patched = sfz.replace("default_path=Samples/", "default_path=samples/drums/");
  if (patched === sfz) throw new Error("SamsSonor.sfz changed upstream");
  fs.writeFileSync(path.join(pack, "Drums.sfz"), patched);
}

function credits(pack, files) {
  const dir = path.join(pack, "credits");
  fs.mkdirSync(dir, { recursive: true });
  for (const [from, to] of files) fs.copyFileSync(from, path.join(dir, to));
  fs.writeFileSync(
    path.join(dir, "README.txt"),
    `Oxbeat Essentials combines these libraries. Thank you to everyone who made them.

Grand Piano      Salamander Grand Piano V3 by Alexander Holm, CC BY 3.0
                 https://github.com/sfzinstruments/SalamanderGrandPiano (${REPOS.salamander.sha})
                 Reduced to 5 velocity layers, 44.1 kHz/16-bit, 10 s tails.
E-Piano          Wurlitzer EP200 by Greg Sullivan, converted by kinwie, CC BY 3.0
                 https://github.com/sfzinstruments/GregSullivan.E-Pianos (${REPOS.epianos.sha})
Upright Piano, Organ, Violins, Violas, Cellos, Double Bass, Harp, Flute, Oboe,
Clarinet, Trumpet, French Horn, Trombone, Timpani, Glockenspiel, Marimba
                 VS Chamber Orchestra Community Edition by Versilian Studios
                 (Sam Gossner, Simon Dalzell, Elan Hickler), CC0 1.0
                 https://github.com/sgossner/VSCO-2-CE (${REPOS.vsco.sha})
                 Sustains looped and shortened; mono except the upright piano.
Drums            Sam's Sonor Drums by Sam Greene, SFZ by sfzinstruments, CC BY-SA 4.0
                 https://github.com/sfzinstruments/SamsSonor
GeneralUser-GS.sf2
                 GeneralUser GS by S. Christian Collins, GeneralUser GS License v2.0
                 https://github.com/mrbumpy409/GeneralUser-GS

The licence files of each library are in this folder.
`,
  );
}

export default async function prepare({ sources, pack, run, work }) {
  const flac = flacBinary();
  run(flac, ["--version"]);
  const encode = (channels, rate, file) => {
    const tmp = path.join(work, "encode.wav");
    writeWav(tmp, rate, channels);
    run(flac, ["-8", "-s", "-f", "-o", file, tmp]);
    fs.rmSync(tmp);
  };

  const salamander = fetchRepo(REPOS.salamander, work, run);
  const epianos = fetchRepo(REPOS.epianos, work, run);
  const vsco = fetchRepo(REPOS.vsco, work, run);

  buildPiano(salamander, pack, work, run, flac, encode);
  buildEpiano(epianos, pack);
  for (const inst of VSCO) buildVsco(inst, vsco, pack, work, encode);
  buildDrums(sources.samssonor, pack);
  fs.copyFileSync(path.join(sources.generaluser, "GeneralUser-GS.sf2"), path.join(pack, "GeneralUser-GS.sf2"));

  credits(pack, [
    [path.join(salamander, "LICENSE"), "SalamanderGrandPiano-LICENSE.txt"],
    [path.join(salamander, "README.md"), "SalamanderGrandPiano-README.md"],
    [path.join(epianos, "LICENSE"), "GregSullivan.E-Pianos-LICENSE.txt"],
    [path.join(epianos, "README.md"), "GregSullivan.E-Pianos-README.md"],
    [path.join(vsco, "LICENSE"), "VSCO-2-CE-LICENSE.txt"],
    [path.join(vsco, "README.md"), "VSCO-2-CE-README.md"],
    [path.join(vsco, "Readme.txt"), "VSCO-2-CE-Readme.txt"],
    [path.join(sources.samssonor, "LICENSE"), "SamsSonor-LICENSE.txt"],
    [path.join(sources.samssonor, "README.md"), "SamsSonor-README.md"],
    [path.join(sources.generaluser, "documentation", "LICENSE.txt"), "GeneralUser-GS-LICENSE.txt"],
    [path.join(sources.generaluser, "README.md"), "GeneralUser-GS-README.md"],
  ]);

  // Size per budget line.
  const samples = (slug) => folderSize(path.join(pack, "samples", slug));
  const groupOf = (g) => VSCO.filter((i) => i.group === g).reduce((sum, i) => sum + samples(i.slug), 0);
  const sizes = {
    piano: samples("piano"),
    epiano: samples("e-piano"),
    keys: groupOf("keys"),
    strings: groupOf("strings"),
    orchestra: groupOf("orchestra"),
    percussion: groupOf("percussion"),
    drums: samples("drums"),
    gm: fs.statSync(path.join(pack, "GeneralUser-GS.sf2")).size,
  };
  const over = [];
  for (const [group, bytes] of Object.entries(sizes)) {
    console.log(`essentials: ${group.padEnd(10)} ${(bytes / MB).toFixed(1).padStart(6)} MB (budget ${BUDGETS[group]} MB)`);
    if (bytes > BUDGETS[group] * MB) over.push(group);
  }
  for (const inst of VSCO) console.log(`essentials:   ${inst.name.padEnd(13)} ${(samples(inst.slug) / MB).toFixed(1)} MB`);
  if (over.length) throw new Error(`over budget: ${over.join(", ")}`);
}
