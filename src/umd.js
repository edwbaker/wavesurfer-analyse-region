// The entry for the UMD build, which has one export to give: the plugin, with
// the runner makers on it, attached to the page as WaveSurfer.AnalyseRegion
import AnalyseRegionPlugin, { createHostRunner, createWorkerRunner } from './analyse-region.js'

AnalyseRegionPlugin.createHostRunner = createHostRunner
AnalyseRegionPlugin.createWorkerRunner = createWorkerRunner

export default AnalyseRegionPlugin
