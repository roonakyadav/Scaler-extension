// ============================================
// classroom/scalerClassNormalizer.js
// Normalize Scaler event data into canonical class representation
// ============================================

/**
 * Extract course from super_batch_name.
 * Examples:
 * "MERN - 2029 Grp B" → "mern"
 * "CML - 2029 Grp C" → "cml"
 * "CN - 2029 Grp A" → "cn"
 * 
 * @param {string} superBatchName - Raw super_batch_name from Scaler API
 * @returns {string|null} - Extracted course or null if ambiguous
 */
function extractCourse(superBatchName) {
  if (!superBatchName || typeof superBatchName !== 'string') {
    return null;
  }
  
  const trimmed = superBatchName.trim();
  
  // Pattern: "COURSE - YEAR Grp X" or similar
  // Extract the first word before any dash or number
  const match = trimmed.match(/^([A-Za-z]+)/);
  
  if (!match) {
    return null;
  }
  
  const course = match[1].toLowerCase();
  
  // Filter out common non-course words
  const nonCourseWords = ['batch', 'group', 'grp', 'sst', 'super'];
  if (nonCourseWords.includes(course)) {
    return null;
  }
  
  return course;
}

/**
 * Extract batch/group from super_batch_name.
 * Examples:
 * "MERN - 2029 Grp B" → "grp b"
 * "CML - 2029 Group C" → "grp c"
 * "CN - Batch A" → "grp a"
 * 
 * @param {string} superBatchName - Raw super_batch_name from Scaler API
 * @returns {string|null} - Extracted batch normalized to "grp X" or null
 */
function extractBatchGroup(superBatchName) {
  if (!superBatchName || typeof superBatchName !== 'string') {
    return null;
  }
  
  const trimmed = superBatchName.toLowerCase();
  
  // Try patterns: "grp X", "group X", "batch X"
  const patterns = [
    /grp\s+([a-z])/i,
    /group\s+([a-z])/i,
    /batch\s+([a-z])/i
  ];
  
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) {
      return `grp ${match[1]}`;
    }
  }
  
  return null;
}

/**
 * Parse ISO date string to YYYY-MM-DD format.
 * 
 * @param {string} isoDate - ISO date string (e.g., "2024-02-23T14:30:00Z")
 * @returns {string|null} - Date in YYYY-MM-DD format or null
 */
function parseIsoDate(isoDate) {
  if (!isoDate || typeof isoDate !== 'string') {
    return null;
  }
  
  try {
    const date = new Date(isoDate);
    if (isNaN(date.getTime())) {
      return null;
    }
    
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
  } catch (e) {
    return null;
  }
}

/**
 * Parse ISO time string to HH:MM format.
 * Uses UTC time to avoid timezone issues.
 * 
 * @param {string} isoDate - ISO date string with time
 * @returns {string|null} - Time in HH:MM format or null
 */
function parseIsoTime(isoDate) {
  if (!isoDate || typeof isoDate !== 'string') {
    return null;
  }
  
  try {
    const date = new Date(isoDate);
    if (isNaN(date.getTime())) {
      return null;
    }
    
    // Use UTC methods to avoid timezone conversion
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    
    return `${hours}:${minutes}`;
  } catch (e) {
    return null;
  }
}

/**
 * Get day of week from date string.
 * 
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {string|null} - Day name (Monday, Tuesday, etc.) or null
 */
function getDayOfWeek(dateString) {
  if (!dateString || typeof dateString !== 'string') {
    return null;
  }
  
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return null;
    }
    
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[date.getDay()];
  } catch (e) {
    return null;
  }
}

/**
 * Normalize teacher name.
 * 
 * @param {string} teacherName - Raw teacher name
 * @returns {string} - Normalized teacher name
 */
function normalizeTeacherName(teacherName) {
  if (!teacherName || typeof teacherName !== 'string') {
    return '';
  }
  
  return teacherName.trim();
}

/**
 * Normalize event type.
 * 
 * @param {string} eventType - Raw event type
 * @returns {string} - Normalized event type
 */
function normalizeEventType(eventType) {
  if (!eventType || typeof eventType !== 'string') {
    return 'unknown';
  }
  
  return eventType.toLowerCase().trim();
}

/**
 * Create canonical Scaler class representation from raw event data.
 * 
 * @param {Object} scalerEvent - Raw event from Scaler API
 * @returns {Object} - Canonical class representation
 */
function createCanonicalScalerClass(scalerEvent) {
  if (!scalerEvent || typeof scalerEvent !== 'object') {
    return null;
  }
  
  const superBatchName = scalerEvent.super_batch_name || '';
  
  // Try both date fields
  const date = parseIsoDate(scalerEvent.date) || parseIsoDate(scalerEvent.date_of_topic);
  const startTime = parseIsoTime(scalerEvent.date) || parseIsoTime(scalerEvent.date_of_topic);
  const endTime = parseIsoTime(scalerEvent.end_time);
  
  const dayOfWeek = date ? getDayOfWeek(date) : null;
  
  return {
    classId: scalerEvent.sbat_id ? String(scalerEvent.sbat_id) : null,
    date: date,
    dayOfWeek: dayOfWeek,
    startTime: startTime,
    endTime: endTime,
    course: extractCourse(superBatchName),
    batch: extractBatchGroup(superBatchName),
    topic: scalerEvent.title || null,
    teacher: normalizeTeacherName(scalerEvent.instructors_name),
    eventType: normalizeEventType(scalerEvent.event_type),
    raw: scalerEvent // Preserve raw data for debugging
  };
}

/**
 * Validate canonical Scaler class has required fields.
 * 
 * @param {Object} canonicalClass - Canonical class representation
 * @returns {boolean} - True if valid
 */
function isValidCanonicalClass(canonicalClass) {
  if (!canonicalClass || typeof canonicalClass !== 'object') {
    return false;
  }
  
  // Class ID is required
  if (!canonicalClass.classId) {
    return false;
  }
  
  // At least date or dayOfWeek is required
  if (!canonicalClass.date && !canonicalClass.dayOfWeek) {
    return false;
  }
  
  // Time is required
  if (!canonicalClass.startTime || !canonicalClass.endTime) {
    return false;
  }
  
  return true;
}
