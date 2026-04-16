import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { SimMode, stateToMode } from '../hooks/useSimulation';
import type { RuntimesMap } from '../hooks/useSimulation';
import type { DeviceInfo } from '../hooks/useDevice';
import { useT } from '../i18n';
import { DEVICE_COLORS, DEVICE_LETTERS, MODE_LABEL_KEYS } from '../lib/constants';
import LangToggle from './LangToggle';
import pkg from '../../package.json';

const APP_VERSION = (pkg as { version: string }).version;

interface Position {
  lat: number;
  lng: number;
}

interface StatusBarProps {
  isConnected: boolean;
  deviceName: string;
  iosVersion: string;
  currentPosition: Position | null;
  speed: number | string;
  mode: SimMode;
  cooldown: number;
  cooldownEnabled: boolean;
  onToggleCooldown: (enabled: boolean) => void;
  onRestore?: () => void;
  onOpenLog?: () => void;
  dualDevice?: boolean;
  runtimes?: RuntimesMap;
  devices?: DeviceInfo[];
}

function formatCooldown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const StatusBar: React.FC<StatusBarProps> = ({
  isConnected,
  deviceName,
  iosVersion,
  currentPosition,
  speed,
  mode,
  cooldown,
  cooldownEnabled,
  onToggleCooldown,
  onRestore,
  onOpenLog,
  dualDevice = false,
  runtimes,
  devices,
}) => {
  const t = useT();
  const [cooldownDisplay, setCooldownDisplay] = useState(cooldown);
  const [copied, setCopied] = useState(false);
  const [initialDialogOpen, setInitialDialogOpen] = useState(false);
  const [initialDialogValue, setInitialDialogValue] = useState('');
  const [initialDialogError, setInitialDialogError] = useState<string | null>(null);
  const [initialDialogBusy, setInitialDialogBusy] = useState(false);

  const handleInitialDialogSave = async () => {
    const { setInitialPosition } = await import('../services/api');
    const trimmed = initialDialogValue.trim();
    setInitialDialogError(null);
    if (trimmed === '') {
      setInitialDialogBusy(true);
      try {
        await setInitialPosition(null, null);
        setInitialDialogOpen(false);
      } catch (e: any) {
        setInitialDialogError(e?.message || 'error');
      } finally { setInitialDialogBusy(false); }
      return;
    }
    const m = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) {
      setInitialDialogError(t('status.set_initial_invalid'));
      return;
    }
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setInitialDialogError(t('status.set_initial_invalid'));
      return;
    }
    setInitialDialogBusy(true);
    try {
      await setInitialPosition(lat, lng);
      setInitialDialogOpen(false);
    } catch (e: any) {
      setInitialDialogError(e?.message || 'error');
    } finally { setInitialDialogBusy(false); }
  };

  useEffect(() => {
    setCooldownDisplay(cooldown);
    if (cooldown <= 0) return;

    const interval = setInterval(() => {
      setCooldownDisplay((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [cooldown]);

  return (
    <div
      className="absolute bottom-2.5 left-2.5 right-2.5 z-[var(--z-bar)] flex items-center flex-wrap gap-x-3 gap-y-1 px-4 py-1.5 text-sm text-[var(--color-text-2)] rounded-[18px] tracking-[var(--tracking-normal)]"
      style={{
        background: 'rgba(18, 21, 32, 0.72)',
        backdropFilter: 'blur(24px) saturate(160%)',
        WebkitBackdropFilter: 'blur(24px) saturate(160%)',
        border: '1px solid rgba(108, 140, 255, 0.18)',
        boxShadow: '0 14px 36px rgba(12, 18, 40, 0.48), 0 2px 8px rgba(12, 18, 40, 0.3), var(--shadow-inset)',
      }}
    >
      {/* Dual-device pills */}
      {dualDevice && devices && runtimes && devices.slice(0, 2).map((dev, i) => {
        const rt = runtimes[dev.udid];
        const color = DEVICE_COLORS[i];
        const letter = DEVICE_LETTERS[i];
        const coord = rt?.currentPos
          ? `${rt.currentPos.lat.toFixed(4)},${rt.currentPos.lng.toFixed(4)}`
          : '—';
        const spd = rt?.currentSpeedKmh ? rt.currentSpeedKmh.toFixed(0) : String(speed);
        const dMode = rt ? stateToMode(rt.state) : null;
        const modeLabel = dMode ? t(MODE_LABEL_KEYS[dMode]) : t(MODE_LABEL_KEYS[mode]);
        return (
          <div
            key={dev.udid}
            className="status-badge-ghost flex items-center gap-1.5 font-mono text-[11px]"
            title={dev.name}
          >
            <span className="font-bold" style={{ color }}>{letter}</span>
            <span>{coord}</span>
            <span className="opacity-40">&middot;</span>
            <span>{spd}km/h</span>
            <span className="opacity-40">&middot;</span>
            <span className="opacity-75">{modeLabel}</span>
          </div>
        );
      })}
      {dualDevice && <div className="separator-v" />}

      {/* Current coordinates (single-device mode only) */}
      {!dualDevice && currentPosition && (
        <>
          <div className="flex items-center gap-1 font-mono text-[11px]">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-50">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
            </svg>
            <span>{currentPosition.lat.toFixed(6)}, {currentPosition.lng.toFixed(6)}</span>
            <button
              onClick={() => {
                const txt = `${currentPosition.lat.toFixed(6)}, ${currentPosition.lng.toFixed(6)}`;
                navigator.clipboard.writeText(txt).then(
                  () => setCopied(true),
                  () => setCopied(false),
                );
                setTimeout(() => setCopied(false), 1500);
              }}
              title={t('status.copy_coord')}
              className={`bg-transparent border-none cursor-pointer px-1 inline-flex items-center transition-colors ${copied ? 'text-[var(--color-success)]' : 'text-[rgba(255,255,255,0.6)]'}`}
            >
              {copied ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
              )}
            </button>
          </div>
          <div className="separator-v" />
        </>
      )}

      {/* Speed + Mode (single-device mode only) */}
      {!dualDevice && (
        <div className="flex items-center gap-1">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-50">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          <span>{speed} km/h</span>
          <span className="opacity-40">|</span>
          <span className="opacity-70">{t(MODE_LABEL_KEYS[mode])}</span>
        </div>
      )}

      {/* Force wrap to second row */}
      <div className="basis-full h-0" />

      {/* Cooldown enable toggle */}
      <label
        title={dualDevice ? t('status.cooldown_dual_disabled') : t('status.cooldown_tooltip')}
        className={`flex items-center gap-1.5 select-none ${dualDevice ? 'cursor-not-allowed opacity-55' : 'cursor-pointer'}`}
      >
        <input
          type="checkbox"
          checked={dualDevice ? false : cooldownEnabled}
          disabled={dualDevice}
          onChange={(e) => { if (!dualDevice) onToggleCooldown(e.target.checked) }}
          className={`m-0 ${dualDevice ? 'cursor-not-allowed' : 'cursor-pointer'}`}
        />
        <span className={`${(dualDevice || !cooldownEnabled) ? 'opacity-50' : ''}`}>
          {(dualDevice || !cooldownEnabled) ? t('status.cooldown_disabled') : t('status.cooldown_enabled')}
        </span>
      </label>

      {/* Restore button */}
      {onRestore && (
        <>
          <div className="separator-v" />
          <button onClick={onRestore} title={t('status.restore_tooltip')} className="status-badge status-badge-accent cursor-pointer">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 109-9" />
              <polyline points="3,3 3,9 9,9" />
            </svg>
            {dualDevice ? t('status.restore_all') : t('status.restore')}
          </button>
          {onOpenLog && (
            <button onClick={onOpenLog} title={t('status.open_log_tooltip')} className="status-badge status-badge-warning cursor-pointer">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="8" y1="13" x2="16" y2="13" />
                <line x1="8" y1="17" x2="16" y2="17" />
              </svg>
              {t('status.open_log')}
            </button>
          )}
          <button
            onClick={async () => {
              const { getInitialPosition } = await import('../services/api');
              try {
                const res = await getInitialPosition();
                setInitialDialogValue(res.position ? `${res.position.lat}, ${res.position.lng}` : '');
              } catch { setInitialDialogValue(''); }
              setInitialDialogError(null);
              setInitialDialogOpen(true);
            }}
            title={t('status.set_initial_tooltip')}
            className="status-badge status-badge-success cursor-pointer"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {t('status.set_initial')}
          </button>
        </>
      )}

      {/* Cooldown timer */}
      {cooldownDisplay > 0 && (
        <>
          <div className="separator-v" />
          <div className="flex items-center gap-1 font-semibold text-[var(--color-device-b)]">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-device-b)" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12,6 12,12 16,14" />
            </svg>
            <span>{t('status.cooldown_active')} {formatCooldown(cooldownDisplay)}</span>
          </div>
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right cluster */}
      <div className="flex items-center gap-1.5">
        <LangToggle />
        <div className="separator-v h-3" />
        <span className="opacity-40 text-[10px]">
          {new Date().toLocaleTimeString(undefined, { hour12: false })}
        </span>
        <div className="separator-v h-3" />
        <span className="text-[10px] opacity-45 font-mono">
          v{APP_VERSION}
        </span>
      </div>

      {initialDialogOpen && createPortal((
        <div
          onClick={() => { if (!initialDialogBusy) setInitialDialogOpen(false); }}
          className="modal-overlay"
        >
          <div onClick={(e) => e.stopPropagation()} className="modal-dialog">
            <div className="modal-title">{t('status.set_initial')}</div>
            <div className="modal-body">{t('status.set_initial_prompt')}</div>
            <input
              type="text"
              value={initialDialogValue}
              onChange={(e) => { setInitialDialogValue(e.target.value); setInitialDialogError(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !initialDialogBusy) handleInitialDialogSave();
                if (e.key === 'Escape' && !initialDialogBusy) setInitialDialogOpen(false);
              }}
              autoFocus
              placeholder="25.033, 121.564"
              className="seg-input w-full font-mono"
            />
            {initialDialogError && (
              <div className="text-[var(--color-danger)] text-[11px] mt-2">{initialDialogError}</div>
            )}
            <div className="modal-actions">
              <button
                onClick={() => setInitialDialogOpen(false)}
                disabled={initialDialogBusy}
                className="action-btn"
              >{t('generic.cancel')}</button>
              <button
                onClick={handleInitialDialogSave}
                disabled={initialDialogBusy}
                className="action-btn primary"
                style={{ opacity: initialDialogBusy ? 0.6 : 1 }}
              >{t('generic.save')}</button>
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  );
};

export default StatusBar;
