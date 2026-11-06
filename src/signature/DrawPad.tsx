import { useEffect, useRef, type PointerEvent } from 'react';
import { simplifyStroke, strokesToSvgPath, type Point, type Stroke } from './strokes';

export const PAD_WIDTH = 480;
export const PAD_HEIGHT = 170;

/** Points closer than this (pad pixels) to the previous one are not recorded. */
const MIN_POINT_DISTANCE = 1;
/** When a stroke ends, points closer than this are dropped to keep it small. */
const SIMPLIFY_DISTANCE = 0.8;

interface Props {
  strokes: Stroke[];
  color: string;
  /** Pen width in pad pixels. */
  width: number;
  onChange: (strokes: Stroke[]) => void;
}

/**
 * The area to sign in. Works with a mouse, a finger or a pen (pointer events), and shows what is
 * drawn exactly as it will look when placed: strokes are smoothed with the same curves.
 */
export function DrawPad({ strokes, color, width, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** The stroke being drawn right now; it joins `strokes` when the pen lifts. */
  const current = useRef<Stroke | null>(null);
  const pointerId = useRef<number | null>(null);

  const paint = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(PAD_WIDTH * dpr)) {
      canvas.width = Math.round(PAD_WIDTH * dpr);
      canvas.height = Math.round(PAD_HEIGHT * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, PAD_WIDTH, PAD_HEIGHT);

    // A baseline to sign on, and a hint while the pad is empty.
    ctx.strokeStyle = 'rgb(128 128 128 / 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(16, PAD_HEIGHT - 38);
    ctx.lineTo(PAD_WIDTH - 16, PAD_HEIGHT - 38);
    ctx.stroke();
    const all = current.current ? [...strokes, current.current] : strokes;
    if (all.length === 0) {
      ctx.fillStyle = 'rgb(128 128 128 / 0.8)';
      ctx.font = '14px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Sign here', PAD_WIDTH / 2, PAD_HEIGHT - 16);
      return;
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(new Path2D(strokesToSvgPath(all)));
  };

  useEffect(paint);

  const pointAt = (e: PointerEvent<HTMLCanvasElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    // The canvas may be scaled by CSS: report points in pad units either way.
    return [
      ((e.clientX - r.left) / r.width) * PAD_WIDTH,
      ((e.clientY - r.top) / r.height) * PAD_HEIGHT,
    ];
  };

  const start = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || pointerId.current !== null) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone: drawing just won't follow it outside the pad */
    }
    pointerId.current = e.pointerId;
    current.current = [pointAt(e)];
    paint();
  };

  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const stroke = current.current;
    if (!stroke || e.pointerId !== pointerId.current) return;
    // A fast pen produces several positions per event: use them all for a smoother line.
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const sources = events.length > 0 ? events : [e.nativeEvent];
    const r = e.currentTarget.getBoundingClientRect();
    for (const ev of sources) {
      const p: Point = [
        ((ev.clientX - r.left) / r.width) * PAD_WIDTH,
        ((ev.clientY - r.top) / r.height) * PAD_HEIGHT,
      ];
      const last = stroke[stroke.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= MIN_POINT_DISTANCE) stroke.push(p);
    }
    paint();
  };

  const finish = (e: PointerEvent<HTMLCanvasElement>, keep: boolean) => {
    const stroke = current.current;
    if (!stroke || e.pointerId !== pointerId.current) return;
    current.current = null;
    pointerId.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (keep) onChange([...strokes, simplifyStroke(stroke, SIMPLIFY_DISTANCE)]);
    else paint();
  };

  return (
    <canvas
      ref={canvasRef}
      className="draw-pad"
      width={PAD_WIDTH}
      height={PAD_HEIGHT}
      role="img"
      aria-label="Signature drawing area"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={(e) => finish(e, true)}
      onPointerCancel={(e) => finish(e, false)}
    />
  );
}
