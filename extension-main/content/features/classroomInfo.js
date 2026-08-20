// ============================================
// features/classroomInfo.js
// Adds classroom information to dashboard class cards
// Uses timetable matching to display classroom location
// ============================================

(function(global) {
const CLASSROOM_CONTAINER_CLASS = 'scaler-classroom-info';
const CLASSROOM_TAG_CLASS = 'scaler-classroom-tag';
const CLASSROOM_DATA_ATTR = 'data-scaler-classroom-processed';
const CLASSROOM_CACHE_ATTR = 'data-scaler-classroom-cache-key';

const _classroomCache = new Map();
let _debugMode = false;
let _observer = null;
let _timetableLoaded = false;

function _isTodosDashboard() {
  return location.href.includes('/academy/mentee-dashboard/todos');
}

function _extractClassId(href) {
  if (!href) return null;
  const match = href.match(/\/class\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Build a development-only classroom indicator
 * @param {string} classroom - Classroom text
 * @param {Object} result - Full match result
 * @returns {Element} Indicator element
 */
function _buildClassroomIndicator(classroom, result) {
  const container = document.createElement('div');
  container.className = CLASSROOM_CONTAINER_CLASS;
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.style.gap = '6px';
  container.style.padding = '4px 8px';
  container.style.marginTop = '4px';
  container.style.backgroundColor = 'rgba(76, 175, 80, 0.1)';
  container.style.borderRadius = '4px';
  container.style.border = '1px solid rgba(76, 175, 80, 0.3)';
  container.style.fontSize = '11px';
  container.style.color = '#2e7d32';

  const label = document.createElement('span');
  label.textContent = '[Classroom: ';
  label.style.fontWeight = '600';

  const value = document.createElement('span');
  value.textContent = classroom;
  value.style.fontWeight = '400';

  const endLabel = document.createElement('span');
  endLabel.textContent = ']';

  container.appendChild(label);
  container.appendChild(value);
  container.appendChild(endLabel);

  // Add debug info as title
  if (_debugMode && result) {
    container.title = JSON.stringify({
      status: result.status,
      score: result.score,
      course: result.debugInfo?.course,
      group: result.debugInfo?.group,
      time: result.debugInfo?.time,
    }, null, 2);
  }

  return container;
}

/**
 * Check if a card has already been processed with current cache key
 * @param {Element} card - Card element
 * @param {string} cacheKey - Current cache key
 * @returns {boolean} True if already processed with current cache
 */
function _isCardProcessed(card, cacheKey) {
  const existingCacheKey = card.getAttribute(CLASSROOM_CACHE_ATTR);
  return existingCacheKey === cacheKey;
}

/**
 * Mark a card as processed
 * @param {Element} card - Card element
 * @param {string} cacheKey - Current cache key
 */
function _markCardProcessed(card, cacheKey) {
  card.setAttribute(CLASSROOM_CACHE_ATTR, cacheKey);
  card.setAttribute(CLASSROOM_DATA_ATTR, 'true');
}

/**
 * Clear classroom processing markers from a card
 * @param {Element} card - Card element
 */
function _clearCardProcessing(card) {
  card.removeAttribute(CLASSROOM_CACHE_ATTR);
  card.removeAttribute(CLASSROOM_DATA_ATTR);
}

/**
 * Remove existing classroom indicator from a card
 * @param {Element} card - Card element
 */
function _removeExistingIndicator(card) {
  const existing = card.querySelector(`.${CLASSROOM_CONTAINER_CLASS}`);
  if (existing) {
    existing.remove();
  }
}

/**
 * Apply classroom result to a card
 * @param {Element} card - Card element
 * @param {Object} result - Classroom match result
 * @param {string} cacheKey - Current cache key
 */
function _applyClassroomResult(card, result, cacheKey) {
  // Remove existing indicator
  _removeExistingIndicator(card);

  if (result.status !== window.ClassroomService.ClassroomResultStatus.MATCHED) {
    if (_debugMode) {
      console.log('[Scaler++ Classroom] No classroom for card:', {
        classId: card.dataset.classId,
        status: result.status,
        error: result.error,
      });
    }
    return;
  }

  if (!result.classroom) {
    if (_debugMode) {
      console.log('[Scaler++ Classroom] Matched but no classroom:', {
        classId: card.dataset.classId,
        status: result.status,
      });
    }
    return;
  }

  // Build and inject indicator
  const indicator = _buildClassroomIndicator(result.classroom, result);
  
  const header = card.querySelector('.mentee-card__header');
  if (header) {
    header.appendChild(indicator);
  }

  // Mark as processed
  _markCardProcessed(card, cacheKey);

  if (_debugMode) {
    console.log('[Scaler++ Classroom] Applied classroom:', {
      classId: card.dataset.classId,
      classroom: result.classroom,
      score: result.score,
    });
  }
}

/**
 * Get canonical Scaler class from lecture map
 * @param {string} classId - Class ID
 * @param {Map} lectureMap - Lecture event map
 * @returns {Object|null} Canonical class or null
 */
function _getCanonicalClass(classId, lectureMap) {
  if (!classId || !lectureMap) return null;

  const lecture = lectureMap.get(String(classId));
  if (!lecture) return null;

  // Use existing scalerClassNormalizer if available
  if (typeof createCanonicalScalerClass === 'function') {
    return createCanonicalScalerClass(lecture);
  }

  // Fallback: basic canonicalization
  return {
    classId: String(lecture.sbat_id),
    date: lecture.date_of_topic || lecture.date,
    startTime: lecture.start_time,
    endTime: lecture.end_time,
    course: lecture.super_batch_name,
    batch: lecture.batch_name,
    teacher: lecture.instructors_name,
  };
}

/**
 * Process a single class card
 * @param {Element} card - Card element
 * @param {Map} lectureMap - Lecture event map
 * @param {string} cacheKey - Current cache key
 */
async function _processCard(card, lectureMap, cacheKey) {
  const href = card.getAttribute('href');
  const classId = _extractClassId(href);
  
  if (!classId) {
    if (_debugMode) {
      console.log('[Scaler++ Classroom] No class ID in card');
    }
    return;
  }

  // Store class ID for debugging
  card.dataset.classId = classId;

  // Check if already processed with current cache
  if (_isCardProcessed(card, cacheKey)) {
    return;
  }

  // Get canonical class from lecture map
  const canonicalClass = _getCanonicalClass(classId, lectureMap);
  
  if (!canonicalClass) {
    if (_debugMode) {
      console.log('[Scaler++ Classroom] No lecture data for class:', classId);
    }
    // Don't mark as processed - may load later
    return;
  }

  // Get classroom from service
  const result = await window.ClassroomService.getClassroomForClass(canonicalClass, {
    userGroup: null, // Will use event group
  });

  // Apply result
  _applyClassroomResult(card, result, cacheKey);
}

/**
 * Inject classroom info into all class cards
 */
async function _injectClassroomInfo() {
  if (!_isTodosDashboard()) return;

  const cards = document.querySelectorAll(
    'a.me-cr-classroom-url[data-cy="classroom-link"]'
  );
  if (!cards.length) return;

  // Load timetable data
  const timetableResult = await window.ClassroomService.getTimetableData();
  
  if (timetableResult.status === window.ClassroomService.ClassroomResultStatus.NOT_CONFIGURED) {
    if (_debugMode) {
      console.log('[Scaler++ Classroom] Not configured');
    }
    return;
  }

  _timetableLoaded = true;

  // Generate cache key based on timetable identity
  const cacheKey = timetableResult.timetable 
    ? `${timetableResult.timetable.sourceUrl}:${timetableResult.timetable.spreadsheetId}:${timetableResult.timetable.gid}`
    : 'no-timetable';

  // Fetch lecture map (reuse existing lectureInfo cache if available)
  let lectureMap = null;
  try {
    // Try to use existing lectureInfo cache
    if (typeof _fetchLectureMap === 'function') {
      lectureMap = await _fetchLectureMap();
    }
  } catch (error) {
    console.warn('[Scaler++ Classroom] Lecture map fetch failed:', error);
  }

  // Process each card
  for (const card of cards) {
    await _processCard(card, lectureMap, cacheKey);
  }
}

/**
 * Observe dashboard for class cards
 */
function _observeDashboardForClassroomInfo() {
  if (_observer) return;
  if (!_isTodosDashboard()) return;

  let debounceTimer = null;
  _observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      if (_isTodosDashboard()) {
        // Check if cache was invalidated
        if (window.ClassroomService.wasCacheInvalidated()) {
          // Clear all processing markers
          const cards = document.querySelectorAll(
            'a.me-cr-classroom-url[data-cy="classroom-link"]'
          );
          cards.forEach(card => {
            _clearCardProcessing(card);
            _removeExistingIndicator(card);
          });
        }
        await _injectClassroomInfo();
      }
    }, 300);
  });

  const root =
    document.querySelector('.mentee-dashboard__content') ||
    document.querySelector('.mentee-dashboard') ||
    document.body;

  _observer.observe(root, { childList: true, subtree: true });
}

/**
 * Teardown classroom info
 */
function _teardownClassroomInfo() {
  if (_observer) {
    _observer.disconnect();
    _observer = null;
  }
  window._classroomInfoObserver = null;

  // Remove all classroom indicators
  document.querySelectorAll(`.${CLASSROOM_CONTAINER_CLASS}`).forEach(el => el.remove());
  
  // Clear processing markers
  document.querySelectorAll(`[${CLASSROOM_DATA_ATTR}]`).forEach(el => {
    el.removeAttribute(CLASSROOM_DATA_ATTR);
    el.removeAttribute(CLASSROOM_CACHE_ATTR);
  });

  _timetableLoaded = false;
}

/**
 * Initialize classroom info feature
 */
global.initClassroomInfo = function() {
  if (_isTodosDashboard()) {
    _injectClassroomInfo();
    _observeDashboardForClassroomInfo();
  } else {
    _teardownClassroomInfo();
  }
};

/**
 * Set debug mode for classroom feature
 * @param {boolean} enabled - Whether debug mode is enabled
 */
global.setClassroomDebugMode = function(enabled) {
  _debugMode = enabled;
  window.ClassroomService.setDebugMode(enabled);
};

})(window);
