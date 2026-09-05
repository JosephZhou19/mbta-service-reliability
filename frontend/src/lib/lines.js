// Official MBTA line colors, from the GTFS routes.txt route_color field.
export const LINE_COLOR = {
  'Red-A': '#DA291C',
  'Red-B': '#DA291C',
  'Orange': '#ED8B00',
  'Blue': '#003DA5',
  'Green-B': '#00843D',
  'Green-C': '#00843D',
  'Green-D': '#00843D',
  'Green-E': '#00843D',
  'Mattapan': '#DA291C',
}

export const LINE_LABEL = {
  'Red-A': 'Red Line (Ashmont)',
  'Red-B': 'Red Line (Braintree)',
  'Orange': 'Orange Line',
  'Blue': 'Blue Line',
  'Green-B': 'Green Line B',
  'Green-C': 'Green Line C',
  'Green-D': 'Green Line D',
  'Green-E': 'Green Line E',
  'Mattapan': 'Mattapan Trolley',
}

// Real destination names, pulled from the LAMP data's own direction_destination
// field per line (checked directly against a recent day's data — not guessed).
// Red-A/Red-B direction 0 overrides the raw feed's generic "Ashmont/Braintree"
// label with the actual branch destination, since we already know which branch
// each of these is; direction 1 (Alewife) is the shared trunk terminus for both.
export const DIRECTION_DESTINATION = {
  'Blue': { false: 'Bowdoin', true: 'Wonderland' },
  'Green-B': { false: 'Boston College', true: 'Government Center' },
  'Green-C': { false: 'Cleveland Circle', true: 'Government Center' },
  'Green-D': { false: 'Riverside', true: 'Union Square' },
  'Green-E': { false: 'Heath Street', true: 'Medford/Tufts' },
  'Mattapan': { false: 'Mattapan', true: 'Ashmont' },
  'Orange': { false: 'Forest Hills', true: 'Oak Grove' },
  'Red-A': { false: 'Ashmont', true: 'Alewife' },
  'Red-B': { false: 'Braintree', true: 'Alewife' },
}

export function lineColor(line) {
  return LINE_COLOR[line] || '#666'
}

export function lineLabel(line) {
  return LINE_LABEL[line] || line
}

export function directionLabel(line, directionKey) {
  const dest = DIRECTION_DESTINATION[line]?.[directionKey]
  return dest ? `Toward ${dest}` : `Direction ${directionKey}`
}
