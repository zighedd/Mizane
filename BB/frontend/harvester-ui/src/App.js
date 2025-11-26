/* eslint-disable no-unused-vars, react-hooks/exhaustive-deps */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import HierarchicalView from './components/HierarchicalView';
import AssistantPanel from './components/AssistantPanel';
import DocumentAnalysisPanel from './components/DocumentAnalysisPanel';
import CollapsibleSection from './components/CollapsibleSection';
import {
  FileText,
  Play,
  StopCircle,
  RefreshCw,
  Loader,
  Trash2,
  ExternalLink,
  Info,
  FolderOpen,
  CheckCircle,
  XCircle,
  Calendar,
  Download,
  Circle,
  MoreHorizontal,
  ChevronDown,
  Search,
} from 'lucide-react';
import { API_URL } from './config';

const initialDocumentFilters = {
  collection: '',
  status: '',
  phase: '',
  startDate: '',
  endDate: '',
};

const initialFormData = {
  url: '',
  site_name: '',
  max_results: '',
  collection_name: '',
  start_number: '',
  end_number: '',
  extensions: ['.pdf'],
  workers: 2,
  timeout: 60,
  delay_between: 0.5,
  retry_delay: 2,
  date_start: '',
  date_end: '',
  file_types: ['pdf'],
  keywords: '',
  languages: [],
  schedule_collect: 'manual',
  schedule_download: 'manual',
  schedule_analyze: 'manual',
};

const phaseOrder = ['collect', 'download', 'analyze'];

const phaseLabels = {
  collect: 'Collecte des métadonnées',
  download: 'Téléchargement des fichiers',
  analyze: 'Analyse IA',
};

const harvestersDefault = [
  {
    id: 'generic',
    name: 'Moissonneur générique',
    description: 'Collecte standard HTML.',
    available: true,
  },
  {
    id: 'joradp',
    name: 'Moissonneur JORADP',
    description: 'Moissonnage spécialisé Journal Officiel algérien.',
    available: true,
  },
  {
    id: 'selenium',
    name: 'Moissonneur JavaScript (Selenium)',
    description: 'Collecte via navigateur automatisé.',
    available: true,
  },
];
const resolveHarvesterLabel = (harvester) => {
  if (!harvester) return null;
  const match = harvestersDefault.find((item) => item.id === harvester.id || item.id === harvester);
  if (match) {
    return {
      ...match,
      ...harvester,
      available:
        typeof harvester === 'object' && harvester !== null && 'available' in harvester
          ? harvester.available
          : match.available,
    };
  }
  if (typeof harvester === 'string') {
    return { id: harvester, name: harvester, description: '', available: true };
  }
  if (typeof harvester === 'object' && harvester !== null) {
    return { available: harvester.available ?? true, ...harvester };
  }
  return null;
};

const normalizeStoredConfig = (rawConfig) => {
  if (!rawConfig || typeof rawConfig !== 'object') return null;
  const { harvester_type, harvester, tasks, ...rest } = rawConfig;
  const normalizedForm = {
    ...initialFormData,
    ...rest,
  };
  return {
    harvester: harvester_type || harvester || initialFormData.harvester,
    formData: normalizedForm,
    taskOptions: {
      collect: true,
      download: Array.isArray(tasks) ? tasks.includes('download') : defaultTaskOptions.download,
      analyze: Array.isArray(tasks) ? tasks.includes('analyze') : defaultTaskOptions.analyze,
    },
    tasks: Array.isArray(tasks) ? tasks : [],
  };
};

const scheduleFrequencies = [
  { value: 'manual', label: 'Manuel (aucun lancement automatique)' },
  { value: 'hourly', label: 'Toutes les heures' },
  { value: '6h', label: 'Toutes les 6 heures' },
  { value: 'daily', label: 'Quotidien' },
  { value: 'weekly', label: 'Hebdomadaire' },
  { value: 'monthly', label: 'Mensuel' },
];

const scheduleFrequencyMap = scheduleFrequencies.reduce((acc, option) => {
  const next = acc;
  next[option.value] = option.label;
  return next;
}, {});

const defaultTaskOptions = {
  collect: true,
  download: true,
  analyze: false,
};

const formatPhaseStatus = (status) => {
  switch (status) {
    case 'running':
      return 'En cours';
    case 'completed':
    case 'success':
      return 'Terminé';
    case 'partial':
      return 'Partiel';
    case 'error':
      return 'Erreur';
    case 'queued':
      return 'En file';
    case 'pending':
      return 'En attente';
    case 'skipped':
      return 'Ignoré';
    default:
      return status || '—';
  }
};

const formatFileSize = (size) => {
  if (!size || size <= 0) return '—';
  const units = ['octets', 'Ko', 'Mo', 'Go', 'To'];
  let value = Number(size);
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value < 10 ? 1 : 0;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
};

const formatDateTime = (value) => (value ? new Date(value).toLocaleString('fr-FR') : '—');
const formatDateOnly = (value) => (value ? new Date(value).toLocaleDateString('fr-FR') : '—');

const formatSiteName = (site) => {
  if (!site?.base_url) return 'Site';
  try {
    return new URL(site.base_url).hostname.replace('www.', '');
  } catch (error) {
    return site.base_url;
  }
};

const buildExportFilename = (jobId) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `harvest-${jobId}-${timestamp}.json`;
};

const isPhaseSuccessful = (status) => ['completed', 'success'].includes(status);
const isPhaseErrored = (status) => status === 'error';
const isPhaseRunning = (status) => ['running', 'partial'].includes(status);
const phaseStatusLabel = (status) => {
  if (isPhaseSuccessful(status)) return 'Terminé';
  if (isPhaseErrored(status)) return 'Erreur';
  if (status === 'partial') return 'Partiel';
  if (status === 'skipped') return 'Ignoré';
  if (status === 'queued') return 'En file';
  if (status === 'pending') return 'En attente';
  return 'En cours';
};

const deriveTasksFromOptions = (options) => {
  const result = ['collect'];
  if (options.download || options.analyze) {
    result.push('download');
  }
  if (options.analyze) {
    result.push('analyze');
  }
  return Array.from(new Set(result));
};

const normalizeTasks = (tasks) => {
  const unique = Array.from(new Set(tasks));
  if (unique.includes('analyze') && !unique.includes('download')) {
    const analyzeIndex = unique.indexOf('analyze');
    unique.splice(analyzeIndex, 0, 'download');
  }
  if (!unique.includes('collect')) {
    unique.unshift('collect');
  }
  return unique;
};

const loadPersistedSiteConfigs = () => {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = window.localStorage.getItem('harvesterSiteConfigs');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

export default function DocumentHarvesterApp() {
  const [harvesters, setHarvesters] = useState(harvestersDefault);
  const [selectedHarvester, setSelectedHarvester] = useState('generic');
  const [currentJob, setCurrentJob] = useState(null);
  const [taskOptions, setTaskOptions] = useState(() => ({ ...defaultTaskOptions }));
  const [siteConfigs, setSiteConfigs] = useState(() => loadPersistedSiteConfigs());

  const [sites, setSites] = useState([]);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [selectedSiteId, setSelectedSiteId] = useState(null);
  const [selectedSiteIds, setSelectedSiteIds] = useState([]);
  const [expandedSiteId, setExpandedSiteId] = useState(null);
  const [documentsData, setDocumentsData] = useState({
    items: [],
    total: 0,
    page: 1,
    pageSize: 25,
    collections: [],
  });
  const documentsStateRef = useRef({
    items: [],
    total: 0,
    page: 1,
    pageSize: 25,
    collections: [],
  });
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentFilters, setDocumentFilters] = useState(initialDocumentFilters);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState([]);
  const [formData, setFormData] = useState(initialFormData);
  const pollerRef = useRef(null);
  const [commandLoading, setCommandLoading] = useState({ launch: false, stop: false, resume: false, cancel: false });
  const [documentPhaseJobs, setDocumentPhaseJobs] = useState({});
  const [openPhaseMenuKey, setOpenPhaseMenuKey] = useState(null);
  const [analysisPanelDoc, setAnalysisPanelDoc] = useState(null);
  const [semanticInfo, setSemanticInfo] = useState({ active: false, query: '', model: '', total: 0 });
  const [semanticResults, setSemanticResults] = useState({ items: [], total: 0, siteIds: [], limit: 20 });
  const [semanticQuery, setSemanticQuery] = useState('');
  const [semanticLoading, setSemanticLoading] = useState(false);
  const documentJobPollersRef = useRef({});
  const previousJobIdRef = useRef(null);
  const previousCollectStatusRef = useRef(null);

  const persistCurrentSiteConfig = useCallback((siteId, overrides = {}) => {
    const sourceForm =
      overrides.formData && typeof overrides.formData === 'object' ? overrides.formData : formData;
    const sourceTasks =
      overrides.taskOptions && typeof overrides.taskOptions === 'object' ? overrides.taskOptions : taskOptions;
    const formSnapshot = {
      ...sourceForm,
      file_types: Array.isArray(sourceForm.file_types) ? [...sourceForm.file_types] : [],
      languages: Array.isArray(sourceForm.languages) ? [...sourceForm.languages] : [],
      extensions: Array.isArray(sourceForm.extensions) ? [...sourceForm.extensions] : sourceForm.extensions,
    };
    const taskSnapshot = {
      download: !!sourceTasks.download,
      analyze: !!sourceTasks.analyze,
    };
    const harvesterValue =
      typeof overrides.harvester === 'string' && overrides.harvester.length > 0
        ? overrides.harvester
        : selectedHarvester;
    const normalizedUrl =
      typeof formSnapshot.url === 'string' && formSnapshot.url.trim().length > 0
        ? formSnapshot.url.trim().toLowerCase()
        : harvesterValue === 'joradp'
        ? 'joradp'
        : '';
    const urlKey = normalizedUrl ? `url:${normalizedUrl}` : null;
    setSiteConfigs((prev) => {
      const next = { ...prev };
      const idKey = siteId != null ? String(siteId) : null;
      const configPayload = {
        harvester: harvesterValue,
        formData: formSnapshot,
        taskOptions: taskSnapshot,
      };
      if (idKey) {
        next[idKey] = configPayload;
        if (urlKey && urlKey !== idKey && next[urlKey]) {
          delete next[urlKey];
        }
      } else if (urlKey) {
        next[urlKey] = configPayload;
      }
      return next;
    });
  }, [formData, selectedHarvester, taskOptions]);

  const buildDocumentQuery = useCallback((overrides = {}) => {
    const snapshot = documentsStateRef.current || {};
    const page = overrides.page || snapshot.page || 1;
    const pageSize = overrides.pageSize || snapshot.pageSize || 25;
    const params = new URLSearchParams();
    params.set('page', page);
    params.set('page_size', pageSize);
    if (documentFilters.collection) params.set('collection', documentFilters.collection);
    if (documentFilters.status) params.set('status', documentFilters.status);
    if (documentFilters.phase) params.set('phase', documentFilters.phase);
    if (documentFilters.startDate) params.set('start_date', documentFilters.startDate);
    if (documentFilters.endDate) params.set('end_date', documentFilters.endDate);
    return { params, page, pageSize };
  }, [documentFilters]);

  const loadSitesSummary = async () => {
    try {
      setSitesLoading(true);
      const response = await fetch(`${API_URL}/sites`);
      const data = await response.json();
      setSites(data.sites || []);
    } catch (error) {
      console.error('Erreur chargement sites:', error);
    } finally {
      setSitesLoading(false);
    }
  };

  const loadSiteDocuments = useCallback(async (overrides = {}) => {
    if (!selectedSiteId) {
      setDocumentsData((prev) => ({ ...prev, items: [], total: 0 }));
      return;
    }

    const { params, page, pageSize } = buildDocumentQuery(overrides);
    try {
      setDocumentsLoading(true);
      const response = await fetch(`${API_URL}/sites/${selectedSiteId}/documents?${params.toString()}`);
      const data = await response.json();
      setDocumentsData({
        items: data.items || [],
        total: data.total || 0,
        page,
        pageSize,
        collections: data.collections || [],
      });
      setSelectedDocumentIds([]);
      setOpenPhaseMenuKey(null);
      setDocumentPhaseJobs((prev) => {
        const next = { ...prev };
        const docMap = new Map((data.items || []).map((item) => [item.id, item]));
        Object.keys(next).forEach((key) => {
          const job = next[key];
          if (!job) return;
          if (job.status === 'running') return;
          const [docIdStr, phaseKey] = key.split(':');
          const docRef = docMap.get(Number(docIdStr));
          if (!docRef) {
            if (job.status !== 'running') {
              delete next[key];
            }
            return;
          }
          const phaseStatus = docRef.phases?.[phaseKey];
          if (job.status === 'completed' && isPhaseSuccessful(phaseStatus)) {
            delete next[key];
          }
        });
        return next;
      });
    } catch (error) {
      console.error('Erreur chargement documents:', error);
    } finally {
      setDocumentsLoading(false);
    }
  }, [buildDocumentQuery, selectedSiteId]);

  


  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('harvesterSiteConfigs', JSON.stringify(siteConfigs));
    } catch {
      // ignore persistence errors
    }
  }, [siteConfigs]);

  useEffect(() => {
    const handleGlobalClick = (event) => {
      if (event.target && typeof event.target.closest === 'function') {
        if (!event.target.closest('[data-phase-menu="true"]')) {
          setOpenPhaseMenuKey(null);
        }
      } else {
        setOpenPhaseMenuKey(null);
      }
    };
    document.addEventListener('mousedown', handleGlobalClick);
    return () => {
      document.removeEventListener('mousedown', handleGlobalClick);
    };
  }, []);

  const numberFormatter = useMemo(() => new Intl.NumberFormat('fr-FR'), []);
  const aggregatedStats = useMemo(() => {
    return sites.reduce(
      (acc, site) => {
        const stats = site.stats || {};
        acc.total += stats.total || 0;
        acc.downloaded += stats.downloaded || 0;
        acc.analyzed += stats.analyzed || 0;
        acc.errors += stats.analyze_errors || 0;
        return acc;
      },
      { total: 0, downloaded: 0, analyzed: 0, errors: 0 },
    );
  }, [sites]);
  const sitesById = useMemo(() => {
    const map = new Map();
    sites.forEach((site) => {
      map.set(site.id, site);
    });
    return map;
  }, [sites]);

  // useEffect pour charger harvesters - SUPPRIMÉ car endpoint n'existe pas
  // On utilise harvestersDefault directement dans useState

  useEffect(() => {
    if (selectedSiteId == null && !sites.length) return;
    const siteRecord = selectedSiteId != null ? sites.find((item) => item.id === selectedSiteId) : null;
    const savedConfig = selectedSiteId != null ? siteConfigs[selectedSiteId] : null;
    const backendConfig = normalizeStoredConfig(siteRecord?.current_parameters);
    const configToApply = savedConfig || backendConfig || null;

    if (configToApply) {
      const { harvester, formData: storedForm, taskOptions: storedTasks } = configToApply;
      if (harvester && harvester !== selectedHarvester) {
        setSelectedHarvester(harvester);
      }
      if (storedForm && typeof storedForm === 'object') {
        setFormData((prev) => ({
          ...prev,
          ...storedForm,
          file_types: Array.isArray(storedForm.file_types) ? [...storedForm.file_types] : prev.file_types,
          languages: Array.isArray(storedForm.languages) ? [...storedForm.languages] : prev.languages,
          extensions: Array.isArray(storedForm.extensions) ? [...storedForm.extensions] : prev.extensions,
        }));
      }
      if (storedTasks && typeof storedTasks === 'object') {
        setTaskOptions({
          collect: true,
          download: !!storedTasks.download,
          analyze: !!storedTasks.analyze,
        });
      }
      if (!savedConfig && backendConfig && selectedSiteId != null) {
        persistCurrentSiteConfig(selectedSiteId, {
          harvester: backendConfig.harvester,
          formData: backendConfig.formData,
          taskOptions: backendConfig.taskOptions,
        });
      }
      return;
    }

    if (selectedHarvester === 'joradp') {
      const currentYear = new Date().getFullYear().toString();
      setFormData((prev) => ({
        ...prev,
        url: 'https://www.joradp.dz',
        site_name: 'JORADP',
        collection_name: prev.collection_name || currentYear,
        max_results: '',
      }));
    } else if (selectedHarvester === 'generic') {
      setFormData((prev) => ({
        ...prev,
        url: '',
        site_name: '',
        collection_name: '',
        max_results: '',
      }));
    }
  }, [selectedHarvester, selectedSiteId, siteConfigs, sites]);  // Retiré persistCurrentSiteConfig pour éviter boucle

  useEffect(() => {
    loadSitesSummary();
  }, []);

  useEffect(() => {
    documentsStateRef.current = documentsData;
  }, [documentsData]);

  useEffect(() => {
    if (selectedSiteId == null && !sites.length) return;
    const idKey = selectedSiteId != null ? String(selectedSiteId) : null;
    let saved = idKey ? siteConfigs[idKey] : null;
    if (!saved) {
      const site = selectedSiteId != null ? sites.find((item) => item.id === selectedSiteId) : null;
      let normalizedUrl = '';
      if (site?.base_url) {
        normalizedUrl = site.base_url.trim().toLowerCase();
      }
      if (!normalizedUrl && selectedHarvester === 'joradp') {
        normalizedUrl = 'joradp';
      }
      if (normalizedUrl) {
        const urlKey = `url:${normalizedUrl}`;
        const urlSaved = siteConfigs[urlKey];
        if (urlSaved) {
          saved = urlSaved;
          if (idKey) {
            persistCurrentSiteConfig(selectedSiteId, {
              harvester: urlSaved.harvester,
              formData: urlSaved.formData,
              taskOptions: urlSaved.taskOptions,
            });
          }
        }
      }
    }
    if (!saved) return;
    const harvesterToApply =
      typeof saved.harvester === 'string' && saved.harvester.length > 0
        ? saved.harvester
        : selectedHarvester;
    if (harvesterToApply !== selectedHarvester) {
      setSelectedHarvester(harvesterToApply);
    }
    if (saved.formData && typeof saved.formData === 'object') {
      const savedForm = saved.formData;
      setFormData((prev) => ({
        ...prev,
        ...savedForm,
        file_types: Array.isArray(savedForm.file_types) ? [...savedForm.file_types] : prev.file_types,
        languages: Array.isArray(savedForm.languages) ? [...savedForm.languages] : prev.languages,
        extensions: Array.isArray(savedForm.extensions) ? [...savedForm.extensions] : savedForm.extensions ?? prev.extensions,
      }));
    }
    setTaskOptions({
      collect: true,
      download:
        typeof saved.taskOptions?.download === 'boolean' ? saved.taskOptions.download : defaultTaskOptions.download,
      analyze:
        typeof saved.taskOptions?.analyze === 'boolean' ? saved.taskOptions.analyze : defaultTaskOptions.analyze,
    });
  }, [selectedHarvester, selectedSiteId, siteConfigs, sites]);  // Retiré persistCurrentSiteConfig pour éviter boucle

  useEffect(() => {
    if (selectedSiteId) {
      loadSiteDocuments({ page: 1 });
    } else {
      setDocumentsData((prev) => ({ ...prev, items: [], total: 0 }));
      setDocumentPhaseJobs({});
    }
  }, [
    documentFilters.collection,
    documentFilters.endDate,
    documentFilters.phase,
    documentFilters.startDate,
    documentFilters.status,
    loadSiteDocuments,
    selectedSiteId,
  ]);

  useEffect(() => {
    setOpenPhaseMenuKey(null);
  }, [selectedSiteId]);

  useEffect(() => {
    if (selectedSiteId == null) {
      setExpandedSiteId(null);
    } else {
      setExpandedSiteId((prev) => (prev === selectedSiteId ? prev : selectedSiteId));
    }
  }, [selectedSiteId]);

  useEffect(() => {
    setSelectedSiteIds((prev) => prev.filter((id) => sites.some((site) => site.id === id)));
  }, [sites]);

  useEffect(() => {
    if (!currentJob?.id) {
      previousJobIdRef.current = null;
      previousCollectStatusRef.current = null;
      return;
    }
    if (previousJobIdRef.current !== currentJob.id) {
      previousJobIdRef.current = currentJob.id;
    }
    previousCollectStatusRef.current = currentJob?.phases?.collect?.status || null;
  }, [currentJob?.id, currentJob?.phases?.collect?.status]);

  useEffect(() => {
    return () => {
      if (pollerRef.current) {
        clearInterval(pollerRef.current);
      }
      Object.values(documentJobPollersRef.current || {}).forEach((intervalId) => {
        if (intervalId) {
          clearInterval(intervalId);
        }
      });
      documentJobPollersRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!analysisPanelDoc) return;
    setAnalysisPanelDoc((current) => {
      if (!current) return current;
      const updated = documentsData.items.find((item) => item.id === current.id);
      return updated || current;
    });
  }, [analysisPanelDoc, documentsData.items]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: ['max_results', 'workers', 'timeout', 'start_number', 'end_number'].includes(name)
        ? value === ''
          ? ''
          : parseInt(value, 10)
        : ['delay_between', 'retry_delay'].includes(name)
        ? parseFloat(value)
        : value,
    }));
  };

  const handleTaskToggle = (task) => {
    setTaskOptions((prev) => {
      const next = { ...prev };
      if (task === 'download') {
        const nextValue = !prev.download;
        next.download = nextValue;
        if (!nextValue) {
          next.analyze = false;
        }
      } else if (task === 'analyze') {
        next.analyze = !prev.analyze;
        if (next.analyze) {
          next.download = true;
        }
      }
      next.collect = true;
      return next;
    });
  };

  const handlePhaseButtonClick = (phase) => {
    if (currentJob?.status === 'running') return;
    if (phase === 'collect') return;
    handleTaskToggle(phase);
  };

  const getRemainingPhases = (job) => {
    if (!job) return [];
    const tasks = Array.isArray(job?.tasks) && job.tasks.length > 0 ? job.tasks : phaseOrder;
    return tasks.filter((phase) => {
      const status = job?.phases?.[phase]?.status;
      return !isPhaseSuccessful(status) && status !== 'skipped';
    });
  };

  const getDocumentPhaseJobKey = (docId, phase) => `${docId}:${phase}`;

  const updateDocumentPhaseJobState = (docId, phase, updater) => {
    const key = getDocumentPhaseJobKey(docId, phase);
    setDocumentPhaseJobs((prev) => {
      const current = prev[key];
      const nextValue = typeof updater === 'function' ? updater(current || {}) : updater;
      if (nextValue === null) {
        if (current) {
          const { [key]: _, ...rest } = prev;
          return rest;
        }
        return prev;
      }
      return {
        ...prev,
        [key]: {
          ...(current || {}),
          ...nextValue,
        },
      };
    });
  };

  const pollDocumentPhaseJob = (jobId, docId, phase) => {
    if (!jobId) return;
    if (documentJobPollersRef.current[jobId]) {
      clearInterval(documentJobPollersRef.current[jobId]);
    }
    const poller = setInterval(async () => {
      try {
        const response = await fetch(`${API_URL}/documents/jobs/${jobId}`);
        if (!response.ok) {
          updateDocumentPhaseJobState(docId, phase, (current) => ({
            ...current,
            status: 'error',
            error: 'Job introuvable ou terminé',
            requested_action: null,
          }));
          clearInterval(poller);
          delete documentJobPollersRef.current[jobId];
          return;
        }
        const data = await response.json();
        updateDocumentPhaseJobState(docId, phase, (current) => ({
          ...current,
          jobId,
          status: data.status,
          requested_action: data.requested_action || null,
          error: data.error || null,
          result: data.result || current?.result,
        }));

        if (['completed', 'error', 'cancelled', 'stopped'].includes(data.status)) {
          clearInterval(poller);
          delete documentJobPollersRef.current[jobId];
          if (selectedSiteId) {
            loadSiteDocuments({ page: documentsData.page, pageSize: documentsData.pageSize });
          }
        }
      } catch (error) {
        updateDocumentPhaseJobState(docId, phase, (current) => ({
          ...current,
          status: 'error',
          error: error.message || 'Erreur pendant le suivi',
          requested_action: null,
        }));
        clearInterval(poller);
        delete documentJobPollersRef.current[jobId];
      }
    }, 1500);

    documentJobPollersRef.current[jobId] = poller;
  };

  const startDocumentPhase = async (doc, phase) => {
    const docId = doc.id;
    setOpenPhaseMenuKey(null);
    updateDocumentPhaseJobState(docId, phase, (current) => ({
      ...current,
      status: 'starting',
      error: null,
      requested_action: null,
    }));
    try {
      const response = await fetch(`${API_URL}/documents/${docId}/phase/${phase}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (response.ok && data.job_id) {
        updateDocumentPhaseJobState(docId, phase, {
          jobId: data.job_id,
          status: 'running',
          error: null,
          requested_action: null,
        });
        pollDocumentPhaseJob(data.job_id, docId, phase);
      } else {
        updateDocumentPhaseJobState(docId, phase, (current) => ({
          ...current,
          status: 'error',
          error: data.error || 'Impossible de lancer la phase',
          requested_action: null,
        }));
      }
    } catch (error) {
      updateDocumentPhaseJobState(docId, phase, (current) => ({
        ...current,
        status: 'error',
        error: error.message || 'Erreur réseau',
        requested_action: null,
      }));
    }
  };

  const performDocumentJobAction = async (jobId, docId, phase, action) => {
    if (!jobId) {
      updateDocumentPhaseJobState(docId, phase, (current) => ({
        ...current,
        error: "Aucune opération en cours",
        requested_action: null,
      }));
      return;
    }

    const endpoint = `${API_URL}/documents/jobs/${jobId}/${action}`;
    updateDocumentPhaseJobState(docId, phase, (current) => ({
      ...current,
      error: null,
      requested_action: action,
    }));

    try {
      const response = await fetch(endpoint, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) {
        updateDocumentPhaseJobState(docId, phase, (current) => ({
          ...current,
          error: data.error || 'Action impossible',
          requested_action: null,
        }));
        return;
      }

      if (action === 'resume') {
        if (documentJobPollersRef.current[jobId]) {
          clearInterval(documentJobPollersRef.current[jobId]);
          delete documentJobPollersRef.current[jobId];
        }
        const newJobId = data.job_id;
        if (newJobId) {
          updateDocumentPhaseJobState(docId, phase, (current) => ({
            ...current,
            jobId: newJobId,
            status: 'running',
            requested_action: null,
            error: null,
          }));
          pollDocumentPhaseJob(newJobId, docId, phase);
        } else {
          updateDocumentPhaseJobState(docId, phase, (current) => ({
            ...current,
            requested_action: null,
          }));
        }
      } else {
        updateDocumentPhaseJobState(docId, phase, (current) => ({
          ...current,
          requested_action: action,
        }));
      }
    } catch (error) {
      updateDocumentPhaseJobState(docId, phase, (current) => ({
        ...current,
        error: error.message || 'Erreur réseau',
        requested_action: null,
      }));
    }
  };

  const handlePhaseAction = async (doc, phase, action) => {
    const docId = doc.id;
    const jobKey = getDocumentPhaseJobKey(docId, phase);
    const jobState = documentPhaseJobs[jobKey];
    setOpenPhaseMenuKey(null);

    if (action === 'start') {
      await startDocumentPhase(doc, phase);
      return;
    }

    await performDocumentJobAction(jobState?.jobId, docId, phase, action);
  };

  const getDocumentPhaseActionOptions = (jobState) => {
    const status = jobState?.status;
    return [
      {
        action: 'start',
        label: status && status !== 'running' ? 'Relancer' : 'Lancer',
        icon: <Play className="w-4 h-4" />,
        disabled: status === 'running' || status === 'starting',
      },
      {
        action: 'stop',
        label: 'Arrêter',
        icon: <StopCircle className="w-4 h-4" />,
        disabled: !(status && ['running', 'starting'].includes(status)),
      },
      {
        action: 'resume',
        label: 'Reprendre',
        icon: <RefreshCw className="w-4 h-4" />,
        disabled: !(status && ['stopped', 'error', 'cancelled'].includes(status)),
      },
      {
        action: 'cancel',
        label: 'Annuler',
        icon: <XCircle className="w-4 h-4" />,
        disabled: !(status && ['pending', 'running', 'starting'].includes(status)),
      },
    ];
  };

  const getDocumentPhaseDisplay = (phaseStatus, jobState) => {
    if (jobState?.status === 'starting') {
      return {
        icon: <Loader className="w-4 h-4 text-indigo-400 animate-spin" />,
        label: 'Initialisation...',
        badgeClass: 'bg-blue-100 text-blue-700',
      };
    }
    if (jobState?.status === 'running') {
      return {
        icon: <Loader className="w-4 h-4 text-indigo-500 animate-spin" />,
        label: 'En cours',
        badgeClass: 'bg-blue-100 text-blue-700',
      };
    }
    if (jobState?.status === 'stopped') {
      return {
        icon: <StopCircle className="w-4 h-4 text-amber-500" />,
        label: 'Arrêté',
        badgeClass: 'bg-amber-100 text-amber-700',
      };
    }
    if (jobState?.status === 'cancelled') {
      return {
        icon: <XCircle className="w-4 h-4 text-amber-600" />,
        label: 'Annulé',
        badgeClass: 'bg-amber-100 text-amber-700',
      };
    }
    if (jobState?.status === 'error') {
      return {
        icon: <XCircle className="w-4 h-4 text-red-500" />,
        label: 'Erreur',
        badgeClass: 'bg-red-100 text-red-700',
      };
    }
    if (jobState?.status === 'completed') {
      return {
        icon: <CheckCircle className="w-4 h-4 text-green-500" />,
        label: 'Terminé',
        badgeClass: 'bg-green-100 text-green-700',
      };
    }

    switch (phaseStatus) {
      case 'success':
        return {
          icon: <CheckCircle className="w-4 h-4 text-green-500" />,
          label: 'Terminé',
          badgeClass: 'bg-green-100 text-green-700',
        };
      case 'error':
        return {
          icon: <XCircle className="w-4 h-4 text-red-500" />,
          label: 'Erreur',
          badgeClass: 'bg-red-100 text-red-700',
        };
      case 'partial':
        return {
          icon: <RefreshCw className="w-4 h-4 text-blue-500" />,
          label: 'Partiel',
          badgeClass: 'bg-blue-100 text-blue-700',
        };
      case 'pending':
      case 'queued':
        return {
          icon: <Circle className="w-4 h-4 text-amber-500" />,
          label: 'En attente',
          badgeClass: 'bg-amber-100 text-amber-700',
        };
      case 'skipped':
        return {
          icon: <Circle className="w-4 h-4 text-gray-300" />,
          label: 'Ignoré',
          badgeClass: 'bg-gray-200 text-gray-500',
        };
      default:
        return {
          icon: <Circle className="w-4 h-4 text-gray-400" />,
          label: phaseStatus || '—',
          badgeClass: 'bg-gray-200 text-gray-600',
        };
    }
  };

  const renderDocumentPhaseRow = (doc, phase) => {
    const key = getDocumentPhaseJobKey(doc.id, phase);
    const jobState = documentPhaseJobs[key];
    const phaseStatus = doc.phases?.[phase] || 'pending';
    const display = getDocumentPhaseDisplay(phaseStatus, jobState);
    const actions = getDocumentPhaseActionOptions(jobState);
    const isMenuOpen = openPhaseMenuKey === key;

    return (
      <div key={phase} className="relative border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {display.icon}
            <div>
              <p className="text-sm font-medium text-gray-700">{phaseLabels[phase]}</p>
              <span className={`inline-flex items-center px-2 py-0.5 text-[11px] rounded-full ${display.badgeClass}`}>
                {display.label}
              </span>
            </div>
          </div>
          <div className="relative" data-phase-menu="true">
            <button
              type="button"
              onClick={() => setOpenPhaseMenuKey(isMenuOpen ? null : key)}
              className="p-1.5 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              title="Actions"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {isMenuOpen && (
              <div className="absolute right-0 mt-2 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-30" data-phase-menu="true">
                {actions.map((item) => (
                  <button
                    key={item.action}
                    type="button"
                    onClick={() => {
                      if (!item.disabled) {
                        handlePhaseAction(doc, phase, item.action);
                      }
                    }}
                    disabled={item.disabled}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                    data-phase-menu="true"
                  >
                    {item.icon}
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {jobState?.error && (
          <p className="mt-2 text-xs text-red-600">{jobState.error}</p>
        )}
      </div>
    );
  };

  const performSemanticSearch = async (event, overrides = {}) => {
    if (event) {
      event.preventDefault();
    }
    const query = semanticQuery.trim();
    if (!query) {
      setSemanticInfo({ active: false, query: '', model: '', total: 0 });
      setSemanticResults((prev) => ({ ...prev, items: [], total: 0, siteIds: [], limit: prev.limit || 20 }));
      return;
    }

    const targetSiteIds =
      selectedSiteIds.length > 0
        ? selectedSiteIds
        : selectedSiteId != null
        ? [selectedSiteId]
        : sites.length > 0
        ? [sites[0].id]
        : [];

    if (targetSiteIds.length === 0) {
      alert('Sélectionnez au moins un site pour lancer la recherche.');
      return;
    }

    const baseSiteId = targetSiteIds[0];
    const limit = overrides.limit || semanticResults.limit || 20;

    try {
      setSemanticLoading(true);
      const response = await fetch(`${API_URL}/sites/${baseSiteId}/semantic-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          limit,
          site_ids: targetSiteIds,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        setSemanticInfo({ active: false, query: '', model: '', total: 0 });
        setSemanticResults({ items: [], total: 0, siteIds: [], limit });
        if (data?.error) {
          alert(data.error);
        }
        return;
      }

      const items = (data.items || []).map((item) => ({ ...item }));
      setSemanticResults({
        items,
        total: data.total ?? items.length,
        siteIds: data.site_ids || targetSiteIds,
        limit: data.limit || limit,
      });
      setSemanticInfo({
        active: true,
        query: data.query || query,
        model: data.model || '',
        total: data.total ?? items.length,
      });
    } catch (error) {
      console.error('Erreur recherche sémantique:', error);
      alert('Erreur lors de la recherche sémantique');
    } finally {
      setSemanticLoading(false);
    }
  };

  const clearSemanticResults = ({ resetQuery = false } = {}) => {
    setSemanticInfo({ active: false, query: '', model: '', total: 0 });
    setSemanticResults((prev) => ({ ...prev, items: [], total: 0, siteIds: [], limit: prev.limit || 20 }));
    if (resetQuery) {
      setSemanticQuery('');
    }
  };

  const startHarvest = async (tasksOverride = null, origin = 'launch') => {
    const currentHarvesterMeta =
      availableHarvesters.find((item) => item.id === selectedHarvester) || null;
    if (currentHarvesterMeta && currentHarvesterMeta.available === false) {
      alert("Ce moissonneur n'est pas disponible sur cette installation.");
      return;
    }
    setCommandLoading((prev) => ({ ...prev, [origin]: true }));
    try {
      const payload = {
        harvester_type: selectedHarvester,
        ...formData,
      };
      let tasks = tasksOverride && tasksOverride.length > 0 ? tasksOverride : deriveTasksFromOptions(taskOptions);
      tasks = normalizeTasks(tasks);
      payload.tasks = tasks;
      if (origin === 'resume') {
        payload.resume = true;
      }
      const nextTaskOptionsSnapshot = {
        download: tasks.includes('download'),
        analyze: tasks.includes('analyze'),
      };
      setTaskOptions({
        collect: true,
        download: nextTaskOptionsSnapshot.download,
        analyze: nextTaskOptionsSnapshot.analyze,
      });
      if (selectedSiteId != null) {
        persistCurrentSiteConfig(selectedSiteId, { taskOptions: nextTaskOptionsSnapshot });
      }

      const response = await fetch(`${API_URL}/harvest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (data.job_id) {
        const initialPhases = {
          collect: { status: tasks.includes('collect') ? 'running' : 'skipped', processed: 0, total: 0 },
          download: { status: tasks.includes('download') ? 'pending' : 'skipped', processed: 0, total: 0 },
          analyze: { status: tasks.includes('analyze') ? 'pending' : 'skipped', processed: 0, total: 0 },
        };
        setCurrentJob({
          id: data.job_id,
          status: 'running',
          phases: initialPhases,
          tasks,
          site_id: selectedSiteId,
        });
        pollJobStatus(data.job_id);
      } else {
        alert(data.error || 'Impossible de démarrer le moissonnage');
      }
    } catch (error) {
      console.error('Erreur:', error);
      alert('Erreur lors du lancement du moissonnage');
    } finally {
      setCommandLoading((prev) => ({ ...prev, [origin]: false }));
    }
  };

  const stopHarvest = async (jobId, { silent = false } = {}) => {
    setCommandLoading((prev) => ({ ...prev, stop: true }));
    try {
      const response = await fetch(`${API_URL}/harvest/${jobId}/stop`, {
        method: 'POST',
      });
      if (response.ok) {
        if (!silent) {
          alert("Demande d'arrêt envoyée");
        }
        setTimeout(() => {
          if (currentJob && currentJob.id === jobId) {
            pollJobStatus(jobId);
          }
        }, 1000);
      }
    } catch (error) {
      console.error("Erreur lors de l'arrêt:", error);
      if (!silent) {
        alert("Erreur lors de l'arrêt du moissonnage");
      }
    } finally {
      setCommandLoading((prev) => ({ ...prev, stop: false }));
    }
  };

  const pollJobStatus = (jobId) => {
    if (pollerRef.current) {
      clearInterval(pollerRef.current);
    }
    pollerRef.current = setInterval(async () => {
      try {
        const response = await fetch(`${API_URL}/harvest/${jobId}`);
        const job = await response.json();
        setCurrentJob((prev) => ({
          ...prev,
          ...job,
          phases: job.phases || prev?.phases || {},
        }));
        const collectStatus = job?.phases?.collect?.status;
        if (
          collectStatus &&
          ['completed', 'success'].includes(collectStatus) &&
          job?.site_id &&
          job.site_id === selectedSiteId &&
          previousCollectStatusRef.current !== collectStatus
        ) {
          previousCollectStatusRef.current = collectStatus;
          await loadSiteDocuments({ page: 1 });
        }
        if (job.status === 'completed' || job.status === 'error' || job.status === 'deleted') {
          if (pollerRef.current) {
            clearInterval(pollerRef.current);
            pollerRef.current = null;
          }
          await loadSitesSummary();
          await loadSiteDocuments({ page: 1 });
        }
      } catch (error) {
        if (pollerRef.current) {
          clearInterval(pollerRef.current);
          pollerRef.current = null;
        }
        console.error('Erreur:', error);
      }
    }, 2000);
  };

  const resumeHarvest = async () => {
    if (!currentJob) return;
    const remaining = getRemainingPhases(currentJob);
    const tasksToRun =
      remaining.length > 0 ? remaining : Array.isArray(currentJob.tasks) && currentJob.tasks.length > 0 ? currentJob.tasks : phaseOrder;
    try {
      await startHarvest(tasksToRun, 'resume');
    } catch (error) {
      console.error('Erreur reprise:', error);
      alert('Impossible de reprendre le moissonnage');
    }
  };

  const cancelHarvest = async () => {
    if (!currentJob) return;
    setCommandLoading((prev) => ({ ...prev, cancel: true }));
    try {
      if (currentJob.status === 'running') {
        await stopHarvest(currentJob.id, { silent: true });
      }
      if (pollerRef.current) {
        clearInterval(pollerRef.current);
        pollerRef.current = null;
      }
      setCurrentJob((prev) =>
        prev
          ? {
              ...prev,
              status: 'cancelled',
              cancelled_at: new Date().toISOString(),
            }
          : prev,
      );
    } catch (error) {
      console.error('Erreur annulation:', error);
      alert("Erreur lors de l'annulation");
    } finally {
      setCommandLoading((prev) => ({ ...prev, cancel: false }));
    }
  };

  const handleSiteRowClick = (site) => {
    clearSemanticResults();
    setSelectedSiteId(site.id);
    setExpandedSiteId(site.id);
    setSelectedSiteIds((prev) => (prev.includes(site.id) ? prev : [...prev, site.id]));
    if (site?.base_url) {
      const derivedName = formatSiteName(site);
      setFormData((prev) => ({
        ...prev,
        url: site.base_url,
        site_name: derivedName,
      }));
    }
  };

  const toggleSiteDocuments = (siteId) => {
    setExpandedSiteId((prevExpanded) => {
      const isClosing = prevExpanded === siteId;
      if (isClosing) {
        if (selectedSiteId === siteId) {
          setSelectedSiteId(null);
        }
        return null;
      }
      clearSemanticResults();
      if (selectedSiteId !== siteId) {
        setSelectedSiteId(siteId);
        setDocumentsData((prev) => ({ ...prev, items: [], total: 0 }));
        setSelectedDocumentIds([]);
      }
      return siteId;
    });
  };

  const handleSiteSelectionToggle = (siteId, checked) => {
    setSelectedSiteIds((prev) => {
      if (checked) {
        if (prev.includes(siteId)) return prev;
        return [...prev, siteId];
      }
      const next = prev.filter((id) => id !== siteId);
      if (selectedSiteId === siteId) {
        setSelectedSiteId(null);
        setExpandedSiteId(null);
      }
      return next;
    });
    if (checked) {
      setSelectedSiteId(siteId);
      setExpandedSiteId(siteId);
    } else if (selectedSiteId === siteId) {
      setSelectedSiteId(null);
      setExpandedSiteId(null);
    }
  };

  const toggleAllSites = (checked) => {
    if (checked) {
      const allIds = sites.map((site) => site.id);
      setSelectedSiteIds(allIds);
      if (allIds.length > 0) {
        setSelectedSiteId(allIds[0]);
        setExpandedSiteId(allIds[0]);
      }
    } else {
      setSelectedSiteIds([]);
      setSelectedSiteId(null);
      setExpandedSiteId(null);
    }
  };

  const deleteSelectedSites = async () => {
    if (selectedSiteIds.length === 0) return;
    if (
      !window.confirm(
        `Supprimer ${selectedSiteIds.length} site(s) et toutes leurs données associées ? Cette action est irréversible.`,
      )
    ) {
      return;
    }
    try {
      for (const id of selectedSiteIds) {
        await fetch(`${API_URL}/sites/${id}`, { method: 'DELETE' });
        if (id === selectedSiteId) {
          setSelectedSiteId(null);
          setExpandedSiteId(null);
        }
      }
      setSelectedSiteIds([]);
      await loadSitesSummary();
      setDocumentsData((prev) => ({ ...prev, items: [], total: 0 }));
    } catch (error) {
      console.error('Erreur suppression site:', error);
    }
  };

  const toggleDocumentSelection = (docId) => {
    setSelectedDocumentIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId],
    );
  };

  const toggleAllDocuments = (checked) => {
    if (checked) {
      setSelectedDocumentIds(documentsData.items.map((doc) => doc.id));
    } else {
      setSelectedDocumentIds([]);
    }
  };

  const deleteSelectedDocuments = async () => {
    if (!selectedSiteId || selectedDocumentIds.length === 0) return;
    if (!window.confirm(`Supprimer ${selectedDocumentIds.length} document(s) sélectionné(s) ?`)) return;
    try {
      await fetch(`${API_URL}/sites/${selectedSiteId}/documents/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_ids: selectedDocumentIds }),
      });
      setSelectedDocumentIds([]);
      await loadSiteDocuments({ page: documentsData.page });
      await loadSitesSummary();
    } catch (error) {
      console.error('Erreur suppression documents:', error);
    }
  };

  const handleDocumentFilterChange = (field, value) => {
    setDocumentFilters((prev) => ({ ...prev, [field]: value }));
  };

  const resetDocumentFilters = () => {
    setDocumentFilters(initialDocumentFilters);
  };

  const handleDocumentPageChange = (page) => {
    const safePage = Math.min(Math.max(page, 1), Math.max(1, Math.ceil(documentsData.total / documentsData.pageSize)));
    loadSiteDocuments({ page: safePage });
  };

  const handleDocumentPageSizeChange = (pageSize) => {
    const size = parseInt(pageSize, 10);
    if (!Number.isNaN(size)) {
      loadSiteDocuments({ page: 1, pageSize: size });
    }
  };

  const openDocumentOnline = (doc) => {
    if (doc.url) {
      window.open(doc.url, '_blank', 'noopener');
    }
  };

  const openDocumentLocal = (doc) => {
    if (!doc.file_path) {
      alert("Aucun fichier local n'est disponible pour ce document");
      return;
    }
    window.open(`${API_URL}/api/documents/${doc.file_path}`, '_blank', 'noopener');
  };

  const viewDocumentJson = (doc) => {
    const jsonStr = JSON.stringify(doc, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  const downloadJobResults = async (jobId) => {
    try {
      const response = await fetch(`${API_URL}/harvest/${jobId}/export`);
      const data = await response.json();
      if (data.error) {
        alert(data.error);
        return;
      }
      const fileBlob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(fileBlob);
      link.download = buildExportFilename(jobId);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Erreur export:', error);
      alert('Erreur lors du téléchargement des résultats');
    }
  };

  const harvesterOptions = harvesters && harvesters.length ? harvesters : harvestersDefault;
  const normalizedHarvesters = harvesterOptions
    .map((item) => resolveHarvesterLabel(item))
    .filter(Boolean);
  const availableHarvesters = normalizedHarvesters;
  const selectedHarvesterInfo = resolveHarvesterLabel(
    normalizedHarvesters.find((h) => h.id === selectedHarvester),
  );

  useEffect(() => {
    if (!selectedHarvester) return;
    const exists = availableHarvesters.some((item) => item.id === selectedHarvester);
    if (!exists && availableHarvesters.length > 0) {
      setSelectedHarvester(availableHarvesters[0].id);
    }
  }, [availableHarvesters, selectedHarvester]);
  const documents = documentsData.items || [];
  const totalPages =
    documentsData.pageSize > 0 ? Math.max(1, Math.ceil(documentsData.total / documentsData.pageSize)) : 1;
  const startItem =
    documentsData.total > 0 ? (documentsData.page - 1) * documentsData.pageSize + Math.min(1, documents.length) : 0;
  const endItem = documentsData.total > 0 ? startItem + documents.length - 1 : 0;
  const isAllSitesSelected = sites.length > 0 && selectedSiteIds.length === sites.length;
  const isAllDocumentsSelected = documents.length > 0 && selectedDocumentIds.length === documents.length;

  const documentStatusOptions = [
    { value: '', label: 'Tous les statuts' },
    { value: 'downloaded', label: 'Téléchargés' },
    { value: 'download_pending', label: 'Téléchargement en attente' },
    { value: 'analysis_completed', label: 'Analyse terminée' },
    { value: 'analysis_pending', label: 'Analyse en attente' },
    { value: 'analysis_error', label: 'Analyse en erreur' },
  ];

  const phaseFilterOptions = [
    { value: '', label: 'Toutes les phases' },
    { value: 'collect_success', label: 'Collecte réussie' },
    { value: 'collect_error', label: 'Collecte en erreur' },
  ];

  const renderSitesSection = () => (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-800">Sites moissonnés</h2>
          <p className="text-sm text-gray-500">
            Sélectionnez un site pour afficher le détail des documents et suivre la progression des phases.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedSiteIds.length > 0 && (
            <button
              onClick={deleteSelectedSites}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Supprimer ({selectedSiteIds.length})
            </button>
          )}
          <button
            onClick={() => loadSitesSummary()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Actualiser
          </button>
        </div>
      </div>

      {sitesLoading ? (
        <div className="flex items-center justify-center py-12 text-gray-500 gap-2">
          <Loader className="w-5 h-5 animate-spin" />
          Chargement des sites...
        </div>
      ) : sites.length === 0 ? (
        <div className="text-center py-10 text-gray-400">
          <Calendar className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>Aucun site enregistré pour l'instant.</p>
          <p className="text-sm">Configurez et lancez un moissonnage pour alimenter la liste.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={isAllSitesSelected}
                    onChange={(e) => toggleAllSites(e.target.checked)}
                  />
                </th>
                <th className="px-3 py-3 text-left font-semibold text-gray-700">Site</th>
              <th className="px-3 py-3 text-left font-semibold text-gray-700">Documents</th>
              <th className="px-3 py-3 text-left font-semibold text-gray-700">Dernier moissonnage</th>
            </tr>
          </thead>
            <tbody className="divide-y divide-gray-100">
              {sites.map((site) => {
                const stats = site.stats || {};
                const lastJob = site.last_job;
                const isSelected = selectedSiteId === site.id;
                const collectSchedule = site.schedule?.collect || null;
                const planLabel =
                  collectSchedule?.frequency && collectSchedule.frequency !== 'manual'
                    ? scheduleFrequencyMap[collectSchedule.frequency] || collectSchedule.frequency
                    : null;
                const nextHarvestAt =
                  collectSchedule && collectSchedule.frequency !== 'manual' ? collectSchedule.next_run_at : null;
                return (
                  <tr
                    key={site.id}
                    onClick={() => handleSiteRowClick(site)}
                    className={`cursor-pointer ${isSelected ? 'bg-indigo-50 border-l-4 border-indigo-400' : 'hover:bg-indigo-50/50'}`}
                  >
                    <td className="px-3 py-4 align-top">
                      <input
                        type="checkbox"
                        checked={selectedSiteIds.includes(site.id)}
                        onChange={(e) => {
                          e.stopPropagation();
                          handleSiteSelectionToggle(site.id, e.target.checked);
                        }}
                      />
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex flex-col gap-1">
                        <span className="font-semibold text-gray-800">{formatSiteName(site)}</span>
                        {site.base_url && (
                          <a
                            href={site.base_url}
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs text-indigo-600 hover:underline"
                            target="_blank"
                            rel="noreferrer"
                          >
                            {site.base_url}
                          </a>
                        )}
                        {planLabel && (
                          <span className="text-xs text-indigo-600">
                            Planification : {planLabel}
                            {nextHarvestAt && ` · prochain lancement ${formatDateTime(nextHarvestAt)}`}
                          </span>
                        )}
                        <div className="flex flex-wrap gap-1">
                          {(site.collections || []).slice(0, 3).map((collection) => (
                            <span
                              key={collection}
                              className="inline-flex items-center px-2 py-0.5 text-xs bg-indigo-100 text-indigo-700 rounded-full"
                            >
                              {collection}
                            </span>
                          ))}
                          {(site.collections || []).length > 3 && (
                            <span className="text-xs text-gray-500">
                              +{(site.collections || []).length - 3} collections
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <div className="space-y-1 text-xs text-gray-600">
                        <p>
                          <span className="font-semibold text-gray-800">{numberFormatter.format(stats.total || 0)}</span>{' '}
                          total
                        </p>
                        <p>
                          <span className="text-green-600 font-semibold">
                            {numberFormatter.format(stats.downloaded || 0)}
                          </span>{' '}
                          téléchargés
                        </p>
                        <p>
                          <span className="text-blue-600 font-semibold">
                            {numberFormatter.format(stats.analyzed || 0)}
                          </span>{' '}
                          analysés
                        </p>
                        {stats.analyze_errors > 0 && (
                          <p className="text-red-600">
                            {numberFormatter.format(stats.analyze_errors)} en erreur d'analyse
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-4 text-sm text-gray-600">
                      {lastJob ? (
                        <div className="space-y-1">
                          <p className="font-medium text-gray-700">{formatPhaseStatus(lastJob.status)}</p>
                          <p className="text-xs">Démarré le {formatDateTime(lastJob.started_at)}</p>
                          {lastJob.completed_at && (
                            <p className="text-xs">Terminé le {formatDateTime(lastJob.completed_at)}</p>
                          )}
                          {typeof lastJob.total_found === 'number' && (
                            <p className="text-xs text-gray-500">
                              {numberFormatter.format(lastJob.total_found)} doc(s) collectés
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400">Aucun moissonnage enregistré</p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  


  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          <div className="xl:col-span-2 space-y-8">
                        <HierarchicalView />
            
          </div>
        </div>
      </div>
      <AssistantPanel />

      {analysisPanelDoc && (
        <DocumentAnalysisPanel
          document={analysisPanelDoc}
          onClose={() => setAnalysisPanelDoc(null)}
          onViewJson={(doc) => viewDocumentJson(doc)}
          onOpenLocal={(doc) => openDocumentLocal(doc)}
        />
      )}
    </div>
  );
}
