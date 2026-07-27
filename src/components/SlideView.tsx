import { useLayoutEffect, useRef, useState } from 'react'
import type { Slide } from '../types'

/**
 * Slide type is sized in `cqw`, so everything scales with the stage. This only
 * kicks in when a slide is genuinely over-stuffed — shrink to fit rather than
 * scroll, because a scrollbar mid-recording looks broken.
 */
export default function SlideView({ slide }: { slide: Slide }) {
  const fitRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    setScale(1)
    const fit = fitRef.current
    const slideEl = fit?.parentElement
    if (!fit || !slideEl) return

    const raf = requestAnimationFrame(() => {
      const style = getComputedStyle(slideEl)
      const available =
        slideEl.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      const needed = fit.scrollHeight
      if (needed > available + 1) setScale(Math.max(0.5, available / needed))
    })
    return () => cancelAnimationFrame(raf)
  }, [slide.key, slide.html])

  return (
    <div className="slide fade-slide" data-layout={slide.layout} key={slide.key}>
      <div
        ref={fitRef}
        className="slide-fit"
        style={scale < 1 ? { transform: `scale(${scale})` } : undefined}
        dangerouslySetInnerHTML={{ __html: slide.html }}
      />
    </div>
  )
}
