// ============================================
// classroom/classroomService.js
// Service layer for classroom timetable matching
// Orchestrates configuration, caching, parsing, and matching
// ============================================

// Import timetable modules (loaded via script tags in content.js)
/* global parseGoogleSheetsUrl, isValidGoogleSheetsUrl */
/* global fetchTimetableSourceWithSelection */
/* global parseTimetable */
/* global normalizeTimetableEntry, validateTimetableEntry */
/* global buildTimetableIndex, matchClassToTimetable */
/* global normalizeBatch */

const CLASSROOM_CONFIG_KEY = 'classroomConfig';
const CLASSROOM_CACHE_KEY = 'classroomTimetableCache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Result states
const ClassroomResultStatus = {
  MATCHED: 'MATCHED',
  NO_CANDIDATES: 'NO_CANDIDATES',
  AMBIGUOUS_MATCH: 'AMBIGUOUS_MATCH',
  MISSING_CLASSROOM: 'MISSING_CLASSROOM',
  GROUP_CONFLICT: 'GROUP_CONFLICT',
  TIMETABLE_UNAVAILABLE: 'TIMETABLE_UNAVAILABLE',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  EVENT_DATA_PENDING: 'EVENT_DATA_PENDING',
  STALE_CACHE: 'STALE_CACHE',
};

// Service state
let _timetableIndex = null;
let _timetableEntries = null;
let _config = null;
let _debugMode = false;
let _cacheInvalidated = false;

/**
 * Load classroom configuration from chrome.storage.sync
 * @returns {Promise<Object>} Configuration object
 */
async function loadConfiguration() {
  try {
    const result = await chrome.storage.sync.get(CLASSROOM_CONFIG_KEY);
    _config = result[CLASSROOM_CONFIG_KEY] || {
      classroomInfoEnabled: false,
      timetableUrl: '',
      group: '',
    };
    return _config;
  } catch (error) {
    console.error('[Scaler++] Classroom config load failed:', error);
    return {
      classroomInfoEnabled: false,
      timetableUrl: '',
      group: '',
    };
  }
}

/**
 * Save classroom configuration to chrome.storage.sync
 * @param {Object} config - Configuration to save
 * @returns {Promise<void>}
 */
async function saveConfiguration(config) {
  try {
    await chrome.storage.sync.set({ [CLASSROOM_CONFIG_KEY]: config });
    _config = config;
    // Invalidate cache when configuration changes
    await invalidateCache();
  } catch (error) {
    console.error('[Scaler++] Classroom config save failed:', error);
  }
}

/**
 * Load cached timetable from chrome.storage.local
 * @returns {Promise<Object|null>} Cached timetable or null
 */
async function loadCachedTimetable() {
  try {
    const result = await chrome.storage.local.get(CLASSROOM_CACHE_KEY);
    const cached = result[CLASSROOM_CACHE_KEY];
    if (!cached) return null;

    const now = Date.now();
    const isFresh = (now - cached.fetchedAt) < CACHE_TTL_MS;

    if (_debugMode) {
      console.log('[Scaler++ Classroom] Cache check:', {
        fetchedAt: new Date(cached.fetchedAt).toISOString(),
        age: Math.floor((now - cached.fetchedAt) / 1000 / 60) + ' minutes',
        isFresh,
        sourceUrl: cached.sourceUrl,
      });
    }

    return { ...cached, isFresh };
  } catch (error) {
    console.error('[Scaler++] Classroom cache load failed:', error);
    return null;
  }
}

/**
 * Save timetable to chrome.storage.local
 * @param {Object} data - Timetable data to cache
 * @returns {Promise<void>}
 */
async function saveCachedTimetable(data) {
  try {
    const cacheEntry = {
      ...data,
      fetchedAt: Date.now(),
    };
    await chrome.storage.local.set({ [CLASSROOM_CACHE_KEY]: cacheEntry });

    if (_debugMode) {
      console.log('[Scaler++ Classroom] Timetable cached:', {
        entries: data.entries?.length,
        sourceUrl: data.sourceUrl,
      });
    }
  } catch (error) {
    console.error('[Scaler++] Classroom cache save failed:', error);
  }
}

/**
 * Invalidate the timetable cache
 * @returns {Promise<void>}
 */
async function invalidateCache() {
  try {
    await chrome.storage.local.remove(CLASSROOM_CACHE_KEY);
    _timetableIndex = null;
    _timetableEntries = null;
    _cacheInvalidated = true;

    if (_debugMode) {
      console.log('[Scaler++ Classroom] Cache invalidated');
    }
  } catch (error) {
    console.error('[Scaler++] Classroom cache invalidation failed:', error);
  }
}

/**
 * Fetch and parse timetable from configured URL
 * @param {Object} config - Configuration with timetableUrl
 * @returns {Promise<Object>} Parsed timetable data
 */
async function fetchTimetable(config) {
  if (!config || !config.timetableUrl) {
    return {
      status: ClassroomResultStatus.NOT_CONFIGURED,
      error: 'No timetable URL configured',
    };
  }

  // Parse URL
  const parsedUrl = parseGoogleSheetsUrl(config.timetableUrl);
  if (!parsedUrl || !isValidGoogleSheetsUrl(parsedUrl)) {
    return {
      status: ClassroomResultStatus.TIMETABLE_UNAVAILABLE,
      error: 'Invalid Google Sheets URL',
    };
  }

  // Fetch with intelligent source selection
  let source;
  try {
    source = await fetchTimetableSourceWithSelection(parsedUrl, true);
  } catch (error) {
    return {
      status: ClassroomResultStatus.TIMETABLE_UNAVAILABLE,
      error: error.message,
    };
  }

  // Parse timetable
  const parseResult = parseTimetable(source);
  if (parseResult.errors.length > 0) {
    console.warn('[Scaler++ Classroom] Parse errors:', parseResult.errors);
  }

  // Normalize entries
  const normalizedEntries = parseResult.entries.map(entry =>
    normalizeTimetableEntry(entry)
  );

  // Validate entries
  const validEntries = normalizedEntries.filter(entry =>
    validateTimetableEntry(entry)
  );

  // Build index
  const index = buildTimetableIndex(validEntries);

  const timetableData = {
    sourceUrl: config.timetableUrl,
    spreadsheetId: parsedUrl.spreadsheetId,
    gid: parsedUrl.gid,
    entries: validEntries,
    metadata: parseResult.metadata || {},
  };

  // Cache the result
  await saveCachedTimetable({
    ...timetableData,
    index,
  });

  _timetableEntries = validEntries;
  _timetableIndex = index;

  return {
    status: ClassroomResultStatus.MATCHED,
    timetable: timetableData,
    index,
  };
}

/**
 * Get or refresh timetable data
 * @param {boolean} forceRefresh - Force refresh even if cache is fresh
 * @returns {Promise<Object>} Timetable data with status
 */
async function getTimetableData(forceRefresh = false) {
  const config = await loadConfiguration();

  if (!config.classroomInfoEnabled) {
    return {
      status: ClassroomResultStatus.NOT_CONFIGURED,
      error: 'Classroom feature is disabled',
    };
  }

  if (!config.timetableUrl) {
    return {
      status: ClassroomResultStatus.NOT_CONFIGURED,
      error: 'No timetable URL configured',
    };
  }

  // Check cache first
  const cached = await loadCachedTimetable();
  
  if (cached && !forceRefresh && cached.isFresh) {
    // Use fresh cache
    _timetableEntries = cached.entries;
    _timetableIndex = cached.index;

    if (_debugMode) {
      console.log('[Scaler++ Classroom] Using fresh cache');
    }

    return {
      status: ClassroomResultStatus.MATCHED,
      timetable: cached,
      index: cached.index,
      fromCache: true,
    };
  }

  // Cache is stale or missing, fetch fresh data
  if (_debugMode) {
    console.log('[Scaler++ Classroom] Fetching fresh timetable');
  }

  const fetchResult = await fetchTimetable(config);

  if (fetchResult.status === ClassroomResultStatus.TIMETABLE_UNAVAILABLE && cached) {
    // Fetch failed but we have stale cache
    _timetableEntries = cached.entries;
    _timetableIndex = cached.index;

    return {
      status: ClassroomResultStatus.STALE_CACHE,
      error: fetchResult.error,
      timetable: cached,
      index: cached.index,
      fromCache: true,
    };
  }

  return fetchResult;
}

/**
 * Get classroom for a Scaler class
 * @param {Object} scalerClass - Canonical Scaler class
 * @param {Object} options - Options including userGroup
 * @returns {Promise<Object>} Classroom result
 */
async function getClassroomForClass(scalerClass, options = {}) {
  if (!scalerClass) {
    return {
      status: ClassroomResultStatus.EVENT_DATA_PENDING,
      error: 'No Scaler class data',
    };
  }

  // Ensure timetable is loaded
  const timetableResult = await getTimetableData();
  
  if (timetableResult.status === ClassroomResultStatus.NOT_CONFIGURED) {
    return timetableResult;
  }

  if (timetableResult.status === ClassroomResultStatus.TIMETABLE_UNAVAILABLE) {
    return timetableResult;
  }

  if (!timetableResult.index) {
    return {
      status: ClassroomResultStatus.TIMETABLE_UNAVAILABLE,
      error: 'No timetable index available',
    };
  }

  // Extract group from Scaler event
  const eventGroup = scalerClass.batch || scalerClass.group || null;
  const userGroup = options.userGroup || null;

  // Check for group conflict
  if (eventGroup && userGroup) {
    const normalizedEventGroup = normalizeBatch(eventGroup);
    const normalizedUserGroup = normalizeBatch(userGroup);
    if (normalizedEventGroup !== normalizedUserGroup) {
      if (_debugMode) {
        console.log('[Scaler++ Classroom] Group conflict:', {
          eventGroup,
          userGroup,
          normalizedEventGroup,
          normalizedUserGroup,
        });
      }
      return {
        status: ClassroomResultStatus.GROUP_CONFLICT,
        error: `Group conflict: event has "${eventGroup}" but configured group is "${userGroup}"`,
        eventGroup,
        userGroup,
      };
    }
  }

  // Use event group first, then user group
  const effectiveGroup = eventGroup || userGroup;

  // Match against timetable
  const matchResult = matchClassToTimetable(scalerClass, {
    timetableIndex: timetableResult.index,
    userGroup: effectiveGroup,
    debug: _debugMode,
  });

  if (_debugMode) {
    console.log('[Scaler++ Classroom] Match result:', {
      classId: scalerClass.classId,
      course: scalerClass.course,
      group: effectiveGroup,
      status: matchResult.status,
      classroom: matchResult.classroom,
      score: matchResult.score,
    });
  }

  return matchResult;
}

/**
 * Enable or disable debug mode
 * @param {boolean} enabled - Whether debug mode is enabled
 */
function setDebugMode(enabled) {
  _debugMode = enabled;
}

/**
 * Check if cache has been invalidated
 * @returns {boolean} True if cache was invalidated
 */
function wasCacheInvalidated() {
  const result = _cacheInvalidated;
  _cacheInvalidated = false;
  return result;
}

/**
 * Reset service state (for testing)
 */
function resetService() {
  _timetableIndex = null;
  _timetableEntries = null;
  _config = null;
  _cacheInvalidated = false;
}

// Export for use in content script
window.ClassroomService = {
  loadConfiguration,
  saveConfiguration,
  getTimetableData,
  getClassroomForClass,
  invalidateCache,
  setDebugMode,
  wasCacheInvalidated,
  resetService,
  ClassroomResultStatus,
};
