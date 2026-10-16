import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHostRunner, createWorkerRunner } from '../src/runners.js'

// A worker that answers like demo/worker.js
function fakeWorker(options) {
  const failRun = options && options.failRun
  const listeners = []
  const sent = []
  let audio = null
  const reply = (data) => setTimeout(() => listeners.forEach((l) => l({ data })), 0)
  return {
    sent,
    addEventListener: (type, l) => listeners.push(l),
    postMessage(message) {
      sent.push(message.type)
      if (message.type === 'describe') reply({ type: 'described', gen: message.gen, plugins: [{ key: 'lib:aci', identifier: 'aci' }] })
      else if (message.type === 'audio') audio = message
      else if (message.type === 'run') {
        if (failRun) reply({ type: 'error', id: message.id, key: message.key, message: 'boom' })
        else reply({ type: 'result', id: message.id, key: message.key, features: { 0: [{ values: [audio.channels[0].length] }] } })
      }
    },
  }
}

test('worker runner describes and runs', async () => {
  const worker = fakeWorker()
  const runner = createWorkerRunner(worker)
  assert.deepEqual(await runner.describe(44100), [{ key: 'lib:aci', identifier: 'aci' }])
  const result = await runner.run({ key: 'lib:aci', sampleRate: 8000, channels: [new Float32Array(7)] })
  assert.equal(result.features[0][0].values[0], 7)
  assert.deepEqual(worker.sent, ['describe', 'audio', 'run'])
})

test('worker runner queues overlapping requests, in order', async () => {
  const runner = createWorkerRunner(fakeWorker())
  const [a, b] = await Promise.all([
    runner.run({ key: 'k', sampleRate: 1, channels: [new Float32Array(3)] }),
    runner.run({ key: 'k', sampleRate: 1, channels: [new Float32Array(5)] }),
  ])
  assert.equal(a.features[0][0].values[0], 3)
  assert.equal(b.features[0][0].values[0], 5)
})

test('worker runner rejects on an error, and carries on', async () => {
  const runner = createWorkerRunner(fakeWorker({ failRun: true }))
  await assert.rejects(runner.run({ key: 'k', sampleRate: 1, channels: [new Float32Array(1)] }), /boom/)
  assert.equal((await runner.describe(1)).length, 1)
})

test('host runner deletes each host it makes', async () => {
  let made = 0
  let deleted = 0
  const createHost = () => {
    made++
    return {
      loadPlugin: () => true,
      getPluginInfo: () => ({ name: 'ACI', preferredBlockSize: 2, preferredStepSize: 2, outputs: [] }),
      setParameter() {},
      initialise: () => true,
      process: () => ({ 0: [{ values: [1] }] }),
      getRemainingFeatures: () => null,
      delete: () => { deleted++ },
    }
  }
  const runner = createHostRunner(createHost, ['lib:aci'])
  const [info] = await runner.describe(8000)
  assert.equal(info.key, 'lib:aci')
  const result = await runner.run({ key: 'lib:aci', sampleRate: 8000, channels: [new Float32Array(4)] })
  assert.equal(result.features[0].length, 2)
  assert.equal(made, deleted)
  assert.equal(made, 2)
})
