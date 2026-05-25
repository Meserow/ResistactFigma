import React, { useState } from 'react'

const ERROR_IMG_SRC =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODgiIGhlaWdodD0iODgiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgc3Ryb2tlPSIjMDAwIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBvcGFjaXR5PSIuMyIgZmlsbD0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIzLjciPjxyZWN0IHg9IjE2IiB5PSIxNiIgd2lkdGg9IjU2IiBoZWlnaHQ9IjU2IiByeD0iNiIvPjxwYXRoIGQ9Im0xNiA1OCAxNi0xOCAzMiAzMiIvPjxjaXJjbGUgY3g9IjUzIiBjeT0iMzUiIHI9IjciLz48L3N2Zz4KCg=='

// Compute the WebP sibling path for images we shipped under public/.
// Returns null when the src is external, a Vite-bundled asset, or already WebP.
//
// SAFE TO RETURN A NON-NULL HERE: the prebuild step runs
// scripts/generate-webp-siblings.mjs which sharp-converts every JPG/PNG in
// public/ into a sibling .webp. So when this helper emits "/foo.webp", the
// file is guaranteed to exist in the production bundle. Prior to that build
// step we had to disable this — see changelog 1.2.12 for the breakage story.
function webpSibling(src: unknown): string | null {
  if (typeof src !== 'string') return null
  if (!/^\/[^/]/.test(src)) return null            // must be root-rooted (public/) — not external, not //cdn
  if (src.startsWith('/src/') || src.startsWith('/assets/')) return null  // Vite-bundled assets have hashes
  if (!/\.(jpe?g|png)(\?|#|$)/i.test(src)) return null
  return src.replace(/\.(jpe?g|png)(\?|#|$)/i, '.webp$2')
}

export function ImageWithFallback(props: React.ImgHTMLAttributes<HTMLImageElement>) {
  const [didError, setDidError] = useState(false)

  const handleError = () => {
    setDidError(true)
  }

  const { src, alt, style, className, ...rest } = props

  if (didError) {
    return (
      <div
        className={`inline-block bg-gray-100 text-center align-middle ${className ?? ''}`}
        style={style}
      >
        <div className="flex items-center justify-center w-full h-full">
          <img src={ERROR_IMG_SRC} alt="Error loading image" {...rest} data-original-url={src as string | undefined} />
        </div>
      </div>
    )
  }

  const webp = webpSibling(src)
  if (webp) {
    return (
      <picture>
        <source srcSet={webp} type="image/webp" />
        <img
          src={src as string}
          alt={alt}
          className={className}
          style={style}
          loading="lazy"
          decoding="async"
          {...rest}
          onError={handleError}
        />
      </picture>
    )
  }

  return (
    <img
      src={src as string | undefined}
      alt={alt}
      className={className}
      style={style}
      loading="lazy"
      decoding="async"
      {...rest}
      onError={handleError}
    />
  )
}
