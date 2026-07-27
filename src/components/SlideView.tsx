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
      const availableH =
        slideEl.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      const availableW =
        slideEl.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const neededH = fit.scrollHeight
      const neededW = fit.scrollWidth
      // A slide can fit vertically but still overflow on one too-wide line (a
      // URL, a long hashtag, a wide code sample) — take whichever axis needs
      // the smaller scale so nothing gets clipped by `.slide { overflow: hidden }`.
      const ratioH = neededH > availableH + 1 ? availableH / neededH : 1
      const ratioW = neededW > availableW + 1 ? availableW / neededW : 1
      const ratio = Math.min(ratioH, ratioW)
      if (ratio < 1) setScale(Math.max(0.5, ratio))
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
