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
import path from "node:path";
import {
  MB, VSCO_REPO, buildVsco, fetchRepo, flacBinary, flacEncoder, folderSize, keyRanges, note, noteNumber,
  readWav, resampler, SUSTAIN, tail, writeSfz,
} from "./lib.mjs";

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
    ...VSCO_REPO,
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
  const encode = flacEncoder(flac, run, work);

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
