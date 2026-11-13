// The 3x10 red LED playing field behind smoked plastic. Unlit LEDs stay
// faintly visible like the real thing; painted yard lines and end-zone
// shading scroll with the window (`vx` = world x of the leftmost column).
import QtQuick
import QtQuick.Effects

Rectangle {
  id: field

  property var leds: []
  property int vx: 0
  property real cell: 46
  readonly property int cols: 10
  readonly property int lanes: 3

  implicitWidth: cols * cell + cell * 0.5
  implicitHeight: lanes * cell + cell * 0.5
  radius: cell * 0.12
  color: "#120403"
  border.width: 2
  border.color: "#2a0d0a"

  readonly property real ox: cell * 0.25
  readonly property real oy: cell * 0.25

  // End zones: world x <= 0 (home) and >= 100 (visitor).
  Repeater {
    model: field.cols
    Rectangle {
      readonly property int wx: field.vx + index
      visible: wx <= 0 || wx >= 100
      x: field.ox + index * field.cell
      y: field.oy
      width: field.cell
      height: field.lanes * field.cell
      color: "#220807"
    }
  }

  // Yard lines on every 5, goal lines brighter, drawn on each cell's leading edge.
  Repeater {
    model: field.cols + 1
    Rectangle {
      readonly property int wx: field.vx + index
      readonly property bool goal: wx === 1 || wx === 100
      visible: wx >= 1 && wx <= 100 && (goal || wx % 5 === 0)
      x: field.ox + index * field.cell - width / 2
      y: field.oy - field.cell * 0.12
      width: goal ? 3 : (wx % 10 === 0 ? 2 : 1)
      height: field.lanes * field.cell + field.cell * 0.24
      color: goal ? "#5c1d16" : (wx % 10 === 0 ? "#3d1410" : "#2b0e0b")
    }
  }

  // Unlit LED segments: always faintly visible behind the smoked plastic.
  Repeater {
    model: field.cols * field.lanes
    Rectangle {
      readonly property int level: field.leds.length > index ? field.leds[index] : 0
      visible: level === 0
      x: field.ox + (index % field.cols) * field.cell + (field.cell - width) / 2
      y: field.oy + Math.floor(index / field.cols) * field.cell + (field.cell - height) / 2
      width: field.cell * 0.66
      height: field.cell * 0.3
      radius: height / 2
      color: "#3a0c09"
    }
  }

  // The glow: blurred copies of the lit layer drawn underneath it, a wide
  // soft bloom plus a tighter halo. The blur keeps each LED's own color, so
  // the bright ball carrier blooms more than the dimmer defenders.
  MultiEffect {
    source: lit
    x: lit.x; y: lit.y; width: lit.width; height: lit.height
    autoPaddingEnabled: false
    blurEnabled: true
    blurMax: 64
    blur: 1.0
    blurMultiplier: 0.6
    brightness: 0.5
    saturation: 0.3
  }
  MultiEffect {
    source: lit
    x: lit.x; y: lit.y; width: lit.width; height: lit.height
    autoPaddingEnabled: false
    blurEnabled: true
    blurMax: 20
    blur: 0.9
    brightness: 0.3
  }

  // Lit LEDs, rendered into their own layer so the glow can sample them.
  // The layer has a fixed margin for the glow to spread into, so the blurred
  // copies and the crisp LEDs share exactly the same geometry.
  readonly property real glowPad: cell * 1.4
  Item {
    id: lit
    x: -field.glowPad
    y: -field.glowPad
    width: field.width + field.glowPad * 2
    height: field.height + field.glowPad * 2
    layer.enabled: true

    Repeater {
      model: field.cols * field.lanes
      Item {
        readonly property int level: field.leds.length > index ? field.leds[index] : 0
        visible: level > 0
        x: field.glowPad + field.ox + (index % field.cols) * field.cell
        y: field.glowPad + field.oy + Math.floor(index / field.cols) * field.cell
        width: field.cell
        height: field.cell

        // Players are horizontal pill-shaped LED segments with rounded ends;
        // the ball in flight stays a small round dot so it reads differently.
        readonly property bool isBall: level === 4

        Rectangle {
          anchors.centerIn: parent
          width: isBall ? field.cell * 0.34 : field.cell * 0.66
          height: isBall ? width : field.cell * 0.3
          radius: height / 2
          color: level === 1 ? "#d42412"
               : level === 2 ? "#f0341e"
               : "#ff4a30"
          border.width: level >= 3 ? 2 : 0
          border.color: "#ffb19e"
          // A small specular highlight so lit LEDs read as domes, not flat.
          Rectangle {
            x: parent.width * (isBall ? 0.22 : 0.16); y: parent.height * 0.18
            width: parent.width * (isBall ? 0.26 : 0.3)
            height: isBall ? width : parent.height * 0.26
            radius: height / 2
            color: "#ffffff"
            opacity: level >= 3 ? 0.55 : 0.25
          }
        }
      }
    }
  }
}
