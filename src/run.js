// Running a Vamp plugin over some audio, block by block

/**
 * The block and step sizes to give a plugin: its preferred ones, the way
 * ReVAMP's runPlugin() does, so that results match R's.
 */
export function blockSizes(info) {
  let blockSize = info.preferredBlockSize || 1024
  const frequency = info.inputDomain === 'frequency'
  const stepSize = info.preferredStepSize || (frequency ? blockSize / 2 : blockSize)
  if (stepSize > blockSize) blockSize = frequency ? stepSize * 2 : stepSize
  return { blockSize, stepSize }
}

/**
 * Runs one plugin on `channels` (Float32Arrays, equal in length) with a vamp-wasm
 * host, and returns {key, features, blockSize, stepSize, elapsedMs}, where
 * features maps each output's index to its list of features. The final partial
 * block is zero-padded.
 */
export function runPlugin(host, key, sampleRate, channels, params, now) {
  const clock = now || (() => Date.now())
  if (!host.loadPlugin(key)) throw new Error('Could not load ' + key)
  const { blockSize, stepSize } = blockSizes(host.getPluginInfo())
  Object.keys(params || {}).forEach((id) => host.setParameter(id, params[id]))
  if (!host.initialise(channels.length, stepSize, blockSize)) {
    throw new Error(key + ' refused these settings: ' + channels.length + ' channel(s), block size ' + blockSize
      + ', parameters ' + JSON.stringify(params || {}))
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
  const started = clock()
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

  return { key, features, blockSize, stepSize, elapsedMs: clock() - started }
}
