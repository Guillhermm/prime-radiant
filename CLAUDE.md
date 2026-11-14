# Prime Radiant app

The team contract is the Prime Radiant profile `CLAUDE.md`; it binds every agent here.
The plan is `docs/roadmap.md`.

## Rules for this repository

- JavaScript ES modules, Node.js standard library only, zero runtime dependencies.
- Tests: `node --test`. Unit tests sit next to their module (`*.test.js`);
  integration and end-to-end tests live in `test/integration` and `test/e2e`. No live network.
- `null` means a sensor was not operating; `0` means none detected. Never collapse them.
- DOM is built with `textContent`, never `innerHTML`.

## Layout and owners

- `core/` pure science and shared functions (Kaue)
- `pipeline/` FIRMS archive CSV to tiles and manifest (Kaue)
- `fixtures/` hand-built test data with known answers (Kaue)
- `web/` the static app (Guilherme)
- `api/` Vercel function for live data (Guilherme, planned)
- `docs/` roadmap, method, data, deploy, ux
- `raw/` and `data/` are generated and gitignored.
