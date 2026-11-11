// Karoryfer guitars (CC0 1.0): Emily, Shinyguitar and Black And Green Guitars,
// flattened by sfzpack.mjs.

import { copyCredits } from "./lib.mjs";
import { buildSfzPack, creditFiles } from "./sfzpack.mjs";

const gh = (repo, sha) => ({ url: `https://github.com/sfzinstruments/${repo}`, sha, license: "CC0 1.0" });
export const REPOS = {
  emilyguitar: gh("karoryfer.emilyguitar", "b4920dc662fd9cad6dcaccdeecffdd91c8725d8c"),
  shinyguitar: gh("karoryfer.shinyguitar", "57243cca85277dbcc120ce17c6178032f93c80f3"),
  "black-and-green-guitars": gh("karoryfer.black-and-green-guitars", "b3b3249d37dc977a1a297bd2dc053e6d9b6b805c"),
};
// Shinyguitar's programs name their sample folder through the ARIA bank file.
const shiny = { defines: { $sample_dir: "../Samples" }, defaultPath: "../Samples/" };
export const PROGRAMS = [
  { name: "Emily Guitar", repo: "emilyguitar", file: "emily_basic.sfz" },
  { name: "Shiny Archtop Acoustic", repo: "shinyguitar", file: "Programs/acoustic.sfz", ...shiny },
  { name: "Shiny Archtop Electric", repo: "shinyguitar", file: "Programs/electric_one.sfz", ...shiny },
  { name: "Green Gretsch", repo: "black-and-green-guitars", file: "Programs/04-green_twang.sfz" },
  { name: "Black Hofner", repo: "black-and-green-guitars", file: "Programs/07-black_twang.sfz" },
];

export default function prepare({ pack, work, run }) {
  const dirs = buildSfzPack({ repos: REPOS, programs: PROGRAMS, pack, work, run });
  copyCredits(pack, creditFiles(dirs), `Karoryfer Guitars is made from three Karoryfer Lecolds libraries, all CC0 1.0:
${Object.entries(REPOS).map(([k, r]) => `- ${k}: ${r.url} (${r.sha})`).join("\n")}

Emily (an electric guitar) and Shinyguitar (an archtop) were sampled and mapped by D. Smolken;
Black And Green Guitars (a Gretsch Anniversary and a Hofner Club) by Brian Wood.
Oxbeat plays flattened copies of the upstream SFZ programs at their default controller
settings, without release noises, vibrato, filters or unison. Samples are 16-bit FLAC.
Thank you to Karoryfer Lecolds.
`);
}
