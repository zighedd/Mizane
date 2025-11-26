import React, { useMemo, useState, useEffect } from 'react';
import { Search } from 'lucide-react';

const LANGUAGE_OPTIONS = [
  { key: 'ar', label: 'Arabe' },
  { key: 'fr', label: 'Français' },
  { key: 'both', label: 'Les deux' },
];

const CoursSupremeSearchPanel = ({
  searchTerm,
  setSearchTerm,
  onSearch,
  showAdvancedSearch,
  setShowAdvancedSearch,
  filters,
  setFilters,
  languageScope,
  setLanguageScope,
  onAdvancedSearch,
  onReset,
  searchResultsCount,
  isSearching = false
  ,
  semanticLimit,
  setSemanticLimit,
  semanticThreshold,
  setSemanticThreshold,
  availableChambers = [],
  availableThemes = [],
  resetCounter = 0
}) => {
  const [themeOrQuery, setThemeOrQuery] = useState('');
  const [themeIncQuery, setThemeIncQuery] = useState('');

  const hasFilters = Boolean(
    searchTerm ||
    filters.keywordsInclusive ||
    filters.keywordsOr ||
    filters.keywordsExclusive ||
    filters.decisionNumber ||
    filters.dateFrom ||
    filters.dateTo ||
    (filters.chambersInclusive && filters.chambersInclusive.length) ||
    (filters.chambersOr && filters.chambersOr.length) ||
    (filters.themesInclusive && filters.themesInclusive.length) ||
    (filters.themesOr && filters.themesOr.length)
  );

  const filterThemes = (query) => {
    if (!query) return availableThemes.slice(0, 10);
    const lower = query.toLowerCase();
    return availableThemes
      .filter((theme) =>
        (theme.name_ar && theme.name_ar.includes(query)) ||
        (theme.name_fr && theme.name_fr.toLowerCase().includes(lower))
      )
      .slice(0, 10);
  };

  // availableThemes est stable dans ce composant; on ne dépend que des requêtes et de la fonction.
  const themeSuggestionsOr = useMemo(() => filterThemes(themeOrQuery), [themeOrQuery, filterThemes]);
  const themeSuggestionsInc = useMemo(() => filterThemes(themeIncQuery), [themeIncQuery, filterThemes]);

  const displayThemeLabel = (theme) => theme?.name_fr || theme?.name_ar || `Thème ${theme?.id}`;

  const addTheme = (id, mode) => {
    const key = mode === 'inc' ? 'themesInclusive' : 'themesOr';
    const already = new Set(filters[key] || []);
    if (already.has(id)) return;
    already.add(id);
    setFilters({ ...filters, [key]: Array.from(already) });
    if (mode === 'inc') {
      setThemeIncQuery('');
    } else {
      setThemeOrQuery('');
    }
  };

  const removeTheme = (id, mode) => {
    const key = mode === 'inc' ? 'themesInclusive' : 'themesOr';
    const updated = (filters[key] || []).filter((value) => value !== id);
    setFilters({ ...filters, [key]: updated });
  };

  const toggleChamber = (id, mode) => {
    const key = mode === 'inc' ? 'chambersInclusive' : 'chambersOr';
    const current = new Set(filters[key] || []);
    if (current.has(id)) {
      current.delete(id);
    } else {
      current.add(id);
    }
    setFilters({ ...filters, [key]: Array.from(current) });
  };

  useEffect(() => {
    // Après un reset, on vide les champs locaux d'autocomplétion.
    setThemeOrQuery('');
    setThemeIncQuery('');
  }, [resetCounter]);

  const ensureQueryThemesAdded = (nextFilters) => {
    const hydrate = (query, mode, suggestions) => {
      if (!query) return;
      const trimmed = query.trim();
      if (!trimmed) return;
      const lower = trimmed.toLowerCase();
      const exact = suggestions.find((t) =>
        (t.name_fr && t.name_fr.toLowerCase() === lower) ||
        (t.name_ar && t.name_ar.trim() === trimmed)
      );
      const match = exact || suggestions[0];
      if (!match) return;
      const key = mode === 'inc' ? 'themesInclusive' : 'themesOr';
      const set = new Set(nextFilters[key] || []);
      set.add(match.id);
      nextFilters[key] = Array.from(set);
    };
    hydrate(themeOrQuery, 'or', themeSuggestionsOr);
    hydrate(themeIncQuery, 'inc', themeSuggestionsInc);
  };

  const handleSubmit = () => {
    const nextFilters = { ...filters };
    ensureQueryThemesAdded(nextFilters);
    setFilters(nextFilters);
    onAdvancedSearch({ filters: nextFilters });
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border p-4 mb-4">
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <input
          type="text"
          placeholder="Recherche sémantique, tapez ce que vous souhaitez"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1 border rounded-lg px-4 py-2 min-w-[200px]"
        />
        <button
          onClick={onSearch}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all flex items-center gap-2"
        >
          <Search className="w-4 h-4" />
          Rechercher
        </button>
        {hasFilters && onReset && (
          <button
            onClick={onReset}
            className="px-4 py-2 bg-gray-200 rounded-lg text-xs font-medium"
          >
            Effacer
          </button>
        )}
        <div className="flex-1 flex items-center justify-end gap-2 text-xs text-gray-500">
          {isSearching && (
            <span
              className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"
              role="status"
              aria-label="Recherche en cours"
            />
          )}
          <span>
            {typeof searchResultsCount === 'number'
              ? `${searchResultsCount} décision(s) trouvée(s)`
              : 'Aucun résultat calculé pour l’instant'}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-gray-500 mt-2">
        <label className="flex flex-col text-gray-600">
          Limite sémantique
          <input
            type="number"
            min="1"
            max="50"
            value={semanticLimit}
            onChange={(e) => setSemanticLimit(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
            className="mt-1 w-24 border rounded px-2 py-1 text-xs"
          />
        </label>
        <label className="flex flex-col text-gray-600">
          Seuil minimal
          <input
            type="number"
            step="0.01"
            min="0"
            max="1"
            value={semanticThreshold}
            onChange={(e) => setSemanticThreshold(Math.min(1, Math.max(0, Number(e.target.value) || 0)))}
            className="mt-1 w-24 border rounded px-2 py-1 text-xs"
          />
        </label>
      </div>

      <button
        onClick={() => setShowAdvancedSearch(!showAdvancedSearch)}
        className="text-blue-600 hover:text-blue-800 text-sm font-medium"
      >
        {showAdvancedSearch ? '▼ Masquer recherche avancée' : '▶ Recherche avancée'}
      </button>

      {showAdvancedSearch && (
        <div className="bg-gray-50 rounded-lg p-4 space-y-3 mt-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mots-clés inclusifs (ET)</label>
              <input
                type="text"
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="ex: مرور حادث"
                value={filters.keywordsInclusive}
                onChange={(e) => setFilters({ ...filters, keywordsInclusive: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mots-clés alternatifs (OU)</label>
              <input
                type="text"
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="ex: حادث|حريق"
                value={filters.keywordsOr}
                onChange={(e) => setFilters({ ...filters, keywordsOr: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mots-clés exclusifs (NON)</label>
              <input
                type="text"
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="ex: استئناف"
                value={filters.keywordsExclusive}
                onChange={(e) => setFilters({ ...filters, keywordsExclusive: e.target.value })}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm font-medium text-gray-700">Langue de recherche :</span>
            {LANGUAGE_OPTIONS.map((option) => (
              <button
                key={option.key}
                onClick={() => setLanguageScope(option.key)}
                className={`px-3 py-1 text-xs font-medium rounded-full border ${
                  languageScope === option.key
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Numéro de décision</label>
              <input
                type="text"
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="ex: 00001"
                value={filters.decisionNumber}
                onChange={(e) => setFilters({ ...filters, decisionNumber: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date début</label>
              <input
                type="text"
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="JJ/MM/AAAA ou AAAA"
                value={filters.dateFrom}
                onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date fin</label>
              <input
                type="text"
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="JJ/MM/AAAA ou AAAA"
                value={filters.dateTo}
                onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-3">
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Chambres (OU)</p>
              <div className="flex flex-wrap gap-2">
                {availableChambers.map((chamber) => (
                  <label key={`or-${chamber.id}`} className="flex items-center gap-2 text-sm bg-gray-50 border rounded px-2 py-1">
                    <input
                      type="checkbox"
                      className="w-4 h-4"
                      checked={(filters.chambersOr || []).includes(chamber.id)}
                      onChange={() => toggleChamber(chamber.id, 'or')}
                    />
                    <span>{chamber.name_fr || chamber.name_ar || `Chambre ${chamber.id}`}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Chambres (ET)</p>
              <div className="flex flex-wrap gap-2">
                {availableChambers.map((chamber) => (
                  <label key={`inc-${chamber.id}`} className="flex items-center gap-2 text-sm bg-gray-50 border rounded px-2 py-1">
                    <input
                      type="checkbox"
                      className="w-4 h-4"
                      checked={(filters.chambersInclusive || []).includes(chamber.id)}
                      onChange={() => toggleChamber(chamber.id, 'inc')}
                    />
                    <span>{chamber.name_fr || chamber.name_ar || `Chambre ${chamber.id}`}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-3">
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1">Thèmes (OU)</p>
              <input
                type="text"
                className="w-full px-3 py-2 border rounded-lg text-sm mb-2"
                placeholder="Rechercher un thème..."
                value={themeOrQuery}
                onChange={(e) => setThemeOrQuery(e.target.value)}
              />
              {!!(filters.themesOr || []).length && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {filters.themesOr.map((id) => {
                    const theme = availableThemes.find((t) => t.id === id);
                    return (
                      <span key={`sel-or-${id}`} className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs flex items-center gap-2">
                        {displayThemeLabel(theme)}
                        <button onClick={() => removeTheme(id, 'or')} className="text-blue-600 hover:text-blue-800">×</button>
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="bg-gray-50 rounded border max-h-32 overflow-y-auto">
                {themeSuggestionsOr.map((theme) => (
                  <button
                    key={`sug-or-${theme.id}`}
                    onClick={() => addTheme(theme.id, 'or')}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-white"
                  >
                    {displayThemeLabel(theme)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1">Thèmes (ET)</p>
              <input
                type="text"
                className="w-full px-3 py-2 border rounded-lg text-sm mb-2"
                placeholder="Rechercher un thème..."
                value={themeIncQuery}
                onChange={(e) => setThemeIncQuery(e.target.value)}
              />
              {!!(filters.themesInclusive || []).length && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {filters.themesInclusive.map((id) => {
                    const theme = availableThemes.find((t) => t.id === id);
                    return (
                      <span key={`sel-inc-${id}`} className="px-3 py-1 bg-green-50 text-green-700 rounded-full text-xs flex items-center gap-2">
                        {displayThemeLabel(theme)}
                        <button onClick={() => removeTheme(id, 'inc')} className="text-green-600 hover:text-green-800">×</button>
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="bg-gray-50 rounded border max-h-32 overflow-y-auto">
                {themeSuggestionsInc.map((theme) => (
                  <button
                    key={`sug-inc-${theme.id}`}
                    onClick={() => addTheme(theme.id, 'inc')}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-white"
                  >
                    {displayThemeLabel(theme)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-2">
            <button
              type="button"
              onClick={handleSubmit}
              className="flex-1 min-w-[180px] py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-center"
            >
              Rechercher avec filtres
            </button>
            {onReset && (
              <button
                type="button"
                onClick={onReset}
                className="flex-1 min-w-[180px] py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 font-medium text-center"
              >
                Réinitialiser les filtres
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CoursSupremeSearchPanel;
