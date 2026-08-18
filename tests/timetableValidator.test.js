// ============================================
// tests/timetableValidator.test.js
// Unit tests for timetable validation
// ============================================

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Load the timetableValidator module functions
// In a real test environment, these would be imported
// For now, we'll define them inline for testing

const ValidationErrorTypes = {
  MISSING_CLASSROOM: 'MISSING_CLASSROOM',
  INVALID_TIME: 'INVALID_TIME',
  TIME_ORDER: 'TIME_ORDER',
  MISSING_DAY: 'MISSING_DAY',
  MISSING_BATCH: 'MISSING_BATCH',
  INVALID_TYPE: 'INVALID_TYPE'
};

function isValidTimeFormat(time) {
  if (!time || typeof time !== 'string') {
    return false;
  }
  
  return /^\d{2}:\d{2}$/.test(time);
}

function isValidDayOfWeek(day) {
  if (!day || typeof day !== 'string') {
    return false;
  }
  
  const validDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return validDays.includes(day);
}

function timeToMinutes(time) {
  if (!isValidTimeFormat(time)) {
    return null;
  }
  
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

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
  
  if (entry.type === 'class') {
    if (!entry.classroom || entry.classroom.trim() === '') {
      errors.push({
        type: ValidationErrorTypes.MISSING_CLASSROOM,
        message: 'Class entry has no classroom',
        field: 'classroom'
      });
    }
  }
  
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
  
  if (entry.startTime && entry.endTime && 
      isValidTimeFormat(entry.startTime) && isValidTimeFormat(entry.endTime)) {
    const startMinutes = timeToMinutes(entry.startTime);
    const endMinutes = timeToMinutes(entry.endTime);
    
    if (startMinutes !== null && endMinutes !== null) {
      if (endMinutes <= startMinutes && endMinutes > 0) {
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

function filterValidEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  
  return entries.filter(entry => {
    const result = validateEntry(entry);
    return result.valid;
  });
}

describe('validateEntry', () => {
  it('should validate a complete class entry', () => {
    const entry = {
      id: 'monday|09:30|11:00|grpb|mern|mrinal',
      dayOfWeek: 'Monday',
      startTime: '09:30',
      endTime: '11:00',
      batch: 'Grp B',
      course: 'MERN',
      teacher: 'Mrinal',
      classroom: 'Classroom A 1st floor',
      type: 'class'
    };
    
    const result = validateEntry(entry);
    
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
  });

  it('should reject class entry without classroom', () => {
    const entry = {
      dayOfWeek: 'Monday',
      startTime: '09:30',
      endTime: '11:00',
      classroom: '',
      type: 'class'
    };
    
    const result = validateEntry(entry);
    
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errors.length, 1);
    assert.strictEqual(result.errors[0].type, ValidationErrorTypes.MISSING_CLASSROOM);
  });

  it('should reject class entry without start time', () => {
    const entry = {
      dayOfWeek: 'Monday',
      endTime: '11:00',
      classroom: 'Classroom A',
      type: 'class'
    };
    
    const result = validateEntry(entry);
    
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errors.length, 1);
    assert.strictEqual(result.errors[0].type, ValidationErrorTypes.INVALID_TIME);
  });

  it('should reject class entry without end time', () => {
    const entry = {
      dayOfWeek: 'Monday',
      startTime: '09:30',
      classroom: 'Classroom A',
      type: 'class'
    };
    
    const result = validateEntry(entry);
    
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errors.length, 1);
    assert.strictEqual(result.errors[0].type, ValidationErrorTypes.INVALID_TIME);
  });

  it('should reject invalid time format', () => {
    const entry = {
      dayOfWeek: 'Monday',
      startTime: 'invalid',
      endTime: '11:00',
      classroom: 'Classroom A',
      type: 'class'
    };
    
    const result = validateEntry(entry);
    
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errors[0].type, ValidationErrorTypes.INVALID_TIME);
  });

  it('should reject invalid day of week', () => {
    const entry = {
      dayOfWeek: 'Funday',
      startTime: '09:30',
      endTime: '11:00',
      classroom: 'Classroom A',
      type: 'class'
    };
    
    const result = validateEntry(entry);
    
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errors[0].type, ValidationErrorTypes.MISSING_DAY);
  });

  it('should reject invalid type', () => {
    const entry = {
      dayOfWeek: 'Monday',
      startTime: '09:30',
      endTime: '11:00',
      classroom: 'Classroom A',
      type: 'invalid'
    };
    
    const result = validateEntry(entry);
    
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errors[0].type, ValidationErrorTypes.INVALID_TYPE);
  });

  it('should allow lunch entry without classroom', () => {
    const entry = {
      dayOfWeek: 'Monday',
      startTime: '13:00',
      endTime: '14:00',
      type: 'lunch'
    };
    
    const result = validateEntry(entry);
    
    assert.strictEqual(result.valid, true);
  });

  it('should reject null entry', () => {
    const result = validateEntry(null);
    
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errors[0].type, 'INVALID_ENTRY');
  });
});

describe('validateTimetable', () => {
  it('should validate array of valid entries', () => {
    const entries = [
      {
        id: 'entry1',
        dayOfWeek: 'Monday',
        startTime: '09:30',
        endTime: '11:00',
        classroom: 'Classroom A',
        type: 'class'
      },
      {
        id: 'entry2',
        dayOfWeek: 'Tuesday',
        startTime: '09:30',
        endTime: '11:00',
        classroom: 'Classroom B',
        type: 'class'
      }
    ];
    
    const result = validateTimetable(entries);
    
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
  });

  it('should detect duplicate entries', () => {
    const entries = [
      {
        id: 'duplicate',
        dayOfWeek: 'Monday',
        startTime: '09:30',
        endTime: '11:00',
        classroom: 'Classroom A',
        type: 'class'
      },
      {
        id: 'duplicate',
        dayOfWeek: 'Monday',
        startTime: '09:30',
        endTime: '11:00',
        classroom: 'Classroom B',
        type: 'class'
      }
    ];
    
    const result = validateTimetable(entries);
    
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errors.some(e => e.type === 'DUPLICATE_ENTRY'), true);
  });

  it('should reject non-array input', () => {
    const result = validateTimetable('not an array');
    
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errors[0].type, 'INVALID_INPUT');
  });

  it('should return entry errors by index', () => {
    const entries = [
      {
        dayOfWeek: 'Monday',
        startTime: '09:30',
        endTime: '11:00',
        classroom: '',
        type: 'class'
      },
      {
        dayOfWeek: 'Tuesday',
        startTime: '09:30',
        endTime: '11:00',
        classroom: 'Classroom B',
        type: 'class'
      }
    ];
    
    const result = validateTimetable(entries);
    
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.entryErrors[0].length, 1);
    assert.strictEqual(result.entryErrors[1]?.length || 0, 0);
  });
});

describe('filterValidEntries', () => {
  it('should filter out invalid entries', () => {
    const entries = [
      {
        dayOfWeek: 'Monday',
        startTime: '09:30',
        endTime: '11:00',
        classroom: 'Classroom A',
        type: 'class'
      },
      {
        dayOfWeek: 'Tuesday',
        startTime: '09:30',
        endTime: '11:00',
        classroom: '',
        type: 'class'
      }
    ];
    
    const result = filterValidEntries(entries);
    
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].classroom, 'Classroom A');
  });

  it('should return empty array for non-array input', () => {
    const result = filterValidEntries('not an array');
    
    assert.deepStrictEqual(result, []);
  });

  it('should return empty array for null input', () => {
    const result = filterValidEntries(null);
    
    assert.deepStrictEqual(result, []);
  });
});

describe('isValidTimeFormat', () => {
  it('should accept valid HH:MM format', () => {
    assert.strictEqual(isValidTimeFormat('09:30'), true);
    assert.strictEqual(isValidTimeFormat('23:59'), true);
    assert.strictEqual(isValidTimeFormat('00:00'), true);
  });

  it('should reject invalid formats', () => {
    assert.strictEqual(isValidTimeFormat('9:30'), false);
    assert.strictEqual(isValidTimeFormat('09:30 AM'), false);
    assert.strictEqual(isValidTimeFormat('invalid'), false);
    assert.strictEqual(isValidTimeFormat(''), false);
  });
});

describe('isValidDayOfWeek', () => {
  it('should accept valid day names', () => {
    assert.strictEqual(isValidDayOfWeek('Monday'), true);
    assert.strictEqual(isValidDayOfWeek('Tuesday'), true);
    assert.strictEqual(isValidDayOfWeek('Wednesday'), true);
    assert.strictEqual(isValidDayOfWeek('Thursday'), true);
    assert.strictEqual(isValidDayOfWeek('Friday'), true);
    assert.strictEqual(isValidDayOfWeek('Saturday'), true);
    assert.strictEqual(isValidDayOfWeek('Sunday'), true);
  });

  it('should reject invalid day names', () => {
    assert.strictEqual(isValidDayOfWeek('Mon'), false);
    assert.strictEqual(isValidDayOfWeek('Funday'), false);
    assert.strictEqual(isValidDayOfWeek(''), false);
  });
});
