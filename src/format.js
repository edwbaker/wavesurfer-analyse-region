// Turning a plugin's features into rows to show

/**
 * One row per output that has a value: {id, name, values}, with a value for each
 * channel. An output "x_right" joins "x" as the second channel; for audio of one
 * channel the right-hand outputs are left out.
 */
export function outputRows(info, features, channelCount) {
  const rows = []
  info.outputs.forEach((output, i) => {
    const values = (features[i] || []).filter((f) => f.values && f.values.length).map((f) => f.values[0])
    if (!values.length) return
    const right = /_right$/.test(output.identifier)
    if (right && channelCount < 2) return
    const left = right && rows.find((r) => r.id === output.identifier.slice(0, -'_right'.length))
    if (left) left.values.push(...values)
    else rows.push({ id: output.identifier, name: output.name.replace(/ \(Right\)$/, ''), values })
  })
  return rows
}

export function formatValue(v) {
  if (!Number.isFinite(v)) return String(v)
  const a = Math.abs(v)
  return a >= 1000 ? v.toFixed(1) : a >= 1 ? v.toFixed(3) : v.toFixed(4)
}

export function formatTime(s) {
  const m = Math.floor(s / 60)
  return m + ':' + (s - m * 60).toFixed(2).padStart(5, '0')
}
