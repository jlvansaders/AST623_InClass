"""
Download a Kepler short-cadence light curve and write the compact data files
the website loads (light curve + power spectrum as little-endian float32).

Usage (from the repo root):
    python scripts/prepare_data.py                      # default target
    python scripts/prepare_data.py --target "KIC 10963065" --slug kic10963065

Outputs go to data/<slug>/:
    meta.json       metadata (target, cadence, array lengths, frequency grid)
    lc_time.f32     time in days, relative to the first cadence
    lc_flux.f32     relative flux in ppm (high-pass filtered)
    psd_power.f32   power spectral density in ppm^2/uHz on a uniform grid
                    f = f0 + i*df  (f0, df in meta.json, uHz)

Requires: lightkurve, astropy, numpy.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import lightkurve as lk
import astropy.units as u

REPO = Path(__file__).resolve().parents[1]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--target", default="KIC 10963065")
    p.add_argument("--slug", default="kic10963065")
    p.add_argument("--quarters", default=None,
                   help="comma-separated Kepler quarters to use (default: all)")
    p.add_argument("--flatten-days", type=float, default=1.0,
                   help="high-pass filter window in days (removes slow trends)")
    p.add_argument("--fmin", type=float, default=5.0, help="lowest PSD frequency, uHz")
    # Spectroscopic values pre-filled in the scaling-relations panel. Required for
    # every star; for the default star they are 6104 +/- 74 K and -0.2 +/- 0.1 dex.
    p.add_argument("--teff", type=float, nargs=2, metavar=("K", "ERR"), required=True,
                   help="effective temperature and its uncertainty, K (e.g. --teff 6104 74)")
    p.add_argument("--feh", type=float, nargs=2, metavar=("DEX", "ERR"), required=True,
                   help="[Fe/H] and its uncertainty, dex (e.g. --feh -0.2 0.1)")
    args = p.parse_args()

    sr = lk.search_lightcurve(args.target, mission="Kepler", exptime=60)
    if args.quarters:
        qs = {int(q) for q in args.quarters.split(",")}
        sr = sr[[int(m.split()[-1]) in qs for m in sr.table["mission"]]]
    print(sr)
    lcc = sr.download_all(quality_bitmask="default")

    # Normalise each month separately, then join.
    lc = lcc.stitch(lambda x: x.remove_nans().normalize())
    lc = lc.remove_nans()

    # High-pass filter: divide out trends longer than ~flatten_days.
    cadence_s = np.nanmedian(np.diff(lc.time.value)) * 86400.0
    window = int(args.flatten_days * 86400.0 / cadence_s) | 1  # must be odd
    lc = lc.flatten(window_length=window)
    lc = lc.remove_outliers(sigma=5)

    flux_ppm = (lc.flux.value - 1.0) * 1e6
    lc_ppm = lk.LightCurve(time=lc.time, flux=flux_ppm * u.dimensionless_unscaled)

    nyquist = 1e6 / (2.0 * cadence_s)  # uHz
    pg = lc_ppm.to_periodogram(normalization="psd",
                               minimum_frequency=args.fmin,
                               maximum_frequency=nyquist,
                               oversample_factor=1)
    freq = pg.frequency.to(u.uHz).value
    power = pg.power.value  # ppm^2 / uHz
    df = np.diff(freq)
    assert np.allclose(df, df[0], rtol=1e-6), "frequency grid is not uniform"

    out = REPO / "data" / args.slug
    out.mkdir(parents=True, exist_ok=True)
    t = lc.time.value
    t0 = t[0]
    (t - t0).astype("<f4").tofile(out / "lc_time.f32")
    flux_ppm.astype("<f4").tofile(out / "lc_flux.f32")
    power.astype("<f4").tofile(out / "psd_power.f32")

    span_days = float(t[-1] - t[0])
    meta = {
        "target": args.target,
        "mission": "Kepler",
        "cadence_s": round(float(cadence_s), 3),
        "n_lc": int(len(t)),
        "t0_bkjd": float(t0),
        "span_days": round(span_days, 3),
        "nyquist_uHz": round(float(nyquist), 3),
        "resolution_uHz": round(1e6 / (span_days * 86400.0), 5),
        "psd": {"f0": float(freq[0]), "df": float(df[0]), "n": int(len(freq)),
                "units": "ppm^2/uHz"},
        "flatten_days": args.flatten_days,
        "quarters": sorted({int(m.split()[-1]) for m in sr.table["mission"]}),
        "spectroscopy": {"teff_K": list(args.teff), "feh_dex": list(args.feh)},
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta, indent=2))
    for f in sorted(out.iterdir()):
        print(f"{f.name:16s} {f.stat().st_size/1e6:7.2f} MB")


if __name__ == "__main__":
    main()
