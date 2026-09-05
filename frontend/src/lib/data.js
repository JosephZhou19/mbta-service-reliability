const base = import.meta.env.BASE_URL

export async function fetchOverview() {
  const res = await fetch(`${base}data/overview.json`)
  if (!res.ok) throw new Error(`Failed to load overview.json: ${res.status}`)
  return res.json()
}

export async function fetchLineDetail(line) {
  const safeName = line.replace('/', '-')
  const res = await fetch(`${base}data/lines/${safeName}.json`)
  if (!res.ok) throw new Error(`Failed to load line detail for ${line}: ${res.status}`)
  return res.json()
}
