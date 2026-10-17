// Tiny UI sounds synthesised with Web Audio (no files). Muted state is remembered per browser.
let ctx: AudioContext | null = null
let last = 0
export let muted = (() => { try { return localStorage.getItem("muted") === "1" } catch { return false } })()
export function setMuted(m: boolean) { muted = m; try { localStorage.setItem("muted", m ? "1" : "0") } catch { /* blocked */ } }

function blip(freq: number, ms: number, gain: number) {
  if (muted) return
  ctx ??= new AudioContext()
  const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain()
  o.type = "triangle"
  o.frequency.setValueAtTime(freq, t)
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000)
  o.connect(g).connect(ctx.destination)
  o.start(t)
  o.stop(t + ms / 1000)
}
// Knob detent: short high tick, throttled so fast drags don't buzz
export function tick() {
  const now = performance.now()
  if (now - last < 45) return
  last = now
  blip(2200, 18, 0.035)
}
export const click = () => blip(900, 40, 0.05)
