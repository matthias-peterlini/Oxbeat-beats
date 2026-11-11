// MuseScore General (MIT): the SoundFont is shipped as it is, with its
// licence and acknowledgements in credits/.

import fs from "node:fs";
import path from "node:path";
import { copyCredits } from "./lib.mjs";

export default function prepare({ sources, pack }) {
  fs.copyFileSync(path.join(sources.soundfont, "MuseScore_General.sf2"), path.join(pack, "MuseScore_General.sf2"));
  copyCredits(pack, [[path.join(sources.license, "MuseScore_General_License.md"), "MuseScore_General_License.md"]], `MuseScore General 0.2 (MIT), from https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/

FluidR3 by Frank Wen, Copyright (c) 2000-02. FluidR3Mono by Michael Cowgill,
Copyright (c) 2014-17. Adaptation for MuseScore_General.sf2 by S. Christian
Collins, Copyright (c) 2018-19. Temple Blocks by Ethan Winer, Copyright (c)
2002. Drumline Cymbals by Michael Schorsch, Copyright (c) 2016.

Shared under the MIT license; see MuseScore_General_License.md. The SoundFont
is unchanged.
`);
}
