/*
    Ecoacoustic Vamp Plugins - browser demo: reading audio and synthesising examples

    (C) Ed Baker 2025. Licensed under GPL (>=2).
*/

// Decode a file to {sampleRate, channels: Float32Array[], note}. WAV is parsed
// here so it keeps its native sample rate; anything else goes to the browser.
export async function decodeAudio(buffer, name) {
    return parseWav(buffer) || decodeWithBrowser(buffer, name);
}

// PCM and float WAV (including WAVE_FORMAT_EXTENSIBLE), with integer samples
// scaled by 2^(bits-1) as tuneR and ReVAMP do
function parseWav(buffer) {
    const view = new DataView(buffer);
    const tag = o => String.fromCharCode(...new Uint8Array(buffer, o, 4));
    if (buffer.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;

    let fmt, data;
    for (let o = 12; o + 8 <= buffer.byteLength;) {
        const id = tag(o), size = view.getUint32(o + 4, true), body = o + 8;
        if (id === 'fmt ') {
            let format = view.getUint16(body, true);
            if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true);
            fmt = {
                format,
                channels: view.getUint16(body + 2, true),
                sampleRate: view.getUint32(body + 4, true),
                bits: view.getUint16(body + 14, true),
            };
        } else if (id === 'data') {
            // Recorders that stop abruptly can leave the size unset
            const complete = size > 0 && body + size <= buffer.byteLength;
            data = { offset: body, size: complete ? size : buffer.byteLength - body };
            if (!complete) break;
        }
        o = body + size + (size & 1);
    }
    if (!fmt || !data) throw new Error('WAV file has no fmt or data chunk');

    const read = {
        '1:8': o => (view.getUint8(o) - 128) / 128,
        '1:16': o => view.getInt16(o, true) / 32768,
        '1:24': o => (view.getUint8(o) | view.getUint8(o + 1) << 8 | view.getInt8(o + 2) << 16) / 8388608,
        '1:32': o => view.getInt32(o, true) / 2147483648,
        '3:32': o => view.getFloat32(o, true),
        '3:64': o => view.getFloat64(o, true),
    }[`${fmt.format}:${fmt.bits}`];
    // Encodings this parser doesn't read (mu-law, A-law, ADPCM and so on) go to the browser's decoder
    if (!read) return null;

    const bytes = fmt.bits / 8;
    const frames = Math.floor(data.size / (bytes * fmt.channels));
    const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
    for (let i = 0, o = data.offset; i < frames; i++) {
        for (let c = 0; c < fmt.channels; c++, o += bytes) channels[c][i] = read(o);
    }
    return { sampleRate: fmt.sampleRate, channels };
}

// The Web Audio API resamples to its context's rate, so decode in a context
// running at the file's own rate when the header tells us what that is
async function decodeWithBrowser(buffer, name) {
    const sampleRate = sniffSampleRate(new Uint8Array(buffer), name);
    let offline = null;
    try {
        if (sampleRate) offline = new OfflineAudioContext(1, 1, sampleRate);
    } catch {
        // rate outside what this browser supports
    }
    const context = offline || new AudioContext();
    try {
        const decoded = await context.decodeAudioData(buffer);
        return {
            sampleRate: decoded.sampleRate,
            channels: Array.from({ length: decoded.numberOfChannels }, (_, c) => decoded.getChannelData(c)),
            note: offline ? null : `Resampled by the browser to ${decoded.sampleRate} Hz`,
        };
    } finally {
        if (!offline) context.close();
    }
}

function sniffSampleRate(b, name) {
    // FLAC: the STREAMINFO block follows 'fLaC'; its sample rate is the 20 bits from byte 10
    if (String.fromCharCode(b[0], b[1], b[2], b[3]) === 'fLaC') {
        return (b[18] << 12 | b[19] << 4 | b[20] >> 4) || null;
    }
    // MP3: skip any ID3v2 tag, then read the first frame header
    const id3 = b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33;
    if (!id3 && !/\.mp3$/i.test(name)) return null;
    let o = id3 ? 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f)) : 0;
    for (const end = Math.min(b.length - 3, o + 8192); o < end; o++) {
        if (b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) continue;
        const version = b[o + 1] >> 3 & 3, layer = b[o + 1] >> 1 & 3;
        const bitrate = b[o + 2] >> 4, rate = b[o + 2] >> 2 & 3;
        if (version === 1 || layer === 0 || bitrate === 15 || rate === 3) continue;
        return [44100, 48000, 32000][rate] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    }
    return null;
}

// 16-bit PCM WAV, for playing and saving the synthetic examples
export function encodeWav(channels, sampleRate) {
    const frames = channels[0].length, n = channels.length, bytes = frames * n * 2;
    const view = new DataView(new ArrayBuffer(44 + bytes));
    const text = (o, s) => [...s].forEach((ch, i) => view.setUint8(o + i, ch.charCodeAt(0)));
    text(0, 'RIFF');
    view.setUint32(4, 36 + bytes, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, n, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * n * 2, true);
    view.setUint16(32, n * 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, bytes, true);
    for (let i = 0, o = 44; i < frames; i++) {
        for (let c = 0; c < n; c++, o += 2) {
            view.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(channels[c][i] * 32768))), true);
        }
    }
    return new Blob([view], { type: 'audio/wav' });
}

// ---- Synthetic soundscapes --------------------------------------------------

export const EXAMPLES = {
    chorus: { title: 'Dawn chorus', file: 'dawn-chorus.wav', seed: 11, birds: 30, insects: true, traffic: 0.02, passEvery: 14 },
    roadside: { title: 'Roadside', file: 'roadside.wav', seed: 5, birds: 5, insects: false, traffic: 0.6, passEvery: 3.5 },
};

function mulberry32(seed) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// RBJ band-pass biquad (0 dB peak gain)
function bandpass(sampleRate, freq, q) {
    const w = 2 * Math.PI * freq / sampleRate, alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha;
    const b0 = alpha / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - alpha) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    return x => {
        const y = b0 * (x - x2) - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        return y;
    };
}

// A note sweeping from f0 to f1 Hz, with optional vibrato, a raised-sine envelope and a weak second harmonic
function tone(out, sampleRate, start, duration, f0, f1, gain, vibrato = 0) {
    const i0 = Math.round(start * sampleRate), length = Math.round(duration * sampleRate);
    let phase = 0;
    for (let i = 0; i < length && i0 + i < out.length; i++) {
        const u = i / length;
        const f = f0 + (f1 - f0) * u + vibrato * Math.sin(2 * Math.PI * 35 * i / sampleRate);
        phase += 2 * Math.PI * f / sampleRate;
        out[i0 + i] += gain * Math.sin(Math.PI * u) ** 2 * (Math.sin(phase) + 0.2 * Math.sin(2 * phase));
    }
}

function birdSong(out, sampleRate, t, gain, rand) {
    const species = Math.floor(rand() * 3);
    if (species === 0) {            // slow, descending whistles
        for (let k = 0, notes = 3 + Math.floor(rand() * 3); k < notes; k++, t += 0.32) {
            tone(out, sampleRate, t, 0.2, 5200 - 150 * k, 3400 - 100 * k, gain);
        }
    } else if (species === 1) {     // fast trill
        for (let k = 0, notes = 12 + Math.floor(rand() * 10); k < notes; k++, t += 0.05) {
            tone(out, sampleRate, t, 0.035, 4400, 6600, gain * 0.8);
        }
    } else {                        // warble of scattered notes
        for (let k = 0, notes = 6 + Math.floor(rand() * 6); k < notes; k++) {
            const f = 2600 + 4000 * rand(), duration = 0.06 + 0.05 * rand();
            tone(out, sampleRate, t, duration, f, f * (0.85 + 0.3 * rand()), gain, 250);
            t += duration + 0.03;
        }
    }
}

// Pulsed calls at a fixed carrier frequency
function cricket(out, sampleRate, freq, period, pulses, gain, rand) {
    for (let t = rand() * period; t < out.length / sampleRate; t += period * (0.95 + 0.1 * rand())) {
        for (let p = 0; p < pulses; p++) tone(out, sampleRate, t + p * 0.035, 0.02, freq, freq, gain);
    }
}

// Mono soundscape: wind, traffic around 1 kHz, bird song and insects between
// 2.5 and 8 kHz. Samples are rounded to the 16-bit grid, so the saved WAV gives
// exactly the same results in ReVAMP as it does here.
export function synthesize(kind, sampleRate = 44100, seconds = 30) {
    const spec = EXAMPLES[kind];
    const rand = mulberry32(spec.seed);
    const noise = () => rand() * 2 - 1;
    const n = Math.round(seconds * sampleRate);
    const out = new Float32Array(n);

    let wind = 0;
    for (let i = 0; i < n; i++) {
        wind += (noise() - wind) * 0.01;
        out[i] = 0.25 * wind + 0.002 * noise();
    }

    // Traffic: steady distant roar, swelling as each vehicle passes (envelope at 100 Hz).
    // Two band-pass stages keep most of the tyre noise below 2 kHz.
    const envelope = new Float32Array(Math.ceil(seconds * 100) + 1).fill(0.15);
    for (let t = rand() * spec.passEvery; t < seconds + 3; t += spec.passEvery * (0.6 + 0.8 * rand())) {
        for (let k = 0; k < envelope.length; k++) envelope[k] += Math.exp(-(((k / 100 - t) / 1.5) ** 2));
    }
    const tyres = [bandpass(sampleRate, 1200, 1), bandpass(sampleRate, 1200, 1)];
    const engine = bandpass(sampleRate, 250, 1);
    for (let i = 0; i < n; i++) {
        const x = noise();
        out[i] += spec.traffic * envelope[Math.floor(i / sampleRate * 100)] * (tyres[1](tyres[0](x)) + 0.5 * engine(x));
    }

    for (let s = 0; s < spec.birds; s++) {
        birdSong(out, sampleRate, rand() * (seconds - 2.5), 0.03 + 0.12 * rand() ** 2, rand);
    }
    if (spec.insects) {
        cricket(out, sampleRate, 4700, 0.6, 3, 0.02, rand);
        cricket(out, sampleRate, 7300, 0.23, 1, 0.012, rand);
    }

    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
    for (let i = 0; i < n; i++) out[i] = Math.round(out[i] / peak * 0.89 * 32767) / 32768;
    return out;
}
