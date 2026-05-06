import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import pkg from '../../package.json';
import { useT } from '../i18n';
import { STORAGE_KEYS } from '../lib/storage-keys';

const CURRENT = (pkg as { version: string }).version;
const REPO = 'crazycat836/GPSController';
const RELEASES_URL = `https://github.com/${REPO}/releases`;
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const COOLDOWN_MS = 6 * 60 * 60 * 1000;
const DISMISS_KEY = STORAGE_KEYS.updateDismissed;

// Electron preload exposes an `openExternal` bridge so clicks on GitHub
// links open in the system browser rather than the webview. Web builds
// don't define it; fall back to the native `<a target="_blank">` nav.
interface ElectronBridge {
  gpsController?: { openExternal?: (url: string) => void }
}

function parseVer(s: string): number[] {
  return s.replace(/^v/i, '').split('.').map((p) => parseInt(p, 10) || 0);
}

/** Returns true if `a` is strictly newer than `b`. */
function isNewer(a: string, b: string): boolean {
  const x = parseVer(a);
  const y = parseVer(b);
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const xi = x[i] ?? 0;
    const yi = y[i] ?? 0;
    if (xi !== yi) return xi > yi;
  }
  return false;
}

function openExternalOrDefault(url: string, e: React.MouseEvent) {
  const bridge = (window as unknown as ElectronBridge).gpsController;
  if (bridge?.openExternal) {
    e.preventDefault();
    bridge.openExternal(url);
  }
}

/**
 * Checks GitHub on mount for a newer release; shows a dismissible dialog
 * when one is found. Silent when already on the latest version or when
 * the network / API is unreachable. User-dismissed versions are cached
 * in localStorage for 6 hours to avoid nagging.
 */
export default function UpdateChecker() {
  const t = useT();
  const [latest, setLatest] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let dismissedVersion: string | null = null;
      try {
        const raw = localStorage.getItem(DISMISS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { version?: unknown; at?: unknown };
          if (typeof parsed.version === 'string' && typeof parsed.at === 'number' &&
              Date.now() - parsed.at < COOLDOWN_MS) {
            dismissedVersion = parsed.version;
          }
        }
      } catch { /* malformed cache — treat as not-dismissed */ }

      try {
        const r = await fetch(API_URL, {
          headers: { Accept: 'application/vnd.github+json' },
        });
        if (!r.ok || cancelled) return;
        const data = await r.json();
        const tag: string | undefined = data?.tag_name;
        if (!tag || !isNewer(tag, CURRENT)) return;

        // Respect an in-cooldown dismissal for this exact version; a
        // newer tag still shows so we don't strand users on a skipped
        // release forever.
        if (dismissedVersion && parseVer(tag).join('.') === parseVer(dismissedVersion).join('.')) {
          return;
        }
        setLatest(tag);
      } catch {
        // Offline / rate-limited / DNS — silent.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!latest) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify({
        version: latest, at: Date.now(),
      }));
    } catch { /* storage disabled */ }
    setLatest(null);
  };

  return createPortal(
    <div
      className="modal-overlay anim-fade-in"
      onClick={dismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-dialog anim-scale-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-checker-title"
      >
        <div className="flex items-center gap-2.5 mb-3.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg, var(--color-accent), var(--color-device-a))' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <path d="M12 2v13M5 9l7-7 7 7" />
              <path d="M5 21h14" />
            </svg>
          </div>
          <h2 id="update-checker-title" className="modal-title">
            {t('update.title')}
          </h2>
        </div>

        <div className="modal-body">
          <div className="flex justify-between">
            <span className="opacity-65">{t('update.current')}</span>
            <span className="font-mono">v{CURRENT}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="opacity-65">{t('update.latest')}</span>
            <a
              href={RELEASES_URL}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[var(--color-accent)] font-semibold no-underline"
              onClick={(e) => openExternalOrDefault(RELEASES_URL, e)}
            >
              {latest} ↗
            </a>
          </div>
        </div>

        <p className="text-xs text-[var(--color-text-1)] opacity-75 mb-4 leading-relaxed">
          {t('update.go_to_github')}
        </p>

        <div className="modal-actions">
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            className="action-btn primary flex-1 text-center no-underline inline-flex items-center justify-center gap-1.5"
            onClick={(e) => openExternalOrDefault(RELEASES_URL, e)}
          >
            {t('update.download')}
          </a>
          <button type="button" className="action-btn" onClick={dismiss}>
            {t('update.later')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
