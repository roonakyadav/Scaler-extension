// ============================================
// classroom/timetableHtmlParser.js
// Parse HTML timetable with merged cells into structured representation
// ============================================

/**
 * Parse HTML table into structured cell representation.
 * 
 * @param {string} htmlText - Raw HTML text
 * @returns {{cells: Array<Object>, metadata: Object}} - Structured cells and metadata
 */
function parseHtmlTable(htmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, 'text/html');
  const table = doc.querySelector('table');
  
  if (!table) {
    return {
      cells: [],
      metadata: { error: 'No table found in HTML' }
    };
  }
  
  const rows = Array.from(table.querySelectorAll('tr'));
  const cells = [];
  let rowIndex = 0;
  
  rows.forEach((tr, trIndex) => {
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
        rawHtml: td.innerHTML,
        isHeader: td.tagName === 'TH',
        backgroundColor: td.style.backgroundColor || null
      });
      
      colIndex += colSpan;
    });
    
    rowIndex++;
  });
  
  return {
    cells,
    metadata: {
      source: 'google-sheets-html',
      totalRows: rowIndex,
      totalColumns: colIndex,
      totalCells: cells.length
    }
  };
}

/**
 * Reconstruct logical grid from cells with rowspan/colspan.
 * 
 * @param {Array<Object>} cells - Parsed cells
 * @param {number} totalRows - Total number of rows
 * @param {number} totalColumns - Total number of columns
 * @returns {Array<Array<Object|null>>} - Logical grid (null for occupied cells)
 */
function reconstructLogicalGrid(cells, totalRows, totalColumns) {
  // Initialize empty grid
  const grid = Array.from({ length: totalRows }, () => 
    Array.from({ length: totalColumns }, () => null)
  );
  
  // Place cells in grid
  cells.forEach(cell => {
    for (let r = cell.row; r < cell.row + cell.rowSpan && r < totalRows; r++) {
      for (let c = cell.column; c < cell.column + cell.colSpan && c < totalColumns; c++) {
        if (r === cell.row && c === cell.column) {
          // Original cell position
          grid[r][c] = cell;
        } else {
          // Occupied by merged cell
          grid[r][c] = { occupiedBy: cell };
        }
      }
    }
  });
  
  return grid;
}

/**
 * Detect time column from grid.
 * 
 * @param {Array<Array<Object|null>>} grid - Logical grid
 * @returns {number|null} - Column index of time column or null
 */
function detectTimeColumn(grid) {
  if (!grid || grid.length === 0) {
    return null;
  }
  
  // Look for column with time patterns
  const timePattern = /\d{1,2}:\d{2}\s*(AM|PM)?\s*-\s*\d{1,2}:\d{2}\s*(AM|PM)?/i;
  
  let bestColumn = null;
  let bestScore = 0;
  
  for (let col = 0; col < grid[0].length; col++) {
    let score = 0;
    
    for (let row = 0; row < grid.length; row++) {
      const cell = grid[row][col];
      if (cell && cell.text && !cell.occupiedBy) {
        if (timePattern.test(cell.text)) {
          score++;
        }
      }
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestColumn = col;
    }
  }
  
  return bestColumn;
}

/**
 * Detect day columns from grid.
 * 
 * @param {Array<Array<Object|null>>} grid - Logical grid
 * @param {number} timeColumn - Time column index
 * @returns {Array<{column: number, day: string}>} - Day column mappings
 */
function detectDayColumns(grid, timeColumn) {
  if (!grid || grid.length === 0) {
    return [];
  }
  
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const dayMappings = [];
  
  // Check header row (usually row 0 or 1)
  const headerRow = grid[0] || grid[1];
  if (!headerRow) {
    return [];
  }
  
  for (let col = 0; col < headerRow.length; col++) {
    if (col === timeColumn) continue;
    
    const cell = headerRow[col];
    if (cell && cell.text && !cell.occupiedBy) {
      const normalizedText = cell.text.toLowerCase().trim();
      
      for (const day of days) {
        if (normalizedText.includes(day.toLowerCase())) {
          dayMappings.push({ column: col, day });
          break;
        }
      }
    }
  }
  
  return dayMappings;
}

/**
 * Parse time range string to start/end times.
 * 
 * @param {string} timeStr - Time range string
 * @returns {{startTime: string|null, endTime: string|null}} - Parsed times
 */
function parseTimeRange(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') {
    return { startTime: null, endTime: null };
  }
  
  const trimmed = timeStr.trim();
  
  // Try format: "9:30 - 11:00 AM" or "9:30 AM - 11:00 AM"
  const ampmMatch = trimmed.match(/(\d{1,2}:\d{2})\s*(AM|PM)?\s*-\s*(\d{1,2}:\d{2})\s*(AM|PM)?/i);
  if (ampmMatch) {
    let startHours = parseInt(ampmMatch[1].split(':')[0], 10);
    let startMins = parseInt(ampmMatch[1].split(':')[1], 10);
    const startMeridiem = ampmMatch[2]?.toUpperCase();
    
    let endHours = parseInt(ampmMatch[3].split(':')[0], 10);
    let endMins = parseInt(ampmMatch[3].split(':')[1], 10);
    const endMeridiem = ampmMatch[4]?.toUpperCase();
    
    // Convert to 24-hour format
    if (startMeridiem === 'PM' && startHours !== 12) startHours += 12;
    if (startMeridiem === 'AM' && startHours === 12) startHours = 0;
    if (endMeridiem === 'PM' && endHours !== 12) endHours += 12;
    if (endMeridiem === 'AM' && endHours === 12) endHours = 0;
    
    return {
      startTime: `${String(startHours).padStart(2, '0')}:${String(startMins).padStart(2, '0')}`,
      endTime: `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`
    };
  }
  
  // Try format: "09:30-11:00"
  const dashMatch = trimmed.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
  if (dashMatch) {
    return {
      startTime: dashMatch[1],
      endTime: dashMatch[2]
    };
  }
  
  return { startTime: null, endTime: null };
}

/**
 * Extract course from cell text.
 * 
 * @param {string} text - Cell text
 * @returns {string|null} - Extracted course or null
 */
function extractCourse(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }
  
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  
  // Look for course pattern (e.g., "MERN - 2029", "CML - 2029")
  const coursePattern = /^([A-Z]{2,})\s*-\s*\d{4}/i;
  
  for (const line of lines) {
    const match = line.match(coursePattern);
    if (match) {
      return match[1].toLowerCase();
    }
  }
  
  // Fallback: first word if it looks like a course (all caps, 2-5 letters, not common words)
  const firstWord = lines[0]?.split(/\s+/)[0];
  if (firstWord && /^[A-Z]{2,5}$/i.test(firstWord)) {
    const lowerWord = firstWord.toLowerCase();
    // Filter out common non-course words
    const nonCourseWords = ['some', 'this', 'that', 'with', 'from', 'class', 'room', 'lunch'];
    if (!nonCourseWords.includes(lowerWord)) {
      return lowerWord;
    }
  }
  
  return null;
}

/**
 * Extract batch/group from cell text.
 * 
 * @param {string} text - Cell text
 * @returns {string|null} - Extracted batch or null
 */
function extractBatch(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }
  
  const lowerText = text.toLowerCase();
  
  // Try patterns: "Grp X", "Group X", "Batch X"
  const patterns = [
    /grp\s+([a-z])/i,
    /group\s+([a-z])/i,
    /batch\s+([a-z])/i
  ];
  
  for (const pattern of patterns) {
    const match = lowerText.match(pattern);
    if (match) {
      return `grp ${match[1]}`;
    }
  }
  
  return null;
}

/**
 * Extract teacher from cell text.
 * 
 * @param {string} text - Cell text
 * @returns {string|null} - Extracted teacher or null
 */
function extractTeacher(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }
  
  // Look for teacher in parentheses
  const parenMatch = text.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const teacher = parenMatch[1].trim();
    // Filter out non-teacher content
    if (!teacher.toLowerCase().includes('grp') && 
        !teacher.toLowerCase().includes('batch') &&
        !teacher.toLowerCase().includes('lunch')) {
      return teacher;
    }
  }
  
  return null;
}

/**
 * Extract classroom from cell text.
 * 
 * @param {string} text - Cell text
 * @returns {string|null} - Extracted classroom or null
 */
function extractClassroom(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }
  
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  
  // Look for classroom pattern
  const classroomPattern = /classroom\s+([a-z0-9\s]+)/i;
  
  for (const line of lines) {
    const match = line.match(classroomPattern);
    if (match) {
      return match[1].trim();
    }
  }
  
  // Fallback: look for lines with "Class" or "Room"
  for (const line of lines) {
    if (/class|room/i.test(line) && !/lunch/i.test(line)) {
      return line.trim();
    }
  }
  
  return null;
}

/**
 * Check if cell is a lunch block.
 * 
 * @param {string} text - Cell text
 * @returns {boolean} - True if lunch block
 */
function isLunchBlock(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  
  const lowerText = text.toLowerCase().trim();
  return lowerText === 'lunch' || lowerText.includes('lunch');
}

/**
 * Check if cell is a group section header.
 * 
 * @param {string} text - Cell text
 * @returns {boolean} - True if group header
 */
function isGroupHeader(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  
  const lowerText = text.toLowerCase().trim();
  return /batch.*group|group.*batch|grp|group\s+[a-z]|batch\s+[a-z]/i.test(lowerText);
}

/**
 * Extract class entries from logical grid.
 * 
 * @param {Array<Array<Object|null>>} grid - Logical grid
 * @param {number} timeColumn - Time column index
 * @param {Array<{column: number, day: string}>} dayColumns - Day column mappings
 * @returns {Array<Object>} - Class entries
 */
function extractClassEntries(grid, timeColumn, dayColumns) {
  const entries = [];
  const processedCells = new Set();
  
  // Get time slots from time column
  const timeSlots = [];
  for (let row = 0; row < grid.length; row++) {
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
      
      if (!cell || cell.occupiedBy) {
        return;
      }
      
      // Skip if already processed
      const cellKey = `${cell.row}-${cell.column}`;
      if (processedCells.has(cellKey)) {
        return;
      }
      
      const text = cell.text;
      
      // Skip non-class blocks
      if (!text || text.trim() === '') {
        return;
      }
      
      if (isLunchBlock(text)) {
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
      
      if (isGroupHeader(text)) {
        return; // Skip group headers
      }
      
      // Extract class information
      const course = extractCourse(text);
      const batch = extractBatch(text);
      const teacher = extractTeacher(text);
      const classroom = extractClassroom(text);
      
      // Calculate duration from rowspan
      let duration = 0;
      if (cell.rowSpan > 1) {
        // Find the end time from the last row spanned
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
        endTime: duration || endTime,
        batch,
        course,
        teacher,
        classroom,
        raw: text
      });
      
      processedCells.add(cellKey);
    });
  });
  
  return entries;
}

/**
 * Parse HTML timetable into structured entries.
 * 
 * @param {string} htmlText - Raw HTML text
 * @returns {{entries: Array<Object>, errors: Array<string>, metadata: Object}} - Parsed entries and metadata
 */
function parseTimetableHTML(htmlText) {
  const errors = [];
  const metadata = {};
  
  if (!htmlText || htmlText.trim().length === 0) {
    errors.push('Empty HTML content');
    return { entries: [], errors, metadata };
  }
  
  // Parse HTML table
  const { cells, metadata: parseMetadata } = parseHtmlTable(htmlText);
  Object.assign(metadata, parseMetadata);
  
  if (cells.length === 0) {
    errors.push('No cells found in HTML table');
    return { entries: [], errors, metadata };
  }
  
  if (parseMetadata.error) {
    errors.push(parseMetadata.error);
    return { entries: [], errors, metadata };
  }
  
  // Reconstruct logical grid
  const grid = reconstructLogicalGrid(cells, parseMetadata.totalRows, parseMetadata.totalColumns);
  
  // Detect axes
  const timeColumn = detectTimeColumn(grid);
  if (timeColumn === null) {
    errors.push('Could not detect time column');
    return { entries: [], errors, metadata };
  }
  
  const dayColumns = detectDayColumns(grid, timeColumn);
  if (dayColumns.length === 0) {
    errors.push('Could not detect day columns');
    return { entries: [], errors, metadata };
  }
  
  // Extract class entries
  const entries = extractClassEntries(grid, timeColumn, dayColumns);
  
  metadata.timeColumn = timeColumn;
  metadata.dayColumns = dayColumns;
  metadata.classBlocksDetected = entries.filter(e => e.type === 'class').length;
  metadata.lunchBlocksDetected = entries.filter(e => e.type === 'lunch').length;
  
  return { entries, errors, metadata };
}
