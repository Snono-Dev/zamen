const DSP = (() => {

  function mixToMono(audioBuffer) {
    const ch = audioBuffer.numberOfChannels;
    if (ch === 1) return audioBuffer.getChannelData(0).slice();
    const len = audioBuffer.length;
    const out = new Float32Array(len);
    for (let c = 0; c < ch; c++) {
      const data = audioBuffer.getChannelData(c);
      for (let i = 0; i < len; i++) out[i] += data[i];
    }
    const inv = 1 / ch;
    for (let i = 0; i < len; i++) out[i] *= inv;
    return out;
  }

  // Find first/last audible sample using RMS windows.
  // Returns {start, end} sample indices or null when the file is fully silent.
  function detectContentBounds(x, sampleRate, thresholdDb) {
    const thr = Math.pow(10, thresholdDb / 20);
    const win = Math.max(64, Math.round(sampleRate * 0.03));
    const hop = Math.max(32, Math.round(win / 3));
    let first = -1, last = -1;
    const nWin = Math.max(1, Math.floor((x.length - win) / hop) + 1);
    for (let w = 0; w < nWin; w++) {
      const off = w * hop;
      const end = Math.min(x.length, off + win);
      let sum = 0;
      for (let i = off; i < end; i++) sum += x[i] * x[i];
      const rms = Math.sqrt(sum / Math.max(1, end - off));
      if (rms > thr) { if (first < 0) first = w; last = w; }
    }
    if (first < 0) return null;
    return {
      start: first * hop,
      end: Math.min(x.length, last * hop + win)
    };
  }

  /* ---------- FFT (iterative radix-2, in-place) ---------- */

  function fftInPlace(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j |= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      const half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < half; k++) {
          const ur = re[i + k], ui = im[i + k];
          const xr = re[i + k + half], xi = im[i + k + half];
          const vr = xr * cr - xi * ci;
          const vi = xr * ci + xi * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + half] = ur - vr; im[i + k + half] = ui - vi;
          const ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = ncr;
        }
      }
    }
  }

  function inverseFftInPlace(re, im) {
    fftInPlace(im, re); // swap trick
    const n = re.length, inv = 1 / n;
    for (let i = 0; i < n; i++) { re[i] *= inv; im[i] *= inv; }
  }

  function nextPow2(n) {
    let p = 1;
    while (p < n) p <<= 1;
    return p;
  }

  const tick = () => new Promise(r => setTimeout(r, 0));

  /* ---------- Pre-processing for cross-device matching ---------- */

  function prepareForMatch(x, sr) {
    const out = new Float32Array(x.length);
    const hpCoeff = Math.exp(-2 * Math.PI * 50 / sr);
    let prev = 0;
    for (let i = 0; i < x.length; i++) {
      prev = prev * hpCoeff + x[i] - (i ? x[i - 1] : 0);
      out[i] = prev;
    }
    let sum = 0;
    for (let i = 0; i < out.length; i++) sum += out[i] * out[i];
    const rms = Math.sqrt(sum / out.length) || 1;
    for (let i = 0; i < out.length; i++) out[i] /= rms;
    return out;
  }

  /* ---------- Resampling ---------- */

  async function resample(x, srFrom, srTo) {
    if (srFrom === srTo) return x;
    try {
      const len = Math.max(1, Math.ceil(x.length * srTo / srFrom));
      const ctx = new OfflineAudioContext(1, len, srTo);
      const buf = ctx.createBuffer(1, x.length, srFrom);
      buf.copyToChannel(x, 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();
      const rendered = await ctx.startRendering();
      return rendered.getChannelData(0);
    } catch (e) {
      // naive fallback decimation
      const ratio = srFrom / srTo;
      const len = Math.floor(x.length / ratio);
      const out = new Float32Array(len);
      for (let i = 0; i < len; i++) out[i] = x[Math.floor(i * ratio)];
      return out;
    }
  }

  /* ---------- Normalized cross-correlation via FFT ----------
     Locates frag inside ref. Returns {index, score} where index is the
     sample offset in `ref` where `frag` best matches and score is the
     normalized correlation in [0..1]. */

  async function findInReference(ref, frag, onProgress) {
    const N = ref.length, M = frag.length;
    if (M > N) throw new Error("FRAG_LONGER");

    // normalize fragment: remove mean, unit energy
    let mean = 0;
    for (let i = 0; i < M; i++) mean += frag[i];
    mean /= M;
    let fe = 0;
    const fragN = new Float32Array(M);
    for (let i = 0; i < M; i++) {
      const v = frag[i] - mean;
      fragN[i] = v;
      fe += v * v;
    }
    fe = Math.sqrt(fe) || 1e-12;

    // prefix sums of ref for windowed energy normalization
    const ps = new Float64Array(N + 1);
    const psq = new Float64Array(N + 1);
    for (let i = 0; i < N; i++) {
      ps[i + 1] = ps[i] + ref[i];
      psq[i + 1] = psq[i] + ref[i] * ref[i];
    }

    const B = Math.min(nextPow2(Math.max(M * 4, 1 << 15)), 1 << 21);
    const step = B - M + 1;

    // pre-FFT of fragment (conjugated spectrum kept)
    const fre = new Float32Array(B), fim = new Float32Array(B);
    fre.set(fragN);
    fftInPlace(fre, fim);

    const bre = new Float32Array(B), bim = new Float32Array(B);

    let best = -Infinity, bestIdx = -1;
    const totalBlocks = Math.ceil(N / step);

    for (let b = 0, bi = 0; b < N; b += step, bi++) {
      bre.fill(0); bim.fill(0);
      const end = Math.min(N, b + B);
      bre.set(ref.subarray(b, end));
      fftInPlace(bre, bim);

      // conj multiply: F_block * conj(F_frag)
      for (let i = 0; i < B; i++) {
        const ar = bre[i], ai = bim[i];
        bre[i] = ar * fre[i] + ai * fim[i];
        bim[i] = ai * fre[i] - ar * fim[i];
      }
      inverseFftInPlace(bre, bim); // correlation now in bre

      const maxLag = Math.min(B - M, N - M - b);
      for (let lag = 0; lag <= maxLag; lag++) {
        const L = b + lag;
        if (L + M > N || L < 0) continue;
        const num = bre[lag];
        const s = ps[L + M] - ps[L];
        const q = psq[L + M] - psq[L];
        const varSum = q - (s * s) / M;
        if (varSum <= 1e-12) continue;
        const denom = Math.sqrt(varSum) * fe;
        const v = num / denom;
        if (v > best) { best = v; bestIdx = L; }
      }

      if (onProgress) onProgress((bi + 1) / totalBlocks);
      if ((bi & 3) === 3) await tick(); // yield to UI every few blocks
    }

    const score = Math.max(0, Math.min(1, best));
    return { index: bestIdx, score };
  }

  /* Detect internal silence gaps (> minGapSec) that are NOT at the very
     start or end. Returns [{start, end}] in sample indices, sorted. */
  function detectGaps(x, sr, minGapSec) {
    const thr = Math.pow(10, -50 / 20);
    const win = Math.max(64, Math.round(sr * 0.03));
    const hop = Math.max(32, Math.round(win / 3));
    const minGapSamples = Math.round(minGapSec * sr);
    const edges = [];

    let inSilence = false, silenceStart = 0;
    const nWin = Math.max(1, Math.floor((x.length - win) / hop) + 1);
    for (let w = 0; w < nWin; w++) {
      const off = w * hop;
      const end = Math.min(x.length, off + win);
      let sum = 0;
      for (let i = off; i < end; i++) sum += x[i] * x[i];
      const rms = Math.sqrt(sum / Math.max(1, end - off));

      if (rms <= thr) {
        if (!inSilence) { inSilence = true; silenceStart = off; }
      } else {
        if (inSilence) {
          const gapLen = off - silenceStart;
          if (gapLen >= minGapSamples && silenceStart > sr && off < x.length - sr) {
            edges.push({ start: silenceStart, end: off });
          }
          inSilence = false;
        }
      }
    }
    return edges;
  }

  return { mixToMono, detectContentBounds, detectGaps, prepareForMatch, resample, findInReference };
})();

if (typeof module !== "undefined" && module.exports) module.exports = DSP;
