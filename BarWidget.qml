// LED Gridiron: a late-'70s style handheld LED football game for Omarchy.
//
// The bar shows a football icon; click it (or bind a key to
// `omarchy-shell jameydavis.led-gridiron toggle`) and the handheld opens
// centered on the focused monitor with exclusive keyboard focus. Rules live
// in Logic.js; this file owns timers, input, sound, and the device face.
import QtQuick
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import Quickshell.Hyprland
import qs.Commons
import qs.Ui
import "Logic.js" as Logic

Panel {
  id: root
  moduleName: "jameydavis.led-gridiron"
  ipcTarget: "jameydavis.led-gridiron"
  manageIpc: false

  // Qt 6.12 ships a built-in `Color` that shadows qs.Commons Color, so shells
  // patched for it export the theme as ThemeColor; use whichever exists.
  readonly property var theme: typeof ThemeColor !== "undefined" ? ThemeColor : Color
  readonly property color foreground: bar ? bar.foreground : theme.foreground
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  readonly property color ledRed: "#ff3b24"
  readonly property color ink: "#e0533e"        // silkscreen labels on the face
  readonly property color inkDim: "#7a2a20"
  readonly property real cell: Style.space(46)
  readonly property real u: Style.space(10)     // general layout unit

  // ------------------------------------------------------------- game state

  property var s: Logic.newGame(1)
  property int rev: 0          // bumped after every mutation of `s`
  property string phase: s.phase
  property int blink: 0
  property bool fullOpen: false
  property bool paused: false
  property bool helpOpen: false
  property bool muted: false
  readonly property bool active: fullOpen && !paused && !helpOpen

  readonly property var ledLevels: { rev; blink; return Logic.leds(s, blink) }

  // Transient readout content: a flashed message or a STATUS / SCORE page.
  property string flashText: ""
  property string flashLabel: ""
  property int statusPage: -1
  property bool scoreShown: false
  property double lastNewGamePress: 0
  property bool statusHeld: false
  property double statusPressedAt: 0
  property bool scoreHeld: false
  property double scorePressedAt: 0

  function sync() {
    var events = s.events.splice(0, s.events.length)
    var best = "", bestRank = -1
    for (var i = 0; i < events.length; i++) {
      var e = events[i]
      var rank = soundRank.indexOf(e.sound)
      if (rank > bestRank) { bestRank = rank; best = e.sound }
      if (e.code || e.label) flash(codeText[e.code] || "", e.label)
    }
    if (best) play(best)
    phase = s.phase
    rev++
  }

  function flash(text, label) {
    flashText = text
    flashLabel = label || ""
    statusPage = -1
    scoreShown = false
    flashTimer.restart()
  }

  // Lowest to highest: when one action makes several sounds, play the top one.
  readonly property var soundRank: ["blip", "step", "snap", "thud", "pass", "kick", "catch", "incomplete",
    "tackle", "turnover", "firstdown", "intercept", "nogood", "good", "whistle", "safety", "touchdown", "gameover"]

  readonly property var codeText: ({
    "TD": " td ", "GOOD": "Good", "NO": " no ", "INT": " Int", "SAF": "SAFE", "1ST": " 1St",
    "DOWN": "dOnE", "PASS": "PASS", "FG": " FG ", "PUNT": "PUnt", "CATCH": "", "INC": " Inc",
    "PAT": " PAt", "END": " End"
  })

  // ------------------------------------------------------------- sound

  readonly property string soundDir: decodeURIComponent(String(Qt.resolvedUrl("sounds/")).replace(/^file:\/\//, ""))

  // Keep the audio sink awake while the game is open. Idle sinks suspend after
  // a few seconds, and on DSP-backed outputs (Apple Silicon speakers) waking
  // up again swallows the next short beeps, so sound seemed to cut out
  // between plays. A silent 8 kHz mono stream costs well under 1% CPU.
  Process {
    running: root.fullOpen && !root.muted
    command: ["sh", "-c", "exec pw-cat --playback --raw --rate 8000 --channels 1 --format s16 "
      + "-P '{ media.name = led-gridiron-keepalive }' - < /dev/zero"]
  }

  function play(name) {
    if (muted || !name) return
    Quickshell.execDetached(["pw-play", "--volume=0.7", soundDir + name + ".wav"])
  }

  // ------------------------------------------------------------- readout

  function pad2(n, blankLead) {
    n = Math.max(0, Math.min(99, n))
    return (n < 10 ? (blankLead ? " " : "0") : "") + n
  }

  // { text: 4 chars, colon: bool, label: string }
  readonly property var readout: {
    rev
    if (helpOpen) return { text: "HELP", colon: false, label: "KEYS" }
    if (flashText !== "" || flashLabel !== "") {
      return { text: flashText !== "" ? flashText : statusText(1).text, colon: false, label: flashLabel }
    }
    if (scoreShown || phase === "gameover") return scoreText()
    if (statusPage >= 0) return statusText(statusPage)
    if (paused) return { text: "PAUS", colon: false, label: "PAUSED - P TO RESUME" }
    if (phase === "dead") {
      var after = statusText(1)
      return { text: after.text, colon: false, label: "PRESS Q (STATUS) FOR NEXT PLAY" }
    }
    if (phase === "pat") return { text: " PAt", colon: false, label: "EXTRA POINT - PRESS KICK" }
    if (phase === "presnap" && s.kind === "return")
      return { text: " " + Logic.clockText(s).replace(":", ""), colon: true,
               label: (s.poss === 0 ? "HOME" : "VISITOR") + " KICKOFF RETURN - MOVE TO START" }
    if (phase === "presnap") return statusText(1)
    return { text: " " + Logic.clockText(s).replace(":", ""), colon: true, label: "QUARTER " + s.quarter }
  }

  function statusText(page) {
    if (page === 0) {
      var fp = Logic.fieldPosition(s)
      return { text: (fp.side || " ") + " " + pad2(fp.yard), colon: false,
               label: fp.side === "" ? "BALL ON THE 50" : "BALL ON " + (fp.side === "H" ? "HOME " : "VISITOR ") + fp.yard }
    }
    if (page === 1) {
      var goal = s.togo >= Logic.yardsToGoal(s)
      return { text: s.down + "-" + pad2(s.togo, true), colon: false,
               label: ["", "1ST", "2ND", "3RD", "4TH"][s.down] + " DOWN & " + (goal ? "GOAL" : s.togo) }
    }
    return { text: " " + Logic.clockText(s).replace(":", ""), colon: true, label: "QUARTER " + s.quarter + " - TIME LEFT" }
  }

  function scoreText() {
    return { text: pad2(s.score[0], true) + pad2(s.score[1], true), colon: false,
             label: phase === "gameover" ? (flashLabel || finalLabel()) + " - N FOR NEW GAME" : "HOME  -  VISITOR" }
  }

  function finalLabel() {
    return s.score[0] === s.score[1] ? "TIE GAME" : s.score[0] > s.score[1] ? "HOME WINS" : "VISITOR WINS"
  }

  // ------------------------------------------------------------- input

  function handleKey(event) {
    var k = event.key
    // Every button acts once per press; a held Q just keeps STATUS showing.
    if (keyRepeat) {
      if (k === Qt.Key_Q) qReleaseTimer.stop()
      if (k === Qt.Key_R) rReleaseTimer.stop()
      return true
    }
    if (k === Qt.Key_Escape) {
      if (helpOpen) { helpOpen = false } else root.closeFullWindow()
      return true
    }
    if (k === Qt.Key_H || k === Qt.Key_Question || k === Qt.Key_F1) {
      helpOpen = !helpOpen
      play("blip")
      return true
    }
    if (helpOpen) { helpOpen = false; return true }

    if (k === Qt.Key_P) { paused = !paused; play("blip"); rev++; return true }
    if (k === Qt.Key_M) {
      muted = !muted
      if (!muted) play("blip")
      flash(muted ? " OFF" : " On ", muted ? "SOUND OFF" : "SOUND ON")
      return true
    }
    if (k === Qt.Key_N) {
      var now = Date.now()
      if (phase === "gameover" || now - lastNewGamePress < 2500) {
        lastNewGamePress = 0
        s = Logic.newGame(s.pro)
        paused = false
        flash("", "NEW GAME - PRO " + s.pro)
        play("whistle")
        sync()
      } else {
        lastNewGamePress = now
        flash(" n ?", "PRESS N AGAIN FOR A NEW GAME")
      }
      return true
    }
    if (k === Qt.Key_1 || k === Qt.Key_2) {
      if (phase === "live" || phase === "air" || phase === "kick") return true
      s.pro = k === Qt.Key_1 ? 1 : 2
      play("blip")
      flash("Pro" + s.pro, "PRO " + s.pro + (s.pro === 1 ? " - SLOW DEFENSE" : " - FAST DEFENSE"))
      rev++
      return true
    }
    if (k === Qt.Key_Q) {
      // STATUS can be tapped or held. Holding keeps the readout cycling
      // through the status pages until the key is let go.
      statusHeld = true
      statusPressedAt = Date.now()
      // After the whistle, STATUS also resets the field for the next play,
      // just like the handhelds.
      flashText = ""; flashLabel = ""
      if (phase === "dead" && !paused) {
        // Any message from the reset (end of quarter, halftime) still shows first.
        Logic.nextPlay(s)
        sync()
      } else {
        play("blip")
      }
      scoreShown = false
      statusPage = 0
      statusTimer.restart()
      return true
    }
    if (k === Qt.Key_R) {
      // SCORE can be tapped (shows for a moment) or held (shows until let go).
      scoreHeld = true
      scorePressedAt = Date.now()
      statusPage = -1
      flashText = ""; flashLabel = ""
      scoreShown = true
      statusTimer.restart()
      play("blip")
      return true
    }
    if (paused) return true

    // Movement: one step per press, like the real thumb buttons.
    var dx = 0, dl = 0
    if (k === Qt.Key_W || k === Qt.Key_Up) dl = -1
    else if (k === Qt.Key_S || k === Qt.Key_Down) dl = 1
    else if (k === Qt.Key_A || k === Qt.Key_Left) dx = -1
    else if (k === Qt.Key_D || k === Qt.Key_Right) dx = 1
    if (dx !== 0 || dl !== 0) {
      Logic.move(s, dx, dl)
      sync()
      return true
    }
    if (k === Qt.Key_Space) {
      if (Logic.pass(s)) sync()
      return true
    }
    if (k === Qt.Key_E) {
      if (Logic.kick(s)) sync()
      return true
    }
    return false
  }

  // ------------------------------------------------------------- timers

  Timer {
    interval: 110; repeat: true; running: root.fullOpen
    onTriggered: root.blink = (root.blink + 1) % 1000
  }
  Timer {
    interval: root.s.pro === 2 ? 360 : 1000
    repeat: true
    running: root.active && root.phase === "live"
    onTriggered: { Logic.defenseTick(root.s); root.sync() }
  }
  Timer {
    interval: 300; repeat: true
    running: root.active && root.phase === "live"
    onTriggered: { Logic.receiverTick(root.s); root.rev++ }
  }
  Timer {
    interval: 250; repeat: true
    running: root.active && (root.phase === "live" || root.phase === "air")
    onTriggered: { Logic.clockTick(root.s); root.rev++ }
  }
  Timer {
    interval: 65; repeat: true
    running: root.active && (root.phase === "air" || root.phase === "kick")
    onTriggered: { Logic.ballTick(root.s); root.sync() }
  }
  Timer {
    id: flashTimer
    interval: 1600
    onTriggered: { root.flashText = ""; root.flashLabel = "" }
  }
  Timer {
    id: statusTimer
    interval: 1400
    onTriggered: {
      if (root.statusPage >= 0 && root.statusPage < 2) { root.statusPage++; restart() }
      else if (root.statusPage >= 0 && root.statusHeld) { root.statusPage = 0; restart() }
      else if (root.statusPage < 0 && root.scoreShown && root.scoreHeld) restart()
      else { root.statusPage = -1; root.scoreShown = false }
    }
  }

  // Held keys arrive as release/press pairs that are not always flagged as
  // auto-repeat (seen on Hyprland), so a press within a few ms of the same
  // key's release counts as a repeat, and Q's release waits that long
  // before ending a hold.
  readonly property int repeatGapMs: 40
  property var keyUpAt: ({})
  property bool keyRepeat: false

  function isRepeat(event) {
    if (event.isAutoRepeat) return true
    var up = keyUpAt[event.key]
    return up !== undefined && Date.now() - up < repeatGapMs
  }

  function handleKeyRelease(event) {
    keyUpAt[event.key] = Date.now()
    if (event.isAutoRepeat) return false
    if (event.key === Qt.Key_Q && statusHeld) { qReleaseTimer.restart(); return true }
    if (event.key === Qt.Key_R && scoreHeld) { rReleaseTimer.restart(); return true }
    return false
  }

  Timer {
    id: rReleaseTimer
    interval: root.repeatGapMs
    onTriggered: {
      root.scoreHeld = false
      if (root.scoreShown && Date.now() - root.scorePressedAt >= 600) {
        statusTimer.stop()
        root.scoreShown = false
      }
    }
  }

  Timer {
    id: qReleaseTimer
    interval: root.repeatGapMs
    onTriggered: {
      root.statusHeld = false
      // A tap lets the pages finish their cycle; letting go of a hold clears
      // the readout right away.
      if (Date.now() - root.statusPressedAt >= 600) {
        statusTimer.stop()
        root.statusPage = -1
      }
    }
  }


  // ------------------------------------------------------------- open state

  function open() { root.openFullWindow() }
  function close() { root.closeFullWindow() }
  function toggle() { root.fullOpen ? root.closeFullWindow() : root.openFullWindow() }
  function openFullWindow() { root.fullOpen = true; root.rev++ }
  function closeFullWindow() {
    root.fullOpen = false
    root.helpOpen = false
    root.statusHeld = false
    root.scoreHeld = false
    // Closing mid-play pauses so you come back to the same snap.
    if (root.phase === "live" || root.phase === "air" || root.phase === "kick") root.paused = true
  }

  readonly property var fullScreen: {
    var mon = Hyprland.focusedMonitor
    if (mon) {
      var name = String(mon.name || "")
      for (var i = 0; i < Quickshell.screens.length; i++)
        if (String(Quickshell.screens[i].name) === name) return Quickshell.screens[i]
    }
    return Quickshell.screens.length > 0 ? Quickshell.screens[0] : null
  }

  // ------------------------------------------------------------- bar button

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    active: root.fullOpen
    slotSize: Style.bar.iconSlot
    tooltipText: "LED Gridiron"
    iconComponent: Component {
      Item {
        // Nerd Font "fa-football" in the bar's foreground color, like the
        // other bar icons.
        Text {
          anchors.centerIn: parent
          textFormat: Text.PlainText
          text: "\ued69"
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.icon
        }
      }
    }
    onPressed: function(b) { root.toggle() }
  }

  // ------------------------------------------------------------- the handheld

  PanelWindow {
    id: fullWindow
    visible: root.fullOpen
    screen: root.fullScreen
    color: "transparent"
    exclusionMode: ExclusionMode.Ignore
    implicitWidth: device.width
    implicitHeight: device.height
    WlrLayershell.namespace: "jameydavis-led-gridiron"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: root.fullOpen ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None

    onVisibleChanged: if (visible) Qt.callLater(function() { if (root.fullOpen) keyCatcher.forceActiveFocus() })

    HyprlandFocusGrab {
      active: root.fullOpen
      windows: [fullWindow]
      onCleared: root.closeFullWindow()
    }

    Rectangle {
      id: device
      width: face.implicitWidth + root.u * 4
      height: face.implicitHeight + root.u * 3.2
      radius: Math.max(Style.cornerRadius, root.u * 1.4)
      color: root.theme.popups.background
      border.width: 1
      border.color: root.theme.popups.border

      // Swallow clicks on the device, and use them to take keyboard focus
      // back if something else grabbed it while the game was open.
      MouseArea {
        anchors.fill: parent
        acceptedButtons: Qt.AllButtons
        onPressed: keyCatcher.forceActiveFocus()
      }

      Item {
        id: keyCatcher
        anchors.fill: parent
        focus: true
        Keys.priority: Keys.BeforeItem
        Keys.onPressed: function(event) {
          root.keyRepeat = root.isRepeat(event)
          if (root.handleKey(event)) event.accepted = true
        }
        Keys.onReleased: function(event) { if (root.handleKeyRelease(event)) event.accepted = true }
      }

      ColumnLayout {
        id: face
        anchors.centerIn: parent
        spacing: root.u * 1.1

        // ---- readout row: possession lamps around the 7-segment display
        RowLayout {
          Layout.alignment: Qt.AlignHCenter
          spacing: root.u * 2.2

          Lamp { text: "HOME"; lit: root.s.poss === 0 && root.phase !== "gameover"; Layout.alignment: Qt.AlignVCenter }

          Rectangle {
            Layout.alignment: Qt.AlignVCenter
            implicitWidth: digits.implicitWidth + root.u * 2
            implicitHeight: digits.implicitHeight + root.u * 1.4
            radius: root.u * 0.4
            color: "#120403"
            border.width: 2
            border.color: "#2a0d0a"

            Row {
              id: digits
              anchors.centerIn: parent
              spacing: root.u * 0.7
              Repeater {
                model: 4
                Row {
                  spacing: root.u * 0.7
                  SevenSeg {
                    unit: root.u * 0.42
                    onColor: root.ledRed
                    ch: root.readout.text.charAt(index) || " "
                  }
                  // Clock colon sits between the minutes and seconds digits.
                  Column {
                    visible: index === 1
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: root.u * 0.9
                    Repeater {
                      model: 2
                      Rectangle {
                        width: root.u * 0.42; height: width; radius: width / 2
                        color: root.readout.colon ? root.ledRed : "#2e0a08"
                      }
                    }
                  }
                }
              }
            }
          }

          Lamp { text: "VISITOR"; lit: root.s.poss === 1 && root.phase !== "gameover"; Layout.alignment: Qt.AlignVCenter }
        }

        PlainLabel {
          Layout.alignment: Qt.AlignHCenter
          text: root.readout.label
          color: root.ink
          font.pixelSize: root.u * 1.15
        }

        // ---- the field
        Field {
          Layout.alignment: Qt.AlignHCenter
          cell: root.cell
          leds: root.ledLevels
          vx: { root.rev; return root.s.vx }
        }

        // ---- direction arrows + small status lamps
        RowLayout {
          Layout.fillWidth: true
          spacing: root.u * 1.6
          Lamp { text: "PRO 1"; lit: root.s.pro === 1 }
          Lamp { text: "PRO 2"; lit: root.s.pro === 2 }
          Lamp { text: "SOUND"; lit: !root.muted }
          Item { Layout.fillWidth: true }
          PlainLabel {
            text: root.s.poss === 0 ? "HOME  ▶▶" : "◀◀  VISITOR"
            color: root.inkDim
            font.pixelSize: root.u * 1.0
          }
          Item { Layout.fillWidth: true }
          PlainLabel {
            text: root.helpOpen ? "H  HIDE KEYS" : "H  KEYS"
            color: root.inkDim
            font.pixelSize: root.u * 1.0
          }
        }

        // ---- key legend: the window grows downward to show it. Everything
        // is sized to the panel's width (the field's width) so nothing spills.
        Rectangle {
          id: legendBox
          visible: root.helpOpen
          Layout.fillWidth: true
          readonly property real pad: root.u * 1.4
          implicitHeight: legendCol.implicitHeight + pad * 2
          radius: root.u * 0.5
          color: "#120403"
          border.width: 1
          border.color: "#2a0d0a"

          Column {
            id: legendCol
            x: legendBox.pad
            y: legendBox.pad
            width: legendBox.width - legendBox.pad * 2
            spacing: root.u * 1.4

            GridLayout {
              width: parent.width
              columns: 2
              columnSpacing: root.u * 1.4
              rowSpacing: root.u * 0.9

              KeyRow { keys: ["W", "A", "S", "D"]; label: "MOVE" }
              KeyRow { keys: ["SPACE"]; label: "PASS" }
              KeyRow { keys: ["E"]; label: "KICK" }
              KeyRow { keys: ["Q"]; label: "STATUS / NEXT PLAY" }
              KeyRow { keys: ["R"]; label: "SCORE" }
              KeyRow { keys: ["1", "2"]; label: "PRO 1 / PRO 2" }
              KeyRow { keys: ["P"]; label: "PAUSE" }
              KeyRow { keys: ["M"]; label: "SOUND" }
              KeyRow { keys: ["N", "N"]; label: "NEW GAME" }
              KeyRow { keys: ["H"]; label: "KEYS" }
              KeyRow { keys: ["ESC"]; label: "CLOSE" }
            }

            PlainLabel {
              width: parent.width
              wrapMode: Text.WordWrap
              color: root.inkDim
              font.pixelSize: root.u * 1.0
              font.letterSpacing: 0.8
              lineHeight: 1.15
              text: "YOU ARE THE BRIGHT PLAYER. ANY MOVE SNAPS THE BALL (ARROW KEYS WORK TOO). RUN OFF "
                + "THE FRONT EDGE AND THE FIELD WRAPS TO THE NEXT 10 YARDS. PASS TO THE BLINKING RECEIVER "
                + "BEFORE YOU CROSS THE LINE. AFTER THE WHISTLE PRESS STATUS TO SET UP THE NEXT PLAY; "
                + "HOLD STATUS OR SCORE TO KEEP THEM ON THE DISPLAY. KICK BEFORE THE SNAP: A FIELD GOAL "
                + "INSIDE THE OPPONENT'S 38, A PUNT FROM ANYWHERE ELSE. HOME RUNS RIGHT, VISITOR RUNS LEFT."
            }
          }
        }
      }
    }
  }

  // ------------------------------------------------------------- small parts

  component PlainLabel: Text {
    textFormat: Text.PlainText
    font.family: root.fontFamily
    font.bold: true
    font.letterSpacing: 1.2
  }

  component Lamp: Row {
    property string text: ""
    property bool lit: false
    spacing: root.u * 0.5
    Rectangle {
      anchors.verticalCenter: parent.verticalCenter
      width: root.u * 0.8; height: width; radius: width / 2
      color: parent.lit ? root.ledRed : "#3a0c09"
    }
    Text {
      anchors.verticalCenter: parent.verticalCenter
      textFormat: Text.PlainText
      text: parent.text
      color: parent.lit ? root.ink : root.inkDim
      font.family: root.fontFamily
      font.bold: true
      font.letterSpacing: 1.2
      font.pixelSize: root.u * 1.0
    }
  }

  // One legend entry: keycaps, then a label that takes the rest of the
  // column (eliding rather than overflowing if a translation runs long).
  component KeyRow: Item {
    id: keyRow
    property var keys: []
    property string label: ""
    Layout.fillWidth: true
    Layout.preferredWidth: 1      // equal columns
    implicitHeight: caps.implicitHeight
    Row {
      id: caps
      spacing: root.u * 0.4
      Repeater {
        model: keyRow.keys
        Keycap { label: modelData; unit: root.u; ink: root.ink; fontFamily: root.fontFamily }
      }
    }
    Text {
      anchors.left: caps.right
      anchors.leftMargin: root.u * 0.9
      anchors.right: parent.right
      anchors.verticalCenter: caps.verticalCenter
      elide: Text.ElideRight
      textFormat: Text.PlainText
      text: keyRow.label
      color: root.ink
      font.family: root.fontFamily
      font.bold: true
      font.letterSpacing: 1.0
      font.pixelSize: root.u * 1.05
    }
  }

  // ------------------------------------------------------------- IPC
  // omarchy-shell jameydavis.led-gridiron toggle

  IpcHandler {
    target: root.ipcTarget
    function open() { root.open() }
    function close() { root.close() }
    function show() { root.open() }
    function hide() { root.close() }
    function toggle() { root.toggle() }
  }
}
