// Cutting a region's audio out of a decoded recording

/**
 * The frames of a recording that a span of time covers, as [from, to). The span
 * is clamped to the recording, and widened to whole frames, so that a region
 * dragged to the edge of the waveform still gets its last sample.
 */
export function frameRange(start, end, sampleRate, length) {
  const a = Math.min(Math.max(0, Math.floor(start * sampleRate)), length)
  const b = Math.min(Math.max(a, Math.ceil(end * sampleRate)), length)
  return [a, b]
}

/**
 * A region's audio as a list of Float32Arrays, one per channel, copied so that
 * it can be handed to a worker. `channel` picks one channel by index; leave it
 * out for all of them. `buffer` is an AudioBuffer, or anything with
 * numberOfChannels, sampleRate, length and getChannelData().
 */
export function sliceRegion(buffer, start, end, channel) {
  const [from, to] = frameRange(start, end, buffer.sampleRate, buffer.length)
  const wanted = channel === undefined || channel === null
    ? Array.from({ length: buffer.numberOfChannels }, (_, c) => c)
    : [Math.min(Math.max(0, Math.floor(channel)), buffer.numberOfChannels - 1)]
  return {
    sampleRate: buffer.sampleRate,
    channels: wanted.map((c) => buffer.getChannelData(c).slice(from, to)),
  }
}
