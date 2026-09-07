import { useT } from '../../i18n/locale';
import { invokeAction } from '../../shortcuts/actionRegistry';
import { theme } from '../../theme';
import type { SettingsVendorPage } from './settingsFields';

type NoteAction = NonNullable<SettingsVendorPage['noteAction']>;

export function SettingsNoteAction({ config }: { config: NoteAction }) {
  const t = useT();
  if ('href' in config) {
    return <a href={config.href} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 7, color: theme.text, textDecoration: 'underline' }}>{t(config.label)}</a>;
  }
  return (
    <button
      type="button"
      onClick={() => invokeAction(config.action, undefined, 'menu')}
      style={{ alignSelf: 'flex-start', marginTop: 7, height: 24, padding: '0 10px', fontSize: 12, borderRadius: 3, border: `0.5px solid ${theme.border}`, background: theme.panel, color: theme.text, cursor: 'pointer' }}
    >
      {t(config.label)}
    </button>
  );
}
