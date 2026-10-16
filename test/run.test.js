import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blockSizes, runPlugin } from '../src/run.js'

// A host that records the blocks it is given and answers one feature per block
function fakeHost(info, options) {
  const accept = !options || options.accept !== false
  const calls = { blocks: [], params: {}, init: null }
  return {
    calls,
    loadPlugin: () => true,
    getPluginInfo: () => info,
    setParameter: (id, v) => { calls.params[id] = v },
    initialise: (channels, step, block) => { calls.init = [channels, step, block]; return accept },
    process: (block, t) => {
      calls.blocks.push({ length: block[0].length, first: block[0][0], last: block[0][block[0].length - 1], t })
      return { 0: [{ values: [calls.blocks.length] }] }
    },
    getRemainingFeatures: () => ({ 1: [{ values: [42] }] }),
  }
}

test('blockSizes follows ReVAMP', () => {
  assert.deepEqual(blockSizes({}), { blockSize: 1024, stepSize: 1024 })
  assert.deepEqual(blockSizes({ preferredBlockSize: 2048, inputDomain: 'frequency' }), { blockSize: 2048, stepSize: 1024 })
  assert.deepEqual(blockSizes({ preferredBlockSize: 512, preferredStepSize: 2048 }), { blockSize: 2048, stepSize: 2048 })
  assert.deepEqual(blockSizes({ preferredBlockSize: 512, preferredStepSize: 2048, inputDomain: 'frequency' }), { blockSize: 4096, stepSize: 2048 })
})

test('runPlugin feeds blocks, zero-pads the last, and collects features', () => {
  const host = fakeHost({ preferredBlockSize: 4, preferredStepSize: 4 })
  const data = Float32Array.from([1, 2, 3, 4, 5, 6])
  const result = runPlugin(host, 'lib:x', 8, [data], { a: 1 })
  assert.deepEqual(host.calls.init, [1, 4, 4])
  assert.deepEqual(host.calls.params, { a: 1 })
  assert.equal(host.calls.blocks.length, 2)
  assert.deepEqual(host.calls.blocks[1], { length: 4, first: 5, last: 0, t: 0.5 })
  assert.deepEqual(result.features[0].map((f) => f.values[0]), [1, 2])
  assert.deepEqual(result.features[1].map((f) => f.values[0]), [42])
  assert.equal(result.blockSize, 4)
})

test('runPlugin on exactly whole blocks makes no extra block', () => {
  const host = fakeHost({ preferredBlockSize: 4, preferredStepSize: 4 })
  runPlugin(host, 'lib:x', 8, [new Float32Array(8)], {})
  assert.equal(host.calls.blocks.length, 2)
})

test('runPlugin reports a plugin that refuses its settings', () => {
  const host = fakeHost({}, { accept: false })
  assert.throws(() => runPlugin(host, 'lib:x', 8, [new Float32Array(8), new Float32Array(8)], { a: 1 }), /refused.*2 channel/)
})
