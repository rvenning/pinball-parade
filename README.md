# Pinball Parade

Five pinball tables, three balls per game. Pick any table and try to beat your best score. Each table has its own family leaderboard.

Play: https://rvenning.github.io/pinball-parade/

## Tables

- **Moonlight Castle:** bells, a moving dragon, a drawbridge ramp and the keep.
- **Jungle Temple:** toppling stones, stairs and the idol's eye.
- **Deep Sea:** a pulsing current, whirlpool, shells and a treasure chest.
- **Clockwork Workshop:** moving pendulum, timed conveyor door, gears and toybox.
- **Cloud Kingdom:** drifting bumpers, storm targets, rainbow ramp and sky castle.

Alternating feature shots within eight seconds builds a jackpot up to 5,000 points. Complete a bank or lane set, ride a ramp, shoot a saucer or orbit, then aim for a different feature. Lit saucers lock balls; the second lock starts multiball. Bumper chains fill the Parade meter for ten seconds of double points. Ball save covers the first ten seconds after launch, and kickbacks relight quickly.

Hold the left and right sides of the lower table for flippers, and tap or hold **Launch**. Keyboard: ← → or A D, Space to launch, P to pause. The game works offline and supports family profiles and sync through gamekit.

## Development

This is a static site with plain scripts. Run `node tools/serve.js` for a local server on port 8133. Run `node --test` for simulation and storage checks. With the server running, `node tools/e2e.js` checks the main touch flow in headless Edge.

Scores are stored under the `pbp_` localStorage prefix and synced to the `pinballparade` Firestore collection when available. Existing chapter and daily records remain in saved data, while the game now records and displays the best score for each table.
