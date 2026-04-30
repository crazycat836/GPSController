import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { reverseGeocode } from '../services/api';

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  lat: number;
  lng: number;
}

interface WhatsHereState {
  loading: boolean;
  label: string;
  address: string;
  error: boolean;
}

const WHATS_HERE_IDLE: WhatsHereState = { loading: false, label: '', address: '', error: false };

interface MapContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
  onTeleport: (lat: number, lng: number) => void;
  onNavigate: (lat: number, lng: number) => void;
  onAddBookmark: (lat: number, lng: number) => void;
  onAddWaypoint?: (lat: number, lng: number) => void;
  showWaypointOption?: boolean;
  deviceConnected: boolean;
  onShowToast?: (msg: string) => void;
}

/**
 * Right-click context menu for the Leaflet map. Hosts the "What's here?"
 * reverse-geocode flow and the device-gated teleport / navigate / bookmark /
 * add-waypoint actions. Self-contained: owns its viewport-clamp measurement
 * effect and outside-click dismissal so MapView only needs to track the
 * trigger state.
 */
function MapContextMenu({
  state,
  onClose,
  onTeleport,
  onNavigate,
  onAddBookmark,
  onAddWaypoint,
  showWaypointOption,
  deviceConnected,
  onShowToast,
}: MapContextMenuProps) {
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;

  // Measured-and-clamped menu position. Null while the menu is hidden or
  // before useLayoutEffect has run once; the menu is rendered invisibly on
  // first frame to measure, then re-rendered at the clamped position.
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [whatsHere, setWhatsHere] = useState<WhatsHereState>(WHATS_HERE_IDLE);

  // Reset transient menu state when the menu hides.
  useEffect(() => {
    if (!state.visible) {
      setMenuPos(null);
      setWhatsHere(WHATS_HERE_IDLE);
    }
  }, [state.visible]);

  // Close context menu on outside click.
  useEffect(() => {
    if (!state.visible) return;
    const handler = () => onClose();
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [state.visible, onClose]);

  // Clamp the context menu to the viewport. Running in useLayoutEffect lets
  // us measure the real DOM before the browser paints, so the menu doesn't
  // visibly flash in the clipped position before jumping back in-bounds.
  useLayoutEffect(() => {
    if (!state.visible) return;
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    const maxLeft = window.innerWidth - rect.width - pad;
    const maxTop = window.innerHeight - rect.height - pad;
    const left = Math.max(pad, Math.min(state.x, maxLeft));
    const top = Math.max(pad, Math.min(state.y, maxTop));
    setMenuPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
    // Re-measure when the "What's here" panel expands/collapses — its
    // content changes the menu's height so we need to re-clamp. whatsHere
    // is referenced so the effect re-runs on every transition.
  }, [state.visible, state.x, state.y, whatsHere.loading, whatsHere.label, whatsHere.address, whatsHere.error]);

  const handleWhatsHere = useCallback(async () => {
    const lat = state.lat;
    const lng = state.lng;
    setWhatsHere({ loading: true, label: '', address: '', error: false });
    try {
      const res = await reverseGeocode(lat, lng);
      if (!res) {
        setWhatsHere({ loading: false, label: '', address: '', error: true });
        return;
      }
      setWhatsHere({
        loading: false,
        label: res.place_name || res.display_name || '',
        address: res.display_name || '',
        error: false,
      });
    } catch {
      setWhatsHere({ loading: false, label: '', address: '', error: true });
    }
  }, [state.lat, state.lng]);

  if (!state.visible) return null;

  return (
    <div
      data-fc="map.context-menu"
      ref={menuRef}
      className="context-menu anim-scale-in-tl"
      style={{
        position: 'fixed',
        // On first render we haven't measured yet; hide the menu so the
        // user doesn't see it flash at an out-of-bounds location before
        // useLayoutEffect clamps it. Once measured, render at clamped
        // position and make visible.
        left: menuPos?.left ?? state.x,
        top: menuPos?.top ?? state.y,
        visibility: menuPos ? 'visible' : 'hidden',
        zIndex: 'var(--z-dropdown)',
        background: 'var(--color-surface-1)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: '4px 0',
        boxShadow: 'var(--shadow-lg)',
        minWidth: 180,
        maxWidth: 360,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 1. Coordinates label — clickable. Tapping it reverse-geocodes
            and expands the human-readable address inline underneath,
            so the user can sanity-check "where is this?" before
            choosing teleport / navigate. */}
      <button
        type="button"
        onClick={handleWhatsHere}
        disabled={whatsHere.loading}
        style={{
          all: 'unset',
          boxSizing: 'border-box',
          width: '100%',
          padding: '8px 16px 6px',
          color: 'var(--color-accent-strong)',
          fontSize: 12,
          fontFamily: 'monospace',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          userSelect: 'text',
          cursor: whatsHere.loading ? 'progress' : 'pointer',
        }}
        title={tRef.current('map.whats_here')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.7, flexShrink: 0 }}>
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        <span>{state.lat.toFixed(6)}, {state.lng.toFixed(6)}</span>
      </button>
      {whatsHere.loading && (
        <div style={{ padding: '0 16px 6px', fontSize: 11, opacity: 0.7, fontStyle: 'italic' }}>
          {tRef.current('map.whats_here_loading')}
        </div>
      )}
      {!whatsHere.loading && whatsHere.error && (
        <div style={{ padding: '0 16px 6px', fontSize: 11, color: 'var(--color-danger)' }}>
          {tRef.current('map.whats_here_failed')}
        </div>
      )}
      {!whatsHere.loading && !whatsHere.error && whatsHere.label && (
        <div style={{ padding: '0 16px 6px', fontSize: 11, color: 'var(--color-text-1)' }}>
          <div style={{ fontWeight: 600 }}>{whatsHere.label}</div>
          {whatsHere.address && whatsHere.address !== whatsHere.label && (
            <div style={{ opacity: 0.7, marginTop: 2, lineHeight: 1.35 }}>{whatsHere.address}</div>
          )}
        </div>
      )}
      <div style={{ height: 1, background: 'var(--color-border)', margin: '2px 0 4px' }} />

      {/* 2 + 3. Teleport / Navigate (device-gated). */}
      {deviceConnected ? (
        <>
          <div
            className="context-menu-item"
            style={contextMenuItemStyle}
            onMouseEnter={highlightItem}
            onMouseLeave={unhighlightItem}
            onClick={() => {
              onTeleport(state.lat, state.lng);
              onClose();
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="2" x2="12" y2="6" />
              <line x1="12" y1="18" x2="12" y2="22" />
              <line x1="2" y1="12" x2="6" y2="12" />
              <line x1="18" y1="12" x2="22" y2="12" />
            </svg>
            {t('map.teleport_here')}
          </div>
          <div
            className="context-menu-item"
            style={contextMenuItemStyle}
            onMouseEnter={highlightItem}
            onMouseLeave={unhighlightItem}
            onClick={() => {
              onNavigate(state.lat, state.lng);
              onClose();
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8 }}>
              <polygon points="3,11 22,2 13,21 11,13" />
            </svg>
            {t('map.navigate_here')}
          </div>
        </>
      ) : (
        <div
          style={{ ...contextMenuItemStyle, color: 'var(--color-danger-text)', cursor: 'not-allowed', opacity: 0.75 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8 }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
          {t('map.device_disconnected')}
        </div>
      )}

      {/* 4. Copy coordinates to clipboard. */}
      <div
        className="context-menu-item"
        style={contextMenuItemStyle}
        onMouseEnter={highlightItem}
        onMouseLeave={unhighlightItem}
        onClick={async () => {
          const txt = `${state.lat.toFixed(6)}, ${state.lng.toFixed(6)}`;
          try {
            await navigator.clipboard.writeText(txt);
          } catch {
            const ta = document.createElement('textarea');
            ta.value = txt;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch { /* ignore */ }
            document.body.removeChild(ta);
          }
          if (onShowToast) onShowToast(tRef.current('map.coords_copied'));
          onClose();
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8 }}>
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
        {t('map.copy_coords')}
      </div>

      {/* 5. Add to bookmarks. */}
      <div
        className="context-menu-item"
        style={contextMenuItemStyle}
        onMouseEnter={highlightItem}
        onMouseLeave={unhighlightItem}
        onClick={() => {
          onAddBookmark(state.lat, state.lng);
          onClose();
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8 }}>
          <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
        </svg>
        {t('map.add_bookmark')}
      </div>

      {/* 6. Add waypoint (only when in a route mode). */}
      {showWaypointOption && onAddWaypoint && (
        <>
          <div style={{ height: 1, background: 'var(--color-border-strong)', margin: '4px 0' }} />
          <div
            className="context-menu-item"
            style={contextMenuItemStyle}
            onMouseEnter={highlightItem}
            onMouseLeave={unhighlightItem}
            onClick={() => {
              onAddWaypoint(state.lat, state.lng);
              onClose();
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8 }}>
              <circle cx="12" cy="12" r="3" />
              <line x1="12" y1="5" x2="12" y2="1" />
              <line x1="12" y1="23" x2="12" y2="19" />
              <line x1="5" y1="12" x2="1" y2="12" />
              <line x1="23" y1="12" x2="19" y2="12" />
            </svg>
            {t('map.add_waypoint')}
          </div>
        </>
      )}
    </div>
  );
}

const contextMenuItemStyle: React.CSSProperties = {
  padding: '8px 16px',
  cursor: 'pointer',
  color: 'var(--color-text-1)',
  fontSize: 13,
  display: 'flex',
  alignItems: 'center',
  transition: 'background 0.15s',
};

function highlightItem(e: React.MouseEvent<HTMLDivElement>) {
  (e.currentTarget as HTMLDivElement).style.background = 'var(--color-surface-hover)';
}

function unhighlightItem(e: React.MouseEvent<HTMLDivElement>) {
  (e.currentTarget as HTMLDivElement).style.background = 'transparent';
}

export default MapContextMenu;
