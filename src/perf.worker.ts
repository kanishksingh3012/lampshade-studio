import Module from "manifold-3d"
import wasmUrl from "manifold-3d/manifold.wasm?url"
import { cutHoles } from "./perforate"

const ready = Module({ locateFile: () => wasmUrl }).then((w) => { w.setup(); return w })

self.onmessage = async (e: MessageEvent) => {
  const { id, pos, idx, p } = e.data
  const r = cutHoles(await ready, pos, idx, p)
  ;(self as unknown as Worker).postMessage({ id, ...r }, [r.pos.buffer, r.idx.buffer])
}
