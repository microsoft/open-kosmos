import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Brain } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import type { CardDetail, CardSummary } from '@shared/types/memexTypes';
import { memexApi, memexEvents } from '../../ipc/memex';
import { mcpClientCacheManager } from '../../lib/mcp/mcpClientCacheManager';
import {
  ANCHORED_DROPDOWN_SIZE_PRESETS,
  AnchoredDropdownPosition,
  getAnchoredDropdownPosition,
} from '../../lib/utilities/dropdownPosition';
import { useProfileData } from '../userData/userDataProvider';
import { useToast } from '../ui/ToastProvider';
import { useI18n } from '../../lib/i18n/useI18n';
import { Badge } from '../ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import ProfileMemoryListPanel from './ProfileMemoryListPanel';
import ProfileMemoryDetailPanel from './ProfileMemoryDetailPanel';
import ProfileMemoryDropdownMenu from './ProfileMemoryDropdownMenu';
import '../../styles/Header.css';
import '../../styles/DropdownMenu.css';
import '../../styles/ToolbarSettingsView.css';
import '../../styles/MemexMemory.css';

const MemexSettingsView: React.FC = () => {
  const [searchParams] = useSearchParams();
  const requestedCardSlugRef = useRef<string | null>(searchParams.get('selectCard'));
  const profileData = useProfileData();
  const currentAlias = profileData?.data.profile?.alias || null;
  const profileEnabled = profileData?.data.profile?.memex?.enabled === true;
  const { showSuccess, showError } = useToast();
  const { t } = useI18n();
  const tRef = useRef(t);

  const [masterEnabled, setMasterEnabled] = useState(profileEnabled);
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<CardDetail | null>(null);
  const [query, setQuery] = useState('');
  const [loadingCards, setLoadingCards] = useState(false);
  const [loadingCard, setLoadingCard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [menuState, setMenuState] = useState<{
    slug: string | null;
    position: AnchoredDropdownPosition | null;
  }>({ slug: null, position: null });
  const menuRef = useRef<HTMLDivElement>(null);
  const [archiveTarget, setArchiveTarget] = useState<CardSummary | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CardSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const listSeqRef = useRef(0);
  const detailSeqRef = useRef(0);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    setMasterEnabled(profileEnabled);
  }, [profileEnabled]);

  const clearMemoryState = useCallback(() => {
    listSeqRef.current += 1;
    detailSeqRef.current += 1;
    setCards([]);
    setSelectedSlug(null);
    setSelectedCard(null);
    setDetailError(null);
    setMenuState({ slug: null, position: null });
  }, []);

  const loadCards = useCallback(async () => {
    if (!masterEnabled) {
      clearMemoryState();
      return;
    }
    const seq = ++listSeqRef.current;
    setLoadingCards(true);
    setError(null);
    try {
      const trimmed = query.trim();
      const result = trimmed
        ? await memexApi.searchProfileCards(trimmed)
        : await memexApi.listProfileCards();
      if (seq !== listSeqRef.current) return;
      if (result.success) {
        setCards(result.data ?? []);
      } else {
        setCards([]);
        setError(result.error ?? tRef.current('profileMemory.loadFailed'));
      }
    } catch (e) {
      if (seq !== listSeqRef.current) return;
      setCards([]);
      setError(e instanceof Error ? e.message : tRef.current('profileMemory.loadFailed'));
    } finally {
      if (seq === listSeqRef.current) setLoadingCards(false);
    }
  }, [clearMemoryState, masterEnabled, query]);

  const loadCardDetail = useCallback(async (slug: string) => {
    const seq = ++detailSeqRef.current;
    setLoadingCard(true);
    setDetailError(null);
    try {
      const result = await memexApi.readProfileCard(slug);
      if (seq !== detailSeqRef.current) return;
      if (result.success) {
        setSelectedCard(result.data ?? null);
      } else {
        setSelectedCard(null);
        setDetailError(result.error ?? tRef.current('profileMemory.loadCardFailed'));
      }
    } catch (e) {
      if (seq !== detailSeqRef.current) return;
      setSelectedCard(null);
      setDetailError(e instanceof Error ? e.message : tRef.current('profileMemory.loadCardFailed'));
    } finally {
      if (seq === detailSeqRef.current) setLoadingCard(false);
    }
  }, []);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);

  useEffect(() => {
    if (!masterEnabled) return;
    if (loadingCards) return;
    if (cards.length === 0) {
      detailSeqRef.current += 1;
      setSelectedSlug(null);
      setSelectedCard(null);
      setDetailError(null);
      return;
    }
    const requested = requestedCardSlugRef.current;
    if (requested && cards.some(card => card.slug === requested)) {
      requestedCardSlugRef.current = null;
      setSelectedSlug(requested);
      return;
    }
    if (requested && selectedSlug === requested) {
      return;
    }
    if (!selectedSlug || !cards.some(card => card.slug === selectedSlug)) {
      setSelectedSlug(cards[0].slug);
    }
  }, [cards, loadingCards, masterEnabled, selectedSlug]);

  useEffect(() => {
    if (!selectedSlug) return;
    void loadCardDetail(selectedSlug);
  }, [loadCardDetail, selectedSlug]);

  useEffect(() => {
    const unsub = memexEvents.cardsChanged(payload => {
      if (payload.scope !== 'profile-memory') return;
      void loadCards();
      if (selectedSlug) {
        void loadCardDetail(selectedSlug);
      }
    });
    return unsub;
  }, [loadCards, loadCardDetail, selectedSlug]);

  useEffect(() => {
    if (!menuState.slug) return;
    const handleClickOutside = () => {
      setMenuState({ slug: null, position: null });
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuState.slug]);

  const applyMasterSwitch = useCallback(async (value: boolean) => {
    setError(null);
    if (!currentAlias) {
      const errMsg = t('profileMemory.noSignedInUser');
      setError(errMsg);
      showError(t('profileMemory.failedToUpdate', { error: errMsg }));
      return;
    }

    try {
      const result = await window.electronAPI.profile.updateMemexSettings(currentAlias, { enabled: value });
      if (result.success) {
        setMasterEnabled(value);
        if (!value) clearMemoryState();
        void mcpClientCacheManager.refresh();
        showSuccess(value ? t('profileMemory.enabledToast') : t('profileMemory.disabledToast'));
      } else {
        const errMsg = result.error || t('common.unknownError');
        setError(errMsg);
        showError(t('profileMemory.failedToUpdate', { error: errMsg }));
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setError(errMsg);
      showError(t('profileMemory.failedToUpdate', { error: errMsg }));
    }
  }, [clearMemoryState, currentAlias, showError, showSuccess, t]);

  const handleSelectCard = useCallback((card: CardSummary) => {
    setSelectedSlug(card.slug);
  }, []);

  const handleNavigateCardLink = useCallback((slug: string) => {
    requestedCardSlugRef.current = slug;
    setQuery('');
    setSelectedSlug(slug);
  }, []);

  const handleMenuToggle = useCallback((slug: string, buttonElement: HTMLElement) => {
    if (menuState.slug === slug) {
      setMenuState({ slug: null, position: null });
      return;
    }
    const position = getAnchoredDropdownPosition(buttonElement, ANCHORED_DROPDOWN_SIZE_PRESETS.hookMenu);
    setSelectedSlug(slug);
    setMenuState({ slug, position });
  }, [menuState.slug]);

  const closeMenu = useCallback(() => {
    setMenuState({ slug: null, position: null });
  }, []);

  const requestArchive = useCallback((card: CardSummary) => {
    setArchiveTarget(card);
  }, []);

  const requestDelete = useCallback((card: CardSummary) => {
    setDeleteTarget(card);
  }, []);

  const confirmArchive = useCallback(async (card: CardSummary) => {
    setArchiveBusy(true);
    setError(null);
    try {
      const res = await memexApi.archiveProfileCard(card.slug);
      if (res.success) {
        if (selectedSlug === card.slug) {
          detailSeqRef.current += 1;
          setSelectedSlug(null);
          setSelectedCard(null);
        }
        setArchiveTarget(null);
        await loadCards();
        showSuccess(res.data ?? t('profileMemory.archiveSuccess', { slug: card.slug }));
      } else {
        setError(res.error ?? t('profileMemory.archiveFailed'));
        showError(res.error ?? t('profileMemory.archiveFailed'));
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : t('profileMemory.archiveFailed');
      setError(errMsg);
      showError(errMsg);
    } finally {
      setArchiveBusy(false);
    }
  }, [loadCards, selectedSlug, showError, showSuccess, t]);

  const confirmDelete = useCallback(async (card: CardSummary) => {
    setDeleteBusy(true);
    setError(null);
    try {
      const res = await memexApi.deleteProfileCard(card.slug);
      if (res.success) {
        if (selectedSlug === card.slug) {
          detailSeqRef.current += 1;
          setSelectedSlug(null);
          setSelectedCard(null);
        }
        setDeleteTarget(null);
        await loadCards();
        showSuccess(res.data ?? t('profileMemory.deleteSuccess', { slug: card.slug }));
      } else {
        setError(res.error ?? t('profileMemory.deleteFailed'));
        showError(res.error ?? t('profileMemory.deleteFailed'));
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : t('profileMemory.deleteFailed');
      setError(errMsg);
      showError(errMsg);
    } finally {
      setDeleteBusy(false);
    }
  }, [loadCards, selectedSlug, showError, showSuccess, t]);

  const menuCard = cards.find(card => card.slug === menuState.slug) ?? null;

  return (
    <div className="profile-memory-view">
      <div className="unified-header">
        <div className="header-title">
          <Brain className="header-icon" size={20} />
          <span className="header-name">{t('settings.navigation.memex')}</span>
          <div className="profile-memory-status-badges">
            <Badge variant="normal" className="text-xs">{t('profileMemory.cardsCount', { count: masterEnabled ? cards.length : 0 })}</Badge>
            <Badge variant="normal" className="text-xs">profile-memory</Badge>
          </div>
        </div>
        <div className="header-actions">
          <div className="profile-memory-master">
            <span>{t('profileMemory.enableMemory')}</span>
            <label className="toolbar-toggle-wrapper">
              <input
                type="checkbox"
                checked={masterEnabled}
                onChange={e => void applyMasterSwitch(e.target.checked)}
                aria-label={t('profileMemory.enableAria')}
              />
              <div className="toolbar-toggle-track"></div>
            </label>
          </div>
        </div>
      </div>

      <div className="profile-memory-content">
        {error ? <p className="profile-memory-error">{error}</p> : null}

        {masterEnabled ? (
          <div className="profile-memory-two-col" data-testid="profile-memory-manager">
            <div className="profile-memory-list-panel">
              <ProfileMemoryListPanel
                cards={cards}
                loading={loadingCards}
                query={query}
                selectedSlug={selectedSlug}
                onQueryChange={setQuery}
                onSelect={handleSelectCard}
                onMenuToggle={handleMenuToggle}
              />
            </div>
            <ProfileMemoryDetailPanel
              card={selectedCard}
              loading={loadingCard}
              error={detailError}
              onNavigate={handleNavigateCardLink}
            />
          </div>
        ) : (
          <div className="profile-memory-disabled-body" data-testid="profile-memory-disabled-state">
            <div className="profile-memory-empty-state">
              <div className="profile-memory-empty-icon">
                <Brain size={48} strokeWidth={1.5} />
              </div>
              <h3>{t('profileMemory.disabledTitle')}</h3>
              <p>{t('profileMemory.disabledDescription')}</p>
              <p className="profile-memory-empty-hint">
                {t('profileMemory.disabledHint')}
              </p>
              <div className="profile-memory-disabled-actions">
                <button
                  type="button"
                  className="profile-memory-disabled-primary"
                  onClick={() => void applyMasterSwitch(true)}
                  aria-label={t('profileMemory.enableFromEmptyAria')}
                >
                  {t('profileMemory.enableMemexMemory')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {menuState.slug && menuState.position && menuCard ? (
        <ProfileMemoryDropdownMenu
          menuRef={menuRef}
          card={menuCard}
          position={menuState.position}
          onArchive={requestArchive}
          onDelete={requestDelete}
          onClose={closeMenu}
        />
      ) : null}

      <Dialog open={archiveTarget !== null} onOpenChange={() => setArchiveTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-left">{t('profileMemory.archiveTitle')}</DialogTitle>
            <DialogDescription className="text-left">
              {t('profileMemory.archiveDescription', { name: archiveTarget?.title || archiveTarget?.slug || '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-danger-600">
              {t('profileMemory.archiveWarning')}
            </p>
          </div>
          <DialogFooter>
            <button
              className="btn-secondary"
              onClick={() => setArchiveTarget(null)}
              aria-label={t('profileMemory.cancelArchiveAria')}
              disabled={archiveBusy}
            >
              {t('common.cancel')}
            </button>
            <button
              className="btn-danger"
              onClick={() => archiveTarget && void confirmArchive(archiveTarget)}
              aria-label={t('profileMemory.confirmArchiveAria')}
              disabled={archiveBusy}
            >
              {archiveBusy ? t('profileMemory.archiving') : t('profileMemory.archive')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-left">{t('profileMemory.deleteTitle')}</DialogTitle>
            <DialogDescription className="text-left">
              {t('profileMemory.deleteDescription', { name: deleteTarget?.title || deleteTarget?.slug || '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-danger-600">
              {t('profileMemory.deleteWarning')}
            </p>
          </div>
          <DialogFooter>
            <button
              className="btn-secondary"
              onClick={() => setDeleteTarget(null)}
              aria-label={t('profileMemory.cancelDeleteAria')}
              disabled={deleteBusy}
            >
              {t('common.cancel')}
            </button>
            <button
              className="btn-danger"
              onClick={() => deleteTarget && void confirmDelete(deleteTarget)}
              aria-label={t('profileMemory.confirmDeleteAria')}
              disabled={deleteBusy}
            >
              {deleteBusy ? t('profileMemory.deleting') : t('profileMemory.delete')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MemexSettingsView;
