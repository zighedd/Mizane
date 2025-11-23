import CoursSupremeViewer from "./CoursSupremeViewer";
import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2, Settings, Play, Download, Brain, RefreshCw, FileText } from 'lucide-react';
import { API_URL, JORADP_API_URL } from '../config';
import Modal from './Modal';
import { useModal } from '../hooks/useModal';
import GlobalStats from './GlobalStats';

import DocumentViewerButtons from './DocumentViewerButtons';

const STATUS_TRUE_VALUES = new Set(['success', 'completed', 'ok', 'done', 'true']);
const STATUS_FALSE_VALUES = new Set(['failed', 'error', 'false']);

const statusToTriState = (value) => {
  if (value === true || value === false) {
    return value;
  }
  if (value == null) {
    return null;
  }

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (STATUS_TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (STATUS_FALSE_VALUES.has(normalized)) {
    return false;
  }
  return null;
};

const normalizeDocStatuts = (statuts = {}) => ({
  collected: statusToTriState(statuts.collected),
  downloaded: statusToTriState(statuts.downloaded),
  text_extracted: statusToTriState(statuts.text_extracted),
  analyzed: statusToTriState(statuts.analyzed),
  embedded: statusToTriState(statuts.embedded),
});

const HierarchicalView = () => {
  const [sites, setSites] = useState([]);
  const [coursupremeExpanded, setCoursupremeExpanded] = useState(false);
  const filteredSites = sites.filter(site => site.id !== 2);
  const { modalState, closeModal, showConfirm, showSuccess, showError } = useModal();

  const [filters, setFilters] = useState({
    year: '',
    dateDebut: '',
    dateFin: '',
    status: 'all',
    searchNum: '',
    keywordsTous: '',      // ET logique
    keywordsUnDe: '',      // OU logique
    keywordsExclut: '',
    searchSemantique: ''
  });
  const [sessionDocuments, setSessionDocuments] = useState({});
  const [selectedDocuments, setSelectedDocuments] = useState({});
  const [currentPage, setCurrentPage] = useState({});

  const [expandedSites, setExpandedSites] = useState(new Set());
  const [expandedSessions, setExpandedSessions] = useState(new Set());
  const [showNewSessionModal, setShowNewSessionModal] = useState(false);
  const [newSessionSiteId, setNewSessionSiteId] = useState(null);

  const [showHarvestDropdown, setShowHarvestDropdown] = useState({});
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [showSiteSettingsModal, setShowSiteSettingsModal] = useState(false);
  const [showSessionSettingsModal, setShowSessionSettingsModal] = useState(false);
  const [selectedSiteSettings, setSelectedSiteSettings] = useState(null);
  const [selectedSessionSettings, setSelectedSessionSettings] = useState(null);
  const [downloadSessionId, setDownloadSessionId] = useState(null);
  const [downloadOptions, setDownloadOptions] = useState({
    mode: 'selected',  // selected, all, range_numero, range_date
    numeroDebut: '',
    numeroFin: '',
    dateDebut: '',
    dateFin: ''
  });
  const [isSearching, setIsSearching] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const [showMetadataModal, setShowMetadataModal] = useState(false);
  const [selectedDocMetadata, setSelectedDocMetadata] = useState(null);

  const [showAdvancedHarvestModal, setShowAdvancedHarvestModal] = useState(false);
  const [advancedHarvestSessionId, setAdvancedHarvestSessionId] = useState(null);
  const [advancedHarvestParams, setAdvancedHarvestParams] = useState({
    mode: 'entre_dates',
    date_debut: '',
    date_fin: '',
    year: new Date().getFullYear(),
    start_num: 1,
    end_num: ''
  });

  const [sessionParams, setSessionParams] = useState({
    session_name: '',
    year: new Date().getFullYear(),
    start_number: 1,
    end_number: 10,
    schedule: 'manual', // manual, daily, weekly, monthly
    filter_date_start: '',
    filter_date_end: '',
    filter_keywords: '',
    filter_languages: ''
  });
  const [sessionsData, setSessionsData] = useState({});

  useEffect(() => {
    loadSites();
  }, []);

  const loadSites = async () => {
    try {
      const res = await fetch(`${API_URL}/sites`);
      const data = await res.json();
      if (data.success) setSites(data.sites);
    } catch (err) {
      console.error('Erreur chargement sites:', err);
    }
  };



  const toggleSelectAll = (sessionId) => {
    if (!sessionDocuments[sessionId]) return;
    
    const docs = sessionDocuments[sessionId].documents;
    const allSelected = docs.every(doc => selectedDocuments[doc.id]);
    
    const newSelected = {...selectedDocuments};
    docs.forEach(doc => {
      newSelected[doc.id] = !allSelected;
    });
    
    setSelectedDocuments(newSelected);
  };


  const downloadDocument = async (doc) => {
    try {
      // Vérifier si le fichier existe déjà
      if (doc.file_path && doc.statuts.downloaded) {
        showConfirm(
        `Le fichier "${doc.numero}" existe déjà. Voulez-vous le re-télécharger ?`,
        async () => {
          try {
            const res = await fetch(`${JORADP_API_URL}/documents/${doc.id}/download`, {
              method: 'POST'
            });
            const data = await res.json();
            if (data.success) {
              showSuccess(`Document "${doc.numero}" téléchargé avec succès !`, 'Téléchargement réussi');
              const sessionId = Object.keys(sessionDocuments).find(sid => 
                sessionDocuments[sid].documents.some(d => d.id === doc.id)
              );
              if (sessionId) loadDocuments(parseInt(sessionId), 1);
            } else {
              showError(`Erreur : ${data.message}`, 'Erreur de téléchargement');
            }
          } catch (error) {
            console.error('Erreur téléchargement:', error);
            showError('Erreur lors du téléchargement');
          }
        },
        'Fichier existant'
      );
      return;
      }
      
      // Lancer le téléchargement
      const res = await fetch(`${JORADP_API_URL}/documents/${doc.id}/download`, {
        method: 'POST'
      });
      
      const data = await res.json();
      
      if (data.success) {
        showSuccess(`Document "${doc.numero}" téléchargé avec succès !`, 'Téléchargement réussi');
        // Rafraîchir la liste des documents
        // Rafraîchir les documents de cette session
        const sessionId = Object.keys(sessionDocuments).find(sid => 
          sessionDocuments[sid].documents.some(d => d.id === doc.id)
        );
        if (sessionId) loadDocuments(parseInt(sessionId), 1);
      } else {
        showError(`Erreur : ${data.message}`, 'Erreur de téléchargement');
      }
    } catch (error) {
      console.error('Erreur téléchargement:', error);
      showError('Erreur lors du téléchargement');
    }
  };

    const viewMetadata = async (doc) => {
    try {
      // Charger les métadonnées complètes depuis le backend
      const res = await fetch(`${JORADP_API_URL}/documents/${doc.id}/metadata`);
      const data = await res.json();
      
      if (data.success) {
        const normalizedMetadata = {
          ...data.metadata,
          statuts: normalizeDocStatuts(data.metadata?.statuts || {})
        };
        setSelectedDocMetadata(normalizedMetadata);
        setShowMetadataModal(true);
      } else {
        alert('Erreur chargement métadonnées');
      }
    } catch (err) {
      // En attendant l'endpoint, afficher les données disponibles
      setSelectedDocMetadata({
        ...doc,
        statuts: normalizeDocStatuts(doc?.statuts || {})
      });
      setShowMetadataModal(true);
    }
  };

  const deleteDocument = async (docId, sessionId) => {
    showConfirm(
      'Êtes-vous sûr de vouloir supprimer ce document de la base de données ?',
      async () => {
        try {
          const res = await fetch(`${JORADP_API_URL}/documents/${docId}`, {
            method: 'DELETE'
          });
          const data = await res.json();
          if (data.success) {
            showSuccess('Document supprimé avec succès', 'Suppression réussie');
            loadDocuments(sessionId, currentPage[sessionId] || 1);
          } else {
            showError(data.error || 'Erreur suppression');
          }
        } catch (err) {
          showError('Erreur réseau');
        }
      },
      'Supprimer le document'
    );
  };


  const openDownloadOptions = (sessionId) => {
    setDownloadSessionId(sessionId);
    setShowDownloadModal(true);
  };

  const exportSelectedPdfs = async (sessionId) => {
    if (!sessionDocuments[sessionId]) {
      alert('Aucun document à exporter');
      return;
    }
    const selectedIds = Object.keys(selectedDocuments).filter((id) => selectedDocuments[id]);
    if (!selectedIds.length) {
      alert('Aucun document sélectionné');
      return;
    }
    try {
      setIsExporting(true);
      const res = await fetch(`${JORADP_API_URL}/documents/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_ids: selectedIds })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showError(err.error || 'Erreur export', 'Export');
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `joradp-documents.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      showSuccess('Export ZIP généré', 'Export');
    } catch (error) {
      console.error('Erreur export:', error);
      showError('Erreur lors de la génération du ZIP', 'Export');
    } finally {
      setIsExporting(false);
    }
  };

  const executeDownload = async () => {
    const params = {
      mode: downloadOptions.mode
    };
    
    if (downloadOptions.mode === 'range_numero') {
      params.numero_debut = downloadOptions.numeroDebut;
      params.numero_fin = downloadOptions.numeroFin;
    } else if (downloadOptions.mode === 'range_date') {
      params.date_debut = downloadOptions.dateDebut;
      params.date_fin = downloadOptions.dateFin;
    } else if (downloadOptions.mode === 'selected') {
      const selectedIds = Object.keys(selectedDocuments).filter(id => selectedDocuments[id]);
      if (selectedIds.length === 0) {
        alert('Aucun document sélectionné');
        return;
      }
      params.document_ids = selectedIds;
    }
    
    try {
      const res = await fetch(`${API_URL}/harvest/${downloadSessionId}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      
      const data = await res.json();
      if (data.success) {
        alert(`Téléchargement: ${data.downloaded} succès, ${data.failed || 0} échecs`);
        setShowDownloadModal(false);
        loadDocuments(downloadSessionId, currentPage[downloadSessionId] || 1);
      } else {
        alert(data.error || 'Erreur téléchargement');
      }
    } catch (err) {
      
    }
  };


  const openSiteSettings = async (siteId) => {
    try {
      const res = await fetch(`${API_URL}/sites/${siteId}`);
      const data = await res.json();
      if (data.success) {
        setSelectedSiteSettings(data.site);
        setShowSiteSettingsModal(true);
      }
    } catch (err) {
      alert('Erreur chargement paramètres site');
    }
  };

  const openSessionSettings = async (sessionId) => {
    try {
      const res = await fetch(`${API_URL}/sessions/${sessionId}/settings`);
      const data = await res.json();
      if (data.success) {
        setSelectedSessionSettings(data.session);
        setShowSessionSettingsModal(true);
      }
    } catch (err) {
      alert('Erreur chargement paramètres session');
    }
  };

  const saveSiteSettings = async () => {
    try {
      const res = await fetch(`${API_URL}/sites/${selectedSiteSettings.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedSiteSettings)
      });
      
      const data = await res.json();
      if (data.success) {
        alert('Paramètres site sauvegardés');
        setShowSiteSettingsModal(false);
        loadSites();
      }
    } catch (err) {
      alert('Erreur sauvegarde');
    }
  };

  const saveSessionSettings = async () => {
    try {
      const res = await fetch(`${API_URL}/sessions/${selectedSessionSettings.id}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedSessionSettings)
      });
      
      const data = await res.json();
      if (data.success) {
        alert('Paramètres session sauvegardés');
        setShowSessionSettingsModal(false);
        loadSessions(selectedSessionSettings.site_id);
      }
    } catch (err) {
      alert('Erreur sauvegarde');
    }
  };

  const loadDocuments = async (sessionId, page = 1) => {
    try {
      setIsSearching(true);
      const params = new URLSearchParams({
        page,
        per_page: 20,
        ...(filters.year && {year: filters.year}),
        ...(filters.dateDebut && {date_debut: filters.dateDebut}),
        ...(filters.dateFin && {date_fin: filters.dateFin}),
        ...(filters.status !== 'all' && {status: filters.status}),
        ...(filters.searchNum && {search_num: filters.searchNum}),
        ...(filters.keywordsTous && {keywords_tous: filters.keywordsTous}),
        ...(filters.keywordsUnDe && {keywords_un_de: filters.keywordsUnDe}),
        ...(filters.keywordsExclut && {keywords_exclut: filters.keywordsExclut}),
        ...(filters.searchSemantique && {search_semantique: filters.searchSemantique})
      });
      
      const res = await fetch(`${API_URL}/sessions/${sessionId}/documents?${params}`);
      const data = await res.json();
      
      if (data.success) {
        const normalizedData = {
          ...data,
          documents: (data.documents || []).map(doc => ({
            ...doc,
            statuts: normalizeDocStatuts(doc.statuts || {})
          }))
        };
        setSessionDocuments(prev => ({...prev, [sessionId]: normalizedData}));
        setCurrentPage(prev => ({...prev, [sessionId]: page}));
      }
    } catch (err) {
      console.error('❌ Erreur chargement documents:', err);
      showError('Erreur lors de la recherche', 'Recherche');
    } finally {
      setIsSearching(false);
    }
  };

  const loadSessions = async (siteId) => {
    try {
      const res = await fetch(`${API_URL}/sites/${siteId}/sessions`);
      const data = await res.json();
      if (data.success) {
        setSessionsData(prev => ({ ...prev, [siteId]: data.sessions }));
      }
    } catch (err) {
      console.error('Erreur chargement sessions:', err);
    }
  };

  const toggleSite = (siteId) => {
    const newExpanded = new Set(expandedSites);
    if (newExpanded.has(siteId)) {
      newExpanded.delete(siteId);
    } else {
      newExpanded.add(siteId);
      if (!sessionsData[siteId]) {
        loadSessions(siteId);
      }
    }
    setExpandedSites(newExpanded);
  };

  const toggleSession = (sessionId) => {
    const wasExpanded = expandedSessions.has(sessionId);
    
    const newExpanded = new Set(expandedSessions);
    if (wasExpanded) {
      newExpanded.delete(sessionId);
    } else {
      newExpanded.add(sessionId);
    }
    setExpandedSessions(newExpanded);
    
    // Charger les documents automatiquement quand on déplie
    if (!wasExpanded && !sessionDocuments[sessionId]) {
      console.log('Chargement documents pour session', sessionId);
      loadDocuments(sessionId, 1);
    }
  };






  const batchExtractText = async (sessionId) => {
    const selectedIds = Object.keys(selectedDocuments).filter(id => selectedDocuments[id]);

    if (selectedIds.length === 0) {
      showError('Aucun document sélectionné', 'Extraction de texte');
      return;
    }

    showConfirm(
      `Extraire le texte de ${selectedIds.length} document(s) sélectionné(s) ?`,
      async () => {
        try {
          const res = await fetch(`${JORADP_API_URL}/batch/extract`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ document_ids: selectedIds })
          });

          const data = await res.json();
          if (data.success) {
            showSuccess(
              `Extraction terminée: ${data.extracted} succès, ${data.failed || 0} échecs`,
              'Extraction de texte'
            );
            loadDocuments(sessionId, currentPage[sessionId] || 1);
          } else {
            showError(data.error || 'Erreur extraction', 'Extraction de texte');
          }
        } catch (err) {
          showError('Erreur réseau', 'Extraction de texte');
        }
      },
      'Extraction de texte'
    );
  };

  const batchAnalyzeDocuments = async (sessionId) => {
    const selectedIds = Object.keys(selectedDocuments).filter(id => selectedDocuments[id]);

    if (selectedIds.length === 0) {
      showError('Aucun document sélectionné', 'Analyse IA');
      return;
    }

    showConfirm(
      `Analyser ${selectedIds.length} document(s) avec IA + Embeddings ?\nCela peut prendre plusieurs minutes.`,
      async () => {
        try {
          const res = await fetch(`${JORADP_API_URL}/batch/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ document_ids: selectedIds })
          });

          const data = await res.json();
          if (data.success) {
            showSuccess(
              `Analyse terminée: ${data.analyzed} succès, ${data.failed || 0} échecs`,
              'Analyse IA'
            );
            loadDocuments(sessionId, currentPage[sessionId] || 1);
          } else {
            showError(data.error || 'Erreur analyse', 'Analyse IA');
          }
        } catch (err) {
          showError('Erreur réseau', 'Analyse IA');
        }
      },
      'Analyse IA'
    );
  };

  const openAdvancedHarvest = (sessionId) => {
    setAdvancedHarvestSessionId(sessionId);
    setShowAdvancedHarvestModal(true);
  };

  const executeAdvancedHarvest = async () => {
    let mode = 'depuis_dernier';
    const params = {};
    
    // Détection automatique du mode selon les paramètres renseignés
    if (advancedHarvestParams.date_debut) {
      // Dates renseignées → mode entre_dates
      mode = 'entre_dates';
      params.date_debut = advancedHarvestParams.date_debut;
      params.date_fin = advancedHarvestParams.date_fin || new Date().toISOString().split('T')[0];
    } else if (advancedHarvestParams.start_num && advancedHarvestParams.start_num > 1) {
      // Numéro de début renseigné → mode depuis_numero
      mode = 'depuis_numero';
      params.year = advancedHarvestParams.year;
      params.start_num = advancedHarvestParams.start_num;
      if (advancedHarvestParams.end_num) {
        params.max_docs = advancedHarvestParams.end_num - advancedHarvestParams.start_num + 1;
      }
    }
    // Sinon → mode depuis_dernier (par défaut)
    
    await incrementalHarvest(advancedHarvestSessionId, mode, params);
    setShowAdvancedHarvestModal(false);
  };

  const incrementalHarvest = async (sessionId, mode, params = {}) => {
    try {
      const res = await fetch(`${API_URL}/harvest/${sessionId}/incremental`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, ...params })
      });
      
      const data = await res.json();
      if (data.success) {
        let message = `Moissonnage incrémental: ${data.found} nouveaux documents`;
        
        if (data.found === 0 && data.last_document) {
          message = `Base de données à jour !\n\nDernier document: ${data.last_document.date}\n${data.last_document.url.split('/').pop()}`;
        }
        
        alert(message);
        if (data.found > 0) {
          loadSessions(Object.keys(sessionsData)[0]);
        }
      } else {
        alert(data.error || 'Erreur moissonnage');
      }
    } catch (err) {
      
    }
  };

  const launchPhases = async (sessionId) => {
    try {
      const res = await fetch(`${API_URL}/harvest/${sessionId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase: 'collect' })
      });
      
      const data = await res.json();
      if (data.success) {
        alert('Phases lancées !');
        loadSessions(Object.keys(sessionsData)[0]); // Recharger pour voir le statut
      } else {
        alert(data.error || 'Erreur lancement');
      }
    } catch (err) {
      
    }
  };

  const deleteSession = async (sessionId) => {
    if (!window.confirm('Confirmer la suppression de cette session ?')) {
      return;
    }
    
    try {
      const res = await fetch(`${API_URL}/sessions/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_ids: [sessionId] })
      });
      
      const data = await res.json();
      if (data.success) {
        alert(`Session supprimée (${data.deleted} élément)`);
        // Recharger les sessions du site parent
        const session = Object.values(sessionsData).flat().find(s => s.id === sessionId);
        if (session) {
          loadSessions(session.site_id || Object.keys(sessionsData)[0]);
        }
      } else {
        
      }
    } catch (err) {
      
    }
  };

  const createSession = async () => {
    if (!sessionParams.session_name.trim()) {
      alert('Nom de session requis');
      return;
    }
    
    try {
      const payload = {
        session_name: sessionParams.session_name,
        year: sessionParams.year,
        start_number: sessionParams.start_number,
        end_number: sessionParams.end_number,
        schedule_config: JSON.stringify({
          collect: sessionParams.schedule,
          download: sessionParams.schedule,
          analyze: sessionParams.schedule
        }),
        filter_date_start: sessionParams.filter_date_start || null,
        filter_date_end: sessionParams.filter_date_end || null,
        filter_keywords: sessionParams.filter_keywords || null,
        filter_languages: sessionParams.filter_languages || null
      };
      
      const res = await fetch(`${API_URL}/sites/${newSessionSiteId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      if (data.success) {
        alert('Session créée avec tous les paramètres !');
        setShowNewSessionModal(false);
        setSessionParams({
          session_name: '',
          year: new Date().getFullYear(),
          start_number: 1,
          end_number: 10,
          schedule: 'manual',
          filter_date_start: '',
          filter_date_end: '',
          filter_keywords: '',
          filter_languages: ''
        });
        loadSessions(newSessionSiteId);
      } else {
        alert(data.error || 'Erreur création session');
      }
    } catch (err) {
      
    }
  };

  return (
    <>
      <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-6xl mx-auto">
        
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">📚 Sites Juridiques</h1>
          <button className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
            <Plus size={16} />
            Nouveau Site
          </button>
        </div>

        {/* Global Statistics */}
        <GlobalStats />

      {/* Liste des sites */}
        <div className="space-y-3">
          {filteredSites.map(site => (
            <div key={site.id} className="bg-white rounded-lg shadow">
              
              {/* En-tête du site */}
              <div 
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50"
                onClick={() => toggleSite(site.id)}
              >
                <div className="flex items-center gap-3">
                  {expandedSites.has(site.id) ? 
                    <ChevronDown size={20} /> : 
                    <ChevronRight size={20} />
                  }
                  <div className="w-10 h-10 bg-green-600 rounded flex items-center justify-center text-white text-xl">
                    📰
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">{site.name}</h3>
                    <p className="text-sm text-gray-600">{site.url}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-4" />
              </div>

              {/* Sessions du site (si déplié) */}
              {expandedSites.has(site.id) && (
                <div className="px-4 pb-4 pl-12 space-y-2">
                  
                  {/* Boutons d'action site */}
                  <div className="flex gap-2 mb-3">
                    <button 
                      onClick={() => {
                        setNewSessionSiteId(site.id);
                        setShowNewSessionModal(true);
                      }}
                      className="flex items-center gap-2 px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600">
                      <Plus size={14} />
                      Nouvelle Session
                    </button>
                    <button 
                      onClick={() => openSiteSettings(site.id)}
                      className="flex items-center gap-2 px-3 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600">
                      <Settings size={14} />
                      Paramètres
                    </button>
                    <button className="flex items-center gap-2 px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600">
                      <Trash2 size={14} />
                      Supprimer
                    </button>
                  </div>

                  {/* Liste des sessions */}
                  {sessionsData[site.id]?.map(session => (
                    <div key={session.id} className="bg-gray-50 rounded p-3">
                      
                      {/* En-tête session */}
                      <div 
                        className="flex items-center justify-between cursor-pointer"
                        onClick={() => toggleSession(session.id)}
                      >
                        <div className="flex items-center gap-2">
                          {expandedSessions.has(session.id) ? 
                            <ChevronDown size={16} /> : 
                            <ChevronRight size={16} />
                          }
                          <span className="font-medium">{session.session_name}</span>
                          <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-800">
                            {session.status}
                          </span>
                        </div>
                        
                        <div className="flex gap-3 text-xs" />
                      </div>

                      {/* Détails session (si déplié) */}
                      {expandedSessions.has(session.id) && (
                        <div className="mt-3 pl-6 space-y-2">
                            <div className="flex gap-2">
                              {/* Bouton Moissonnage avec dropdown */}
                              <div className="relative">
                                <button 
                                  onClick={() => setShowHarvestDropdown(prev => ({...prev, [session.id]: !prev[session.id]}))}
                                className="flex items-center gap-1 px-2 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600">
                                <RefreshCw size={12} />
                                Moissonnage
                                <ChevronDown size={10} />
                              </button>
                              
                              {showHarvestDropdown[session.id] && (
                                <div className="absolute top-full left-0 mt-1 bg-white border rounded shadow-lg z-10 w-48">
                                  <button
                                    onClick={() => {
                                      incrementalHarvest(session.id, 'depuis_dernier');
                                      setShowHarvestDropdown(prev => ({...prev, [session.id]: false}));
                                    }}
                                    className="w-full text-left px-3 py-2 text-xs hover:bg-gray-100 flex items-center gap-2">
                                    <RefreshCw size={12} className="text-cyan-600" />
                                    Mise à jour (depuis le dernier)
                                  </button>
                                  <button
                                    onClick={() => {
                                      openAdvancedHarvest(session.id);
                                      setShowHarvestDropdown(prev => ({...prev, [session.id]: false}));
                                    }}
                                    className="w-full text-left px-3 py-2 text-xs hover:bg-gray-100 flex items-center gap-2 border-t">
                                    <Settings size={12} className="text-indigo-600" />
                                    Moissonnage personnalisé
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (window.confirm('Moissonner TOUS les documents depuis 1962 ? Cela peut prendre du temps.')) {
                                        launchPhases(session.id);
                                      }
                                      setShowHarvestDropdown(prev => ({...prev, [session.id]: false}));
                                    }}
                                    className="w-full text-left px-3 py-2 text-xs hover:bg-gray-100 flex items-center gap-2 border-t">
                                    <Play size={12} className="text-blue-600" />
                                    Moissonnage complet
                                  </button>
                                </div>
                              )}
                            </div>
                              <button
                                onClick={() => openDownloadOptions(session.id)}
                                className="flex items-center gap-1 px-2 py-1 bg-green-500 text-white rounded text-xs hover:bg-green-600">
                                <Download size={12} />
                                Télécharger
                              </button>
                            <button
                              onClick={() => exportSelectedPdfs(session.id)}
                              disabled={isExporting}
                              className={`flex items-center gap-1 px-2 py-1 rounded text-xs text-white ${isExporting ? 'bg-emerald-300' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                              <Download size={12} />
                              {isExporting ? 'Export...' : 'Export PDF (R2)'}
                            </button>
                              <button
                                onClick={() => batchExtractText(session.id)}
                                className="flex items-center gap-1 px-2 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600">
                                <FileText size={12} />
                                Extraire
                            </button>
                            <button
                              onClick={() => batchAnalyzeDocuments(session.id)}
                              className="flex items-center gap-1 px-2 py-1 bg-purple-500 text-white rounded text-xs hover:bg-purple-600">
                              <Brain size={12} />
                              Analyser IA
                            </button>
                            <button 
                              onClick={() => openSessionSettings(session.id)}
                              className="px-2 py-1 bg-gray-500 text-white rounded text-xs hover:bg-gray-600">
                              Paramètres
                            </button>
                            <button 
                              onClick={() => deleteSession(session.id)}
                              className="px-2 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600">
                              Supprimer
                            </button>
                          </div>
                          <div className="text-xs text-gray-600" />
                          
                          {/* Barre de filtres */}
                          <div className="mt-3 bg-gray-50 p-3 rounded border">
                            <div className="grid grid-cols-5 gap-2">
                              <div>
                                <label className="block text-xs font-medium mb-1">Année</label>
                                <select
                                  value={filters.year}
                                  onChange={(e) => setFilters({...filters, year: e.target.value})}
                                  className="w-full px-2 py-1 border rounded text-xs">
                                  <option value="">Toutes</option>
                                  {Array.from({length: 64}, (_, i) => 2025 - i).map(y => (
                                    <option key={y} value={y}>{y}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs font-medium mb-1">Date début</label>
                                <input
                                  type="date"
                                  value={filters.dateDebut}
                                  onChange={(e) => setFilters({...filters, dateDebut: e.target.value})}
                                  className="w-full px-2 py-1 border rounded text-xs"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium mb-1">Date fin</label>
                                <input
                                  type="date"
                                  value={filters.dateFin}
                                  onChange={(e) => setFilters({...filters, dateFin: e.target.value})}
                                  className="w-full px-2 py-1 border rounded text-xs"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium mb-1">Statut</label>
                                <select
                                  value={filters.status}
                                  onChange={(e) => setFilters({...filters, status: e.target.value})}
                                  className="w-full px-2 py-1 border rounded text-xs">
                                  <option value="all">Tous</option>
                                  <option value="collected">Collectés</option>
                                  <option value="downloaded">Téléchargés</option>
                                  <option value="analyzed">Analysés</option>
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs font-medium mb-1">N° Document</label>
                                <input
                                  type="text"
                                  value={filters.searchNum}
                                  onChange={(e) => setFilters({...filters, searchNum: e.target.value})}
                                  placeholder="Ex: 045"
                                  className="w-full px-2 py-1 border rounded text-xs"
                                />
                              </div>
                            </div>
                            
                            {/* 2ème ligne : Recherche avancée */}
                            <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t">
                              <div>
                                <label className="block text-xs font-medium mb-1">Contient TOUS (ET)</label>
                                <input
                                  type="text"
                                  value={filters.keywordsTous}
                                  onChange={(e) => setFilters({...filters, keywordsTous: e.target.value})}
                                  placeholder="mot1, mot2"
                                  className="w-full px-2 py-1 border rounded text-xs"
                                  title="Documents contenant tous ces mots"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium mb-1">Contient UN DE (OU)</label>
                                <input
                                  type="text"
                                  value={filters.keywordsUnDe}
                                  onChange={(e) => setFilters({...filters, keywordsUnDe: e.target.value})}
                                  placeholder="mot1, mot2, mot3"
                                  className="w-full px-2 py-1 border rounded text-xs"
                                  title="Documents contenant au moins un de ces mots"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium mb-1">Ne contient pas</label>
                                <input
                                  type="text"
                                  value={filters.keywordsExclut}
                                  onChange={(e) => setFilters({...filters, keywordsExclut: e.target.value})}
                                  placeholder="mot1, mot2"
                                  className="w-full px-2 py-1 border rounded text-xs"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium mb-1">🔍 Recherche sémantique</label>
                                <input
                                  type="text"
                                  value={filters.searchSemantique}
                                  onChange={(e) => setFilters({...filters, searchSemantique: e.target.value})}
                                  placeholder="Ex: accident de circulation"
                                  className="w-full px-2 py-1 border rounded text-xs bg-purple-50"
                                />
                              </div>
                            </div>
                            
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() => loadDocuments(session.id, 1)}
                                disabled={isSearching}
                                className={`px-4 py-1 rounded text-xs font-medium text-white ${isSearching ? 'bg-blue-300' : 'bg-blue-500 hover:bg-blue-600'}`}>
                                {isSearching ? '⏳ Recherche...' : '🔍 Rechercher'}
                              </button>
                              <button
                                onClick={() => {
                                  setFilters({year: '', dateDebut: '', dateFin: '', status: 'all', searchNum: '', keywordsTous: '', keywordsUnDe: '', keywordsExclut: '', searchSemantique: ''});
                                  loadDocuments(session.id, 1);
                                }}
                                className="px-4 py-1 text-xs text-blue-600 hover:text-blue-800">
                                ↻ Réinitialiser
                              </button>
                              <div className="text-xs text-gray-600 flex items-center">
                                Résultats : {sessionDocuments[session.id]?.pagination?.total ?? 0}
                              </div>
                            </div>
                          </div>
                          
                          {/* Tableau des documents */}
                          {sessionDocuments[session.id] && (
                            <div className="mt-3">
                              <div className="overflow-x-auto border rounded">
                                <table className="w-full text-xs">
                                  <thead className="bg-gray-100">
                                    <tr>
                                      <th className="p-2 text-left w-8">
                                        <input 
                                          type="checkbox" 
                                          onChange={() => toggleSelectAll(session.id)}
                                          checked={sessionDocuments[session.id]?.documents.every(doc => selectedDocuments[doc.id]) || false}
                                        />
                                      </th>
                                      <th className="p-2 text-left">Année</th>
                                      <th className="p-2 text-left">N°</th>
                                      <th className="p-2 text-left">Score</th>
                                      <th className="p-2 text-left">Date Publication</th>
                                      <th className="p-2 text-center">Collecté</th>
                                      <th className="p-2 text-center">Téléchargé</th>
                                      <th className="p-2 text-center">Analysé</th>
                                      <th className="p-2 text-center">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {sessionDocuments[session.id].documents.map(doc => (
                                      <tr key={doc.id} className="border-t hover:bg-gray-50">
                                        <td className="p-2">
                                          <input 
                                            type="checkbox"
                                            checked={selectedDocuments[doc.id] || false}
                                            onChange={(e) => setSelectedDocuments({
                                              ...selectedDocuments, 
                                              [doc.id]: e.target.checked
                                            })}
                                          />
                                        </td>
                                        <td className="p-2">{doc.date || '-'}</td>
                                        <td className="p-2 font-mono">{doc.numero}</td>
                                        <td className="p-2 font-mono">{doc.similarity != null ? doc.similarity.toFixed(3) : '-'}</td>
                                        <td className="p-2">{doc.publication_date || "-"}</td>
                                        <td className="p-2 text-center">
                                          {doc.statuts.collected === true ? '✅' : 
                                           doc.statuts.collected === false ? '❌' : '⏳'}
                                        </td>
                                        <td className="p-2 text-center">
                                          {doc.statuts.downloaded === true ? '✅' : 
                                           doc.statuts.downloaded === false ? '❌' : '⏳'}
                                        </td>
                                        <td className="p-2 text-center">
                                          {doc.statuts.analyzed === true ? '✅' : 
                                           doc.statuts.analyzed === false ? '❌' : '⏳'}
                                        </td>
                                        <td className="p-2 text-center">
                                          <button onClick={() => downloadDocument(doc)} className="text-blue-600 hover:text-blue-800 mr-1" title="Télécharger le PDF">↓</button>
                                          {/* DEBUG */}
                                          <span style={{display: 'none'}}>{console.log('DOC COMPLET:', JSON.stringify(doc, null, 2))}</span>
                                          <span style={{display: 'none'}}>{console.log('Champs disponibles:', Object.keys(doc))}</span>
                                          <DocumentViewerButtons 
                                            document={{
                                              ...doc,
                                              file_path: doc.file_path,
                                              source_url: doc.url,
                                              download_status: doc.statuts.downloaded ? 'completed' : 'pending',
                                              title: doc.titre,
                                              file_format: doc.file_extension
                                            }}
                                          />
                                          <button 
                                            onClick={() => viewMetadata(doc)}
                                            className="text-purple-600 hover:text-purple-800 cursor-pointer mr-1" 
                                            title="Voir métadonnées">
                                            ℹ️
                                          </button>
                                          <button 
                                            onClick={() => deleteDocument(doc.id, session.id)}
                                            className="text-red-600 hover:text-red-800 cursor-pointer" 
                                            title="Supprimer">
                                            🗑️
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              <div className="flex justify-between items-center mt-2 text-xs">
                                <div>
                                  Page {sessionDocuments[session.id].pagination.page} / {sessionDocuments[session.id].pagination.total_pages} 
                                  ({sessionDocuments[session.id].pagination.total} documents)
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    disabled={sessionDocuments[session.id].pagination.page === 1}
                                    onClick={() => loadDocuments(session.id, sessionDocuments[session.id].pagination.page - 1)}
                                    className="px-2 py-1 border rounded disabled:opacity-50 text-xs">
                                    ← Préc
                                  </button>
                                  <button
                                    disabled={sessionDocuments[session.id].pagination.page === sessionDocuments[session.id].pagination.total_pages}
                                    onClick={() => loadDocuments(session.id, sessionDocuments[session.id].pagination.page + 1)}
                                    className="px-2 py-1 border rounded disabled:opacity-50 text-xs">
                                    Suiv →
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}

                  {sessionsData[site.id]?.length === 0 && (
                    <p className="text-gray-500 text-sm italic">Aucune session pour ce site</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      

      {/* Cour Suprême - Accordéon */}
      <div className="mt-4">
        <div className="bg-white rounded-lg shadow">
          <div 
            onClick={() => setCoursupremeExpanded(!coursupremeExpanded)}
            className="flex items-center gap-4 p-4 cursor-pointer hover:bg-gray-50"
          >
            {coursupremeExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
            
            <div className="flex items-center gap-3 flex-1">
              <div className="w-10 h-10 bg-blue-500 rounded flex items-center justify-center text-white text-xl">
                ⚖️
              </div>
              <div>
                <div className="font-bold">Cour Suprême d'Algérie</div>
                <div className="text-xs text-gray-500">6 chambres - Décisions de jurisprudence</div>
              </div>
            </div>
            
            <div className="flex gap-2">
              <span className="px-3 py-1 bg-green-100 text-green-700 rounded text-sm">1245 décisions</span>
            </div>
          </div>
          
          {coursupremeExpanded && (
            <div className="border-t">
              <CoursSupremeViewer />
            </div>
          )}
        </div>
      </div>

      {/* Modal Nouvelle Session */}
      {showNewSessionModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-white rounded-lg p-6 w-[600px] my-8">
            <h3 className="text-xl font-bold mb-4">Nouvelle Session de Moissonnage</h3>
            
            {/* Nom de session */}
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Nom de la session *</label>
              <input
                type="text"
                value={sessionParams.session_name}
                onChange={(e) => setSessionParams({...sessionParams, session_name: e.target.value})}
                placeholder="ex: session_2025_octobre"
                className="w-full px-3 py-2 border rounded"
              />
            </div>

            {/* Paramètres de moissonnage */}
            <div className="mb-4 p-4 bg-gray-50 rounded">
              <h4 className="font-medium mb-3">Paramètres de moissonnage</h4>
              
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div>
                  <label className="block text-sm mb-1">Nombre max de documents</label>
                  <input
                    type="number"
                    value={sessionParams.max_documents || ''}
                    onChange={(e) => setSessionParams({...sessionParams, max_documents: e.target.value ? parseInt(e.target.value) : null})}
                    placeholder="Illimité si vide"
                    className="w-full px-2 py-1 border rounded text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1">Numéro début (optionnel)</label>
                  <input
                    type="number"
                    value={sessionParams.start_number || ''}
                    onChange={(e) => setSessionParams({...sessionParams, start_number: e.target.value ? parseInt(e.target.value) : null})}
                    placeholder="Premier"
                    className="w-full px-2 py-1 border rounded text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1">Numéro fin (optionnel)</label>
                  <input
                    type="number"
                    value={sessionParams.end_number || ''}
                    onChange={(e) => setSessionParams({...sessionParams, end_number: e.target.value ? parseInt(e.target.value) : null})}
                    placeholder="Dernier"
                    className="w-full px-2 py-1 border rounded text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm mb-1">Périodicité</label>
                <select
                  value={sessionParams.schedule}
                  onChange={(e) => setSessionParams({...sessionParams, schedule: e.target.value})}
                  className="w-full px-2 py-1 border rounded text-sm"
                >
                  <option value="manual">Manuel (une fois)</option>
                  <option value="daily">Quotidien</option>
                  <option value="weekly">Hebdomadaire</option>
                  <option value="monthly">Mensuel</option>
                </select>
              </div>
            </div>

            {/* Filtres optionnels */}
            <div className="mb-4 p-4 bg-gray-50 rounded">
              <h4 className="font-medium mb-3">Filtres optionnels</h4>
              
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-sm mb-1">Date début</label>
                  <input
                    type="date"
                    value={sessionParams.filter_date_start}
                    onChange={(e) => setSessionParams({...sessionParams, filter_date_start: e.target.value})}
                    className="w-full px-2 py-1 border rounded text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1">Date fin</label>
                  <input
                    type="date"
                    value={sessionParams.filter_date_end}
                    onChange={(e) => setSessionParams({...sessionParams, filter_date_end: e.target.value})}
                    className="w-full px-2 py-1 border rounded text-sm"
                  />
                </div>
              </div>

              <div className="mb-3">
                <label className="block text-sm mb-1">Mots-clés (séparés par virgule)</label>
                <input
                  type="text"
                  value={sessionParams.filter_keywords}
                  onChange={(e) => setSessionParams({...sessionParams, filter_keywords: e.target.value})}
                  placeholder="ex: décret, arrêté, loi"
                  className="w-full px-2 py-1 border rounded text-sm"
                />
              </div>

              <div>
                <label className="block text-sm mb-1">Langues (fr, ar, en...)</label>
                <input
                  type="text"
                  value={sessionParams.filter_languages}
                  onChange={(e) => setSessionParams({...sessionParams, filter_languages: e.target.value})}
                  placeholder="ex: fr, ar"
                  className="w-full px-2 py-1 border rounded text-sm"
                />
              </div>
            </div>
            
            {/* Boutons */}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowNewSessionModal(false);
                  setSessionParams({
                    session_name: '',
                    year: new Date().getFullYear(),
                    start_number: 1,
                    end_number: 10,
                    schedule: 'manual',
                    filter_date_start: '',
                    filter_date_end: '',
                    filter_keywords: '',
                    filter_languages: ''
                  });
                }}
                className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
              >
                Annuler
              </button>
              <button
                onClick={createSession}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Créer
              </button>
            </div>
          </div>
        </div>
      )}

</div>



      {/* Modal Options de Téléchargement */}
      {showDownloadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[500px]">
            <h3 className="text-xl font-bold mb-4">📥 Options de Téléchargement</h3>
            
            {/* Mode de téléchargement */}
            <div className="space-y-3 mb-4">
              <label className="flex items-center gap-2 cursor-pointer p-2 border rounded hover:bg-gray-50">
                <input
                  type="radio"
                  name="downloadMode"
                  value="selected"
                  checked={downloadOptions.mode === 'selected'}
                  onChange={(e) => setDownloadOptions({...downloadOptions, mode: e.target.value})}
                />
                <div>
                  <div className="font-medium text-sm">Documents sélectionnés</div>
                  <div className="text-xs text-gray-600">Télécharger uniquement les documents cochés</div>
                </div>
              </label>
              
              <label className="flex items-center gap-2 cursor-pointer p-2 border rounded hover:bg-gray-50">
                <input
                  type="radio"
                  name="downloadMode"
                  value="all"
                  checked={downloadOptions.mode === 'all'}
                  onChange={(e) => setDownloadOptions({...downloadOptions, mode: e.target.value})}
                />
                <div>
                  <div className="font-medium text-sm">Tous les documents</div>
                  <div className="text-xs text-gray-600">Télécharger l'intégralité de la session</div>
                </div>
              </label>
              
              <label className="flex items-center gap-2 cursor-pointer p-2 border rounded hover:bg-gray-50">
                <input
                  type="radio"
                  name="downloadMode"
                  value="range_numero"
                  checked={downloadOptions.mode === 'range_numero'}
                  onChange={(e) => setDownloadOptions({...downloadOptions, mode: e.target.value})}
                />
                <div className="flex-1">
                  <div className="font-medium text-sm">Par numéros</div>
                  {downloadOptions.mode === 'range_numero' && (
                    <div className="flex gap-2 mt-2">
                      <input
                        type="number"
                        placeholder="Du n°"
                        value={downloadOptions.numeroDebut}
                        onChange={(e) => setDownloadOptions({...downloadOptions, numeroDebut: e.target.value})}
                        className="w-1/2 px-2 py-1 border rounded text-xs"
                      />
                      <input
                        type="number"
                        placeholder="Au n°"
                        value={downloadOptions.numeroFin}
                        onChange={(e) => setDownloadOptions({...downloadOptions, numeroFin: e.target.value})}
                        className="w-1/2 px-2 py-1 border rounded text-xs"
                      />
                    </div>
                  )}
                </div>
              </label>
              
              <label className="flex items-center gap-2 cursor-pointer p-2 border rounded hover:bg-gray-50">
                <input
                  type="radio"
                  name="downloadMode"
                  value="range_date"
                  checked={downloadOptions.mode === 'range_date'}
                  onChange={(e) => setDownloadOptions({...downloadOptions, mode: e.target.value})}
                />
                <div className="flex-1">
                  <div className="font-medium text-sm">Par dates</div>
                  {downloadOptions.mode === 'range_date' && (
                    <div className="flex gap-2 mt-2">
                      <input
                        type="date"
                        value={downloadOptions.dateDebut}
                        onChange={(e) => setDownloadOptions({...downloadOptions, dateDebut: e.target.value})}
                        className="w-1/2 px-2 py-1 border rounded text-xs"
                      />
                      <input
                        type="date"
                        value={downloadOptions.dateFin}
                        onChange={(e) => setDownloadOptions({...downloadOptions, dateFin: e.target.value})}
                        className="w-1/2 px-2 py-1 border rounded text-xs"
                      />
                    </div>
                  )}
                </div>
              </label>
            </div>
            
            {/* Boutons */}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowDownloadModal(false);
                  setDownloadOptions({mode: 'selected', numeroDebut: '', numeroFin: '', dateDebut: '', dateFin: ''});
                }}
                className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400">
                Annuler
              </button>
              <button
                onClick={executeDownload}
                className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600">
                Télécharger
              </button>
            </div>
          </div>
        </div>
      )}



      {/* Modal Paramètres Session */}
      {showSessionSettingsModal && selectedSessionSettings && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[600px]">
            <h3 className="text-xl font-bold mb-4">⚙️ Paramètres de la Session</h3>
            
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Nombre max de documents</label>
                <input
                  type="number"
                  value={selectedSessionSettings.max_documents || ''}
                  onChange={(e) => setSelectedSessionSettings({...selectedSessionSettings, max_documents: e.target.value ? parseInt(e.target.value) : null})}
                  placeholder="Illimité si vide"
                  className="w-full px-3 py-2 border rounded"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Numéro début</label>
                  <input
                    type="number"
                    value={selectedSessionSettings.start_number || ''}
                    onChange={(e) => setSelectedSessionSettings({...selectedSessionSettings, start_number: e.target.value ? parseInt(e.target.value) : null})}
                    className="w-full px-3 py-2 border rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Numéro fin</label>
                  <input
                    type="number"
                    value={selectedSessionSettings.end_number || ''}
                    onChange={(e) => setSelectedSessionSettings({...selectedSessionSettings, end_number: e.target.value ? parseInt(e.target.value) : null})}
                    className="w-full px-3 py-2 border rounded"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Date début</label>
                  <input
                    type="date"
                    value={selectedSessionSettings.filter_date_start || ''}
                    onChange={(e) => setSelectedSessionSettings({...selectedSessionSettings, filter_date_start: e.target.value})}
                    className="w-full px-3 py-2 border rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Date fin</label>
                  <input
                    type="date"
                    value={selectedSessionSettings.filter_date_end || ''}
                    onChange={(e) => setSelectedSessionSettings({...selectedSessionSettings, filter_date_end: e.target.value})}
                    className="w-full px-3 py-2 border rounded"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Mots-clés filtrés</label>
                <input
                  type="text"
                  value={selectedSessionSettings.filter_keywords || ''}
                  onChange={(e) => setSelectedSessionSettings({...selectedSessionSettings, filter_keywords: e.target.value})}
                  placeholder="mot1, mot2, mot3"
                  className="w-full px-3 py-2 border rounded"
                />
              </div>
              
              <div className="border-t pt-3 mt-3">
                <h4 className="font-medium mb-2">⏰ Planification automatique par phase</h4>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Collecte</label>
                <select
                  value={selectedSessionSettings.schedule_config ? JSON.parse(selectedSessionSettings.schedule_config).collect_frequency : 'manual'}
                  onChange={(e) => {
                    const config = selectedSessionSettings.schedule_config ? JSON.parse(selectedSessionSettings.schedule_config) : {};
                    config.collect_frequency = e.target.value;
                    setSelectedSessionSettings({...selectedSessionSettings, schedule_config: JSON.stringify(config)});
                  }}
                  className="w-full px-3 py-2 border rounded">
                  <option value="manual">Manuel</option>
                  <option value="daily">Quotidien</option>
                  <option value="weekly">Hebdomadaire</option>
                  <option value="monthly">Mensuel</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Téléchargement</label>
                <select
                  value={selectedSessionSettings.schedule_config ? JSON.parse(selectedSessionSettings.schedule_config).download_frequency : 'manual'}
                  onChange={(e) => {
                    const config = selectedSessionSettings.schedule_config ? JSON.parse(selectedSessionSettings.schedule_config) : {};
                    config.download_frequency = e.target.value;
                    setSelectedSessionSettings({...selectedSessionSettings, schedule_config: JSON.stringify(config)});
                  }}
                  className="w-full px-3 py-2 border rounded">
                  <option value="manual">Manuel</option>
                  <option value="daily">Quotidien</option>
                  <option value="weekly">Hebdomadaire</option>
                  <option value="monthly">Mensuel</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Analyse IA</label>
                <select
                  value={selectedSessionSettings.schedule_config ? JSON.parse(selectedSessionSettings.schedule_config).analyze_frequency : 'manual'}
                  onChange={(e) => {
                    const config = selectedSessionSettings.schedule_config ? JSON.parse(selectedSessionSettings.schedule_config) : {};
                    config.analyze_frequency = e.target.value;
                    setSelectedSessionSettings({...selectedSessionSettings, schedule_config: JSON.stringify(config)});
                  }}
                  className="w-full px-3 py-2 border rounded">
                  <option value="manual">Manuel</option>
                  <option value="daily">Quotidien</option>
                  <option value="weekly">Hebdomadaire</option>
                  <option value="monthly">Mensuel</option>
                </select>
              </div>
            </div>
            
            <div className="flex gap-2 justify-end mt-6">
              <button
                onClick={() => setShowSessionSettingsModal(false)}
                className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400">
                Annuler
              </button>
              <button
                onClick={saveSessionSettings}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Paramètres Site */}
      {showSiteSettingsModal && selectedSiteSettings && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[500px]">
            <h3 className="text-xl font-bold mb-4">⚙️ Paramètres du Site</h3>
            
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Nom du site / collection *</label>
                <input
                  type="text"
                  value={selectedSiteSettings.name}
                  onChange={(e) => setSelectedSiteSettings({...selectedSiteSettings, name: e.target.value})}
                  className="w-full px-3 py-2 border rounded"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">URL du site *</label>
                <input
                  type="text"
                  value={selectedSiteSettings.url}
                  onChange={(e) => setSelectedSiteSettings({...selectedSiteSettings, url: e.target.value})}
                  className="w-full px-3 py-2 border rounded"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Type de moissonneur *</label>
                <select
                  value={selectedSiteSettings.site_type}
                  onChange={(e) => setSelectedSiteSettings({...selectedSiteSettings, site_type: e.target.value})}
                  className="w-full px-3 py-2 border rounded">
                  <option value="Generic">Moissonneur générique</option>
                  <option value="Pattern-based">Moissonneur JORADP</option>
                  <option value="Javascript">Moissonneur JavaScript (Selenium)</option>
                </select>
              </div>
              
              <div className="border-t pt-3 mt-3">
                <h4 className="font-medium mb-2">Paramètres techniques</h4>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Workers parallèles</label>
                <input
                  type="number"
                  value={selectedSiteSettings.workers_parallel}
                  onChange={(e) => setSelectedSiteSettings({...selectedSiteSettings, workers_parallel: parseInt(e.target.value)})}
                  className="w-full px-3 py-2 border rounded"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Timeout (secondes)</label>
                <input
                  type="number"
                  value={selectedSiteSettings.timeout_seconds}
                  onChange={(e) => setSelectedSiteSettings({...selectedSiteSettings, timeout_seconds: parseInt(e.target.value)})}
                  className="w-full px-3 py-2 border rounded"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Délai entre requêtes (sec)</label>
                <input
                  type="number"
                  step="0.1"
                  value={selectedSiteSettings.delay_between_requests}
                  onChange={(e) => setSelectedSiteSettings({...selectedSiteSettings, delay_between_requests: parseFloat(e.target.value)})}
                  className="w-full px-3 py-2 border rounded"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Délai avant retry (sec)</label>
                <input
                  type="number"
                  step="0.1"
                  value={selectedSiteSettings.delay_before_retry}
                  onChange={(e) => setSelectedSiteSettings({...selectedSiteSettings, delay_before_retry: parseFloat(e.target.value)})}
                  className="w-full px-3 py-2 border rounded"
                />
              </div>
            </div>
            
            <div className="flex gap-2 justify-end mt-6">
              <button
                onClick={() => setShowSiteSettingsModal(false)}
                className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400">
                Annuler
              </button>
              <button
                onClick={saveSiteSettings}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Métadonnées Document */}
      {showMetadataModal && selectedDocMetadata && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-white rounded-lg p-6 w-[800px] my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">📄 Métadonnées du Document</h3>
              <button
                onClick={() => setShowMetadataModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl">
                ×
              </button>
            </div>
            
            {/* Informations de base */}
            <div className="mb-4 p-4 bg-gray-50 rounded">
              <h4 className="font-medium mb-2">Informations générales</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="font-medium">Numéro :</span> {selectedDocMetadata.numero}</div>
                <div><span className="font-medium">Date :</span> {selectedDocMetadata.date || 'Non disponible'}</div>
                <div><span className="font-medium">Taille :</span> {selectedDocMetadata.size_kb} KB</div>
                <div><span className="font-medium">ID :</span> {selectedDocMetadata.id}</div>
              </div>
              <div className="mt-2 text-sm">
                <span className="font-medium">URL :</span> 
                <a href={selectedDocMetadata.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline ml-2">
                  {selectedDocMetadata.url}
                </a>
              </div>
            </div>

            {/* Statuts */}
            <div className="mb-4 p-4 bg-gray-50 rounded">
              <h4 className="font-medium mb-2">Statuts</h4>
              <div className="flex gap-4 text-sm">
                <div>✓ Collecté : {selectedDocMetadata.statuts?.collected ? '✅' : '⏳'}</div>
                <div>✓ Téléchargé : {selectedDocMetadata.statuts?.downloaded ? '✅' : '⏳'}</div>
                <div>✓ Analysé : {selectedDocMetadata.statuts?.analyzed ? '✅' : '⏳'}</div>
              </div>
            </div>

            {/* Analyse IA */}
            <div className="mb-4 p-4 bg-purple-50 rounded">
              <h4 className="font-medium mb-2">🤖 Analyse IA</h4>

              {selectedDocMetadata.statuts?.analyzed ? (
                <>
                  <div className="mb-3">
                    <span className="font-medium text-sm">Résumé :</span>
                    <p className="text-sm mt-1 whitespace-pre-wrap">{selectedDocMetadata.summary || 'Non disponible'}</p>
                  </div>

                  <div className="mb-3">
                    <span className="font-medium text-sm">Mots-clés :</span>
                    {selectedDocMetadata.keywords ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {selectedDocMetadata.keywords.split(',').map((kw, i) => (
                          <span key={i} className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">
                            {kw.trim()}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm mt-1 text-gray-500">Non disponible</p>
                    )}
                  </div>

                  <div className="mb-3">
                    <span className="font-medium text-sm">Entités nommées :</span>
                    <p className="text-sm mt-1 whitespace-pre-wrap">{selectedDocMetadata.named_entities || 'Non disponible'}</p>
                  </div>
                </>
              ) : (
                <p className="text-sm text-gray-500 italic">Document non encore analysé. Utilisez le bouton "Analyser IA" pour lancer l'analyse.</p>
              )}
            </div>

            {/* Embedding */}
            {selectedDocMetadata.embedding && (
              <div className="mb-4 p-4 bg-green-50 rounded">
                <h4 className="font-medium mb-2">🔢 Embedding</h4>
                <div className="text-sm">
                  <div>Modèle : {selectedDocMetadata.embedding.model}</div>
                  <div>Dimension : {selectedDocMetadata.embedding.dimension}</div>
                  <div className="text-xs text-gray-600 mt-1">
                    Vecteur généré pour recherche sémantique
                  </div>
                </div>
              </div>
            )}
            
            <button
              onClick={() => setShowMetadataModal(false)}
              className="w-full px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600">
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* Modal Moissonnage Avancé */}
      {showAdvancedHarvestModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[500px]">
            <h3 className="text-xl font-bold mb-4">Moissonnage Incrémental</h3>
            
            <p className="text-sm text-gray-600 mb-4">
              Laissez vide pour moissonner depuis le dernier document. Renseignez dates OU numéros pour un moissonnage ciblé.
            </p>

            {/* Période par dates */}
            <div className="mb-4">
              <div className="mb-4 p-4 bg-gray-50 rounded">
                <h4 className="font-medium mb-3">Période de moissonnage</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm mb-1">Date début *</label>
                    <input
                      type="date"
                      value={advancedHarvestParams.date_debut}
                      onChange={(e) => setAdvancedHarvestParams({...advancedHarvestParams, date_debut: e.target.value})}
                      className="w-full px-2 py-1 border rounded text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm mb-1">Date fin (optionnel)</label>
                    <input
                      type="date"
                      value={advancedHarvestParams.date_fin}
                      onChange={(e) => setAdvancedHarvestParams({...advancedHarvestParams, date_fin: e.target.value})}
                      placeholder="Aujourd'hui si vide"
                      className="w-full px-2 py-1 border rounded text-sm"
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-600 mt-2">
                  Si date fin non spécifiée, moissonne jusqu'à aujourd'hui
                </p>
              </div>
            </div>

            {/* Période par numéros */}
            <div className="mb-4">
              <div className="mb-4 p-4 bg-gray-50 rounded">
                <h4 className="font-medium mb-3">Moissonnage par numéro</h4>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm mb-1">Année *</label>
                    <input
                      type="number"
                      value={advancedHarvestParams.year}
                      onChange={(e) => setAdvancedHarvestParams({...advancedHarvestParams, year: parseInt(e.target.value)})}
                      className="w-full px-2 py-1 border rounded text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm mb-1">Numéro début *</label>
                    <input
                      type="number"
                      value={advancedHarvestParams.start_num}
                      onChange={(e) => setAdvancedHarvestParams({...advancedHarvestParams, start_num: parseInt(e.target.value)})}
                      className="w-full px-2 py-1 border rounded text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm mb-1">Numéro fin (opt.)</label>
                    <input
                      type="number"
                      value={advancedHarvestParams.end_num}
                      onChange={(e) => setAdvancedHarvestParams({...advancedHarvestParams, end_num: e.target.value ? parseInt(e.target.value) : ''})}
                      placeholder="Jusqu'à la fin"
                      className="w-full px-2 py-1 border rounded text-sm"
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-600 mt-2">
                  Si numéro fin non spécifié, moissonne jusqu'à trouver 5 erreurs 404 consécutives
                </p>
              </div>
            </div>
            
            {/* Boutons */}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowAdvancedHarvestModal(false);
                  setAdvancedHarvestParams({
                    mode: 'entre_dates',
                    date_debut: '',
                    date_fin: '',
                    year: new Date().getFullYear(),
                    start_num: 1,
                    end_num: ''
                  });
                }}
                className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400">
                Annuler
              </button>
              <button
                onClick={executeAdvancedHarvest}
                className="px-4 py-2 bg-indigo-500 text-white rounded hover:bg-indigo-600">
                Lancer
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
      <Modal
        isOpen={modalState.isOpen}
        onClose={closeModal}
        onConfirm={modalState.onConfirm}
        title={modalState.title}
        message={modalState.message}
        type={modalState.type}
        confirmText={modalState.confirmText}
        cancelText={modalState.cancelText}
        showCancel={modalState.showCancel}
      />
    </>
  );
};

export default HierarchicalView;
