// The four "VSCO 2 CE" packs: strings, winds, brass and percussion from VS
// Chamber Orchestra Community Edition, with every articulation upstream.
//
// The library has no SFZ at the pinned commit, so one is written per
// articulation, as for Oxbeat Essentials: mono 16-bit FLAC, sustains looped
// and shortened, short notes trimmed, round robins kept. The orchestral
// percussion that has no pitch becomes one drum kit.
//
// tools/prepare/vsco-<family>.mjs are the recipes' scripts; each one calls
// buildFamily here. Needs git and flac, like essentials.mjs.

import fs from "node:fs";
import path from "node:path";
import {
  CREDIT_PATTERNS, MB, upstreamCredits, VSCO_CREDIT, VSCO_REPO, buildVsco, copyCredits, fetchRepo, flacBinary, flacEncoder, folderSize, mono,
  noteNumber, readWav, SUSTAIN, tail, trimLead, velRanges, writeSfz,
} from "./lib.mjs";

const DYN = ["ppp", "pp", "p", "mp", "mf", "f", "ff", "fff"];

// One parser for VSCO's names: <prefix>_<note>[_v<layer>|_<dynamic>][_<take>][_<mic>].wav
function vsco(prefix, { octave = 2, oneLayer = false, tune } = {}) {
  const re = new RegExp(
    `^${prefix}_(?<n>[A-G]#?-?\\d)(?:_v(?<v>\\d+)|_(?<d>${[...DYN].reverse().join("|")}|loud))?`
    + "(?:_(?:rr|RR|r|sustain|staccato)?(?<rr>\\d+))?(?:_(?:sum|Sum|Mid|Main|far))?\\.wav$",
  );
  return (file) => {
    const g = re.exec(file)?.groups;
    if (!g) return null;
    const layer = oneLayer ? 0 : g.v ? Number(g.v) : g.d ? DYN.indexOf(g.d === "loud" ? "f" : g.d) : 0;
    return { root: noteNumber(g.n, octave), layer, rr: Number(g.rr ?? 1), ...(tune ? { tune } : {}) };
  };
}

// Timpani: each drum is tuned to one pitch, as [nearest key, cents] (see essentials.mjs).
const TIMPANI = { 1: [41, -45], 2: [47, 25], 3: [50, 50], 4: [52, -40], 5: [55, 40] };
const timpani = (kind) => (file) => {
  const m = new RegExp(`^Timpani(\\d)_${kind}_v(\\d)_rr(\\d)_Sum\\.wav$`).exec(file);
  return m ? { root: TIMPANI[m[1]][0], tune: TIMPANI[m[1]][1], layer: Number(m[2]), rr: Number(m[3]) } : null;
};

const PIZZ = { mode: "decay", stereo: false, seconds: 2.5, release: 0.3, veltrack: 70, roundRobin: true };
const SHORT = { mode: "oneshot", stereo: false, seconds: 1.5, veltrack: 70, roundRobin: true };
const MALLET = (seconds) => ({ mode: "oneshot", stereo: false, seconds, veltrack: 90, roundRobin: true });

const inst = (name, dir, style, parse) => ({ name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), dir, ...style, parse });

export const FAMILIES = {
  strings: {
    pack: "VSCO 2 Strings",
    instruments: [
      inst("Violins Sustain", "Strings/Violin Section/susVib", SUSTAIN, vsco("VlnEns_susVib")),
      inst("Violins Tremolo", "Strings/Violin Section/Trem", SUSTAIN, vsco("VlnEns_Trem")),
      inst("Violins Pizzicato", "Strings/Violin Section/Pizz", PIZZ, vsco("VlnEns_Pizz")),
      inst("Violins Spiccato", "Strings/Violin Section/Spic", SHORT, vsco("VlnEns_Spic")),
      inst("Violas Sustain", "Strings/Viola Section/susvib", SUSTAIN, vsco("ViolaEns_susvib")),
      inst("Violas Tremolo", "Strings/Viola Section/trem", SUSTAIN, vsco("Violas_trem")),
      inst("Violas Pizzicato", "Strings/Viola Section/pizz", PIZZ, vsco("ViolaEns_pizz")),
      inst("Violas Spiccato", "Strings/Viola Section/spic", SHORT, vsco("Violas_spic")),
      inst("Cellos Sustain", "Strings/Cello Section/susvib", SUSTAIN, vsco("susvib")),
      inst("Cellos Tremolo", "Strings/Cello Section/trem", SUSTAIN, vsco("trem")),
      inst("Cellos Pizzicato", "Strings/Cello Section/pizzT", PIZZ, vsco("pizzT")),
      inst("Cellos Spiccato", "Strings/Cello Section/spic", SHORT, vsco("spic")),
      inst("Double Bass Sustain", "Strings/Solo Contrabass/SusNV", SUSTAIN, vsco("BKCtbss_SusNV")),
      inst("Double Bass Vibrato", "Strings/Solo Contrabass/SusVib", SUSTAIN, vsco("BKCtbss_SusVib")),
      inst("Double Bass Tremolo", "Strings/Solo Contrabass/Trem", SUSTAIN, vsco("BKCtbss_Trem")),
      inst("Double Bass Pizzicato", "Strings/Solo Contrabass/Pizz", PIZZ, vsco("BKCtbss_Pizz")),
      inst("Double Bass Spiccato", "Strings/Solo Contrabass/Spic", SHORT, vsco("BKCtbss_Spic")),
      inst("Solo Violin Sustain", "Strings/Solo Violin/Arco Vib", SUSTAIN, vsco("LLVln_ArcoVib")),
      inst("Solo Violin Tremolo", "Strings/Solo Violin/Trem", SUSTAIN, vsco("LLVln_trem")),
      inst("Solo Violin Pizzicato", "Strings/Solo Violin/Pizz", PIZZ, vsco("LLVln_Pizz")),
      inst("Solo Violin Spiccato", "Strings/Solo Violin/spic", SHORT, vsco("LLVln_spic")),
      inst("Harp", "Strings/Harp", { mode: "decay", stereo: false, seconds: 5, release: 0.8, veltrack: 80 },
        vsco("KSHarp", { octave: 1, oneLayer: true })),
    ],
  },
  winds: {
    pack: "VSCO 2 Winds",
    instruments: [
      inst("Flute Sustain", "Woodwinds/Flute/susNV", SUSTAIN, vsco("LDFlute_susNV")),
      inst("Flute Vibrato", "Woodwinds/Flute/susvib", SUSTAIN, vsco("LDFlute_susvib")),
      inst("Flute Expressive", "Woodwinds/Flute/expvib", SUSTAIN, vsco("LDFlute_expvib")),
      inst("Flute Staccato", "Woodwinds/Flute/stac", SHORT, vsco("LDFlute_stac")),
      inst("Piccolo Sustain", "Woodwinds/Piccolo/Sus", SUSTAIN, vsco("piccolo")),
      inst("Piccolo Staccato", "Woodwinds/Piccolo/Stac", SHORT, vsco("piccolo")),
      inst("Oboe Sustain", "Woodwinds/Oboe/Sus", SUSTAIN, vsco("Oboe_Sus")),
      inst("Oboe Vibrato", "Woodwinds/Oboe/Vib", SUSTAIN, vsco("Oboe_Vib")),
      inst("Oboe Staccato", "Woodwinds/Oboe/Stacc", SHORT, vsco("Oboe_Stacc")),
      inst("Clarinet Sustain", "Woodwinds/Clarinet/susLong", SUSTAIN, vsco("DCClar_susLong")),
      inst("Clarinet Staccato", "Woodwinds/Clarinet/stac", SHORT, vsco("DCClar_stac")),
      inst("Bassoon Sustain", "Woodwinds/Bassoon/sus", SUSTAIN, vsco("PSBassoon")),
      inst("Bassoon Vibrato", "Woodwinds/Bassoon/vib", SUSTAIN, vsco("PSBassoon")),
      inst("Bassoon Staccato", "Woodwinds/Bassoon/stac", SHORT, vsco("PSBassoon")),
    ],
  },
  brass: {
    pack: "VSCO 2 Brass",
    instruments: [
      inst("Trumpet Sustain", "Brass/Trumpet/sus", SUSTAIN, vsco("Sum_SHTrumpet_sus")),
      inst("Trumpet Vibrato", "Brass/Trumpet/susvib", SUSTAIN, vsco("Sum_SHTrumpet_susvib")),
      inst("Trumpet Staccato", "Brass/Trumpet/stac", SHORT, vsco("Sum_SHTrumpet_stac")),
      inst("Trumpet Straight Mute", "Brass/Trumpet/straightM-sus", SUSTAIN, vsco("Sum_SHTrumpet_straightM-sus")),
      inst("Trumpet Harmon Mute", "Brass/Trumpet/harmonM-sus", SUSTAIN, vsco("Sum_SHTrumpet_harmonM-sus")),
      inst("French Horn Sustain", "Brass/F Horn/sus", SUSTAIN, vsco("MOHorn_sus")),
      inst("French Horn Muted", "Brass/F Horn/mute", SUSTAIN, vsco("MOHorn_mute")),
      inst("French Horn Staccato", "Brass/F Horn/stac", SHORT, vsco("MOHorn_stac")),
      inst("Trombone Sustain", "Brass/Tenor Trombone/sus", SUSTAIN, vsco("tenortbn_sus")),
      inst("Trombone Vibrato", "Brass/Tenor Trombone/vib", SUSTAIN, vsco("tenortbn_vib")),
      inst("Trombone Staccato", "Brass/Tenor Trombone/stac", SHORT, vsco("tenortbn_stac")),
      inst("Tuba Sustain", "Brass/Tuba/sus", SUSTAIN, vsco("Tuba\\d_sus")),
      inst("Tuba Staccato", "Brass/Tuba/stac", SHORT, vsco("Tuba\\d_stac")),
      inst("Old Trombone Sustain", "Brass/OldTrombone/Sustain", SUSTAIN, vsco("Trombone_Sustain")),
      inst("Old Trombone Vibrato", "Brass/OldTrombone/Vibrato", SUSTAIN, vsco("Trombone_Vibrato")),
      inst("Old Trombone Buzz", "Brass/OldTrombone/Buzz", SUSTAIN, vsco("Trombone_Buzz")),
      inst("Old Trombone Short", "Brass/OldTrombone/Short", { ...SHORT, roundRobin: false }, vsco("Trombone_Short")),
      inst("Old Trombone Fall", "Brass/OldTrombone/Fall", { mode: "decay", stereo: false, seconds: 3, release: 0.3, veltrack: 60 },
        vsco("Trombone_Fall")),
    ],
  },
  percussion: {
    pack: "VSCO 2 Percussion",
    instruments: [
      inst("Glockenspiel", "Percussion/Glock", MALLET(3), vsco("glock_medium")),
      inst("Marimba", "Percussion/Marimba", MALLET(2.5), vsco("Marimba_hit_Outrigger")),
      inst("Xylophone", "Percussion/Xylo", MALLET(2), vsco("Xylo_Medium")),
      inst("Tubular Bells", "Percussion", { mode: "decay", stereo: false, seconds: 6, release: 1, veltrack: 80 },
        vsco("TB_hit", { octave: 1 })),
      inst("Timpani", "Percussion/Timpani", { mode: "oneshot", stereo: false, seconds: 3, veltrack: 60, roundRobin: true }, timpani("Hit")),
      inst("Timpani Rolls", "Percussion/Timpani/Rolls", SUSTAIN, timpani("Roll")),
    ],
    kit: "Orchestral Percussion",
  },
};

// The unpitched percussion in the Percussion folder, one sound per key. A
// capture group in the pattern numbers the takes of one sound.
export const KIT = [
  [35, "Bass Drum Rub", /^bassdrum_rub(\d)$/],
  [36, "Bass Drum", /^BDrumNewhit$/],
  [37, "Snare Taps", /^Snare2-taps$/],
  [38, "Snare", /^Snare2-HitSN$/],
  [39, "Claves", /^Claves1_Hit$/],
  [40, "Snare (snares off)", /^Snare2-HitNS$/],
  [41, "Snare Roll", /^Snare2-rollSN$/],
  [42, "Triangle Muted", /^Triangle3-HitM$/],
  [43, "Snare Roll (snares off)", /^Snare2-rollNS$/],
  [44, "Triangle Half Muted", /^Triangle3-HitFM$/],
  [45, "Triangle Roll", /^Triangle3-Roll$/],
  [46, "Triangle", /^Triangle3-Hit$/],
  [47, "Large Triangle Muted", /^Triangle6-HitM$/],
  [48, "Large Triangle", /^Triangle6-Hit$/],
  [49, "Crash Cymbals", /^cymbal-crash1$/],
  [50, "Large Triangle Half Muted", /^Triangle6-HitFM$/],
  [51, "Suspended Cymbal", /^susCymb1-hit$/],
  [52, "Suspended Cymbal Swell", /^susCymb1-cresc-Short$/],
  [53, "Suspended Cymbal Bell", /^susCymb1-hit-bell$/],
  [54, "Tambourine", /^Tamb1-Hit$/],
  [55, "Suspended Cymbal Stick", /^susCymb1-hitstick$/],
  [56, "Cowbell", /^Cowbell1_Hit$/],
  [57, "Crash Cymbals Choked", /^cymbal-crashshort$/],
  [58, "Tambourine Shake", /^Tamb1-Shake$/],
  [59, "Tambourine Roll", /^Tamb1-Roll$/],
  [60, "Quinto", /^Quinto-HitN$/],
  [61, "Quinto Tap", /^Quinto-Tap1$/],
  [62, "Conga Tap", /^Conga-Tap1$/],
  [63, "Conga", /^Conga-HitN$/],
  [64, "Tumba", /^Tumba-HitN$/],
  [65, "Tumba Tap", /^Tumba-Tap1$/],
  [66, "Gong", /^gongHit$/],
  [67, "Brake Drum", /^BrakeDrum1_Hammer$/],
  [68, "Anvil", /^Anvil_Hit1$/],
  [69, "Guiro Hit", /^Guiro-Hit$/],
  [70, "Guiro Fast", /^Guiro-Fast$/],
  [71, "Guiro", /^Guiro-M$/],
  [72, "Guiro Slow", /^Guiro-Slow$/],
  [73, "Ratchet Crank", /^Ratchet1-Crank$/],
  [74, "Ratchet Fast", /^Ratchet1-Fast$/],
  [75, "Ratchet Slow", /^Ratchet1-Slow$/],
  [76, "Log Drum High", /^LogDrumHi_MedM$/],
  [77, "Log Drum Low", /^LogDrumLo_MedM$/],
  [78, "Field Drum", /^timp-?snare$/],
  [79, "Tenor Drum", /^timpsnaretenor$/],
  [80, "Sleigh Bells", /^Sleighbells_Hit$/],
  [81, "Bell Tree", /^BellTree_Stroke(\d)$/],
  [82, "Suspended Cymbal Long Swell", /^susCymb1-cresc-Median$/],
  [83, "Suspended Cymbal Longest Swell", /^susCymb1-cresc-Long$/],
  [84, "Bowed Cymbal", /^susCymb1-bow-(\d)$/],
  [85, "Cymbal Scrape", /^susCymb1-scrape(\d)$/],
  [86, "Gong Scrape", /^gongscrape$/],
  [87, "Vibraphone Ring", /^vibraring$/],
  [88, "Alien 1", /^alien1$/],
  [89, "Alien 2", /^alien2$/],
  [90, "Alien 3", /^alien3$/],
  [91, "Zap", /^zap(\d)$/],
  [92, "Large Triangle Roll", /^Triangle6-Roll$/],
];

const KIT_FILE = /^(?<stem>.+?)(?:_v(?<v>\d+)|_(?<d>ppp|pp|p|mp|mf|f|ff|fff))?(?:_rr(?<rr>\d+))?(?:_(?:Sum|Mid))?\.wav$/;

export function parseKit(file) {
  const g = KIT_FILE.exec(file)?.groups;
  if (!g) return null;
  for (const [key, name, re] of KIT) {
    const m = re.exec(g.stem);
    if (m) return { key, name, layer: g.v ? Number(g.v) : g.d ? DYN.indexOf(g.d) : 0, rr: Number(m[1] ?? g.rr ?? 1) };
  }
  return null;
}

function buildKit(name, root, pack, encode) {
  const dir = path.join(root, "Percussion");
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const out = path.join(pack, "samples", slug);
  fs.mkdirSync(out, { recursive: true });
  const hits = fs.readdirSync(dir).filter((f) => f.endsWith(".wav")).sort()
    .map((file) => ({ file, ...parseKit(file) })).filter((h) => h.key);
  const regions = [];
  for (const [key] of KIT) {
    const forKey = hits.filter((h) => h.key === key);
    if (!forKey.length) throw new Error(`${name}: nothing for key ${key}`);
    const layers = [...new Set(forKey.map((h) => h.layer))].sort((a, b) => a - b);
    const vels = velRanges(layers.length);
    for (const h of forKey.sort((a, b) => a.layer - b.layer || a.rr - b.rr)) {
      const wav = readWav(path.join(dir, h.file));
      const ch = tail(trimLead(mono(wav.channels), wav.rate), wav.rate, 8, 0.3);
      const sample = `${key}_v${h.layer}_rr${h.rr}.flac`;
      encode(ch, wav.rate, path.join(out, sample));
      const [lovel, hivel] = vels[layers.indexOf(h.layer)];
      const region = { sample, lokey: key, hikey: key, pitch_keycenter: key, lovel, hivel, loop_mode: "one_shot" };
      const rrs = forKey.filter((o) => o.layer === h.layer).map((o) => o.rr).sort((a, b) => a - b);
      if (rrs.length > 1) Object.assign(region, { seq_length: rrs.length, seq_position: rrs.indexOf(h.rr) + 1 });
      regions.push(region);
    }
  }
  writeSfz(path.join(pack, `${name}.sfz`), {
    title: `${name} - VSCO 2 Percussion`,
    credit: `${VSCO_CREDIT} Keys: ${KIT.map(([k, n]) => `${k} ${n}`).join(", ")}.`,
    slug, global: { amp_veltrack: 80 }, regions, generator: "vsco.mjs",
  });
  console.log(`vsco: ${name}: ${regions.length} regions`);
}

export async function buildFamily(family, { pack, run, work }) {
  const spec = FAMILIES[family];
  const flac = flacBinary();
  run(flac, ["--version"]);
  const encode = flacEncoder(flac, run, work);
  const dirs = new Set(spec.instruments.filter((i) => i.dir !== "Percussion").map((i) => `/${i.dir}/*.wav`));
  const loose = spec.kit || spec.instruments.some((i) => i.dir === "Percussion") ? ["/Percussion/*.wav"] : [];
  const root = fetchRepo({ ...VSCO_REPO, patterns: [...CREDIT_PATTERNS, ...dirs, ...loose] }, work, run);

  for (const i of spec.instruments) {
    buildVsco(i, root, pack, work, encode, { packName: spec.pack, log: "vsco", generator: "vsco.mjs" });
  }
  if (spec.kit) buildKit(spec.kit, root, pack, encode);

  copyCredits(pack, upstreamCredits(root, "VSCO-2-CE"), `${spec.pack} is made from VS Chamber Orchestra Community Edition by Versilian Studios
(Sam Gossner, Simon Dalzell, Elan Hickler), CC0 1.0.
https://github.com/sgossner/VSCO-2-CE (${VSCO_REPO.sha})

The SFZ files were written for Oxbeat: samples are mono 16-bit FLAC, sustains are
looped and shortened, and short notes are trimmed. Thank you to Versilian Studios.
`);
  console.log(`vsco: ${spec.pack}: ${(folderSize(pack) / MB).toFixed(1)} MB`);
}
