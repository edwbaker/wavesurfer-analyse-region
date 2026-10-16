import assert from 'node:assert/strict'
import { test } from 'node:test'
import { frameRange, sliceRegion } from '../src/region.js'

const buffer = (channels, sampleRate) => ({
  sampleRate,
  numberOfChannels: channels.length,
  length: channels[0].length,
  getChannelData: (c) => channels[c],
})

test('frameRange widens to whole frames and clamps to the recording', () => {
  assert.deepEqual(frameRange(0.25, 0.55, 10, 100), [2, 6])
  assert.deepEqual(frameRange(-1, 0.3, 10, 100), [0, 3])
  assert.deepEqual(frameRange(9, 12, 10, 100), [90, 100])
  assert.deepEqual(frameRange(20, 30, 10, 100), [100, 100])
  assert.deepEqual(frameRange(0.5, 0.2, 10, 100), [5, 5])
})

test('sliceRegion copies each channel', () => {
  const left = Float32Array.from({ length: 100 }, (_, i) => i)
  const right = Float32Array.from({ length: 100 }, (_, i) => -i)
  const out = sliceRegion(buffer([left, right], 10), 1, 2)
  assert.equal(out.sampleRate, 10)
  assert.equal(out.channels.length, 2)
  assert.deepEqual(Array.from(out.channels[0]), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
  assert.equal(out.channels[1][0], -10)
  out.channels[0][0] = 99
  assert.equal(left[10], 10, 'the recording is not changed')
})

test('sliceRegion picks one channel, and keeps the choice in range', () => {
  const left = new Float32Array(20).fill(1)
  const right = new Float32Array(20).fill(2)
  assert.equal(sliceRegion(buffer([left, right], 10), 0, 1, 1).channels[0][0], 2)
  assert.equal(sliceRegion(buffer([left, right], 10), 0, 1, 5).channels[0][0], 2)
  assert.equal(sliceRegion(buffer([left, right], 10), 0, 1, 0).channels.length, 1)
})
