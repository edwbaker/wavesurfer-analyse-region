// Runners: how the plugin gets its indices computed. A runner has
//   describe(sampleRate) -> Promise<info[]>
//       each info {key, identifier, name, description, parameters, outputs, ...}
//   run({key, sampleRate, channels, params}) -> Promise<{features, blockSize, elapsedMs, ...}>
// A browser needs the Vamp host in a Web Worker (it cannot compile a plugin on
// the main thread), so createWorkerRunner() talks to one; createHostRunner()
// serves a host that is in this thread already, as in Node.
import { runPlugin } from './run.js'

/**
 * A runner for a vamp-wasm host in this thread. `createHost(sampleRate)` gives
 * a host with the WasmVampHost API, and `keys` lists the plugins to offer.
 * Each host is deleted after use.
 */
export function createHostRunner(createHost, keys) {
  const use = (sampleRate, fn) => {
    const host = createHost(sampleRate)
    try {
      return fn(host)
    } finally {
      host.delete()
    }
  }
  return {
    describe(sampleRate) {
      return new Promise((resolve) => resolve(keys.map((key) => use(sampleRate, (host) => {
        if (!host.loadPlugin(key)) throw new Error('Could not load ' + key)
        return Object.assign({ key }, host.getPluginInfo())
      }))))
    },
    run({ key, sampleRate, channels, params }) {
      return new Promise((resolve) => resolve(use(sampleRate, (host) => runPlugin(host, key, sampleRate, channels, params))))
    },
  }
}

/**
 * A runner for a Worker that speaks the protocol of vamp-ecoacoustics'
 * demo/worker.js: 'describe', or 'audio' then 'run', in; 'described',
 * 'result' and 'error' out. Requests go one at a time, as the worker holds
 * one recording at a time.
 */
export function createWorkerRunner(worker) {
  let audioGen = 0
  let nextId = 1
  let pending = null // {id, resolve, reject} of the request in flight
  let chain = Promise.resolve()

  const settle = (resolve, value) => {
    const request = pending
    pending = null
    if (request) (resolve ? request.resolve : request.reject)(value)
  }

  worker.addEventListener('message', ({ data }) => {
    if (!pending) return
    if (data.type === 'error' && (data.id === undefined || data.id === pending.id)) settle(false, new Error(data.message))
    else if (data.type === 'result' && data.id === pending.id) settle(true, data)
    else if (data.type === 'described' && data.gen === pending.id) settle(true, data)
  })

  const request = (send) => {
    const turn = chain.then(() => new Promise((resolve, reject) => {
      const id = nextId++
      pending = { id, resolve, reject }
      send(id)
    }))
    chain = turn.catch(() => {})
    return turn
  }

  return {
    // The worker echoes a describe request's gen, which is used here as its id
    describe(sampleRate) {
      return request((id) => worker.postMessage({ type: 'describe', gen: id, sampleRate })).then((r) => r.plugins)
    },
    run({ key, sampleRate, channels, params }) {
      audioGen += 1
      const gen = audioGen
      return request((id) => {
        worker.postMessage({ type: 'audio', gen, sampleRate, channels })
        worker.postMessage({ type: 'run', gen, id, key, params: params || {} })
      })
    },
  }
}
