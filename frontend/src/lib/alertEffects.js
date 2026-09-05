// Mirrors backend/alert_status.py's EFFECT_PRECEDENCE and MBTA's alert-effect
// vocabulary. Colors just need to be visually distinguishable -- precedence (which
// effect wins on a given day) is already resolved server-side.
export const EFFECT_COLOR = {
  NO_SERVICE: '#8b1a1a',
  REDUCED_SERVICE: '#c22a2a',
  SIGNIFICANT_DELAYS: '#b06a00',
  MODIFIED_SERVICE: '#8a4fbf',
  DETOUR: '#1f6fb0',
  STOP_MOVED: '#0f9b8e',
  ADDITIONAL_SERVICE: '#2f9e44',
  ACCESSIBILITY_ISSUE: '#6b7f99',
  OTHER_EFFECT: '#c9a227',
  UNKNOWN_EFFECT: '#8a8a8a',
}

export const EFFECT_LABEL = {
  NO_SERVICE: 'No service',
  REDUCED_SERVICE: 'Reduced service',
  SIGNIFICANT_DELAYS: 'Significant delays',
  MODIFIED_SERVICE: 'Modified service',
  DETOUR: 'Detour',
  STOP_MOVED: 'Stop moved',
  ADDITIONAL_SERVICE: 'Additional service',
  ACCESSIBILITY_ISSUE: 'Accessibility issue',
  OTHER_EFFECT: 'Delays / slow zone',
  UNKNOWN_EFFECT: 'Schedule change',
}

// OTHER_EFFECT and UNKNOWN_EFFECT are MBTA's catch-all/blank categories. These two
// descriptions are our own read of what's actually in each bucket (not an MBTA
// classification): OTHER_EFFECT is almost entirely explicit delay call-outs or stated
// speed restrictions; UNKNOWN_EFFECT is more mixed but mostly real pattern changes
// (short-turning, single-tracking, storm-wide reductions).
export const EFFECT_DESCRIPTION = {
  NO_SERVICE: 'No trains running on all or part of the line.',
  REDUCED_SERVICE: 'Service running, but at reduced frequency or over a shortened segment.',
  SIGNIFICANT_DELAYS: 'Full service, but substantially behind schedule.',
  MODIFIED_SERVICE: "Service pattern changed from what's normally scheduled.",
  DETOUR: 'Shuttle buses or a rerouting replacing part of the line.',
  STOP_MOVED: 'A stop temporarily relocated nearby.',
  ADDITIONAL_SERVICE: 'Extra service added beyond the normal schedule.',
  ACCESSIBILITY_ISSUE: 'An elevator or escalator outage -- not a train-service issue.',
  OTHER_EFFECT: "MBTA doesn't officially categorize this, but the alert text usually describes an extended delay (a signal or track problem) or a speed restriction/slow zone during track work.",
  UNKNOWN_EFFECT: "MBTA left the effect blank, but the alert text usually describes a real schedule change -- trains short-turning, single-tracking, or a storm-related system-wide reduction.",
}

// Whether a delay figure computed during this effect is trustworthy enough to plot.
// Effects where trains run a genuinely different pattern than published
// (short-turning, single-tracking, shuttle replacement) get masked -- the realtime
// trip isn't really matched against the schedule it's compared to, so any computed
// delay is noise. Full normal-pattern service that's simply running behind
// (SIGNIFICANT_DELAYS, a real slow zone) is left visible, since the delay figure is
// exactly the real thing being measured there.
export const MASKS_DELAY_DATA = new Set([
  'NO_SERVICE',
  'REDUCED_SERVICE',
  'MODIFIED_SERVICE',
  'DETOUR',
  'UNKNOWN_EFFECT', // "Schedule change" -- see EFFECT_DESCRIPTION
])

export function effectColor(effect) {
  return EFFECT_COLOR[effect] || '#999'
}

export function effectLabel(effect) {
  return EFFECT_LABEL[effect] || effect
}
