/**
 * Analyse Region plugin for wavesurfer.js.
 *
 * Runs the acoustic indices of vamp-ecoacoustics (or any other Vamp plugins) on
 * the regions of a recording: when a region is drawn, moved or resized, the
 * audio under it is cut out and handed to a runner, which computes the indices
 * and returns their values. They are listed in a panel under the waveform, and
 * given to the page as events.
 *
 * The plugin does not load the Vamp host itself. A runner does, and a browser
 * needs it in a Web Worker: see createWorkerRunner() and createHostRunner().
 *
 * It runs in the browsers wavesurfer.js 7 runs in without a transpiler, so it
 * has no class fields and no `??=`.
 */
import WaveSurfer from 'wavesurfer.js'
import { formatTime, formatValue, outputRows } from './format.js'
import { sliceRegion } from './region.js'

const BasePlugin = WaveSurfer && WaveSurfer.BasePlugin
if (!BasePlugin) throw new Error('wavesurfer-analyse-region needs wavesurfer.js 7.10.1 or later, loaded before it')

const DEFAULTS = {
  /** A Regions plugin whose regions are analysed (required) */
  regions: null,
  /** How indices are computed: see runners.js (required) */
  runner: null,
  /** Identifiers of the indices to compute, such as ['aci', 'ndsi']; all of the runner's if left out */
  indices: null,
  /** Parameters for the indices, by identifier: {ndsi: {bioMin: 2000}} */
  params: {},
  /** The channel to analyse, by index; null for every channel */
  channel: 0,
  /** Whether to analyse a region when it is made, moved or resized */
  auto: true,
  /** Milliseconds to wait after a region last changed before analysing it */
  debounce: 300,
  /** Seconds a region must last to be analysed */
  minDuration: 0.01,
  /** An element to show results in; by default a panel after the waveform */
  container: null,
}

const STYLE_ID = 'wavesurfer-analyse-region-style'
const STYLE = [
  '.war-panel{font:14px/1.45 system-ui,sans-serif;color:inherit;margin-top:12px}',
  '.war-empty{opacity:.7;margin:0}',
  '.war-region{border:1px solid rgba(128,128,128,.35);border-radius:6px;margin:0 0 8px;padding:8px 12px}',
  '.war-region.war-running{opacity:.6}',
  '.war-region h4{margin:0 0 4px;font-size:.95em;display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}',
  '.war-range{font-weight:400;opacity:.7;font-variant-numeric:tabular-nums}',
  '.war-table{border-collapse:collapse;width:100%}',
  '.war-table th{text-align:left;font-weight:600;padding:2px 12px 2px 0;white-space:nowrap}',
  '.war-table td{padding:2px 12px 2px 0;font-variant-numeric:tabular-nums}',
  '.war-table td.war-name{opacity:.7}',
  '.war-error{color:#b42318}',
].join('')

// The parts of an element a result is shown with, made with textContent so that
// nothing a plugin reports is read as markup
function element(tag, className, text) {
  const el = document.createElement(tag)
  if (className) el.className = className
  if (text !== undefined) el.textContent = text
  return el
}

class AnalyseRegionPlugin extends BasePlugin {
  /**
   * @param {object} options
   * @param {object} options.regions a Regions plugin whose regions are analysed
   * @param {object} options.runner how indices are computed (see runners.js)
   * @param {string[]} [options.indices] identifiers of the indices to compute
   * @param {object} [options.params] parameters by index identifier
   * @param {number|null} [options.channel] channel to analyse; null for all
   * @param {boolean} [options.auto] analyse regions as they change
   * @param {number} [options.debounce] milliseconds to wait after a change
   * @param {number} [options.minDuration] seconds a region must last to be analysed
   * @param {HTMLElement} [options.container] where to show results
   */
  static create(options) {
    return new AnalyseRegionPlugin(options)
  }

  constructor(options) {
    super(Object.assign({}, DEFAULTS, options))
    if (!this.options.regions) throw new Error('wavesurfer-analyse-region needs a Regions plugin in the regions option')
    if (!this.options.runner) throw new Error('wavesurfer-analyse-region needs a runner option')
    this.results = new Map() // region id -> {region, status, indices, ...}
    this.timers = new Map()  // region id -> debounce timer
    this.runs = new Map()    // region id -> number of its latest analysis
    this.infos = null        // the runner's indices, once described
    this.infosRate = 0
    this.nextRun = 1
    this.panel = null
    this.ownsPanel = false
  }

  onInit() {
    if (!this.wavesurfer) throw Error('WaveSurfer is not initialized')
    const regions = this.options.regions
    this.subscriptions.push(
      regions.on('region-created', (region) => this.changed(region)),
      regions.on('region-updated', (region) => this.changed(region)),
      regions.on('region-removed', (region) => this.removed(region)),
      this.wavesurfer.on('load', () => this.clear()),
    )
    this.ensurePanel()
    this.render()
    // Regions that were made before the plugin was
    if (this.options.auto) regions.getRegions().forEach((region) => this.changed(region))
  }

  destroy() {
    this.timers.forEach((timer) => clearTimeout(timer))
    this.timers.clear()
    this.runs.clear()
    if (this.panel && this.ownsPanel) this.panel.remove()
    else if (this.panel) this.panel.replaceChildren()
    this.panel = null
    super.destroy()
  }

  // ---- Public ---------------------------------------------------------------

  /** The indices the runner offers for the recording's sample rate: [{identifier, name, ...}] */
  async availableIndices() {
    return (await this.describe()).map((info) => ({
      identifier: info.identifier, name: info.name, description: info.description, parameters: info.parameters,
    }))
  }

  /** Chooses the indices to compute, by identifier, and analyses the regions again */
  setIndices(identifiers) {
    this.options.indices = identifiers && identifiers.slice()
    this.analyseAll()
  }

  /** Sets parameters for the indices, by identifier, and analyses the regions again */
  setParams(params) {
    this.options.params = params || {}
    this.analyseAll()
  }

  /** The latest result for a region, or undefined */
  getResult(region) {
    const entry = this.results.get(typeof region === 'string' ? region : region.id)
    return entry && entry.status === 'done' ? this.publicResult(entry) : undefined
  }

  /** Analyses every region again */
  analyseAll() {
    return Promise.all(this.options.regions.getRegions().map((region) => this.analyse(region)))
  }

  /**
   * Analyses a region now. Resolves to {id, start, end, duration, indices: [{identifier,
   * name, outputs: [{id, name, values}], elapsedMs}]}, with a failed index given
   * as {identifier, name, error}; or to undefined if the region changed or went
   * while it was running, or is too short.
   */
  async analyse(region) {
    const wavesurfer = this.wavesurfer
    const buffer = wavesurfer && wavesurfer.getDecodedData()
    if (!buffer) return undefined
    clearTimeout(this.timers.get(region.id))
    this.timers.delete(region.id)

    const start = region.start
    const end = region.end
    if (end - start < this.options.minDuration) {
      this.results.delete(region.id)
      this.render()
      return undefined
    }

    const run = this.nextRun++
    this.runs.set(region.id, run)
    const entry = { region, start, end, status: 'running', indices: [], channels: 0 }
    const previous = this.results.get(region.id)
    if (previous) entry.indices = previous.indices // shown, dimmed, until the new values come
    this.results.set(region.id, entry)
    this.render()
    this.emit('analysing', region)

    try {
      const infos = this.chosen(await this.describe(buffer.sampleRate))
      const audio = sliceRegion(buffer, start, end, this.options.channel)
      entry.channels = audio.channels.length
      const indices = []
      for (const info of infos) {
        if (this.runs.get(region.id) !== run) return undefined
        try {
          const result = await this.options.runner.run({
            key: info.key, sampleRate: audio.sampleRate, channels: audio.channels,
            params: this.options.params[info.identifier] || {},
          })
          indices.push({
            identifier: info.identifier, name: info.name, elapsedMs: result.elapsedMs,
            outputs: outputRows(info, result.features, audio.channels.length),
          })
        } catch (error) {
          indices.push({ identifier: info.identifier, name: info.name, error: error.message || String(error) })
        }
      }
      if (this.runs.get(region.id) !== run) return undefined
      entry.indices = indices
      entry.status = 'done'
      this.render()
      const result = this.publicResult(entry)
      this.emit('result', region, result)
      return result
    } catch (error) {
      if (this.runs.get(region.id) !== run) return undefined
      entry.status = 'error'
      entry.error = error.message || String(error)
      this.render()
      this.emit('error', region, error)
      return undefined
    }
  }

  // ---- Workings -------------------------------------------------------------

  async describe(sampleRate) {
    const buffer = this.wavesurfer && this.wavesurfer.getDecodedData()
    const rate = sampleRate || (buffer && buffer.sampleRate) || 44100
    // Frequency limits and some block sizes depend on the sample rate
    if (!this.infos || this.infosRate !== rate) {
      this.infos = await this.options.runner.describe(rate)
      this.infosRate = rate
    }
    return this.infos
  }

  chosen(infos) {
    const wanted = this.options.indices
    return wanted ? wanted.map((id) => infos.find((info) => info.identifier === id)).filter(Boolean) : infos
  }

  publicResult(entry) {
    return {
      id: entry.region.id, start: entry.start, end: entry.end, duration: entry.end - entry.start,
      indices: entry.indices,
    }
  }

  changed(region) {
    if (!this.options.auto) return
    clearTimeout(this.timers.get(region.id))
    this.timers.set(region.id, setTimeout(() => {
      this.timers.delete(region.id)
      this.analyse(region)
    }, this.options.debounce))
  }

  removed(region) {
    clearTimeout(this.timers.get(region.id))
    this.timers.delete(region.id)
    this.runs.delete(region.id)
    this.results.delete(region.id)
    this.render()
  }

  clear() {
    this.timers.forEach((timer) => clearTimeout(timer))
    this.timers.clear()
    this.runs.clear()
    this.results.clear()
    this.infos = null
    this.render()
  }

  // ---- Panel ----------------------------------------------------------------

  ensurePanel() {
    if (!document.getElementById(STYLE_ID)) {
      const style = element('style')
      style.id = STYLE_ID
      style.textContent = STYLE
      document.head.appendChild(style)
    }
    const given = this.options.container
    if (given) {
      this.panel = given
    } else {
      const host = this.wavesurfer.options.container
      const anchor = typeof host === 'string' ? document.querySelector(host) : host
      this.panel = element('div')
      this.ownsPanel = true
      anchor.insertAdjacentElement('afterend', this.panel)
    }
    this.panel.classList.add('war-panel')
  }

  render() {
    if (!this.panel) return
    const entries = Array.from(this.results.values()).sort((a, b) => a.start - b.start)
    if (!entries.length) {
      this.panel.replaceChildren(element('p', 'war-empty', 'Draw a region on the waveform to analyse it.'))
      return
    }
    this.panel.replaceChildren.apply(this.panel, entries.map((entry) => this.renderEntry(entry)))
  }

  renderEntry(entry) {
    const section = element('section', 'war-region' + (entry.status === 'running' ? ' war-running' : ''))
    const label = entry.region.content && entry.region.content.textContent
    const heading = element('h4', '', label || 'Region')
    heading.appendChild(element('span', 'war-range',
      formatTime(entry.start) + ' – ' + formatTime(entry.end) + ' (' + (entry.end - entry.start).toFixed(2) + ' s)'))
    section.appendChild(heading)

    if (entry.status === 'error') {
      section.appendChild(element('p', 'war-error', entry.error))
      return section
    }
    const table = element('table', 'war-table')
    entry.indices.forEach((index) => {
      const row = element('tr')
      row.appendChild(element('th', '', index.name))
      if (index.error) {
        const cell = element('td', 'war-error', index.error)
        cell.colSpan = 2
        row.appendChild(cell)
      } else if (!index.outputs.length) {
        const cell = element('td', 'war-name', 'No output: the region may be too short')
        cell.colSpan = 2
        row.appendChild(cell)
      } else {
        const [main, ...rest] = index.outputs
        row.appendChild(element('td', '', main.values.map(formatValue).join(' · ')))
        row.appendChild(element('td', 'war-name', rest.map((o) => o.name + ' ' + o.values.map(formatValue).join(' · ')).join('   ')))
      }
      table.appendChild(row)
    })
    section.appendChild(table)
    return section
  }
}

export default AnalyseRegionPlugin
export { createHostRunner, createWorkerRunner } from './runners.js'
