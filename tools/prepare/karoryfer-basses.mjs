// Karoryfer basses (CC0 1.0): Black And Blue Basses, Growlybass, Meatbass and
// D. Smolken's double bass, flattened by sfzpack.mjs.

import { copyCredits } from "./lib.mjs";
import { buildSfzPack, creditFiles } from "./sfzpack.mjs";

const gh = (repo, sha) => ({ url: `https://github.com/sfzinstruments/${repo}`, sha, license: "CC0 1.0" });
export const REPOS = {
  "black-and-blue-basses": gh("karoryfer.black-and-blue-basses", "6e7d674cdb41be7a54dbccb15472401ad01099b9"),
  growlybass: gh("karoryfer.growlybass", "4f483268fc66b5a6d5781d421c0d11b8d08d3fc6"),
  meatbass: gh("karoryfer.meatbass", "ac9e859564bda286ab5ec672d00ff1aa2fef2895"),
  "double-bass": gh("dsmolken.double-bass", "c2985eb647109d2a8f30a70071e3e163339d7396"),
};
export const PROGRAMS = [
  { name: "Darkblack Bass", repo: "black-and-blue-basses", file: "Programs/05-darkblack_pluck.sfz" },
  { name: "Babyblue Bass", repo: "black-and-blue-basses", file: "Programs/04-babyblue_warm.sfz" },
  { name: "Growlybass", repo: "growlybass", file: "growlybass_clean.sfz" },
  { name: "Meatbass Pizzicato", repo: "meatbass", file: "Programs/04_pizz.sfz" },
  { name: "Meatbass Arco", repo: "meatbass", file: "Programs/02_arco_3vel.sfz" },
  { name: "Double Bass Arco", repo: "double-bass", file: "d_smolken_rubner_bass_arco.sfz" },
  { name: "Double Bass Pizzicato", repo: "double-bass", file: "d_smolken_rubner_bass_pizz.sfz" },
];

export default function prepare({ pack, work, run }) {
  const dirs = buildSfzPack({ repos: REPOS, programs: PROGRAMS, pack, work, run });
  copyCredits(pack, creditFiles(dirs), `Karoryfer Basses is made from four CC0 1.0 libraries:
${Object.entries(REPOS).map(([k, r]) => `- ${k}: ${r.url} (${r.sha})`).join("\n")}

Black And Blue Basses, Growlybass and Meatbass are by Karoryfer Lecolds; the double bass
(a Rubner, arco and pizzicato) was sampled by D. Smolken.
Oxbeat plays flattened copies of the upstream SFZ programs at their default controller
settings, without release noises, keyswitches or filters. Samples are 16-bit FLAC.
Thank you to Karoryfer Lecolds and D. Smolken.
`);
}
