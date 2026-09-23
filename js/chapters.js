// Chapters — the STORY and STATE layered on the fixed tables.
//
// Four chapters per world. A chapter never moves geometry: it only chooses
// which existing mechanisms are hidden, closed or lit at the start, how kind
// the table is (ball save, kickbacks, the post between the flippers), and
// three objectives. Completing an objective can transform the table through
// `effect` — open the drawbridge, wake the dragon, light the lock — which is
// the story advancing, not a checkbox ticking.
//
// Objective kinds (the engine's whole vocabulary — tests lint against it):
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
//   score  {points}
//
// Stars: ★ primary (unlocks the next chapter) · ★ secondary · ★ advanced OR
// the chapter's generous score target. Stars only count once the primary is
// done, so a result card never shows a star for a chapter that did not open
// anything.

const OBJ_KINDS = ["hit", "all", "ramp", "lanes", "bank", "spell", "spin", "orbit", "saucer", "lock", "multiball", "parade", "score"];
const EFFECT_KINDS = ["open", "close", "show", "wake", "lightLock"];

const WORLDS = [
  { table: "castle",   name: "Moonlight Castle",    blurb: "Ring the bells, lower the drawbridge, and whatever you do, don't wake the dragon. (Wake the dragon.)", stars: 0 },
  { table: "temple",   name: "Jungle Temple",       blurb: "Vines to swing through, stones to topple and an idol with one eye open.", stars: 4 },
  { table: "sea",      name: "Deep Sea",            blurb: "Ride the current down to the shells and the chest nobody has opened.", stars: 9 },
  { table: "workshop", name: "Clockwork Workshop",  blurb: "Wind the key, spell out the ticking and fill the toybox.", stars: 14 },
  { table: "clouds",   name: "Cloud Kingdom",       blurb: "Up past the storm to the castle in the sky, for the last parade of all.", stars: 19 },
];

const O = (kind, rest) => Object.assign({ kind, count: 1 }, rest);

// Primaries are built from what ordinary play reaches: bumpers, a lit
// target, the ramp the orbit return sets up. Top lanes, orbits, spelling and
// multiball are the secondary and advanced layers — Rosalie's and the adults'
// — until the last two worlds, which is where they become the story.
const GENTLE = { savePost: true, kickback: "gentle" };
const CHAPTERS = [
  // ---------------------------------------------------------------- castle --
  { world: 0, title: "The Sleepy Bells", story: "The castle bells have fallen asleep. Bump them awake!",
    state: { ...GENTLE, hidden: ["dragon1", "dragon2"], closed: ["drawbridge"], ballSave: 20 },
    objectives: [
      O("hit", { group: "bells", count: 8, icon: "bell", label: "Ring the bells" }),
      O("hit", { id: "star", count: 2, icon: "star", label: "Hit the star" }),
      O("parade", { icon: "parade", label: "Start a parade" }),
    ], scoreTarget: 9000 },
  { world: 0, title: "Lower the Drawbridge", story: "Ring every bell and the drawbridge comes down.",
    state: { ...GENTLE, hidden: ["dragon1", "dragon2"], closed: ["drawbridge"], ballSave: 18 },
    objectives: [
      O("all", { group: "bells", icon: "bell", label: "Ring all 3 bells", effect: ["open:drawbridge"] }),
      O("ramp", { id: "bridge", icon: "ramp", label: "Cross the drawbridge" }),
      O("ramp", { id: "bridge", count: 3, icon: "ramp", label: "Cross it 3 times" }),
    ], scoreTarget: 14000 },
  { world: 0, title: "Wake the Dragon", story: "Somebody has to wake the dragon. It may as well be you.",
    state: { ...GENTLE, ballSave: 16 },
    objectives: [
      O("hit", { group: "dragon", count: 3, icon: "dragon", label: "Tickle the dragon", effect: ["wake:dragon"] }),
      O("ramp", { id: "bridge", count: 2, icon: "ramp", label: "Cross the drawbridge" }),
      O("parade", { icon: "parade", label: "Start a parade" }),
    ], scoreTarget: 20000 },
  { world: 0, title: "The Castle Parade", story: "The dragon is awake and wants a parade. Everybody over the bridge!",
    state: { savePost: true, kickback: "auto", ballSave: 14 },
    objectives: [
      O("ramp", { id: "bridge", count: 2, icon: "ramp", label: "Cross the drawbridge" }),
      O("hit", { group: "dragon", count: 4, icon: "dragon", label: "Wake the dragon", effect: ["wake:dragon"] }),
      O("parade", { count: 2, icon: "parade", label: "Two parades" }),
    ], scoreTarget: 28000 },

  // ---------------------------------------------------------------- temple --
  { world: 1, title: "The Golden Idol", story: "The idol in the middle of the temple loves a bump.",
    state: { ...GENTLE, closed: ["templeDoor"], ballSave: 16 },
    objectives: [
      O("hit", { group: "idol", count: 6, icon: "idol", label: "Bump the idol" }),
      O("lanes", { group: "lanes", icon: "lanes", label: "Light the 3 vines" }),
      O("spin", { id: "spinner", count: 25, icon: "spinner", label: "Spin 25 times" }),
    ], scoreTarget: 16000 },
  { world: 1, title: "Stone Doors", story: "Knock down the three stones to open the temple stairs.",
    state: { ...GENTLE, closed: ["templeDoor"], ballSave: 15 },
    objectives: [
      O("bank", { group: "stones", icon: "stone", label: "Topple 3 stones", effect: ["open:templeDoor"] }),
      O("ramp", { id: "stairs", icon: "ramp", label: "Climb the stairs" }),
      O("lanes", { group: "lanes", count: 2, icon: "lanes", label: "Vines twice" }),
    ], scoreTarget: 20000 },
  { world: 1, title: "The Idol's Eye", story: "The idol is watching. Give it something to look at.",
    state: { savePost: true, kickback: "auto", ballSave: 14 },
    objectives: [
      O("hit", { group: "idol", count: 10, icon: "idol", label: "Bump the idol", effect: ["wake:idol"] }),
      O("ramp", { id: "stairs", count: 2, icon: "ramp", label: "Climb the stairs" }),
      O("bank", { group: "stones", count: 2, icon: "stone", label: "Stones twice" }),
    ], scoreTarget: 26000 },
  { world: 1, title: "Temple Parade", story: "Up the stairs and round again. The whole jungle is watching.",
    state: { savePost: false, kickback: "auto", ballSave: 12 },
    objectives: [
      O("ramp", { id: "stairs", icon: "ramp", label: "Climb the stairs" }),
      O("bank", { group: "stones", count: 2, icon: "stone", label: "Stones twice" }),
      O("parade", { count: 2, icon: "parade", label: "Two parades" }),
    ], scoreTarget: 32000 },

  // ------------------------------------------------------------------- sea --
  { world: 2, title: "Shell Song", story: "Every shell sings a different note. Play them all.",
    state: { ...GENTLE, ballSave: 15 },
    objectives: [
      O("all", { group: "shells", count: 2, icon: "shell", label: "All 3 shells, twice" }),
      O("all", { group: "pearls", icon: "pearl", label: "Find 3 pearls" }),
      O("spin", { id: "spinner", count: 30, icon: "spinner", label: "Spin 30 times" }),
    ], scoreTarget: 18000 },
  { world: 2, title: "Riding the Current", story: "Peek in the old chest, then let the current carry you.",
    state: { savePost: true, kickback: "auto", ballSave: 14 },
    objectives: [
      O("saucer", { id: "chest", count: 2, icon: "chest", label: "Peek in the chest" }),
      O("orbit", { id: "tide", count: 3, icon: "current", label: "Ride the current" }),
      O("parade", { icon: "parade", label: "Start a parade" }),
    ], scoreTarget: 22000 },
  { world: 2, title: "Treasure Chest", story: "Find the pearls and the chest will open for you.",
    state: { savePost: false, kickback: "auto", ballSave: 12 },
    objectives: [
      O("all", { group: "pearls", icon: "pearl", label: "Find 3 pearls", effect: ["lightLock:chest", "wake:chest"] }),
      O("lock", { icon: "lock", label: "Lock a ball" }),
      O("multiball", { icon: "multiball", label: "Two-ball parade" }),
    ], scoreTarget: 26000 },
  { world: 2, title: "Undersea Parade", story: "The chest is open. Put two balls in it and see what happens.",
    state: { savePost: false, kickback: "auto", ballSave: 10, lock: ["chest"] },
    objectives: [
      O("lock", { count: 2, icon: "lock", label: "Lock 2 balls" }),
      O("orbit", { id: "tide", count: 3, icon: "current", label: "Ride the current" }),
      O("parade", { count: 2, icon: "parade", label: "Two parades" }),
    ], scoreTarget: 34000 },

  // -------------------------------------------------------------- workshop --
  { world: 3, title: "Wind the Key", story: "The toy soldier has run down. Wind his key!",
    state: { savePost: true, kickback: "auto", ballSave: 14 },
    objectives: [
      O("hit", { id: "key", count: 3, icon: "key", label: "Wind the key", effect: ["wake:automaton"] }),
      O("all", { group: "gears", count: 2, icon: "gear", label: "All 3 gears, twice" }),
      O("ramp", { id: "conveyor", count: 2, icon: "ramp", label: "Ride the conveyor" }),
    ], scoreTarget: 22000 },
  { world: 3, title: "Tick Tock", story: "Ride the conveyor, then hit the letters in order: T, I, C, K.",
    state: { savePost: false, kickback: "auto", ballSave: 12 },
    objectives: [
      O("ramp", { id: "conveyor", count: 2, icon: "ramp", label: "Ride the conveyor" }),
      O("spell", { group: "tick", word: "TICK", icon: "spell", label: "Spell TICK" }),
      O("parade", { icon: "parade", label: "Start a parade" }),
    ], scoreTarget: 26000 },
  { world: 3, title: "The Toybox", story: "Drop two balls in the toybox and the toys come out to play.",
    state: { savePost: false, kickback: "auto", ballSave: 12 },
    objectives: [
      O("saucer", { id: "toybox", count: 2, icon: "chest", label: "Visit the toybox", effect: ["lightLock:toybox", "wake:toybox"] }),
      O("lock", { count: 2, icon: "lock", label: "Lock 2 balls" }),
      O("spell", { group: "tick", word: "TICK", icon: "spell", label: "Spell TICK" }),
    ], scoreTarget: 32000 },
  { world: 3, title: "Workshop Parade", story: "Every toy in the workshop is marching. Join in!",
    state: { savePost: false, kickback: "slow", ballSave: 10, lock: ["toybox"] },
    objectives: [
      O("multiball", { icon: "multiball", label: "Two-ball parade" }),
      O("ramp", { id: "conveyor", count: 3, icon: "ramp", label: "Ride the conveyor" }),
      O("spell", { group: "tick", word: "TICK", icon: "spell", label: "Spell TICK" }),
    ], scoreTarget: 38000 },

  // ---------------------------------------------------------------- clouds --
  { world: 4, title: "Riding the Wind", story: "Bounce through the clouds, then shoot up the wind lane.",
    state: { savePost: true, kickback: "auto", ballSave: 14 },
    objectives: [
      O("all", { group: "puffs", count: 2, icon: "puff", label: "All 3 clouds, twice" }),
      O("orbit", { id: "windLane", count: 3, icon: "wind", label: "Ride the wind" }),
      O("spin", { id: "spinner", count: 40, icon: "spinner", label: "Spin 40 times" }),
    ], scoreTarget: 24000 },
  { world: 4, title: "Storm Spell", story: "Knock the storm clouds down in order: S, T, A, R.",
    state: { savePost: false, kickback: "auto", ballSave: 12 },
    objectives: [
      O("spell", { group: "storm", word: "STAR", icon: "spell", label: "Spell STAR" }),
      O("ramp", { id: "rainbow", count: 2, icon: "rainbow", label: "Slide the rainbow" }),
      O("spell", { group: "storm", word: "STAR", count: 2, icon: "spell", label: "STAR twice" }),
    ], scoreTarget: 30000 },
  { world: 4, title: "The Sky Castle", story: "Slide the rainbow twice and the sky castle opens its door.",
    state: { savePost: false, kickback: "slow", ballSave: 10 },
    objectives: [
      O("ramp", { id: "rainbow", count: 2, icon: "rainbow", label: "Slide the rainbow", effect: ["lightLock:skyCastle", "wake:skyCastle"] }),
      O("lock", { count: 2, icon: "lock", label: "Lock 2 balls" }),
      O("parade", { count: 2, icon: "parade", label: "Two parades" }),
    ], scoreTarget: 36000 },
  { world: 4, title: "The Grand Parade", story: "Every world is here for the last parade. Two balls, one sky!",
    state: { savePost: false, kickback: "slow", ballSave: 10, lock: ["skyCastle"] },
    objectives: [
      O("multiball", { icon: "multiball", label: "Two-ball parade" }),
      O("parade", { count: 2, icon: "parade", label: "Two parades" }),
      O("ramp", { id: "rainbow", count: 4, icon: "rainbow", label: "Rainbow 4 times" }),
    ], scoreTarget: 44000 },
];

CHAPTERS.forEach((c, i) => {
  c.idx = i;
  c.n = i - CHAPTERS.findIndex((x) => x.world === c.world) + 1;   // 1..4 within its world
  c.table = WORLDS[c.world].table;
  c.balls = 3;
});

// Free play: every mechanism awake, no objectives, no mercy post, a short
// ball save. This is the higher-skill layer and the family leaderboard.
const LOCKS = { castle: [], temple: [], sea: ["chest"], workshop: ["toybox"], clouds: ["skyCastle"] };
function freePlayConfig(tableId) {
  return {
    mode: "free", table: tableId, title: "Free Play", balls: 3, objectives: [], scoreTarget: 0,
    state: { savePost: false, kickback: "slow", ballSave: 6, lock: LOCKS[tableId] },
  };
}

// The Daily Parade: the same table, chapter objectives and twist for the
// whole family on a given date, chosen from the date alone. Nothing about it
// is random during play — the engine has no RNG — so "the same for everyone"
// is literally true.
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
  if (!state.lock && LOCKS[ch.table].length) state.lock = [];
  return {
    mode: "daily", date: dateKey, table: ch.table, title: `Daily Parade · ${ch.title}`, story: `${tw.name}: ${tw.note}.`,
    balls: 3, objectives: ch.objectives, scoreTarget: ch.scoreTarget, twist: tw, chapterIdx: ch.idx, state,
  };
}

function starsFor(cfg, done, score) {
  if (!done[0]) return 0;
  return 1 + (done[1] ? 1 : 0) + ((done[2] || (cfg.scoreTarget && score >= cfg.scoreTarget)) ? 1 : 0);
}

if (typeof module !== "undefined") module.exports = { CHAPTERS, WORLDS, OBJ_KINDS, EFFECT_KINDS, freePlayConfig, dailyConfig, starsFor, TWISTS };
