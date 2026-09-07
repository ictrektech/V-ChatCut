import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useT } from '../i18n/locale';
import { theme } from '../theme';
import { CURRENT_APP_VERSION, formatDisplayVersion, loadCurrentAppVersion, UPSTREAM_RELEASES_URL } from '../ui/upstreamUpdate';
import { Icon } from './icons';

export function AboutButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(CURRENT_APP_VERSION);
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    void loadCurrentAppVersion().then(setVersion);
  }, []);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', dismiss);
    };
  }, [open]);

  return (
    <span ref={root} style={rootStyle}>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-label={t('关于')} aria-expanded={open}
        data-tip={t('关于')} className="cc-header-btn cc-tip cc-tip-r" style={buttonStyle}>
        <Icon name="info" size={16} />
      </button>
      {open && <div role="dialog" aria-label={t('关于')} style={popoverStyle}>
        <strong style={{ color: theme.textStrong }}>V-ChatCut</strong>
        <span style={{ color: theme.textDim, fontSize: 12 }}>{t('当前版本号：{version}', { version: formatDisplayVersion(version) })}</span>
        <a href={UPSTREAM_RELEASES_URL} target="_blank" rel="noopener noreferrer" style={releaseLink}>{t('查看发布页')}</a>
      </div>}
    </span>
  );
}

const rootStyle: CSSProperties = { position: 'relative', display: 'inline-flex' };
const buttonStyle: CSSProperties = {
  width: 28, height: 28, padding: 0, display: 'grid', placeItems: 'center',
  border: 'none', borderRadius: 4, background: 'none', color: theme.textDim, cursor: 'pointer',
};
const popoverStyle: CSSProperties = {
  position: 'absolute', top: 34, right: 0, zIndex: 90, width: 220,
  display: 'flex', flexDirection: 'column', gap: 8, padding: 12,
  border: `0.5px solid ${theme.border}`, borderRadius: 6, background: theme.panelAlt,
  boxShadow: '0 8px 24px rgba(var(--cc-shadow-rgb), 0.3)',
};
const releaseLink: CSSProperties = { color: theme.accent, fontSize: 12, textDecoration: 'none' };
