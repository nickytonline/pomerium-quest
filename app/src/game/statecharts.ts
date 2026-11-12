// The machines the README draws, by the name in their chart markers.
import { houseMachine } from './house-machine.ts'
import { nightMachine } from './night-machine.ts'
import { owlMachine } from './owl-machine.ts'
import { playerMachine } from './player-machine.ts'
import { questMachine } from './quest-machine.ts'
import { withChart } from './statechart.ts'

/** Every statechart in the README, in the order it appears. */
export const CHARTS = {
  quest: questMachine,
  house: houseMachine,
  player: playerMachine,
  owl: owlMachine,
  night: nightMachine,
} as const

/** The README with every chart redrawn from its machine. */
export const withCharts = (readme: string) =>
  Object.entries(CHARTS).reduce((text, [name, machine]) => withChart(text, name, machine), readme)
