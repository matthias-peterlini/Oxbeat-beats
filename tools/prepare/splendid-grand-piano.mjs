// Splendid Grand Piano (public domain, AKAI; SFZ by kinwie and P. Eastman).
//
// The upstream SFZ leans on ARIA extensions Oxbeat doesn't read: a string
// resonance group gated by locc (which would always sound here), ampeg_hold,
// cutoff and note_polyphony. This keeps the samples as they are and writes one
// flat SFZ with the four velocity layers and each region's release, offset,
// volume and pan.

import fs from "node:fs";
import path from "node:path";
import { copyCredits } from "./lib.mjs";

const LAYERS = [
  ["PP", 1, 67],
  ["MP", 68, 84],
  ["MF", 85, 100],
  ["FF", 101, 127],
];
const KEEP = new Set(["lokey", "hikey", "pitch_keycenter", "ampeg_release", "offset", "volume", "pan"]);

export default function prepare({ sources, pack }) {
  const src = sources.source;
  fs.cpSync(path.join(src, "Samples"), path.join(pack, "Samples"), { recursive: true });
  const lines = [
    "// Splendid Grand Piano",
    "// Samples: Public Domain by AKAI. SFZ by kinwie, resonance and half-pedalling by P. Eastman.",
    "// Flattened by tools/prepare/splendid-grand-piano.mjs (github.com/matthias-peterlini/Oxbeat-beats).",
    "",
    "<control>",
    "default_path=Samples/",
    "",
    "<global> ampeg_attack=0.0005 amp_veltrack=50",
  ];
  let regions = 0;
  for (const [dyn, lovel, hivel] of LAYERS) {
    lines.push("", `<group> lovel=${lovel} hivel=${hivel}`);
    const text = fs.readFileSync(path.join(src, "Data", `${dyn}.txt`), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const at = line.indexOf("sample=");
      if (!line.startsWith("<region>") || at < 0) continue;
      // The sample name has spaces; anything after ".$EXT" is more opcodes.
      const [sample, after = ""] = line.slice(at + 7).split(".$EXT");
      const opcodes = `${line.slice(8, at)} ${after}`.trim().split(/\s+/).filter((o) => KEEP.has(o.split("=")[0]));
      lines.push(`<region> ${opcodes.join(" ")} sample=${sample.trim()}.flac`);
      regions++;
    }
  }
  fs.writeFileSync(path.join(pack, "Splendid Grand Piano.sfz"), `${lines.join("\n")}\n`);
  copyCredits(pack, [[path.join(src, "README.md"), "SplendidGrandPiano-README.md"]],
    "Splendid Grand Piano\n" +
    "Samples: Public Domain by AKAI (see SplendidGrandPiano-README.md).\n" +
    "SFZ mapping by kinwie, string resonance and half-pedalling by P. Eastman.\n" +
    "Source: https://github.com/sfzinstruments/SplendidGrandPiano at 1c595d827b7fd7f0be3134aaed0f90b3662a09cf\n" +
    "Oxbeat plays a flattened copy of the SFZ without the resonance group.\n");
  console.log(`splendid: ${regions} regions`);
}
