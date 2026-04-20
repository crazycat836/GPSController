import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useT } from '../i18n';

interface JoystickPadProps {
  direction: number;
  intensity: number;
  onMove: (direction: number, intensity: number) => void;
  onRelease: () => void;
}

const PAD_RADIUS = 70;
const HANDLE_RADIUS = 22;
const MAX_DISTANCE = PAD_RADIUS - HANDLE_RADIUS;
// Exponential-smoothing time constant for the visual handle. 40 ms gives a
// noticeably-smooth glide on keyboard/diagonal input without feeling sluggish
// under mouse drag (where the target updates per pointermove and so the
// visual tracks 1:1 anyway).
const SMOOTH_TAU_MS = 40;
const SETTLE_EPS = 0.05; // px — stop animating when both axes are within this

function JoystickPad({
  direction,
  intensity,
  onMove,
  onRelease,
}: JoystickPadProps) {
  const t = useT();
  const padRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  // Target is updated synchronously by pointer/keyboard input; the visual
  // handle position exponentially follows it inside a requestAnimationFrame
  // loop. Using a ref for the target avoids re-rendering on every input
  // event and lets the RAF loop always read the latest target.
  const targetPosRef = useRef({ x: 0, y: 0 });
  const [visualPos, setVisualPos] = useState({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);

  // Kick the RAF loop whenever we set a new target. The loop self-terminates
  // once the visual settles onto the target to avoid burning cycles while idle.
  const ensureAnimating = useCallback(() => {
    if (rafRef.current !== null) return;
    lastTickRef.current = 0;
    const tick = (now: number) => {
      const dt = lastTickRef.current ? Math.min(now - lastTickRef.current, 100) : 16;
      lastTickRef.current = now;
      const alpha = 1 - Math.exp(-dt / SMOOTH_TAU_MS);
      setVisualPos((prev) => {
        const tx = targetPosRef.current.x;
        const ty = targetPosRef.current.y;
        const nx = prev.x + (tx - prev.x) * alpha;
        const ny = prev.y + (ty - prev.y) * alpha;
        if (Math.abs(tx - nx) < SETTLE_EPS && Math.abs(ty - ny) < SETTLE_EPS) {
          rafRef.current = null;
          return { x: tx, y: ty };
        }
        rafRef.current = requestAnimationFrame(tick);
        return { x: nx, y: ny };
      });
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  const getDirectionLabel = (deg: number): string => {
    // deg is compass degrees: 0=N, 90=E, 180=S, 270=W
    const d = ((deg % 360) + 360) % 360;
    if (d >= 337.5 || d < 22.5) return t('joy.north');
    if (d >= 22.5 && d < 67.5) return t('joy.northeast');
    if (d >= 67.5 && d < 112.5) return t('joy.east');
    if (d >= 112.5 && d < 157.5) return t('joy.southeast');
    if (d >= 157.5 && d < 202.5) return t('joy.south');
    if (d >= 202.5 && d < 247.5) return t('joy.southwest');
    if (d >= 247.5 && d < 292.5) return t('joy.west');
    return t('joy.northwest');
  };

  const calcFromEvent = useCallback(
    (clientX: number, clientY: number) => {
      if (!padRef.current) return;
      const rect = padRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      let dx = clientX - centerX;
      let dy = -(clientY - centerY); // Invert Y for math coords

      const distance = Math.sqrt(dx * dx + dy * dy);
      const clampedDist = Math.min(distance, MAX_DISTANCE);
      const normIntensity = clampedDist / MAX_DISTANCE;

      // Convert to compass degrees: 0=N, 90=E, 180=S, 270=W
      // atan2(dx, dy) gives 0=N, π/2=E, matching compass convention
      const radians = Math.atan2(dx, dy);
      let compassDeg = (radians * 180) / Math.PI;
      if (compassDeg < 0) compassDeg += 360;

      // Clamp visual position to pad bounds so the handle sticks to the edge
      // when the cursor is dragged outside. Combined with pointer capture on
      // currentTarget (the pad itself, not just the handle), this keeps the
      // direction responsive even when the cursor leaves the pad area.
      const scale = distance > 0 ? clampedDist / distance : 0;
      targetPosRef.current = {
        x: dx * scale,
        y: -(dy * scale),
      };
      ensureAnimating();
      onMove(Math.round(compassDeg), normIntensity);
    },
    [onMove, ensureAnimating]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      setDragging(true);
      // Capture on currentTarget (the pad), NOT e.target. When the cursor
      // drifts onto the handle's inner <div> and then back out, capturing on
      // e.target can lose subsequent pointermove events. currentTarget is the
      // element the handler is bound to and is guaranteed to receive them.
      e.currentTarget.setPointerCapture(e.pointerId);
      calcFromEvent(e.clientX, e.clientY);
    },
    [calcFromEvent]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      calcFromEvent(e.clientX, e.clientY);
    },
    [dragging, calcFromEvent]
  );

  const handlePointerUp = useCallback(() => {
    setDragging(false);
    targetPosRef.current = { x: 0, y: 0 };
    ensureAnimating();
    onRelease();
  }, [onRelease, ensureAnimating]);

  // ── WASD / arrow keyboard control ───────────────────
  useEffect(() => {
    const pressed = new Set<string>();
    const KEY_DIR: Record<string, string> = {
      w: 'up', arrowup: 'up',
      s: 'down', arrowdown: 'down',
      a: 'left', arrowleft: 'left',
      d: 'right', arrowright: 'right',
    };

    // Map direction set → (compass deg, intensity)
    const compute = () => {
      const up = pressed.has('up');
      const down = pressed.has('down');
      const left = pressed.has('left');
      const right = pressed.has('right');
      if (!up && !down && !left && !right) return null;

      let dx = 0, dy = 0;
      if (up) dy += 1;
      if (down) dy -= 1;
      if (right) dx += 1;
      if (left) dx -= 1;
      if (dx === 0 && dy === 0) return null;

      const rad = Math.atan2(dx, dy);
      let deg = (rad * 180) / Math.PI;
      if (deg < 0) deg += 360;
      return { deg: Math.round(deg), dx, dy };
    };

    const update = () => {
      const r = compute();
      if (!r) {
        setDragging(false);
        targetPosRef.current = { x: 0, y: 0 };
        ensureAnimating();
        onRelease();
        return;
      }
      setDragging(true);
      onMove(r.deg, 1);
      // Update the *target*; the RAF loop glides the visual handle from
      // its current position to the combined direction. Diagonal keypresses
      // (e.g. W+D) glide straight to NE instead of visibly stopping at N first.
      const len = Math.sqrt(r.dx * r.dx + r.dy * r.dy);
      targetPosRef.current = {
        x: (r.dx / len) * MAX_DISTANCE,
        y: -(r.dy / len) * MAX_DISTANCE,
      };
      ensureAnimating();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing in inputs/textareas
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const key = e.key.toLowerCase();
      const dir = KEY_DIR[key];
      if (!dir) return;
      e.preventDefault();
      if (!pressed.has(dir)) {
        pressed.add(dir);
        update();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const dir = KEY_DIR[key];
      if (!dir) return;
      if (pressed.delete(dir)) update();
    };
    const onBlur = () => {
      if (pressed.size > 0) {
        pressed.clear();
        setDragging(false);
        targetPosRef.current = { x: 0, y: 0 };
        ensureAnimating();
        onRelease();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [onMove, onRelease, ensureAnimating]);

  // Direction arrows around the pad
  const arrows = [
    { deg: 0, label: t('joy.east'), x: PAD_RADIUS + 20, y: 0 },
    { deg: 90, label: t('joy.north'), x: 0, y: -(PAD_RADIUS + 20) },
    { deg: 180, label: t('joy.west'), x: -(PAD_RADIUS + 20), y: 0 },
    { deg: 270, label: t('joy.south'), x: 0, y: PAD_RADIUS + 20 },
  ];

  return (
    <div
      data-fc="map.joystick"
      className="joystick-overlay"
      style={{
        position: 'absolute',
        bottom: 60,
        right: 20,
        zIndex: 'var(--z-float)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: PAD_RADIUS * 2 + 50,
          height: PAD_RADIUS * 2 + 50,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Direction labels */}
        {arrows.map((a) => (
          <div
            key={a.label}
            style={{
              position: 'absolute',
              left: `calc(50% + ${a.x}px)`,
              top: `calc(50% + ${a.y}px)`,
              transform: 'translate(-50%, -50%)',
              fontSize: 11,
              fontWeight: 600,
              color: 'rgba(255,255,255,0.5)',
            }}
          >
            {a.label}
          </div>
        ))}

        {/* Pad background */}
        <div
          ref={padRef}
          className="joystick-pad"
          style={{
            width: PAD_RADIUS * 2,
            height: PAD_RADIUS * 2,
            borderRadius: '50%',
            background: 'rgba(30, 30, 40, 0.75)',
            border: '2px solid rgba(255,255,255,0.15)',
            position: 'relative',
            cursor: dragging ? 'grabbing' : 'grab',
            backdropFilter: 'blur(8px)',
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {/* Crosshair lines */}
          <svg
            width={PAD_RADIUS * 2}
            height={PAD_RADIUS * 2}
            viewBox={`0 0 ${PAD_RADIUS * 2} ${PAD_RADIUS * 2}`}
            style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
          >
            <line x1={PAD_RADIUS} y1="10" x2={PAD_RADIUS} y2={PAD_RADIUS * 2 - 10} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
            <line x1="10" y1={PAD_RADIUS} x2={PAD_RADIUS * 2 - 10} y2={PAD_RADIUS} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
            <circle cx={PAD_RADIUS} cy={PAD_RADIUS} r={PAD_RADIUS - 5} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
            <circle cx={PAD_RADIUS} cy={PAD_RADIUS} r={MAX_DISTANCE / 2} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="4 4" />
          </svg>

          {/* Handle — positioned by the RAF smoothing loop, no CSS transition. */}
          <div
            className="joystick-handle"
            style={{
              width: HANDLE_RADIUS * 2,
              height: HANDLE_RADIUS * 2,
              borderRadius: '50%',
              background: dragging
                ? 'radial-gradient(circle, #6b8afd 0%, #4a6cf7 100%)'
                : 'radial-gradient(circle, #888 0%, #555 100%)',
              border: '2px solid rgba(255,255,255,0.3)',
              position: 'absolute',
              left: PAD_RADIUS - HANDLE_RADIUS + visualPos.x,
              top: PAD_RADIUS - HANDLE_RADIUS + visualPos.y,
              pointerEvents: 'none',
              boxShadow: dragging ? '0 0 12px rgba(74,108,247,0.5)' : '0 2px 6px rgba(0,0,0,0.3)',
            }}
          />
        </div>
      </div>

      {/* Info text */}
      <div
        style={{
          marginTop: 8,
          textAlign: 'center',
          fontSize: 12,
          color: 'rgba(255,255,255,0.7)',
          background: 'rgba(30, 30, 40, 0.65)',
          padding: '4px 12px',
          borderRadius: 4,
          backdropFilter: 'blur(4px)',
        }}
      >
        {intensity > 0.01 ? (
          <>
            {getDirectionLabel(direction)} | {(intensity * 100).toFixed(0)}%
          </>
        ) : (
          t('joy.drag_or_keys')
        )}
      </div>
    </div>
  );
};

export default JoystickPad;
