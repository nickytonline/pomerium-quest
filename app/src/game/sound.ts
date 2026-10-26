// Sound, synthesized on the fly with the Web Audio API: chiptune music and effects, no audio
// files. The music follows the game's state; the scene and story play effects as things happen.
// Music and effects can each be turned off from the menu, and the choice is remembered.
import { useSyncExternalStore } from 'react'
import { quest, type QuestState } from './store.ts'

export interface SoundSettings {
  readonly music: boolean
  readonly effects: boolean
}

export type Effect =
  | 'swing'
  | 'swingSteel'
  | 'slimeHit'
  | 'slimePop'
  | 'bite'
  | 'faint'
  | 'splash'
  | 'paddle'
  | 'shake'
  | 'chomp'
  | 'drink'
  | 'itemGet'
  | 'laugh'
  | 'victory'
  | 'clang'
  | 'dialogOpen'
  | 'dialogNext'
  | 'smash'

const STORAGE_KEY = 'pomerium-quest/sound/v1'

/** Loudness of each bus; effects sit above the music so a hit is never lost under it. */
const LEVEL = { music: 0.18, effects: 0.5 }

/** How far ahead the music scheduler queues notes, and how often it wakes to queue more. */
const LOOKAHEAD_S = 0.15
const TICK_MS = 25

function loadSettings(): SoundSettings {
  const fallback = { music: true, effects: true }

  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)

    // SAFETY: written only by saveSettings below; a missing field falls back to on.
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<SoundSettings>) } : fallback
  } catch {
    return fallback
  }
}

function saveSettings(value: SoundSettings) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Storage can be unavailable (private windows); the choice then lasts for this tab only.
  }
}

interface Mixer {
  readonly ctx: AudioContext
  readonly music: GainNode
  readonly effects: GainNode
  readonly noise: AudioBuffer
}

interface Playing {
  readonly track: Track
  readonly out: GainNode
  readonly timer: ReturnType<typeof setInterval>
}

let settings = loadSettings()
let mixer: Mixer | undefined
let playing: Playing | undefined
const listeners = new Set<() => void>()

// ── Instruments ─────────────────────────────────────────────────────────────────────────────

interface Voice {
  readonly wave: OscillatorType
  readonly freq: number
  /** Glides to this pitch over the note. */
  readonly to?: number
  readonly dur: number
  readonly peak: number
  /** Holds the note at full level and releases at the end, instead of decaying from the start. */
  readonly hold?: boolean
}

/** One oscillator note starting at `at`, with a click-free envelope. */
function tone(out: AudioNode, at: number, voice: Voice) {
  const ctx = out.context
  const osc = ctx.createOscillator()
  const env = ctx.createGain()
  const end = at + voice.dur

  osc.type = voice.wave
  osc.frequency.setValueAtTime(voice.freq, at)

  if (voice.to) osc.frequency.exponentialRampToValueAtTime(voice.to, end)
  env.gain.setValueAtTime(0, at)
  env.gain.linearRampToValueAtTime(voice.peak, at + 0.006)

  if (voice.hold) {
    env.gain.setValueAtTime(voice.peak, Math.max(at + 0.006, end - 0.04))
    env.gain.linearRampToValueAtTime(0, end)
  } else {
    env.gain.exponentialRampToValueAtTime(0.0001, end)
  }

  osc.connect(env).connect(out)
  osc.start(at)
  osc.stop(end + 0.02)
}

interface Burst {
  readonly filter: BiquadFilterType
  readonly freq: number
  /** Sweeps the filter to this frequency over the burst. */
  readonly to?: number
  readonly q?: number
  /** Swells in over this many seconds instead of starting at full level. */
  readonly attack?: number
  readonly dur: number
  readonly peak: number
}

/** A burst of filtered white noise: whooshes, splashes, hats and crunches. */
function hiss(mix: Mixer, out: AudioNode, at: number, burst: Burst) {
  const ctx = mix.ctx
  const source = ctx.createBufferSource()
  const filter = ctx.createBiquadFilter()
  const env = ctx.createGain()
  const end = at + burst.dur

  source.buffer = mix.noise
  filter.type = burst.filter
  filter.Q.value = burst.q ?? 1
  filter.frequency.setValueAtTime(burst.freq, at)

  if (burst.to) filter.frequency.exponentialRampToValueAtTime(burst.to, end)
  env.gain.setValueAtTime(burst.attack ? 0 : burst.peak, at)

  if (burst.attack) env.gain.linearRampToValueAtTime(burst.peak, at + burst.attack)
  env.gain.exponentialRampToValueAtTime(0.0001, end)
  source.connect(filter).connect(env).connect(out)
  source.start(at, Math.random() * 0.5)
  source.stop(end + 0.02)
}

const SEMITONE = new Map([
  ['C', 0],
  ['D', 2],
  ['E', 4],
  ['F', 5],
  ['G', 7],
  ['A', 9],
  ['B', 11],
])

const ACCIDENTAL = new Map([
  ['#', 1],
  ['b', -1],
])

/** 'C5', 'F#4' or 'Bb3' in Hz (A4 = 440). */
function hz(name: string) {
  const match = /^([A-G])([#b]?)(\d)$/.exec(name)

  if (!match) throw new Error(`not a note: ${name}`)
  const [, letter = 'C', accidental, octave] = match
  const pitch = (SEMITONE.get(letter) ?? 0) + (ACCIDENTAL.get(accidental ?? '') ?? 0)
  const midi = (Number(octave) + 1) * 12 + pitch

  return 440 * 2 ** ((midi - 69) / 12)
}

// ── Effects ─────────────────────────────────────────────────────────────────────────────────

/** Tiny bubbles popping over `spread` seconds: short sine chirps that rise, the sound of churned water. */
function bubbles(out: AudioNode, at: number, count: number, spread: number) {
  for (let i = 0; i < count; i++) {
    const freq = 500 + Math.random() * 1100

    tone(out, at + Math.random() * spread, {
      wave: 'sine',
      freq,
      to: freq * 1.6,
      dur: 0.02 + Math.random() * 0.03,
      peak: 0.06 + Math.random() * 0.06,
    })
  }
}

/** A pleasant rising chime after eating or drinking: health coming back. */
function healChime(out: AudioNode, at: number) {
  for (const [i, name] of ['C6', 'E6', 'G6'].entries())
    tone(out, at + i * 0.07, { wave: 'triangle', freq: hz(name), dur: 0.2, peak: 0.16 })
}

/**
 * A sinister "mwa-ha-ha-ha-ha": a buzzing voice through two vowel formants, each "ha" lower than
 * the last, echoing away over a low drone.
 */
function laugh(mix: Mixer, out: AudioNode, at: number) {
  const ctx = mix.ctx
  const echo = ctx.createDelay()
  const feedback = ctx.createGain()

  echo.delayTime.value = 0.19
  feedback.gain.value = 0.35
  echo.connect(feedback).connect(echo)
  echo.connect(out)

  const syllable = (start: number, pitch: number, dur: number, vowel: readonly [number, number]) => {
    const osc = ctx.createOscillator()
    const vibrato = ctx.createOscillator()
    const depth = ctx.createGain()
    const env = ctx.createGain()

    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(pitch, start)
    osc.frequency.exponentialRampToValueAtTime(pitch * 0.8, start + dur)
    vibrato.frequency.value = 7
    depth.gain.value = pitch * 0.03
    vibrato.connect(depth).connect(osc.frequency)
    env.gain.setValueAtTime(0, start)
    env.gain.linearRampToValueAtTime(0.5, start + 0.02)
    env.gain.exponentialRampToValueAtTime(0.0001, start + dur)

    for (const formant of vowel) {
      const filter = ctx.createBiquadFilter()

      filter.type = 'bandpass'
      filter.frequency.value = formant
      filter.Q.value = 7
      osc.connect(filter).connect(env)
    }

    env.connect(out)
    env.connect(echo)
    osc.start(start)
    vibrato.start(start)
    osc.stop(start + dur + 0.02)
    vibrato.stop(start + dur + 0.02)
  }

  // "Mwa": the lips open from an "oo" to an "ah".
  syllable(at, 130, 0.36, [500, 900])

  for (let i = 0; i < 4; i++) {
    const start = at + 0.42 + i * 0.2

    // The breath of the "h", then the "a".
    hiss(mix, out, start - 0.04, { filter: 'bandpass', freq: 1400, q: 1.5, dur: 0.06, peak: 0.12 })
    syllable(start, 175 - i * 14, 0.16, [720, 1150])
  }

  tone(out, at + 0.3, { wave: 'sawtooth', freq: 55, to: 49, dur: 2.2, peak: 0.07 })
  tone(out, at + 0.3, { wave: 'sawtooth', freq: 58.3, to: 51.9, dur: 2.2, peak: 0.05 })
  setTimeout(() => echo.disconnect(), 4000)
}

const EFFECTS: Record<Effect, (mix: Mixer, out: AudioNode, at: number) => void> = {
  swing: (mix, out, at) =>
    hiss(mix, out, at, { filter: 'bandpass', freq: 1800, to: 500, q: 1.6, dur: 0.14, peak: 0.55 }),
  swingSteel: (mix, out, at) => {
    hiss(mix, out, at, { filter: 'bandpass', freq: 3600, to: 900, q: 1.6, dur: 0.15, peak: 0.55 })
    tone(out, at + 0.02, { wave: 'sine', freq: 2640, dur: 0.18, peak: 0.04 })
  },
  slimeHit: (mix, out, at) => {
    hiss(mix, out, at, { filter: 'lowpass', freq: 1400, dur: 0.06, peak: 0.7 })
    tone(out, at, { wave: 'sine', freq: 560, to: 140, dur: 0.15, peak: 0.4 })
    tone(out, at + 0.01, { wave: 'triangle', freq: 260, to: 90, dur: 0.13, peak: 0.3 })
  },
  slimePop: (mix, out, at) => {
    hiss(mix, out, at, { filter: 'lowpass', freq: 1400, dur: 0.06, peak: 0.7 })
    tone(out, at, { wave: 'sine', freq: 300, to: 1100, dur: 0.12, peak: 0.4 })
    tone(out, at + 0.1, { wave: 'square', freq: hz('E6'), dur: 0.08, peak: 0.06 })
    tone(out, at + 0.17, { wave: 'square', freq: hz('B6'), dur: 0.14, peak: 0.06 })
  },
  bite: (mix, out, at) => {
    hiss(mix, out, at, { filter: 'lowpass', freq: 900, to: 200, dur: 0.18, peak: 0.6 })
    tone(out, at, { wave: 'sine', freq: 190, to: 60, dur: 0.2, peak: 0.5 })
    tone(out, at + 0.03, { wave: 'square', freq: 700, to: 300, dur: 0.18, peak: 0.1 })
  },
  faint: (_mix, out, at) => {
    for (const [i, name] of ['G4', 'F#4', 'F4', 'E4'].entries())
      tone(out, at + i * 0.17, { wave: 'square', freq: hz(name), dur: 0.16, peak: 0.1, hold: true })
    tone(out, at + 0.7, { wave: 'triangle', freq: hz('C4'), to: hz('G3'), dur: 0.9, peak: 0.3 })
    tone(out, at + 0.7, { wave: 'square', freq: hz('Eb4'), to: hz('Bb3'), dur: 0.9, peak: 0.05 })
  },
  /** Jumping in: a thump, a spray that falls back, and the water churning with bubbles. */
  splash: (mix, out, at) => {
    tone(out, at, { wave: 'sine', freq: 140, to: 50, dur: 0.15, peak: 0.4 })
    hiss(mix, out, at, { filter: 'highpass', freq: 1800, dur: 0.3, peak: 0.35 })
    hiss(mix, out, at, { filter: 'lowpass', freq: 2200, to: 500, attack: 0.02, dur: 0.5, peak: 0.45 })
    bubbles(out, at + 0.04, 12, 0.4)
  },
  /** A paddling stroke: water sloshing past, with a few bubbles. */
  paddle: (mix, out, at) => {
    hiss(mix, out, at, { filter: 'lowpass', freq: 1300, to: 450, attack: 0.05, dur: 0.24, peak: 0.3 })
    hiss(mix, out, at + 0.03, { filter: 'bandpass', freq: 3000, q: 0.7, attack: 0.03, dur: 0.12, peak: 0.06 })
    bubbles(out, at + 0.02, 5, 0.18)
  },
  /** One swing of a wet dog's shake: a flap of fur and a few flung drops, never quite the same twice. */
  shake: (mix, out, at) => {
    const freq = 900 + Math.random() * 900

    hiss(mix, out, at, { filter: 'bandpass', freq, to: freq / 2.5, q: 0.9, dur: 0.05, peak: 0.3 })

    for (let i = 0; i < 2; i++)
      tone(out, at + 0.01 + Math.random() * 0.04, {
        wave: 'sine',
        freq: 1600 + Math.random() * 1400,
        dur: 0.03,
        peak: 0.03,
      })
  },
  chomp: (mix, out, at) => {
    for (const bite of [0, 0.16]) {
      hiss(mix, out, at + bite, { filter: 'lowpass', freq: 1600, dur: 0.07, peak: 0.55 })
      tone(out, at + bite, { wave: 'square', freq: 220, to: 110, dur: 0.07, peak: 0.08 })
    }

    tone(out, at + 0.34, { wave: 'sine', freq: 240, to: 520, dur: 0.11, peak: 0.35 })
    healChime(out, at + 0.52)
  },
  drink: (mix, out, at) => {
    for (const gulp of [0, 0.19, 0.38]) {
      tone(out, at + gulp, { wave: 'sine', freq: 280, to: 580, dur: 0.1, peak: 0.35 })
      hiss(mix, out, at + gulp, { filter: 'bandpass', freq: 700, q: 2, dur: 0.05, peak: 0.12 })
    }

    healChime(out, at + 0.56)
  },
  itemGet: (_mix, out, at) => {
    for (const [i, name] of ['G4', 'B4', 'D5', 'G5', 'B5'].entries())
      tone(out, at + i * 0.08, { wave: 'square', freq: hz(name), dur: 0.12, peak: 0.1 })

    for (const name of ['G5', 'B5', 'D6'])
      tone(out, at + 0.46, { wave: 'square', freq: hz(name), dur: 1.0, peak: 0.06, hold: true })
    tone(out, at + 0.46, { wave: 'triangle', freq: hz('G3'), dur: 1.0, peak: 0.3, hold: true })
    tone(out, at + 0.6, { wave: 'sine', freq: hz('G6'), dur: 0.3, peak: 0.08 })
    tone(out, at + 0.8, { wave: 'sine', freq: hz('D7'), dur: 0.5, peak: 0.06 })
  },
  laugh,
  victory: (_mix, out, at) => {
    const lead: readonly (readonly [string, number, number])[] = [
      ['C5', 0, 0.1],
      ['E5', 0.12, 0.1],
      ['G5', 0.24, 0.1],
      ['C6', 0.36, 0.32],
      ['A5', 0.72, 0.12],
      ['B5', 0.86, 0.12],
      ['C6', 1.0, 1.3],
    ]

    for (const [name, start, dur] of lead)
      tone(out, at + start, { wave: 'square', freq: hz(name), dur, peak: 0.1, hold: true })

    for (const name of ['E5', 'G5'])
      tone(out, at + 1.0, { wave: 'square', freq: hz(name), dur: 1.3, peak: 0.05, hold: true })
    tone(out, at, { wave: 'triangle', freq: hz('C3'), dur: 0.68, peak: 0.3, hold: true })
    tone(out, at + 0.72, { wave: 'triangle', freq: hz('G3'), dur: 0.26, peak: 0.3, hold: true })
    tone(out, at + 1.0, { wave: 'triangle', freq: hz('C3'), dur: 1.3, peak: 0.3, hold: true })
  },
  /** A text box popping open: two quick rising blips. */
  dialogOpen: (_mix, out, at) => {
    tone(out, at, { wave: 'square', freq: hz('E5'), dur: 0.05, peak: 0.07, hold: true })
    tone(out, at + 0.055, { wave: 'square', freq: hz('B5'), dur: 0.07, peak: 0.07, hold: true })
  },
  /** Turning to the next page of a text box: one soft tick. */
  dialogNext: (_mix, out, at) => tone(out, at, { wave: 'square', freq: hz('A5'), dur: 0.04, peak: 0.05 }),
  clang: (_mix, out, at) => {
    tone(out, at, { wave: 'square', freq: 1180, dur: 0.25, peak: 0.05 })
    tone(out, at, { wave: 'triangle', freq: 1770, dur: 0.3, peak: 0.12 })
  },
  smash: (mix, out, at) => {
    hiss(mix, out, at, { filter: 'lowpass', freq: 2400, to: 250, dur: 0.32, peak: 0.7 })
    tone(out, at, { wave: 'sine', freq: 130, to: 40, dur: 0.25, peak: 0.45 })
  },
}

// ── Music ───────────────────────────────────────────────────────────────────────────────────

/**
 * A loop for the music scheduler. Notes are written 'C5:4', a pitch and a length in sixteenth
 * notes; '-' is a rest and '|' marks a bar for the reader.
 */
interface Track {
  readonly bpm: number
  readonly lead: string
  readonly bass: string
  /** One bar of sixteenths, repeated: k kick, s snare, h hat, . nothing. */
  readonly drums: string
}

/** A bar of bass in eighths: root, octave, fifth, octave, twice over. */
const pump = (root: string, fifth: string, octave: string) =>
  `${root}:2 ${octave}:2 ${fifth}:2 ${octave}:2 `.repeat(2)

const C = pump('C3', 'G3', 'C4')
const Am = pump('A2', 'E3', 'A3')
const F = pump('F2', 'C3', 'F3')
const G = pump('G2', 'D3', 'G3')
const E = pump('E2', 'B2', 'E3')
const Dm = pump('D3', 'A3', 'D4')

/** The overworld: a heroic tune in C, then a wandering one in A minor that leads back home. */
const OVERWORLD: Track = {
  bpm: 132,
  lead: `C5:4 G4:4 C5:2 D5:2 E5:4 | F5:4 E5:2 D5:2 E5:8 | A4:4 C5:4 F5:2 E5:2 D5:4 | G4:4 B4:2 C5:2 D5:8 |
    C5:4 G4:4 C5:2 D5:2 E5:4 | F5:4 G5:2 A5:2 G5:8 | F5:2 E5:2 D5:2 C5:2 A4:4 B4:4 | C5:12 -:4 |
    A4:4 C5:4 E5:4 A5:4 | G5:4 F5:2 E5:2 D5:8 | F4:4 A4:4 C5:4 F5:4 | E5:4 D5:2 C5:2 B4:8 |
    A4:4 C5:4 E5:4 A5:4 | B5:4 A5:2 G5:2 A5:8 | G5:2 F5:2 E5:2 D5:2 C5:4 D5:4 | B4:4 G4:4 D5:8`,
  bass: [C, Am, F, G, C, F, G, C, Am, G, F, E, Am, F, G, G].join(''),
  drums: 'k.h.s.h.k.hks.h.',
}

/** Played over the fireworks: the same kingdom, faster and brighter. */
const CELEBRATION: Track = {
  bpm: 150,
  lead: `C5:2 E5:2 G5:2 C6:2 G5:2 E5:2 G5:4 | A5:2 F5:2 A5:2 C6:2 A5:4 G5:4 |
    F5:2 A5:2 G5:2 E5:2 D5:2 F5:2 E5:2 C5:2 | D5:2 G5:2 B5:2 D6:2 C6:4 B5:4 |
    C6:2 B5:2 A5:2 G5:2 E5:2 G5:2 C6:4 | A5:2 C6:2 F6:2 C6:2 A5:4 F5:4 |
    G5:2 F5:2 E5:2 D5:2 G5:2 A5:2 B5:4 | C6:8 G5:2 E5:2 C5:4`,
  bass: [C, F, Dm, G, C, F, G, C].join(''),
  drums: 'k.h.s.hkk.h.s.h.',
}

interface Score {
  /** Each note's pitch (null for a rest) and length, by the sixteenth it starts on. */
  readonly notes: ReadonlyMap<number, { readonly freq: number | null; readonly steps: number }>
  readonly length: number
}

function score(sequence: string): Score {
  const notes = new Map<number, { readonly freq: number | null; readonly steps: number }>()
  let length = 0

  for (const token of sequence.split(/\s+/)) {
    if (!token || token === '|') continue
    const [name = '-', steps = '1'] = token.split(':')
    notes.set(length, { freq: name === '-' ? null : hz(name), steps: Number(steps) })
    length += Number(steps)
  }

  return { notes, length }
}

function drum(mix: Mixer, out: AudioNode, at: number, hit: string | undefined) {
  if (hit === 'k') tone(out, at, { wave: 'sine', freq: 150, to: 45, dur: 0.12, peak: 0.7 })

  if (hit === 's') hiss(mix, out, at, { filter: 'highpass', freq: 1500, dur: 0.1, peak: 0.3 })

  if (hit === 'h') hiss(mix, out, at, { filter: 'highpass', freq: 7000, dur: 0.03, peak: 0.12 })
}

/** Queues the track's notes a little ahead of time, so timers that wake late never miss a beat. */
function startTrack(mix: Mixer, track: Track): Playing {
  const ctx = mix.ctx
  const out = ctx.createGain()
  const lead = score(track.lead)
  const bass = score(track.bass)
  const step = 60 / track.bpm / 4
  let index = 0
  let at = ctx.currentTime + 0.05

  out.connect(mix.music)

  const tick = () => {
    // Fell behind (the tab slept): pick up from now rather than rushing through the backlog.
    if (at < ctx.currentTime) at = ctx.currentTime + 0.05

    while (at < ctx.currentTime + LOOKAHEAD_S) {
      const melody = lead.notes.get(index % lead.length)
      const low = bass.notes.get(index % bass.length)

      if (melody?.freq)
        tone(out, at, {
          wave: 'square',
          freq: melody.freq,
          dur: melody.steps * step * 0.9,
          peak: 0.1,
          hold: true,
        })

      if (low?.freq)
        tone(out, at, {
          wave: 'triangle',
          freq: low.freq,
          dur: low.steps * step * 0.8,
          peak: 0.28,
          hold: true,
        })
      drum(mix, out, at, track.drums[index % track.drums.length])
      index++
      at += step
    }
  }

  tick()

  return { track, out, timer: setInterval(tick, TICK_MS) }
}

function stopTrack(mix: Mixer, current: Playing) {
  clearInterval(current.timer)
  current.out.gain.setTargetAtTime(0, mix.ctx.currentTime, 0.08)
  setTimeout(() => current.out.disconnect(), 600)
}

/** What should be playing: the overworld while exploring, a party at the end, silence otherwise. */
function trackFor(state: QuestState): Track | undefined {
  if (!state.started || state.phished || state.finale) return undefined

  return state.celebrating ? CELEBRATION : OVERWORLD
}

function syncMusic() {
  if (!mixer) return
  const wanted = settings.music ? trackFor(quest.get()) : undefined

  if (wanted === playing?.track) return

  if (playing) stopTrack(mixer, playing)
  playing = wanted && startTrack(mixer, wanted)
}

let shownDialog: QuestState['dialog'] = null

/** Text boxes blip as they open and as each page turns, whoever opened them. */
function syncDialog() {
  const { dialog } = quest.get()
  const before = shownDialog

  shownDialog = dialog

  if (!dialog || dialog === before) return
  sfx(before && before.pages === dialog.pages ? 'dialogNext' : 'dialogOpen')
}

// ── Setup ───────────────────────────────────────────────────────────────────────────────────

/** Browsers only let audio start after a key press or tap, so the mixer is built on the first one. */
function unlock() {
  if (!mixer) {
    if (!('AudioContext' in globalThis)) return
    const ctx = new AudioContext()
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const samples = noise.getChannelData(0)

    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1
    const master = ctx.createGain()
    const music = ctx.createGain()
    const effects = ctx.createGain()
    // Square waves are bright; softening the music keeps it behind the game.
    const soften = ctx.createBiquadFilter()

    soften.type = 'lowpass'
    soften.frequency.value = 3200
    music.gain.value = settings.music ? LEVEL.music : 0
    effects.gain.value = settings.effects ? LEVEL.effects : 0
    music.connect(soften).connect(master)
    effects.connect(master)
    master.connect(ctx.destination)
    mixer = { ctx, music, effects, noise }
  }

  if (mixer.ctx.state === 'suspended' && document.visibilityState === 'visible') void mixer.ctx.resume()
  syncMusic()
}

/** Plays a sound effect, if effects are on and the player has pressed something yet. */
export function sfx(effect: Effect) {
  if (!mixer || !settings.effects) return
  EFFECTS[effect](mixer, mixer.effects, mixer.ctx.currentTime + 0.01)
}

/** Starts listening for the first key press or tap, and for the game's state to pick the music. */
export function startSound() {
  const onVisibility = () => {
    if (!mixer) return

    // A hidden tab's timers slow to a crawl, so the music would stutter; pause it instead.
    if (document.visibilityState === 'hidden') void mixer.ctx.suspend()
    else void mixer.ctx.resume()
  }

  const gestures = ['keydown', 'pointerdown'] as const

  for (const gesture of gestures) addEventListener(gesture, unlock, { capture: true })
  document.addEventListener('visibilitychange', onVisibility)

  const unsubscribe = quest.subscribe(() => {
    syncMusic()
    syncDialog()
  })

  return () => {
    for (const gesture of gestures) removeEventListener(gesture, unlock, { capture: true })
    document.removeEventListener('visibilitychange', onVisibility)
    unsubscribe()
  }
}

export const sound = {
  get: () => settings,
  subscribe: (listener: () => void) => {
    listeners.add(listener)

    return () => listeners.delete(listener)
  },
  toggle: (setting: keyof SoundSettings) => {
    settings = { ...settings, [setting]: !settings[setting] }
    saveSettings(settings)

    if (mixer) {
      const now = mixer.ctx.currentTime

      mixer.music.gain.setTargetAtTime(settings.music ? LEVEL.music : 0, now, 0.05)
      mixer.effects.gain.setTargetAtTime(settings.effects ? LEVEL.effects : 0, now, 0.05)
    }

    syncMusic()

    for (const listener of listeners) listener()
  },
}

export function useSound(): SoundSettings {
  return useSyncExternalStore(sound.subscribe, sound.get, sound.get)
}
