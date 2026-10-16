import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatTime, formatValue, outputRows } from '../src/format.js'

const info = {
  outputs: [
    { identifier: 'aci', name: 'ACI' },
    { identifier: 'aci_right', name: 'ACI (Right)' },
    { identifier: 'empty', name: 'Nothing' },
  ],
}
const features = { 0: [{ values: [1.5] }], 1: [{ values: [2.5] }], 2: [{ values: [] }] }

test('outputRows pairs right-hand outputs with left, skips empty ones', () => {
  assert.deepEqual(outputRows(info, features, 2), [{ id: 'aci', name: 'ACI', values: [1.5, 2.5] }])
})

test('outputRows leaves out right-hand outputs for one channel', () => {
  assert.deepEqual(outputRows(info, features, 1), [{ id: 'aci', name: 'ACI', values: [1.5] }])
})

test('formatValue and formatTime', () => {
  assert.equal(formatValue(1234.5678), '1234.6')
  assert.equal(formatValue(1.23456), '1.235')
  assert.equal(formatValue(0.123456), '0.1235')
  assert.equal(formatValue(NaN), 'NaN')
  assert.equal(formatTime(5.5), '0:05.50')
  assert.equal(formatTime(75.25), '1:15.25')
})
