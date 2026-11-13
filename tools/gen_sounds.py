#!/usr/bin/env python3
"""Synthesize LED Gridiron's piezo-style sound effects into ../sounds/*.wav.

Handheld LED games of the late '70s had a single piezo buzzer driven by a
square wave, so every effect here is a sequence of square-wave tones (with an
optional pitch sweep and vibrato). Run it after changing a recipe:

    python3 tools/gen_sounds.py
"""
import math
import os
import random
import struct
import wave

RATE = 22050
VOLUME = 0.32
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sounds")


def tone(freq, ms, end=None, vibrato=0.0, vib_rate=0.0, duty=0.5, noise=0.0):
    """One square-wave note. `end` sweeps the pitch linearly to that frequency."""
    n = int(RATE * ms / 1000)
    end = freq if end is None else end
    out, phase = [], 0.0
    for i in range(n):
        t = i / RATE
        f = freq + (end - freq) * (i / max(1, n - 1))
        if vibrato:
            f *= 1 + vibrato * math.sin(2 * math.pi * vib_rate * t)
        phase = (phase + f / RATE) % 1.0
        s = 1.0 if phase < duty else -1.0
        if noise:
            s = s * (1 - noise) + random.uniform(-1, 1) * noise
        # 3 ms attack/release so notes click like a buzzer, not like a pop.
        edge = min(1.0, i / (RATE * 0.003), (n - i) / (RATE * 0.003))
        out.append(s * edge)
    return out


def rest(ms):
    return [0.0] * int(RATE * ms / 1000)


def write(name, *parts):
    # Lead-in and tail silence: DSP sinks (e.g. the Apple Silicon speaker
    # convolver, ~170 ms of latency) drop a stream's last samples when the
    # stream disconnects, which swallows short beeps entirely.
    samples = rest(30) + [s for part in parts for s in part] + rest(260)
    path = os.path.join(OUT, name + ".wav")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s)) * VOLUME * 32767)) for s in samples))


def main():
    random.seed(7)
    os.makedirs(OUT, exist_ok=True)
    # Footstep: the tiny tick every handheld made on each move.
    write("step", tone(1650, 14, duty=0.3))
    # Snap / play starts.
    write("snap", tone(880, 45), rest(25), tone(1320, 60))
    # Tackle: a falling triple buzz.
    write("tackle", tone(420, 90, 300), rest(20), tone(330, 90, 230), rest(20), tone(250, 170, 150, vibrato=0.06, vib_rate=30))
    # Ball run into a defender / ran into the pile: shorter thud.
    write("thud", tone(180, 120, 110, noise=0.35))
    # Pass in the air: a rising chirp.
    write("pass", tone(600, 220, 1500, duty=0.4))
    # Catch: bright two-tone.
    write("catch", tone(1180, 70), tone(1580, 110))
    # Incomplete: two flat low tones.
    write("incomplete", tone(360, 120), rest(40), tone(300, 160))
    # Interception: a sour warbling buzz.
    write("intercept", tone(240, 520, 120, vibrato=0.12, vib_rate=18, duty=0.35))
    # First down: three quick chirps.
    write("firstdown", *[p for _ in range(3) for p in (tone(1400, 50), rest(35))])
    # Kick: a thump then a rising whoosh.
    write("kick", tone(150, 50, 90, noise=0.5), tone(500, 260, 1100, duty=0.3))
    # Touchdown: the stadium "charge!" bugle call.
    notes = [(392, 110), (523, 110), (659, 110), (784, 210), (659, 110), (784, 420)]
    write("touchdown", *[p for f, ms in notes for p in (tone(f, ms), rest(25))])
    # Field goal / extra point good: an upward arpeggio.
    write("good", *[p for f in (523, 659, 784, 1047) for p in (tone(f, 80), rest(15))], tone(1047, 220))
    # No good: a descending "wah wah".
    write("nogood", tone(392, 200, 370, vibrato=0.03, vib_rate=8), rest(40), tone(349, 200, 330), rest(40), tone(330, 450, 260, vibrato=0.05, vib_rate=7))
    # Safety: a stuttered alarm.
    write("safety", *[p for _ in range(4) for p in (tone(1000, 70), tone(700, 70))])
    # Referee whistle: end of quarter.
    write("whistle", tone(2350, 520, 2300, vibrato=0.03, vib_rate=45), rest(60), tone(2350, 260, vibrato=0.03, vib_rate=45))
    # Turnover on downs.
    write("turnover", tone(520, 120), tone(390, 120), tone(260, 260))
    # Final gun: game over jingle.
    final = [(784, 130), (659, 130), (523, 130), (659, 130), (784, 130), (1047, 500)]
    write("gameover", *[p for f, ms in final for p in (tone(f, ms), rest(30))])
    # UI blip for status/score/menu keys.
    write("blip", tone(2000, 22, duty=0.25))


if __name__ == "__main__":
    main()
