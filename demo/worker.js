/*
    The demo's Vamp host, in a Web Worker: loads the vamp-wasm host and the
    vamp-ecoacoustics plugins into it, and answers createWorkerRunner().

    Where they are fetched from is in this script's query:
      ?lib=<url>   directory of vamp-ecoacoustics.wasm
      ?host=<url>  directory of vamp-host.js and vamp-host.wasm
    both ending in a slash.

    Messages in:  {type: 'describe', gen, sampleRate}
                  {type: 'audio', gen, sampleRate, channels: Float32Array[]}
                  {type: 'run', gen, id, key, params: {identifier: value}}
    Messages out: {type: 'ready', plugins: [key]}
                  {type: 'described', gen, sampleRate, plugins: [info]}
                  {type: 'result', id, key, features, blockSize, stepSize, elapsedMs}
                  {type: 'error', id, message}

    Based on the demo of vamp-ecoacoustics. (C) Ed Baker 2025. Licensed under GPL (>=2).
*/

const query = new URL(self.location.href).searchParams
const LIB = query.get('lib')
const HOST = query.get('host')
const LIBRARY = 'vamp-ecoacoustics'

importScripts(HOST + 'vamp-host.js')

const pluginKeys = []
let Module = null
let audio = null
let audioGen = 0

const ready = (async () => {
  Module = await VampHostModule({ locateFile: (file) => HOST + file })

  const response = await fetch(LIB + LIBRARY + '.wasm')
  if (!response.ok) throw new Error('Could not fetch ' + LIB + LIBRARY + '.wasm (HTTP ' + response.status + ')')
  Module.FS.mkdir('/vamp')
  // PluginLoader only scans for the platform's library suffix, which is .so under Emscripten
  Module.FS.writeFile('/vamp/' + LIBRARY + '.so', new Uint8Array(await response.arrayBuffer()))

  const host = new Module.WasmVampHost(44100)
  host.setEnv('VAMP_PATH', '/vamp')
  const keys = host.listPlugins()
  for (let i = 0; i < keys.size(); i++) pluginKeys.push(keys.get(i))
  keys.delete()
  host.delete()
  if (!pluginKeys.length) throw new Error('No plugins found in ' + LIBRARY + '.wasm')
})()

ready.then(
  () => postMessage({ type: 'ready', plugins: pluginKeys }),
  (err) => postMessage({ type: 'error', message: err.message || String(err) })
)

function withPlugin(key, sampleRate, fn) {
  const host = new Module.WasmVampHost(sampleRate)
  try {
    if (!host.loadPlugin(key)) throw new Error('Could not load ' + key)
    return fn(host)
  } finally {
    host.delete()
  }
}

// Descriptors depend on the sample rate (frequency limits, ADI's block size)
function describe(sampleRate) {
  return pluginKeys.map((key) => withPlugin(key, sampleRate, (host) => Object.assign({ key }, host.getPluginInfo())))
}

// Blocks are fed the way ReVAMP's runPlugin() does, so results match R
function run(key, params) {
  const sampleRate = audio.sampleRate
  const channels = audio.channels
  return withPlugin(key, sampleRate, (host) => {
    const info = host.getPluginInfo()
    let blockSize = info.preferredBlockSize || 1024
    const frequency = info.inputDomain === 'frequency'
    const stepSize = info.preferredStepSize || (frequency ? blockSize / 2 : blockSize)
    if (stepSize > blockSize) blockSize = frequency ? stepSize * 2 : stepSize

    Object.keys(params).forEach((id) => host.setParameter(id, params[id]))
    if (!host.initialise(channels.length, stepSize, blockSize)) {
      throw new Error(key + ' refused these settings: ' + channels.length + ' channel(s), block size ' + blockSize
        + ', parameters ' + JSON.stringify(params))
    }

    const features = {}
    const collect = (set) => {
      if (!set) return
      Object.keys(set).forEach((output) => {
        const list = features[output] || (features[output] = [])
        set[output].forEach((feature) => list.push(feature))
      })
    }

    const total = channels[0].length
    const padded = channels.map(() => new Float32Array(blockSize))
    const started = performance.now()
    let start = 0
    do {
      const end = start + blockSize
      const block = channels.map((data, c) => {
        if (end <= total) return data.subarray(start, end)
        padded[c].fill(0)
        padded[c].set(data.subarray(start, total))
        return padded[c]
      })
      collect(host.process(block, start / sampleRate))
      start += stepSize
    } while (start - stepSize + blockSize < total)
    collect(host.getRemainingFeatures())

    return { key, features, blockSize, stepSize, elapsedMs: performance.now() - started }
  })
}

onmessage = async ({ data }) => {
  try {
    await ready
    switch (data.type) {
    case 'describe':
      postMessage({ type: 'described', gen: data.gen, sampleRate: data.sampleRate, plugins: describe(data.sampleRate) })
      break
    case 'audio':
      audio = { sampleRate: data.sampleRate, channels: data.channels }
      audioGen = data.gen
      break
    case 'run':
      if (data.gen !== audioGen) return
      postMessage(Object.assign({ type: 'result', id: data.id }, run(data.key, data.params)))
      break
    }
  } catch (err) {
    postMessage({ type: 'error', id: data.id, key: data.key, message: err.message || String(err) })
  }
}
