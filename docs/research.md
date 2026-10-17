# Lampshade Studio — research brief

A browser app where anyone (no account) designs a parametric lampshade, previews it lit, and exports a print-ready file.

## 1. What fglibs.com gave us

fglibs.com is a curated directory of UI and interaction libraries, mostly animation and visual effects. It has no CAD or 3D-printing tools. Relevant hits:

| Library | Use here | Verdict |
|---|---|---|
| **Three.js** | 3D viewport, materials, lighting, STL export | **Core dependency** |
| DialKit | Live parameter panels, but for *developers* tuning motion | Skip. Tweakpane does the same job for end users |
| p5.js | 2D creative coding | Optional: a 2D profile/pattern sketch pad later |
| HextaUI / Arc Library | Polished UI components (React) | Only if we move to React. Not needed for v1 |

fglibs also offers an MCP connection, which we could use later to look up UI polish components.

## 2. What makes a printable lampshade (the "realism" layer)

These details make it a real lamp and not just a 3D toy:

- **Fitting hole:** Real E27 shades use a **40.5–42 mm** ring hole: 41 mm for a snug press fit, 42 mm for a loose fit (IKEA-style). An E14 holder takes a reducer to about 29 mm. Offer presets plus a custom value.
- **Two print modes, because they can't mix:**
  - *Vase mode (spiralize):* one continuous wall, fast and very translucent, but it **can't contain a spider or ring**. The fitting is exported as a separate small part.
  - *Solid mode:* a real wall thickness, with a spider ring and spokes merged into the shade, all in one print.
- **Overhangs:** A profile slope steeper than about 45° from vertical will sag. Highlight those zones red in the viewport.
- **Wall thickness and translucency:** 0.4–0.8 mm glows nicely; above 1.6 mm is mostly opaque. Snap thickness to multiples of the nozzle line width.
- **Heat:** PLA softens around 55–60 °C, so warn "LED bulbs only" and enforce a minimum bulb-to-wall clearance. PETG is safer.
- **Bed fit:** Check the bounding box against printer presets (220×220×250, 256³, custom).
- **Estimates:** Filament grams = volume × density (PLA 1.24 g/cm³). A rough print time is a nice extra.

## 3. Recommended open-source stack

| Concern | Choice | License | Why |
|---|---|---|---|
| Build tool | **Vite + vanilla TypeScript** | MIT | Lowest boilerplate, so fewer tokens for Claude Code to write and read |
| 3D | **three** | MIT | Mesh building, lit preview, `STLExporter` built in |
| Controls | **Tweakpane** (or lil-gui) | MIT | Sliders, color, folders in about 20 lines. Made for end users |
| Solid booleans | **manifold-3d** (WASM) | Apache-2.0 | Merges spider/ring into the shell and cuts perforations, always producing **watertight** meshes. Load it only when needed |
| 3MF export | **fflate** + small XML writer | MIT | Manifold's maintainers recommend 3MF over STL. Bambu, Prusa and Cura all read it |
| Hosting | Any static host (GitHub Pages, Vercel, Netlify) | – | No backend, no accounts, no database |
| Sharing | Parameters encoded in the URL hash, autosave in localStorage | – | "Send a link to your design" with zero servers |

Not chosen: React/R3F (more code and tokens for v1), Replicad/OpenCascade (heavy WASM, LGPL kernel), JSCAD (slower CSG).

**Key technical idea:** Generate the shade *analytically* as r(θ, z): a base profile curve plus modulations like polygon sides, twist, sine ripples and noise. Building the outer and inner surfaces and the rims ourselves makes the shell watertight from the start. Manifold is used only for the fitting and the cutouts.

## 4. Feature set by milestone

**M1 — MVP (shape + export)**
- Profile from 4–6 draggable spline points (height, top/bottom radius, belly)
- Modulators: sides (circle → n-gon), twist, ripple amplitude and frequency, vertical waves
- Orbit viewport, Tweakpane panel, binary STL export (vase-mode shell)

**M2 — Printability**
- Wall thickness → solid mesh. Spider ring with E27/E14/custom presets merged via Manifold
- Overhang heatmap, bed-fit check, filament estimate, 3MF export, and a separate ring part for vase mode

**M3 — Realistic preview**
- Bulb glow inside (emissive + point light), translucent `MeshPhysicalMaterial` driven by wall thickness, filament color presets
- "Room" toggle: the light casts the shade's pattern onto the floor and walls (shadows through perforations)
- Preset gallery (6–8 starter designs), share link, mobile layout

**M4 — Ship:** Polish, an about/print-tips page, and static deploy.

## 5. Token-efficient workflow with Claude Code

1. **One `CLAUDE.md` (≤60 lines):** the stack, the file map, and the rules from section 2. Every session reads it instead of researching again.
2. **Small files with clear boundaries:**
   `geometry/profile.ts`, `geometry/shell.ts`, `geometry/fitting.ts` (pure functions, no Three.js scene code), `scene.ts`, `ui.ts`, `export/stl.ts`, `export/3mf.ts`, `checks.ts`. Each prompt then touches one or two files.
3. **One milestone per session.** Clear the context between milestones and start each with "Read CLAUDE.md, do M2."
4. **Pin versions** in package.json and keep dependencies minimal (four runtime packages).
5. **Verify cheaply:** a few unit tests on the geometry functions (watertight check, bounding box), plus one browser screenshot per milestone. Test-print a 41 mm ring before printing a full shade.

## Sources
- [manifold-3d on npm](https://npmjs.com/package/manifold-3d) — WASM, recommends 3MF over STL, manual memory cleanup
- [Printables: E27 shade, 42 mm hole](https://www.printables.com/model/510913-lamp-shade) · [MakerWorld E27 shade](https://makerworld.com/en/models/2994098-lamp-shade-for-e27-socket) · [Printables E27 holder, 40.5 mm](https://www.printables.com/model/633210-lamp-bulb-holder-monitor-vesa-75-100-mount-hue-e27)
- Prior art: [29a.ch procedural lamp shades (three.js, vase mode)](https://29a.ch/2021/08/22/procedural-lamp-shades-3d-printing) · [VaseMaker](https://github.com/dcityorg/vasemaker) · [OpenJsCad lamp shade](https://risacher.org/OpenJsCad/lampshadedemo.html)
