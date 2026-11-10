// The demo: wavesurfer.js with a Regions plugin and this one, and a Vamp host
// running in a worker (worker.js).
import AnalyseRegion, { createWorkerRunner } from '../src/analyse-region.js'
import { synthesize, encodeWav, fileSampleRate, EXAMPLES } from './audio.js'

const $ = (selector) => document.querySelector(selector)
const status = $('#status')
const say = (text, kind) => {
  status.textContent = text
  status.dataset.kind = kind || 'info'
}

// The waveform's and the spectrogram's heights, which their places in the page
// are kept at while there is nothing in them
const WAVE_HEIGHT = 128
const SPEC_HEIGHT = 200
$('#viewer').style.setProperty('--wave-h', WAVE_HEIGHT + 'px')
$('#viewer').style.setProperty('--spec-h', SPEC_HEIGHT + 'px')

// What shows in the waveform's and the spectrogram's places until they are
// drawn: [kind, text] for each, kind being 'busy', 'error' or '' for a plain
// note, or null once there is something to see
function placeholders(wave, spec) {
  for (const [el, state] of [[$('#wave-state'), wave], [$('#spec-state'), spec]]) {
    el.hidden = !state
    if (!state) continue
    el.dataset.kind = state[0]
    el.firstElementChild.textContent = state[1]
  }
}
const EMPTY = ['', '']

if (location.protocol === 'file:') {
  say('Browsers won’t run WebAssembly workers from file:// pages. Run `npm run serve` and open the address it prints.', 'error')
  placeholders(['error', 'This page has to be served over HTTP'], EMPTY)
  throw new Error('file:// page')
}

// Where the Vamp host and the plugins come from: the audioBLAST! CDN, or, to
// try a local build, ?lib=<url>&host=<url> (directories, ending in a slash)
const CDN = 'https://cdn.audioblast.org/'
const query = new URLSearchParams(location.search)
const lib = query.get('lib') || CDN + 'vamp-ecoacoustics/0.2.5/'
const host = query.get('host') || CDN + 'vamp-wasm/0.1.4/'
const worker = new Worker('worker.js?' + new URLSearchParams({ lib, host }))
worker.onerror = (event) => {
  event.preventDefault()
  say('The Vamp host failed to start (' + (event.message || 'see the console') + '). Are ' + lib + ' and ' + host + ' reachable?', 'error')
  if (!hostReady) placeholders(['error', 'The Vamp host failed to start'], EMPTY)
}
const runner = createWorkerRunner(worker)

let wavesurfer = null
let plugin = null
let regions = null
let hostReady = false

const ready = new Promise((resolve) => {
  worker.addEventListener('message', function onReady({ data }) {
    if (data.type !== 'ready') return
    worker.removeEventListener('message', onReady)
    resolve(data.plugins.length)
  })
})
ready.then((count) => {
  hostReady = true
  say('Ready: ' + count + ' indices loaded. Choose a recording or try an example.', 'ready')
  placeholders(['', 'Choose a recording or try an example'], EMPTY)
  for (const el of document.querySelectorAll('#file, [data-example]')) el.disabled = false
})

const PALETTE = ['rgba(26,106,134,0.3)', 'rgba(204,102,0,0.3)', 'rgba(70,90,200,0.3)', 'rgba(180,40,120,0.3)']
let regionCount = 0
let loads = 0

const kHz = (rate) => rate / 1000 + ' kHz'

// wavesurfer.js decodes at 8 kHz unless it is given a sample rate, which cuts
// the spectrogram, and the audio the indices are computed from, off at 4 kHz.
// So decode at the file's own rate, or at the browser's if the header doesn't
// say or the browser can't decode at it.
async function decodingRate(blob, name) {
  const own = fileSampleRate(await blob.slice(0, 1 << 20).arrayBuffer(), name)
  let context
  try {
    context = new AudioContext(own ? { sampleRate: own } : {})
  } catch {
    context = new AudioContext()
  }
  const rate = context.sampleRate
  context.close()
  const note = !own ? 'decoded by the browser at ' + kHz(rate)
    : own !== rate ? 'resampled by the browser from ' + kHz(own) + ' to ' + kHz(rate)
    : kHz(rate)
  return { rate, note }
}

async function load(blob, name) {
  const ticket = ++loads
  if (wavesurfer) wavesurfer.destroy()
  wavesurfer = null
  say('Decoding ' + name + '…')
  placeholders(['busy', 'Decoding ' + name + '…'], EMPTY)
  const { rate, note } = await decodingRate(blob, name)
  if (ticket !== loads) return // another recording was chosen meanwhile
  regionCount = 0
  regions = WaveSurfer.Regions.create()
  plugin = AnalyseRegion.create({ regions, runner, container: $('#results'), indices: checked() })
  // A linear frequency scale, as the indices' bands are in Hz, and as it draws in
  // a tenth of the time the mel scale takes; computed in a worker, so that the
  // page keeps moving while it is
  const spectrogram = WaveSurfer.Spectrogram.create({
    container: '#spectrogram', labels: true, height: SPEC_HEIGHT, splitChannels: false, scale: 'linear', useWebWorker: true,
  })
  wavesurfer = WaveSurfer.create({
    container: '#waveform',
    height: WAVE_HEIGHT,
    waveColor: '#5aa8c0',
    progressColor: '#1a6a86',
    sampleRate: rate,
    plugins: [regions, plugin, spectrogram],
  })
  let decoded = false
  let drawn = false
  spectrogram.on('ready', () => {
    drawn = true
    placeholders(null, null)
  })
  wavesurfer.on('error', (error) => {
    say('Error: ' + error, 'error')
    if (!decoded) placeholders(['error', 'Couldn’t read ' + name], EMPTY)
  })
  wavesurfer.on('decode', (duration) => {
    decoded = true
    placeholders(null, drawn ? null : ['busy', 'Drawing the spectrogram…'])
    say('Loaded ' + name + ' (' + note + '). Drag across the waveform to draw a region.', 'ready')
    $('#play').disabled = false
    $('#clear').disabled = false
    // A first region to start with, so there is something to see
    regions.addRegion({ start: duration * 0.2, end: duration * 0.4, color: PALETTE[0], content: 'Region 1' })
    regionCount = 1
  })
  regions.enableDragSelection({ color: PALETTE[1] })
  regions.on('region-created', (region) => {
    if (region.content) return
    regionCount++
    region.setOptions({ content: 'Region ' + regionCount, color: PALETTE[(regionCount - 1) % PALETTE.length] })
  })
  plugin.on('analysing', () => say('Computing indices…'))
  plugin.on('result', (region, result) => {
    const ms = result.indices.reduce((total, index) => total + (index.elapsedMs || 0), 0)
    say('Done: ' + (region.content ? region.content.textContent : 'region') + ', ' + result.indices.length + ' indices in ' + Math.max(1, Math.round(ms)) + ' ms', 'ready')
  })
  wavesurfer.loadBlob(blob)
}

function checked() {
  const boxes = Array.from(document.querySelectorAll('#indices input'))
  return boxes.length ? boxes.filter((b) => b.checked).map((b) => b.value) : null
}

// The indices on offer come from the plugin once the host is up
ready.then(async () => {
  const infos = await runner.describe(44100)
  const order = ['aci-acc', 'aci', 'adi-acc', 'aei-acc', 'bi-acc', 'ndsi', 'h', 'sh', 'th']
  infos.sort((a, b) => (order.indexOf(a.identifier) + 1 || 99) - (order.indexOf(b.identifier) + 1 || 99))
  const fieldset = $('#indices')
  for (const info of infos) {
    const label = document.createElement('label')
    label.title = info.description
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.value = info.identifier
    box.checked = ['aci-acc', 'adi-acc', 'bi-acc', 'ndsi', 'h'].includes(info.identifier)
    label.append(box, info.identifier)
    fieldset.append(label)
  }
  fieldset.addEventListener('change', () => plugin && plugin.setIndices(checked()))
})

$('#file').addEventListener('change', (e) => {
  const file = e.target.files[0]
  if (file && hostReady) load(file, file.name)
})
// Lets the page draw what it was just told to before a long job holds it up
const repaint = () => new Promise((resolve) => {
  requestAnimationFrame(() => setTimeout(resolve))
  setTimeout(resolve, 100) // requestAnimationFrame waits while the tab is hidden
})

for (const button of document.querySelectorAll('[data-example]')) {
  button.addEventListener('click', async () => {
    const kind = button.dataset.example
    const name = EXAMPLES[kind].file
    say('Making ' + name + '…')
    placeholders(['busy', 'Making ' + name + '…'], EMPTY)
    await repaint()
    load(encodeWav([synthesize(kind, 44100)], 44100), name)
  })
}
$('#play').addEventListener('click', () => wavesurfer && wavesurfer.playPause())
$('#clear').addEventListener('click', () => regions && regions.clearRegions())
