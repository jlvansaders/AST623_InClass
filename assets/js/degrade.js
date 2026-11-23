// Degrade a light curve in the browser and recompute its power spectrum.
//
// Starting from the native data (time in days, flux in ppm, ~1-minute cadence):
//   1. keep only `days` of data from `start`         -> worse frequency resolution
//   2. add Gaussian white noise, `noisePpm` per point -> lower signal-to-noise
//   3. average every `binN` native cadences together  -> longer cadence, lower Nyquist
// then compute the power spectral density with an FFT on a uniform time grid
// (gaps are zero-filled). The output has the same shape as loadDataset(), so it
// plugs straight into the plotting functions in asteroplot.js.

/* ---------- reproducible Gaussian noise ---------- */

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One fixed standard-normal draw per native point, so moving the noise slider
// rescales the same noise rather than drawing new noise each time.
export function standardNormals(n, seed = 623) {
  const rand = mulberry32(seed), out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const u = Math.max(rand(), 1e-12), v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    out[i] = r * Math.cos(2 * Math.PI * v);
    if (i + 1 < n) out[i + 1] = r * Math.sin(2 * Math.PI * v);
  }
  return out;
}

/* ---------- FFT ---------- */

// In-place iterative radix-2 complex FFT (length a power of two).
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  const half = n >> 1, cos = new Float64Array(half), sin = new Float64Array(half);
  for (let k = 0; k < half; k++) { cos[k] = Math.cos(2 * Math.PI * k / n); sin[k] = Math.sin(2 * Math.PI * k / n); }
  for (let size = 2; size <= n; size <<= 1) {
    const h = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0, k = 0; j < h; j++, k += step) {
        const a = i + j, b = a + h;
        // multiply by exp(-2πi k/n)
        const tr = re[b] * cos[k] + im[b] * sin[k];
        const ti = im[b] * cos[k] - re[b] * sin[k];
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

// |X_k|^2 for k = 1..n/2 of a real series x (length n, a power of two),
// using one complex FFT of length n/2 on the packed even/odd samples.
function realPowerSpectrum(x) {
  const n = x.length, m = n >> 1;
  const re = new Float64Array(m), im = new Float64Array(m);
  for (let k = 0; k < m; k++) { re[k] = x[2 * k]; im[k] = x[2 * k + 1]; }
  fft(re, im);
  const out = new Float64Array(m); // out[k-1] = |X_k|^2, k = 1..m
  for (let k = 1; k <= m; k++) {
    const a = re[k % m], b = im[k % m], c = re[(m - k) % m], d = im[(m - k) % m];
    const Er = 0.5 * (a + c), Ei = 0.5 * (b - d);
    const Or = 0.5 * (b + d), Oi = -0.5 * (a - c);
    const th = 2 * Math.PI * k / n, cs = Math.cos(th), sn = Math.sin(th);
    const Xr = Er + Or * cs + Oi * sn, Xi = Ei + Oi * cs - Or * sn;
    out[k - 1] = Xr * Xr + Xi * Xi;
  }
  return out;
}

/* ---------- degrade + spectrum ---------- */

const firstAtOrAfter = (arr, x) => {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
};

// The longest stretch of data with no gap longer than `maxGap` days: [start, end].
export function longestSegment(time, maxGap = 2) {
  let best = [time[0], time[0]], s = 0;
  for (let i = 1; i <= time.length; i++) {
    if (i === time.length || time[i] - time[i - 1] > maxGap) {
      if (time[i - 1] - time[s] > best[1] - best[0]) best = [time[s], time[i - 1]];
      s = i;
    }
  }
  return best;
}

export function degrade(native, normals, { start = 0, days = Infinity, binN = 1, noisePpm = 0 } = {}) {
  const { time, flux, meta } = native;
  const dt = meta.cadence_s / 86400; // native cadence, days

  // 1. keep `days` of data beginning at `start` (all of it if days is Infinity)
  const iStart = Number.isFinite(days) ? firstAtOrAfter(time, start) : 0;
  const nEnd = Number.isFinite(days) ? firstAtOrAfter(time, time[iStart] + days) : time.length;
  const tRef = time[iStart];

  // 2 + 3. add noise, then average into bins of binN native cadences on a
  // uniform grid (grid slot = round(t / dt), so timing errors stay < half a cadence)
  const nBins = Math.floor(Math.round((time[nEnd - 1] - tRef) / dt) / binN) + 1;
  const sum = new Float64Array(nBins), tsum = new Float64Array(nBins), cnt = new Int32Array(nBins);
  for (let i = iStart; i < nEnd; i++) {
    const b = Math.floor(Math.round((time[i] - tRef) / dt) / binN);
    sum[b] += flux[i] + noisePpm * normals[i];
    tsum[b] += time[i];
    cnt[b]++;
  }
  // A bin counts if at least half its cadences have data.
  const minCount = Math.ceil(binN / 2);
  let nValid = 0, mean = 0;
  for (let b = 0; b < nBins; b++) if (cnt[b] >= minCount) { nValid++; mean += sum[b] / cnt[b]; }
  mean /= nValid;

  const lcTime = new Float32Array(nValid), lcFlux = new Float32Array(nValid);
  let M = 1; while (M < nBins) M <<= 1;
  const series = new Float64Array(M); // zero-filled gaps and padding
  let sq = 0;
  for (let b = 0, j = 0; b < nBins; b++) {
    if (cnt[b] < minCount) continue;
    const v = sum[b] / cnt[b] - mean;
    series[b] = v; sq += v * v;
    lcTime[j] = tsum[b] / cnt[b]; lcFlux[j] = v; j++;
  }

  // PSD in ppm^2/µHz on the grid f_k = k * df, normalised so that
  // sum(PSD * df) = variance of the light curve (Parseval). With this choice a
  // white-noise background has the same level however much of the span is gaps,
  // so changing the span doesn't shift the background. (lightkurve's 'psd'
  // normalisation is higher by 1/duty cycle for gappy data.)
  const cadence = binN * meta.cadence_s; // s
  const df = 1e6 / (M * cadence);        // µHz
  let first = 0, last = nBins - 1;
  while (cnt[first] < minCount) first++;
  while (cnt[last] < minCount) last--;
  const duty = nValid / (last - first + 1);
  const p2 = realPowerSpectrum(series);
  const scale = 2 / (M * nValid * df);
  // Start at the same lowest frequency as the precomputed spectrum (5 µHz): below
  // that the one-day high-pass filter has removed the signal anyway.
  const fMin = meta.psd?.f0 ?? 5;
  const k0 = Math.max(1, Math.ceil(fMin / df)); // first kept frequency index
  const power = new Float32Array(Math.max(0, p2.length - (k0 - 1)));
  for (let k = k0; k <= p2.length; k++) power[k - k0] = p2[k - 1] * scale;

  const span = lcTime[nValid - 1] - lcTime[0];
  return {
    time: lcTime, flux: lcFlux, power,
    meta: {
      ...meta,
      cadence_s: cadence,
      n_lc: nValid,
      span_days: span,
      nyquist_uHz: 1e6 / (2 * cadence),
      resolution_uHz: 1e6 / (span * 86400),
      rms_ppm: Math.sqrt(sq / nValid),
      duty_cycle: duty,
      psd: { f0: k0 * df, df, n: power.length, units: 'ppm^2/uHz' },
    },
  };
}
