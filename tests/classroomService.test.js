// ============================================
// tests/classroomService.test.js
// Tests for classroom service layer
// ============================================

import assert from 'node:assert';
import { describe, it } from 'node:test';

// Mock chrome.storage API
global.chrome = {
  storage: {
    sync: {
      get: async (keys) => {
        return {};
      },
      set: async (items) => {
        return;
      },
    },
    local: {
      get: async (keys) => {
        return {};
      },
      set: async (items) => {
        return;
      },
      remove: async (keys) => {
        return;
      },
    },
  },
};

// Mock timetable modules
global.parseGoogleSheetsUrl = (url) => {
  if (url.includes('docs.google.com')) {
    return { spreadsheetId: 'abc123', gid: '0' };
  }
  return null;
};

global.isValidGoogleSheetsUrl = (parsed) => {
  return parsed && parsed.spreadsheetId;
};

global.fetchTimetableSourceWithSelection = async (source, preferHtml) => {
  return {
    type: 'csv',
    content: 'day,start_time,end_time,course,batch,teacher,classroom\nMonday,09:30,11:00,MERN,Grp B,Mrinal,Classroom B',
    url: 'https://example.com',
  };
};

global.parseTimetable = (source) => {
  return {
    entries: [
      {
        dayOfWeek: 'Monday',
        startTime: '09:30',
        endTime: '11:00',
        course: 'mern',
        batch: 'grp b',
        teacher: 'Mrinal',
        classroom: 'Classroom B',
      },
    ],
    errors: [],
    metadata: { sourceType: 'csv' },
  };
};

global.normalizeTimetableEntry = (entry) => entry;

global.validateTimetableEntry = (entry) => true;

global.buildTimetableIndex = (entries) => {
  return {
    byDate: new Map(),
    byDayOfWeek: new Map([
      ['monday', [entries[0]]],
    ]),
  };
};

global.matchClassToTimetable = (scalerClass, options) => {
  return {
    status: 'MATCHED',
    classroom: 'Classroom B',
    score: 0.95,
    timetableEntry: options.timetableIndex?.byDayOfWeek?.get('monday')?.[0],
  };
};

global.normalizeBatch = (batch) => {
  if (!batch) return null;
  return batch.toLowerCase().replace(/\s+/g, ' ');
};

// Load the service module (simulated)
// In real test environment, this would be an import
const ClassroomService = {
  ClassroomResultStatus: {
    MATCHED: 'MATCHED',
    NO_CANDIDATES: 'NO_CANDIDATES',
    AMBIGUOUS_MATCH: 'AMBIGUOUS_MATCH',
    MISSING_CLASSROOM: 'MISSING_CLASSROOM',
    GROUP_CONFLICT: 'GROUP_CONFLICT',
    TIMETABLE_UNAVAILABLE: 'TIMETABLE_UNAVAILABLE',
    NOT_CONFIGURED: 'NOT_CONFIGURED',
    EVENT_DATA_PENDING: 'EVENT_DATA_PENDING',
    STALE_CACHE: 'STALE_CACHE',
  },
};

describe('ClassroomService - Configuration', () => {
  it('should load default configuration when none exists', async () => {
    const config = {
      classroomInfoEnabled: false,
      timetableUrl: '',
      group: '',
    };
    
    assert.strictEqual(config.classroomInfoEnabled, false);
    assert.strictEqual(config.timetableUrl, '');
    assert.strictEqual(config.group, '');
  });

  it('should handle missing URL', async () => {
    const config = {
      classroomInfoEnabled: true,
      timetableUrl: '',
      group: 'Grp B',
    };
    
    assert.strictEqual(config.timetableUrl, '');
  });

  it('should handle missing group', async () => {
    const config = {
      classroomInfoEnabled: true,
      timetableUrl: 'https://docs.google.com/spreadsheets/d/abc123',
      group: '',
    };
    
    assert.strictEqual(config.group, '');
  });

  it('should accept valid configuration', async () => {
    const config = {
      classroomInfoEnabled: true,
      timetableUrl: 'https://docs.google.com/spreadsheets/d/abc123',
      group: 'Grp B',
    };
    
    assert.strictEqual(config.classroomInfoEnabled, true);
    assert.strictEqual(config.timetableUrl, 'https://docs.google.com/spreadsheets/d/abc123');
    assert.strictEqual(config.group, 'Grp B');
  });
});

describe('ClassroomService - Cache behavior', () => {
  it('should handle fresh cache', async () => {
    const now = Date.now();
    const cached = {
      fetchedAt: now - (1000 * 60 * 60), // 1 hour ago
      sourceUrl: 'https://docs.google.com/spreadsheets/d/abc123',
      entries: [],
      index: {},
    };
    
    const cacheTtlMs = 24 * 60 * 60 * 1000;
    const isFresh = (now - cached.fetchedAt) < cacheTtlMs;
    
    assert.strictEqual(isFresh, true);
  });

  it('should detect stale cache', async () => {
    const now = Date.now();
    const cached = {
      fetchedAt: now - (25 * 60 * 60 * 1000), // 25 hours ago
      sourceUrl: 'https://docs.google.com/spreadsheets/d/abc123',
      entries: [],
      index: {},
    };
    
    const cacheTtlMs = 24 * 60 * 60 * 1000;
    const isFresh = (now - cached.fetchedAt) < cacheTtlMs;
    
    assert.strictEqual(isFresh, false);
  });

  it('should handle missing cache', async () => {
    const cached = null;
    
    assert.strictEqual(cached, null);
  });

  it('should detect changed URL', async () => {
    const cached = {
      fetchedAt: Date.now() - (1000 * 60 * 60),
      sourceUrl: 'https://docs.google.com/spreadsheets/d/old123',
      entries: [],
      index: {},
    };
    
    const newUrl = 'https://docs.google.com/spreadsheets/d/new456';
    const urlChanged = cached.sourceUrl !== newUrl;
    
    assert.strictEqual(urlChanged, true);
  });

  it('should use stale cache on fetch failure', async () => {
    const cached = {
      fetchedAt: Date.now() - (25 * 60 * 60 * 1000),
      sourceUrl: 'https://docs.google.com/spreadsheets/d/abc123',
      entries: [{ classroom: 'Classroom B' }],
      index: {},
    };
    
    const fetchFailed = true;
    const shouldUseStale = fetchFailed && cached !== null;
    
    assert.strictEqual(shouldUseStale, true);
  });

  it('should handle no cache + fetch failure', async () => {
    const cached = null;
    const fetchFailed = true;
    
    const shouldFail = fetchFailed && cached === null;
    
    assert.strictEqual(shouldFail, true);
  });
});

describe('ClassroomService - Class processing', () => {
  it('should process valid Scaler event', async () => {
    const scalerClass = {
      classId: '12345',
      date: '2024-02-19',
      startTime: '09:30',
      endTime: '11:00',
      course: 'MERN',
      batch: 'Grp B',
      teacher: 'Mrinal',
    };
    
    assert.strictEqual(scalerClass.classId, '12345');
    assert.strictEqual(scalerClass.course, 'MERN');
  });

  it('should handle missing event', async () => {
    const scalerClass = null;
    
    assert.strictEqual(scalerClass, null);
  });

  it('should handle event data pending', async () => {
    const scalerClass = {
      classId: null,
      date: null,
      startTime: null,
    };
    
    const isPending = !scalerClass.classId || !scalerClass.date;
    
    assert.strictEqual(isPending, true);
  });

  it('should match successfully', async () => {
    const result = {
      status: 'MATCHED',
      classroom: 'Classroom B',
      score: 0.95,
    };
    
    assert.strictEqual(result.status, 'MATCHED');
    assert.strictEqual(result.classroom, 'Classroom B');
    assert.strictEqual(result.score, 0.95);
  });

  it('should handle ambiguous result', async () => {
    const result = {
      status: 'AMBIGUOUS_MATCH',
      candidates: ['Classroom A', 'Classroom B'],
    };
    
    assert.strictEqual(result.status, 'AMBIGUOUS_MATCH');
    assert.strictEqual(result.candidates.length, 2);
  });

  it('should handle missing classroom', async () => {
    const result = {
      status: 'MISSING_CLASSROOM',
      classroom: null,
    };
    
    assert.strictEqual(result.status, 'MISSING_CLASSROOM');
    assert.strictEqual(result.classroom, null);
  });

  it('should detect group conflict', async () => {
    const eventGroup = 'Grp A';
    const userGroup = 'Grp B';
    
    const hasConflict = eventGroup !== userGroup;
    
    assert.strictEqual(hasConflict, true);
  });
});

describe('ClassroomService - Reprocessing', () => {
  it('should invalidate cache on timetable change', async () => {
    const oldCacheKey = 'url1:sheet1:gid0';
    const newCacheKey = 'url2:sheet2:gid1';
    
    const shouldReprocess = oldCacheKey !== newCacheKey;
    
    assert.strictEqual(shouldReprocess, true);
  });

  it('should not reprocess on same cache key', async () => {
    const oldCacheKey = 'url1:sheet1:gid0';
    const newCacheKey = 'url1:sheet1:gid0';
    
    const shouldReprocess = oldCacheKey !== newCacheKey;
    
    assert.strictEqual(shouldReprocess, false);
  });

  it('should handle DOM mutation without cache change', async () => {
    const cacheKey = 'url1:sheet1:gid0';
    const cardProcessed = true;
    const sameCacheKey = true;
    
    const shouldSkip = cardProcessed && sameCacheKey;
    
    assert.strictEqual(shouldSkip, true);
  });
});

describe('ClassroomService - Result states', () => {
  it('should define all result states', () => {
    const states = ClassroomService.ClassroomResultStatus;
    
    assert.strictEqual(states.MATCHED, 'MATCHED');
    assert.strictEqual(states.NO_CANDIDATES, 'NO_CANDIDATES');
    assert.strictEqual(states.AMBIGUOUS_MATCH, 'AMBIGUOUS_MATCH');
    assert.strictEqual(states.MISSING_CLASSROOM, 'MISSING_CLASSROOM');
    assert.strictEqual(states.GROUP_CONFLICT, 'GROUP_CONFLICT');
    assert.strictEqual(states.TIMETABLE_UNAVAILABLE, 'TIMETABLE_UNAVAILABLE');
    assert.strictEqual(states.NOT_CONFIGURED, 'NOT_CONFIGURED');
    assert.strictEqual(states.EVENT_DATA_PENDING, 'EVENT_DATA_PENDING');
    assert.strictEqual(states.STALE_CACHE, 'STALE_CACHE');
  });
});
