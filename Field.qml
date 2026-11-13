// The 3x10 red LED playing field behind smoked plastic. Unlit LEDs stay
// faintly visible like the real thing; painted yard lines and end-zone
// shading scroll with the window (`vx` = world x of the leftmost column).
import QtQuick

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

  Repeater {
    model: field.cols * field.lanes
    Item {
      readonly property int level: field.leds.length > index ? field.leds[index] : 0
      x: field.ox + (index % field.cols) * field.cell
      y: field.oy + Math.floor(index / field.cols) * field.cell
      width: field.cell
      height: field.cell

      // Glow halo for the bright blips (ball carrier, ball in flight).
      Rectangle {
        anchors.centerIn: parent
        width: parent.width * 0.86; height: width; radius: width / 2
        color: "#ff2a12"
        opacity: level >= 3 ? 0.22 : level === 2 ? 0.1 : 0
      }
      Rectangle {
        anchors.centerIn: parent
        width: parent.width * (level === 4 ? 0.34 : 0.44); height: width; radius: width / 2
        color: level === 0 ? "#3a0c09"
             : level === 1 ? "#c41d10"
             : level === 2 ? "#e8301c"
             : "#ff4a30"
        border.width: level >= 3 ? 2 : 0
        border.color: "#ffb19e"
        // A tiny specular dot so lit LEDs read as domes, not flat circles.
        Rectangle {
          visible: level > 0
          x: parent.width * 0.22; y: parent.height * 0.18
          width: parent.width * 0.26; height: width; radius: width / 2
          color: "#ffffff"
          opacity: level >= 3 ? 0.55 : 0.25
        }
      }
    }
  }
}
