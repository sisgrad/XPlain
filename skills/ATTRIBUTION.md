# Bundled third-party skills

## excalidraw-diagram

Source: [coleam00/excalidraw-diagram-skill](https://github.com/coleam00/excalidraw-diagram-skill)

Copied into this extension under `skills/excalidraw-diagram/` so XPlain can install it into a
workspace (`.xplain/skills/excalidraw-diagram/`, with optional agent bridges) when the user enables **Draw diagrams with the
Excalidraw skill** on the Context tab. Upstream license and authorship remain those of the original
repository; XPlain only redistributes the skill files for that purpose.

Additionally, `skills/excalidraw-diagram/references/vendor/excalidraw-export.iife.js` is a minified
browser bundle of [`@excalidraw/excalidraw`](https://github.com/excalidraw/excalidraw) (`exportToSvg`)
so PNG rendering works offline without CDN. Rebuild with `references/vendor/build.mjs`. Excalidraw
upstream license applies to that bundle.
