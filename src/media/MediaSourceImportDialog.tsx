import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ImportedMediaSource,
  MediaSourceId,
  MediaSourceItem,
  MediaSourceProvider,
} from '../../shared/media-source';
import { Icon } from '../components/icons';
import { useT } from '../i18n/locale';
import {
  importMediaSourceItems,
  listMediaSource,
  listMediaSourceProviders,
} from './mediaSourceApi';
import './media-source-import.css';

interface MediaSourceImportDialogProps {
  onClose: () => void;
  onImport: (items: ImportedMediaSource[]) => Promise<void>;
}

function sizeLabel(bytes?: number): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function ProviderButton(props: {
  provider: MediaSourceProvider;
  active: boolean;
  onClick: () => void;
}) {
  return <button
    type="button"
    className={`${props.active ? 'active' : ''}${props.provider.available ? '' : ' unavailable'}`}
    onClick={props.onClick}
  >
    <strong>{props.provider.label}</strong>
    <span>{props.provider.detail}</span>
  </button>;
}

export function MediaSourceImportDialog({ onClose, onImport }: MediaSourceImportDialogProps) {
  const t = useT();
  const [providers, setProviders] = useState<MediaSourceProvider[]>([]);
  const [source, setSource] = useState<MediaSourceId>('vos');
  const [path, setPath] = useState('');
  const [parentPath, setParentPath] = useState<string>();
  const [items, setItems] = useState<MediaSourceItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const provider = providers.find((candidate) => candidate.id === source);

  const load = useCallback(async (nextSource: MediaSourceId, nextPath = '', nextQuery = '') => {
    setBusy(true);
    setError(null);
    setSelected(new Set());
    try {
      const result = await listMediaSource(nextSource, nextPath, nextQuery);
      setPath(result.path);
      setParentPath(result.parentPath);
      setItems(result.items);
    } catch (reason) {
      setItems([]);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void listMediaSourceProviders().then((available) => {
      if (!active) return;
      setProviders(available);
      const initial = available.find((candidate) => candidate.available)?.id ?? 'vos';
      setSource(initial);
      return load(initial);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [load]);

  const mediaIds = useMemo(() => items.filter((item) => item.kind === 'media').map((item) => item.id), [items]);
  const selectSource = (entry: MediaSourceProvider) => {
    setSource(entry.id);
    setQuery('');
    if (entry.available) void load(entry.id);
    else {
      setBusy(false);
      setError(null);
      setItems([]);
      setSelected(new Set());
      setPath('');
      setParentPath(undefined);
    }
  };
  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected((current) => (
    current.size === mediaIds.length ? new Set() : new Set(mediaIds)
  ));
  const submit = async () => {
    if (!selected.size) return;
    setBusy(true);
    setError(null);
    try {
      await onImport(await importMediaSourceItems(source, [...selected]));
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  return <div className="cc-modal-backdrop" role="dialog" aria-modal="true" aria-label={t('从外部来源导入素材')} onClick={onClose}>
    <div className="cc-media-source-dialog" onClick={(event) => event.stopPropagation()}>
      <header>
        <div><strong>{t('导入媒体')}</strong><span>{t('从 VOS 存储、WebDAV 或 AI 相册选择素材')}</span></div>
        <button type="button" aria-label={t('关闭')} onClick={onClose}><Icon name="x" size={18} /></button>
      </header>
      <div className="cc-media-source-body">
        <aside>{providers.map((entry) => <ProviderButton
          key={entry.id}
          provider={entry}
          active={entry.id === source}
          onClick={() => selectSource(entry)}
        />)}</aside>
        <main>
          {provider && !provider.available
            ? <div className="cc-media-source-path"><span>{provider.detail}</span></div>
            : provider?.searchable
            ? <form className="cc-media-source-search" onSubmit={(event) => { event.preventDefault(); void load(source, '', query); }}>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('搜索 AI 相册')} />
              <button type="submit" disabled={busy}>{t('搜索')}</button>
            </form>
            : <div className="cc-media-source-path">
              <button type="button" disabled={parentPath === undefined || busy} onClick={() => void load(source, parentPath ?? '')}>←</button>
              <span>/{path}</span>
            </div>}
          <div className="cc-media-source-list">
            {provider && !provider.available && <div className="cc-media-source-empty">{provider.detail}</div>}
            {provider?.available && busy && <div className="cc-media-source-empty">{t('正在读取媒体来源…')}</div>}
            {!busy && error && <div className="cc-media-source-error">{error}</div>}
            {provider?.available && !busy && !error && items.length === 0 && <div className="cc-media-source-empty">{t('这里没有可导入的媒体')}</div>}
            {!busy && !error && items.map((item) => item.kind === 'folder'
              ? <button type="button" className="cc-media-source-folder" key={item.id} onClick={() => void load(source, item.id)}>
                <Icon name="folder" size={17} /><span>{item.name}</span><b>›</b>
              </button>
              : <label className="cc-media-source-item" key={item.id}>
                <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} />
                <span title={item.name}>{item.name}</span><small>{sizeLabel(item.bytes)}</small>
              </label>)}
          </div>
        </main>
      </div>
      <footer>
        <button type="button" disabled={!mediaIds.length || busy} onClick={toggleAll}>{selected.size === mediaIds.length && mediaIds.length ? t('取消全选') : t('全选')}</button>
        <span>{t('已选择 {n} 个素材', { n: selected.size })}</span>
        <button type="button" onClick={onClose}>{t('取消')}</button>
        <button type="button" className="primary" disabled={!selected.size || busy} onClick={() => void submit()}>{busy && selected.size ? t('正在导入…') : t('导入')}</button>
      </footer>
    </div>
  </div>;
}
