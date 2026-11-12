# Three distribution builds

The authorized outputs are Chrome store, Edge store and development builds. Each command must create a separate installable extension directory and a ZIP whose root contains manifest.json. Chrome excludes the provider, vendor bundles, sandbox, brand icon and caption controls while preserving its existing site policy notice and source/network denial. Edge and development retain the full provider. No browser installation or store publication is part of this task.

- Add regression coverage for three flavors, ZIPs, Chrome exclusions and retained notices.
- Extend the existing packaging entry point and policy, add named build commands and all-build orchestration.
- Strip Chrome-only provider integrations at build time; validate module imports, assets, locales and manifest references before creating archives.
- Verify full provider byte preservation in Edge/development, archive contents and source immutability; run repository checks and document commands and submission status.
