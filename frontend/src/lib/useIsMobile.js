import { useEffect, useState } from 'react'

const QUERY = '(max-width: 640px)'

// Chart components render fixed-pixel SVG (height, legend layout) that CSS media
// queries can't reach -- this is the JS-side equivalent, for picking smaller chart
// props on a phone-width viewport.
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(QUERY).matches)

  useEffect(() => {
    const mql = window.matchMedia(QUERY)
    const onChange = () => setIsMobile(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isMobile
}
