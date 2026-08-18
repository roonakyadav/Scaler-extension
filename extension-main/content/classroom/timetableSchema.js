// ============================================
// classroom/timetableSchema.js
// Normalized internal schema for timetable entries
// ============================================

/**
 * Generate a stable ID for a timetable entry.
 * 
 * @param {Object} entry - Timetable entry
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
 * Create a normalized timetable entry.
 * 
 * @param {Object} data - Raw entry data
 * @returns {Object} - Normalized entry
 */
function createNormalizedEntry(data = {}) {
  return {
    id: data.id || generateEntryId(data),
    date: data.date || null, // YYYY-MM-DD or null for weekly timetables
    dayOfWeek: data.dayOfWeek || null, // Monday, Tuesday, etc.
    startTime: data.startTime || null, // HH:MM format
    endTime: data.endTime || null, // HH:MM format
    batch: data.batch || null, // e.g., "Grp B"
    course: data.course || null, // e.g., "MERN"
    topic: data.topic || null, // Specific topic if available
    teacher: data.teacher || null, // Instructor name
    classroom: data.classroom || null, // e.g., "Classroom A, 1st floor"
    type: data.type || 'class', // 'class', 'lunch', 'unknown'
    source: data.source || 'google-sheets', // Source identifier
    raw: data.raw || null // Preserve raw data for debugging
  };
}

/**
 * Validate that an entry has required fields for a class.
 * 
 * @param {Object} entry - Normalized entry
 * @returns {boolean} - True if valid class entry
 */
function isValidClassEntry(entry) {
  // Class entries must have at least: day/time, classroom
  if (!entry.dayOfWeek && !entry.date) {
    return false;
  }
  
  if (!entry.startTime || !entry.endTime) {
    return false;
  }
  
  if (!entry.classroom || entry.classroom.trim() === '') {
    return false;
  }
  
  return true;
}

/**
 * Normalize batch/group names for consistent comparison.
 * 
 * @param {string} batch - Raw batch name
 * @returns {string} - Normalized batch name
 */
function normalizeBatch(batch) {
  if (!batch || typeof batch !== 'string') {
    return '';
  }
  
  return batch
    .toLowerCase()
    .replace(/group/g, 'grp')
    .replace(/batch/g, 'grp')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * Normalize course names for consistent comparison.
 * 
 * @param {string} course - Raw course name
 * @returns {string} - Normalized course name
 */
function normalizeCourse(course) {
  if (!course || typeof course !== 'string') {
    return '';
  }
  
  return course
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Normalize teacher names for consistent comparison.
 * 
 * @param {string} teacher - Raw teacher name
 * @returns {string} - Normalized teacher name
 */
function normalizeTeacher(teacher) {
  if (!teacher || typeof teacher !== 'string') {
    return '';
  }
  
  return teacher
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse time string to minutes since midnight.
 * 
 * @param {string} timeStr - Time string (e.g., "09:30", "9:30 AM")
 * @returns {number|null} - Minutes since midnight or null if invalid
 */
function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') {
    return null;
  }
  
  const trimmed = timeStr.trim().toLowerCase();
  
  // Handle 12-hour format with AM/PM
  const match12h = trimmed.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
  if (match12h) {
    let hours = parseInt(match12h[1], 10);
    const minutes = parseInt(match12h[2], 10);
    const meridiem = match12h[3];
    
    if (meridiem === 'pm' && hours !== 12) {
      hours += 12;
    } else if (meridiem === 'am' && hours === 12) {
      hours = 0;
    }
    
    return hours * 60 + minutes;
  }
  
  // Handle 24-hour format
  const match24h = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (match24h) {
    const hours = parseInt(match24h[1], 10);
    const minutes = parseInt(match24h[2], 10);
    
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return hours * 60 + minutes;
    }
  }
  
  return null;
}

/**
 * Format minutes since midnight to HH:MM string.
 * 
 * @param {number} minutes - Minutes since midnight
 * @returns {string} - HH:MM formatted string
 */
function formatMinutesToTime(minutes) {
  if (typeof minutes !== 'number' || minutes < 0 || minutes >= 24 * 60) {
    return '';
  }
  
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * Calculate duration in minutes between start and end time.
 * 
 * @param {string} startTime - Start time string
 * @param {string} endTime - End time string
 * @returns {number|null} - Duration in minutes or null if invalid
 */
function calculateDuration(startTime, endTime) {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);
  
  if (startMinutes === null || endMinutes === null) {
    return null;
  }
  
  const duration = endMinutes - startMinutes;
  
  // Handle overnight classes (end time < start time)
  if (duration < 0) {
    return duration + 24 * 60;
  }
  
  return duration;
}
