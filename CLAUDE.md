# Prime Radiant app

The team contract (Prime Radiant profile `CLAUDE.md`) binds this repository. This file only
names what exists here.

- Plan and task ownership: `docs/roadmap.md`. Task IDs: `K` = Kaue (data and science),
  `G` = Guilherme (web app).
- Stack: JavaScript ES modules on Node.js 22+, standard library only, zero runtime
  dependencies, no bundler. Tests: `node --test`, unit tests next to the module
  (`*.test.js`), integration and end-to-end under `test/`.
- Layout: `core/` pure science and data functions, `pipeline/` FIRMS archive to tiles,
  `api/` the Vercel function, `web/` static app, `fixtures/` the data contract both tracks
  build against.
- Never committed: `raw/` (archive downloads), `data/` (generated tiles), `.env*`.
- Hard rule in every data structure: `null` means the sensor was not operating, `0` means
  nothing was detected.
