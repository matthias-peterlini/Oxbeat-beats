// DRS Kit (CC BY 4.0): DrumGizmo's DRSKit, from the SFZ mapping in
// sfzinstruments/DrumGizmo.DRSKit. Upstream plays up to 13 mono mic channels
// per hit and mixes them with controllers; Oxbeat's player has no mixer, so
// each hit's own mics are mixed here to one stereo FLAC with a fixed mix
// (close mics panned around the kit, overheads and room hard left and right).
// Whisker and bleed-only regions, keyswitches and controller articulations
// are left out (see sfz.mjs).

import fs from "node:fs";
import path from "node:path";
import { CREDIT_PATTERNS, MB, copyCredits, upstreamCredits, fetchRepo, flacBinary, flacEncoder, folderSize, readWav } from "./lib.mjs";
import { readSfz, silencedBy } from "./sfz.mjs";

export const REPO = {
  url: "https://github.com/sfzinstruments/DrumGizmo.DRSKit",
  sha: "b01448990a31f722542f1812e56159a97a6a2a82",
};
const KIT = "DrumGizmo/DRSKit";
const PROGRAM = `${KIT}/Stereo/DrumGizmo DRSKit (N).sfz`;
const BASE = [`/${KIT}/Data/`, `/${KIT}/Stereo/`, ...CREDIT_PATTERNS];

// Mic -> [gain, pan 0 (left) .. 1 (right)], after upstream's default stereo mix.
const MIX = {
  OHL: [1, 0], OHR: [1, 1], AmbL: [0.6, 0], AmbR: [0.6, 1],
  Kdrum_back: [1, 0.5], Kdrum_front: [1, 0.5], Snare_top: [1, 0.5], Snare_bottom: [0.5, 0.5],
  Tom1: [1, 0.4], Tom2: [1, 0.6], Tom3: [1, 0.8], Hihat: [0.3, 0.3], Ride: [0.3, 0.7],
};

// Chokes: a closed or foot hi-hat stops an open one, a hit stops the snare
// and ride rests (upstream does this with pedal controllers).
function choke(label) {
  if (/^Hihat_(closed|foot)/.test(label)) return { group: 1 };
  if (/^Hihat_/.test(label)) return { group: 2, off_by: 1 };
  if (label === "Snare" || label === "Snare_rim") return { group: 3 };
  if (label === "Snare_rest") return { group: 4, off_by: 3 };
  if (label === "Ride_rest") return { group: 6 };
  if (/^Ride_/.test(label)) return { group: 5, off_by: 6 };
  return {};
}

const escape = (p) => p.replace(/([\\*?[\]!# ])/g, "\\$1");

export default function prepare({ pack, work, run }) {
  const flac = flacBinary();
  run(flac, ["--version"]);
  const encode = flacEncoder(flac, run, work);
  const dir = fetchRepo({ ...REPO, patterns: BASE }, work, run);

  // Group the playable mic regions into hits: one key, velocity range and
  // round robin, recorded by several mics.
  const file = path.join(dir, PROGRAM);
  const { control, regions } = readSfz(file);
  const hits = new Map();
  const dropped = {};
  for (const r of regions) {
    const why = silencedBy(r, control);
    if (why) {
      const reason = why.replace(/=.*/, "");
      dropped[reason] = (dropped[reason] ?? 0) + 1;
      continue;
    }
    const [, take, mic] = /^(.*)-([^-/]+)\.flac$/.exec(r.sample);
    if (!MIX[mic]) throw new Error(`unknown mic ${mic} in ${r.sample}`);
    const id = [r.key, r.lovel ?? 1, r.hivel ?? 127, r.seq_length ?? 1, r.seq_position ?? 1, take].join("|");
    if (!hits.has(id)) hits.set(id, { r, take, mics: new Map() });
    hits.get(id).mics.set(mic, `${KIT}/Samples/${r.sample}`);
  }
  console.log(`drs: ${hits.size} hits, dropped ${JSON.stringify(dropped)}`);
  const samples = [...hits.values()].flatMap((h) => [...h.mics.values()]);
  fetchRepo({ ...REPO, patterns: [...BASE, ...new Set(samples.map((s) => `/${escape(s)}`))] }, work, run);

  // Mix every hit, then scale the whole kit by one gain so its loudest hit
  // peaks at -1 dBFS and the dynamics between hits are kept.
  const decoded = path.join(work, "mic.wav");
  const mixes = new Map();
  let rate;
  let loudest = 0;
  for (const [id, h] of hits) {
    let l;
    let rr;
    for (const [mic, rel] of h.mics) {
      run(flac, ["-d", "-s", "-f", "-o", decoded, path.join(dir, rel)]);
      const wav = readWav(decoded);
      if (rate && wav.rate !== rate) throw new Error(`${rel}: ${wav.rate} Hz, expected ${rate}`);
      rate = wav.rate;
      const x = wav.channels[0];
      if (!l) { l = new Float32Array(x.length); rr = new Float32Array(x.length); }
      if (x.length > l.length) {
        const grow = (a) => { const b = new Float32Array(x.length); b.set(a); return b; };
        l = grow(l); rr = grow(rr);
      }
      const [gain, pan] = MIX[mic];
      const gl = gain * Math.cos((pan * Math.PI) / 2);
      const gr = gain * Math.sin((pan * Math.PI) / 2);
      for (let i = 0; i < x.length; i++) { l[i] += x[i] * gl; rr[i] += x[i] * gr; }
    }
    for (const ch of [l, rr]) for (const v of ch) loudest = Math.max(loudest, Math.abs(v));
    mixes.set(id, [l, rr]);
  }
  const scale = 10 ** (-1 / 20) / loudest;

  const lines = [
    "// DRS Kit",
    `// From ${REPO.url} (${REPO.sha}), ${PROGRAM}, CC BY 4.0.`,
    "// DRSKit by Lars Muldjord, Bent Bisballe Nyeng and Jes Eiler; SFZ mapping by kinwie.",
    "// Each hit's mics are mixed to stereo by tools/prepare/drumgizmo-drs.mjs. Samples are 16-bit FLAC.",
    "",
    "<control>",
    "default_path=samples/",
    "",
    "<global> loop_mode=one_shot amp_veltrack=100",
    "",
  ];
  const names = new Set();
  for (const [id, h] of hits) {
    const [l, rr] = mixes.get(id);
    for (const ch of [l, rr]) for (let i = 0; i < ch.length; i++) ch[i] *= scale;
    let name = `${h.take}.flac`;
    for (let n = 2; names.has(name); n++) name = `${h.take}-${n}.flac`;
    names.add(name);
    const out = path.join(pack, "samples", name);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    encode([l, rr], rate, out);
    mixes.delete(id);
    const { r } = h;
    const ops = { key: r.key, lovel: r.lovel ?? 1, hivel: r.hivel ?? 127 };
    if (Number(r.seq_length ?? 1) > 1) Object.assign(ops, { seq_length: r.seq_length, seq_position: r.seq_position ?? 1 });
    Object.assign(ops, choke(r.group_label ?? ""));
    lines.push(`<region> ${Object.entries(ops).map(([k, v]) => `${k}=${v}`).join(" ")} sample=${name}`);
  }
  fs.writeFileSync(path.join(pack, "DRS Kit.sfz"), `${lines.join("\n")}\n`);
  console.log(`drs: ${names.size} stereo samples at ${rate} Hz, ${(folderSize(pack) / MB).toFixed(1)} MB`);

  copyCredits(pack, upstreamCredits(dir, "DrumGizmo.DRSKit"), `DRS Kit is made from DrumGizmo's DRSKit (CC BY 4.0):
- ${REPO.url} (${REPO.sha})

Samples: DRSKit by Lars Muldjord, Bent Bisballe Nyeng and Jes Eiler (DRSDrums),
recorded for DrumGizmo. SFZ mapping by kinwie. Licensed under CC BY 4.0
(https://creativecommons.org/licenses/by/4.0/).

Changes: each hit's mic channels were mixed to one stereo file with a fixed mix,
whisker (brush) articulations, mic bleed and controller-driven articulations
were left out, and samples were re-encoded as 16-bit FLAC.
`);
}
