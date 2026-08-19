// ============================================
// classroom/timetableMatcher.js
// Match Scaler classes to timetable entries
// ============================================

/**
 * Default matching configuration
 */
const DEFAULT_MATCH_CONFIG = {
  timeToleranceMinutes: 5,
  minConfidenceThreshold: 0.7,
  weights: {
    time: 0.40,
    batch: 0.20,
    course: 0.25,
    teacher: 0.15
  }
};

/**
 * Convert HH:MM time to minutes since midnight.
 * 
 * @param {string} time - Time in HH:MM format
 * @returns {number|null} - Minutes since midnight or null
 */
function timeToMinutes(time) {
  if (!time || typeof time !== 'string') {
    return null;
  }
  
  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  
  return hours * 60 + minutes;
}

/**
 * Check if two times match within tolerance.
 * 
 * @param {string} time1 - First time in HH:MM format
 * @param {string} time2 - Second time in HH:MM format
 * @param {number} toleranceMinutes - Tolerance in minutes
 * @returns {boolean} - True if times match within tolerance
 */
function timesMatch(time1, time2, toleranceMinutes) {
  const minutes1 = timeToMinutes(time1);
  const minutes2 = timeToMinutes(time2);
  
  if (minutes1 === null || minutes2 === null) {
    return false;
  }
  
  const diff = Math.abs(minutes1 - minutes2);
  return diff <= toleranceMinutes;
}

/**
 * Check if two dates match exactly.
 * 
 * @param {string} date1 - First date in YYYY-MM-DD format
 * @param {string} date2 - Second date in YYYY-MM-DD format
 * @returns {boolean} - True if dates match
 */
function datesMatch(date1, date2) {
  if (!date1 || !date2) {
    return false;
  }
  
  return date1 === date2;
}

/**
 * Check if two days of week match.
 * 
 * @param {string} day1 - First day (Monday, Tuesday, etc.)
 * @param {string} day2 - Second day
 * @returns {boolean} - True if days match
 */
function daysMatch(day1, day2) {
  if (!day1 || !day2) {
    return false;
  }
  
  return day1.toLowerCase() === day2.toLowerCase();
}

/**
 * Check if batches match with flexible comparison.
 * 
 * @param {string} batch1 - First batch (e.g., "grp b")
 * @param {string} batch2 - Second batch
 * @returns {boolean} - True if batches match
 */
function batchesMatch(batch1, batch2) {
  if (!batch1 || !batch2) {
    return false;
  }
  
  const norm1 = batch1.toLowerCase().replace(/\s+/g, '');
  const norm2 = batch2.toLowerCase().replace(/\s+/g, '');
  
  return norm1 === norm2;
}

/**
 * Check if courses match with flexible comparison.
 * 
 * @param {string} course1 - First course
 * @param {string} course2 - Second course
 * @returns {boolean} - True if courses match
 */
function coursesMatch(course1, course2) {
  if (!course1 || !course2) {
    return false;
  }
  
  const norm1 = course1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const norm2 = course2.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  return norm1 === norm2;
}

/**
 * Check if teachers match with flexible comparison.
 * 
 * @param {string} teacher1 - First teacher name
 * @param {string} teacher2 - Second teacher name
 * @returns {boolean} - True if teachers match
 */
function teachersMatch(teacher1, teacher2) {
  if (!teacher1 || !teacher2) {
    return false;
  }
  
  const norm1 = teacher1.toLowerCase().trim();
  const norm2 = teacher2.toLowerCase().trim();
  
  return norm1 === norm2;
}

/**
 * Check if a timetable entry matches a Scaler class on date/day and time.
 * 
 * @param {Object} scalerClass - Canonical Scaler class
 * @param {Object} timetableEntry - Normalized timetable entry
 * @param {Object} config - Matching configuration
 * @returns {boolean} - True if date/day and time match
 */
function matchesDateTime(scalerClass, timetableEntry, config = DEFAULT_MATCH_CONFIG) {
  // Check date match (if both have dates)
  if (scalerClass.date && timetableEntry.date) {
    if (!datesMatch(scalerClass.date, timetableEntry.date)) {
      return false;
    }
  }
  
  // Check dayOfWeek match (if one or both have dayOfWeek)
  if (scalerClass.dayOfWeek && timetableEntry.dayOfWeek) {
    if (!daysMatch(scalerClass.dayOfWeek, timetableEntry.dayOfWeek)) {
      return false;
    }
  }
  
  // If neither has date/day, can't match
  if (!scalerClass.date && !scalerClass.dayOfWeek) {
    return false;
  }
  
  // Check start time
  if (!timesMatch(scalerClass.startTime, timetableEntry.startTime, config.timeToleranceMinutes)) {
    return false;
  }
  
  // Check end time
  if (!timesMatch(scalerClass.endTime, timetableEntry.endTime, config.timeToleranceMinutes)) {
    return false;
  }
  
  return true;
}

/**
 * Calculate match score between a Scaler class and timetable entry.
 * 
 * @param {Object} scalerClass - Canonical Scaler class
 * @param {Object} timetableEntry - Normalized timetable entry
 * @param {Object} config - Matching configuration
 * @returns {{score: number, reasons: Array<string>}} - Score and matching reasons
 */
function calculateMatchScore(scalerClass, timetableEntry, config = DEFAULT_MATCH_CONFIG) {
  const reasons = [];
  let score = 0;
  
  const { weights } = config;
  
  // Time/date match (mandatory for any score)
  if (matchesDateTime(scalerClass, timetableEntry, config)) {
    score += weights.time;
    reasons.push('date/time matched');
  } else {
    return { score: 0, reasons: ['date/time mismatch'] };
  }
  
  // Batch match
  if (scalerClass.batch && timetableEntry.batch && batchesMatch(scalerClass.batch, timetableEntry.batch)) {
    score += weights.batch;
    reasons.push('batch matched');
  }
  
  // Course match
  if (scalerClass.course && timetableEntry.course && coursesMatch(scalerClass.course, timetableEntry.course)) {
    score += weights.course;
    reasons.push('course matched');
  }
  
  // Teacher match
  if (scalerClass.teacher && timetableEntry.teacher && teachersMatch(scalerClass.teacher, timetableEntry.teacher)) {
    score += weights.teacher;
    reasons.push('teacher matched');
  }
  
  return { score, reasons };
}

/**
 * Find timetable entries that match date/time for a Scaler class.
 * 
 * @param {Object} scalerClass - Canonical Scaler class
 * @param {Array<Object>} timetableEntries - Normalized timetable entries
 * @param {Object} config - Matching configuration
 * @returns {Array<Object>} - Candidate entries with scores
 */
function findTimeCandidates(scalerClass, timetableEntries, config = DEFAULT_MATCH_CONFIG) {
  if (!Array.isArray(timetableEntries)) {
    return [];
  }
  
  return timetableEntries
    .map(entry => ({
      entry,
      ...calculateMatchScore(scalerClass, entry, config)
    }))
    .filter(candidate => candidate.score > 0);
}

/**
 * Select best match from candidates.
 * 
 * @param {Array<Object>} candidates - Candidate entries with scores
 * @param {Object} config - Matching configuration
 * @returns {Object} - Match result
 */
function selectBestMatch(candidates, config = DEFAULT_MATCH_CONFIG) {
  if (candidates.length === 0) {
    return {
      matched: false,
      reason: 'NO_CANDIDATES',
      candidates: []
    };
  }
  
  // Sort by score descending
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  
  const best = sorted[0];
  const secondBest = sorted[1];
  
  // Check for ambiguity: if top scores are too close
  if (secondBest && Math.abs(best.score - secondBest.score) < 0.1) {
    return {
      matched: false,
      reason: 'AMBIGUOUS_MATCH',
      candidates: sorted.slice(0, 3) // Return top 3 for debugging
    };
  }
  
  // Check if best score meets threshold
  if (best.score < config.minConfidenceThreshold) {
    return {
      matched: false,
      reason: 'LOW_CONFIDENCE',
      score: best.score,
      candidates: sorted.slice(0, 3)
    };
  }
  
  // Check if entry has classroom
  if (!best.entry.classroom || best.entry.classroom.trim() === '') {
    return {
      matched: false,
      reason: 'MISSING_CLASSROOM',
      score: best.score,
      candidates: sorted.slice(0, 3)
    };
  }
  
  return {
    matched: true,
    classroom: best.entry.classroom,
    timetableEntry: best.entry,
    score: best.score,
    reasons: best.reasons,
    candidates: sorted.slice(0, 3)
  };
}

/**
 * Build an index for efficient timetable lookup.
 * 
 * @param {Array<Object>} timetableEntries - Normalized timetable entries
 * @returns {Object} - Index structure
 */
function buildTimetableIndex(timetableEntries) {
  if (!Array.isArray(timetableEntries)) {
    return {
      byDate: new Map(),
      byDay: new Map(),
      entries: []
    };
  }
  
  const byDate = new Map();
  const byDay = new Map();
  
  timetableEntries.forEach(entry => {
    // Index by date
    if (entry.date) {
      if (!byDate.has(entry.date)) {
        byDate.set(entry.date, []);
      }
      byDate.get(entry.date).push(entry);
    }
    
    // Index by dayOfWeek
    if (entry.dayOfWeek) {
      const dayKey = entry.dayOfWeek.toLowerCase();
      if (!byDay.has(dayKey)) {
        byDay.set(dayKey, []);
      }
      byDay.get(dayKey).push(entry);
    }
  });
  
  return {
    byDate,
    byDay,
    entries: timetableEntries
  };
}

/**
 * Get candidate entries from index for a given Scaler class.
 * 
 * @param {Object} scalerClass - Canonical Scaler class
 * @param {Object} index - Timetable index
 * @returns {Array<Object>} - Candidate entries
 */
function getCandidatesFromIndex(scalerClass, index) {
  let candidates = [];
  
  // Try date-based lookup first
  if (scalerClass.date && index.byDate.has(scalerClass.date)) {
    candidates = index.byDate.get(scalerClass.date);
  }
  // Fall back to dayOfWeek lookup
  else if (scalerClass.dayOfWeek) {
    const dayKey = scalerClass.dayOfWeek.toLowerCase();
    if (index.byDay.has(dayKey)) {
      candidates = index.byDay.get(dayKey);
    }
  }
  
  return candidates;
}

/**
 * Match a Scaler class to timetable entries using index for performance.
 * 
 * @param {Object} scalerClass - Canonical Scaler class
 * @param {Object} timetableIndex - Timetable index (or raw entries)
 * @param {Object} options - Matching options
 * @returns {Object} - Match result
 */
function matchClassToTimetable(scalerClass, timetableIndex, options = {}) {
  const config = {
    ...DEFAULT_MATCH_CONFIG,
    ...options.config
  };
  
  // Check for manual override
  if (options.manualOverride && options.manualOverride.classroom) {
    return {
      matched: true,
      classroom: options.manualOverride.classroom,
      timetableEntry: null,
      score: 1.0,
      reasons: ['manual override'],
      override: true
    };
  }
  
  // Handle both raw entries and indexed structure
  let timetableEntries;
  let useIndex = false;
  
  if (timetableIndex && timetableIndex.byDate && timetableIndex.byDay) {
    // Already indexed
    timetableEntries = getCandidatesFromIndex(scalerClass, timetableIndex);
    useIndex = true;
  } else {
    // Raw entries array
    timetableEntries = timetableIndex;
  }
  
  // Find time-based candidates
  const candidates = findTimeCandidates(scalerClass, timetableEntries, config);
  
  // Select best match
  const result = selectBestMatch(candidates, config);
  
  // Add debug info
  result.debug = {
    scalerClassId: scalerClass.classId,
    totalCandidates: candidates.length,
    usedIndex: useIndex,
    config
  };
  
  return result;
}
