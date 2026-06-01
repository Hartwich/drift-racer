# Drift Racer

Arcade drift racing game for Open Party Lab with phone racing controls and shared host action.

![In-game screenshot](docs/screenshots/host.png)

## Status

Under construction. Drift Racer is currently not playable enough for normal sessions. It needs handling work, track/content expansion, and clearer race-state feedback before it should be recommended.

## Run Through Open Party Lab

This repo is not a standalone app. Run it through the Open Party Lab platform.

Recommended layout:

```text
Open-Party-Lab/
  local-games/
    drift-racer/
```

From the Platform repo:

```bash
npm install
npm run games:sync-local
npm run dev:all
```

The Platform loads this game only when the repo exists locally and `npm run games:sync-local` links it. Missing optional games are skipped.

## GitHub Metadata

Description:

```text
Arcade drift racing game for Open Party Lab with phone racing controls and shared host action.
```

Suggested topics:

```text
open-party-lab party-game browser-game phaser typescript local-multiplayer racing-game
```

## Package Entrypoints

- `@open-party-lab/game-drift-racer/manifest`
- `@open-party-lab/game-drift-racer/protocol`
- `@open-party-lab/game-drift-racer/server`
- `@open-party-lab/game-drift-racer/host`
- `@open-party-lab/game-drift-racer/controller`

The Platform should import only these public entrypoints.

## Development Checks

```bash
npm install
npm run typecheck
npm run build
npm run pack:dry-run
```

For visual checks, start Open Party Lab, add virtual controllers when needed, and capture host screenshots through a browser.

## License

Code is licensed under the Apache License 2.0. See [LICENSE](LICENSE).

Assets, generated media, word lists, prompts, and third-party references may need separate rights review before public store distribution.
