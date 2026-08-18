// ============================================
// classroom/timetableValidator.js
// Validate normalized timetable entries
// ============================================

/**
 * Validation error types
 */
const ValidationErrorTypes = {
  MISSING_CLASSROOM: 'MISSING_CLASSROOM',
  INVALID_TIME: 'INVALID_TIME',
  TIME_ORDER: 'TIME_ORDER',
  MISSING_DAY: 'MISSING_DAY',
  MISSING_BATCH: 'MISSING_BATCH',
  INVALID_TYPE: 'INVALID_TYPE'
};

/**
 * Validate a single normalized timetable entry.
 * 
 * @param {Object} entry - Normalized entry
 * @returns {{valid: boolean, errors: Array<Object>}} - Validation result
 */
function validateEntry(entry) {
  const errors = [];
  
  if (!entry || typeof entry !== 'object') {
    return {
      valid: false,
      errors: [{
        type: 'INVALID_ENTRY',
        message: 'Entry is not a valid object'
      }]
    };
  }
  
  // For class entries, classroom is required
  if (entry.type === 'class') {
    if (!entry.classroom || entry.classroom.trim() === '') {
      errors.push({
        type: ValidationErrorTypes.MISSING_CLASSROOM,
        message: 'Class entry has no classroom',
        field: 'classroom'
      });
    }
  }
  
  // Validate time fields
  if (entry.startTime) {
    if (!isValidTimeFormat(entry.startTime)) {
      errors.push({
        type: ValidationErrorTypes.INVALID_TIME,
        message: `Invalid start time format: ${entry.startTime}`,
        field: 'startTime'
      });
    }
  } else if (entry.type === 'class') {
    errors.push({
      type: ValidationErrorTypes.INVALID_TIME,
      message: 'Class entry has no start time',
      field: 'startTime'
    });
  }
  
  if (entry.endTime) {
    if (!isValidTimeFormat(entry.endTime)) {
      errors.push({
        type: ValidationErrorTypes.INVALID_TIME,
        message: `Invalid end time format: ${entry.endTime}`,
        field: 'endTime'
      });
    }
  } else if (entry.type === 'class') {
    errors.push({
      type: ValidationErrorTypes.INVALID_TIME,
      message: 'Class entry has no end time',
      field: 'endTime'
    });
  }
  
  // Validate time order (end should be after start)
  if (entry.startTime && entry.endTime && 
      isValidTimeFormat(entry.startTime) && isValidTimeFormat(entry.endTime)) {
    const startMinutes = timeToMinutes(entry.startTime);
    const endMinutes = timeToMinutes(entry.endTime);
    
    if (startMinutes !== null && endMinutes !== null) {
      // Allow overnight classes (end < start means next day)
      // But for same-day entries, end should be after start
      if (endMinutes <= startMinutes && endMinutes > 0) {
        // This might be overnight, which is valid
        // Only flag if duration is unreasonably long (> 12 hours)
        const duration = endMinutes + (24 * 60) - startMinutes;
        if (duration > 12 * 60) {
          errors.push({
            type: ValidationErrorTypes.TIME_ORDER,
            message: 'End time is before start time (or duration too long)',
            field: 'endTime'
          });
        }
      }
    }
  }
  
  // Validate day of week
  if (!entry.dayOfWeek && !entry.date) {
    if (entry.type === 'class') {
      errors.push({
        type: ValidationErrorTypes.MISSING_DAY,
        message: 'Class entry has no day of week or date',
        field: 'dayOfWeek'
      });
    }
  } else if (entry.dayOfWeek && !isValidDayOfWeek(entry.dayOfWeek)) {
    errors.push({
      type: ValidationErrorTypes.MISSING_DAY,
      message: `Invalid day of week: ${entry.dayOfWeek}`,
      field: 'dayOfWeek'
    });
  }
  
  // Validate type
  if (entry.type && !['class', 'lunch', 'unknown'].includes(entry.type)) {
    errors.push({
      type: ValidationErrorTypes.INVALID_TYPE,
      message: `Invalid entry type: ${entry.type}`,
      field: 'type'
    });
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate an array of normalized entries.
 * 
 * @param {Array<Object>} entries - Array of normalized entries
 * @returns {{valid: boolean, errors: Array<Object>, entryErrors: Object}} - Validation result
 */
function validateTimetable(entries) {
  if (!Array.isArray(entries)) {
    return {
      valid: false,
      errors: [{
        type: 'INVALID_INPUT',
        message: 'Input is not an array'
      }],
      entryErrors: {}
    };
  }
  
  const allErrors = [];
  const entryErrors = {};
  
  entries.forEach((entry, index) => {
    const result = validateEntry(entry);
    
    if (!result.valid) {
      entryErrors[index] = result.errors;
      allErrors.push(...result.errors);
    }
  });
  
  // Check for duplicate entries
  const idSet = new Set();
  entries.forEach((entry, index) => {
    if (entry.id) {
      if (idSet.has(entry.id)) {
        allErrors.push({
          type: 'DUPLICATE_ENTRY',
          message: `Duplicate entry at index ${index} with ID ${entry.id}`,
          index
        });
      }
      idSet.add(entry.id);
    }
  });
  
  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    entryErrors
  };
}

/**
 * Check if time string is in valid HH:MM format.
 * 
 * @param {string} time - Time string
 * @returns {boolean} - True if valid
 */
function isValidTimeFormat(time) {
  if (!time || typeof time !== 'string') {
    return false;
  }
  
  return /^\d{2}:\d{2}$/.test(time);
}

/**
 * Check if day of week is valid.
 * 
 * @param {string} day - Day string
 * @returns {boolean} - True if valid
 */
function isValidDayOfWeek(day) {
  if (!day || typeof day !== 'string') {
    return false;
  }
  
  const validDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return validDays.includes(day);
}

/**
 * Convert HH:MM time to minutes since midnight.
 * 
 * @param {string} time - Time string in HH:MM format
 * @returns {number|null} - Minutes since midnight or null if invalid
 */
function timeToMinutes(time) {
  if (!isValidTimeFormat(time)) {
    return null;
  }
  
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Filter entries to only valid ones.
 * 
 * @param {Array<Object>} entries - Array of normalized entries
 * @returns {Array<Object>} - Filtered entries
 */
function filterValidEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  
  return entries.filter(entry => {
    const result = validateEntry(entry);
    return result.valid;
  });
}

/**
 * Get validation summary statistics.
 * 
 * @param {Array<Object>} entries - Array of normalized entries
 * @returns {Object} - Validation statistics
 */
function getValidationStats(entries) {
  const result = validateTimetable(entries);
  
  const stats = {
    total: entries.length,
    valid: 0,
    invalid: 0,
    byType: {},
    byErrorType: {}
  };
  
  entries.forEach(entry => {
    const entryResult = validateEntry(entry);
    
    if (entryResult.valid) {
      stats.valid++;
    } else {
      stats.invalid++;
      
      entryResult.errors.forEach(error => {
        byErrorType[error.type] = (byErrorType[error.type] || 0) + 1;
      });
    }
    
    if (entry.type) {
      stats.byType[entry.type] = (stats.byType[entry.type] || 0) + 1;
    }
  });
  
  return stats;
}
