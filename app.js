/**
 * ==========================================
 * Attendance Scanner PWA - Shared JavaScript
 * ==========================================
 * Contains: Database, Auth, Roster, Offline Detection
 */

// ==========================================
// Dexie Database Setup
// ==========================================
const db = new Dexie('AttendanceScannerDB');

// Define database schema
db.version(1).stores({
  students: 'id, name, section',  // Student roster
  outbox: '++id, studentId, officerCode, timestamp, synced'  // Attendance records
});

// ==========================================
// Configuration
// ==========================================
const CONFIG = {
  // Demo officer credentials
  officer: {
    code: 'OFFICER123',
    pin: '0000',
    name: 'John Smith',
    section: 'Section-B'  // This officer is assigned to Section-B
  },
  // API endpoints (for mock)
  api: {
    roster: '/api/roster',
    upload: '/api/upload-attendance'
  },
  // Demo roster for fallback
  demoRoster: [
    { id: 'STU-001', name: 'Alice Johnson', section: 'Section-A' },
    { id: 'STU-002', name: 'Bob Williams', section: 'Section-B' },
    { id: 'STU-003', name: 'Charlie Brown', section: 'Section-B' },
    { id: 'STU-004', name: 'Diana Martinez', section: 'Section-A' },
    { id: 'STU-005', name: 'Edward Lee', section: 'Section-C' },
    { id: 'STU-006', name: 'Fiona Garcia', section: 'Section-B' },
    { id: 'STU-007', name: 'George Wilson', section: 'Section-A' },
    { id: 'STU-008', name: 'Hannah Davis', section: 'Section-B' },
    { id: 'STU-009', name: 'Ian Thompson', section: 'Section-C' },
    { id: 'STU-010', name: 'Julia Anderson', section: 'Section-B' }
  ]
};

// ==========================================
// Authentication Functions
// ==========================================

/**
 * Check if user is logged in
 * @returns {boolean}
 */
function isLoggedIn() {
  return localStorage.getItem('officerLoggedIn') === 'true';
}

/**
 * Get logged in officer info
 * @returns {object|null}
 */
function getOfficerInfo() {
  const info = localStorage.getItem('officerInfo');
  return info ? JSON.parse(info) : null;
}

/**
 * Attempt officer login
 * @param {string} officerCode
 * @param {string} pin
 * @returns {boolean}
 */
function login(officerCode, pin) {
  // Check against demo credentials
  if (officerCode === CONFIG.officer.code && pin === CONFIG.officer.pin) {
    const officerInfo = {
      code: CONFIG.officer.code,
      name: CONFIG.officer.name,
      section: CONFIG.officer.section
    };
    localStorage.setItem('officerLoggedIn', 'true');
    localStorage.setItem('officerInfo', JSON.stringify(officerInfo));
    return true;
  }
  return false;
}

/**
 * Logout officer
 */
function logout() {
  localStorage.removeItem('officerLoggedIn');
  localStorage.removeItem('officerInfo');
  // Redirect to login page
  window.location.href = 'index.html';
}

/**
 * Get database reference
 * @returns {Dexie}
 */
function getDb() {
  return db;
}

/**
 * Require login - redirect if not logged in
 */
function requireLogin() {
  if (!isLoggedIn()) {
    window.location.href = 'index.html';
    return false;
  }
  return true;
}

// ==========================================
// Roster Functions
// ==========================================

/**
 * Check if roster is cached locally
 * @returns {boolean}
 */
function isRosterCached() {
  return localStorage.getItem('rosterCached') === 'true';
}

/**
 * Fetch roster from server (mock)
 * @returns {Promise<Array>}
 */
async function fetchRosterFromServer() {
  try {
    const response = await fetch(CONFIG.api.roster);
    if (!response.ok) {
      throw new Error('Server error');
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch roster:', error);
    throw error;
  }
}

/**
 * Save roster to local database
 * @param {Array} roster
 */
async function saveRosterToDb(roster) {
  await db.students.clear(); // Clear existing data
  await db.students.bulkAdd(roster);
  localStorage.setItem('rosterCached', 'true');
}

/**
 * Normalize workbook headers so import logic can find common columns.
 * @param {string} value
 * @returns {string}
 */
function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Infer a section name from a student ID when the ID encodes it.
 * Examples: A-1001, B1002, SEC-A-1003, SECTIONB1004.
 * @param {string|number} studentId
 * @param {string} fallbackSection
 * @returns {string}
 */
function inferSectionFromStudentId(studentId, fallbackSection = '') {
  const normalized = String(studentId || '').trim().toUpperCase();
  if (!normalized) {
    return fallbackSection;
  }

  const sectionPatterns = [
    [/SECTION[-_\s]*([A-Z0-9]+)/, 'Section-$1'],
    [/SEC[-_\s]*([A-Z0-9]+)/, 'Section-$1'],
    [/^([A-Z])[-_\s]?\d+/, '$1'],
    [/^([A-Z]{1,3})\d+/, '$1'],
    [/([A-Z])\d+$/, '$1']
  ];

  for (const [pattern, template] of sectionPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      const token = match[1] ? match[1].replace(/[^A-Z0-9]+/g, '') : '';
      if (!token) {
        continue;
      }
      if (template === 'Section-$1') {
        return `Section-${token}`;
      }
      return token;
    }
  }

  return fallbackSection;
}

/**
 * Convert workbook rows into student-like objects.
 * @param {object} workbook
 * @param {File} file
 * @returns {Array}
 */
function extractStudentsFromWorkbook(workbook, file) {
  const students = [];
  const fallbackSection = file.name.replace(/\.(xlsx|xls|csv)$/i, '').replace(/[_-]+/g, ' ').trim() || (workbook && workbook.SheetNames && workbook.SheetNames[0] ? workbook.SheetNames[0] : 'Imported Section');

  if (!workbook || !workbook.SheetNames || !workbook.SheetNames.length) {
    return students;
  }

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;

    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false, blankrows: false }) || [];

    rows.forEach((row, index) => {
      const normalizedRow = {};
      Object.keys(row).forEach((key) => {
        normalizedRow[normalizeHeader(key)] = row[key];
      });

      const idValue = [normalizedRow['student id'], normalizedRow.id, normalizedRow['studentid'], normalizedRow['roll no'], normalizedRow['roll number'], normalizedRow['roll'], normalizedRow['student number']]
        .find((value) => value !== undefined && value !== null && String(value).trim() !== '');
      const nameValue = [normalizedRow.name, normalizedRow['student name'], normalizedRow['full name'], normalizedRow['student'], normalizedRow['fullname']]
        .find((value) => value !== undefined && value !== null && String(value).trim() !== '');
      const sectionValue = [normalizedRow.section, normalizedRow.class, normalizedRow.batch, normalizedRow.group]
        .find((value) => value !== undefined && value !== null && String(value).trim() !== '');
      const inferredSection = inferSectionFromStudentId(idValue, fallbackSection);

      if (!nameValue && !idValue) {
        return;
      }

      students.push({
        id: String(idValue || `${fallbackSection}-${index + 1}`).trim(),
        name: String(nameValue || 'Unnamed Student').trim(),
        section: String(inferredSection || sectionValue || fallbackSection).trim()
      });
    });
  });

  return students;
}

/**
 * Import one or more Excel files as roster data.
 * Each file is treated as one section and the file name becomes the section name.
 * @param {FileList|Array} files
 * @returns {Promise<object>}
 */
async function importRosterFromFiles(files) {
  if (typeof XLSX === 'undefined') {
    throw new Error('Excel support is not available in this browser.');
  }

  const selectedFiles = Array.from(files || []);
  if (selectedFiles.length === 0) {
    throw new Error('Select at least one Excel file to import.');
  }

  const importedStudents = [];
  const seenIds = new Set();

  for (const file of selectedFiles) {
    if (!file || !file.name) {
      continue;
    }

    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const studentsFromFile = extractStudentsFromWorkbook(workbook, file);

    if (!studentsFromFile.length) {
      throw new Error(`No student rows were found in ${file.name}.`);
    }

    studentsFromFile.forEach((student, index) => {
      let studentId = String(student.id || '').trim();
      if (!studentId) {
        studentId = `${student.section || 'Imported'}-${index + 1}`;
      }

      if (seenIds.has(studentId)) {
        studentId = `${studentId}-${index + 1}`;
      }
      seenIds.add(studentId);

      importedStudents.push({
        id: studentId,
        name: String(student.name || 'Unnamed Student').trim(),
        section: String(student.section || 'Imported Section').trim()
      });
    });
  }

  if (!importedStudents.length) {
    throw new Error('No students were imported.');
  }

  await saveRosterToDb(importedStudents);
  return {
    count: importedStudents.length,
    files: selectedFiles.length
  };
}

/**
 * Setup roster - fetch from server or show error
 * @param {function} onProgress - Progress callback
 * @returns {Promise<boolean>}
 */
async function setupRoster(onProgress) {
  if (!navigator.onLine) {
    throw new Error('No internet connection. Please reconnect and try again.');
  }

  if (onProgress) onProgress('Connecting to server...');

  try {
    // Try to fetch from server
    const roster = await fetchRosterFromServer();
    if (onProgress) onProgress('Saving roster...');
    await saveRosterToDb(roster);
    return true;
  } catch (error) {
    // Server not available, throw error
    throw new Error('Server unavailable. Please try again later or use demo roster.');
  }
}

/**
 * Load demo roster for testing
 * @returns {Promise<boolean>}
 */
async function loadDemoRoster() {
  await saveRosterToDb(CONFIG.demoRoster);
  return true;
}

/**
 * Get all students from local database
 * @returns {Promise<Array>}
 */
async function getAllStudents() {
  return await db.students.toArray();
}

/**
 * Get student by ID
 * @param {string} studentId
 * @returns {Promise<object|null>}
 */
async function getStudentById(studentId) {
  const normalizedInput = String(studentId || '').trim();
  if (!normalizedInput) {
    return null;
  }

  const directMatch = await db.students.get(normalizedInput);
  if (directMatch) {
    return directMatch;
  }

  const allStudents = await db.students.toArray();
  const normalizedInputLower = normalizedInput.toLowerCase();
  return allStudents.find(student => String(student.id || '').trim().toLowerCase() === normalizedInputLower) || null;
}

// ==========================================
// Attendance Functions
// ==========================================

/**
 * Record attendance for a student
 * @param {string} studentId
 * @param {string} officerCode
 * @returns {Promise<object}
 */
async function recordAttendance(studentId, officerCode) {
  const timestamp = new Date().toISOString();

  // Check if already checked in today
  const today = new Date().toDateString();
  const existingRecords = await db.outbox
    .where('studentId')
    .equals(studentId)
    .toArray();

  const alreadyCheckedIn = existingRecords.some(record => {
    return new Date(record.timestamp).toDateString() === today;
  });

  if (alreadyCheckedIn) {
    return { success: false, reason: 'duplicate', message: 'Already checked in' };
  }

  // Record the attendance
  const record = {
    studentId,
    officerCode,
    timestamp,
    synced: false
  };

  await db.outbox.add(record);

  return { success: true, record };
}

/**
 * Get pending (unsynced) attendance records
 * @returns {Promise<Array>}
 */
async function getPendingRecords() {
  return await db.outbox.where('synced').equals(false).toArray();
}

/**
 * Get count of pending records
 * @returns {Promise<number>}
 */
async function getPendingCount() {
  return await db.outbox.where('synced').equals(false).count();
}

/**
 * Get all attendance records (for sync list with student names)
 * @returns {Promise<Array>}
 */
async function getPendingRecordsWithNames() {
  const records = await getPendingRecords();
  const recordsWithNames = [];

  for (const record of records) {
    const student = await getStudentById(record.studentId);
    recordsWithNames.push({
      ...record,
      studentName: student ? student.name : 'Unknown',
      studentSection: student ? student.section : 'Unknown'
    });
  }

  return recordsWithNames;
}

/**
 * Sync attendance records to server
 * @returns {Promise<boolean>}
 */
async function syncAttendanceRecords() {
  if (!navigator.onLine) {
    throw new Error('No internet connection. Please reconnect and try again.');
  }

  const pendingRecords = await getPendingRecords();
  if (pendingRecords.length === 0) {
    return true;
  }

  try {
    // Mock API call - assume server accepts and processes
    const response = await fetch(CONFIG.api.upload, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(pendingRecords)
    });

    if (!response.ok) {
      throw new Error('Server error');
    }

    // Mark all records as synced
    for (const record of pendingRecords) {
      await db.outbox.update(record.id, { synced: true });
    }

    return true;
  } catch (error) {
    console.error('Sync failed:', error);
    throw error;
  }
}

/**
 * Mock sync - simulates successful upload
 * Used when API is not available for demo purposes
 * @returns {Promise<boolean>}
 */
async function mockSyncAttendanceRecords() {
  const pendingRecords = await getPendingRecords();

  if (pendingRecords.length === 0) {
    return true;
  }

  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Mark all records as synced
  for (const record of pendingRecords) {
    await db.outbox.update(record.id, { synced: true });
  }

  return true;
}

// ==========================================
// Offline Detection
// ==========================================

/**
 * Initialize online/offline event listeners
 */
function initOnlineStatusListener() {
  window.addEventListener('online', () => window.dispatchEvent(new Event('network-online')));
  window.addEventListener('offline', () => window.dispatchEvent(new Event('network-offline')));
}

// ==========================================
// Utility Functions
// ==========================================

/**
 * Format timestamp for display
 * @param {string} isoString
 * @returns {string}
 */
function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Show message to user
 * @param {string} message
 * @param {string} type - info, success, error, warning
 * @param {number} duration - ms, 0 = permanent
 */
function showMessage(message, type = 'info', duration = 3000) {
  // Remove existing messages
  const existingMessages = document.querySelectorAll('.message');
  existingMessages.forEach(msg => msg.remove());

  const messageEl = document.createElement('div');
  messageEl.className = `message message--${type}`;
  messageEl.textContent = message;

  // Insert after header or at top of container
  const container = document.querySelector('.container');
  const firstCard = container?.querySelector('.card');
  if (firstCard) {
    container.insertBefore(messageEl, firstCard);
  } else {
    container?.prepend(messageEl);
  }

  // Auto remove after duration
  if (duration > 0) {
    setTimeout(() => {
      messageEl.remove();
    }, duration);
  }
}

/**
 * Clear all local data (for logout/testing)
 */
async function clearAllData() {
  await db.students.clear();
  await db.outbox.clear();
  localStorage.removeItem('rosterCached');
  localStorage.removeItem('officerLoggedIn');
  localStorage.removeItem('officerInfo');
}

// ==========================================
// Initialize
// ==========================================

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initOnlineStatusListener();
});

// Export for use in other files
if (typeof window !== 'undefined') {
  window.App = {
    db,
    getDb,
    config: CONFIG,
    isLoggedIn,
    getOfficerInfo,
    login,
    logout,
    requireLogin,
    isRosterCached,
    setupRoster,
    importRosterFromFiles,
    loadDemoRoster,
    getAllStudents,
    getStudentById,
    recordAttendance,
    getPendingRecords,
    getPendingCount,
    getPendingRecordsWithNames,
    syncAttendanceRecords,
    mockSyncAttendanceRecords,
    formatTime,
    showMessage,
    clearAllData
  };
}