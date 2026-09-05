// Mirrors backend/alert_status.py's EFFECT_PRECEDENCE and the MBTA alert-effect
// vocabulary actually present in data/alerts.parquet. Colors are chosen to be
// distinguishable from each other at small calendar-cell size, roughly graded from
// most service-affecting (dark red) down through informational (gray) -- but the
// PRECEDENCE (which one wins when several apply to a line on the same day) is what
// backend/alert_status.py already resolved; this is just the display side of it.
export const EFFECT_COLOR = {
  NO_SERVICE: '#8b1a1a',
  REDUCED_SERVICE: '#c22a2a',
  SIGNIFICANT_DELAYS: '#b06a00',
  MODIFIED_SERVICE: '#8a4fbf',
  DETOUR: '#1f6fb0',
  STOP_MOVED: '#0f9b8e',
  ADDITIONAL_SERVICE: '#2f9e44',
  ACCESSIBILITY_ISSUE: '#6b7f99',
  OTHER_EFFECT: '#8a8a8a',
  UNKNOWN_EFFECT: '#b5b5b5',
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

// OTHER_EFFECT and UNKNOWN_EFFECT are MBTA's own catch-all/blank categories -- it
// doesn't say what happened, only that something did. Rather than leave both reading
// as equally vague, these two descriptions are our own read of what's actually in
// them, based on inspecting every eligible (12+ hour, train-service) alert text
// currently in each bucket:
//   OTHER_EFFECT: almost entirely explicit delay call-outs ("Delays of about 20
//     minutes due to a signal problem...") or a stated speed restriction/slow zone
//     ("Speed restrictions of 10-25 mph... while track repairs are performed").
//   UNKNOWN_EFFECT: more mixed, but mostly genuine schedule-pattern changes -- trains
//     short-turning before their normal terminus, single-tracking, or a system-wide
//     reduction during a storm -- with a handful of narrower entrance/access-only
//     closures mixed in.
// This is inference from the alert text, not an MBTA classification -- worth
// revisiting if either bucket's real content shifts over time.
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

export const NORMAL_COLOR = 'var(--good)'

export function effectColor(effect) {
  return EFFECT_COLOR[effect] || '#999'
}

export function effectLabel(effect) {
  return EFFECT_LABEL[effect] || effect
}
