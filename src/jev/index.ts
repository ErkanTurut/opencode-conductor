// JEV module barrel: single import surface for the judge-ensemble layer.
// `isJevEnabled` is re-exported here via `./config.js` (the env+CLI toggle
// is the sufficient gating mechanism per the user decision).

export * from './types.js'
export * from './config.js'
export * from './client.js'
export * from './questions.js'
export * from './gates.js'

/** JEV module version (jev-04 gates milestone). */
export const JEV_MODULE_VERSION = '0.1.0'
