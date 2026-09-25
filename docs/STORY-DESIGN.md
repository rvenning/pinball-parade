# Pinball Parade — how a chapter is a story

Each of the twenty chapters is a small pinball story told on its world's table.
Moonlight Castle was built first as the prototype; the other four worlds follow
the same pattern with their own layout and signature mechanisms.

## The pattern

| Part | What it is | Where it lives |
|---|---|---|
| **Setup** | How the table looks when the ball is served: what is hidden, shut, still or asleep | `state` in `js/chapters.js` |
| **Phases** | 4–8 steps in order. Only the current one counts and only its mechanisms are lit, so there is always one clear thing to do | `phases` |
| **Table changes** | Every phase changes the table when it starts or ends: a gate lowers, a dragon takes off, stones slam shut, the whirlpool opens | `start` / `effect` on a phase |
| **Finale** | A special mode: a hurry-up jackpot counting down, a timed frenzy, or two-ball play after a lock | the last phase (`timer`, `jackpot`, `frenzy`, `lock`) |
| **Bonus** | One side quest, running all chapter, for the second star | `bonus` |
| **Score star** | About 1.1 × the Rosalie bot's median final score: it needs a good game | `scoreTarget` |

The length of a chapter comes from **phases and table changes, never from
padded counts**. The lint (`tests/tables.test.js`) enforces it:

- a story phase asks for at most 3 of a shot (15 bumper hits);
- the same goal twice in a row is refused, unless the phase before transformed it
  (the sleeping dragon is now flying);
- every chapter has at least two visible table changes;
- every finale is a special mode;
- every phase is walked in order, applying every table change, so a phase can
  never aim at something hidden, shut or unlit.

**Mercy for long stories.** Each new phase grants a short ball save and relights
the kickbacks. A middle chapter has 4 balls and a world finale 5, as in
five-ball pinball. A game that runs out of balls leaves a **checkpoint**, and the
next game carries the story on from the phase it reached, so a child is never
sent back to the start of a ten-minute finale.

## The five tables

| World | Its shape | Signature mechanisms |
|---|---|---|
| Moonlight Castle | Classic: bell tower centre, ramp right, Keep left, moat loop | the **drawbridge** (a ramp behind a gate the story lowers); the **dragon**, a target that sleeps on the gatehouse and then flies across the top |
| Jungle Temple | Built round **central stairs** | the **stones**, two drop targets standing in the stairs' mouth that stay down until the temple raises them; the **idol's eye**, a saucer that opens under the vine lanes; the prayer wheel across the right orbit |
| Deep Sea | No ramp at all: the water moves the ball | the **current**, a pulsing up-draft lane the story wakes; the **whirlpool**, a pull field that swallows a passing ball into its sink and spits it out |
| Clockwork Workshop | Gear train across the top, letters below | **timing**: nothing ticks until the key is wound; then the pendulum swings and the **clockwork door** in front of the conveyor opens and shuts on a beat |
| Cloud Kingdom | Open sky | the **drifting clouds** (all three bumpers float, in two bands that can never pinch); the **rainbow**, a lane up the right that becomes a ramp arcing over the whole sky |

## How the pacing is designed and checked

Targets (the Rosalie bot, as the book's reference player): **2–4 minutes** for
a world's intro chapter, **4–7** for the middle chapters, **6–10** for the
world's finale. Nobody should finish chapter 1 in under a minute.

1. **Measure the shots.** `node tools/shot-rates.js <table>` plays each bot on
   the open table and counts hits per minute on every mechanism. A phase that
   asks for k of a shot hit r times a minute costs about k / r minutes. This is
   how the dragon perch, the temple stairs, the prayer wheel, the rainbow lane
   and the toybox all got moved: each was measured as a wall, then fixed.
2. **Write the story from the rates**, then play it for real:
   `PP_REPORT=1 node --test tests/pacing.test.js` plays every chapter as the
   family does (carrying on from checkpoints) and asserts the bands. It also
   asserts that no single phase takes more than half a chapter, which caught
   three grinds while this was built.
3. **Real play.** `node tools/e2e.js` plays chapter 1 in real time in headless
   Edge with trusted touches, carrying on after a lost game, and checks the wall
   clock. In the app, every profile logs the minutes and games spent on each
   chapter up to its first clear. Open `?debug=1` → *pacing report* on the
   family's own devices to compare their real times with the bands.

### Measured (Rosalie bot, median of 5 seeds; Isabelle bot for worlds 1–2)

| Chapter | Band | Rosalie | Isabelle |
|---|---|---|---|
| 1 The Sleepy Bells | 2–4 | 2.3 | 2.9 |
| 2 Lower the Drawbridge | 4–7 | 5.4 | 5.6 |
| 3 Wake the Dragon | 4–7 | 4.8 | 7.1 |
| 4 The Castle Parade | 6–10 | 6.8 | 10.5 |
| 5 The Golden Idol | 2–4 | 3.0 | 4.5 |
| 6 Stone Doors | 4–7 | 4.5 | 4.5 |
| 7 The Idol's Eye | 4–7 | 4.2 | 4.5 |
| 8 Temple Parade | 6–10 | 6.5 | 7.7 |
| 9 Shell Song | 2–4 | 2.4 | – |
| 10 Riding the Current | 4–7 | 6.8 | – |
| 11 Treasure Chest | 4–7 | 4.2 | – |
| 12 Undersea Parade | 6–10 | 7.7 | – |
| 13 Wind the Key | 2–4 | 2.9 | – |
| 14 Tick Tock | 4–7 | 6.3 | – |
| 15 The Toybox | 4–7 | 4.7 | – |
| 16 Workshop Parade | 6–10 | 7.6 | – |
| 17 Riding the Wind | 2–4 | 2.4 | – |
| 18 Storm Spell | 4–7 | 6.3 | – |
| 19 The Sky Castle | 4–7 | 5.3 | – |
| 20 The Grand Parade | 6–10 | 9.6 | – |

Chapter 1 for the planner (the competent-adult bot): 61–89 seconds. In
real-time real-touch play (`tools/e2e.js`): 1.5–3.7 minutes across runs — one
run lost its balls part-way and carried the story on from the checkpoint.
