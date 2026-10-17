import { useEffect, useRef } from "react"
import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { RenderPass } from "three/addons/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"
import { profileR, type Params } from "./geometry"

export type View = "studio" | "lit" | "overhangs"
export type Shot = "front" | "side" | "top" | "fit"
// Profile handles: `profile`/`height` are the live (non-deferred) values so dots track the cursor exactly
type Edit = {
  profile: [number, number][]; height: number
  onMove: (i: number, t: number, r: number) => void
  onAdd: (t: number) => void
  onRemove: (i: number) => void
  onDragState: (dragging: boolean) => void
}
type Props = { geo: THREE.BufferGeometry; fitting: THREE.BufferGeometry | null; p: Params; view: View; bed: readonly number[]; edit: Edit; dark: boolean; shot: { kind: Shot; n: number } | null }

const ROUGH = { matte: 0.85, silk: 0.35, glossy: 0.15 }
const HANG = 260 // pendant height above the table in lit view (mm)

// Blackbody colour temperature → linear RGB (Tanner Helland fit)
function kelvinColor(k: number) {
  const t = k / 100
  const r = t <= 66 ? 255 : 329.7 * (t - 60) ** -0.1332
  const g = t <= 66 ? 99.47 * Math.log(t) - 161.12 : 288.12 * (t - 60) ** -0.0755
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04
  const c = (v: number) => Math.min(Math.max(v, 0), 255) / 255
  return new THREE.Color().setRGB(c(r), c(g), c(b), THREE.SRGBColorSpace)
}

// Light that passes through the wall: Beer–Lambert absorption tinted by the filament colour,
// longer path at grazing angles, inverse-square falloff from the bulb. Only shown when bulb and
// viewer are on opposite sides of the wall.
const uniforms = {
  uBulb: { value: new THREE.Vector3() }, // view space
  uBulbColor: { value: new THREE.Color() },
  uPower: { value: 0 },
  uThick: { value: 1 },
  uFilament: { value: new THREE.Color() },
}
function addTransmission(m: THREE.MeshStandardMaterial) {
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms)
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform vec3 uBulb, uBulbColor, uFilament; uniform float uPower, uThick;`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        {
          vec3 P = -vViewPosition, Lv = uBulb - P;
          float d = length(Lv); vec3 L = Lv / d, V = normalize(vViewPosition);
          float nl = dot(normal, L), nv = dot(normal, V);
          float path = uThick / max(abs(nv), 0.25);
          vec3 sigma = 0.55 + 0.8 * -log(max(uFilament, vec3(0.02)));
          vec3 T = exp(-sigma * path);
          totalEmissiveRadiance += step(nl * nv, 0.0) * abs(nl) * uBulbColor * uFilament * T * uPower / (d * d);
        }`)
  }
}

export function Viewer({ geo, fitting, p, view, bed, edit, dark, shot }: Props) {
  const live = useRef(edit)
  live.current = edit
  const host = useRef<HTMLDivElement>(null)
  const ctx = useRef<ReturnType<typeof setup>>(null)

  function setup(el: HTMLDivElement) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.toneMapping = THREE.AgXToneMapping
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture
    const camera = new THREE.PerspectiveCamera(35, 1, 1, 6000)
    camera.position.set(420, 420, 600)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, envMapIntensity: 0.6 })
    addTransmission(mat)
    const hidden = new THREE.MeshBasicMaterial({ visible: false })
    const mesh = new THREE.Mesh(geo, [mat, hidden])
    mesh.castShadow = mesh.receiveShadow = true
    // Fitting part rides along with the shade, shown where it sits once printed/glued
    const fit = new THREE.Mesh(new THREE.BufferGeometry(), mat)
    fit.castShadow = fit.receiveShadow = true
    mesh.add(fit)

    // Pen-tool handles live in the shade's local (Z-up) frame, on the vertical plane facing the
    // camera, so they always sit on the visible right-hand silhouette and work in every view.
    const handles = new THREE.Group()
    const dotGeo = new THREE.SphereGeometry(4, 16, 12)
    const dotMat = new THREE.MeshBasicMaterial({ color: "#2563eb", depthTest: false, transparent: true })
    const curve = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: "#2563eb", depthTest: false, transparent: true, opacity: 0.7 }))
    curve.renderOrder = handles.renderOrder = 10
    mesh.add(handles, curve)
    const side = new THREE.Vector3(1, 0, 0), inv = new THREE.Matrix4()
    const curvePts = new Float32Array(49 * 3)
    curve.geometry.setAttribute("position", new THREE.BufferAttribute(curvePts, 3))
    const placeHandles = () => {
      const { profile, height } = live.current
      inv.copy(mesh.matrixWorld).invert()
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).transformDirection(inv).setZ(0)
      if (right.lengthSq() > 1e-4) side.copy(right.normalize())
      while (handles.children.length < profile.length) handles.add(new THREE.Mesh(dotGeo, dotMat))
      handles.children.forEach((h, i) => {
        h.visible = i < profile.length
        if (!h.visible) return
        const [t, r] = profile[i]
        h.position.set(side.x * r, side.y * r, t * height)
        h.userData.i = i
        h.renderOrder = 11
      })
      for (let k = 0; k <= 48; k++) {
        const t = k / 48, r = profileR(profile, t)
        curvePts.set([side.x * r, side.y * r, t * height], k * 3)
      }
      curve.geometry.attributes.position.needsUpdate = true
    }

    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(), hitPt = new THREE.Vector3()
    const dom = renderer.domElement
    const aim = (e: MouseEvent) => {
      const b = dom.getBoundingClientRect()
      ndc.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
    }
    const pick = () => handles.visible ? ray.intersectObjects(handles.children.filter((h) => h.visible))[0] : undefined
    let drag = -1
    dom.addEventListener("pointerdown", (e) => {
      aim(e)
      const hit = pick()
      if (!hit) return
      e.stopImmediatePropagation() // keep OrbitControls from rotating
      drag = hit.object.userData.i
      controls.enabled = false
      dom.setPointerCapture(e.pointerId)
      live.current.onDragState(true)
    }, { capture: true })
    dom.addEventListener("pointermove", (e) => {
      aim(e)
      if (drag < 0) { dom.style.cursor = pick() ? "grab" : ""; return }
      // Intersect the handle plane (contains the shade axis and `side`), read back radius + height
      const n = new THREE.Vector3(-side.y, side.x, 0).transformDirection(mesh.matrixWorld)
      plane.setFromNormalAndCoplanarPoint(n, mesh.getWorldPosition(new THREE.Vector3()))
      if (!ray.ray.intersectPlane(plane, hitPt)) return
      const q = mesh.worldToLocal(hitPt)
      live.current.onMove(drag, q.z / live.current.height, q.x * side.x + q.y * side.y)
    })
    const end = () => {
      if (drag < 0) return
      drag = -1
      controls.enabled = true
      live.current.onDragState(false)
    }
    dom.addEventListener("pointerup", end)
    dom.addEventListener("pointercancel", end)
    dom.addEventListener("dblclick", (e) => {
      if (!handles.visible) return
      aim(e)
      const h = pick()
      if (h) return live.current.onRemove(h.object.userData.i)
      const m = ray.intersectObject(mesh, false)[0]
      if (m) live.current.onAdd(mesh.worldToLocal(m.point.clone()).z / live.current.height)
    })

    const bulb = new THREE.PointLight("#fff", 0, 0, 2)
    bulb.castShadow = true
    bulb.shadow.mapSize.set(1024, 1024)
    bulb.shadow.bias = -0.0008
    bulb.shadow.radius = 4
    const bulbMesh = new THREE.Mesh(new THREE.SphereGeometry(30, 32, 16), new THREE.MeshBasicMaterial())
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 1200), new THREE.MeshStandardMaterial({ color: "#222" }))
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(20, 20, 55, 32), new THREE.MeshStandardMaterial({ color: "#d9d4cc", roughness: 0.5 }))
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: "#3b342e", roughness: 0.95 }))
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    const bedGrid = new THREE.GridHelper(1, 16, "#c4c4c4", "#e4e4e4")
    const hemi = new THREE.HemisphereLight("#fff", "#888888", 0)

    const lit = new THREE.Group()
    lit.add(bulb, bulbMesh, cord, socket, floor)
    scene.add(mesh, lit, bedGrid, hemi)

    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.6, 0.9)
    composer.addPass(bloom)
    composer.addPass(new OutputPass())

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight
      renderer.setSize(w, h)
      composer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    // Camera presets: ease from the current view to a framed Front / Side / Top shot, or re-fit
    // the current angle. Distance fits the bounding sphere into the narrower of the two FOVs.
    const fly = { start: -1, p0: new THREE.Vector3(), p1: new THREE.Vector3(), t0: new THREE.Vector3(), t1: new THREE.Vector3() }
    const frame = (kind: Shot) => {
      const box = new THREE.Box3().setFromObject(mesh)
      const center = box.getCenter(new THREE.Vector3()), radius = box.getSize(new THREE.Vector3()).length() / 2
      const v = THREE.MathUtils.degToRad(camera.fov) / 2, h = Math.atan(Math.tan(v) * camera.aspect)
      const dist = (radius / Math.sin(Math.min(v, h))) * 1.02
      const dir = kind === "front" ? new THREE.Vector3(0, 0, 1) : kind === "side" ? new THREE.Vector3(1, 0, 0)
        : kind === "top" ? new THREE.Vector3(0, 1, 1e-4) : camera.position.clone().sub(controls.target)
      fly.p0.copy(camera.position); fly.t0.copy(controls.target)
      fly.t1.copy(center); fly.p1.copy(center).addScaledVector(dir.normalize(), dist)
      fly.start = performance.now()
    }
    const bulbWorld = new THREE.Vector3()
    const state = { lit: false }
    renderer.setAnimationLoop(() => {
      if (fly.start >= 0) {
        const k = Math.min(1, (performance.now() - fly.start) / 450), e = 1 - (1 - k) ** 3
        camera.position.lerpVectors(fly.p0, fly.p1, e)
        controls.target.lerpVectors(fly.t0, fly.t1, e)
        if (k === 1) fly.start = -1
      }
      controls.update()
      camera.updateMatrixWorld()
      if (handles.visible) placeHandles()
      uniforms.uBulb.value.copy(bulb.getWorldPosition(bulbWorld)).applyMatrix4(camera.matrixWorldInverse)
      // Lit view needs the composer for bloom. Studio renders directly so the clear colour stays
      // pure white (the composer's output pass would tone-map the background to grey).
      if (state.lit) composer.render()
      else renderer.render(scene, camera)
    })
    const dispose = () => { ro.disconnect(); renderer.setAnimationLoop(null); renderer.dispose(); el.removeChild(renderer.domElement) }
    return { frame, handles, curve, state, scene, env, mesh, fit, mat, bulb, bulbMesh, cord, socket, lit, bedGrid, hemi, bloom, controls, dispose }
  }

  useEffect(() => {
    ctx.current = setup(host.current!)
    return () => ctx.current?.dispose()
  }, [])

  useEffect(() => {
    const c = ctx.current!
    if (c.mesh.geometry !== geo) { c.mesh.geometry.dispose(); c.mesh.geometry = geo }
    if (c.fit.geometry !== fitting) { c.fit.geometry.dispose(); c.fit.geometry = fitting ?? new THREE.BufferGeometry() }
    const h = p.height, isLit = view === "lit"

    // Lit view hangs the shade as a pendant: fitting ring on top, bulb below the socket.
    // Studio/overhang views show it as printed, ring on the bed.
    c.mesh.rotation.x = isLit ? Math.PI / 2 : -Math.PI / 2
    c.mesh.position.y = isLit ? HANG + h : 0
    const ringY = HANG + h
    c.socket.position.y = ringY + 10
    c.cord.position.y = ringY + 640
    c.bulb.position.set(0, ringY - 65, 0)
    c.bulbMesh.position.copy(c.bulb.position)
    c.lit.visible = isLit
    c.handles.visible = c.curve.visible = !isLit
    c.bedGrid.visible = !isLit
    c.bedGrid.scale.set(bed[0], 1, bed[1])
    c.controls.target.set(0, isLit ? HANG + h / 2 : h / 2, 0)

    const bulbColor = kelvinColor(p.kelvin)
    c.bulb.color.copy(bulbColor)
    c.bulb.intensity = isLit ? p.lumens * 150 : 0
    ;(c.bulbMesh.material as THREE.MeshBasicMaterial).color.copy(bulbColor).multiplyScalar(4)
    uniforms.uBulbColor.value.copy(bulbColor)
    uniforms.uPower.value = isLit ? p.lumens * 40 : 0
    uniforms.uThick.value = p.thickness
    uniforms.uFilament.value.set(p.color)

    c.mat.color.set(view === "overhangs" ? "#ffffff" : p.color)
    c.mat.vertexColors = view === "overhangs"
    c.mat.roughness = ROUGH[p.finish]
    c.mat.needsUpdate = true
    c.state.lit = isLit
    c.scene.environment = isLit ? null : c.env
    c.scene.background = new THREE.Color(isLit ? "#0b0a09" : dark ? "#0a0a0a" : "#ffffff")
    const gm = c.bedGrid.material as THREE.Material
    gm.transparent = true
    gm.opacity = dark ? 0.22 : 1
    c.hemi.intensity = isLit ? 0.06 : 0
    c.bloom.strength = isLit ? 0.55 : 0
  }, [geo, fitting, p, view, bed, dark])

  useEffect(() => { if (shot) ctx.current?.frame(shot.kind) }, [shot])

  return <div ref={host} className="size-full" />
}
