# Lampshade Studio

Browser app for designing 3D-printable lampshades. No accounts, no backend. Design state lives in the URL hash.

## Stack
Vite + React 19 + TS, three.js, HeroUI v3 (@heroui/react + @heroui/styles, Tailwind v4, Tabler icons). `src/components/ui/*`: HeroUI adapters (button, switch, input) plus custom controls styled like a parameter panel: `Bar` (slider.tsx, full-width scrub bar with typed value) and `ToggleGroup` (segmented row with inline label). They play UI sounds (`src/lib/sound.ts`: Web Audio knob tick on slider steps, click on toggles/buttons, mute saved to localStorage).

## Files
- `src/geometry.ts`: pure mesh builder. `Params`, `PRESETS`, `PRINTERS`, `profileR` (Hermite spline through `p.profile` control points [t, r]), `radiusAt(p, θ, t)` = profile + sides/twist/ripples/waves + pattern (voronoi/knurl/weave, uint hash shared with GLSL) + image relief (128² greyscale via `setTexture`, kept in localStorage, not in the share link), `resolution()`, `buildFitting()` and `buildShade()` → `{ geo, fitting, stats }` (stats include a rough print time and nozzle/line-width warnings). mm, **Z-up**, z = 0 on the bed.
- `src/shapeShader.ts`: GPU preview. A fixed (θ, t, side) grid (`gridGeometry`, same resolution and index layout as `buildShade`) whose vertex shader computes position, normal, overhang colour and wall from uniforms (`syncShape`). `SHAPE_GLSL` mirrors `profileR`/`radiusAt`/patterns/image relief line by line: **change both together**. `gpuify()` patches built-in materials (shade, wire overlay, shadow distance); `uGpu = 0` renders ordinary geometry (the perforated CPU mesh).
- `src/Viewer.tsx`: three scene. The mesh is rotated −90° about X for display only. Exports use the raw Z-up geometry.
- `src/ProfileView.tsx`: profile editor + SVG side section. Drag points, double-click to add or remove them, and type an exact height/Ø for the selected point. The frame snaps to 20 mm and is frozen while dragging. (θ = 0/π cut, envelope, dimensions) and top slice at an adjustable height. Uses `radiusAt` and the same perpendicular-wall rule as the mesh.
- `src/perforate.ts` + `src/perf.worker.ts`: perforations. Radial prism cutters (circle/slot/diamond) are unioned and subtracted from the solid shade with manifold-3d (WASM) in a Web Worker, debounced 200 ms, and keyed to the shade's uuid. The output is watertight. Overhang colours aren't carried through the boolean. Solid mode only.
- `src/export.ts`: binary STL and a hand-written 3MF zipped with fflate. Solid mode: shade + spider as components of one object (fused print). Vase mode: two separate objects.
- `src/App.tsx`: full-screen canvas with two floating 300px panels on lg+ (left: brand, Start from, Profile, Form · right: collapsible Surface / Perforation / Color / Light / Print / My designs, export footer). Stacks on mobile. Presets include Blank, My designs (localStorage, try/catch), 3MF/STL export, share link.

## Rules
- Meshes must stay closed and consistently wound: each directed edge needs exactly one reverse.
- Overhang = horizontal step along the surface normal vs. vertical step. Over 45° is red. Thin walls overhang both ways.
- Solid mode: wall plus an optional E27 (41 mm) / E14 (29 mm) press-fit ring with 3 spokes on the bed. The spokes overlap the wall and the slicer unions them. Vase mode: closed skin, plus a separate glue-in spider whose round rim (`glueRimR`) touches the skin's innermost point within 8 mm, with 0.3 mm clearance.
- Direct editing: blue profile handles in the 3D view (`Viewer.tsx`) sit on the vertical plane facing the camera, in the mesh's local frame. Edits go through `movePoint`/`addPoint`/`removePoint` (geometry.ts), which both the handles and the section editor use. The view always draws the live params on the GPU (no mesh rebuild per change). `App.tsx` builds the exact CPU mesh from the settled params (250 ms after the last change, never mid-drag); that mesh feeds export, stats and the perforation worker. Until the cut lands, holes are drawn in the fragment shader. Undo/redo snapshots the params after 400 ms of rest (⌘Z / ⇧⌘Z).
- Wall thickness is perpendicular to the surface: the horizontal offset is divided by cos(lean).
- Theme: white by default, optional dark (`.dark` tokens in `index.css`, toggle in `App.tsx` saved to localStorage "theme", applied pre-paint by a script in index.html). Both use zero-chroma neutrals. Studio/print-check render straight to the canvas so the white clear colour isn't tone-mapped. Only the lit view goes through the bloom composer.
- Lit view hangs the shade as a pendant (ring up). The glow is a shader term in `Viewer.tsx`: Beer–Lambert transmission tinted by the filament colour × path through the wall × inverse-square distance to the bulb × bulb colour temperature. The point light casts shadows. Bloom is applied in post.
- PLA is 1.24 g/cm³. Show the "LED only" warning.

## Next
Compare two designs side by side, text/logo engraving, a printable table-lamp base, touch gesture polish, example gallery by link.
