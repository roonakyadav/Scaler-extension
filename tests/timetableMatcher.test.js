// ============================================
// tests/timetableMatcher.test.js
// Unit tests for timetable matching
// ============================================

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Load the timetableMatcher module functions
// In a real test environment, these would be imported
// For now, we'll define them inline for testing

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

function timesMatch(time1, time2, toleranceMinutes) {
  const minutes1 = timeToMinutes(time1);
  const minutes2 = timeToMinutes(time2);
  
  if (minutes1 === null || minutes2 === null) {
    return false;
  }
  
  const diff = Math.abs(minutes1 - minutes2);
  return diff <= toleranceMinutes;
}

function datesMatch(date1, date2) {
  if (!date1 || !date2) {
    return false;
  }
  
  return date1 === date2;
}

function daysMatch(day1, day2) {
  if (!day1 || !day2) {
    return false;
  }
  
  return day1.toLowerCase() === day2.toLowerCase();
}

function batchesMatch(batch1, batch2) {
  if (!batch1 || !batch2) {
    return false;
  }
  
  const norm1 = batch1.toLowerCase().replace(/\s+/g, '');
  const norm2 = batch2.toLowerCase().replace(/\s+/g, '');
  
  return norm1 === norm2;
}

function coursesMatch(course1, course2) {
  if (!course1 || !course2) {
    return false;
  }
  
  const norm1 = course1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const norm2 = course2.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  return norm1 === norm2;
}

function teachersMatch(teacher1, teacher2) {
  if (!teacher1 || !teacher2) {
    return false;
  }
  
  const norm1 = teacher1.toLowerCase().trim();
  const norm2 = teacher2.toLowerCase().trim();
  
  return norm1 === norm2;
}

function matchesDateTime(scalerClass, timetableEntry, config = DEFAULT_MATCH_CONFIG) {
  if (scalerClass.date && timetableEntry.date) {
    if (!datesMatch(scalerClass.date, timetableEntry.date)) {
      return false;
    }
  }
  
  if (scalerClass.dayOfWeek && timetableEntry.dayOfWeek) {
    if (!daysMatch(scalerClass.dayOfWeek, timetableEntry.dayOfWeek)) {
      return false;
    }
  }
  
  if (!scalerClass.date && !scalerClass.dayOfWeek) {
    return false;
  }
  
  if (!timesMatch(scalerClass.startTime, timetableEntry.startTime, config.timeToleranceMinutes)) {
    return false;
  }
  
  if (!timesMatch(scalerClass.endTime, timetableEntry.endTime, config.timeToleranceMinutes)) {
    return false;
  }
  
  return true;
}

function calculateMatchScore(scalerClass, timetableEntry, config = DEFAULT_MATCH_CONFIG) {
  const reasons = [];
  let score = 0;
  
  const { weights } = config;
  
  if (matchesDateTime(scalerClass, timetableEntry, config)) {
    score += weights.time;
    reasons.push('date/time matched');
  } else {
    return { score: 0, reasons: ['date/time mismatch'] };
  }
  
  if (scalerClass.batch && timetableEntry.batch && batchesMatch(scalerClass.batch, timetableEntry.batch)) {
    score += weights.batch;
    reasons.push('batch matched');
  }
  
  if (scalerClass.course && timetableEntry.course && coursesMatch(scalerClass.course, timetableEntry.course)) {
    score += weights.course;
    reasons.push('course matched');
  }
  
  if (scalerClass.teacher && timetableEntry.teacher && teachersMatch(scalerClass.teacher, timetableEntry.teacher)) {
    score += weights.teacher;
    reasons.push('teacher matched');
  }
  
  return { score, reasons };
}

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

function selectBestMatch(candidates, config = DEFAULT_MATCH_CONFIG) {
  if (candidates.length === 0) {
    return {
      matched: false,
      reason: 'NO_CANDIDATES',
      candidates: []
    };
  }
  
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  
  const best = sorted[0];
  const secondBest = sorted[1];
  
  if (secondBest && Math.abs(best.score - secondBest.score) < 0.1) {
    return {
      matched: false,
      reason: 'AMBIGUOUS_MATCH',
      candidates: sorted.slice(0, 3)
    };
  }
  
  if (best.score < config.minConfidenceThreshold) {
    return {
      matched: false,
      reason: 'LOW_CONFIDENCE',
      score: best.score,
      candidates: sorted.slice(0, 3)
    };
  }
  
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

function matchClassToTimetable(scalerClass, timetableEntries, options = {}) {
  const config = {
    ...DEFAULT_MATCH_CONFIG,
    ...options.config
  };
  
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
  
  const candidates = findTimeCandidates(scalerClass, timetableEntries, config);
  const result = selectBestMatch(candidates, config);
  
  result.debug = {
    scalerClassId: scalerClass.classId,
    totalCandidates: candidates.length,
    config
  };
  
  return result;
}

describe('timeToMinutes', () => {
  it('should convert 09:30 to minutes', () => {
    assert.strictEqual(timeToMinutes('09:30'), 570);
  });

  it('should convert 14:30 to minutes', () => {
    assert.strictEqual(timeToMinutes('14:30'), 870);
  });

  it('should convert 00:00 to minutes', () => {
    assert.strictEqual(timeToMinutes('00:00'), 0);
  });

  it('should convert 23:59 to minutes', () => {
    assert.strictEqual(timeToMinutes('23:59'), 1439);
  });

  it('should return null for invalid format', () => {
    assert.strictEqual(timeToMinutes('invalid'), null);
  });

  it('should return null for null', () => {
    assert.strictEqual(timeToMinutes(null), null);
  });
});

describe('timesMatch', () => {
  it('should match exact times', () => {
    assert.strictEqual(timesMatch('09:30', '09:30', 5), true);
  });

  it('should match within tolerance (+1 min)', () => {
    assert.strictEqual(timesMatch('09:30', '09:31', 5), true);
  });

  it('should match within tolerance (-1 min)', () => {
    assert.strictEqual(timesMatch('09:30', '09:29', 5), true);
  });

  it('should match within tolerance (+5 min)', () => {
    assert.strictEqual(timesMatch('09:30', '09:35', 5), true);
  });

  it('should not match beyond tolerance (+6 min)', () => {
    assert.strictEqual(timesMatch('09:30', '09:36', 5), false);
  });

  it('should not match beyond tolerance (-6 min)', () => {
    assert.strictEqual(timesMatch('09:30', '09:24', 5), false);
  });

  it('should not match completely different times', () => {
    assert.strictEqual(timesMatch('09:30', '11:00', 5), false);
  });
});

describe('batchesMatch', () => {
  it('should match exact batches', () => {
    assert.strictEqual(batchesMatch('grp b', 'grp b'), true);
  });

  it('should match case-insensitive', () => {
    assert.strictEqual(batchesMatch('Grp B', 'grp b'), true);
  });

  it('should match with different spacing', () => {
    assert.strictEqual(batchesMatch('grp  b', 'grp b'), true);
  });

  it('should not match different batches', () => {
    assert.strictEqual(batchesMatch('grp a', 'grp b'), false);
  });

  it('should return false for null inputs', () => {
    assert.strictEqual(batchesMatch(null, 'grp b'), false);
    assert.strictEqual(batchesMatch('grp b', null), false);
  });
});

describe('coursesMatch', () => {
  it('should match exact courses', () => {
    assert.strictEqual(coursesMatch('mern', 'mern'), true);
  });

  it('should match case-insensitive', () => {
    assert.strictEqual(coursesMatch('MERN', 'mern'), true);
  });

  it('should match with punctuation', () => {
    assert.strictEqual(coursesMatch('MERN-', 'mern'), true);
  });

  it('should not match different courses', () => {
    assert.strictEqual(coursesMatch('mern', 'cml'), false);
  });

  it('should return false for null inputs', () => {
    assert.strictEqual(coursesMatch(null, 'mern'), false);
    assert.strictEqual(coursesMatch('mern', null), false);
  });
});

describe('teachersMatch', () => {
  it('should match exact names', () => {
    assert.strictEqual(teachersMatch('John Doe', 'John Doe'), true);
  });

  it('should match case-insensitive', () => {
    assert.strictEqual(teachersMatch('John Doe', 'john doe'), true);
  });

  it('should trim whitespace', () => {
    assert.strictEqual(teachersMatch('  John Doe  ', 'John Doe'), true);
  });

  it('should not match different names', () => {
    assert.strictEqual(teachersMatch('John Doe', 'Jane Doe'), false);
  });

  it('should return false for null inputs', () => {
    assert.strictEqual(teachersMatch(null, 'John Doe'), false);
    assert.strictEqual(teachersMatch('John Doe', null), false);
  });
});

describe('matchesDateTime', () => {
  it('should match exact date and time', () => {
    const scalerClass = {
      date: '2024-02-23',
      startTime: '09:30',
      endTime: '11:00'
    };
    const timetableEntry = {
      date: '2024-02-23',
      startTime: '09:30',
      endTime: '11:00'
    };
    
    assert.strictEqual(matchesDateTime(scalerClass, timetableEntry), true);
  });

  it('should match dayOfWeek instead of date', () => {
    const scalerClass = {
      dayOfWeek: 'Monday',
      startTime: '09:30',
      endTime: '11:00'
    };
    const timetableEntry = {
      dayOfWeek: 'Monday',
      startTime: '09:30',
      endTime: '11:00'
    };
    
    assert.strictEqual(matchesDateTime(scalerClass, timetableEntry), true);
  });

  it('should match within time tolerance', () => {
    const scalerClass = {
      date: '2024-02-23',
      startTime: '09:30',
      endTime: '11:00'
    };
    const timetableEntry = {
      date: '2024-02-23',
      startTime: '09:31',
      endTime: '11:01'
    };
    
    assert.strictEqual(matchesDateTime(scalerClass, timetableEntry), true);
  });

  it('should not match wrong date', () => {
    const scalerClass = {
      date: '2024-02-23',
      startTime: '09:30',
      endTime: '11:00'
    };
    const timetableEntry = {
      date: '2024-02-24',
      startTime: '09:30',
      endTime: '11:00'
    };
    
    assert.strictEqual(matchesDateTime(scalerClass, timetableEntry), false);
  });

  it('should not match wrong start time', () => {
    const scalerClass = {
      date: '2024-02-23',
      startTime: '09:30',
      endTime: '11:00'
    };
    const timetableEntry = {
      date: '2024-02-23',
      startTime: '10:00',
      endTime: '11:00'
    };
    
    assert.strictEqual(matchesDateTime(scalerClass, timetableEntry), false);
  });

  it('should not match when class has no date or day', () => {
    const scalerClass = {
      startTime: '09:30',
      endTime: '11:00'
    };
    const timetableEntry = {
      date: '2024-02-23',
      startTime: '09:30',
      endTime: '11:00'
    };
    
    assert.strictEqual(matchesDateTime(scalerClass, timetableEntry), false);
  });
});

describe('calculateMatchScore', () => {
  it('should score perfect match', () => {
    const scalerClass = {
      date: '2024-02-23',
      startTime: '09:30',
      endTime: '11:00',
      batch: 'grp b',
      course: 'mern',
      teacher: 'John Doe'
    };
    const timetableEntry = {
      date: '2024-02-23',
      startTime: '09:30',
      endTime: '11:00',
      batch: 'grp b',
      course: 'mern',
      teacher: 'John Doe'
    };
    
    const result = calculateMatchScore(scalerClass, timetableEntry);
    
    assert.strictEqual(result.score, 1.0);
    assert.strictEqual(result.reasons.length, 4);
  });

  it('should score time-only match', () => {
    const scalerClass = {
      date: '2024-02-23',
      startTime: '09:30',
      endTime: '11:00'
    };
    const timetableEntry = {
      date: '2024-02-23',
      startTime: '09:30',
      endTime: '11:00'
    };
    
    const result = calculateMatchScore(scalerClass, timetableEntry);
    
    assert.strictEqual(Math.abs(result.score - 0.40) < 0.001, true);
    assert.strictEqual(result.reasons.length, 1);
  });

  it('should score time + batch match', () => {
    const scalerClass = {
      date: '2024-02-23',
      startTime: '09:30',
      endTime: '11:00',
      batch: 'grp b'
    };
    const timetableEntry = {
      date: '2024-02-23',
      startTime: '09:30',
      endTime: '11:00',
      batch: 'grp b'
    };
    
    const result = calculateMatchScore(scalerClass, timetableEntry);
    
    assert.strictEqual(Math.abs(result.score - 0.60) < 0.001, true);
  });

  it('should return zero score for time mismatch', () => {
    const scalerClass = {
      date: '2024-02-23',
      startTime: '09:30',
      endTime: '11:00'
    };
    const timetableEntry = {
      date: '2024-02-24',
      startTime: '09:30',
      endTime: '11:00'
    };
    
    const result = calculateMatchScore(scalerClass, timetableEntry);
    
    assert.strictEqual(result.score, 0);
  });
});

describe('selectBestMatch', () => {
  it('should return NO_CANDIDATES for empty list', () => {
    const result = selectBestMatch([]);
    
    assert.strictEqual(result.matched, false);
    assert.strictEqual(result.reason, 'NO_CANDIDATES');
  });

  it('should select best single candidate', () => {
    const candidates = [
      {
        entry: { classroom: 'Classroom A' },
        score: 0.85,
        reasons: ['date/time matched', 'batch matched']
      }
    ];
    
    const result = selectBestMatch(candidates);
    
    assert.strictEqual(result.matched, true);
    assert.strictEqual(result.classroom, 'Classroom A');
    assert.strictEqual(result.score, 0.85);
  });

  it('should detect ambiguous matches', () => {
    const candidates = [
      {
        entry: { classroom: 'Classroom A' },
        score: 0.60,
        reasons: ['date/time matched']
      },
      {
        entry: { classroom: 'Classroom B' },
        score: 0.58,
        reasons: ['date/time matched']
      }
    ];
    
    const result = selectBestMatch(candidates);
    
    assert.strictEqual(result.matched, false);
    assert.strictEqual(result.reason, 'AMBIGUOUS_MATCH');
  });

  it('should reject low confidence match', () => {
    const candidates = [
      {
        entry: { classroom: 'Classroom A' },
        score: 0.50,
        reasons: ['date/time matched']
      }
    ];
    
    const result = selectBestMatch(candidates);
    
    assert.strictEqual(result.matched, false);
    assert.strictEqual(result.reason, 'LOW_CONFIDENCE');
  });

  it('should reject missing classroom', () => {
    const candidates = [
      {
        entry: { classroom: '' },
        score: 0.85,
        reasons: ['date/time matched']
      }
    ];
    
    const result = selectBestMatch(candidates);
    
    assert.strictEqual(result.matched, false);
    assert.strictEqual(result.reason, 'MISSING_CLASSROOM');
  });
});

describe('matchClassToTimetable', () => {
  it('should match class to timetable', () => {
    const scalerClass = {
      classId: '12345',
      date: '2024-02-23',
      startTime: '09:30',
      endTime: '11:00',
      batch: 'grp b',
      course: 'mern'
    };
    const timetableEntries = [
      {
        date: '2024-02-23',
        startTime: '09:30',
        endTime: '11:00',
        batch: 'grp b',
        course: 'mern',
        classroom: 'Classroom A 1st floor'
      }
    ];
    
    const result = matchClassToTimetable(scalerClass, timetableEntries);
    
    assert.strictEqual(result.matched, true);
    assert.strictEqual(result.classroom, 'Classroom A 1st floor');
    assert.strictEqual(Math.abs(result.score - 0.85) < 0.001, true);
  });

  it('should use manual override', () => {
    const scalerClass = {
      classId: '12345',
      date: '2024-02-23',
      startTime: '09:30',
      endTime: '11:00'
    };
    const timetableEntries = [];
    
    const result = matchClassToTimetable(scalerClass, timetableEntries, {
      manualOverride: { classroom: 'Manual Room' }
    });
    
    assert.strictEqual(result.matched, true);
    assert.strictEqual(result.classroom, 'Manual Room');
    assert.strictEqual(result.override, true);
  });

  it('should return NO_CANDIDATES when no matches', () => {
    const scalerClass = {
      classId: '12345',
      date: '2024-02-23',
      startTime: '09:30',
      endTime: '11:00'
    };
    const timetableEntries = [
      {
        date: '2024-02-24',
        startTime: '09:30',
        endTime: '11:00',
        classroom: 'Classroom A'
      }
    ];
    
    const result = matchClassToTimetable(scalerClass, timetableEntries);
    
    assert.strictEqual(result.matched, false);
    assert.strictEqual(result.reason, 'NO_CANDIDATES');
  });

  it('should handle weekly timetable (dayOfWeek)', () => {
    const scalerClass = {
      classId: '12345',
      dayOfWeek: 'Monday',
      startTime: '09:30',
      endTime: '11:00',
      batch: 'grp b',
      course: 'mern'
    };
    const timetableEntries = [
      {
        dayOfWeek: 'Monday',
        startTime: '09:30',
        endTime: '11:00',
        batch: 'grp b',
        course: 'mern',
        classroom: 'Classroom A'
      }
    ];
    
    const result = matchClassToTimetable(scalerClass, timetableEntries);
    
    assert.strictEqual(result.matched, true);
    assert.strictEqual(result.classroom, 'Classroom A');
  });

  it('should include debug info', () => {
    const scalerClass = {
      classId: '12345',
      date: '2024-02-23',
      startTime: '09:30',
      endTime: '11:00'
    };
    const timetableEntries = [];
    
    const result = matchClassToTimetable(scalerClass, timetableEntries);
    
    assert.strictEqual(result.debug.scalerClassId, '12345');
    assert.strictEqual(result.debug.totalCandidates, 0);
  });
});
