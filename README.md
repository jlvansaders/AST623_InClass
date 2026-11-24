# AST 623 in-class asteroseismology exercises

A static website (plain HTML + [Plotly.js](https://plotly.com/javascript/)) with
interactive asteroseismology exercises built on Kepler photometry. No build step:
GitHub Pages serves the files as they are.

## Layout

```
index.html                      landing page: one button per exercise
exercises/power-spectrum/       Examining the Power Spectrum: light curve, PSD, ACF, échelle
exercises/detectability/        Understanding Detectability: shorten / rebin / add noise, live
assets/css/style.css            shared styles (light + dark mode)
assets/js/asteroplot.js         shared plotting code (loading, display binning, panels, ACF, échelle)
assets/js/degrade.js            in-browser degradation + FFT power spectrum (Detectability)
data/<target>/                  data files written by scripts/prepare_data.py
data/targets.json               the stars offered in "Pick your target" (slug + button label)
scripts/prepare_data.py         downloads Kepler data with lightkurve, writes data/<target>/
worksheet/worksheet.tex         student worksheet (all questions live here, not on the site)
```

## Regenerating or adding data

Needs `lightkurve`, `astropy` and `numpy`.

```bash
python scripts/prepare_data.py --teff 6104 74 --feh -0.2 0.1         # KIC 10963065, all quarters
python scripts/prepare_data.py --target "KIC 6116048" --slug kic6116048 --teff <K> <err> --feh <dex> <err>
python scripts/prepare_data.py --quarters 7 --slug kic10963065_q7 --teff 6104 74 --feh -0.2 0.1   # one quarter only
```

`--teff` and `--feh` are required for every star: they are stored in `meta.json`
under `spectroscopy` and pre-filled (value and uncertainty) in the
scaling-relations panel of *Examining the Power Spectrum*.

To offer the star in the "Pick your target" buttons at the top of both
exercises, add it to `data/targets.json` (`slug` = the `--slug` folder name,
`name` = the button label). Optional `acf` and `echelle` give each star's
starting frequency range (µHz) for the Detectability autocorrelation and the
échelle diagram; set them around the star's oscillation hump. The chosen star is kept in the page URL as
`?star=<slug>`; with no `?star`, the first star in the list is shown.

| Star | T<sub>eff</sub> (K) | [Fe/H] (dex) |
|---|---|---|
| KIC 10963065 | 6104 ± 74 | −0.2 ± 0.1 |
| KIC 8006161 | 5488 ± 77 | +0.34 ± 0.1 |
| KIC 9965715 | 5860 ± 180 | −0.44 ± 0.18 |
| KIC 11081729 | 6548 ± 82 | +0.11 ± 0.10 |

Each dataset is `meta.json` plus three little-endian float32 arrays: time (days),
flux (ppm, high-pass filtered over `--flatten-days`), and the PSD (ppm²/µHz) on a
uniform frequency grid from 5 µHz to Nyquist. An exercise page loads one with
`loadDataset('../../data/<slug>/')`.

## Previewing locally

The pages load data with `fetch`, so open them through a local server rather
than double-clicking the HTML file:

```bash
python3 scripts/serve.py
```

then visit <http://localhost:8623/>. This server turns browser caching off, so
edited JavaScript and CSS always load fresh. (`python3 -m http.server 8623` also
works, but the browser may keep using an old copy of a script for a few minutes
after you change it.)

## Versioned script links

Every page loads `style.css`, `asteroplot.js` and `degrade.js` with a `?v=...`
tag. After changing any of those files, change the tag in all pages so browsers
(including students' browsers, and GitHub Pages' 10-minute cache) fetch the new
copy instead of reusing an old one:

```bash
grep -rl "?v=" index.html exercises | xargs sed -i '' 's/?v=[A-Za-z0-9]*/?v=NEWTAG/g'
```

## Publishing on GitHub Pages

Push to a GitHub repository, then under **Settings → Pages** choose
"Deploy from a branch", branch `main`, folder `/ (root)`. The `.nojekyll` file
tells Pages to serve the files as-is.

## Google Drive copy

Work in this local folder (Drive sync can corrupt `.git`). To archive a copy on
Drive, copy the whole folder over when convenient; the copy is a backup, not a
working tree.
