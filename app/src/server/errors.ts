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
