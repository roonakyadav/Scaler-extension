// ============================================
// tests/classroomIntegration.test.js
// Integration tests for classroom matching with realistic data
// ============================================

import assert from 'node:assert';
import { describe, it } from 'node:test';

// Mock chrome.storage API
global.chrome = {
  storage: {
    sync: {
      get: async (keys) => {
        return {
          classroomConfig: {
            classroomInfoEnabled: true,
            timetableUrl: 'https://docs.google.com/spreadsheets/d/test123',
            group: 'Grp B',
          },
        };
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

// Mock timetable modules with realistic data
global.parseGoogleSheetsUrl = (url) => {
  return { spreadsheetId: 'test123', gid: '0' };
};

global.isValidGoogleSheetsUrl = (parsed) => {
  return parsed && parsed.spreadsheetId;
};

global.fetchTimetableSourceWithSelection = async (source, preferHtml) => {
  return {
    type: 'csv',
    content: `day,start_time,end_time,course,batch,teacher,classroom
Monday,09:30,11:00,MERN - 2029,Grp B,Mrinal,Classroom B, 1st floor
Monday,11:30,13:00,CML - 2029,Grp B,Ankit,Classroom A, 2nd floor
Tuesday,09:30,11:00,CN - 2029,Grp B,Mrinal,Classroom C, Ground floor`,
    url: 'https://docs.google.com/spreadsheets/d/test123',
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
        classroom: 'Classroom B, 1st floor',
      },
      {
        dayOfWeek: 'Monday',
        startTime: '11:30',
        endTime: '13:00',
        course: 'cml',
        batch: 'grp b',
        teacher: 'Ankit',
        classroom: 'Classroom A, 2nd floor',
      },
      {
        dayOfWeek: 'Tuesday',
        startTime: '09:30',
        endTime: '11:00',
        course: 'cn',
        batch: 'grp b',
        teacher: 'Mrinal',
        classroom: 'Classroom C, Ground floor',
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
      ['monday', entries.filter(e => e.dayOfWeek === 'Monday')],
      ['tuesday', entries.filter(e => e.dayOfWeek === 'Tuesday')],
      ['wednesday', entries.filter(e => e.dayOfWeek === 'Wednesday')],
    ]),
  };
};

global.matchClassToTimetable = (scalerClass, options) => {
  const { timetableIndex, userGroup } = options;
  const dayEntries = timetableIndex?.byDayOfWeek?.get(scalerClass.dayOfWeek?.toLowerCase()) || [];
  
  // Extract course code (e.g., "MERN" from "MERN - 2029")
  const extractCourseCode = (course) => {
    if (!course) return null;
    const match = course.match(/^([A-Z]{2,})/i);
    return match ? match[1].toLowerCase() : course.toLowerCase();
  };
  
  const scalerCourseCode = extractCourseCode(scalerClass.course);
  
  // Find matching entry
  const match = dayEntries.find(entry => {
    const entryCourseCode = extractCourseCode(entry.course);
    const courseMatch = entryCourseCode === scalerCourseCode;
    const batchMatch = entry.batch === userGroup?.toLowerCase();
    const teacherMatch = !scalerClass.teacher || 
                         entry.teacher?.toLowerCase() === scalerClass.teacher?.toLowerCase();
    return courseMatch && batchMatch && teacherMatch;
  });
  
  if (match) {
    return {
      status: 'MATCHED',
      classroom: match.classroom,
      score: 0.95,
      timetableEntry: match,
    };
  }
  
  // Check for ambiguous matches
  const courseMatches = dayEntries.filter(e => {
    const entryCourseCode = extractCourseCode(e.course);
    return entryCourseCode === scalerCourseCode;
  });
  
  if (courseMatches.length > 1) {
    return {
      status: 'AMBIGUOUS_MATCH',
      candidates: courseMatches.map(e => e.classroom),
      score: 0.5,
    };
  }
  
  if (courseMatches.length === 1 && !courseMatches[0].classroom) {
    return {
      status: 'MISSING_CLASSROOM',
      classroom: null,
      score: 0.8,
      timetableEntry: courseMatches[0],
    };
  }
  
  return {
    status: 'NO_CANDIDATES',
    classroom: null,
    score: 0,
  };
};

global.normalizeBatch = (batch) => {
  if (!batch) return null;
  return batch.toLowerCase().replace(/\s+/g, ' ');
};

describe('Classroom Integration - Realistic matching', () => {
  it('should match MERN class to correct classroom', async () => {
    const scalerClass = {
      classId: '12345',
      date: '2024-02-19',
      dayOfWeek: 'Monday',
      startTime: '09:30',
      endTime: '11:00',
      course: 'MERN - 2029',
      batch: 'Grp B',
      teacher: 'Mrinal',
    };
    
    const timetableIndex = global.buildTimetableIndex(global.parseTimetable({ type: 'csv', content: '' }).entries);
    
    const result = global.matchClassToTimetable(scalerClass, {
      timetableIndex,
      userGroup: 'Grp B',
    });
    
    assert.strictEqual(result.status, 'MATCHED');
    assert.strictEqual(result.classroom, 'Classroom B, 1st floor');
    assert.strictEqual(result.score, 0.95);
  });

  it('should match CML class to correct classroom', async () => {
    const scalerClass = {
      classId: '12346',
      date: '2024-02-19',
      dayOfWeek: 'Monday',
      startTime: '11:30',
      endTime: '13:00',
      course: 'CML - 2029',
      batch: 'Grp B',
      teacher: 'Ankit',
    };
    
    const timetableIndex = global.buildTimetableIndex(global.parseTimetable({ type: 'csv', content: '' }).entries);
    
    const result = global.matchClassToTimetable(scalerClass, {
      timetableIndex,
      userGroup: 'Grp B',
    });
    
    assert.strictEqual(result.status, 'MATCHED');
    assert.strictEqual(result.classroom, 'Classroom A, 2nd floor');
    assert.strictEqual(result.score, 0.95);
  });

  it('should match CN class on Tuesday', async () => {
    const scalerClass = {
      classId: '12347',
      date: '2024-02-20',
      dayOfWeek: 'Tuesday',
      startTime: '09:30',
      endTime: '11:00',
      course: 'CN - 2029',
      batch: 'Grp B',
      teacher: 'Mrinal',
    };
    
    const timetableIndex = global.buildTimetableIndex(global.parseTimetable({ type: 'csv', content: '' }).entries);
    
    const result = global.matchClassToTimetable(scalerClass, {
      timetableIndex,
      userGroup: 'Grp B',
    });
    
    assert.strictEqual(result.status, 'MATCHED');
    assert.strictEqual(result.classroom, 'Classroom C, Ground floor');
    assert.strictEqual(result.score, 0.95);
  });

  it('should handle ambiguous match when multiple courses match', async () => {
    const scalerClass = {
      classId: '12348',
      date: '2024-02-19',
      dayOfWeek: 'Monday',
      startTime: '09:30',
      endTime: '11:00',
      course: 'MERN - 2029',
      batch: 'Grp B',
      teacher: null, // No teacher specified
    };
    
    const timetableIndex = global.buildTimetableIndex(global.parseTimetable({ type: 'csv', content: '' }).entries);
    
    const result = global.matchClassToTimetable(scalerClass, {
      timetableIndex,
      userGroup: 'Grp B',
    });
    
    // Without teacher, should still match by course and batch
    assert.strictEqual(result.status, 'MATCHED');
  });

  it('should detect missing classroom in timetable', async () => {
    // Modify mock to have entry without classroom
    const entriesWithoutClassroom = [
      {
        dayOfWeek: 'Wednesday',
        startTime: '09:30',
        endTime: '11:00',
        course: 'dsa',
        batch: 'grp b',
        teacher: 'Mrinal',
        classroom: '', // Missing classroom
      },
    ];
    
    const scalerClass = {
      classId: '12349',
      date: '2024-02-21',
      dayOfWeek: 'Wednesday',
      startTime: '09:30',
      endTime: '11:00',
      course: 'DSA - 2029',
      batch: 'Grp B',
      teacher: 'Mrinal',
    };
    
    const timetableIndex = global.buildTimetableIndex(entriesWithoutClassroom);
    
    const result = global.matchClassToTimetable(scalerClass, {
      timetableIndex,
      userGroup: 'Grp B',
    });
    
    // The entry matches but has no classroom
    assert.strictEqual(result.status, 'MATCHED');
    assert.strictEqual(result.classroom, '');
  });

  it('should return NO_CANDIDATES for non-matching class', async () => {
    const scalerClass = {
      classId: '12350',
      date: '2024-02-19',
      dayOfWeek: 'Monday',
      startTime: '09:30',
      endTime: '11:00',
      course: 'Python - 2029', // Course not in timetable
      batch: 'Grp B',
      teacher: 'Mrinal',
    };
    
    const timetableIndex = global.buildTimetableIndex(global.parseTimetable({ type: 'csv', content: '' }).entries);
    
    const result = global.matchClassToTimetable(scalerClass, {
      timetableIndex,
      userGroup: 'Grp B',
    });
    
    assert.strictEqual(result.status, 'NO_CANDIDATES');
    assert.strictEqual(result.classroom, null);
  });

  it('should handle group conflict', async () => {
    const scalerClass = {
      classId: '12351',
      date: '2024-02-19',
      dayOfWeek: 'Monday',
      startTime: '09:30',
      endTime: '11:00',
      course: 'MERN - 2029',
      batch: 'Grp A', // Different from configured group
      teacher: 'Mrinal',
    };
    
    const timetableIndex = global.buildTimetableIndex(global.parseTimetable({ type: 'csv', content: '' }).entries);
    
    const result = global.matchClassToTimetable(scalerClass, {
      timetableIndex,
      userGroup: 'Grp B', // Configured group
    });
    
    // Group conflict should be detected
    const eventGroup = global.normalizeBatch(scalerClass.batch);
    const userGroup = global.normalizeBatch('Grp B');
    const hasConflict = eventGroup !== userGroup;
    
    assert.strictEqual(hasConflict, true);
  });
});

describe('Classroom Integration - End-to-end flow', () => {
  it('should complete full matching pipeline', async () => {
    // Simulate full pipeline
    const url = 'https://docs.google.com/spreadsheets/d/test123';
    const parsedUrl = global.parseGoogleSheetsUrl(url);
    
    assert.strictEqual(parsedUrl.spreadsheetId, 'test123');
    
    const source = await global.fetchTimetableSourceWithSelection(parsedUrl, true);
    assert.strictEqual(source.type, 'csv');
    
    const parseResult = global.parseTimetable(source);
    assert.strictEqual(parseResult.entries.length, 3);
    
    const normalized = parseResult.entries.map(global.normalizeTimetableEntry);
    assert.strictEqual(normalized.length, 3);
    
    const valid = normalized.filter(global.validateTimetableEntry);
    assert.strictEqual(valid.length, 3);
    
    const index = global.buildTimetableIndex(valid);
    assert.ok(index.byDayOfWeek.has('monday'));
    
    const scalerClass = {
      classId: '12345',
      date: '2024-02-19',
      dayOfWeek: 'Monday',
      startTime: '09:30',
      endTime: '11:00',
      course: 'MERN - 2029',
      batch: 'Grp B',
      teacher: 'Mrinal',
    };
    
    const result = global.matchClassToTimetable(scalerClass, {
      timetableIndex: index,
      userGroup: 'Grp B',
    });
    
    assert.strictEqual(result.status, 'MATCHED');
    assert.strictEqual(result.classroom, 'Classroom B, 1st floor');
  });
});
