# Drift Racer

Drift Racer is an optional Open Party Lab game package.

This repo is not a standalone app. Run it through the Open Party Lab platform:

```bash
cd ../../
npm install
npm run games:sync-local
npm run dev:all
```

The platform loads this game only when the repo exists locally and `npm run games:sync-local` links it.

## Package Entrypoints

- `@open-party-lab/game-drift-racer/manifest`
- `@open-party-lab/game-drift-racer/protocol`
- `@open-party-lab/game-drift-racer/server`
- `@open-party-lab/game-drift-racer/host`
- `@open-party-lab/game-drift-racer/controller`

## Development Checks

```bash
npm install
npm run typecheck
npm run build
npm run pack:dry-run
```
