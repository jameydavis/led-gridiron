.pragma library
// LED Gridiron rules engine. Pure JS, no QML: BarWidget.qml owns timers and
// rendering and calls in here; test/logic.test.js runs it under node.
//
// World coordinates: x is a yard cell along the field. Cells 1..99 are the
// field, cells -9..0 are the HOME end zone and 100..109 the VISITOR end zone.
// HOME (team 0) attacks toward +x, VISITOR (team 1) toward -x. Lanes 0..2 run
// across the field. The LED display is a 10-column window (`vx` is the world
// x of its leftmost column) that follows the ball carrier.
//
// Every mutating call may push events onto s.events ({ sound, code, label }):
// the host drains them to play sounds and flash readout messages.

var COLS = 10
var LANES = 3
var MIN_X = -9
var MAX_X = 109
var QUARTER_SECONDS = 300
var RUNOFF_SECONDS = 8
var DEAD_MS = 1700

// Mutable so tests can make plays deterministic.
var random = Math.random

function rint(lo, hi) { return lo + Math.floor(random() * (hi - lo + 1)) }
function sign(v) { return v > 0 ? 1 : v < 0 ? -1 : 0 }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

function dir(s) { return s.poss === 0 ? 1 : -1 }
function dirOf(team) { return team === 0 ? 1 : -1 }
function other(team) { return team === 0 ? 1 : 0 }

// Has x reached the end zone `team` is attacking?
function inScoringZone(team, x) { return team === 0 ? x >= 100 : x <= 0 }
// Is x inside `team`'s own end zone?
function inOwnZone(team, x) { return team === 0 ? x <= 0 : x >= 100 }
// The x that is `yards` out from the goal `team` defends.
function ownYardLine(team, yards) { return team === 0 ? yards : 100 - yards }
function yardsToGoal(s) { return s.poss === 0 ? 100 - s.los : s.los }

function emit(s, sound, code, label) {
  s.events.push({ sound: sound || "", code: code || "", label: label || "" })
}

function newGame(pro) {
  var s = {
    pro: pro === 2 ? 2 : 1,
    quarter: 1,
    clock: QUARTER_SECONDS,
    score: [0, 0],
    poss: 0,
    openingReceiver: 0,
    down: 1,
    togo: 10,
    los: 25,
    phase: "presnap",      // presnap | live | air | kick | dead | pat | gameover
    kind: "return",        // return (kickoff return) | scrimmage
    carrier: null,
    receiver: null,
    defenders: [],
    ball: null,            // { path: [{x,lane}], i } while a pass or kick flies
    kickPlan: null,
    passed: false,
    vx: 0,
    next: null,            // what nextPlay() does once the dead-ball pause ends
    events: []
  }
  setupKickoff(s, 0)
  return s
}

// ---------------------------------------------------------------- setups

function setupKickoff(s, receivingTeam) {
  s.poss = receivingTeam
  var d = dir(s)
  var start = ownYardLine(receivingTeam, rint(6, 14))
  s.kind = "return"
  s.phase = "presnap"
  s.passed = false
  s.receiver = null
  s.ball = null
  s.kickPlan = null
  s.carrier = { x: start, lane: 1 }
  var shape = [[4, 0], [4, 1], [4, 2], [6, 0], [6, 2], [8, 1]]
  s.defenders = shape.map(function(p) { return { x: clamp(start + d * p[0], MIN_X, MAX_X), lane: p[1] } })
  s.los = start
  s.down = 1
  s.togo = 10
  snapViewport(s)
}

function setupScrimmage(s) {
  var d = dir(s), L = s.los
  s.kind = "scrimmage"
  s.phase = "presnap"
  s.passed = false
  s.ball = null
  s.kickPlan = null
  s.carrier = { x: L - d, lane: 1 }
  var wide = random() < 0.5 ? 0 : 2
  s.receiver = { x: L, lane: wide, depth: rint(4, 7) }
  // Three down linemen, two linebackers and a safety, with the linebackers
  // and safety shuffled a little so every snap does not look the same.
  var lb = random() < 0.5 ? [[3, 0], [3, 2]] : [[2, 0], [4, 2]]
  var shape = [[1, 0], [1, 1], [1, 2], lb[0], lb[1], [rint(5, 7), rint(0, 2)]]
  s.defenders = shape.map(function(p) { return { x: clamp(L + d * p[0], MIN_X, MAX_X), lane: p[1] } })
  snapViewport(s)
}

// Put the carrier at the near edge of the window, facing the open field.
function snapViewport(s) {
  var col = dir(s) > 0 ? 1 : COLS - 2
  s.vx = clamp(s.carrier.x - col, MIN_X, MAX_X - COLS + 1)
}

function followViewport(s) {
  if (!s.carrier) return
  var col = s.carrier.x - s.vx
  var lo = dir(s) > 0 ? 1 : 3
  var hi = dir(s) > 0 ? 6 : 8
  if (col > hi) s.vx = s.carrier.x - hi
  else if (col < lo) s.vx = s.carrier.x - lo
  s.vx = clamp(s.vx, MIN_X, MAX_X - COLS + 1)
}

// ---------------------------------------------------------------- queries

function defenderAt(s, x, lane) {
  for (var i = 0; i < s.defenders.length; i++)
    if (s.defenders[i].x === x && s.defenders[i].lane === lane) return i
  return -1
}

function occupied(s, x, lane) {
  if (defenderAt(s, x, lane) >= 0) return true
  if (s.carrier && s.carrier.x === x && s.carrier.lane === lane) return true
  if (s.receiver && s.receiver.x === x && s.receiver.lane === lane) return true
  return false
}

function canPass(s) {
  return s.phase === "live" && s.kind === "scrimmage" && !s.passed && !!s.receiver
    && (s.carrier.x - s.los) * dir(s) <= 0
}

function canKick(s) { return (s.phase === "presnap" && s.kind === "scrimmage") || s.phase === "pat" }

// Field-goal attempt distance from the current line of scrimmage, or 0 when
// out of range (the kick key punts instead).
function fieldGoalDistance(s) {
  var dist = yardsToGoal(s) + 17
  return dist <= 55 ? dist : 0
}

// ---------------------------------------------------------------- actions

function startPlay(s) {
  if (s.phase !== "presnap") return false
  s.phase = "live"
  emit(s, "snap")
  return true
}

// dx is world-x (+1 right / -1 left), dl is lane (-1 up / +1 down).
function move(s, dx, dl) {
  if (s.phase === "presnap") startPlay(s)
  if (s.phase !== "live") return
  var c = s.carrier
  var nx = clamp(c.x + dx, MIN_X, MAX_X)
  var nl = clamp(c.lane + dl, 0, LANES - 1)
  if (nx === c.x && nl === c.lane) return
  if (defenderAt(s, nx, nl) >= 0) {
    emit(s, "thud")
    tackle(s)
    return
  }
  if (s.receiver && s.receiver.x === nx && s.receiver.lane === nl) return
  c.x = nx
  c.lane = nl
  emit(s, "step")
  followViewport(s)
  if (inScoringZone(s.poss, c.x)) touchdown(s)
}

function pass(s) {
  if (!canPass(s)) return false
  var c = s.carrier, r = s.receiver
  var n = Math.max(Math.abs(r.x - c.x), Math.abs(r.lane - c.lane))
  var path = []
  for (var i = 1; i <= n; i++) {
    path.push({
      x: c.x + Math.round((r.x - c.x) * i / n),
      lane: c.lane + Math.round((r.lane - c.lane) * i / n)
    })
  }
  s.passed = true
  s.ball = { path: path, i: -1, type: "pass" }
  s.phase = "air"
  emit(s, "pass", "PASS")
  return true
}

function kick(s) {
  if (s.phase === "pat") return extraPoint(s)
  if (!canKick(s)) return false
  var d = dir(s)
  var fg = fieldGoalDistance(s)
  if (fg > 0) {
    var chance = clamp(0.97 - (fg - 20) * 0.021, 0.2, 0.97)
    s.kickPlan = { type: "fg", dist: fg, good: random() < chance }
  } else {
    s.kickPlan = { type: "punt", dist: rint(34, 50) }
  }
  // The ball flies straight downfield along the middle lane to the window edge.
  var path = []
  var c = s.carrier
  for (var x = c.x + d; x - s.vx >= 0 && x - s.vx < COLS; x += d) path.push({ x: x, lane: 1 })
  s.ball = { path: path, i: -1, type: "kick" }
  s.receiver = null
  s.phase = "kick"
  emit(s, "kick", fg > 0 ? "FG" : "PUNT", fg > 0 ? fg + " YARD ATTEMPT" : "PUNT")
  return true
}

function extraPoint(s) {
  if (s.phase !== "pat") return false
  var good = random() < 0.95
  if (good) {
    s.score[s.poss] += 1
    emit(s, "good", "GOOD", "EXTRA POINT GOOD")
  } else {
    emit(s, "nogood", "NO", "EXTRA POINT NO GOOD")
  }
  deadBall(s, { type: "kickoff", team: other(s.poss) })
  return true
}

// ---------------------------------------------------------------- ticks

// One pursuit step for the defense. Pro 2 moves more defenders per tick.
function defenseTick(s) {
  if (s.phase !== "live") return
  var c = s.carrier
  var moveChance = s.pro === 2 ? 0.75 : 0.55
  var order = s.defenders.map(function(_, i) { return i })
  order.sort(function(a, b) { return dist(s.defenders[a], c) - dist(s.defenders[b], c) })
  for (var k = 0; k < order.length; k++) {
    var df = s.defenders[order[k]]
    // The closest defender always pursues; the rest move on a dice roll.
    if (k > 0 && random() > moveChance) continue
    var ddx = sign(c.x - df.x), ddl = sign(c.lane - df.lane)
    var tries = []
    if (ddx !== 0 && ddl !== 0) tries = random() < 0.5 ? [[ddx, 0], [0, ddl]] : [[0, ddl], [ddx, 0]]
    else if (ddx !== 0) tries = [[ddx, 0], [ddx, random() < 0.5 ? -1 : 1]]
    else tries = [[0, ddl]]
    for (var t = 0; t < tries.length; t++) {
      var nx = df.x + tries[t][0], nl = df.lane + tries[t][1]
      if (nl < 0 || nl >= LANES) continue
      if (nx === c.x && nl === c.lane) {
        df.x = nx; df.lane = nl
        tackle(s)
        return
      }
      if (occupied(s, nx, nl)) continue
      df.x = nx; df.lane = nl
      break
    }
  }
}

function dist(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.lane - b.lane) }

// The receiver runs a straight route to its depth, then drifts a lane.
function receiverTick(s) {
  if (s.phase !== "live" || !s.receiver || s.passed) return
  var r = s.receiver, d = dir(s)
  if ((r.x - s.los) * d < r.depth) {
    if (!occupied(s, r.x + d, r.lane)) r.x += d
  } else if (random() < 0.3) {
    var nl = r.lane === 1 ? (random() < 0.5 ? 0 : 2) : 1
    if (!occupied(s, r.x, nl)) r.lane = nl
  }
}

function clockTick(s) {
  if ((s.phase === "live" || s.phase === "air") && s.clock > 0) s.clock -= 1
}

// Advance a pass or kick one cell. Returns true while the ball is still flying.
function ballTick(s) {
  if (!s.ball) return false
  s.ball.i += 1
  if (s.ball.type === "pass") {
    if (s.ball.i >= s.ball.path.length) { catchOrDrop(s); return false }
    var cell = s.ball.path[s.ball.i]
    if (defenderAt(s, cell.x, cell.lane) >= 0) { interception(s, cell.x); return false }
    return true
  }
  if (s.ball.i >= s.ball.path.length) { resolveKick(s); return false }
  return true
}

// ---------------------------------------------------------------- outcomes

function catchOrDrop(s) {
  var r = s.receiver
  var covered = s.defenders.some(function(df) {
    return Math.abs(df.x - r.x) <= 1 && Math.abs(df.lane - r.lane) <= 1
  })
  s.ball = null
  if (covered && random() < 0.35) {
    emit(s, "incomplete", "INC", "INCOMPLETE")
    advanceDown(s, s.los, false)
    return
  }
  s.carrier = { x: r.x, lane: r.lane }
  s.receiver = null
  s.phase = "live"
  emit(s, "catch", "CATCH", "PASS COMPLETE")
  followViewport(s)
  if (inScoringZone(s.poss, s.carrier.x)) touchdown(s)
}

function interception(s, x) {
  s.ball = null
  emit(s, "intercept", "INT", "INTERCEPTED")
  var team = other(s.poss)
  var spot = inOwnZone(team, x) ? ownYardLine(team, 20) : x
  deadBall(s, { type: "possession", team: team, los: spot })
}

function resolveKick(s) {
  var plan = s.kickPlan, d = dir(s), receiving = other(s.poss)
  s.ball = null
  s.kickPlan = null
  if (plan.type === "fg") {
    if (plan.good) {
      s.score[s.poss] += 3
      emit(s, "good", "GOOD", "FIELD GOAL GOOD")
      deadBall(s, { type: "kickoff", team: receiving })
    } else {
      emit(s, "nogood", "NO", "NO GOOD")
      var spot = yardsToGoal(s) < 20 ? ownYardLine(receiving, 20) : s.los
      deadBall(s, { type: "possession", team: receiving, los: spot })
    }
    return
  }
  var land = s.los + d * plan.dist
  if (inScoringZone(s.poss, land)) {
    emit(s, "", "PUNT", "TOUCHBACK")
    land = ownYardLine(receiving, 20)
  } else {
    emit(s, "", "PUNT", plan.dist + " YARD PUNT")
  }
  deadBall(s, { type: "possession", team: receiving, los: land })
}

function tackle(s) {
  var spot = s.carrier.x
  if (inOwnZone(s.poss, spot)) {
    var scorer = other(s.poss)
    s.score[scorer] += 2
    emit(s, "safety", "SAF", "SAFETY")
    deadBall(s, { type: "kickoff", team: scorer })
    return
  }
  emit(s, "tackle", "", "TACKLED")
  advanceDown(s, spot, true)
}

function touchdown(s) {
  s.score[s.poss] += 6
  emit(s, "touchdown", "TD", "TOUCHDOWN")
  deadBall(s, { type: "pat" })
}

// Spot the ball after a run, catch or incompletion and work out the downs.
function advanceDown(s, spot, runoff) {
  if (s.kind === "return") {
    s.los = spot
    s.down = 1
    s.togo = Math.min(10, yardsToGoal(s))
    deadBall(s, { type: "scrimmage" }, runoff)
    return
  }
  var gain = (spot - s.los) * dir(s)
  s.los = spot
  if (gain >= s.togo) {
    s.down = 1
    s.togo = Math.min(10, yardsToGoal(s))
    emit(s, "firstdown", "1ST", "FIRST DOWN")
    deadBall(s, { type: "scrimmage" }, runoff)
    return
  }
  s.togo -= gain
  s.down += 1
  if (s.down > 4) {
    emit(s, "turnover", "DOWN", "TURNOVER ON DOWNS")
    deadBall(s, { type: "possession", team: other(s.poss), los: spot }, runoff)
    return
  }
  deadBall(s, { type: "scrimmage" }, runoff)
}

function deadBall(s, next, runoff) {
  s.phase = "dead"
  s.ball = null
  s.next = next
  if (runoff) s.clock = Math.max(0, s.clock - RUNOFF_SECONDS)
}

// Called by the host once the dead-ball pause is over.
function nextPlay(s) {
  if (s.phase !== "dead") return
  var next = s.next || { type: "scrimmage" }
  s.next = null
  if (next.type === "pat") {
    s.phase = "pat"
    s.receiver = null
    s.defenders = s.defenders.slice(0, 3)
    emit(s, "", "PAT", "PRESS KICK FOR EXTRA POINT")
    return
  }
  if (s.clock <= 0) {
    if (s.quarter >= 4) {
      s.phase = "gameover"
      s.carrier = null; s.receiver = null; s.defenders = []
      var label = s.score[0] === s.score[1] ? "FINAL: TIE GAME"
        : s.score[0] > s.score[1] ? "FINAL: HOME WINS" : "FINAL: VISITOR WINS"
      emit(s, "gameover", "END", label)
      return
    }
    s.quarter += 1
    s.clock = QUARTER_SECONDS
    emit(s, "whistle", "", s.quarter === 3 ? "HALFTIME" : "END OF QUARTER " + (s.quarter - 1))
    if (s.quarter === 3) { setupKickoff(s, other(s.openingReceiver)); return }
  }
  if (next.type === "kickoff") { setupKickoff(s, next.team); return }
  if (next.type === "possession") {
    s.poss = next.team
    s.los = next.los
    s.down = 1
    s.togo = Math.min(10, yardsToGoal(s))
  }
  setupScrimmage(s)
}

// ---------------------------------------------------------------- display

// LED levels for the 3x10 window, row-major: 0 off, 1 defender, 2 receiver,
// 3 ball carrier, 4 ball in flight. `blink` is the host's flicker phase.
function leds(s, blink) {
  var out = []
  for (var i = 0; i < COLS * LANES; i++) out.push(0)
  function put(x, lane, level) {
    var col = x - s.vx
    if (col < 0 || col >= COLS || lane < 0 || lane >= LANES) return
    out[lane * COLS + col] = Math.max(out[lane * COLS + col], level)
  }
  for (var k = 0; k < s.defenders.length; k++) put(s.defenders[k].x, s.defenders[k].lane, 1)
  if (s.receiver && blink % 2 === 0) put(s.receiver.x, s.receiver.lane, 2)
  if (s.carrier && !(s.ball && s.ball.type === "pass" && s.ball.i >= 0)) {
    var waiting = s.phase === "presnap" || s.phase === "dead" || s.phase === "pat"
    if (!waiting || blink % 4 !== 3) put(s.carrier.x, s.carrier.lane, 3)
  }
  if (s.ball && s.ball.i >= 0 && s.ball.i < s.ball.path.length) {
    var b = s.ball.path[s.ball.i]
    put(b.x, b.lane, 4)
  }
  return out
}

// "H 35", "V 20" or "50": which side of midfield the ball is on.
function fieldPosition(s) {
  if (s.los === 50) return { side: "", yard: 50 }
  if (s.los < 50) return { side: "H", yard: Math.max(1, s.los) }
  return { side: "V", yard: Math.max(1, 100 - s.los) }
}

function clockText(s) {
  var m = Math.floor(s.clock / 60), sec = s.clock % 60
  return m + ":" + (sec < 10 ? "0" : "") + sec
}
