// ============================================
// classroom/timetableParser.js
// Parse CSV timetable data into structured representation
// ============================================

/**
 * Parse CSV content into an array of row objects.
 * Handles quoted fields, commas, and line breaks.
 * 
 * @param {string} csvText - Raw CSV text
 * @returns {Array<Object>} - Array of row objects
 */
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
        // Escaped quote
        currentField += '"';
        i++;
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // Field separator
      currentRow.push(currentField.trim());
      currentField = '';
    } else if ((char === '\r' && nextChar === '\n') || char === '\n') {
      // Row separator
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
  
  // Add last row
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some(field => field !== '')) {
      rows.push(currentRow);
    }
  }
  
  return rows;
}

/**
 * Parse time range string into start and end times.
 * Supports formats: "09:30-11:00", "9:30 AM - 11:00 AM"
 * 
 * @param {string} timeStr - Time range string
 * @returns {{startTime: string|null, endTime: string|null}} - Parsed times
 */
function parseTimeRange(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') {
    return { startTime: null, endTime: null };
  }
  
  const trimmed = timeStr.trim();
  
  // Try format: "09:30-11:00" or "09:30 - 11:00"
  const dashMatch = trimmed.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
  if (dashMatch) {
    return {
      startTime: dashMatch[1],
      endTime: dashMatch[2]
    };
  }
  
  // Try format with AM/PM: "9:30 AM - 11:00 AM"
  const ampmMatch = trimmed.match(/^(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)$/i);
  if (ampmMatch) {
    return {
      startTime: ampmMatch[1].toUpperCase(),
      endTime: ampmMatch[2].toUpperCase()
    };
  }
  
  return { startTime: null, endTime: null };
}

/**
 * Detect column headers from CSV row.
 * 
 * @param {Array<string>} headerRow - First row of CSV
 * @returns {Object|null} - Column mapping or null if not recognized
 */
function detectColumns(headerRow) {
  if (!headerRow || !Array.isArray(headerRow)) {
    return null;
  }
  
  const normalized = headerRow.map(h => (h || '').toLowerCase().trim());
  
  // Try to find column indices
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
  
  // Require at least day, time, and classroom
  if (mapping.day === null || mapping.time === null || mapping.classroom === null) {
    return null;
  }
  
  return mapping;
}

/**
 * Parse CSV timetable into structured entries.
 * 
 * @param {string} csvText - Raw CSV text
 * @returns {{entries: Array<Object>, errors: Array<string>}} - Parsed entries and errors
 */
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
  
  // First row is headers
  const headerRow = rows[0];
  const columns = detectColumns(headerRow);
  
  if (!columns) {
    errors.push('Could not detect required columns (day, time, classroom)');
    return { entries, errors };
  }
  
  // Parse data rows
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    
    if (row.length === 0 || row.every(cell => !cell || cell.trim() === '')) {
      continue; // Skip empty rows
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
    
    // Parse time range
    const { startTime, endTime } = parseTimeRange(entry.timeRange);
    entry.startTime = startTime;
    entry.endTime = endTime;
    
    // Detect entry type
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

/**
 * Parse HTML timetable into structured entries.
 * This is a placeholder for future HTML export parsing.
 * HTML export is needed for complex timetables with merged cells.
 * 
 * @param {string} htmlText - Raw HTML text
 * @returns {{entries: Array<Object>, errors: Array<string>}} - Parsed entries and errors
 */
function parseTimetableHTML(htmlText) {
  const errors = [];
  const entries = [];
  
  errors.push('HTML parsing not yet implemented. Use CSV format for now.');
  
  return { entries, errors };
}

/**
 * Parse timetable source based on format.
 * 
 * @param {{type: string, content: string}} source - Fetched source data
 * @returns {{entries: Array<Object>, errors: Array<string>}} - Parsed entries and errors
 */
function parseTimetable(source) {
  if (!source || !source.content) {
    return { entries: [], errors: ['Invalid source'] };
  }
  
  if (source.type === 'csv') {
    return parseTimetableCSV(source.content);
  } else if (source.type === 'html') {
    return parseTimetableHTML(source.content);
  } else {
    return { entries: [], errors: [`Unsupported source type: ${source.type}`] };
  }
}
