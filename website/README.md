# Product website

This folder is an English/Korean static website. `index.html` is the English entry and `index-ko.html` is Korean. `site-language.js` resolves explicit language choices, saved preference, browser preference, then English. `site-catalog.js` owns dynamic store/motion text and store-link roles.

Run from the project root:

```powershell
node website/serve.mjs
```

The server prints its loopback URL. `sample/` plays the local MP4 used for detection, preview, capture, and media regression checks. The website and sample are not part of the installable `extension/` folder.

## Retained images

`assets/screenshots/en/` and `ko/` contain only the sample GIF/still, media list, and download manager used by the pages and manuals. `assets/screenshots/catalog.json` records capture date, extension version, and file hash. English screenshots were captured with 0.2.24; Korean screenshots with 0.2.18. They are real captures, not newly verified screenshots of every current feature.

The GIF/still files preserve their actual capture ratio. Playback controls respect reduced-motion preference. The live page references these stable names; new tool captures stay in `artifacts/` until reviewed and promoted.

## External links

The store URL entries are currently empty, so installation buttons show the existing preparation notice. Set actual store URLs in `site-catalog.js` when issued. Shared support links lead to [Ev-Cabinet](https://evilack.github.io/donate.html).

For tool configuration and verification commands, see [Development](../docs/development.md).
