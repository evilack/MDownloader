# Third-party components

## Mediabunny 1.65.2

- Purpose: media parsing and remuxing without re-encoding.
- Bundled file: `extension/vendor/mediabunny-1.65.2.mjs`.
- The upstream bundle is retained without modification.
- License: Mozilla Public License 2.0, included in [mediabunny-LICENSE.txt](extension/vendor/mediabunny-LICENSE.txt).
- Corresponding upstream package/source: [Mediabunny 1.65.2 package](https://registry.npmjs.org/mediabunny/-/mediabunny-1.65.2.tgz).
- Project: [Mediabunny](https://mediabunny.dev/).

Existing notices and license terms remain applicable to this component. A license for MDownloader's original source has not been specified in a separate repository LICENSE file; this cleanup does not assign one.

## YouTube feasibility modules — development/manual packages only

These dependencies are pinned by `package-lock.json`. Runtime bundles are built locally with esbuild, without CDN imports. They are not included in the Chrome Store package. Their presence does not mean YouTube saving passed the native browser gate; see [verification](docs/verification.md).

| Component | Exact version | License | Retained notice |
|---|---|---|---|
| [YouTube.js](https://github.com/LuanRT/YouTube.js) | 18.3.0 | MIT | [License](extension/vendor/youtube/youtubei.js-LICENSE) |
| [Jinter](https://github.com/LuanRT/Jinter) | 3.3.1 | MIT | [License](extension/vendor/youtube/jintr-LICENSE) |
| [protobuf-es](https://github.com/bufbuild/protobuf-es/tree/v2.17.0) | 2.17.0 | Apache-2.0 and BSD-3-Clause | [Apache text](extension/vendor/youtube/bufbuild-protobuf-LICENSE-APACHE), [Google varint BSD notice](extension/vendor/youtube/bufbuild-protobuf-LICENSE-BSD) |
| [fflate](https://github.com/101arrowz/fflate) | 0.8.3 | MIT | [License](extension/vendor/youtube/fflate-LICENSE) |
| [Meriyah](https://github.com/meriyah/meriyah) | 7.4.2 | ISC | [License](extension/vendor/youtube/meriyah-LICENSE.md) |
| [Acorn](https://github.com/acornjs/acorn) | 8.19.0 | MIT | [License](extension/vendor/youtube/acorn-LICENSE) |
| [esbuild](https://esbuild.github.io/) | 0.28.2 | MIT, development tool only | Supplied with the locked npm package; not shipped as extension runtime |

`extension/vendor/youtube/provenance.json` records package versions, the lockfile SHA-256 and every runtime/license file hash. The protobuf npm tarball omits its root Apache license; the retained text is from the exact [v2.17.0 upstream license](https://raw.githubusercontent.com/bufbuild/protobuf-es/v2.17.0/LICENSE). The BSD notice is copied verbatim from the installed package's `dist/esm/wire/varint.js`. Existing Mediabunny 1.65.2 remains unchanged.
