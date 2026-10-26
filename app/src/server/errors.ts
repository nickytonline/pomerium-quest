import { Schema } from 'effect'

export class MissingAssertion extends Schema.TaggedError<MissingAssertion>()('MissingAssertion', {}) {}

export class InvalidAssertion extends Schema.TaggedError<InvalidAssertion>()('InvalidAssertion', {
  reason: Schema.String,
}) {}

export class OracleUnavailable extends Schema.TaggedError<OracleUnavailable>()('OracleUnavailable', {
  reason: Schema.String,
}) {}

export class UnknownZone extends Schema.TaggedError<UnknownZone>()('UnknownZone', {
  path: Schema.String,
}) {}

export class KubeUnavailable extends Schema.TaggedError<KubeUnavailable>()('KubeUnavailable', {
  reason: Schema.String,
}) {}

/** The player's door rules didn't pass the checks, so nothing was written. */
export class InvalidRules extends Schema.TaggedError<InvalidRules>()('InvalidRules', {
  reason: Schema.String,
}) {}

/** Too many houses are open at once, or the player saved too recently. */
export class BuildersBusy extends Schema.TaggedError<BuildersBusy>()('BuildersBusy', {
  reason: Schema.String,
  retryAfterSeconds: Schema.Number,
}) {}

/** A townsperson couldn't sign in or reach a house. */
export class VisitorLost extends Schema.TaggedError<VisitorLost>()('VisitorLost', {
  reason: Schema.String,
}) {}
