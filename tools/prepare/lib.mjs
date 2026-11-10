// Helpers shared by the prepare scripts: fetching pinned git sources, reading
// and writing WAV, the small amount of DSP the packs need, and writing SFZ.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const MB = 1048576;

export const VSCO_REPO = {
  url: "https://github.com/sgossner/VSCO-2-CE",
  sha: "440300901dfe9275fd84e0b7763af1f8443ae62e",
};

export const VSCO_CREDIT = "Samples: VS Chamber Orchestra Community Edition by Versilian Studios (CC0 1.0).";

export function flacBinary() {
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

export function fetchRepo(spec, work, run) {
  const name = spec.url.split("/").pop();
  const dir = path.join(process.env.OXBEAT_GIT_CACHE || work, name);
  if (!fs.existsSync(path.join(dir, ".git"))) {
    run("git", ["clone", "--filter=blob:none", "--no-checkout", "--sparse", spec.url, dir]);
  }
  // Check out every file byte for byte: some upstreams mark `* text eol=crlf`,
  // which would turn LF bytes inside WAV samples into CRLF.
  fs.mkdirSync(path.join(dir, ".git", "info"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".git", "info", "attributes"), "* -text\n");
  try {
    run("git", ["-C", dir, "cat-file", "-e", `${spec.sha}^{commit}`], { stdio: "ignore" });
  } catch {
    run("git", ["-C", dir, "fetch", "--filter=blob:none", "origin", spec.sha]);
  }
  // Long pattern lists (one per sample) go through stdin to stay under the
  // Windows command-line limit.
  run("git", ["-C", dir, "sparse-checkout", "set", "--no-cone", "--stdin"], {
    input: spec.patterns.join("\n"), stdio: ["pipe", "inherit", "inherit"],
  });
  run("git", ["-C", dir, "-c", "core.autocrlf=false", "checkout", "--quiet", "--detach", spec.sha]);
  return dir;
}

// ---------------------------------------------------------------- WAV

export function readWav(file) {
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
export function writeWav(file, rate, channels) {
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
export function resampler(from, to, half = 16) {
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

export const peakOf = (channels) => {
  let p = 0;
  for (const ch of channels) for (const v of ch) p = Math.max(p, Math.abs(v));
  return p;
};

export function slice(channels, start, end) {
  return channels.map((ch) => ch.slice(start, end));
}

// Drop the silence before the attack, keeping a few ms in front of it.
export function trimLead(channels, rate, db = -40) {
  const limit = peakOf(channels) * 10 ** (db / 20);
  let first = channels[0].length;
  for (const ch of channels) {
    const i = ch.findIndex((v) => Math.abs(v) > limit);
    if (i >= 0) first = Math.min(first, i);
  }
  return slice(channels, Math.max(0, first - Math.round(0.01 * rate)));
}

// Cut at `seconds` (or where the sound has died away), then fade out.
export function tail(channels, rate, seconds, fade = 0.2, db = -72) {
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

export const mono = (channels) => {
  if (channels.length === 1) return channels;
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
  return [out];
};

// A crossfaded sustain loop: the last `fade` seconds before the loop end blend
// into the audio just before the loop start, so the jump back is seamless.
export function sustainLoop(channels, rate, { loopFrom = 1.0, loopTo = 4.0, fade = 0.1 } = {}) {
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

export const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// `octave` is the MIDI note of C0 divided by 12: 1 when C4 = 60, 2 when C3 = 60.
export function noteNumber(name, octave) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note name ${name}`);
  return (Number(m[3]) + octave) * 12 + SEMI[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
}

// Key ranges halfway between neighbouring roots; the outer ones reach an octave further.
export function keyRanges(roots) {
  const sorted = [...new Set(roots)].sort((a, b) => a - b);
  const ranges = new Map();
  sorted.forEach((root, i) => {
    const lo = i === 0 ? Math.max(0, root - 12) : Math.floor((sorted[i - 1] + root) / 2) + 1;
    const hi = i === sorted.length - 1 ? Math.min(127, root + 12) : Math.floor((root + sorted[i + 1]) / 2);
    ranges.set(root, [lo, hi]);
  });
  return ranges;
}

export function velRanges(count) {
  return Array.from({ length: count }, (_, j) => [j === 0 ? 1 : Math.floor((j * 127) / count) + 1, Math.floor(((j + 1) * 127) / count)]);
}

export function writeSfz(file, { title, credit, slug, global, regions, generator = "essentials.mjs" }) {
  const lines = [
    `// ${title}`,
    `// ${credit}`,
    `// Generated by tools/prepare/${generator} (github.com/matthias-peterlini/Oxbeat-beats).`,
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

export function folderSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? folderSize(p) : fs.statSync(p).size;
  }
  return total;
}

// File-name parsers return { root, layer, rr } or null. Layers sort soft to loud.
export const note = (re, octave, extra = () => ({})) => (file) => {
  const m = re.exec(file);
  return m ? { root: noteNumber(m[1], octave), layer: m[2] ? Number(m[2]) : 0, rr: 1, ...extra(m) } : null;
};

export const SUSTAIN = { mode: "loop", stereo: false, release: 0.3, veltrack: 60 };

// `options` name the pack in the SFZ title and log, and the script in its header.
export function buildVsco(inst, root, pack, work, encode, { packName = "Oxbeat Essentials", log = "essentials", generator } = {}) {
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
        // Takes are numbered upstream, sometimes with gaps; positions count from 1.
        const rrs = forRoot.filter((o) => o.layer === t.layer).map((o) => o.rr).sort((a, b) => a - b);
        if (rrs.length > 1) Object.assign(region, { seq_length: rrs.length, seq_position: rrs.indexOf(t.rr) + 1 });
      }
      regions.push(region);
    }
  }
  const global = { amp_veltrack: inst.veltrack };
  if (inst.mode !== "oneshot") global.ampeg_release = inst.release;
  if (inst.mode === "loop") global.ampeg_attack = 0.005;
  writeSfz(path.join(pack, `${inst.name}.sfz`), {
    title: `${inst.name} - ${packName}`, credit: VSCO_CREDIT, slug: inst.slug, global, regions, generator,
  });
  console.log(`${log}: ${inst.name}: ${regions.length} regions`);
}


// Writes 16-bit FLAC (flac -8) through a scratch WAV in `work`.
export function flacEncoder(flac, run, work) {
  return (channels, rate, file) => {
    const tmp = path.join(work, "encode.wav");
    writeWav(tmp, rate, channels);
    run(flac, ["-8", "-s", "-f", "-o", file, tmp]);
    fs.rmSync(tmp);
  };
}

export function copyCredits(pack, files, readme) {
  const dir = path.join(pack, "credits");
  fs.mkdirSync(dir, { recursive: true });
  for (const [from, to] of files) fs.copyFileSync(from, path.join(dir, to));
  if (readme) fs.writeFileSync(path.join(dir, "README.txt"), readme);
}
