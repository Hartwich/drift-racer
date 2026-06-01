# Contributing

This is an optional Open Party Lab game repo. Contributions should keep the game package focused and compatible with the Platform package contract.

## Workflow

1. Keep changes small and reviewable.
2. Update server, protocol, host, controller, assets, and docs together when behavior changes.
3. Run `npm run typecheck` and `npm run build` in this repo.
4. Test through Open Party Lab with `npm run games:sync-local` from the Platform repo.
5. Include screenshots or notes for visible host/controller changes.
6. Mention AI assistance when it materially helped produce the change.

## Boundaries

The server remains authoritative for gameplay. The host renders the shared screen. Controllers send player intent and should not decide outcomes.

Common Platform features belong in `Hartwich/Open-Party-Lab`. Game-specific rules, protocol state, assets, and manifests belong in this repo.

## Assets And Content

Only add assets, prompts, word lists, or generated media when their rights are clear. Do not add content that implies affiliation with existing commercial games, brands, platforms, or stores unless that use has been reviewed.