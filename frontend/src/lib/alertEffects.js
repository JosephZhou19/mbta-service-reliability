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
  OTHER_EFFECT: 'Other effect',
  UNKNOWN_EFFECT: 'Unknown effect',
}

export const EFFECT_DESCRIPTION = {
  NO_SERVICE: 'No trains running on all or part of the line.',
  REDUCED_SERVICE: 'Service running, but at reduced frequency or over a shortened segment.',
  SIGNIFICANT_DELAYS: 'Full service, but substantially behind schedule.',
  MODIFIED_SERVICE: "Service pattern changed from what's normally scheduled.",
  DETOUR: 'Shuttle buses or a rerouting replacing part of the line.',
  STOP_MOVED: 'A stop temporarily relocated nearby.',
  ADDITIONAL_SERVICE: 'Extra service added beyond the normal schedule.',
  ACCESSIBILITY_ISSUE: 'An elevator or escalator outage -- not a train-service issue.',
  OTHER_EFFECT: 'An uncategorized MBTA alert, often a short-lived incident update.',
  UNKNOWN_EFFECT: "MBTA's alert didn't specify an effect type.",
}

export const NORMAL_COLOR = 'var(--good)'

export function effectColor(effect) {
  return EFFECT_COLOR[effect] || '#999'
}

export function effectLabel(effect) {
  return EFFECT_LABEL[effect] || effect
}
