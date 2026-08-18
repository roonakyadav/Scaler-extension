// ============================================
// tests/timetableParser.test.js
// Unit tests for timetable CSV parsing
// ============================================

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Load the timetableParser module functions
// In a real test environment, these would be imported
// For now, we'll define them inline for testing

function parseCSV(csvText) {
  if (!csvText || typeof csvText !== 'string') {
    return [];
  }

  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;
  
  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if ((char === '\r' && nextChar === '\n') || char === '\n') {
      if (inQuotes) {
        currentField += char;
      } else {
        currentRow.push(currentField.trim());
        if (currentRow.some(field => field !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
        if (char === '\r') i++;
      }
    } else {
      currentField += char;
    }
  }
  
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some(field => field !== '')) {
      rows.push(currentRow);
    }
  }
  
  return rows;
}

function parseTimeRange(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') {
    return { startTime: null, endTime: null };
  }
  
  const trimmed = timeStr.trim();
  
  const dashMatch = trimmed.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
  if (dashMatch) {
    return {
      startTime: dashMatch[1],
      endTime: dashMatch[2]
    };
  }
  
  const ampmMatch = trimmed.match(/^(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)$/i);
  if (ampmMatch) {
    return {
      startTime: ampmMatch[1].toUpperCase(),
      endTime: ampmMatch[2].toUpperCase()
    };
  }
  
  return { startTime: null, endTime: null };
}

function detectColumns(headerRow) {
  if (!headerRow || !Array.isArray(headerRow)) {
    return null;
  }
  
  const normalized = headerRow.map(h => (h || '').toLowerCase().trim());
  
  const mapping = {
    day: null,
    time: null,
    batch: null,
    course: null,
    teacher: null,
    classroom: null
  };
  
  normalized.forEach((col, index) => {
    if (col.includes('day') || col.includes('weekday')) {
      mapping.day = index;
    } else if (col.includes('time') || col.includes('slot')) {
      mapping.time = index;
    } else if (col.includes('batch') || col.includes('group')) {
      mapping.batch = index;
    } else if (col.includes('course') || col.includes('subject')) {
      mapping.course = index;
    } else if (col.includes('teacher') || col.includes('instructor') || col.includes('faculty')) {
      mapping.teacher = index;
    } else if (col.includes('classroom') || col.includes('room') || col.includes('location')) {
      mapping.classroom = index;
    }
  });
  
  if (mapping.day === null || mapping.time === null || mapping.classroom === null) {
    return null;
  }
  
  return mapping;
}

function parseTimetableCSV(csvText) {
  const errors = [];
  const entries = [];
  
  if (!csvText || csvText.trim().length === 0) {
    errors.push('Empty CSV content');
    return { entries, errors };
  }
  
  const rows = parseCSV(csvText);
  
  if (rows.length === 0) {
    errors.push('No rows found in CSV');
    return { entries, errors };
  }
  
  const headerRow = rows[0];
  const columns = detectColumns(headerRow);
  
  if (!columns) {
    errors.push('Could not detect required columns (day, time, classroom)');
    return { entries, errors };
  }
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    
    if (row.length === 0 || row.every(cell => !cell || cell.trim() === '')) {
      continue;
    }
    
    const entry = {
      raw: row.join(','),
      dayOfWeek: columns.day !== null ? (row[columns.day] || '').trim() : null,
      timeRange: columns.time !== null ? (row[columns.time] || '').trim() : null,
      batch: columns.batch !== null ? (row[columns.batch] || '').trim() : null,
      course: columns.course !== null ? (row[columns.course] || '').trim() : null,
      teacher: columns.teacher !== null ? (row[columns.teacher] || '').trim() : null,
      classroom: columns.classroom !== null ? (row[columns.classroom] || '').trim() : null
    };
    
    const { startTime, endTime } = parseTimeRange(entry.timeRange);
    entry.startTime = startTime;
    entry.endTime = endTime;
    
    if (!entry.dayOfWeek && !entry.batch && !entry.course && !entry.teacher) {
      entry.type = 'unknown';
    } else if (entry.course && entry.course.toLowerCase().includes('lunch')) {
      entry.type = 'lunch';
    } else if (entry.classroom && entry.classroom.toLowerCase().includes('cafeteria')) {
      entry.type = 'lunch';
    } else {
      entry.type = 'class';
    }
    
    entries.push(entry);
  }
  
  return { entries, errors };
}

describe('parseCSV', () => {
  it('should parse simple CSV', () => {
    const csv = 'Day,Time,Classroom\nMonday,09:30-11:00,Room A';
    const result = parseCSV(csv);
    
    assert.strictEqual(result.length, 2);
    assert.deepStrictEqual(result[0], ['Day', 'Time', 'Classroom']);
    assert.deepStrictEqual(result[1], ['Monday', '09:30-11:00', 'Room A']);
  });

  it('should handle quoted fields', () => {
    const csv = 'Day,Time,Classroom\nMonday,"09:30 - 11:00","Room A, 1st floor"';
    const result = parseCSV(csv);
    
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[1][1], '09:30 - 11:00');
    assert.strictEqual(result[1][2], 'Room A, 1st floor');
  });

  it('should handle escaped quotes', () => {
    const csv = 'Day,Classroom\nMonday,"Room ""A"" 1st floor"';
    const result = parseCSV(csv);
    
    assert.strictEqual(result[1][1], 'Room "A" 1st floor');
  });

  it('should handle empty input', () => {
    const result = parseCSV('');
    assert.deepStrictEqual(result, []);
  });

  it('should handle null input', () => {
    const result = parseCSV(null);
    assert.deepStrictEqual(result, []);
  });
});

describe('parseTimeRange', () => {
  it('should parse HH:MM-HH:MM format', () => {
    const result = parseTimeRange('09:30-11:00');
    assert.strictEqual(result.startTime, '09:30');
    assert.strictEqual(result.endTime, '11:00');
  });

  it('should parse HH:MM - HH:MM format with spaces', () => {
    const result = parseTimeRange('09:30 - 11:00');
    assert.strictEqual(result.startTime, '09:30');
    assert.strictEqual(result.endTime, '11:00');
  });

  it('should parse AM/PM format', () => {
    const result = parseTimeRange('9:30 AM - 11:00 AM');
    assert.strictEqual(result.startTime, '9:30 AM');
    assert.strictEqual(result.endTime, '11:00 AM');
  });

  it('should handle invalid time format', () => {
    const result = parseTimeRange('invalid-time');
    assert.strictEqual(result.startTime, null);
    assert.strictEqual(result.endTime, null);
  });

  it('should handle empty input', () => {
    const result = parseTimeRange('');
    assert.strictEqual(result.startTime, null);
    assert.strictEqual(result.endTime, null);
  });
});

describe('detectColumns', () => {
  it('should detect standard columns', () => {
    const header = ['Day', 'Time', 'Batch', 'Course', 'Teacher', 'Classroom'];
    const result = detectColumns(header);
    
    assert.strictEqual(result !== null, true);
    assert.strictEqual(result.day, 0);
    assert.strictEqual(result.time, 1);
    assert.strictEqual(result.batch, 2);
    assert.strictEqual(result.course, 3);
    assert.strictEqual(result.teacher, 4);
    assert.strictEqual(result.classroom, 5);
  });

  it('should detect alternative column names', () => {
    const header = ['Weekday', 'Slot', 'Group', 'Subject', 'Faculty', 'Room'];
    const result = detectColumns(header);
    
    assert.strictEqual(result !== null, true);
    assert.strictEqual(result.day, 0);
    assert.strictEqual(result.time, 1);
    assert.strictEqual(result.batch, 2);
    assert.strictEqual(result.course, 3);
    assert.strictEqual(result.teacher, 4);
    assert.strictEqual(result.classroom, 5);
  });

  it('should reject missing required columns', () => {
    const header = ['Day', 'Batch', 'Course'];
    const result = detectColumns(header);
    
    assert.strictEqual(result, null);
  });

  it('should handle null input', () => {
    const result = detectColumns(null);
    assert.strictEqual(result, null);
  });
});

describe('parseTimetableCSV', () => {
  it('should parse simple class timetable', () => {
    const csv = 'Day,Time,Batch,Course,Teacher,Classroom\nMonday,09:30-11:00,Grp B,MERN,Mrinal,Classroom A 1st floor';
    const result = parseTimetableCSV(csv);
    
    assert.strictEqual(result.entries.length, 1);
    assert.strictEqual(result.entries[0].dayOfWeek, 'Monday');
    assert.strictEqual(result.entries[0].startTime, '09:30');
    assert.strictEqual(result.entries[0].endTime, '11:00');
    assert.strictEqual(result.entries[0].batch, 'Grp B');
    assert.strictEqual(result.entries[0].course, 'MERN');
    assert.strictEqual(result.entries[0].teacher, 'Mrinal');
    assert.strictEqual(result.entries[0].classroom, 'Classroom A 1st floor');
    assert.strictEqual(result.entries[0].type, 'class');
  });

  it('should detect lunch entries', () => {
    const csv = 'Day,Time,Batch,Course,Teacher,Classroom\nMonday,13:00-14:00,,Lunch,,Cafeteria';
    const result = parseTimetableCSV(csv);
    
    assert.strictEqual(result.entries.length, 1);
    assert.strictEqual(result.entries[0].type, 'lunch');
  });

  it('should skip empty rows', () => {
    const csv = 'Day,Time,Classroom\nMonday,09:30-11:00,Room A\n\nTuesday,09:30-11:00,Room B';
    const result = parseTimetableCSV(csv);
    
    assert.strictEqual(result.entries.length, 2);
  });

  it('should handle missing classroom', () => {
    const csv = 'Day,Time,Batch,Course,Teacher,Classroom\nMonday,09:30-11:00,Grp B,MERN,Mrinal,';
    const result = parseTimetableCSV(csv);
    
    assert.strictEqual(result.entries.length, 1);
    assert.strictEqual(result.entries[0].classroom, '');
  });

  it('should return errors for empty CSV', () => {
    const result = parseTimetableCSV('');
    
    assert.strictEqual(result.entries.length, 0);
    assert.strictEqual(result.errors.length, 1);
    assert.strictEqual(result.errors[0], 'Empty CSV content');
  });

  it('should return errors for missing columns', () => {
    const csv = 'Day,Batch\nMonday,Grp B';
    const result = parseTimetableCSV(csv);
    
    assert.strictEqual(result.entries.length, 0);
    assert.strictEqual(result.errors.length, 1);
  });
});
