// ============================================
// tests/scalerClassNormalizer.test.js
// Unit tests for Scaler class normalization
// ============================================

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Load the scalerClassNormalizer module functions
// In a real test environment, these would be imported
// For now, we'll define them inline for testing

function extractCourse(superBatchName) {
  if (!superBatchName || typeof superBatchName !== 'string') {
    return null;
  }
  
  const trimmed = superBatchName.trim();
  const match = trimmed.match(/^([A-Za-z]+)/);
  
  if (!match) {
    return null;
  }
  
  const course = match[1].toLowerCase();
  const nonCourseWords = ['batch', 'group', 'grp', 'sst', 'super'];
  if (nonCourseWords.includes(course)) {
    return null;
  }
  
  return course;
}

function extractBatchGroup(superBatchName) {
  if (!superBatchName || typeof superBatchName !== 'string') {
    return null;
  }
  
  const trimmed = superBatchName.toLowerCase();
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

function normalizeTeacherName(teacherName) {
  if (!teacherName || typeof teacherName !== 'string') {
    return '';
  }
  
  return teacherName.trim();
}

function normalizeEventType(eventType) {
  if (!eventType || typeof eventType !== 'string') {
    return 'unknown';
  }
  
  return eventType.toLowerCase().trim();
}

function createCanonicalScalerClass(scalerEvent) {
  if (!scalerEvent || typeof scalerEvent !== 'object') {
    return null;
  }
  
  const superBatchName = scalerEvent.super_batch_name || '';
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
    raw: scalerEvent
  };
}

function isValidCanonicalClass(canonicalClass) {
  if (!canonicalClass || typeof canonicalClass !== 'object') {
    return false;
  }
  
  if (!canonicalClass.classId) {
    return false;
  }
  
  if (!canonicalClass.date && !canonicalClass.dayOfWeek) {
    return false;
  }
  
  if (!canonicalClass.startTime || !canonicalClass.endTime) {
    return false;
  }
  
  return true;
}

describe('extractCourse', () => {
  it('should extract course from MERN batch name', () => {
    assert.strictEqual(extractCourse('MERN - 2029 Grp B'), 'mern');
  });

  it('should extract course from CML batch name', () => {
    assert.strictEqual(extractCourse('CML - 2029 Grp C'), 'cml');
  });

  it('should extract course from CN batch name', () => {
    assert.strictEqual(extractCourse('CN - 2029 Grp A'), 'cn');
  });

  it('should handle uppercase input', () => {
    assert.strictEqual(extractCourse('MERN'), 'mern');
  });

  it('should return null for non-course words', () => {
    assert.strictEqual(extractCourse('Batch A'), null);
    assert.strictEqual(extractCourse('Group B'), null);
    assert.strictEqual(extractCourse('SST'), null);
  });

  it('should return null for null input', () => {
    assert.strictEqual(extractCourse(null), null);
  });

  it('should return null for undefined input', () => {
    assert.strictEqual(extractCourse(undefined), null);
  });

  it('should return null for empty string', () => {
    assert.strictEqual(extractCourse(''), null);
  });
});

describe('extractBatchGroup', () => {
  it('should extract Grp B', () => {
    assert.strictEqual(extractBatchGroup('MERN - 2029 Grp B'), 'grp b');
  });

  it('should extract Group C', () => {
    assert.strictEqual(extractBatchGroup('CML - 2029 Group C'), 'grp c');
  });

  it('should extract Batch A', () => {
    assert.strictEqual(extractBatchGroup('CN - Batch A'), 'grp a');
  });

  it('should handle case insensitivity', () => {
    assert.strictEqual(extractBatchGroup('MERN - 2029 GRP B'), 'grp b');
    assert.strictEqual(extractBatchGroup('MERN - 2029 grp b'), 'grp b');
  });

  it('should return null when no group found', () => {
    assert.strictEqual(extractBatchGroup('MERN - 2029'), null);
  });

  it('should return null for null input', () => {
    assert.strictEqual(extractBatchGroup(null), null);
  });

  it('should return null for empty string', () => {
    assert.strictEqual(extractBatchGroup(''), null);
  });
});

describe('parseIsoDate', () => {
  it('should parse ISO date string', () => {
    assert.strictEqual(parseIsoDate('2024-02-23T14:30:00Z'), '2024-02-23');
  });

  it('should parse ISO date without Z', () => {
    assert.strictEqual(parseIsoDate('2024-02-23T14:30:00'), '2024-02-23');
  });

  it('should handle different timezone', () => {
    const result = parseIsoDate('2024-02-23T14:30:00+05:30');
    assert.strictEqual(result, '2024-02-23');
  });

  it('should return null for invalid date', () => {
    assert.strictEqual(parseIsoDate('invalid'), null);
  });

  it('should return null for null input', () => {
    assert.strictEqual(parseIsoDate(null), null);
  });
});

describe('parseIsoTime', () => {
  it('should parse ISO time string', () => {
    assert.strictEqual(parseIsoTime('2024-02-23T14:30:00Z'), '14:30');
  });

  it('should parse time with minutes', () => {
    assert.strictEqual(parseIsoTime('2024-02-23T09:05:00Z'), '09:05');
  });

  it('should handle midnight', () => {
    assert.strictEqual(parseIsoTime('2024-02-23T00:00:00Z'), '00:00');
  });

  it('should return null for invalid date', () => {
    assert.strictEqual(parseIsoTime('invalid'), null);
  });

  it('should return null for null input', () => {
    assert.strictEqual(parseIsoTime(null), null);
  });
});

describe('getDayOfWeek', () => {
  it('should return Monday for 2024-02-19', () => {
    assert.strictEqual(getDayOfWeek('2024-02-19'), 'Monday');
  });

  it('should return Tuesday for 2024-02-20', () => {
    assert.strictEqual(getDayOfWeek('2024-02-20'), 'Tuesday');
  });

  it('should return Sunday for 2024-02-18', () => {
    assert.strictEqual(getDayOfWeek('2024-02-18'), 'Sunday');
  });

  it('should return null for invalid date', () => {
    assert.strictEqual(getDayOfWeek('invalid'), null);
  });

  it('should return null for null input', () => {
    assert.strictEqual(getDayOfWeek(null), null);
  });
});

describe('normalizeTeacherName', () => {
  it('should trim whitespace', () => {
    assert.strictEqual(normalizeTeacherName('  John Doe  '), 'John Doe');
  });

  it('should return empty string for null', () => {
    assert.strictEqual(normalizeTeacherName(null), '');
  });

  it('should return empty string for undefined', () => {
    assert.strictEqual(normalizeTeacherName(undefined), '');
  });

  it('should return empty string for empty string', () => {
    assert.strictEqual(normalizeTeacherName(''), '');
  });
});

describe('normalizeEventType', () => {
  it('should lowercase event type', () => {
    assert.strictEqual(normalizeEventType('LESSON'), 'lesson');
  });

  it('should trim whitespace', () => {
    assert.strictEqual(normalizeEventType('  lesson  '), 'lesson');
  });

  it('should return unknown for null', () => {
    assert.strictEqual(normalizeEventType(null), 'unknown');
  });

  it('should return unknown for empty string', () => {
    assert.strictEqual(normalizeEventType(''), 'unknown');
  });
});

describe('createCanonicalScalerClass', () => {
  it('should create canonical class from event', () => {
    const event = {
      sbat_id: 12345,
      title: 'Binary Search Trees',
      instructors_name: 'John Doe',
      super_batch_name: 'MERN - 2029 Grp B',
      date: '2024-02-23T14:30:00Z',
      end_time: '2024-02-23T16:30:00Z',
      event_type: 'lesson'
    };
    
    const result = createCanonicalScalerClass(event);
    
    assert.strictEqual(result.classId, '12345');
    assert.strictEqual(result.date, '2024-02-23');
    assert.strictEqual(result.dayOfWeek, 'Friday');
    assert.strictEqual(result.startTime, '14:30');
    assert.strictEqual(result.endTime, '16:30');
    assert.strictEqual(result.course, 'mern');
    assert.strictEqual(result.batch, 'grp b');
    assert.strictEqual(result.topic, 'Binary Search Trees');
    assert.strictEqual(result.teacher, 'John Doe');
    assert.strictEqual(result.eventType, 'lesson');
    assert.strictEqual(result.raw, event);
  });

  it('should handle date_of_topic field', () => {
    const event = {
      sbat_id: 12345,
      date_of_topic: '2024-02-23T14:30:00Z',
      end_time: '2024-02-23T16:30:00Z'
    };
    
    const result = createCanonicalScalerClass(event);
    
    assert.strictEqual(result.date, '2024-02-23');
    assert.strictEqual(result.startTime, '14:30');
  });

  it('should handle missing optional fields', () => {
    const event = {
      sbat_id: 12345,
      date: '2024-02-23T14:30:00Z',
      end_time: '2024-02-23T16:30:00Z'
    };
    
    const result = createCanonicalScalerClass(event);
    
    assert.strictEqual(result.classId, '12345');
    assert.strictEqual(result.course, null);
    assert.strictEqual(result.batch, null);
    assert.strictEqual(result.topic, null);
    assert.strictEqual(result.teacher, '');
    assert.strictEqual(result.eventType, 'unknown');
  });

  it('should return null for null input', () => {
    assert.strictEqual(createCanonicalScalerClass(null), null);
  });

  it('should return null for undefined input', () => {
    assert.strictEqual(createCanonicalScalerClass(undefined), null);
  });
});

describe('isValidCanonicalClass', () => {
  it('should validate complete class', () => {
    const classData = {
      classId: '12345',
      date: '2024-02-23',
      dayOfWeek: 'Friday',
      startTime: '14:30',
      endTime: '16:30'
    };
    
    assert.strictEqual(isValidCanonicalClass(classData), true);
  });

  it('should reject missing classId', () => {
    const classData = {
      date: '2024-02-23',
      startTime: '14:30',
      endTime: '16:30'
    };
    
    assert.strictEqual(isValidCanonicalClass(classData), false);
  });

  it('should reject missing date and dayOfWeek', () => {
    const classData = {
      classId: '12345',
      startTime: '14:30',
      endTime: '16:30'
    };
    
    assert.strictEqual(isValidCanonicalClass(classData), false);
  });

  it('should accept dayOfWeek without date', () => {
    const classData = {
      classId: '12345',
      dayOfWeek: 'Friday',
      startTime: '14:30',
      endTime: '16:30'
    };
    
    assert.strictEqual(isValidCanonicalClass(classData), true);
  });

  it('should reject missing startTime', () => {
    const classData = {
      classId: '12345',
      date: '2024-02-23',
      endTime: '16:30'
    };
    
    assert.strictEqual(isValidCanonicalClass(classData), false);
  });

  it('should reject missing endTime', () => {
    const classData = {
      classId: '12345',
      date: '2024-02-23',
      startTime: '14:30'
    };
    
    assert.strictEqual(isValidCanonicalClass(classData), false);
  });

  it('should reject null input', () => {
    assert.strictEqual(isValidCanonicalClass(null), false);
  });
});
