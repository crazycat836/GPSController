import React from 'react';
import { useT } from '../i18n';
import type { RuntimesMap } from '../hooks/useSimulation';

interface EtaBarProps {
  state: string;
  progress: number;
  remainingDistance: number;
  traveledDistance: number;
  eta: number;
  runtimes?: RuntimesMap;
}

const ACTIVE_STATES = ['navigating', 'looping', 'multi_stop', 'random_walk'];

function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${Math.round(meters)} m`;
}

function formatTime(seconds: number): string {
  if (seconds <= 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const EtaBar: React.FC<EtaBarProps> = ({
  state,
  progress,
  remainingDistance,
  traveledDistance,
  eta,
  runtimes,
}) => {
  const t = useT();

  const activeRuntimes = runtimes
    ? Object.values(runtimes).filter((r) => ACTIVE_STATES.includes(r.state))
    : [];
  const isGroup = activeRuntimes.length >= 2;

  if (!isGroup && !ACTIVE_STATES.includes(state)) return null;
  if (isGroup && activeRuntimes.length === 0) return null;

  const aggProgress = isGroup
    ? activeRuntimes.reduce((s, r) => s + (r.progress || 0), 0) / activeRuntimes.length
    : progress;
  const aggEta = isGroup
    ? Math.max(...activeRuntimes.map((r) => r.eta || 0))
    : eta;
  const aggRemaining = isGroup
    ? Math.max(...activeRuntimes.map((r) => r.distanceRemaining || 0))
    : remainingDistance;
  const aggTraveled = isGroup
    ? activeRuntimes.reduce((s, r) => s + (r.distanceTraveled || 0), 0)
    : traveledDistance;

  const percent = Math.min(Math.max(aggProgress * 100, 0), 100);

  return (
    <div className="absolute top-2.5 left-2.5 right-2.5 z-[var(--z-ui)] surface-panel rounded-[var(--radius-lg)] px-[18px] py-[7px] flex items-center flex-wrap gap-x-4 gap-y-1.5 text-sm text-[var(--color-text-1)] tracking-[var(--tracking-normal)]">
      {/* Progress bar */}
      <div className="flex-1 h-1 rounded-sm bg-[var(--color-surface-2)] overflow-hidden min-w-[80px]">
        <div
          className="h-full rounded-sm transition-[width] duration-500 ease-out"
          style={{
            width: `${percent}%`,
            background: 'linear-gradient(90deg, var(--color-device-a), #34a853)',
          }}
        />
      </div>

      {/* Percentage */}
      <span className="font-semibold min-w-[38px] text-right">
        {percent.toFixed(0)}%
      </span>

      <div className="separator-v" />

      {/* Remaining distance */}
      <div className="flex items-center gap-1">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-60">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12,6 12,12 16,14" />
        </svg>
        <span>{t('eta.remaining')} {formatDistance(aggRemaining)}</span>
      </div>

      <div className="separator-v" />

      {/* ETA */}
      <div className="flex items-center gap-1">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-60">
          <path d="M5 12h14" />
          <path d="M12 5l7 7-7 7" />
        </svg>
        <span>{t('eta.eta')} {formatTime(aggEta)}</span>
      </div>

      <div className="separator-v" />

      {/* Traveled distance */}
      <div className="flex items-center gap-1 opacity-70">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-60">
          <polyline points="22,12 18,12 15,21 9,3 6,12 2,12" />
        </svg>
        <span>{t('eta.traveled')} {formatDistance(aggTraveled)}</span>
      </div>

      {isGroup && (
        <>
          <div className="separator-v" />
          <div className="flex items-center gap-1.5 text-[11px] opacity-85">
            <span className="opacity-60">{t('eta.group_progress')}</span>
            {activeRuntimes.slice(0, 2).map((r, i) => (
              <span key={r.udid} className="font-semibold" style={{ color: i === 0 ? 'var(--color-device-a)' : 'var(--color-device-b)' }}>
                {i === 0 ? 'A' : 'B'} {formatTime(r.eta || 0)}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default EtaBar;
