import type { CSSProperties } from 'react';
import type { SignatureArtwork } from '../annotations/model';
import { strokesToSvgPath } from './strokes';

/**
 * Draws signature artwork to fill its container: strokes as an SVG path (scaled along with the
 * container, pen width included, so it matches the saved appearance exactly) or a picture. The
 * container is expected to have the artwork's own shape; the artwork is stretched to fill it.
 */
export function SignatureArt({
  artwork,
  className,
  style,
}: {
  artwork: SignatureArtwork;
  className?: string;
  style?: CSSProperties;
}) {
  if (artwork.type === 'image') {
    return (
      <img
        className={className}
        style={{ display: 'block', width: '100%', height: '100%', ...style }}
        src={artwork.pngDataUrl}
        alt=""
        draggable={false}
      />
    );
  }
  return (
    <svg
      className={className}
      style={{ display: 'block', width: '100%', height: '100%', overflow: 'visible', ...style }}
      viewBox={`0 0 ${artwork.box[0]} ${artwork.box[1]}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d={strokesToSvgPath(artwork.strokes)}
        fill="none"
        stroke={artwork.color}
        strokeWidth={artwork.width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
