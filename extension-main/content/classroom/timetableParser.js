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
 * HTML export is needed for complex timetables with merged cells.
 * 
 * @param {string} htmlText - Raw HTML text
 * @returns {{entries: Array<Object>, errors: Array<string>, metadata: Object}} - Parsed entries and metadata
 */
function parseTimetableHTML(htmlText) {
  // Import HTML parser functions
  // In content script context, these would be loaded via importScripts or included
  // For now, we'll implement a basic version inline
  
  const errors = [];
  const metadata = { source: 'google-sheets-html' };
  
  if (!htmlText || htmlText.trim().length === 0) {
    errors.push('Empty HTML content');
    return { entries: [], errors, metadata };
  }
  
  // Try to parse using DOMParser (available in browser context)
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');
    const table = doc.querySelector('table');
    
    if (!table) {
      errors.push('No table found in HTML');
      return { entries: [], errors, metadata };
    }
    
    // Parse table structure
    const rows = Array.from(table.querySelectorAll('tr'));
    const cells = [];
    let rowIndex = 0;
    
    rows.forEach((tr) => {
      const tds = Array.from(tr.querySelectorAll('td, th'));
      let colIndex = 0;
      
      tds.forEach((td) => {
        const rowSpan = parseInt(td.getAttribute('rowspan') || '1', 10);
        const colSpan = parseInt(td.getAttribute('colspan') || '1', 10);
        const text = td.textContent.trim();
        
        cells.push({
          row: rowIndex,
          column: colIndex,
          text: text,
          rowSpan: rowSpan,
          colSpan: colSpan,
          isHeader: td.tagName === 'TH'
        });
        
        colIndex += colSpan;
      });
      
      rowIndex++;
    });
    
    metadata.totalRows = rowIndex;
    metadata.totalCells = cells.length;
    
    // Reconstruct logical grid
    const maxCols = Math.max(...cells.map(c => c.column + c.colSpan));
    const grid = Array.from({ length: rowIndex }, () => 
      Array.from({ length: maxCols }, () => null)
    );
    
    cells.forEach(cell => {
      for (let r = cell.row; r < cell.row + cell.rowSpan && r < rowIndex; r++) {
        for (let c = cell.column; c < cell.column + cell.colSpan && c < maxCols; c++) {
          if (r === cell.row && c === cell.column) {
            grid[r][c] = cell;
          } else {
            grid[r][c] = { occupiedBy: cell };
          }
        }
      }
    });
    
    // Detect time column
    const timePattern = /\d{1,2}:\d{2}\s*(AM|PM)?\s*-\s*\d{1,2}:\d{2}\s*(AM|PM)?/i;
    let timeColumn = null;
    let bestScore = 0;
    
    for (let col = 0; col < maxCols; col++) {
      let score = 0;
      for (let row = 0; row < rowIndex; row++) {
        const cell = grid[row][col];
        if (cell && cell.text && !cell.occupiedBy && timePattern.test(cell.text)) {
          score++;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        timeColumn = col;
      }
    }
    
    if (timeColumn === null) {
      errors.push('Could not detect time column');
      return { entries: [], errors, metadata };
    }
    
    // Detect day columns
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const dayColumns = [];
    const headerRow = grid[0] || grid[1];
    
    if (headerRow) {
      for (let col = 0; col < maxCols; col++) {
        if (col === timeColumn) continue;
        const cell = headerRow[col];
        if (cell && cell.text && !cell.occupiedBy) {
          const normalizedText = cell.text.toLowerCase().trim();
          for (const day of days) {
            if (normalizedText.includes(day.toLowerCase())) {
              dayColumns.push({ column: col, day });
              break;
            }
          }
        }
      }
    }
    
    if (dayColumns.length === 0) {
      errors.push('Could not detect day columns');
      return { entries: [], errors, metadata };
    }
    
    // Extract entries
    const entries = [];
    const processedCells = new Set();
    
    // Get time slots
    const timeSlots = [];
    for (let row = 0; row < rowIndex; row++) {
      const cell = grid[row][timeColumn];
      if (cell && cell.text && !cell.occupiedBy) {
        const { startTime, endTime } = parseTimeRange(cell.text);
        if (startTime && endTime) {
          timeSlots.push({ row, startTime, endTime });
        }
      }
    }
    
    // Process each day column
    dayColumns.forEach(({ column, day }) => {
      timeSlots.forEach(({ row, startTime, endTime }) => {
        const cell = grid[row][column];
        
        if (!cell || cell.occupiedBy) return;
        
        const cellKey = `${cell.row}-${cell.column}`;
        if (processedCells.has(cellKey)) return;
        
        const text = cell.text;
        if (!text || text.trim() === '') return;
        
        // Check for lunch
        if (text.toLowerCase().includes('lunch')) {
          entries.push({
            type: 'lunch',
            dayOfWeek: day,
            startTime,
            endTime,
            raw: text
          });
          processedCells.add(cellKey);
          return;
        }
        
        // Check for group header
        if (/batch.*group|group.*batch|grp/i.test(text.toLowerCase())) {
          return;
        }
        
        // Extract class information
        const course = extractCourseFromText(text);
        const batch = extractBatchFromText(text);
        const teacher = extractTeacherFromText(text);
        const classroom = extractClassroomFromText(text);
        
        // Calculate duration from rowspan
        let duration = endTime;
        if (cell.rowSpan > 1) {
          const lastRow = cell.row + cell.rowSpan - 1;
          const lastTimeSlot = timeSlots.find(ts => ts.row === lastRow);
          if (lastTimeSlot) {
            duration = lastTimeSlot.endTime;
          }
        }
        
        entries.push({
          type: 'class',
          dayOfWeek: day,
          startTime,
          endTime: duration,
          batch,
          course,
          teacher,
          classroom,
          raw: text
        });
        
        processedCells.add(cellKey);
      });
    });
    
    metadata.timeColumn = timeColumn;
    metadata.dayColumns = dayColumns;
    metadata.classBlocksDetected = entries.filter(e => e.type === 'class').length;
    metadata.lunchBlocksDetected = entries.filter(e => e.type === 'lunch').length;
    metadata.totalEntries = entries.length;
    metadata.timeSlotsDetected = timeSlots.length;
    metadata.mergedCellsDetected = cells.filter(c => c.rowSpan > 1 || c.colSpan > 1).length;
    
    return { entries, errors, metadata };
    
  } catch (error) {
    errors.push(`HTML parsing error: ${error.message}`);
    return { entries: [], errors, metadata };
  }
}

// Helper functions for HTML parsing
function extractCourseFromText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const coursePattern = /^([A-Z]{2,})\s*-\s*\d{4}/i;
  
  for (const line of lines) {
    const match = line.match(coursePattern);
    if (match) return match[1].toLowerCase();
  }
  
  const firstWord = lines[0]?.split(/\s+/)[0];
  if (firstWord && /^[A-Z]{2,5}$/i.test(firstWord)) {
    const lowerWord = firstWord.toLowerCase();
    const nonCourseWords = ['some', 'this', 'that', 'with', 'from', 'class', 'room', 'lunch'];
    if (!nonCourseWords.includes(lowerWord)) return lowerWord;
  }
  
  return null;
}

function extractBatchFromText(text) {
  const lowerText = text.toLowerCase();
  const patterns = [/grp\s+([a-z])/i, /group\s+([a-z])/i, /batch\s+([a-z])/i];
  
  for (const pattern of patterns) {
    const match = lowerText.match(pattern);
    if (match) return `grp ${match[1]}`;
  }
  
  return null;
}

function extractTeacherFromText(text) {
  const parenMatch = text.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const teacher = parenMatch[1].trim();
    if (!teacher.toLowerCase().includes('grp') && 
        !teacher.toLowerCase().includes('batch') &&
        !teacher.toLowerCase().includes('lunch')) {
      return teacher;
    }
  }
  return null;
}

function extractClassroomFromText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const classroomPattern = /classroom\s+([a-z0-9\s]+)/i;
  
  for (const line of lines) {
    const match = line.match(classroomPattern);
    if (match) return match[1].trim();
  }
  
  for (const line of lines) {
    if (/class|room/i.test(line) && !/lunch/i.test(line)) {
      return line.trim();
    }
  }
  
  return null;
}

/**
 * Parse timetable source based on format.
 * 
 * @param {{type: string, content: string, fallbackUsed?: boolean, fallbackReason?: string}} source - Fetched source data
 * @returns {{entries: Array<Object>, errors: Array<string>, metadata: Object}} - Parsed entries and metadata
 */
function parseTimetable(source) {
  if (!source || !source.content) {
    return { entries: [], errors: ['Invalid source'], metadata: {} };
  }
  
  const metadata = {
    sourceType: source.type,
    fallbackUsed: source.fallbackUsed || false,
    fallbackReason: source.fallbackReason || null
  };
  
  if (source.type === 'csv') {
    const result = parseTimetableCSV(source.content);
    return { ...result, metadata };
  } else if (source.type === 'html') {
    const result = parseTimetableHTML(source.content);
    return { ...result, metadata };
  } else {
    return { 
      entries: [], 
      errors: [`Unsupported source type: ${source.type}`],
      metadata
    };
  }
}
