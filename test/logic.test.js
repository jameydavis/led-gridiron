// Run: node test/logic.test.js
// Loads Logic.js (a QML `.pragma library` file) into node and exercises the rules.
const fs = require("fs")
const path = require("path")
const assert = require("assert")

function load() {
  const src = fs.readFileSync(path.join(__dirname, "..", "Logic.js"), "utf8").replace(/^\.pragma library/m, "")
  const names = ["newGame", "move", "pass", "kick", "defenseTick", "receiverTick", "clockTick", "ballTick",
    "nextPlay", "leds", "fieldPosition", "clockText", "canPass", "fieldGoalDistance", "setupScrimmage",
    "COLS", "LANES", "QUARTER_SECONDS"]
  const L = new Function(src + "\nreturn {" + names.join(",") +
    ", setRandom: function(f) { random = f } }")()
  return L
}

let passed = 0
function test(name, fn) {
  const L = load()
  try { fn(L); passed++; console.log("ok   " + name) }
  catch (e) { console.log("FAIL " + name + "\n     " + e.stack.split("\n").slice(0, 3).join("\n     ")); process.exitCode = 1 }
}

function scrimmageAt(L, los, poss) {
  const s = L.newGame(1)
  s.poss = poss || 0
  s.los = los
  s.down = 1
  s.togo = 10
  L.setupScrimmage(s)
  s.events = []
  return s
}

test("opening kickoff: home receives near its own goal, waiting for a move", L => {
  const s = L.newGame(1)
  assert.strictEqual(s.poss, 0)
  assert.strictEqual(s.phase, "presnap")
  assert.strictEqual(s.kind, "return")
  assert.ok(s.carrier.x >= 6 && s.carrier.x <= 14)
  assert.strictEqual(L.leds(s, 0).length, 30)
})

test("first move snaps the ball and steps the carrier", L => {
  const s = scrimmageAt(L, 30)
  s.defenders = [{ x: 60, lane: 0 }]
  L.move(s, 0, -1)
  assert.strictEqual(s.phase, "live")
  assert.strictEqual(s.carrier.lane, 0)
  assert.deepStrictEqual(s.events.map(e => e.sound), ["snap", "step"])
})

test("running into a defender is a tackle and a down is used", L => {
  const s = scrimmageAt(L, 30)
  s.defenders = [{ x: 33, lane: 1 }]
  s.receiver = null
  L.move(s, 1, 0) // 29 -> 30
  L.move(s, 1, 0) // 31
  L.move(s, 1, 0) // 32
  L.move(s, 1, 0) // defender at 33: tackled at 32
  assert.strictEqual(s.phase, "dead")
  assert.strictEqual(s.los, 32)
  assert.strictEqual(s.down, 2)
  assert.strictEqual(s.togo, 8)
  L.nextPlay(s)
  assert.strictEqual(s.phase, "presnap")
  assert.strictEqual(s.carrier.x, 31)
})

test("ten yards is a first down", L => {
  const s = scrimmageAt(L, 30)
  s.defenders = []
  s.receiver = null
  for (let i = 0; i < 15; i++) L.move(s, 1, 0) // 29 -> 44
  s.defenders = [{ x: 45, lane: 1 }]
  L.move(s, 1, 0)
  assert.strictEqual(s.los, 44)
  assert.strictEqual(s.down, 1)
  assert.ok(s.events.some(e => e.code === "1ST"))
})

test("visitor attacks toward -x and scores in the home end zone", L => {
  const s = scrimmageAt(L, 5, 1)
  s.defenders = []
  s.receiver = null
  for (let i = 0; i < 10 && s.phase !== "dead"; i++) L.move(s, -1, 0)
  assert.strictEqual(s.score[1], 6)
  L.nextPlay(s)
  assert.strictEqual(s.phase, "pat")
  L.setRandom(() => 0)
  L.kick(s)
  assert.strictEqual(s.score[1], 7)
  L.nextPlay(s)
  assert.strictEqual(s.poss, 0, "home receives the kickoff after a visitor score")
  assert.strictEqual(s.kind, "return")
})

test("fourth-down failure turns the ball over at the spot", L => {
  const s = scrimmageAt(L, 50)
  s.down = 4
  s.togo = 5
  s.defenders = [{ x: 51, lane: 1 }]
  s.receiver = null
  L.move(s, 1, 0) // 49 -> 50
  L.move(s, 1, 0) // tackled at 50
  L.nextPlay(s)
  assert.strictEqual(s.poss, 1)
  assert.strictEqual(s.los, 50)
  assert.strictEqual(s.down, 1)
})

test("tackled in your own end zone is a safety", L => {
  const s = scrimmageAt(L, 2)
  s.defenders = [{ x: 0, lane: 1 }]
  s.receiver = null
  L.move(s, 0, 0)
  s.phase = "live"
  s.carrier.x = 0
  s.defenders = [{ x: -1, lane: 1 }]
  s.pro = 2 // no broken tackles
  L.setRandom(() => 0)
  L.defenseTick(s)
  assert.strictEqual(s.score[1], 2)
  L.nextPlay(s)
  assert.strictEqual(s.poss, 1, "the scoring team receives the free kick")
})

test("completed pass hands the ball to the receiver", L => {
  L.setRandom(() => 0.9)
  const s = scrimmageAt(L, 30)
  s.defenders = [{ x: 60, lane: 1 }]
  s.receiver = { x: 35, lane: 0, depth: 5 }
  L.move(s, 0, 1) // snap, carrier to lane 2
  assert.ok(L.canPass(s))
  L.pass(s)
  assert.strictEqual(s.phase, "air")
  while (L.ballTick(s)) {}
  assert.strictEqual(s.phase, "live")
  assert.deepStrictEqual(s.carrier, { x: 35, lane: 0 })
  assert.strictEqual(s.receiver, null)
  assert.ok(!L.canPass(s), "only one pass per play")
})

test("a defender in the passing lane intercepts", L => {
  const s = scrimmageAt(L, 30)
  s.receiver = { x: 35, lane: 1, depth: 5 }
  s.defenders = [{ x: 32, lane: 1 }]
  L.move(s, 0, 0)
  s.phase = "live"
  L.pass(s)
  while (L.ballTick(s)) {}
  assert.ok(s.events.some(e => e.code === "INT"))
  L.nextPlay(s)
  assert.strictEqual(s.poss, 1)
  assert.strictEqual(s.los, 32)
})

test("no pass once the carrier is past the line of scrimmage", L => {
  const s = scrimmageAt(L, 30)
  s.defenders = []
  L.move(s, 1, 0) // 29 -> 30 (at the line: still ok)
  assert.ok(L.canPass(s))
  L.move(s, 1, 0) // 31
  assert.ok(!L.canPass(s))
})

test("kick from long range punts and flips possession", L => {
  L.setRandom(() => 0.5)
  const s = scrimmageAt(L, 30)
  assert.strictEqual(L.fieldGoalDistance(s), 0)
  L.kick(s)
  while (L.ballTick(s)) {}
  L.nextPlay(s)
  assert.strictEqual(s.poss, 1)
  assert.strictEqual(s.los, 72) // 30 + 42
})

test("kick in range is a field goal attempt", L => {
  L.setRandom(() => 0.1)
  const s = scrimmageAt(L, 80)
  assert.strictEqual(L.fieldGoalDistance(s), 37)
  L.kick(s)
  while (L.ballTick(s)) {}
  assert.strictEqual(s.score[0], 3)
})

test("quarters advance and the game ends after the fourth", L => {
  const s = scrimmageAt(L, 30)
  s.receiver = null
  s.defenders = [{ x: 31, lane: 1 }]
  s.clock = 1
  s.quarter = 4
  L.move(s, 1, 0)
  L.move(s, 1, 0)
  L.nextPlay(s)
  assert.strictEqual(s.phase, "gameover")
})

test("halftime gives the second-half kickoff to the visitor", L => {
  const s = scrimmageAt(L, 30)
  s.receiver = null
  s.defenders = [{ x: 31, lane: 1 }]
  s.clock = 0
  s.quarter = 2
  L.move(s, 1, 0)
  L.move(s, 1, 0)
  L.nextPlay(s)
  assert.strictEqual(s.quarter, 3)
  assert.strictEqual(s.poss, 1)
  assert.strictEqual(s.kind, "return")
})

test("the starting lineup matches the classic handheld formation", L => {
  const s = scrimmageAt(L, 30)
  const m = L.leds(s, 0)
  const rows = [0, 1, 2].map(r => m.slice(r * 10, r * 10 + 10).map(v => v ? (v === 3 ? "C" : "d") : ".").join(""))
  assert.deepStrictEqual(rows, ["..d...d...", "C.d.d.....", "..d......d"])
  const v = scrimmageAt(L, 70, 1) // visitor: mirrored left-to-right
  const mv = L.leds(v, 0)
  const vrows = [0, 1, 2].map(r => mv.slice(r * 10, r * 10 + 10).map(x => x ? (x === 3 ? "C" : "d") : ".").join(""))
  assert.deepStrictEqual(vrows, ["...d...d..", ".....d.d.C", "d......d.."])
})

test("kickoff returns start from the same lineup, on both Pro levels", L => {
  for (const pro of [1, 2]) {
    const s = L.newGame(pro)
    assert.strictEqual(s.kind, "return")
    const m = L.leds(s, 0)
    const rows = [0, 1, 2].map(r => m.slice(r * 10, r * 10 + 10).map(v => v ? (v === 3 ? "C" : "d") : ".").join(""))
    assert.deepStrictEqual(rows, ["..d...d...", "C.d.d.....", "..d......d"], "pro " + pro)
  }
})

test("the screen stays put, then wraps 10 yards when the carrier runs off the edge", L => {
  const s = scrimmageAt(L, 30)
  s.receiver = null
  s.defenders = [{ x: 33, lane: 0 }, { x: 36, lane: 2 }]
  const vx0 = s.vx
  assert.strictEqual(s.carrier.x - vx0, 0)
  for (let i = 0; i < 9; i++) L.move(s, 1, 0) // 29 -> 38, the last column
  assert.strictEqual(s.vx, vx0, "no scrolling inside a screen")
  assert.strictEqual(s.carrier.x - s.vx, 9)
  L.move(s, 1, 0) // off the edge
  assert.strictEqual(s.vx, vx0 + 10)
  assert.strictEqual(s.carrier.x - s.vx, 0, "carrier reappears on the near edge")
  assert.deepStrictEqual(s.defenders.map(d => d.x - s.vx), [4, 7], "defenders keep their screen spots")
})

test("Pro 1 defense moves less often than Pro 2", L => {
  let moves = { 1: 0, 2: 0 }
  for (const pro of [1, 2]) {
    for (let t = 0; t < 300; t++) {
      const s = scrimmageAt(L, 30)
      s.pro = pro
      s.phase = "live"
      s.defenders = [{ x: 40, lane: 0 }, { x: 40, lane: 2 }, { x: 38, lane: 1 }]
      const before = JSON.stringify(s.defenders)
      L.defenseTick(s)
      s.defenders.forEach((d, i) => { if (JSON.stringify(d) !== JSON.stringify(JSON.parse(before)[i])) moves[pro]++ })
    }
  }
  assert.ok(moves[1] < moves[2] * 0.7, JSON.stringify(moves))
})

test("backing off the rear edge is blocked; only forward runs wrap", L => {
  const s = scrimmageAt(L, 30)
  s.receiver = null
  s.defenders = [{ x: 45, lane: 1 }]
  const vx0 = s.vx
  L.move(s, -1, 0) // carrier starts on column 0: can't back off the screen
  assert.strictEqual(s.carrier.x, 29)
  assert.strictEqual(s.vx, vx0)
  assert.strictEqual(s.phase, "live")
  const v = scrimmageAt(L, 70, 1) // visitor runs left; its rear edge is the right side
  v.receiver = null
  v.defenders = [{ x: 50, lane: 1 }]
  assert.strictEqual(v.carrier.x - v.vx, 9)
  L.move(v, 1, 0)
  assert.strictEqual(v.carrier.x, 71)
  assert.strictEqual(v.vx, 62)
})

// A greedy runner: step forward when it keeps out of reach, else sidestep.
function botStep(L, s) {
  const d = s.poss === 0 ? 1 : -1, c = s.carrier
  let best = null, bestScore = -1e9
  for (const [dx, dl] of [[d, 0], [0, -1], [0, 1], [0, 0]]) {
    const x = c.x + dx, l = c.lane + dl
    if (l < 0 || l > 2 || s.defenders.some(df => df.x === x && df.lane === l)) continue
    const minD = Math.min(99, ...s.defenders.map(df => Math.abs(df.x - x) + Math.abs(df.lane - l)))
    const score = (minD >= 2 ? 100 : minD * 10) + dx * d * 3 + minD
    if (score > bestScore) { bestScore = score; best = [dx, dl] }
  }
  if (best && (best[0] || best[1])) L.move(s, best[0], best[1])
}

test("Pro 1 is beatable: a simple running bot scores on a good share of drives", L => {
  const N = 300
  let tds = 0
  for (let g = 0; g < N; g++) {
    const s = L.newGame(1)
    for (let p = 0; p < 60 && s.poss === 0 && s.score[0] < 6 && s.phase !== "gameover"; p++) {
      L.move(s, 1, 0)
      // 3 keypresses per 1-second Pro 1 defense tick
      for (let t = 0; t < 3000 && s.phase === "live"; t++) t % 4 === 3 ? L.defenseTick(s) : botStep(L, s)
      s.events.length = 0
      if (s.phase === "dead") L.nextPlay(s)
    }
    if (s.score[0] >= 6) tds++
  }
  console.log("     Pro 1 drive touchdown rate for the bot: " + Math.round(100 * tds / N) + "%")
  assert.ok(tds / N > 0.15, "touchdown rate " + tds / N)
})

test("fuzz: random full games never break invariants", L => {
  for (let g = 0; g < 200; g++) {
    const s = L.newGame(g % 2 ? 2 : 1)
    let guard = 0
    while (s.phase !== "gameover" && guard++ < 200000) {
      const r = Math.random()
      if (s.phase === "dead") L.nextPlay(s)
      else if (s.phase === "pat" || (s.phase === "presnap" && s.kind === "scrimmage" && s.down === 4)) L.kick(s)
      else if (s.phase === "air" || s.phase === "kick") L.ballTick(s)
      else if (r < 0.05) L.pass(s)
      else if (r < 0.55) L.move(s, s.poss === 0 ? 1 : -1, 0)
      else if (r < 0.75) L.move(s, 0, Math.random() < 0.5 ? -1 : 1)
      else { L.defenseTick(s); L.receiverTick(s); L.clockTick(s) }
      s.events.length = 0
      if (s.carrier) {
        assert.ok(s.carrier.lane >= 0 && s.carrier.lane < 3)
        assert.ok(s.carrier.x >= -9 && s.carrier.x <= 109)
      }
      assert.ok(s.down >= 1 && s.down <= 4, "down " + s.down)
      assert.ok(s.clock >= 0)
      const col = s.carrier ? s.carrier.x - s.vx : 0
      if (s.carrier && s.phase === "live") assert.ok(col >= 0 && col < 10, "carrier off screen col " + col)
      const cells = new Set(s.defenders.map(d => d.x + ":" + d.lane))
      assert.strictEqual(cells.size, s.defenders.length, "two defenders share a cell")
    }
    assert.strictEqual(s.phase, "gameover", "game " + g + " never ended")
  }
})

console.log(passed + " passed")
