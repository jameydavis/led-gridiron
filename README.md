# LED Gridiron

A retro handheld LED football game for [Omarchy](https://omarchy.org/). Red blips on a three-lane
field, a 7-segment scoreboard, and piezo beeps, all running inside the Omarchy shell.

![LED Gridiron](preview.png)

You are the bright blip. Dodge the defenders, throw to the blinking receiver, and kick when you
run out of downs. Home runs right, Visitor runs left. One player plays both offenses against the
computer defense, or two players pass the keyboard on each change of possession.

## Install

```bash
omarchy plugin add https://github.com/jameydavis/led-gridiron.git --enable
```

Click the three red LEDs in the bar to play. To open it from a key, add a binding in
`~/.config/hypr/bindings.lua` that runs:

```bash
omarchy-shell jameydavis.led-gridiron toggle
```

## Keys

| Key | Button |
| --- | --- |
| `W` `A` `S` `D` (or arrows) | Move one step per press. The first move snaps the ball |
| `Space` | **Pass** to the blinking receiver (only before you cross the line of scrimmage) |
| `E` | **Kick**. Before the snap: a field goal inside the opponent's 38, otherwise a punt. Also kicks the extra point |
| `Q` | **Status**: after the whistle, sets up the next play. Otherwise shows field position, down and distance, then time left |
| `R` | **Score**: Home and Visitor |
| `1` / `2` | **Pro 1** (slow, hesitant defense) / **Pro 2** (fast defense), switchable between plays |
| `P` | Pause |
| `M` | Sound on/off |
| `N` `N` | New game (press twice) |
| `H` | Show or hide the key legend under the field |
| `Esc` | Close (a play in progress is paused) |

## Rules

- The field doesn't scroll. Run off the edge of the display and it wraps to the next 10 yards,
  with the defenders keeping their spots on the glass, until you reach the end zone.
- After every play, press STATUS (`Q`) to reset the field for the next snap.
- Four 5:00 quarters. The clock runs during plays, and each tackle runs off 8 more seconds.
- Gain 10 yards in four downs for a first down, or the ball turns over at the spot.
- Touchdown 6, extra point 1, field goal 3, safety 2.
- Passes fly cell by cell, and any defender in the path intercepts. A covered receiver can drop it.
- The opening kickoff goes to Home and the second-half kickoff to Visitor. After a score, the
  other team receives.

## Requirements

- Omarchy with the Quickshell-based `omarchy-shell`
- `pw-play` (PipeWire, standard on Omarchy) for sound

## Development

```bash
node test/logic.test.js        # rules engine tests, including fuzzed full games
python3 tools/gen_sounds.py    # rebuild sounds/*.wav from the synth recipes
omarchy plugin validate .
```

`Logic.js` holds the rules (plain JS, no QML). `BarWidget.qml` runs the timers, input, sound,
and device face. `Field.qml` draws the LED field and `SevenSeg.qml` draws the scoreboard digits.
Saving any file hot-reloads the plugin.

## Uninstall

```bash
omarchy plugin remove jameydavis.led-gridiron
```

## License

MIT. An original game inspired by the handheld LED sports games of the late 1970s. It is not
affiliated with or endorsed by any toy or game company.
