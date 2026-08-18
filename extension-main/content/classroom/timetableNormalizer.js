// ============================================
// classroom/timetableNormalizer.js
// Normalize parsed timetable entries to canonical schema
// ============================================

// Import schema functions (will be loaded in content script context)
// In a real implementation, these would be imported or loaded via importScripts

/**
 * Normalize a single parsed entry to the canonical schema.
 * 
 * @param {Object} parsedEntry - Parsed entry from parser
 * @returns {Object} - Normalized entry
 */
function normalizeEntry(parsedEntry) {
  const entry = {
    id: null,
    date: null,
    dayOfWeek: null,
    startTime: null,
    endTime: null,
    batch: null,
    course: null,
    topic: null,
    teacher: null,
    classroom: null,
    type: 'class',
    source: 'google-sheets',
    raw: parsedEntry.raw || null
  };
  
  // Day of week
  if (parsedEntry.dayOfWeek) {
    entry.dayOfWeek = normalizeDayOfWeek(parsedEntry.dayOfWeek);
  }
  
  // Time
  if (parsedEntry.startTime) {
    entry.startTime = normalizeTime(parsedEntry.startTime);
  }
  if (parsedEntry.endTime) {
    entry.endTime = normalizeTime(parsedEntry.endTime);
  }
  
  // Batch
  if (parsedEntry.batch) {
    entry.batch = parsedEntry.batch.trim();
  }
  
  // Course
  if (parsedEntry.course) {
    entry.course = parsedEntry.course.trim();
  }
  
  // Teacher
  if (parsedEntry.teacher) {
    entry.teacher = parsedEntry.teacher.trim();
  }
  
  // Classroom
  if (parsedEntry.classroom) {
    entry.classroom = parsedEntry.classroom.trim();
  }
  
  // Type
  if (parsedEntry.type) {
    entry.type = parsedEntry.type;
  }
  
  // Generate ID
  entry.id = generateEntryId(entry);
  
  return entry;
}

/**
 * Normalize day of week to standard format.
 * 
 * @param {string} day - Raw day string
 * @returns {string|null} - Normalized day or null
 */
function normalizeDayOfWeek(day) {
  if (!day || typeof day !== 'string') {
    return null;
  }
  
  const normalized = day.toLowerCase().trim();
  
  const dayMap = {
    'mon': 'Monday',
    'monday': 'Monday',
    'tue': 'Tuesday',
    'tuesday': 'Tuesday',
    'wed': 'Wednesday',
    'wednesday': 'Wednesday',
    'thu': 'Thursday',
    'thursday': 'Thursday',
    'fri': 'Friday',
    'friday': 'Friday',
    'sat': 'Saturday',
    'saturday': 'Saturday',
    'sun': 'Sunday',
    'sunday': 'Sunday'
  };
  
  return dayMap[normalized] || null;
}

/**
 * Normalize time string to HH:MM format.
 * 
 * @param {string} time - Raw time string
 * @returns {string|null} - Normalized time or null
 */
function normalizeTime(time) {
  if (!time || typeof time !== 'string') {
    return null;
  }
  
  const trimmed = time.trim().toLowerCase();
  
  // Already in HH:MM format
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    const parts = trimmed.split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
  }
  
  // Handle AM/PM format
  const ampmMatch = trimmed.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10);
    const minutes = parseInt(ampmMatch[2], 10);
    const meridiem = ampmMatch[3];
    
    if (meridiem === 'pm' && hours !== 12) {
      hours += 12;
    } else if (meridiem === 'am' && hours === 12) {
      hours = 0;
    }
    
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
  }
  
  return null;
}

/**
 * Generate a stable ID for a timetable entry.
 * 
 * @param {Object} entry - Normalized entry
 * @returns {string} - Stable ID
 */
function generateEntryId(entry) {
  const parts = [
    entry.dayOfWeek || '',
    entry.startTime || '',
    entry.endTime || '',
    entry.batch || '',
    entry.course || '',
    entry.teacher || ''
  ];
  
  return parts
    .filter(p => p !== null && p !== undefined && p !== '')
    .join('|')
    .toLowerCase()
    .replace(/[^a-z0-9|]/g, '');
}

/**
 * Normalize an array of parsed entries.
 * 
 * @param {Array<Object>} parsedEntries - Array of parsed entries
 * @returns {Array<Object>} - Array of normalized entries
 */
function normalizeTimetable(parsedEntries) {
  if (!Array.isArray(parsedEntries)) {
    return [];
  }
  
  return parsedEntries
    .map(entry => normalizeEntry(entry))
    .filter(entry => entry !== null);
}

/**
 * Filter entries by batch/group.
 * 
 * @param {Array<Object>} entries - Normalized entries
 * @param {string} batch - Batch to filter by
 * @returns {Array<Object>} - Filtered entries
 */
function filterByBatch(entries, batch) {
  if (!batch || typeof batch !== 'string') {
    return entries;
  }
  
  const normalizedBatch = batch.toLowerCase().replace(/\s+/g, '');
  
  return entries.filter(entry => {
    if (!entry.batch) return false;
    
    const normalizedEntryBatch = entry.batch.toLowerCase().replace(/\s+/g, '');
    
    // Exact match
    if (normalizedEntryBatch === normalizedBatch) {
      return true;
    }
    
    // Partial match (e.g., "Grp B" matches "B")
    if (normalizedEntryBatch.includes(normalizedBatch) || 
        normalizedBatch.includes(normalizedEntryBatch)) {
      return true;
    }
    
    return false;
  });
}

/**
 * Filter entries by course.
 * 
 * @param {Array<Object>} entries - Normalized entries
 * @param {string} course - Course to filter by
 * @returns {Array<Object>} - Filtered entries
 */
function filterByCourse(entries, course) {
  if (!course || typeof course !== 'string') {
    return entries;
  }
  
  const normalizedCourse = course.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  return entries.filter(entry => {
    if (!entry.course) return false;
    
    const normalizedEntryCourse = entry.course.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    return normalizedEntryCourse === normalizedCourse ||
           normalizedEntryCourse.includes(normalizedCourse) ||
           normalizedCourse.includes(normalizedEntryCourse);
  });
}

/**
 * Filter entries by day of week.
 * 
 * @param {Array<Object>} entries - Normalized entries
 * @param {string} dayOfWeek - Day to filter by
 * @returns {Array<Object>} - Filtered entries
 */
function filterByDayOfWeek(entries, dayOfWeek) {
  if (!dayOfWeek || typeof dayOfWeek !== 'string') {
    return entries;
  }
  
  const normalizedDay = normalizeDayOfWeek(dayOfWeek);
  
  if (!normalizedDay) {
    return entries;
  }
  
  return entries.filter(entry => entry.dayOfWeek === normalizedDay);
}

/**
 * Filter entries by type (class, lunch, unknown).
 * 
 * @param {Array<Object>} entries - Normalized entries
 * @param {string} type - Type to filter by
 * @returns {Array<Object>} - Filtered entries
 */
function filterByType(entries, type) {
  if (!type || typeof type !== 'string') {
    return entries;
  }
  
  return entries.filter(entry => entry.type === type);
}
