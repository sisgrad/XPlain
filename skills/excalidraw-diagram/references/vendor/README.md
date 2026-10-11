# Vendored Excalidraw export (offline)

`excalidraw-export.iife.js` is a browser IIFE that exposes:

```js
window.ExcalidrawExport.exportToSvg(...)
```

`render_template.html` loads it from this folder so Playwright can render `.excalidraw` → PNG
**without** contacting `esm.sh` or any other CDN.

## Rebuild (maintainers)

From the XPlain repo root (needs network once):

```bash
node skills/excalidraw-diagram/references/vendor/build.mjs
```

This installs `@excalidraw/excalidraw` into a temp directory, bundles `exportToSvg` with esbuild, and
overwrites `excalidraw-export.iife.js` + `VERSION.txt`.
