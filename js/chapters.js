// Chapters — the STORIES told on the fixed tables.
//
// A chapter is a small pinball story in PHASES: a setup (how the table looks
// when the ball is served), phases that escalate, and a finale. Only the
// current phase counts and only its mechanisms are lit, so the player always
// knows the one thing the story wants. Every phase changes the table when it
// starts or ends — a gate lowers, a dragon takes off, a door opens — which is
// where a chapter's length comes from: new shots, not more of the same one.
//
// A chapter never moves a rail. It only switches state on elements that
// js/tables.js already has (hidden, closed, lit, awake, moving).
//
// Goal kinds (the engine's whole vocabulary — tests lint against it):
//   hit    {group|id, count}   hits on bumpers / targets / drops
//   all    {group, count}      every member of a group at least once, count times
//   ramp   {id, count}         complete rides of a ramp
//   lanes  {group, count}      light every rollover in a group
//   bank   {group, count}      knock down every drop target in a group
//   spell  {group, word}       hit lettered targets in order (only the lit one counts)
//   spin   {id, count}         spinner turns
//   orbit  {id, count}         passes through a one-way orbit sensor
//   saucer {id, count}         visits to a saucer
//   lock   {count}             balls locked (the 2nd starts multiball)
//   multiball {count}
//   parade {count}             parade meter filled
//   score  {points, fromPhase?}
//   frenzy {group|id, on?, timer, mult, count?}   a timed mode: the group (or the
//                              shot) scores ×mult; `on` names what it counts ("ramp"…)
//
// Phase extras:
//   start / effect  [fx…]      table changes when the phase begins / is done
//   timer {secs, end}          end "complete": the phase finishes when time is up
//   jackpot {from, to}         a hurry-up: worth `from`, counting down to `to`
//                              over timer.secs, then waiting there (never lost)
//   save                       ball-save seconds granted when this phase starts
// Effects: open/close:gate  show/hide:el  wake/sleep:el  lightLock/unlock:saucer
//   move/still:mover  raise:@bank  save:secs  extra  kick   ("@group" = all of it)
//
// Stars: ★ the story told (opens the next chapter) · ★ the bonus side quest ·
// ★ the score target. A game that runs out of balls part-way leaves a
// CHECKPOINT: the next try can pick the story up at the phase it reached.
//
// Pacing is a design target, measured by tests/pacing.test.js with the bots:
// intro chapters 2–4 minutes, the middle chapters 4–7, each world's finale
// 6–10, and nothing a competent player can finish in under a minute.

const OBJ_KINDS = ["hit", "all", "ramp", "lanes", "bank", "spell", "spin", "orbit", "saucer", "lock", "multiball", "parade", "score", "frenzy"];
const EFFECT_KINDS = ["open", "close", "show", "hide", "wake", "sleep", "lightLock", "unlock", "move", "still", "raise", "save", "extra", "kick"];

const WORLDS = [
  { table: "castle",   name: "Moonlight Castle",    blurb: "Ring the bells, lower the drawbridge, and whatever you do, don't wake the dragon. (Wake the dragon.)", stars: 0 },
  { table: "temple",   name: "Jungle Temple",       blurb: "Vines to swing through, stones to topple and an idol with one eye open.", stars: 4 },
  { table: "sea",      name: "Deep Sea",            blurb: "Ride the current down to the shells and the chest nobody has opened.", stars: 9 },
  { table: "workshop", name: "Clockwork Workshop",  blurb: "Wind the key, spell out the ticking and fill the toybox.", stars: 14 },
  { table: "clouds",   name: "Cloud Kingdom",       blurb: "Up past the storm to the castle in the sky, for the last parade of all.", stars: 19 },
];

// Pacing bands in minutes, by the chapter's place in its world.
const PACE = { intro: [2, 4], middle: [4, 7], finale: [6, 10] };

// A goal. Counts default to one — except a frenzy, which runs on its clock
// unless it names a count that ends it early.
const P = (kind, rest) => Object.assign({ kind }, kind === "frenzy" ? {} : { count: 1 }, rest);

const CHAPTERS = [
  // ---------------------------------------------------------------- castle --
  // 1 · intro. Flippers, bumpers and one lit thing at a time.
  { world: 0, title: "The Sleepy Bells", pace: "intro",
    story: "It is nearly midnight and the castle bells have nodded off. Wake them up in time for the midnight chime!",
    state: { savePost: true, kickback: "gentle", ballSave: 20, phaseSave: 10, hidden: ["star", "keep"], closed: ["drawbridge"] },
    phases: [
      P("all", { group: "bells", icon: "bell", label: "Wake all 3 bells", title: "The bells are asleep",
        effect: ["wake:@bells", "show:star"] }),
      P("hit", { id: "star", count: 2, icon: "star", label: "Hit the lit window", title: "A light in the window",
        effect: ["show:keep"] }),
      P("saucer", { id: "keep", icon: "keep", label: "Visit the Keep", title: "The Keep door opens",
        effect: ["wake:keep"] }),
      P("orbit", { id: "moat", icon: "moat", label: "Walk round the moat", title: "The night watch" }),
      P("frenzy", { group: "bells", mult: 5, timer: { secs: 35, end: "complete" }, icon: "bell", label: "Ring the chime!", title: "The midnight chime" }),
    ],
    bonus: P("hit", { group: "bells", count: 25, icon: "bell", label: "25 chimes" }),
    scoreTarget: 50000 },

  // 2 · the drawbridge: a shot that is SHUT until the story opens it.
  { world: 0, title: "Lower the Drawbridge", pace: "middle",
    story: "A knight has ridden all night to reach the castle, but the drawbridge is up. Get a message to the guard.",
    state: { savePost: true, kickback: "gentle", ballSave: 18, phaseSave: 10, closed: ["drawbridge"], hidden: ["keep"] },
    phases: [
      P("hit", { id: "star", count: 3, icon: "star", label: "Knock at the gate", title: "Knock, knock",
        effect: ["show:keep"] }),
      P("saucer", { id: "keep", icon: "keep", label: "Wake the guard", title: "The guard is snoring",
        effect: ["open:drawbridge"] }),
      P("ramp", { id: "bridge", icon: "ramp", label: "Cross the drawbridge", title: "The drawbridge comes down",
        effect: ["wake:@bells"] }),
      P("all", { group: "bells", icon: "bell", label: "Ring in the knight", title: "The courtyard wakes up" }),
      P("orbit", { id: "moat", icon: "moat", label: "Gallop round the moat", title: "A lap of honour" }),
      P("frenzy", { id: "bridge", on: "ramp", mult: 5, timer: { secs: 35, end: "complete" }, icon: "ramp", label: "Joust on the bridge!", title: "The joust" }),
      // all that noise: a first glimpse of the next chapter
      P("hit", { id: "dragonT", icon: "dragon", label: "Hush the dragon", title: "The dragon stirs…",
        start: ["wake:dragon"], effect: ["sleep:dragon"] }),
      P("saucer", { id: "keep", icon: "keep", label: "Feast jackpot!", title: "The welcome feast",
        timer: { secs: 25 }, jackpot: { from: 40000, to: 10000 } }),
    ],
    bonus: P("hit", { group: "bells", count: 40, icon: "bell", label: "40 chimes" }),
    scoreTarget: 105000 },

  // 3 · the dragon: a target that MOVES once the story wakes it.
  { world: 0, title: "Wake the Dragon", pace: "middle",
    story: "The dragon is asleep on the gatehouse roof. Creep round the moat first, so it doesn't hear you coming.",
    state: { savePost: true, kickback: "auto", ballSave: 16, phaseSave: 10, awake: ["@bells"] },
    phases: [
      P("orbit", { id: "moat", icon: "moat", label: "Creep round the moat", title: "Tiptoe, tiptoe" }),
      P("hit", { id: "dragonT", icon: "dragon", label: "Tickle the dragon", title: "A tickle on the nose",
        effect: ["wake:dragon", "move:dragonT"] }),
      P("hit", { id: "dragonT", count: 2, icon: "dragon", label: "Catch the dragon", title: "The dragon takes off!",
        effect: ["still:dragonT"] }),
      P("ramp", { id: "bridge", icon: "ramp", label: "Race over the bridge", title: "Follow that dragon" }),
      P("saucer", { id: "keep", icon: "keep", label: "Treasure jackpot!", title: "The dragon's treasure",
        timer: { secs: 25 }, jackpot: { from: 50000, to: 12000 } }),
    ],
    bonus: P("saucer", { id: "keep", count: 3, icon: "keep", label: "Keep × 3" }),
    scoreTarget: 85000 },

  // 4 · the world finale: everything the castle taught, then a two-ball parade.
  { world: 0, title: "The Castle Parade", pace: "finale",
    story: "Tonight is the Castle Parade. Wake everyone up, lower the bridge, fetch the dragon and gather the whole castle in the Keep.",
    state: { savePost: true, kickback: "auto", ballSave: 16, phaseSave: 12, closed: ["drawbridge"] },
    phases: [
      P("all", { group: "bells", icon: "bell", label: "Wake the castle", title: "Everybody up!",
        effect: ["wake:@bells"] }),
      P("saucer", { id: "keep", icon: "keep", label: "Call the guard", title: "Somebody lower the bridge",
        effect: ["open:drawbridge"] }),
      P("ramp", { id: "bridge", icon: "ramp", label: "Cross the bridge", title: "Over the drawbridge",
        effect: ["wake:dragon", "move:dragonT"] }),
      P("hit", { id: "dragonT", icon: "dragon", label: "Fetch the dragon", title: "The noise woke the dragon",
        effect: ["still:dragonT", "extra"] }),
      P("orbit", { id: "moat", count: 2, icon: "moat", label: "Round up everyone", title: "Who is still outside?",
        effect: ["lightLock:keep"] }),
      P("lock", { count: 2, icon: "lock", label: "Gather the parade", title: "Everyone into the Keep",
        effect: ["unlock:keep", "move:dragonT"] }),
      P("ramp", { id: "bridge", count: 2, icon: "parade", label: "Parade jackpot!", title: "The Castle Parade!",
        save: 15, timer: { secs: 40 }, jackpot: { from: 80000, to: 25000 } }),
    ],
    bonus: P("hit", { id: "star", count: 12, icon: "star", label: "12 lit windows" }),
    scoreTarget: 145000 },

  // ---------------------------------------------------------------- temple --
  // The temple is about ORDER: stones before stairs, stairs before the idol.
  // 5 · intro. The idol, its eye, and a drum frenzy.
  { world: 1, title: "The Golden Idol", pace: "intro",
    story: "Deep in the jungle a golden idol is fast asleep. Knock on the totems, wake the idol, and see what it has been watching.",
    state: { savePost: true, kickback: "gentle", ballSave: 18, phaseSave: 10, hidden: ["eye", "spinner"] },
    phases: [
      P("all", { group: "totems", icon: "totem", label: "Knock on the totems", title: "Knock, knock, jungle" }),
      P("hit", { id: "idol", count: 6, icon: "idol", label: "Wake the idol", title: "The idol yawns",
        effect: ["wake:idol", "show:eye"] }),
      P("saucer", { id: "eye", icon: "eye", label: "Look into its eye", title: "One eye opens…",
        effect: ["show:spinner"] }),
      P("spin", { id: "spinner", count: 20, icon: "spinner", label: "Spin the prayer wheel", title: "A wheel appears" }),
      P("frenzy", { group: "vines", mult: 5, timer: { secs: 35, end: "complete" }, icon: "leaf", label: "Beat the drums!", title: "The temple drums" }),
    ],
    bonus: P("hit", { group: "vines", count: 30, icon: "leaf", label: "30 leaf bounces" }),
    scoreTarget: 80000 },

  // 6 · the stones: a door the player knocks down, shot by shot.
  { world: 1, title: "Stone Doors", pace: "middle",
    story: "The temple stairs are blocked by two great stones. Topple them, climb up — and mind they don't roll back.",
    state: { savePost: true, kickback: "gentle", ballSave: 16, phaseSave: 10, hidden: ["eye"] },
    phases: [
      P("bank", { group: "stones", icon: "stone", label: "Topple the stones", title: "The stone doors" }),
      P("ramp", { id: "stairs", icon: "ramp", label: "Climb the stairs", title: "Up the temple steps",
        effect: ["show:eye", "wake:idol"] }),
      P("saucer", { id: "eye", icon: "eye", label: "Peek at the idol", title: "Someone is watching",
        effect: ["raise:@stones"] }),
      P("bank", { group: "stones", icon: "stone", label: "Push them back", title: "The stones roll back!" }),
      P("all", { group: "totems", icon: "totem", label: "Ring the totems", title: "Call the explorers" }),
      P("spin", { id: "spinner", count: 20, icon: "spinner", label: "Spin the prayer wheel", title: "Wish for luck" }),
      P("ramp", { id: "stairs", icon: "ramp", label: "Stairs jackpot!", title: "Race up the stairs",
        timer: { secs: 25 }, jackpot: { from: 45000, to: 12000 } }),
    ],
    bonus: P("hit", { id: "idol", count: 15, icon: "idol", label: "15 idol bumps" }),
    scoreTarget: 125000 },

  // 7 · the eye: the idol watches, the stones slam shut behind you.
  { world: 1, title: "The Idol's Eye", pace: "middle",
    story: "Climb to the idol and it may show you its treasure. But the stones have a habit of closing behind explorers…",
    state: { savePost: true, kickback: "auto", ballSave: 15, phaseSave: 10, hidden: ["eye"] },
    phases: [
      P("all", { group: "totems", icon: "totem", label: "Knock on the totems", title: "Anyone home?" }),
      P("bank", { group: "stones", icon: "stone", label: "Topple the stones", title: "The way in" }),
      P("ramp", { id: "stairs", icon: "ramp", label: "Climb the stairs", title: "To the top",
        effect: ["raise:@stones", "wake:idol"] }),
      P("bank", { group: "stones", icon: "stone", label: "Break out!", title: "The stones slam shut!" }),
      P("hit", { id: "idol", count: 8, icon: "idol", label: "Tickle the idol", title: "The idol stirs" }),
      P("spin", { id: "spinner", count: 20, icon: "spinner", label: "Spin the prayer wheel", title: "Ask the idol nicely" }),
      P("frenzy", { group: "vines", mult: 5, timer: { secs: 30, end: "complete" }, icon: "leaf", label: "Drum for the idol!", title: "The idol is deciding…",
        effect: ["show:eye"] }),
      P("saucer", { id: "eye", icon: "eye", label: "Eye jackpot!", title: "The idol's treasure",
        timer: { secs: 30 }, jackpot: { from: 55000, to: 14000 } }),
    ],
    bonus: P("lanes", { group: "lanes", icon: "lanes", label: "Light the 3 vines" }),
    scoreTarget: 130000 },

  // 8 · the world finale: everything, then two explorers at once.
  { world: 1, title: "Temple Parade", pace: "finale",
    story: "The whole jungle is coming to the temple tonight. Open the way, climb the stairs, and gather every explorer at the idol for the parade.",
    state: { savePost: true, kickback: "gentle", ballSave: 18, phaseSave: 15, hidden: ["eye"] },
    phases: [
      P("hit", { id: "idol", count: 6, icon: "idol", label: "Wake the idol", title: "Rise and shine",
        effect: ["wake:idol"] }),
      P("bank", { group: "stones", icon: "stone", label: "Topple the stones", title: "Open the doors" }),
      P("ramp", { id: "stairs", icon: "ramp", label: "Climb the stairs", title: "Up to the idol",
        effect: ["show:eye", "extra"] }),
      P("frenzy", { group: "vines", mult: 5, timer: { secs: 30, end: "complete" }, icon: "leaf", label: "Beat the drums!", title: "The drums call everyone",
        effect: ["lightLock:eye"] }),
      P("lock", { count: 2, icon: "lock", label: "Gather the explorers", title: "Everyone to the eye",
        effect: ["unlock:eye", "raise:@stones"] }),
      P("bank", { group: "stones", icon: "stone", label: "Clear the path", title: "The stones are back!" }),
      P("spin", { id: "spinner", count: 20, icon: "spinner", label: "Spin the prayer wheel", title: "One last wish" }),
      P("ramp", { id: "stairs", count: 2, icon: "parade", label: "Parade jackpot!", title: "The Temple Parade!",
        save: 15, timer: { secs: 40 }, jackpot: { from: 90000, to: 28000 } }),
    ],
    bonus: P("hit", { group: "totems", count: 12, icon: "totem", label: "12 totem knocks" }),
    scoreTarget: 225000 },

  // ------------------------------------------------------------------- sea --
  // The sea is about WATER that moves the ball: turn the current on, open
  // the whirlpool, and let them carry you.
  // 9 · intro. Shells, pearls, and the first swirl of the whirlpool.
  { world: 2, title: "Shell Song", pace: "intro",
    story: "Down on the sea bed every shell sings a different note. Sing them all and see what stirs in the deep.",
    state: { savePost: true, kickback: "gentle", ballSave: 16, phaseSave: 10, hidden: ["whirlpool", "whirl"] },
    phases: [
      P("all", { group: "shells", icon: "shell", label: "Sing every shell", title: "The shell song",
        effect: ["wake:@shells"] }),
      P("all", { group: "pearls", icon: "pearl", label: "Find 3 pearls", title: "Something shiny",
        effect: ["show:whirlpool", "show:whirl"] }),
      P("saucer", { id: "whirl", icon: "whirl", label: "Dive into the swirl", title: "The water starts to swirl" }),
      P("frenzy", { group: "shells", mult: 5, timer: { secs: 35, end: "complete" }, icon: "shell", label: "Shell chorus!", title: "The whole reef sings" }),
    ],
    bonus: P("saucer", { id: "chest", icon: "chest", label: "Peek in the chest" }),
    scoreTarget: 60000 },

  // 10 · the current: a lane that does nothing until the story wakes it.
  { world: 2, title: "Riding the Current", pace: "middle",
    story: "The tide has gone quiet. Wake it with the pearls, then ride the current right up to the top of the sea.",
    state: { savePost: true, kickback: "auto", ballSave: 15, phaseSave: 10, hidden: ["current", "whirlpool", "whirl"] },
    phases: [
      P("all", { group: "pearls", icon: "pearl", label: "Wake the tide", title: "The sea is sleeping",
        effect: ["show:current"] }),
      P("orbit", { id: "tide", icon: "current", label: "Ride the current", title: "Here comes the tide",
        effect: ["show:whirlpool", "show:whirl"] }),
      P("saucer", { id: "whirl", icon: "whirl", label: "Round and round", title: "The whirlpool wakes" }),
      P("saucer", { id: "chest", icon: "chest", label: "Knock on the chest", title: "A chest in the sand",
        effect: ["wake:chest"] }),
      P("all", { group: "shells", icon: "shell", label: "Tell the shells", title: "Pass it on" }),
      P("orbit", { id: "tide", icon: "current", label: "Current jackpot!", title: "The big wave",
        timer: { secs: 30 }, jackpot: { from: 50000, to: 14000 } }),
    ],
    bonus: P("hit", { group: "shells", count: 40, icon: "shell", label: "40 shell songs" }),
    scoreTarget: 90000 },

  // 11 · the chest: stuck in the sand until the water frees it.
  { world: 2, title: "Treasure Chest", pace: "middle",
    story: "The old chest is stuck fast in the sand. The whirlpool might just be strong enough to dig it out.",
    state: { savePost: true, kickback: "auto", ballSave: 14, phaseSave: 10, hidden: ["whirlpool", "whirl"] },
    phases: [
      P("all", { group: "shells", icon: "shell", label: "Ask the shells", title: "Where is the chest?" }),
      P("saucer", { id: "chest", icon: "chest", label: "Try the chest", title: "Stuck fast!",
        effect: ["show:whirlpool", "show:whirl"] }),
      P("saucer", { id: "whirl", count: 2, icon: "whirl", label: "Stir up the sand", title: "The whirlpool digs" }),
      P("all", { group: "pearls", icon: "pearl", label: "Find the key pearls", title: "Three pearls for a key",
        effect: ["hide:whirlpool", "hide:whirl"] }),
      P("orbit", { id: "tide", icon: "current", label: "Ride up to the chest", title: "Up with the current",
        effect: ["wake:chest"] }),
      P("saucer", { id: "chest", icon: "chest", label: "Treasure jackpot!", title: "The chest opens!",
        timer: { secs: 30 }, jackpot: { from: 60000, to: 15000 } }),
    ],
    bonus: P("hit", { group: "pearls", count: 10, icon: "pearl", label: "10 pearls" }),
    scoreTarget: 110000 },

  // 12 · the world finale: the tide, the whirlpool, and two balls in the chest.
  { world: 2, title: "Undersea Parade", pace: "finale",
    story: "Everyone under the sea is going to the parade. Wake the tide, open the whirlpool, and fill the chest with friends.",
    state: { savePost: true, kickback: "auto", ballSave: 14, phaseSave: 12, hidden: ["current", "whirlpool", "whirl"] },
    phases: [
      P("all", { group: "shells", icon: "shell", label: "Sing every shell", title: "Tune up the reef" }),
      P("all", { group: "pearls", icon: "pearl", label: "Wake the tide", title: "Ring the pearls",
        effect: ["show:current"] }),
      P("orbit", { id: "tide", icon: "current", label: "Ride the current", title: "Up with the tide",
        effect: ["show:whirlpool", "show:whirl", "extra"] }),
      P("saucer", { id: "whirl", icon: "whirl", label: "Into the whirlpool", title: "The whirlpool opens",
        effect: ["lightLock:chest", "wake:chest"] }),
      P("lock", { count: 2, icon: "lock", label: "Fill the chest", title: "Everyone into the chest",
        effect: ["unlock:chest"] }),
      P("frenzy", { group: "shells", mult: 5, timer: { secs: 30, end: "complete" }, icon: "shell", label: "Parade music!", title: "The reef strikes up" }),
      P("saucer", { id: "whirl", count: 2, icon: "parade", label: "Parade jackpot!", title: "The Undersea Parade!",
        save: 15, timer: { secs: 40 }, jackpot: { from: 100000, to: 30000 } }),
    ],
    bonus: P("orbit", { id: "tide", count: 3, icon: "current", label: "Ride 3 currents" }),
    scoreTarget: 150000 },

  // -------------------------------------------------------------- workshop --
  // The workshop is about TIMING: wind the key and the pendulum swings, the
  // clockwork door ticks, and the good shots are the ones you time.
  // 13 · intro. Wind it up and watch it go.
  { world: 3, title: "Wind the Key", pace: "intro",
    story: "The toymaker has gone to bed and every toy has run down. Wind the big brass key and set the workshop ticking.",
    state: { savePost: true, kickback: "auto", ballSave: 15, phaseSave: 10 },
    phases: [
      P("hit", { id: "key", count: 3, icon: "key", label: "Wind the key", title: "Click, click, click",
        effect: ["wake:automaton", "move:pendulum"] }),
      P("all", { group: "tick", icon: "spell", label: "Wake the letters", title: "Tick… tock…" }),
      P("ramp", { id: "conveyor", icon: "ramp", label: "Ride the conveyor", title: "The belt starts up" }),
      P("frenzy", { group: "gears", mult: 5, timer: { secs: 35, end: "complete" }, icon: "gear", label: "Clockwork frenzy!", title: "Everything whirrs" }),
    ],
    bonus: P("saucer", { id: "toybox", icon: "chest", label: "Peek in the toybox" }),
    scoreTarget: 55000 },

  // 14 · the clockwork door: a shot you have to time.
  { world: 3, title: "Tick Tock", pace: "middle",
    story: "The workshop clock has started ticking, and the conveyor door opens and shuts with every tock. Time your shots!",
    state: { savePost: false, kickback: "auto", ballSave: 14, phaseSave: 10, closed: ["clockDoor"] },
    phases: [
      P("hit", { id: "key", count: 2, icon: "key", label: "Wind the clock", title: "Wind it up",
        effect: ["move:pendulum", "move:clockDoor"] }),
      P("ramp", { id: "conveyor", icon: "ramp", label: "Beat the clock", title: "The door ticks open…" }),
      P("spell", { group: "tick", word: "TICK", icon: "spell", label: "Spell TICK", title: "T-I-C-K" }),
      P("hit", { group: "gears", count: 4, icon: "gear", label: "Oil the gears", title: "A squeaky gear train" }),
      P("frenzy", { group: "tick", mult: 5, timer: { secs: 35, end: "complete" }, icon: "spell", label: "Bong! Bong! Bong!", title: "The clock strikes twelve" }),
    ],
    bonus: P("hit", { group: "tick", count: 10, icon: "spell", label: "10 letter knocks" }),
    scoreTarget: 85000 },

  // 15 · the toybox: open it and the toys march out.
  { world: 3, title: "The Toybox", pace: "middle",
    story: "Something is rattling inside the toybox. Open it up, wind the toys, and let them march round the workshop.",
    state: { savePost: false, kickback: "auto", ballSave: 14, phaseSave: 10 },
    phases: [
      P("hit", { group: "gears", count: 4, icon: "gear", label: "Start the gears", title: "Warm up the workshop" }),
      P("saucer", { id: "toybox", icon: "chest", label: "Open the toybox", title: "Rattle, rattle",
        effect: ["wake:toybox"] }),
      P("hit", { id: "key", count: 3, icon: "key", label: "Wind the toys", title: "Out come the toys",
        effect: ["wake:automaton", "move:pendulum"] }),
      P("frenzy", { id: "key", mult: 5, timer: { secs: 30, end: "complete" }, icon: "key", label: "Keep them marching!", title: "The toy march" }),
      P("spell", { group: "tick", word: "TICK", icon: "spell", label: "Spell TICK", title: "Tidy-up time" }),
      P("ramp", { id: "conveyor", icon: "ramp", label: "Ride them home", title: "Along the conveyor" }),
      P("saucer", { id: "toybox", icon: "chest", label: "Toybox jackpot!", title: "Everyone back in the box",
        timer: { secs: 30 }, jackpot: { from: 65000, to: 16000 } }),
    ],
    bonus: P("hit", { group: "tick", count: 12, icon: "spell", label: "12 letters" }),
    scoreTarget: 125000 },

  // 16 · the world finale: the whole workshop, ticking, then two balls.
  { world: 3, title: "Workshop Parade", pace: "finale",
    story: "It is the night of the Toy Parade. Wind everything, spell out the ticking, and send every toy along the conveyor.",
    state: { savePost: false, kickback: "auto", ballSave: 14, phaseSave: 12, closed: ["clockDoor"] },
    phases: [
      P("hit", { id: "key", count: 3, icon: "key", label: "Wind the workshop", title: "Wind everything up",
        effect: ["wake:automaton", "move:pendulum", "move:clockDoor"] }),
      P("hit", { group: "gears", count: 4, icon: "gear", label: "Turn the gears", title: "The gear train turns" }),
      P("spell", { group: "tick", word: "TICK", icon: "spell", label: "Spell TICK", title: "Tick, tick, tick" }),
      P("saucer", { id: "toybox", icon: "chest", label: "Open the toybox", title: "Who is in the box?",
        effect: ["wake:toybox"] }),
      P("ramp", { id: "conveyor", icon: "ramp", label: "Beat the clock", title: "Through the ticking door",
        effect: ["lightLock:toybox", "extra"] }),
      P("lock", { count: 2, icon: "lock", label: "Fill the toybox", title: "Toys into the box",
        effect: ["unlock:toybox"] }),
      P("frenzy", { group: "gears", mult: 5, timer: { secs: 30, end: "complete" }, icon: "gear", label: "Parade music!", title: "The band winds up" }),
      // the toymaker props the ticking door open for the parade
      P("ramp", { id: "conveyor", count: 2, icon: "parade", label: "Parade jackpot!", title: "The Workshop Parade!",
        start: ["still:clockDoor", "open:clockDoor"], save: 15, timer: { secs: 40 }, jackpot: { from: 110000, to: 32000 } }),
    ],
    bonus: P("hit", { id: "key", count: 15, icon: "key", label: "15 winds" }),
    scoreTarget: 150000 },

  // ---------------------------------------------------------------- clouds --
  // The finale world is about things that FLOAT: clouds that drift once the
  // wind rises, a storm to clear, a rainbow to ride and a castle in the sky.
  // 17 · intro. Wake the wind and the clouds start to drift.
  { world: 4, title: "Riding the Wind", pace: "intro",
    story: "Up above the last mountain the clouds are sleeping in a heap. Bounce them awake and the wind will carry them — and you — to the sky.",
    state: { savePost: false, kickback: "auto", ballSave: 15, phaseSave: 10, hidden: ["wind", "skyCastle"] },
    phases: [
      P("all", { group: "puffs", icon: "puff", label: "Bounce every cloud", title: "A heap of sleepy clouds",
        effect: ["move:@puffs"] }),
      P("spin", { id: "spinner", count: 15, icon: "spinner", label: "Spin the weathervane", title: "The clouds begin to drift",
        effect: ["show:wind", "show:skyCastle"] }),
      P("saucer", { id: "skyCastle", icon: "keep", label: "Knock at the castle", title: "A castle in the sky!" }),
      P("ramp", { id: "rainbow", icon: "rainbow", label: "Slide the rainbow", title: "A rainbow for a visitor" }),
      P("frenzy", { group: "puffs", mult: 5, timer: { secs: 35, end: "complete" }, icon: "puff", label: "Cloud bounce!", title: "Bouncing on the clouds" }),
    ],
    bonus: P("orbit", { id: "windLane", icon: "wind", label: "Ride the wind" }),
    scoreTarget: 70000 },

  // 18 · the storm: clear it, then spell a wish on what is left.
  { world: 4, title: "Storm Spell", pace: "middle",
    story: "A storm has rolled in over the kingdom. Knock the storm clouds down, then spell a wish on them before they blow away.",
    state: { savePost: false, kickback: "auto", ballSave: 14, phaseSave: 10, hidden: ["@storm"], moving: ["@puffs"] },
    phases: [
      P("hit", { group: "puffs", count: 5, icon: "puff", label: "Chase the clouds", title: "Something is brewing",
        effect: ["show:@storm", "still:@puffs"] }),
      P("bank", { group: "storm", icon: "spell", label: "Knock down the storm", title: "Here comes the storm!" }),
      P("ramp", { id: "rainbow", icon: "rainbow", label: "Find the rainbow", title: "After the rain",
        effect: ["move:@puffs"] }),
      P("spell", { group: "storm", word: "STAR", icon: "spell", label: "Spell STAR", title: "Make a wish" }),
      P("ramp", { id: "rainbow", icon: "rainbow", label: "Wish jackpot!", title: "The wish comes true",
        timer: { secs: 30 }, jackpot: { from: 70000, to: 18000 } }),
    ],
    bonus: P("spin", { id: "spinner", count: 60, icon: "spinner", label: "60 spins" }),
    scoreTarget: 110000 },

  // 19 · the sky castle: the rainbow is the way in.
  { world: 4, title: "The Sky Castle", pace: "middle",
    story: "The rainbow leads all the way up to the castle in the sky. Its door only opens for visitors who arrive by rainbow.",
    state: { savePost: false, kickback: "auto", ballSave: 12, phaseSave: 10, hidden: ["skyCastle", "@storm"] },
    phases: [
      P("all", { group: "puffs", icon: "puff", label: "Wake the clouds", title: "Morning in the sky",
        effect: ["move:@puffs"] }),
      P("ramp", { id: "rainbow", icon: "rainbow", label: "Slide the rainbow", title: "Up the rainbow",
        effect: ["show:skyCastle", "wake:skyCastle"] }),
      P("saucer", { id: "skyCastle", icon: "keep", label: "Knock at the door", title: "The castle in the sky",
        effect: ["show:@storm"] }),
      P("bank", { group: "storm", icon: "spell", label: "Blow the clouds away", title: "Storm clouds hide the door" }),
      P("frenzy", { id: "spinner", on: "spin", mult: 5, timer: { secs: 30, end: "complete" }, icon: "spinner", label: "Spin for the king!", title: "The king's weathervane" }),
      P("saucer", { id: "skyCastle", icon: "keep", label: "Castle jackpot!", title: "Tea with the king",
        timer: { secs: 30 }, jackpot: { from: 80000, to: 20000 } }),
    ],
    bonus: P("hit", { group: "puffs", count: 40, icon: "puff", label: "40 cloud bounces" }),
    scoreTarget: 115000 },

  // 20 · the grand finale of the book: every trick the kingdom knows.
  { world: 4, title: "The Grand Parade", pace: "finale",
    story: "This is it: the last and grandest parade of all, up in the sky. Wake the wind, clear the storm, ride the rainbow and bring everyone to the castle.",
    state: { savePost: false, kickback: "slow", ballSave: 12, phaseSave: 12, hidden: ["wind", "@storm"] },
    phases: [
      P("all", { group: "puffs", icon: "puff", label: "Wake the clouds", title: "Everybody up!",
        effect: ["move:@puffs", "show:wind"] }),
      P("spin", { id: "spinner", count: 30, icon: "spinner", label: "Spin the weathervane", title: "The wind is rising",
        effect: ["show:@storm"] }),
      P("bank", { group: "storm", icon: "spell", label: "Clear the storm", title: "One last storm" }),
      P("ramp", { id: "rainbow", icon: "rainbow", label: "Slide the rainbow", title: "The rainbow appears",
        effect: ["lightLock:skyCastle", "extra"] }),
      P("lock", { count: 2, icon: "lock", label: "Gather the parade", title: "Everyone to the castle",
        effect: ["unlock:skyCastle"] }),
      P("frenzy", { group: "puffs", mult: 5, timer: { secs: 30, end: "complete" }, icon: "puff", label: "Parade music!", title: "The band plays on the clouds" }),
      P("ramp", { id: "rainbow", count: 2, icon: "parade", label: "Grand jackpot!", title: "The Grand Parade!",
        save: 15, timer: { secs: 45 }, jackpot: { from: 150000, to: 45000 } }),
    ],
    bonus: P("orbit", { id: "windLane", count: 2, icon: "wind", label: "Ride the wind twice" }),
    scoreTarget: 175000 },
];

// A longer story gets more balls, as five-ball pinball once did: a middle
// chapter is played with four and a world finale with five, so a child meets
// "game over" rarely even when a chapter runs for many minutes.
const BALLS = { intro: 3, middle: 4, finale: 5 };
CHAPTERS.forEach((c, i) => {
  c.idx = i;
  c.n = i - CHAPTERS.findIndex((x) => x.world === c.world) + 1;   // 1..4 within its world
  c.table = WORLDS[c.world].table;
  c.balls = BALLS[c.pace];
});

// Free play: every mechanism awake, no story, no mercy post, a short ball
// save. This is the higher-skill layer and the family leaderboard.
const LOCKS = { castle: ["keep"], temple: ["eye"], sea: ["chest"], workshop: ["toybox"], clouds: ["skyCastle"] };
// …and every mover running, every toy awake
const FREE_MOVING = { castle: ["dragonT"], workshop: ["pendulum", "clockDoor"], clouds: ["@puffs"] };
const FREE_AWAKE = { castle: ["dragon"], workshop: ["automaton"] };
function freePlayConfig(tableId) {
  return {
    mode: "free", table: tableId, title: "Free Play", balls: 3, phases: [], bonus: null, scoreTarget: 0,
    state: { savePost: false, kickback: "slow", ballSave: 6, lock: LOCKS[tableId], moving: FREE_MOVING[tableId] || [], awake: FREE_AWAKE[tableId] || [] },
  };
}

// The Daily Parade: the same chapter story and twist for the whole family on
// a given date, chosen from the date alone. Nothing about it is random during
// play — the engine has no RNG — so "the same for everyone" is literally true.
const TWISTS = [
  { id: "bells",  name: "Loud Bells",   note: "Bumpers score double",   bumperMult: 2 },
  { id: "gentle", name: "Gentle Day",   note: "Long ball save",         ballSave: 25 },
  { id: "brave",  name: "Brave Day",    note: "No kickbacks, triple ramps", kickback: "off", rampMult: 3 },
  { id: "march",  name: "Quick March",  note: "Parades fill twice as fast", paradeFill: 2 },
];
function dayHash(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function dailyConfig(dateKey) {
  const h = dayHash("pinball-parade:" + dateKey);
  const ch = CHAPTERS[h % CHAPTERS.length];
  const tw = TWISTS[(h >>> 8) % TWISTS.length];
  const state = Object.assign({}, ch.state, { savePost: false, kickback: tw.kickback || "slow", ballSave: tw.ballSave || 8 });
  return {
    mode: "daily", date: dateKey, table: ch.table, title: `Daily Parade · ${ch.title}`, story: `${tw.name}: ${tw.note}.`,
    balls: 3, phases: ch.phases, bonus: ch.bonus, scoreTarget: ch.scoreTarget, twist: tw, chapterIdx: ch.idx, state,
  };
}

// ★ story told · ★ bonus · ★ score target — only once the story is told.
function starsFor(cfg, got, score) {
  if (!got.told) return 0;
  return 1 + (got.bonus ? 1 : 0) + ((cfg.scoreTarget && score >= cfg.scoreTarget) ? 1 : 0);
}

if (typeof module !== "undefined") module.exports = { CHAPTERS, WORLDS, PACE, OBJ_KINDS, EFFECT_KINDS, freePlayConfig, dailyConfig, starsFor, TWISTS };
