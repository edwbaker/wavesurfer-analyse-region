// The demo: wavesurfer.js with a Regions plugin and this one, and a Vamp host
// running in a worker (worker.js).
import AnalyseRegion, { createWorkerRunner } from '../src/analyse-region.js'
import { synthesize, encodeWav, EXAMPLES } from './audio.js'

const $ = (selector) => document.querySelector(selector)
const status = $('#status')
const say = (text, kind) => {
  status.textContent = text
  status.dataset.kind = kind || 'info'
}

if (location.protocol === 'file:') {
  say('Browsers won’t run WebAssembly workers from file:// pages. Run `npm run serve` and open the address it prints.', 'error')
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
  for (const el of document.querySelectorAll('#file, [data-example]')) el.disabled = false
})

const PALETTE = ['rgba(26,106,134,0.3)', 'rgba(204,102,0,0.3)', 'rgba(70,90,200,0.3)', 'rgba(180,40,120,0.3)']
let regionCount = 0

function load(blob, name) {
  if (wavesurfer) wavesurfer.destroy()
  regionCount = 0
  regions = WaveSurfer.Regions.create()
  plugin = AnalyseRegion.create({ regions, runner, container: $('#results'), indices: checked() })
  wavesurfer = WaveSurfer.create({
    container: '#waveform',
    height: 128,
    waveColor: '#5aa8c0',
    progressColor: '#1a6a86',
    plugins: [regions, plugin, WaveSurfer.Spectrogram.create({ container: '#spectrogram', labels: true, height: 200, splitChannels: false })],
  })
  say('Decoding ' + name + '…')
  wavesurfer.on('error', (error) => say('Error: ' + error, 'error'))
  wavesurfer.on('decode', (duration) => {
    say('Loaded ' + name + '. Drag across the waveform to draw a region.', 'ready')
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
for (const button of document.querySelectorAll('[data-example]')) {
  button.addEventListener('click', () => {
    const kind = button.dataset.example
    load(encodeWav([synthesize(kind, 44100)], 44100), EXAMPLES[kind].file)
  })
}
$('#play').addEventListener('click', () => wavesurfer && wavesurfer.playPause())
$('#clear').addEventListener('click', () => regions && regions.clearRegions())
