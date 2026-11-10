// Reads an upstream SFZ program (with #define, #include and the header
// hierarchy) into flat regions, and keeps what Oxbeat's player can play:
// regions a keyswitch, CC range or crossfade would silence at the default
// controller values are dropped, as are release triggers.

import fs from "node:fs";
import path from "node:path";

// Opcodes Oxbeat's SFZ player reads (Rec src/sounds/sfz.rs).
export const PLAYABLE = new Set([
  "key", "lokey", "hikey", "pitch_keycenter", "end", "loop_mode", "trigger", "lovel", "hivel",
  "pitch_keytrack", "tune", "transpose", "volume", "amplitude", "pan", "amp_veltrack",
  "loop_start", "loop_end", "offset", "ampeg_attack", "ampeg_decay", "ampeg_sustain", "ampeg_release",
  "group", "off_by", "lorand", "hirand", "seq_length", "seq_position",
]);
const ALIASES = { loopmode: "loop_mode", loopstart: "loop_start", loopend: "loop_end", offby: "off_by", pitch: "tune", gain: "volume" };

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
}

// `sample=` values may contain spaces: a value runs until the next `name=`.
function opcodes(chunk) {
  const out = [];
  const re = /([A-Za-z0-9_$]+)=/g;
  const hits = [...chunk.matchAll(re)];
  hits.forEach((m, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].index : chunk.length;
    out.push([m[1], chunk.slice(m.index + m[0].length, end).trim()]);
  });
  return out;
}

function expand(file, root, defines, depth = 0) {
  if (depth > 10) throw new Error(`${file}: #include nested too deeply`);
  const lines = stripComments(fs.readFileSync(file, "utf8")).split(/\r?\n/);
  const out = [];
  const sub = (s) => {
    for (const [k, v] of [...defines].sort((a, b) => b[0].length - a[0].length)) s = s.split(k).join(v);
    return s;
  };
  for (const line of lines) {
    const t = line.trim();
    // Several #defines may share a line (DRSKit's macro files).
    if (t.startsWith("#define")) {
      for (const piece of t.split(/(?=#define\s)/)) {
        const def = /^#define\s+(\$\S+)\s+(.*)$/.exec(piece.trim());
        if (def) defines.set(def[1], def[2].trim());
      }
      continue;
    }
    // A line may hold several #include directives (DRSKit's programs do).
    const parts = line.split(/#include\s+"([^"]+)"/);
    if (parts.length > 1) {
      parts.forEach((p, i) => {
        if (i % 2) out.push(expand(path.join(root, sub(p).replace(/\\/g, "/")), root, defines, depth + 1));
        else if (p.trim()) out.push(sub(p));
      });
      continue;
    }
    out.push(sub(line));
  }
  return out.join("\n");
}

// Every region with its inherited opcodes, plus the <control> section.
export function readSfz(file, { defines = {} } = {}) {
  const root = path.dirname(file);
  const text = expand(file, root, new Map(Object.entries(defines)));
  const scope = { control: {}, global: {}, master: {}, group: {}, region: null };
  const regions = [];
  const finish = () => {
    if (scope.region) regions.push({ ...scope.global, ...scope.master, ...scope.group, ...scope.region });
    scope.region = null;
  };
  let target = null;
  for (const part of text.split(/(<[a-z_]+>)/)) {
    const header = /^<([a-z_]+)>$/.exec(part);
    if (header) {
      finish();
      const h = header[1];
      if (h === "control") target = scope.control;
      else if (h === "global") { scope.global = {}; scope.master = {}; scope.group = {}; target = scope.global; }
      else if (h === "master") { scope.master = {}; scope.group = {}; target = scope.master; }
      else if (h === "group") { scope.group = {}; target = scope.group; }
      else if (h === "region") target = scope.region = {};
      else target = null; // <curve>, <effect>, <midi>
      continue;
    }
    if (target) for (const [k, v] of opcodes(part)) target[k] = v;
  }
  finish();
  return { root, control: scope.control, regions };
}

// Default controller values: set_ccN in <control>, else 0 (cc7 100, cc10 64, cc11 127).
function ccDefaults(control) {
  const cc = { 7: 100, 10: 64, 11: 127 };
  for (const [k, v] of Object.entries(control)) {
    const m = /^set_(?:hd)?cc(\d+)$/.exec(k);
    if (m) cc[m[1]] = k.includes("hd") ? Number(v) * 127 : Number(v);
  }
  return cc;
}

// Why a region can't play at default controller values, or null if it can.
export function silencedBy(r, control) {
  const cc = ccDefaults(control);
  if (r.trigger && !["attack", "first", "legato"].includes(r.trigger)) return `trigger=${r.trigger}`;
  if (r.sample?.startsWith("*")) return "generator";
  if (r.sw_last !== undefined || r.sw_lokey !== undefined) {
    const def = r.sw_default ?? control.sw_default;
    if (r.sw_last !== undefined && (def === undefined || Number(r.sw_last) !== Number(def))) return "keyswitch";
  }
  if (r.sw_down !== undefined || r.sw_up !== undefined || r.sw_previous !== undefined) return "keyswitch";
  for (const [k, v] of Object.entries(r)) {
    let m = /^(lo|hi)cc(\d+)$/.exec(k);
    if (m) {
      const val = cc[m[2]] ?? 0;
      if (m[1] === "lo" ? val < Number(v) : val > Number(v)) return `${k}=${v}`;
    }
    m = /^xfin_locc(\d+)$/.exec(k);
    if (m && (cc[m[1]] ?? 0) <= Number(v) && Number(r[`xfin_hicc${m[1]}`] ?? 0) > Number(v)) return `${k}=${v}`;
    m = /^xfout_hicc(\d+)$/.exec(k);
    if (m && (cc[m[1]] ?? 0) >= Number(v) && Number(r[`xfout_locc${m[1]}`] ?? 127) < Number(v)) return `${k}=${v}`;
  }
  return null;
}

// Regions Oxbeat can play, with their samples resolved to absolute paths and
// a tally of what was dropped. `keep` filters further (e.g. one articulation).
// `defines` seeds #define values a player would supply (e.g. ARIA bank
// variables); `defaultPath` is used when the program sets no default_path.
export function playableRegions(file, { keep = () => true, defines, defaultPath = "" } = {}) {
  const { root, control, regions } = readSfz(file, { defines });
  const dropped = {};
  const unused = new Set();
  const out = [];
  for (const r of regions) {
    const why = silencedBy(r, control) ?? (keep(r) ? null : "not kept");
    if (why) {
      const reason = why.replace(/=.*/, "");
      dropped[reason] = (dropped[reason] ?? 0) + 1;
      continue;
    }
    const sample = path.join(root, `${control.default_path ?? defaultPath}${r.sample}`.replace(/\\/g, "/"));
    const o = {};
    // Envelope stages set by a controller (ampeg_sustain_oncc103=100 with
    // set_cc103=127) are folded in at their default controller value.
    const cc = ccDefaults(control);
    const env = {};
    for (const [k, v] of Object.entries(r)) {
      const m = /^ampeg_(attack|decay|sustain|release)_on?cc(\d+)$/.exec(k);
      if (m) env[m[1]] = (env[m[1]] ?? 0) + Number(v) * (cc[m[2]] ?? 0) / 127;
    }
    for (const [stage, add] of Object.entries(env)) {
      const base = Number(r[`ampeg_${stage}`] ?? (stage === "sustain" ? 100 : 0));
      const value = stage === "sustain" ? Math.min(100, base + add) : base + add;
      r[`ampeg_${stage}`] = String(Number(value.toFixed(4)));
    }
    for (const [k, v] of Object.entries(r)) {
      const name = ALIASES[k] ?? k;
      if (PLAYABLE.has(name)) o[name] = v;
      else if (k !== "sample") unused.add(k.replace(/\d+/g, "N"));
    }
    // note_offset/octave_offset in <control> shift every key.
    const shift = Number(control.note_offset ?? 0) + 12 * Number(control.octave_offset ?? 0);
    if (shift) for (const k of ["key", "lokey", "hikey", "pitch_keycenter"]) if (o[k] !== undefined) o[k] = String(noteValue(o[k]) + shift);
    out.push({ sample, opcodes: o });
  }
  return { regions: out, dropped, unused: [...unused].sort() };
}

export function noteValue(s) {
  if (/^-?\d+$/.test(s)) return Number(s);
  const m = /^([a-g])(#|b)?(-?\d+)$/i.exec(s);
  if (!m) throw new Error(`bad note ${s}`);
  const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()];
  return (Number(m[3]) + 1) * 12 + base + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
}

// Write a flat SFZ whose samples live under `samples/`, named by `rename`.
export function writeFlatSfz(file, { header, regions, rename }) {
  const lines = header.map((l) => `// ${l}`);
  lines.push("", "<control>", "default_path=samples/", "");
  for (const r of regions) {
    const ops = Object.entries(r.opcodes).map(([k, v]) => `${k}=${v}`);
    lines.push(`<region> ${ops.join(" ")} sample=${rename(r.sample)}`);
  }
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
}
