# Bible Atlas (prototype)

An explorable 3D Bible atlas. This first version proves the core loop:

1. A stylized globe you can spin and zoom, centred on the Holy Land.
2. One pin, the Sermon on the Mount, at the traditional site by the Sea of Galilee.
3. Tap the pin and fly down through the clouds into a hillside scene you can fly around or walk through.

Everything is one self-contained page: `index.html`. No model files, no images, no audio.
GitHub Pages serves `index.html` from the root of this repo.

## What is in this repo

| Path | What it is |
| --- | --- |
| `index.html` | The finished page. This is the only file the website needs. |
| `src/main.js` | Ties it together: states, buttons, touch and keyboard input, the main loop. |
| `src/globe.js` | The Earth, the pins, and the fly-down camera move. |
| `src/sermon.js` | The Sermon on the Mount scene: land, lake, sky, crowd, teacher. |
| `src/figures.js` | Builds the simple faceless people out of basic shapes. |
| `src/explore.js` | The free camera and the first-person walk. Reusable for future scenes. |
| `src/content.js` | All words shown on screen: pin locations, place names, scripture, notes. |
| `src/page.html` | The page layout and styling. |
| `src/data/geo.json` | Coastlines, lakes and rivers as plain numbers (from Natural Earth, public domain). |
| `tools/make-geo.mjs` | Rebuilds `geo.json` from the raw Natural Earth files. Rarely needed. |
| `build.mjs` | Packs everything in `src/` into `index.html`. |
| `test/run.mjs` | Opens the page in an invisible browser, drives it, and saves screenshots. |

## Changing something and rebuilding

You need Node.js installed. In a terminal, inside this folder:

```
npm install
node build.mjs
```

That rewrites `index.html`. Commit and push, and GitHub Pages updates in a minute or two.

To run the automated check (optional):

```
node test/run.mjs            # phone held sideways, simulated touch
node test/run.mjs desktop    # computer, mouse and keyboard
```

Screenshots land in `test/shots/`.

## Adding another place later

1. Add an entry to `LOCATIONS` in `src/content.js` (name, reference, latitude, longitude, scene name).
2. Write a scene file like `src/sermon.js` that returns the same shape of object
   (`scene`, `heightAt`, `colliders`, `views`, `update`).
3. Register it in the `SCENES` list at the top of `src/main.js`, with its text.

The pin, the fly-down, and both camera modes then work for the new place without further changes.

## Sources and honesty notes

- Scripture text is the King James Version (public domain).
- Coastlines, lakes and rivers come from Natural Earth (public domain). Modern reservoirs are left out.
  The Sea of Galilee outline in that dataset is coarse; its north-west corner was corrected by hand
  using two known shoreline sites, Tabgha and Capernaum.
- Land colours on the globe (green, desert, ice) are an artist's approximation, not measured data.
- The in-app "About this scene" tab lists which details come from Matthew and which are visual choices.
- The pin marks the traditional site (Mount of Beatitudes). Matthew names no specific hill.
