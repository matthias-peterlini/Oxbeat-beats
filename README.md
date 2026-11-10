<div align="center">

# Oxbeat Sounds

**Free instruments and drum kits for [Oxbeat](https://github.com/matthias-peterlini/Oxbeat), one click away.**

[![Publish packs](https://github.com/matthias-peterlini/Oxbeat-beats/actions/workflows/publish.yml/badge.svg)](https://github.com/matthias-peterlini/Oxbeat-beats/actions/workflows/publish.yml)
![Packs](https://img.shields.io/badge/packs-6-6c5ce7)
![Sounds](https://img.shields.io/badge/sounds-121-00b894)

</div>

---

Every pack here is a freely licensed sample library, tidied up and
packaged so Oxbeat can download and play it straight away. You don't need
to visit this page to use them: open Oxbeat, choose **Add Track**, and go to
the **Store** tab.

## The packs

| Pack | What's inside | Size | Licence |
| --- | --- | ---: | --- |
| **Oxbeat Essentials** | What Oxbeat downloads on first launch: a sampled grand piano, electric and upright pianos, organ, strings, winds, brass, orchestral percussion, an acoustic drum kit, and General MIDI guitars, basses, voices and synths (47 sounds) | 139 MB | Mixed: CC BY 3.0, CC BY-SA 4.0, CC0 1.0, GeneralUser GS License v2.0 (every licence is in the pack's `credits` folder) |
| **GeneralUser GS** | 49 hand-picked instruments (pianos, guitars, basses, strings, brass, winds, synths), 9 drum kits, and every other sound in the bank | 28 MB | [GeneralUser GS License v2.0](https://github.com/mrbumpy409/GeneralUser-GS/blob/main/documentation/LICENSE.txt) |
| **Sam's Sonor Drums** | A real Sonor Force 3001 acoustic kit with several velocity layers | 35 MB | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| **MTG Solo Saxophones** | Soprano, alto, tenor and baritone sax, sampled note by note | 100 MB | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| **Ixox Flute** | A soft, breathy concert flute | 9 MB | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| **Cowsynth** | Quirky sample-based organs, pads and plucks | 13 MB | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

Sizes are the download size; packs are installed in Oxbeat's data folder
and can be removed again from the Store tab.

## Credits

These packs exist thanks to the people who recorded and shared them:

- **Oxbeat Essentials** combines:
  - the Salamander Grand Piano (Yamaha C5) by Alexander Holm, CC BY 3.0, via [sfzinstruments](https://github.com/sfzinstruments/SalamanderGrandPiano)
  - the Wurlitzer EP200 by Greg Sullivan, CC BY 3.0, via [sfzinstruments](https://github.com/sfzinstruments/GregSullivan.E-Pianos)
  - upright piano, organ, strings, winds, brass and percussion from [VS Chamber Orchestra Community Edition](https://github.com/sgossner/VSCO-2-CE) by Versilian Studios, CC0 1.0
  - Sam's Sonor Drums and GeneralUser GS (credited below)
- **GeneralUser GS** by S. Christian Collins ([website](https://schristiancollins.com/generaluser.php), [GitHub](https://github.com/mrbumpy409/GeneralUser-GS))
- **Sam's Sonor Drums** by Sam Greene, SFZ mapping by [sfzinstruments](https://github.com/sfzinstruments/SamsSonor)
- **MTG Solo Saxophones** by the Music Technology Group at Universitat Pompeu Fabra, SFZ mapping by [sfzinstruments](https://github.com/sfzinstruments/MTG.SoloSax)
- **Ixox Flute** by Xavier Hosxe, SFZ mapping by [sfzinstruments](https://github.com/sfzinstruments/Ixox.Flute)
- **Cowsynth** by [Karoryfer Samples](https://github.com/sfzinstruments/karoryfer.cowsynth)

When you publish music made with a CC BY or CC BY-SA pack you are free to
use it commercially; crediting the pack is appreciated, and the licence asks
for attribution when you redistribute the samples themselves.

## How it works

```
packs/<id>.json      a recipe: upstream archive (pinned to a commit), the files to keep,
                     and the sounds Oxbeat shows, with names, captions and presets
tools/build.mjs      downloads each recipe's archive, writes pack.json, zips the pack,
                     and writes index.json with every pack's size and SHA-256
publish.yml          on every push to main, builds the packs whose version changed and
                     uploads them to the "packs" release
```

Oxbeat reads `index.json` from the
[`packs` release](https://github.com/matthias-peterlini/Oxbeat-beats/releases/tag/packs),
downloads the zip over HTTPS, checks its SHA-256, and unpacks it.

### Recipe format

```jsonc
{
  "id": "my-pack",                 // lowercase letters, digits, - and _; matches the file name
  "name": "My Pack",
  "version": "1.0.0",              // bump this to publish a new build
  "category": "Keys",
  "description": "One line for the Store.",
  "author": "Who made the samples",
  "license": "CC BY 4.0",
  "homepage": "https://…",
  "source": "https://github.com/…/archive/<commit>.zip",
  "include": ["Piano.sfz", "Samples"],   // optional; default is everything except .git*
  "sounds": [
    { "name": "Piano", "file": "Piano.sfz", "caption": "Optional subtitle", "category": "Keyboards" },
    { "name": "Kit", "file": "Bank.sf2", "preset": "128:0", "kind": "drums", "category": "Drums" }
  ]
}
```

A sound's optional `category` groups it in Oxbeat's Library: one of
Keyboards, Strings, Winds, Brass, Guitars, Bass, Drums, Percussion, Synths or
Vocals. Without it, the sound goes under the pack's `category`.

A pack built from several libraries lists them under `sources` instead of
`source`, and names a script in `tools/prepare/` that assembles the pack:

```jsonc
  "sources": [
    { "name": "drums", "url": "https://github.com/…/archive/<commit>.zip" },
    { "name": "bank", "url": "https://github.com/…/archive/<commit>.zip" }
  ],
  "prepare": "my-pack.mjs"
```

The script's default export receives `{ sources, pack, run, work }`: each
source's unpacked folder by name, the empty folder to fill, a helper that
runs a command, and a scratch folder. `include` does not apply; the script
decides what goes in. `tools/prepare/essentials.mjs` is the example: it also
fetches sample folders from git, pinned to commits, and re-encodes them.

A sound's `file` can be an `.sfz`, an `.sf2` (with an optional
`bank:program` preset; leave it out to let people browse every preset), or a
single audio file (`.wav`, `.flac`, `.ogg`, `.mp3`, `.aif`). Bank 128 is
drums, as in General MIDI.

### Building locally

You need Node 18 or newer, plus `zip` and `unzip` on Linux and macOS (Windows
uses its built-in `tar`). The Essentials pack also needs `git` and
[`flac`](https://xiph.org/flac/) (or set `FLAC` to its path), and downloads
about 2.5 GB of source samples; set `OXBEAT_GIT_CACHE` to a folder to keep them
between builds.

```bash
node tools/build.mjs --only my-pack --no-previous
node --test "tools/*.test.mjs"     # tests for the build tool
```

The zip and `index.json` land in `dist/`. To try the pack, unzip it into
Oxbeat's packs folder (`%APPDATA%\Oxbeat\packs` on Windows,
`~/Library/Application Support/Oxbeat/packs` on macOS,
`~/.local/share/Oxbeat/packs` on Linux) and open the Library tab.

## Adding a pack

Pull requests are welcome. A pack is accepted when:

1. its licence allows redistribution (no "non-commercial" or "no
   derivatives" licences, since Oxbeat users make and share music);
2. the recipe pins the source to a specific commit or release;
3. every sound plays in Oxbeat and the pack builds with `tools/build.mjs`.

## Licence

The scripts and recipes in this repository are CC0. Each pack keeps the
licence of the library it comes from; see the table above and [LICENSE](LICENSE).
