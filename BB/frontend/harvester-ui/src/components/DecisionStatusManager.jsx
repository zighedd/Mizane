import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Eye, Globe, Database, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import ConfirmationModal from './ConfirmationModal';
import CoursSupremeSearchPanel from './CoursSupremeSearchPanel';

const COURSUPREME_API_URL = 'http://localhost:5001/api/coursupreme';

const SEMANTIC_SCORE_THRESHOLD = 0.45;
const SEMANTIC_ITEM_LIMIT = 20;
const DECISIONS_PAGE_SIZE = 20;

const toIsoFromDecisionDate = (value) => {
  if (!value) return null;
  const cleaned = value.replace(/\//g, '-');
  const parts = cleaned.split('-').filter(Boolean);
  if (parts.length !== 3) return null;
  let day = parts[0];
  let month = parts[1];
  let year = parts[2];
  if (year.length !== 4 && parts[0].length === 4) {
    year = parts[0];
    month = parts[1];
    day = parts[2];
  }
  if (year.length !== 4) return null;
  return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
};

const toIsoFromFilterDate = (value, isEnd = false) => {
  if (!value) return null;
  const cleaned = value.trim();
  if (!cleaned) return null;
  const segments = cleaned.replace(/\//g, '-').split('-').filter(Boolean);
  if (!segments.length) return null;

  let day = '01';
  let month = '01';
  let year = '';

  if (segments.length >= 3) {
    if (segments[0].length === 4) {
      year = segments[0];
      month = segments[1];
      day = segments[2];
    } else {
      day = segments[0];
      month = segments[1];
      year = segments[2];
    }
  } else if (segments.length === 2) {
    if (segments[0].length === 4) {
      year = segments[0];
      month = segments[1];
      day = isEnd ? '31' : '01';
    } else {
      day = '01';
      month = segments[0];
      year = segments[1];
    }
  } else {
    const segment = segments[0];
    if (segment.length === 4) {
      year = segment;
      month = isEnd ? '12' : '01';
      day = isEnd ? '31' : '01';
    } else {
      return null;
    }
  }

  return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
};

const DecisionStatusManager = ({ exportEndpoint = 'http://localhost:5001/api/joradp/documents/export' }) => {
  const [decisions, setDecisions] = useState([]);
  const [filteredDecisions, setFilteredDecisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDecisions, setSelectedDecisions] = useState(new Set());
  const [sortField, setSortField] = useState('decision_date');
  const [sortOrder, setSortOrder] = useState('desc');
  const [searchTerm, setSearchTerm] = useState('');
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [filters, setFilters] = useState({
    keywordsInclusive: '',
    keywordsOr: '',
    keywordsExclusive: '',
    decisionNumber: '',
    dateFrom: '',
    dateTo: '',
    chambersOr: [],
    chambersInclusive: [],
    themesOr: [],
    themesInclusive: []
  });
  const [isSearching, setIsSearching] = useState(false);
  const [languageScope, setLanguageScope] = useState('both');
  const [activeSearchIds, setActiveSearchIds] = useState(null);
  const [searchScoreMap, setSearchScoreMap] = useState(new Map());
  const [searchResultsSnapshot, setSearchResultsSnapshot] = useState(null);
  const [searchResultCount, setSearchResultCount] = useState(0);
  const [appliedSearchTerm, setAppliedSearchTerm] = useState('');
  const [appliedFilters, setAppliedFilters] = useState({
    keywordsInclusive: '',
    keywordsOr: '',
    keywordsExclusive: '',
    decisionNumber: '',
    dateFrom: '',
    dateTo: '',
    chambersOr: [],
    chambersInclusive: [],
    themesOr: [],
    themesInclusive: []
  });
  const [searchTriggered, setSearchTriggered] = useState(false);
  const [semanticCache, setSemanticCache] = useState(null);
  const [semanticStats, setSemanticStats] = useState({
    count: 0,
    minScore: null,
    maxScore: null,
    scoreThreshold: SEMANTIC_SCORE_THRESHOLD,
    limit: SEMANTIC_ITEM_LIMIT
  });
  const [semanticLimit, setSemanticLimit] = useState(SEMANTIC_ITEM_LIMIT);
  const [semanticThreshold, setSemanticThreshold] = useState(SEMANTIC_SCORE_THRESHOLD);
  const [currentPage, setCurrentPage] = useState(1);
  const [availableChambers, setAvailableChambers] = useState([]);
  const [availableThemes, setAvailableThemes] = useState([]);
  const [resetCounter, setResetCounter] = useState(0);

  const decisionsById = useMemo(() => {
    const map = new Map();
    decisions.forEach((d) => map.set(d.id, d));
    return map;
  }, [decisions]);

  useEffect(() => {
    fetch(`${COURSUPREME_API_URL}/chambers`)
      .then((res) => res.json())
      .then((data) => setAvailableChambers(data.chambers || []))
      .catch(() => setAvailableChambers([]));

    fetch(`${COURSUPREME_API_URL}/themes/all`)
      .then((res) => res.json())
      .then((data) => setAvailableThemes(data.themes || []))
      .catch(() => setAvailableThemes([]));
  }, []);

  // Modal states
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    type: 'warning',
    title: '',
    message: '',
    onConfirm: null,
    confirmText: 'Confirmer',
    cancelText: 'Annuler',
    showCancel: true,
    loading: false
  });
  const closeModal = () => setConfirmModal(prev => ({ ...prev, isOpen: false }));
  const [processing, setProcessing] = useState(false);

  // Decision detail modal
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedDecision, setSelectedDecision] = useState(null);
  const [selectedLang, setSelectedLang] = useState('ar');

  // Metadata modal
  const [metadataModalOpen, setMetadataModalOpen] = useState(false);
  const [selectedMetadata, setSelectedMetadata] = useState(null);
  const [metadataLang, setMetadataLang] = useState('ar');
  const totalPages = Math.max(1, Math.ceil(filteredDecisions.length / DECISIONS_PAGE_SIZE));
  const paginatedDecisions = useMemo(() => {
    const start = (currentPage - 1) * DECISIONS_PAGE_SIZE;
    const end = start + DECISIONS_PAGE_SIZE;
    return filteredDecisions.slice(start, end);
  }, [filteredDecisions, currentPage]);
  const handlePageChange = (direction) => {
    setCurrentPage((prev) => {
      const candidate = direction === 'next' ? prev + 1 : prev - 1;
      return Math.max(1, Math.min(totalPages, candidate));
    });
  };

  const semanticHasNumericScores = searchScoreMap.size > 0 && Array.from(searchScoreMap.values()).some(value => typeof value === 'number');
  const showSemanticStats = semanticStats.count > 0 || semanticHasNumericScores;

  useEffect(() => {
    fetchDecisions();
  }, []);

  const sortDecisions = useCallback(
    (list, scores = new Map()) => {
      const sorted = [...list];
      const numericScores =
        scores && scores.size
          ? Array.from(scores.values()).some((value) => typeof value === 'number')
          : false;

      if (numericScores) {
        sorted.sort((a, b) => {
          const scoreA = scores.get(a.id) ?? 0;
          const scoreB = scores.get(b.id) ?? 0;
          return scoreB - scoreA;
        });
      } else {
        sorted.sort((a, b) => {
          let aVal = a[sortField];
          let bVal = b[sortField];

          if (sortField === 'decision_date') {
            aVal = new Date(aVal || '1900-01-01');
            bVal = new Date(bVal || '1900-01-01');
          } else {
            aVal = aVal || '';
            bVal = bVal || '';
          }

          if (sortOrder === 'asc') {
            return aVal > bVal ? 1 : -1;
          }
          return aVal < bVal ? 1 : -1;
        });
      }

      setFilteredDecisions(sorted);
    },
    [sortField, sortOrder],
  );

  const applyFiltersAndSort = useCallback(() => {
    // Tant qu'aucune recherche n'est validée, on laisse la liste complète.
    if (!searchTriggered) {
      setSearchResultCount(decisions.length);
      sortDecisions(decisions);
      return;
    }

    let filtered = [...decisions];

    // Recherche simple : utiliser la dernière requête appliquée, pas la saisie en cours.
    if (appliedSearchTerm) {
      const lowerSearch = appliedSearchTerm.toLowerCase();
      filtered = filtered.filter(
        (d) =>
          d.decision_number?.toLowerCase().includes(lowerSearch) ||
          d.decision_date?.includes(appliedSearchTerm),
      );
    }

    // Filtres avancés
    if (appliedFilters.decisionNumber) {
      filtered = filtered.filter((d) =>
        d.decision_number?.toLowerCase().includes(appliedFilters.decisionNumber.toLowerCase()),
      );
    }

    const getTextValues = (decision) =>
      [
        decision.summary_ar,
        decision.summary_fr,
        decision.object_ar,
        decision.object_fr,
      ].map((text) => text?.toLowerCase() || '');

    const containsKeyword = (decision, keyword) => {
      if (!keyword) return false;
      return getTextValues(decision).some((value) => value.includes(keyword));
    };

    const applyKeywordCondition = (value, field) => {
      const keywords = value
        .split(',')
        .map((kw) => kw.trim().toLowerCase())
        .filter(Boolean);
      if (!keywords.length) return filtered;
      switch (field) {
        case 'inclusive':
          return filtered.filter((decision) =>
            keywords.every((kw) => containsKeyword(decision, kw)),
          );
        case 'exclusive':
          return filtered.filter((decision) =>
            keywords.every((kw) => !containsKeyword(decision, kw)),
          );
        case 'or':
        default:
          return filtered.filter((decision) =>
            keywords.some((kw) => containsKeyword(decision, kw)),
          );
      }
    };

    if (appliedFilters.keywordsInclusive) {
      filtered = applyKeywordCondition(appliedFilters.keywordsInclusive, 'inclusive');
    }

    if (appliedFilters.keywordsExclusive) {
      filtered = applyKeywordCondition(appliedFilters.keywordsExclusive, 'exclusive');
    }

    if (appliedFilters.keywordsOr) {
      filtered = applyKeywordCondition(appliedFilters.keywordsOr, 'or');
    }

    const fromIso = toIsoFromFilterDate(appliedFilters.dateFrom);
    if (fromIso) {
      filtered = filtered.filter((d) => {
        const decisionIso = toIsoFromDecisionDate(d.decision_date);
        return decisionIso ? decisionIso >= fromIso : false;
      });
    }

    const toIso = toIsoFromFilterDate(appliedFilters.dateTo, true);
    if (toIso) {
      filtered = filtered.filter((d) => {
        const decisionIso = toIsoFromDecisionDate(d.decision_date);
        return decisionIso ? decisionIso <= toIso : false;
      });
    }

    setSearchResultCount(filtered.length);
    sortDecisions(filtered);
  }, [decisions, appliedFilters, appliedSearchTerm, searchTriggered, sortDecisions]);

  useEffect(() => {
    if (activeSearchIds !== null) {
      const matches = Array.isArray(searchResultsSnapshot) && searchResultsSnapshot.length > 0
        ? searchResultsSnapshot
        : (activeSearchIds.size ? decisions.filter((decision) => activeSearchIds.has(decision.id)) : []);
      sortDecisions(matches, searchScoreMap);
    } else {
      applyFiltersAndSort();
    }
  }, [
    activeSearchIds,
    decisions,
    searchScoreMap,
    searchResultsSnapshot,
    applyFiltersAndSort,
    sortDecisions,
  ]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filteredDecisions]);

  const resetSearchCriteria = () => {
    setSearchTerm('');
    setFilters({
      keywordsInclusive: '',
      keywordsOr: '',
      keywordsExclusive: '',
      decisionNumber: '',
      dateFrom: '',
      dateTo: '',
      chambersOr: [],
      chambersInclusive: [],
      themesOr: [],
      themesInclusive: []
    });
    setAppliedSearchTerm('');
    setAppliedFilters({
      keywordsInclusive: '',
      keywordsOr: '',
      keywordsExclusive: '',
      decisionNumber: '',
      dateFrom: '',
      dateTo: '',
      chambersOr: [],
      chambersInclusive: [],
      themesOr: [],
      themesInclusive: []
    });
    setLanguageScope('both');
    setShowAdvancedSearch(false);
    setSearchTriggered(false);
    setResetCounter((n) => n + 1);
  };

  const fetchDecisions = async () => {
    try {
      const response = await fetch(`${COURSUPREME_API_URL}/decisions/status`);
      const data = await response.json();
      const normalized = (data.decisions || []).map((decision) => {
        const status =
          decision.status ||
          decision.statuts ||
          {
            downloaded: 'missing',
            translated: 'missing',
            analyzed: 'missing',
            embeddings: 'missing'
          };
        return {
          ...decision,
          status,
          chambers: Array.isArray(decision.chambers) ? decision.chambers : [],
          themes: Array.isArray(decision.themes) ? decision.themes : []
        };
      });
      setDecisions(normalized);
      setLoading(false);
    } catch (error) {
      console.error('Erreur:', error);
      setLoading(false);
    }
  };

  const resetSemanticState = () => {
    setSemanticCache(null);
    setSearchScoreMap(new Map());
    setSearchResultsSnapshot(null);
    setActiveSearchIds(null);
    setSemanticStats({
      count: 0,
      minScore: null,
      maxScore: null,
      scoreThreshold: semanticThreshold,
      limit: semanticLimit
    });
  };

  const applySemanticFilters = useCallback(() => {
    // On n'applique les résultats sémantiques que si une recherche est réellement active.
    if (!searchTriggered) return;
    if (!semanticCache || !Array.isArray(semanticCache.results) || semanticCache.results.length === 0) {
      return;
    }
    const filtered = semanticCache.results
      .map((item) => ({ ...decisionsById.get(item.id), ...item }))
      .filter((item) => typeof item.score === 'number' && item.score >= semanticThreshold);
    const limited = filtered.slice(0, semanticLimit);
    const ids = new Set(limited.map((item) => item.id));
    const scoreMap = new Map(semanticCache.results.map((item) => [item.id, item.score]));

    setSearchResultsSnapshot(limited);
    setActiveSearchIds(ids);
    setSearchScoreMap(scoreMap);
    setSemanticStats({
      count: limited.length,
      minScore: limited.length ? limited[limited.length - 1].score : null,
      maxScore: limited.length ? limited[0].score : (semanticCache.results[0]?.score ?? null),
      scoreThreshold: semanticThreshold,
      limit: semanticLimit
    });
    setSearchResultCount(limited.length);

    const matches = ids.size ? filtered.filter((decision) => ids.has(decision.id)) : [];
    sortDecisions(matches, scoreMap);
  }, [semanticCache, semanticLimit, semanticThreshold, decisionsById, searchTriggered, sortDecisions]);

  useEffect(() => {
    if (semanticStats.count === 0) return;
    setSemanticStats((prev) => ({
      ...prev,
      scoreThreshold: semanticThreshold,
      limit: semanticLimit,
    }));
  }, [semanticLimit, semanticThreshold, semanticStats.count]);

  useEffect(() => {
    applySemanticFilters();
  }, [applySemanticFilters]);

  const runSearch = (options = {}) => {
    const currentFilters = options.filters ?? filters;
    const rawTerm = options.searchTerm ?? searchTerm;
    const trimmed = (rawTerm || '').trim();
    const hasSearchTerm = Boolean(trimmed);
    const hasAdvancedFilters = Boolean(
      currentFilters.keywordsInclusive ||
      currentFilters.keywordsOr ||
      currentFilters.keywordsExclusive ||
      currentFilters.decisionNumber ||
      currentFilters.dateFrom ||
      currentFilters.dateTo ||
      (currentFilters.chambersOr && currentFilters.chambersOr.length) ||
      (currentFilters.chambersInclusive && currentFilters.chambersInclusive.length) ||
      (currentFilters.themesOr && currentFilters.themesOr.length) ||
      (currentFilters.themesInclusive && currentFilters.themesInclusive.length)
    );

    if (!hasSearchTerm && !hasAdvancedFilters) {
      setSearchTriggered(false);
      setAppliedSearchTerm('');
      setAppliedFilters({
        keywordsInclusive: '',
        keywordsOr: '',
        keywordsExclusive: '',
        decisionNumber: '',
        dateFrom: '',
        dateTo: '',
        chambersOr: [],
        chambersInclusive: [],
        themesOr: [],
        themesInclusive: []
      });
      setActiveSearchIds(null);
      setSearchScoreMap(new Map());
      setSearchResultsSnapshot(null);
      resetSemanticState();
      applyFiltersAndSort();
      setIsSearching(false);
      return;
    }

    // Une recherche est effectivement demandée : on fige l'état courant.
    setSearchTriggered(true);
    setAppliedSearchTerm(trimmed);
    setAppliedFilters({ ...currentFilters });

    setIsSearching(true);
    const finalize = () => {
      setIsSearching(false);
    };

    const tokens = hasSearchTerm ? trimmed.split(/\s+/).filter(Boolean) : [];

    if (hasSearchTerm && !hasAdvancedFilters) {
      // Requête courte (un seul mot) : privilégier la recherche classique par mots-clés.
      if (tokens.length === 1) {
        setActiveSearchIds(null);
        setSearchScoreMap(new Map());
        setSearchResultsSnapshot(null);
        resetSemanticState();

        const params = new URLSearchParams();
        params.append('keywords_or', trimmed);
        params.append('decision_number', trimmed);
        params.append('language_scope', languageScope);

        fetch(`${COURSUPREME_API_URL}/search/advanced?${params.toString()}`)
          .then((res) => res.json())
          .then((data) => {
            const results = data.results || [];
            const ids = new Set(results.map((result) => result.id));
            setSearchResultsSnapshot(results);
            setActiveSearchIds(ids);
            setSearchResultCount(data.count ?? ids.size);
            sortDecisions(ids.size ? decisions.filter((decision) => ids.has(decision.id)) : [], new Map());
          })
          .catch((error) => {
            console.error('Erreur recherche mots-clés:', error);
            const emptySet = new Set();
            setActiveSearchIds(emptySet);
            setSearchResultsSnapshot([]);
            setSearchResultCount(0);
            sortDecisions([]);
          })
          .finally(finalize);
        return;
      }

      // Sinon : recherche sémantique (cache complet des scores, sans recalcul).
      setActiveSearchIds(null);
      setSearchScoreMap(new Map());
      resetSemanticState();
      const semanticParams = new URLSearchParams({
        q: trimmed,
        language_scope: languageScope,
        // Le backend renvoie all_results, on garde limit/threshold pour les stats initiales.
        limit: semanticLimit.toString(),
        score_threshold: semanticThreshold.toString()
      });
      fetch(`${COURSUPREME_API_URL}/search/semantic?${semanticParams.toString()}`)
        .then((res) => res.json())
        .then((data) => {
          const allResults = (data.all_results || data.results || []).map((item) => ({
            ...decisionsById.get(item.id),
            ...item
          }));
          if (!allResults.length) {
            resetSemanticState();
            applyFiltersAndSort();
            return;
          }
          const filtered = allResults.filter((item) => typeof item.score === 'number' && item.score >= semanticThreshold);
          const limited = filtered.slice(0, semanticLimit);
          const ids = new Set(limited.map((item) => item.id));
          const scoreMap = new Map(allResults.map((item) => [item.id, item.score]));

          setSemanticCache({
            query: data.query || searchTerm,
            results: allResults,
            count: data.count ?? allResults.length
          });
          setSearchResultsSnapshot(limited);
          setActiveSearchIds(ids);
          setSearchScoreMap(scoreMap);
          setSemanticStats({
            count: limited.length,
            minScore: limited.length ? limited[limited.length - 1].score : null,
            maxScore: limited.length ? limited[0].score : (allResults[0]?.score ?? null),
            scoreThreshold: semanticThreshold,
            limit: semanticLimit
          });
          setSearchResultCount(limited.length);
          const matches = ids.size ? limited.filter((decision) => ids.has(decision.id)) : [];
          sortDecisions(matches, scoreMap);
        })
        .catch((error) => {
          console.error('Erreur recherche sémantique:', error);
          resetSemanticState();
          applyFiltersAndSort();
        })
        .finally(finalize);
      return;
    }

    const params = new URLSearchParams();
    if (hasSearchTerm) {
      params.append('keywords_or', trimmed);
      params.append('decision_number', trimmed);
    }
    if (currentFilters.keywordsInclusive) {
      params.append('keywords_inc', currentFilters.keywordsInclusive);
    }
    if (currentFilters.keywordsOr) {
      params.append('keywords_or', currentFilters.keywordsOr);
    }
    if (currentFilters.keywordsExclusive) {
      params.append('keywords_exc', currentFilters.keywordsExclusive);
    }
    if (currentFilters.decisionNumber) {
      params.append('decision_number', currentFilters.decisionNumber);
    }
    if (currentFilters.dateFrom) {
      params.append('date_from', currentFilters.dateFrom);
    }
    if (currentFilters.dateTo) {
      params.append('date_to', currentFilters.dateTo);
    }
    if (currentFilters.chambersInclusive && currentFilters.chambersInclusive.length) {
      params.append('chambers_inc', currentFilters.chambersInclusive.join(','));
    }
    if (currentFilters.chambersOr && currentFilters.chambersOr.length) {
      params.append('chambers_or', currentFilters.chambersOr.join(','));
    }
    if (currentFilters.themesInclusive && currentFilters.themesInclusive.length) {
      params.append('themes_inc', currentFilters.themesInclusive.join(','));
    }
    if (currentFilters.themesOr && currentFilters.themesOr.length) {
      params.append('themes_or', currentFilters.themesOr.join(','));
    }
    params.append('language_scope', languageScope);
    setActiveSearchIds(null);
    setSearchScoreMap(new Map());
    resetSemanticState();

        fetch(`${COURSUPREME_API_URL}/search/advanced?${params.toString()}`)
          .then((res) => res.json())
          .then((data) => {
            const results = (data.results || []).map((item) => ({ ...(decisionsById.get(item.id) || {}), ...item }));
            const ids = new Set(results.map((result) => result.id));
            setSearchResultsSnapshot(results);
            setActiveSearchIds(ids);
            setSearchResultCount(data.count ?? ids.size);
            const matches = ids.size ? results.filter((decision) => ids.has(decision.id)) : [];
            sortDecisions(matches, new Map());
          })
      .catch((error) => {
        console.error('Erreur recherche:', error);
        const emptySet = new Set();
        setActiveSearchIds(emptySet);
        setSearchResultsSnapshot([]);
        setSearchResultCount(0);
        sortDecisions([]);
      })
      .finally(finalize);
  };

  const handleResetAndSearch = () => {
    // Réinitialise l'UI et lance une recherche vide avec les filtres remis à zéro.
    resetSearchCriteria();
    setActiveSearchIds(null);
    setSearchScoreMap(new Map());
    setSearchResultsSnapshot(null);
    setSemanticCache(null);
    runSearch({
      searchTerm: '',
      filters: {
        keywordsInclusive: '',
        keywordsOr: '',
        keywordsExclusive: '',
        decisionNumber: '',
        dateFrom: '',
        dateTo: '',
        chambersOr: [],
        chambersInclusive: [],
        themesOr: [],
        themesInclusive: []
      }
    });
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const toggleSelectAll = () => {
    if (selectedDecisions.size === filteredDecisions.length) {
      setSelectedDecisions(new Set());
    } else {
      setSelectedDecisions(new Set(filteredDecisions.map(d => d.id)));
    }
  };

  const toggleSelectDecision = (id) => {
    const newSelected = new Set(selectedDecisions);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedDecisions(newSelected);
  };

  // Indicateur de statut coloré
  const StatusIndicator = ({ status }) => {
    const normalize = (value) => {
      if (value === true) return 'complete';
      if (value === false || value == null) return 'missing';
      const val = String(value).toLowerCase().trim();
      if (['success', 'completed', 'complete', 'ok', 'done', 'true', 'downloaded'].includes(val)) return 'complete';
      if (['partial', 'processing', 'running', 'in_progress'].includes(val)) return 'partial';
      return 'missing';
    };
    const normalized = normalize(status);
    const colors = {
      complete: 'bg-green-500',
      partial: 'bg-orange-500',
      missing: 'bg-red-500'
    };
    const color = colors[normalized] || 'bg-red-500';
    return <div className={`w-3 h-3 rounded-full ${color}`} title={normalized} />;
  };

  const formatBatchMessage = (data, successLabel, total) => {
    if (data?.message && data.message.trim()) return data.message;
    const success = data?.success_count ?? data?.results?.success?.length ?? 0;
    const failed = data?.failed_count ?? data?.results?.failed?.length ?? 0;
    const skipped = data?.skipped_count ?? data?.results?.skipped?.length ?? 0;
    const plural = (value, label) => `${value} ${label}${value > 1 ? 's' : ''}`;
    return [
      `Total demandé : ${total}`,
      `✅ ${plural(success, successLabel)}`,
      `⚠️ ${plural(skipped, 'décision ignorée')}`,
      `❌ ${plural(failed, 'échec')}`
    ].join('\n');
  };

  const buildErrorMessage = (data, fallback) => {
    if (!data) return fallback;
    const details = [data.message || data.error || fallback];
    if (data.missing_download?.length) {
      details.push(`Téléchargement requis : ${data.missing_download.slice(0, 5).join(', ')}${data.missing_download.length > 5 ? '…' : ''}`);
    }
    if (data.missing_translation?.length) {
      details.push(`Traduction requise : ${data.missing_translation.slice(0, 5).join(', ')}${data.missing_translation.length > 5 ? '…' : ''}`);
    }
    return details.filter(Boolean).join('\n');
  };

  const showSelectionRequired = () => {
    setConfirmModal({
      isOpen: true,
      type: 'info',
      title: 'Sélection requise',
      message: 'Sélectionnez au moins une décision pour lancer cette action.',
      confirmText: 'Fermer',
      cancelText: 'Fermer',
      showCancel: false,
      loading: false,
      onConfirm: closeModal
    });
  };

  const runBatchAction = async ({
    endpoint,
    successTitle,
    successLabel,
    totalCount,
    progressTitle,
    force = false
  }) => {
    const ids = Array.from(selectedDecisions);
    setProcessing(true);
    setConfirmModal({
      isOpen: true,
      type: 'info',
      title: progressTitle || successTitle,
      message: `Traitement en cours...\n0/${totalCount} décision(s)`,
      confirmText: 'En cours...',
      cancelText: 'Fermer',
      showCancel: false,
      loading: true,
      onConfirm: () => {}
    });

    try {
      const response = await fetch(`${COURSUPREME_API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision_ids: ids, force })
      });
      const data = await response.json();

      if (data.needs_confirmation && !force) {
        setProcessing(false);
        setConfirmModal({
          isOpen: true,
          type: 'warning',
          title: 'Confirmation requise',
          message: data.message || 'Certaines décisions ont déjà été traitées. Voulez-vous relancer le traitement ?',
          confirmText: 'Relancer',
          cancelText: 'Annuler',
          showCancel: true,
          loading: false,
          onConfirm: () => runBatchAction({
            endpoint,
            successTitle,
            successLabel,
            totalCount,
            progressTitle,
            force: true
          })
        });
        return;
      }

      if (!response.ok || data.error) {
        setProcessing(false);
        setConfirmModal({
          isOpen: true,
          type: 'danger',
          title: 'Erreur traitement',
          message: buildErrorMessage(data, 'Une erreur est survenue pendant le traitement.'),
          confirmText: 'Fermer',
          cancelText: 'Fermer',
          showCancel: false,
          loading: false,
          onConfirm: closeModal
        });
        return;
      }

      setProcessing(false);
      setConfirmModal({
        isOpen: true,
        type: 'success',
        title: successTitle,
        message: formatBatchMessage(data, successLabel, totalCount),
        confirmText: 'Fermer',
        cancelText: 'Fermer',
        showCancel: false,
        loading: false,
        onConfirm: () => {
          closeModal();
        }
      });
      fetchDecisions();
    } catch (error) {
      setProcessing(false);
      setConfirmModal({
        isOpen: true,
        type: 'danger',
        title: 'Erreur réseau',
        message: error.message || 'Impossible de contacter le serveur.',
        confirmText: 'Fermer',
        cancelText: 'Fermer',
        showCancel: false,
        loading: false,
        onConfirm: closeModal
      });
    }
  };

  // Actions sur les décisions sélectionnées
  const handleBatchDownload = () => {
    const count = selectedDecisions.size;
    if (count === 0) {
      showSelectionRequired();
      return;
    }
    setConfirmModal({
      isOpen: true,
      type: 'info',
      title: 'Télécharger les décisions',
      message: `Voulez-vous télécharger ${count} décision(s) sélectionnée(s) ?`,
      confirmText: 'Lancer',
      cancelText: 'Annuler',
      showCancel: true,
      loading: false,
      onConfirm: () => runBatchAction({
        endpoint: '/batch/download',
        successTitle: 'Téléchargement terminé',
        successLabel: 'décision téléchargée',
        totalCount: count,
        progressTitle: `Téléchargement (${count})`
      })
    });
  };

  const handleBatchDelete = () => {
    const count = selectedDecisions.size;
    setConfirmModal({
      isOpen: true,
      type: 'danger',
      title: 'Supprimer les décisions',
      message: `⚠️ ATTENTION ⚠️\n\nVoulez-vous vraiment supprimer ${count} décision(s) ?\n\nCette action est irréversible et supprimera :\n- Les fichiers locaux AR et FR\n- Toutes les analyses IA\n- Les embeddings\n- Les entrées en base de données`,
      confirmText: 'Supprimer',
      cancelText: 'Annuler',
      showCancel: true,
      loading: false,
      onConfirm: async () => {
        setProcessing(true);
        try {
          for (const id of selectedDecisions) {
            await fetch(`${COURSUPREME_API_URL}/decisions/${id}`, {
              method: 'DELETE'
            });
          }
          alert(`${count} décision(s) supprimée(s)`);
          setSelectedDecisions(new Set());
          fetchDecisions();
        } catch (error) {
          alert('Erreur: ' + error.message);
        }
        setProcessing(false);
        closeModal();
      }
    });
  };

  const handleBatchTranslate = () => {
    const count = selectedDecisions.size;
    if (count === 0) {
      showSelectionRequired();
      return;
    }
    setConfirmModal({
      isOpen: true,
      type: 'info',
      title: 'Traduire les décisions',
      message: `Voulez-vous traduire ${count} décision(s) sélectionnée(s) ?\n\nCette opération peut prendre plusieurs minutes.`,
      confirmText: 'Lancer',
      cancelText: 'Annuler',
      showCancel: true,
      loading: false,
      onConfirm: () => runBatchAction({
        endpoint: '/batch/translate',
        successTitle: 'Traduction terminée',
        successLabel: 'décision traduite',
        totalCount: count,
        progressTitle: `Traduction (${count})`
      })
    });
  };

  const handleBatchAnalyze = () => {
    const count = selectedDecisions.size;
    if (count === 0) {
      showSelectionRequired();
      return;
    }
    setConfirmModal({
      isOpen: true,
      type: 'info',
      title: 'Analyser les décisions',
      message: `Voulez-vous analyser ${count} décision(s) sélectionnée(s) avec l'IA ?\n\nCette opération peut prendre plusieurs minutes.`,
      confirmText: 'Lancer',
      cancelText: 'Annuler',
      showCancel: true,
      loading: false,
      onConfirm: () => runBatchAction({
        endpoint: '/batch/analyze',
        successTitle: 'Analyse IA terminée',
        successLabel: 'décision analysée',
        totalCount: count,
        progressTitle: `Analyse IA (${count})`
      })
    });
  };

  const handleBatchEmbed = () => {
    const count = selectedDecisions.size;
    if (count === 0) {
      showSelectionRequired();
      return;
    }
    setConfirmModal({
      isOpen: true,
      type: 'info',
      title: 'Générer les embeddings',
      message: `Voulez-vous générer les embeddings pour ${count} décision(s) sélectionnée(s) ?\n\nCette opération peut prendre plusieurs minutes.`,
      confirmText: 'Lancer',
      cancelText: 'Annuler',
      showCancel: true,
      loading: false,
      onConfirm: () => runBatchAction({
        endpoint: '/batch/embed',
        successTitle: 'Embeddings terminés',
        successLabel: 'embedding généré',
        totalCount: count,
        progressTitle: `Embeddings (${count})`
      })
    });
  };

  const handleExportSelected = async () => {
    const ids = Array.from(selectedDecisions);
    if (!ids.length) {
      showSelectionRequired();
      return;
    }
    try {
      const response = await fetch(exportEndpoint, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({document_ids: ids})
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Export impossible');
      }
      const blob = await response.blob();
      const link = document.createElement('a');
      const filename = `coursupreme-export-${Date.now()}.zip`;
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
      setConfirmModal({
        isOpen: true,
        type: 'success',
        title: 'Export prêt',
        message: `${ids.length} décision(s) exportée(s).\nLe fichier ZIP a été téléchargé.`,
        confirmText: 'OK',
        onConfirm: closeModal,
        showCancel: false,
        loading: false
      });
    } catch (error) {
      alert(error.message || 'Erreur export');
    }
  };

  const handleViewDecision = async (id) => {
    try {
      const response = await fetch(`${COURSUPREME_API_URL}/decisions/${id}`);
      const data = await response.json();
      setSelectedDecision(data);
      if (data?.content_ar) {
        setSelectedLang('ar');
      } else if (data?.content_fr) {
        setSelectedLang('fr');
      } else {
        setSelectedLang('ar');
      }
      setDetailModalOpen(true);
    } catch (error) {
      alert('Erreur: ' + error.message);
    }
  };

  const handleViewMetadata = async (id) => {
    try {
      const response = await fetch(`${COURSUPREME_API_URL}/metadata/${id}`);
      const data = await response.json();
      setSelectedMetadata(data);
      if (data?.title_ar || data?.summary_ar) {
        setMetadataLang('ar');
      } else if (data?.title_fr || data?.summary_fr) {
        setMetadataLang('fr');
      } else {
        setMetadataLang('ar');
      }
      setMetadataModalOpen(true);
    } catch (error) {
      alert('Erreur: ' + error.message);
    }
  };

  const handleViewRemote = (url) => {
    window.open(url, '_blank');
  };

  if (loading) {
    return <div className="flex justify-center items-center h-64">Chargement...</div>;
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">Gestion des Décisions</h2>
        <CoursSupremeSearchPanel
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          onSearch={runSearch}
          showAdvancedSearch={showAdvancedSearch}
          setShowAdvancedSearch={setShowAdvancedSearch}
          filters={filters}
          setFilters={setFilters}
          languageScope={languageScope}
          setLanguageScope={setLanguageScope}
          onAdvancedSearch={runSearch}
          onReset={handleResetAndSearch}
          isSearching={isSearching}
          searchResultsCount={searchResultCount}
          semanticLimit={semanticLimit}
          setSemanticLimit={setSemanticLimit}
          semanticThreshold={semanticThreshold}
          setSemanticThreshold={setSemanticThreshold}
          availableChambers={availableChambers}
          availableThemes={availableThemes}
          resetCounter={resetCounter}
        />
        <div className="text-sm text-gray-500 mt-2">
          Documents ramenés: {searchResultCount}
        </div>
        {showSemanticStats && (
          <div className="flex flex-wrap gap-4 text-xs text-gray-500 mt-2">
            <span>Résultats sémantiques : {semanticStats.count}</span>
            <span>Score min : {semanticStats.minScore ?? '—'}</span>
            <span>Seuil : {semanticStats.scoreThreshold}</span>
            <span>Limite renvoyée : {semanticStats.limit}</span>
          </div>
        )}
      </div>
        {/* Actions groupées */}
        {selectedDecisions.size > 0 && (
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-gray-700 font-medium">
                {selectedDecisions.size} décision(s) sélectionnée(s)
              </span>
              <div className="flex gap-2">
                <button
                  onClick={handleBatchDownload}
                  disabled={processing}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-all hover:scale-105 flex items-center gap-2 font-medium text-sm"
                >
                  <span>📥</span>
                  <span>Télécharger</span>
                </button>
                <button
                  onClick={handleBatchTranslate}
                  disabled={processing}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-all hover:scale-105 flex items-center gap-2 font-medium text-sm"
                >
                  <span>🌐</span>
                  <span>Traduire</span>
                </button>
                <button
                  onClick={handleBatchAnalyze}
                  disabled={processing}
                  className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 transition-all hover:scale-105 flex items-center gap-2 font-medium text-sm"
                >
                  <span>🤖</span>
                  <span>Analyser</span>
                </button>
                <button
                  onClick={handleBatchEmbed}
                  disabled={processing}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-all hover:scale-105 flex items-center gap-2 font-medium text-sm"
                >
                  <span>🧬</span>
                  <span>Embeddings</span>
                </button>
                <button
                  onClick={handleExportSelected}
                  disabled={processing}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-all hover:scale-105 flex items-center gap-2 font-medium text-sm"
                >
                  <span>📦</span>
                  <span>Exporter</span>
                </button>
              </div>
            </div>
          </div>
        )}

      {/* Table des décisions */}
      <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="p-3 text-left">
                <input
                  type="checkbox"
                  checked={paginatedDecisions.length > 0 && paginatedDecisions.every(decision => selectedDecisions.has(decision.id))}
                  onChange={toggleSelectAll}
                  className="w-4 h-4"
                />
              </th>
              <th className="p-3 text-left">
                <button
                  onClick={() => handleSort('decision_number')}
                  className="flex items-center gap-1 font-semibold text-gray-700 hover:text-gray-900"
                >
                  Numéro
                  {sortField === 'decision_number' && (
                    sortOrder === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
                  )}
                </button>
              </th>
              <th className="p-3 text-left">
                <button
                  onClick={() => handleSort('decision_date')}
                  className="flex items-center gap-1 font-semibold text-gray-700 hover:text-gray-900"
                >
                  Date
                  {sortField === 'decision_date' && (
                    sortOrder === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
                  )}
                </button>
              </th>
              <th className="p-3 text-center font-semibold text-gray-700">Téléchargé</th>
              <th className="p-3 text-center font-semibold text-gray-700">Traduit</th>
              <th className="p-3 text-center font-semibold text-gray-700">Analysé</th>
              <th className="p-3 text-center font-semibold text-gray-700">Embeddings</th>
              <th className="p-3 text-center font-semibold text-gray-700">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedDecisions.map((decision) => (
              <React.Fragment key={decision.id}>
                <tr className="border-b hover:bg-gray-50">
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={selectedDecisions.has(decision.id)}
                      onChange={() => toggleSelectDecision(decision.id)}
                      className="w-4 h-4"
                    />
                  </td>
                  <td className="p-3 font-medium text-gray-800">{decision.decision_number}</td>
                  <td className="p-3 text-gray-600">{decision.decision_date}</td>
                  <td className="p-3 text-center">
            <div className="flex justify-center">
              <StatusIndicator status={decision.status?.downloaded} />
            </div>
          </td>
          <td className="p-3 text-center">
            <div className="flex justify-center">
              <StatusIndicator status={decision.status?.translated} />
            </div>
          </td>
          <td className="p-3 text-center">
            <div className="flex justify-center">
              <StatusIndicator status={decision.status?.analyzed} />
            </div>
          </td>
          <td className="p-3 text-center">
            <div className="flex justify-center">
              <StatusIndicator status={decision.status?.embeddings} />
            </div>
          </td>
                  <td className="p-3">
                    <div className="flex gap-1 justify-center">
                      <button
                        onClick={() => handleViewDecision(decision.id)}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                        title="Voir le contenu"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleViewRemote(decision.url)}
                        className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded"
                        title="Voir la version distante"
                      >
                        <Globe className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleViewMetadata(decision.id)}
                        className="p-1.5 text-amber-600 hover:bg-amber-50 rounded"
                        title="Voir les métadonnées IA"
                      >
                        <Database className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setSelectedDecisions(new Set([decision.id]));
                          handleBatchDelete();
                        }}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                        title="Supprimer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
                {/* Rattachements (chambres et thèmes) */}
                <tr className="bg-gray-50 border-b">
                  <td colSpan="8" className="px-3 py-2">
                    <div className="flex gap-4 text-xs text-gray-600">
                      {Array.isArray(decision.chambers) && decision.chambers.length > 0 && (
                        <div className="flex gap-1 items-center">
                          <span className="font-semibold">Chambres:</span>
                          {decision.chambers.map((c, i) => (
                            <span key={i} className="px-2 py-1 bg-blue-100 text-blue-700 rounded">
                              {c.name_fr}
                            </span>
                          ))}
                        </div>
                      )}
                      {Array.isArray(decision.themes) && decision.themes.length > 0 && (
                        <div className="flex gap-1 items-center">
                          <span className="font-semibold">Thèmes:</span>
                          {decision.themes.map((t, i) => (
                            <span key={i} className="px-2 py-1 bg-green-100 text-green-700 rounded">
                              {t.name_fr}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              </React.Fragment>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50 text-xs">
          <div>
            Page {currentPage} / {totalPages}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => handlePageChange('prev')}
              disabled={currentPage <= 1}
              className="px-3 py-1 border rounded disabled:opacity-50 text-gray-600"
            >
              ← Préc
            </button>
            <button
              onClick={() => handlePageChange('next')}
              disabled={currentPage >= totalPages}
              className="px-3 py-1 border rounded disabled:opacity-50 text-gray-600"
            >
              Suiv →
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        onClose={closeModal}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
        type={confirmModal.type}
        confirmText={confirmModal.confirmText}
        cancelText={confirmModal.cancelText}
        showCancel={confirmModal.showCancel}
        loading={confirmModal.loading}
      />
      
      {detailModalOpen && selectedDecision && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b p-6">
              <div className="flex justify-between items-start gap-4">
                <div>
                  <h2 className="text-2xl font-bold">Décision {selectedDecision.decision_number}</h2>
                  <p className="text-gray-600 text-sm">{selectedDecision.decision_date}</p>
                </div>
                <div className="flex gap-2 bg-white rounded-lg p-1">
                  <button
                    onClick={() => setSelectedLang('ar')}
                    className={`px-4 py-2 rounded-md text-sm font-medium ${selectedLang === 'ar' ? 'bg-blue-600 text-white' : 'text-gray-600'}`}
                  >
                    العربية
                  </button>
                  <button
                    onClick={() => setSelectedLang('fr')}
                    className={`px-4 py-2 rounded-md text-sm font-medium ${selectedLang === 'fr' ? 'bg-blue-600 text-white' : 'text-gray-600'}`}
                  >
                    Français
                  </button>
                </div>
                <button onClick={() => setDetailModalOpen(false)} className="text-2xl text-gray-500 hover:text-gray-700">×</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-8 bg-gray-50">
              {selectedLang === 'ar' && selectedDecision.content_ar && (
                <div className="bg-white rounded-lg p-6" dir="rtl">
                  <pre className="whitespace-pre-wrap leading-relaxed font-['Amiri','Scheherazade',serif] text-lg">
                    {selectedDecision.content_ar}
                  </pre>
                </div>
              )}
              {selectedLang === 'fr' && selectedDecision.content_fr && (
                <div className="bg-white rounded-lg p-6">
                  <pre className="whitespace-pre-wrap leading-relaxed">{selectedDecision.content_fr}</pre>
                </div>
              )}
              {!selectedDecision.content_ar && !selectedDecision.content_fr && (
                <div className="text-center py-16">
                  <p className="text-gray-500">Contenu indisponible pour cette décision.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {metadataModalOpen && selectedMetadata && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="bg-gradient-to-r from-orange-50 to-amber-50 border-b p-6">
              <div className="flex justify-between items-start gap-4">
                <div>
                  <h2 className="text-2xl font-bold">🤖 Métadonnées IA</h2>
                  <p className="text-gray-600 text-sm">
                    Décision {selectedMetadata.decision_number} • {selectedMetadata.decision_date}
                  </p>
                </div>
                <div className="flex gap-2 bg-white rounded-lg p-1">
                  <button
                    onClick={() => setMetadataLang('ar')}
                    className={`px-4 py-2 rounded-md text-sm font-medium ${metadataLang === 'ar' ? 'bg-orange-500 text-white' : 'text-gray-600'}`}
                  >
                    العربية
                  </button>
                  <button
                    onClick={() => setMetadataLang('fr')}
                    className={`px-4 py-2 rounded-md text-sm font-medium ${metadataLang === 'fr' ? 'bg-orange-500 text-white' : 'text-gray-600'}`}
                  >
                    Français
                  </button>
                </div>
                <button onClick={() => setMetadataModalOpen(false)} className="text-2xl text-gray-500 hover:text-gray-700">×</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-8 bg-gray-50">
              {metadataLang === 'ar' ? (
                <MetadataContent
                  title={selectedMetadata.title_ar}
                  summary={selectedMetadata.summary_ar}
                  entities={selectedMetadata.entities_ar}
                  labels={{
                    title: 'العنوان',
                    summary: 'الملخص',
                    entities: 'الكيانات المسماة',
                    groups: {
                      person: '👤 أشخاص',
                      institution: '🏛️ مؤسسات',
                      location: '📍 أماكن',
                      legal: '⚖️ قانونية',
                      other: '📋 أخرى'
                    },
                    dir: 'rtl'
                  }}
                />
              ) : (
                <MetadataContent
                  title={selectedMetadata.title_fr}
                  summary={selectedMetadata.summary_fr}
                  entities={selectedMetadata.entities_fr}
                  labels={{
                    title: 'Titre',
                    summary: 'Résumé',
                    entities: 'Entités nommées',
                    groups: {
                      person: '👤 Personnes',
                      institution: '🏛️ Institutions',
                      location: '📍 Lieux',
                      legal: '⚖️ Juridique',
                      other: '📋 Autres'
                    },
                    dir: 'ltr'
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const MetadataContent = ({ title, summary, entities, labels }) => {
  if (!title && !summary && !entities) {
    return (
      <div className="text-center py-16">
        <div className="text-6xl mb-4">🤖</div>
        <p className="text-gray-500">Pas encore analysée</p>
      </div>
    );
  }

  let parsedEntities = [];
  if (entities) {
    try {
      parsedEntities = Array.isArray(entities) ? entities : JSON.parse(entities);
    } catch (e) {
      parsedEntities = [];
    }
  }

  const grouped = parsedEntities.reduce((acc, entity) => {
    const type = entity?.type || 'other';
    if (!acc[type]) acc[type] = [];
    acc[type].push(entity?.name || entity);
    return acc;
  }, {});

  return (
    <div className={`space-y-6 ${labels.dir === 'rtl' ? 'text-right' : ''}`} dir={labels.dir}>
      {title && (
        <div className="bg-white rounded-lg p-6 border-l-4 border-orange-500">
          <h3 className="font-bold text-orange-700 mb-2">{labels.title}</h3>
          <p className="text-gray-800">{title}</p>
        </div>
      )}
      {summary && (
        <div className="bg-white rounded-lg p-6 border-l-4 border-blue-500">
          <h3 className="font-bold text-blue-700 mb-2">{labels.summary}</h3>
          <p className="text-gray-800 whitespace-pre-wrap">{summary}</p>
        </div>
      )}
      {parsedEntities.length > 0 && (
        <div className="bg-white rounded-lg p-6 border-l-4 border-purple-500">
          <h3 className="font-bold text-purple-700 mb-3">{labels.entities}</h3>
          {Object.entries(grouped).map(([type, items]) => (
            <div key={type} className="mb-3 last:mb-0">
              <p className="text-sm font-semibold text-gray-600 mb-1">{labels.groups[type] || labels.groups.other}</p>
              <div className="flex flex-wrap gap-2">
                {items.map((name, idx) => (
                  <span key={`${type}-${idx}`} className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DecisionStatusManager;
