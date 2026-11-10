# wavesurfer-analyse-region

A [wavesurfer.js](https://wavesurfer.xyz) plugin that runs the acoustic indices of [vamp-ecoacoustics](https://github.com/edwbaker/vamp-ecoacoustics) (or any other [Vamp](https://vamp-plugins.org) plugins) on the regions of a recording. Draw, move or resize a region and the indices for the audio under it are computed in the browser and listed under the waveform.

It works with wavesurfer.js's own Regions plugin (7.10.1 or later).

## Demo

The demo loads wavesurfer.js from [cdn.audioblast.org](https://cdn.audioblast.org), and the Vamp host and the vamp-ecoacoustics plugins from it too (`vamp-wasm/` and `vamp-ecoacoustics/<version>/`). To try local builds instead, give directories ending in a slash: `demo/?lib=<url>&host=<url>`. `npm run serve` serves a [vamp-ecoacoustics](https://github.com/edwbaker/vamp-ecoacoustics) checkout next to this repository (or at `VAMP_ECOACOUSTICS_DIR`) at `/vamp-ecoacoustics/`, so `?lib=/vamp-ecoacoustics/demo/&host=/vamp-ecoacoustics/demo/` uses its `sh demo/build.sh` output.

```bash
npm install
npm run serve
```

Then open http://localhost:8802/demo/. The page has to be served over HTTP.

## Use

The plugin does not load the Vamp host itself. A *runner* does, and a browser needs the host in a Web Worker, because it cannot compile a plugin on the main thread. The demo's [`worker.js`](demo/worker.js) is one; `createWorkerRunner()` talks to it.

```js
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'
import AnalyseRegion, { createWorkerRunner } from 'wavesurfer-analyse-region'

const regions = RegionsPlugin.create()
const analyse = AnalyseRegion.create({
  regions,
  runner: createWorkerRunner(new Worker('worker.js')),
  indices: ['aci-acc', 'ndsi'],
  params: { ndsi: { bioMin: 2000 } },
})
// wavesurfer.js decodes at 8 kHz unless it is given a sample rate, so give it
// the recording's own, or the indices only see the sound below 4 kHz
const wavesurfer = WaveSurfer.create({ container: '#waveform', sampleRate: 44100, plugins: [regions, analyse] })
regions.enableDragSelection({ color: 'rgba(29, 111, 82, 0.3)' })

analyse.on('result', (region, result) => console.log(region.id, result.indices))
```

With a `<script>` tag, the plugin is `WaveSurfer.AnalyseRegion`, with `WaveSurfer.AnalyseRegion.createWorkerRunner`, from `dist/analyse-region.min.js`, loaded after wavesurfer.js and its Regions plugin.

### Options

| Option | Default | |
|---|---|---|
| `regions` | | A Regions plugin whose regions are analysed (required) |
| `runner` | | How indices are computed (required): see below |
| `indices` | all | Identifiers of the indices to compute, such as `['aci', 'ndsi']` |
| `params` | `{}` | Parameters by index identifier |
| `channel` | `0` | Channel to analyse, by index; `null` for every channel |
| `auto` | `true` | Analyse a region when it is made, moved or resized |
| `debounce` | `300` | Milliseconds to wait after a region last changed |
| `minDuration` | `0.01` | Seconds a region must last to be analysed |
| `container` | | An element to show results in; by default a panel after the waveform |

### Methods and events

- `analyse(region)` analyses a region now, and resolves to its result: `{id, start, end, duration, indices: [{identifier, name, outputs: [{id, name, values}], elapsedMs}]}`. An index that failed has `error` instead of `outputs`. It resolves to `undefined` if the region changed or was removed while it ran.
- `analyseAll()`, `setIndices(identifiers)`, `setParams(params)`, `getResult(region)`, `availableIndices()`.
- Events: `analysing` (region), `result` (region, result), `error` (region, error).

Analysing a region again while it is running supersedes the first run, and only the newest result is shown.

### Runners

A runner is any object with

```js
describe(sampleRate)                          // Promise of [{key, identifier, name, parameters, outputs, ...}]
run({ key, sampleRate, channels, params })    // Promise of {features, elapsedMs, ...}
```

- `createWorkerRunner(worker)` for a Worker that speaks the protocol of [`demo/worker.js`](demo/worker.js).
- `createHostRunner(createHost, keys)` for a [vamp-wasm](https://github.com/edwbaker/vamp-wasm) host in the current thread, such as in Node or inside a worker of your own.

Blocks are passed to each plugin the way ReVAMP's `runPlugin()` passes them, so values match R's.

## Development

```bash
npm test          # unit tests, with no browser or wavesurfer.js needed
npm run build     # dist/analyse-region.js (ESM) and dist/analyse-region.min.js (UMD)
npm run check
```

## Licence

MIT, except demo/audio.js and demo/worker.js, which come from vamp-ecoacoustics (GPL ≥ 2) and are not part of the plugin. The vamp-ecoacoustics plugins it runs are GPL (&ge; 2), and are loaded separately.

Maintained by [Ed Baker](https://ebaker.me.uk). Part of [acousti.cloud](https://acousti.cloud/).
