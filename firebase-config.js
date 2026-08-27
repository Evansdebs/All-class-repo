// ============================================================================
// Firebase Configuration & Service Layer — OneReal School Management System
// ============================================================================

// Default Firebase Config (fill in from Firebase Console or use Admin Dashboard)
const DEFAULT_FIREBASE_CONFIG = {
    apiKey: "AIzaSyDvl4Gyas2paysZjE1OCoBkt8ssNW8DvIs",
    authDomain: "reportsheetgen-9c986.firebaseapp.com",
    projectId: "reportsheetgen-9c986",
    storageBucket: "reportsheetgen-9c986.firebasestorage.app",
    messagingSenderId: "1065254905250",
    appId: "1:1065254905250:web:40d00e89e6cdaba5713efb",
    measurementId: "G-H6G42CGXD6"
};

let firebaseApp = null;
let db = null;
let auth = null;
let storage = null;
let isFirebaseActive = false;
let lastFirebaseError = '';
let firebaseAuthHooked = false;

// Current authenticated user & their role profile
let currentUserProfile = null;

// ──────────────────────────────────────────────────────────────────────────────
// CONFIG HELPERS
// ──────────────────────────────────────────────────────────────────────────────

function getStoredFirebaseConfig() {
    const saved = localStorage.getItem('firebaseConfig');
    if (saved) {
        try { return JSON.parse(saved); } catch (e) {}
    }
    return DEFAULT_FIREBASE_CONFIG;
}

function saveFirebaseConfig(config) {
    localStorage.setItem('firebaseConfig', JSON.stringify(config));
    return initFirebase(config);
}

// ──────────────────────────────────────────────────────────────────────────────
// INITIALIZATION
// ──────────────────────────────────────────────────────────────────────────────

function getLastFirebaseError() {
    return lastFirebaseError;
}

function initFirebase(config = getStoredFirebaseConfig()) {
    lastFirebaseError = '';
    if (typeof firebase === 'undefined' || !firebase.initializeApp) {
        lastFirebaseError = 'Firebase SDK did not load. Hard-refresh the page.';
        console.warn(lastFirebaseError);
        isFirebaseActive = false;
        return false;
    }

    if (!config || !config.apiKey || !config.projectId) {
        lastFirebaseError = 'Firebase config is missing apiKey or projectId.';
        console.log(lastFirebaseError);
        isFirebaseActive = false;
        return false;
    }

    try {
        if (firebase.apps && firebase.apps.length) {
            firebaseApp = firebase.app();
            const same = firebaseApp.options
                && firebaseApp.options.apiKey === config.apiKey
                && firebaseApp.options.projectId === config.projectId;
            if (!same) {
                try { firebaseApp.delete(); } catch (e) {}
                firebaseApp = firebase.initializeApp(config);
            }
        } else {
            firebaseApp = firebase.initializeApp(config);
        }

        if (typeof firebase.firestore !== 'function') {
            throw new Error('Firestore SDK missing.');
        }
        if (typeof firebase.auth !== 'function') {
            throw new Error('Auth SDK missing.');
        }

        db = firebase.firestore();
        // Configure firestore settings for stability & bounded cache
        try {
            if (typeof db.settings === 'function') {
                db.settings({
                    cacheSizeBytes: 10485760 // 10MB cache limit to avoid unbounded queue buildup
                });
            }
        } catch (e) {}
        auth = firebase.auth();
        if (firebase.storage) storage = firebase.storage();

        try {
            // Sessions must not survive a page refresh — access is strictly by login.
            auth.setPersistence(firebase.auth.Auth.Persistence.NONE).catch(() => {});
        } catch (e) {}

        try {
            db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
        } catch (e) {}

        isFirebaseActive = true;

        if (!firebaseAuthHooked && auth) {
            firebaseAuthHooked = true;
            auth.onAuthStateChanged(async (user) => {
                if (user) {
                    try { await loadUserProfile(user.uid); } catch (e) {}
                } else {
                    currentUserProfile = null;
                }
                updateAuthUI(user);
            });
        }

        console.log('Firebase initialized successfully!');
        return true;
    } catch (error) {
        lastFirebaseError = error.message || String(error);
        console.error('Firebase initialization error:', error);
        isFirebaseActive = false;
        return false;
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// USER PROFILE & RBAC
// ──────────────────────────────────────────────────────────────────────────────

async function loadUserProfile(uid) {
    if (!db) return null;
    try {
        let doc = await db.collection('teachers').doc(uid).get();
        if (doc.exists) {
            currentUserProfile = { uid, ...doc.data(), displayName: doc.data().name || doc.data().displayName };
        } else {
            const email = auth.currentUser?.email || '';
            let foundByEmail = null;
            if (email) {
                const snap = await db.collection('teachers')
                    .where('email', '==', email)
                    .limit(1).get();
                if (!snap.empty) {
                    foundByEmail = { uid, ...snap.docs[0].data(), id: snap.docs[0].id, displayName: snap.docs[0].data().name || snap.docs[0].data().displayName };
                }
            }
            if (foundByEmail) {
                currentUserProfile = foundByEmail;
                try { await db.collection('teachers').doc(uid).set({ ...foundByEmail, uid }, { merge: true }); } catch (e) {}
            } else {
                currentUserProfile = {
                    uid,
                    email: auth.currentUser?.email || '',
                    displayName: auth.currentUser?.displayName || '',
                    role: 'Teacher',
                    assignedClasses: [],
                    assignedSubjects: [],
                    status: 'active'
                };
            }
        }

        // Check if account has been deactivated or deleted by administrator
        if (currentUserProfile.status === 'inactive' || currentUserProfile.status === 'deleted' || currentUserProfile.isDeleted) {
            await auth.signOut();
            currentUserProfile = null;
            throw new Error('Your account has been deactivated / deleted by the Administrator. Please contact your school administrator.');
        }

        return currentUserProfile;
    } catch (e) {
        if (e.message.includes('deactivated') || e.message.includes('deleted')) throw e;
        console.warn('Could not load user profile:', e);
        return null;
    }
}

function getCurrentUserProfile() {
    return currentUserProfile;
}

function getCurrentUserRole() {
    return currentUserProfile?.role || 'Guest';
}

function hasRole(...roles) {
    const userRole = getCurrentUserRole();
    return roles.some(r => r === userRole);
}

function isAdmin() {
    return hasRole('Super Admin', 'Administrator');
}

function isHeadteacher() {
    return hasRole('Super Admin', 'Administrator', 'Headteacher');
}

function isAnyTeacher() {
    return hasRole('Super Admin', 'Administrator', 'Headteacher', 'Class Teacher', 'Teacher');
}

function getAssignedClasses() {
    return currentUserProfile?.assignedClasses || [];
}

function getAssignedSubjects() {
    return currentUserProfile?.assignedSubjects || [];
}

// ──────────────────────────────────────────────────────────────────────────────
// AUTHENTICATION
// ──────────────────────────────────────────────────────────────────────────────

async function loginFirebaseUser(email, password) {
    if (!auth) throw new Error('Firebase Auth not initialized.');
    try { await auth.setPersistence(firebase.auth.Auth.Persistence.NONE); } catch (e) {}
    const creds = await auth.signInWithEmailAndPassword(email, password);
    const profile = await loadUserProfile(creds.user.uid);
    if (profile?.status === 'inactive' || profile?.status === 'deleted' || profile?.isDeleted) {
        await auth.signOut();
        throw new Error('Your account has been deactivated / deleted by the Administrator.');
    }
    // Fire-and-forget: the audit write must not delay the sign-in flow.
    logActivity('User Login', `Logged in as ${email}`).catch(() => {});
    return creds;
}

async function registerFirebaseUser(email, password, displayName, role = 'Teacher', extraData = {}) {
    if (!auth) throw new Error('Firebase Auth not initialized.');
    // Use a secondary app so creating a teacher account does not replace
    // the administrator's own signed-in session.
    const secondary = firebase.initializeApp(getStoredFirebaseConfig(), 'register_' + Date.now());
    try {
        const creds = await secondary.auth().createUserWithEmailAndPassword(email, password);

        // Create staff profile in Firestore teachers collection with all provided fields
        if (db) {
            await db.collection('teachers').doc(creds.user.uid).set({
                id: creds.user.uid,
                uid: creds.user.uid,
                email,
                name: displayName || email,
                displayName: displayName || email,
                role,
                assignedClasses: extraData.assignedClasses || [],
                assignedSubjects: extraData.assignedSubjects || [],
                phone: extraData.phone || '',
                status: extraData.status || 'active',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }

        await logActivity('Staff Registration', `Created staff account ${email} with role ${role}`);
        await secondary.auth().signOut();
        return creds;
    } finally {
        try { await secondary.delete(); } catch (e) {}
    }
}

async function logoutFirebaseUser() {
    if (auth) {
        await logActivity('User Logout', 'Logged out current user');
        await auth.signOut();
        currentUserProfile = null;
    }
}

async function resetPassword(email) {
    if (!auth) throw new Error('Firebase Auth not initialized.');
    return auth.sendPasswordResetEmail(email);
}

// ──────────────────────────────────────────────────────────────────────────────
// UI HELPERS
// ──────────────────────────────────────────────────────────────────────────────

function updateAuthUI(user) {
    const userDisplay = document.getElementById('currentUserDisplay');
    const loginBtn = document.getElementById('openAuthModalBtn');
    const logoutBtn = document.getElementById('logoutBtn');

    if (userDisplay && loginBtn && logoutBtn) {
        if (user) {
            const role = getCurrentUserRole();
            userDisplay.textContent = `${user.email} (${role})`;
            userDisplay.style.display = 'inline-block';
            loginBtn.style.display = 'none';
            logoutBtn.style.display = 'inline-block';
        } else {
            userDisplay.style.display = 'none';
            loginBtn.style.display = 'inline-block';
            logoutBtn.style.display = 'none';
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// GRADING SCALES — Ghana Primary, Standard Letter, JHS / BECE
// ──────────────────────────────────────────────────────────────────────────────

const PRESET_GRADING_SCALES = {
    GHANA_PRIMARY: {
        id: 'preset_ghana_primary',
        name: 'Ghana Primary Grading System',
        type: 'Primary',
        items: [
            { min: 80, max: 100, grade: 'A',  point: 1, remark: 'ADVANCE' },
            { min: 68, max: 79,  grade: 'P',  point: 2, remark: 'PROFICIENCY' },
            { min: 54, max: 67,  grade: 'AP', point: 3, remark: 'APPROACHING PROFICIENCY' },
            { min: 40, max: 53,  grade: 'D',  point: 4, remark: 'DEVELOPING' },
            { min: 0,  max: 39,  grade: 'B',  point: 5, remark: 'BEGINNER' }
        ]
    },
    STANDARD_LETTER: {
        id: 'preset_standard_letter',
        name: 'Standard Letter Grade System',
        type: 'General',
        items: [
            { min: 90, max: 100, grade: 'A+', point: 1, remark: 'EXCELLENT' },
            { min: 80, max: 89,  grade: 'A',  point: 2, remark: 'VERY GOOD' },
            { min: 70, max: 79,  grade: 'B',  point: 3, remark: 'GOOD' },
            { min: 60, max: 69,  grade: 'C',  point: 4, remark: 'CREDIT' },
            { min: 50, max: 59,  grade: 'D',  point: 5, remark: 'PASS' },
            { min: 0,  max: 49,  grade: 'F',  point: 9, remark: 'FAIL' }
        ]
    },
    JHS_BECE: {
        id: 'preset_jhs_bece',
        name: 'JHS / BECE Grading System',
        type: 'JHS',
        items: [
            { min: 85, max: 100, grade: 'Grade 1', point: 1, remark: 'HIGHEST DISTINCTION' },
            { min: 75, max: 84,  grade: 'Grade 2', point: 2, remark: 'HIGHER DISTINCTION' },
            { min: 65, max: 74,  grade: 'Grade 3', point: 3, remark: 'HIGH CREDIT' },
            { min: 60, max: 64,  grade: 'Grade 4', point: 4, remark: 'CREDIT' },
            { min: 55, max: 59,  grade: 'Grade 5', point: 5, remark: 'CREDIT' },
            { min: 50, max: 54,  grade: 'Grade 6', point: 6, remark: 'PASS' },
            { min: 45, max: 49,  grade: 'Grade 7', point: 7, remark: 'PASS' },
            { min: 35, max: 44,  grade: 'Grade 8', point: 8, remark: 'PASS' },
            { min: 0,  max: 34,  grade: 'Grade 9', point: 9, remark: 'FAIL' }
        ]
    }
};

const DEFAULT_GRADING_SCALE = PRESET_GRADING_SCALES.GHANA_PRIMARY.items;
let activeGradingScale = null;

async function fetchActiveGradingScale() {
    const cached = localStorage.getItem('activeGradingScale');
    if (cached) {
        try { activeGradingScale = JSON.parse(cached); } catch (e) {}
    }

    if (isFirebaseActive && db) {
        try {
            const snapshot = await db.collection('gradingScales')
                .where('isActive', '==', true)
                .limit(1)
                .get();
            if (!snapshot.empty) {
                const doc = snapshot.docs[0];
                activeGradingScale = doc.data().items || DEFAULT_GRADING_SCALE;
                localStorage.setItem('activeGradingScale', JSON.stringify(activeGradingScale));
            }
        } catch (e) {
            console.warn('Could not fetch grading scale:', e);
        }
    }

    return activeGradingScale || DEFAULT_GRADING_SCALE;
}

function getActiveGradingScale() {
    return activeGradingScale || DEFAULT_GRADING_SCALE;
}

// Get appropriate grading scale for a specific class or level
function getGradingScaleForClass(classIdOrName) {
    if (!classIdOrName) return getActiveGradingScale();

    let classes = [];
    try {
        if (typeof adminState !== 'undefined' && Array.isArray(adminState.classes) && adminState.classes.length > 0) {
            classes = adminState.classes;
        } else {
            classes = JSON.parse(localStorage.getItem('classes') || '[]');
        }
    } catch(e) {
        classes = JSON.parse(localStorage.getItem('classes') || '[]');
    }

    const needle = String(classIdOrName).toLowerCase().trim();
    const cls = classes.find(c => 
        String(c.id).toLowerCase().trim() === needle || 
        String(c.name || '').toLowerCase().trim() === needle
    );

    if (cls?.gradingScaleId) {
        if (cls.gradingScaleId === 'preset_ghana_primary') return PRESET_GRADING_SCALES.GHANA_PRIMARY.items;
        if (cls.gradingScaleId === 'preset_jhs_bece') return PRESET_GRADING_SCALES.JHS_BECE.items;
        if (cls.gradingScaleId === 'preset_standard_letter') return PRESET_GRADING_SCALES.STANDARD_LETTER.items;

        let scales = [];
        try {
            if (typeof adminState !== 'undefined' && Array.isArray(adminState.gradingScales) && adminState.gradingScales.length > 0) {
                scales = adminState.gradingScales;
            } else {
                scales = JSON.parse(localStorage.getItem('gradingScales') || '[]');
            }
        } catch(e) {
            scales = JSON.parse(localStorage.getItem('gradingScales') || '[]');
        }

        const customScale = scales.find(s => 
            String(s.id).trim() === String(cls.gradingScaleId).trim() ||
            String(s.name || '').toLowerCase().trim() === String(cls.gradingScaleId).toLowerCase().trim()
        );
        if (customScale && (customScale.items || customScale.ranges)) {
            return customScale.items || customScale.ranges;
        }
    }

    // Auto-detect department/level
    let scales = [];
    try {
        if (typeof adminState !== 'undefined' && Array.isArray(adminState.gradingScales)) {
            scales = adminState.gradingScales;
        } else {
            scales = JSON.parse(localStorage.getItem('gradingScales') || '[]');
        }
    } catch(e) {
        scales = JSON.parse(localStorage.getItem('gradingScales') || '[]');
    }

    const className = (cls?.name || String(classIdOrName)).toLowerCase();
    const dept = (cls?.department || cls?.level || '').toLowerCase();
    
    // Check if there is an active custom scale configured for this department
    if (dept) {
        const deptScale = scales.find(s => s.isActive && s.department && s.department.toLowerCase() === dept);
        if (deptScale && (deptScale.items || deptScale.ranges)) {
            return deptScale.items || deptScale.ranges;
        }
    }

    if (className.includes('jhs') || className.includes('basic 7') || className.includes('basic 8') || className.includes('basic 9') || dept === 'jhs' || cls?.level === 'JHS') {
        const jhsScale = scales.find(s => s.isActive && (s.department === 'JHS' || (s.name || '').toLowerCase().includes('jhs')));
        if (jhsScale && (jhsScale.items || jhsScale.ranges)) return jhsScale.items || jhsScale.ranges;
        return PRESET_GRADING_SCALES.JHS_BECE.items;
    }

    const primaryScale = scales.find(s => s.isActive && (s.department === 'Primary' || (s.name || '').toLowerCase().includes('primary')));
    if (primaryScale && (primaryScale.items || primaryScale.ranges)) return primaryScale.items || primaryScale.ranges;

    return getActiveGradingScale();
}

function getGradeForScore(totalScore, scaleOrClass = null) {
    let activeScale = null;
    if (Array.isArray(scaleOrClass)) {
        activeScale = scaleOrClass;
    } else if (typeof scaleOrClass === 'string' && scaleOrClass) {
        activeScale = getGradingScaleForClass(scaleOrClass);
    } else {
        activeScale = getActiveGradingScale();
    }

    let t = Number(totalScore) || 0;
    if (t < 0) t = 0;
    if (t > 100) t = 100;

    for (const item of activeScale) {
        if (t >= item.min && t <= item.max) {
            return item;
        }
    }
    return activeScale[activeScale.length - 1] || { grade: 'B', remark: 'BEGINNER' };
}

// ──────────────────────────────────────────────────────────────────────────────
// JHS BECE AGGREGATE CALCULATION ENGINE (4 Core + Best 2 Electives = 6 Subjects)
// ──────────────────────────────────────────────────────────────────────────────

function calculateBECEAggregate(subjectScoresMap) {
    if (!subjectScoresMap || typeof subjectScoresMap !== 'object') {
        return { aggregate: null, isEligible: false, reason: 'No subject scores recorded' };
    }

    const beceScale = PRESET_GRADING_SCALES.JHS_BECE.items;

    // Define Core Subject matches
    const CORE_PATTERNS = {
        english: ['english', 'english language', 'eng'],
        math:    ['math', 'mathematics', 'core math'],
        science: ['science', 'integrated science', 'int science', 'general science'],
        social:  ['social', 'social studies', 'rme', 'religious and moral education']
    };

    const evaluatedSubjects = [];

    Object.keys(subjectScoresMap).forEach(subjectName => {
        const entry = subjectScoresMap[subjectName];
        if (!entry || entry.totalScore === '' || entry.totalScore === undefined) return;

        const totalScore = parseFloat(entry.totalScore) || 0;
        const gradeInfo  = getGradeForScore(totalScore, beceScale);

        evaluatedSubjects.push({
            name: subjectName,
            totalScore,
            grade: gradeInfo.grade,
            point: gradeInfo.point || 9,
            remark: gradeInfo.remark
        });
    });

    if (evaluatedSubjects.length < 6) {
        return { aggregate: null, isEligible: false, reason: `Requires at least 6 subjects (currently ${evaluatedSubjects.length})` };
    }

    // Match 4 Core subjects
    let coreEnglish = null;
    let coreMath    = null;
    let coreScience = null;
    let coreSocial  = null;

    const electivesPool = [];

    evaluatedSubjects.forEach(sub => {
        const sName = sub.name.toLowerCase();

        if (!coreEnglish && CORE_PATTERNS.english.some(p => sName.includes(p))) {
            coreEnglish = sub;
        } else if (!coreMath && CORE_PATTERNS.math.some(p => sName.includes(p))) {
            coreMath = sub;
        } else if (!coreScience && CORE_PATTERNS.science.some(p => sName.includes(p))) {
            coreScience = sub;
        } else if (!coreSocial && CORE_PATTERNS.social.some(p => sName.includes(p))) {
            coreSocial = sub;
        } else {
            electivesPool.push(sub);
        }
    });

    // Fallback assignment if naming differs
    if (!coreEnglish) coreEnglish = evaluatedSubjects[0];
    if (!coreMath)    coreMath    = evaluatedSubjects.find(s => s !== coreEnglish) || evaluatedSubjects[1];
    if (!coreScience) coreScience = evaluatedSubjects.find(s => s !== coreEnglish && s !== coreMath) || evaluatedSubjects[2];
    if (!coreSocial)  coreSocial  = evaluatedSubjects.find(s => s !== coreEnglish && s !== coreMath && s !== coreScience) || evaluatedSubjects[3];

    const assignedCores = [coreEnglish, coreMath, coreScience, coreSocial].filter(Boolean);

    // Remaining subjects become electives
    const remainingElectives = evaluatedSubjects.filter(s => !assignedCores.includes(s));
    remainingElectives.sort((a, b) => a.point - b.point); // Lowest point = best grade (Grade 1 is better than Grade 9)

    const bestTwoElectives = remainingElectives.slice(0, 2);

    const totalCalculatedSubjects = [...assignedCores, ...bestTwoElectives];
    if (totalCalculatedSubjects.length < 6) {
        return { aggregate: null, isEligible: false, reason: 'Insufficient subject coverage for BECE Aggregate' };
    }

    const aggregate = totalCalculatedSubjects.reduce((sum, sub) => sum + sub.point, 0);

    return {
        aggregate: aggregate < 10 ? `0${aggregate}` : `${aggregate}`,
        aggregateRaw: aggregate,
        isEligible: true,
        coreSubjects: assignedCores,
        bestElectives: bestTwoElectives,
        summaryText: `BECE Aggregate ${aggregate < 10 ? '0' + aggregate : aggregate} (${assignedCores.length} Cores + 2 Best Electives)`
    };
}

// ──────────────────────────────────────────────────────────────────────────────
// COLOR THEME & CSS VARIABLES INJECTION
// ──────────────────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
    if (!hex || typeof hex !== 'string') return null;
    let c = hex.trim().replace(/^#/, '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    if (c.length !== 6) return null;
    const num = parseInt(c, 16);
    if (isNaN(num)) return null;
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function adjustColorBrightness(hex, percent) {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    const adjust = (val) => Math.max(0, Math.min(255, Math.round(val + (val * percent) / 100)));
    const r = adjust(rgb.r).toString(16).padStart(2, '0');
    const g = adjust(rgb.g).toString(16).padStart(2, '0');
    const b = adjust(rgb.b).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
}

function applySystemTheme(customSettings) {
    let settings = customSettings;
    if (!settings) {
        try {
            settings = JSON.parse(localStorage.getItem('schoolSettings') || '{}');
        } catch (e) { settings = {}; }
    }
    if (!settings || typeof settings !== 'object') settings = {};

    const primary = settings.primaryColor || '#4f46e5';
    const secondary = settings.secondaryColor || '#7e3af2';
    const headerText = settings.headerTextColor || '#ffffff';

    const root = document.documentElement;
    if (!root) return;

    const rgbP = hexToRgb(primary);
    const rgbS = hexToRgb(secondary);

    const primaryLight = adjustColorBrightness(primary, 20);
    const primaryDark = adjustColorBrightness(primary, -20);
    const primaryDarker = adjustColorBrightness(primary, -35);
    const secondaryLight = adjustColorBrightness(secondary, 20);
    const secondaryDark = adjustColorBrightness(secondary, -20);

    // Apply CSS Custom Variables across portals
    root.style.setProperty('--primary', primary);
    root.style.setProperty('--primary-light', primaryLight);
    root.style.setProperty('--primary-dark', primaryDark);
    root.style.setProperty('--primary-darker', primaryDarker);
    root.style.setProperty('--secondary', secondary);
    root.style.setProperty('--secondary-light', secondaryLight);
    root.style.setProperty('--secondary-dark', secondaryDark);
    root.style.setProperty('--header-text-color', headerText);
    root.style.setProperty('--brand-header-text', headerText);
    root.style.setProperty('--brand-accent', secondary);

    if (rgbP) {
        root.style.setProperty('--primary-rgb', `${rgbP.r}, ${rgbP.g}, ${rgbP.b}`);
        root.style.setProperty('--primary-10', `rgba(${rgbP.r}, ${rgbP.g}, ${rgbP.b}, 0.1)`);
        root.style.setProperty('--primary-20', `rgba(${rgbP.r}, ${rgbP.g}, ${rgbP.b}, 0.2)`);
    }
    if (rgbS) {
        root.style.setProperty('--secondary-rgb', `${rgbS.r}, ${rgbS.g}, ${rgbS.b}`);
        root.style.setProperty('--secondary-10', `rgba(${rgbS.r}, ${rgbS.g}, ${rgbS.b}, 0.1)`);
    }

    try {
        window.dispatchEvent(new CustomEvent('systemThemeApplied', { detail: { settings, primary, secondary, headerText } }));
    } catch (e) {}
}

// Auto-run theme injection on script parse and lifecycle events
try {
    applySystemTheme();
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => applySystemTheme());
        }
        window.addEventListener('storage', (e) => {
            if (e.key === 'schoolSettings') {
                try {
                    const updated = JSON.parse(e.newValue || '{}');
                    applySystemTheme(updated);
                } catch (err) {}
            }
        });
    }
} catch (e) {}

// ──────────────────────────────────────────────────────────────────────────────
// SCHOOL SETTINGS — Fetch & Cache
// ──────────────────────────────────────────────────────────────────────────────

async function fetchSchoolSettings() {
    let settings = null;

    // 1. Try local server API
    try {
        const res = await fetch('/api/school-settings');
        if (res.ok) {
            const apiSettings = await res.json();
            if (apiSettings && typeof apiSettings === 'object' && Object.keys(apiSettings).length) {
                settings = apiSettings;
                localStorage.setItem('schoolSettings', JSON.stringify(settings));
                applySystemTheme(settings);
            }
        }
    } catch (e) {}

    // 2. Try Firestore if active
    if (isFirebaseActive && db) {
        try {
            const doc = await db.collection('schoolSettings').doc('main').get();
            if (doc.exists) {
                const cloudSettings = doc.data();
                settings = { ...(settings || {}), ...cloudSettings };
                localStorage.setItem('schoolSettings', JSON.stringify(settings));
                applySystemTheme(settings);
            }
        } catch (e) {
            console.warn('Could not fetch school settings from Firestore:', e);
        }
    }

    // 3. Fallback to localStorage
    if (!settings) {
        const cached = localStorage.getItem('schoolSettings');
        if (cached) {
            try { settings = JSON.parse(cached); } catch (e) {}
        }
    }

    if (settings) {
        applySystemTheme(settings);
    }
    return settings || {};
}

async function saveSchoolSettings(settings) {
    localStorage.setItem('schoolSettings', JSON.stringify(settings));
    applySystemTheme(settings);

    // Save to local server API
    try {
        await fetch('/api/school-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
    } catch (e) {
        console.warn('Could not save school settings to local API:', e);
    }

    // Save to Firestore if active
    if (isFirebaseActive && db) {
        try {
            await db.collection('schoolSettings').doc('main').set({
                ...settings,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        } catch (e) {
            console.warn('Could not save school settings to Firestore:', e);
        }
    }

    try {
        window.dispatchEvent(new CustomEvent('schoolSettingsUpdated', { detail: settings }));
    } catch (e) {}

    await logActivity('School Settings Updated', 'School settings saved');
}

// ──────────────────────────────────────────────────────────────────────────────
// ACTIVE ACADEMIC YEAR & TERM
// ──────────────────────────────────────────────────────────────────────────────

async function fetchActiveAcademicYear() {
    const cached = localStorage.getItem('activeAcademicYear');
    let yearData = cached ? JSON.parse(cached) : null;

    if (isFirebaseActive && db) {
        try {
            const snap = await db.collection('academicYears').where('isActive', '==', true).limit(1).get();
            if (!snap.empty) {
                yearData = { id: snap.docs[0].id, ...snap.docs[0].data() };
                localStorage.setItem('activeAcademicYear', JSON.stringify(yearData));
            }
        } catch (e) {
            console.warn('Could not fetch academic year:', e);
        }
    }

    return yearData;
}

async function fetchActiveTerm() {
    const cached = localStorage.getItem('activeTerm');
    let termData = cached ? JSON.parse(cached) : null;

    if (isFirebaseActive && db) {
        try {
            const snap = await db.collection('terms').where('isActive', '==', true).limit(1).get();
            if (!snap.empty) {
                termData = { id: snap.docs[0].id, ...snap.docs[0].data() };
                localStorage.setItem('activeTerm', JSON.stringify(termData));
            }
        } catch (e) {
            console.warn('Could not fetch active term:', e);
        }
    }

    return termData;
}

// ──────────────────────────────────────────────────────────────────────────────
// RESULTS WORKFLOW
// ──────────────────────────────────────────────────────────────────────────────

// Valid status transitions
const RESULT_STATUSES = ['Draft', 'Submitted', 'Reviewed', 'Approved', 'Published'];

async function saveResult(resultData) {
    if (!isFirebaseActive || !db) {
        // Local fallback
        const results = JSON.parse(localStorage.getItem('results') || '[]');
        const idx = results.findIndex(r => r.id === resultData.id);
        if (idx >= 0) results[idx] = resultData; else results.push(resultData);
        localStorage.setItem('results', JSON.stringify(results));
        return resultData;
    }

    const docRef = resultData.id
        ? db.collection('results').doc(resultData.id)
        : db.collection('results').doc();

    const data = {
        ...resultData,
        id: docRef.id,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (!resultData.id) data.createdAt = firebase.firestore.FieldValue.serverTimestamp();

    await docRef.set(data, { merge: true });
    await logActivity('Result Saved', `Score saved for student ${resultData.studentId}, subject ${resultData.subjectId}`);
    return { ...data, id: docRef.id };
}

async function submitResultsForApproval(resultIds) {
    if (!isFirebaseActive || !db) return;
    const batch = db.batch();
    resultIds.forEach(id => {
        batch.update(db.collection('results').doc(id), {
            status: 'Submitted',
            submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
            submittedBy: auth?.currentUser?.uid || null
        });
    });
    await batch.commit();
    await logActivity('Scores Submitted', `${resultIds.length} results submitted for approval`);
}

async function approveResults(resultIds, action = 'Approved') {
    if (!isFirebaseActive || !db) return;
    if (!isHeadteacher()) throw new Error('Insufficient permissions to approve results.');
    const batch = db.batch();
    resultIds.forEach(id => {
        batch.update(db.collection('results').doc(id), {
            status: action,
            approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
            approvedBy: auth?.currentUser?.uid || null,
            locked: action === 'Approved' || action === 'Published'
        });
    });
    await batch.commit();
    await logActivity('Results Approved', `${resultIds.length} results set to ${action}`);
}

async function unlockResults(resultIds) {
    if (!isFirebaseActive || !db) return;
    if (!isAdmin()) throw new Error('Only admins can unlock results.');
    const batch = db.batch();
    resultIds.forEach(id => {
        batch.update(db.collection('results').doc(id), {
            status: 'Reviewed',
            locked: false,
            unlockedAt: firebase.firestore.FieldValue.serverTimestamp(),
            unlockedBy: auth?.currentUser?.uid || null
        });
    });
    await batch.commit();
    await logActivity('Results Unlocked', `${resultIds.length} results unlocked for editing`);
}

async function fetchResultsForClass(classId, academicYearId, termId) {
    if (!isFirebaseActive || !db) {
        return JSON.parse(localStorage.getItem('results') || '[]')
            .filter(r => r.classId === classId && r.academicYearId === academicYearId && r.termId === termId);
    }

    const snap = await db.collection('results')
        .where('classId', '==', classId)
        .where('academicYearId', '==', academicYearId)
        .where('termId', '==', termId)
        .get();

    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ──────────────────────────────────────────────────────────────────────────────
// GENERIC COLLECTION CRUD
// ──────────────────────────────────────────────────────────────────────────────

async function getCollection(collectionName) {
    if (!isFirebaseActive || !db) {
        return JSON.parse(localStorage.getItem(collectionName) || '[]');
    }
    try {
        const snap = await db.collection(collectionName).get();
        if (!snap.empty) {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            localStorage.setItem(collectionName, JSON.stringify(data));
            return data;
        }
    } catch (e) {
        console.warn(`Could not get collection ${collectionName} directly:`, e);
    }
    return JSON.parse(localStorage.getItem(collectionName) || '[]');
}

// ──────────────────────────────────────────────────────────────────────────────
// CLOUD WRITE DEBOUNCER & HASH CACHE (Prevents Firestore Write Queue Exhaustion)
// ──────────────────────────────────────────────────────────────────────────────
const _firestoreWriteTimers = {};
const _firestoreLastPayloadHash = {};

function _simpleHash(str) {
    let hash = 0;
    if (!str || str.length === 0) return hash;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return String(hash);
}

function scheduleDebouncedFirestoreSync(collectionName, data) {
    if (!isFirebaseActive || !db) return;
    const str = typeof data === 'string' ? data : JSON.stringify(data || []);
    const hash = _simpleHash(str);
    if (_firestoreLastPayloadHash[collectionName] === hash) {
        return; // No change in data, avoid redundant cloud write
    }

    if (_firestoreWriteTimers[collectionName]) {
        clearTimeout(_firestoreWriteTimers[collectionName]);
    }

    _firestoreWriteTimers[collectionName] = setTimeout(async () => {
        delete _firestoreWriteTimers[collectionName];
        try {
            const schoolId = localStorage.getItem('schoolId') || 'default_school';
            await db.collection('schools').doc(schoolId).collection(collectionName).doc('main_data').set({
                payload: str,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            _firestoreLastPayloadHash[collectionName] = hash;
        } catch (e) {
            console.warn(`Firestore debounced sync notice for ${collectionName}:`, e);
        }
    }, 1500); // 1.5s debounce batching
}

async function addDocument(collectionName, data) {
    let newItem;
    const docId = data.id || data.uid || `id_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    newItem = { ...data, id: String(docId), createdAt: data.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };

    // 1. Always update local cache & server instantly
    const items = JSON.parse(localStorage.getItem(collectionName) || '[]');
    const idx = items.findIndex(i => String(i.id) === String(newItem.id) || (newItem.uid && String(i.uid) === String(newItem.uid)));
    if (idx >= 0) items[idx] = newItem;
    else items.push(newItem);
    localStorage.setItem(collectionName, JSON.stringify(items));
    syncCollectionToServer(collectionName);

    // 2. Cloud Firestore write in background via debounced scheduler
    scheduleDebouncedFirestoreSync(collectionName, items);

    return newItem;
}

async function updateDocument(collectionName, docId, data) {
    // 1. Always update local cache & server instantly
    const items = JSON.parse(localStorage.getItem(collectionName) || '[]');
    const idx = items.findIndex(i => String(i.id) === String(docId) || String(i.uid) === String(docId));
    if (idx >= 0) {
        items[idx] = { ...items[idx], ...data, id: docId, updatedAt: new Date().toISOString() };
        localStorage.setItem(collectionName, JSON.stringify(items));
        syncCollectionToServer(collectionName);
    }

    // 2. Cloud Firestore write in background via debounced scheduler
    scheduleDebouncedFirestoreSync(collectionName, items);
}

async function deleteDocument(collectionName, docId) {
    // 1. Always update local cache & server instantly
    const items = JSON.parse(localStorage.getItem(collectionName) || '[]').filter(i => String(i.id) !== String(docId) && String(i.uid) !== String(docId));
    localStorage.setItem(collectionName, JSON.stringify(items));
    syncCollectionToServer(collectionName);

    // 2. Cloud Firestore write in background via debounced scheduler
    scheduleDebouncedFirestoreSync(collectionName, items);
}

async function getDocument(collectionName, docId) {
    const items = JSON.parse(localStorage.getItem(collectionName) || '[]');
    const local = items.find(i => String(i.id) === String(docId) || String(i.uid) === String(docId));
    if (local) return local;

    if (!isFirebaseActive || !db) return null;
    try {
        const doc = await db.collection(collectionName).doc(String(docId)).get();
        return doc.exists ? { id: doc.id, ...doc.data() } : null;
    } catch (e) {
        return null;
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// LEGACY SYNC FUNCTIONS (backward-compatible with report.js)
// ──────────────────────────────────────────────────────────────────────────────

// Fire-and-forget mirror of a collection to the local Node server so other
// portals (teacher/student) pick up admin changes even without Firebase.
function syncCollectionToServer(collectionName) {
    try {
        const payload = {};
        payload[collectionName] = JSON.parse(localStorage.getItem(collectionName) || '[]');
        fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(() => {});
    } catch (e) {}
}

async function syncSaveCollection(collectionName, data) {
    localStorage.setItem(collectionName, JSON.stringify(data));

    // Non-blocking sync to REST API backend
    try {
        const payload = {};
        payload[collectionName] = data;
        fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(() => {});
    } catch (e) {}

    // Non-blocking, debounced and diff-checked Firestore sync
    scheduleDebouncedFirestoreSync(collectionName, data);
}

async function syncFetchCollection(collectionName, fallbackData) {
    const localData = localStorage.getItem(collectionName);
    let parsedLocal = localData ? JSON.parse(localData) : fallbackData;

    if (!isFirebaseActive || !db) return parsedLocal;

    try {
        const schoolId = localStorage.getItem('schoolId') || 'default_school';
        const doc = await db.collection('schools').doc(schoolId).collection(collectionName).doc('main_data').get();
        if (doc.exists && doc.data().payload) {
            const remoteData = JSON.parse(doc.data().payload);
            localStorage.setItem(collectionName, JSON.stringify(remoteData));
            return remoteData;
        }
    } catch (err) {
        console.error(`Error fetching ${collectionName} from Firebase:`, err);
    }

    return parsedLocal;
}

// ──────────────────────────────────────────────────────────────────────────────
// CONTINUOUS AUTO-SYNC ENGINE
// ──────────────────────────────────────────────────────────────────────────────
let autoSyncInterval = null;
let isAutoSyncing = false;

async function runAutoSyncCycle() {
    if (isAutoSyncing) return;
    isAutoSyncing = true;
    const collectionsToSync = ['teachers', 'students', 'classes', 'subjects', 'scores', 'reports', 'schoolSettings', 'schoolInfo', 'auditLogs', 'schoolDepartments'];

    try {
        const localPayload = {};
        collectionsToSync.forEach(col => {
            const raw = localStorage.getItem(col);
            if (raw) {
                try { localPayload[col] = JSON.parse(raw); } catch (e) {}
            }
        });

        // 1. Sync with Local / Cloud REST API backend
        const res = await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(localPayload)
        }).catch(() => null);

        if (res && res.ok) {
            const serverData = await res.json().catch(() => null);
            if (serverData && typeof serverData === 'object') {
                collectionsToSync.forEach(col => {
                    if (serverData[col] !== undefined && serverData[col] !== null) {
                        const localRaw = localStorage.getItem(col);
                        const serverRaw = JSON.stringify(serverData[col]);
                        if (localRaw !== serverRaw) {
                            localStorage.setItem(col, serverRaw);
                        }
                    }
                });
            }
        }

        // 2. Sync with Firebase Firestore (background with diff-checking)
        if (isFirebaseActive && db) {
            const schoolId = localStorage.getItem('schoolId') || 'default_school';
            for (const col of collectionsToSync) {
                const data = localPayload[col];
                if (data) {
                    const rawStr = JSON.stringify(data);
                    const hash = _simpleHash(rawStr);
                    // Only write to Firestore if the content has changed since the last write
                    if (_firestoreLastPayloadHash[col] !== hash) {
                        await db.collection('schools').doc(schoolId).collection(col).doc('main_data').set({
                            payload: rawStr,
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                        }).then(() => {
                            _firestoreLastPayloadHash[col] = hash;
                        }).catch(() => {});
                    }
                }
            }
        }
    } catch (syncErr) {
        console.warn('Auto-sync background cycle notice:', syncErr);
    } finally {
        isAutoSyncing = false;
    }
}

function startContinuousAutoSync() {
    if (autoSyncInterval) clearInterval(autoSyncInterval);
    setTimeout(runAutoSyncCycle, 3000);
    // Interval adjusted to 60s to prevent stream queue saturation
    autoSyncInterval = setInterval(runAutoSyncCycle, 60000);

    window.addEventListener('online', runAutoSyncCycle);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') runAutoSyncCycle();
    });
}

// Auto-start sync engine
if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startContinuousAutoSync);
    } else {
        startContinuousAutoSync();
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// IMAGE UPLOAD
// ──────────────────────────────────────────────────────────────────────────────

async function uploadImageToCloud(file, path) {
    if (!isFirebaseActive || !storage) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    try {
        const storageRef = storage.ref(`${path}/${Date.now()}_${file.name}`);
        const snapshot = await storageRef.put(file);
        return await snapshot.ref.getDownloadURL();
    } catch (err) {
        console.error('Storage Upload Error:', err);
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// AUDIT LOGGING
// ──────────────────────────────────────────────────────────────────────────────

async function logActivity(action, details = '', affectedRecord = '') {
    const user = (typeof getCurrentUserProfile === 'function' && (getCurrentUserProfile()?.displayName || getCurrentUserProfile()?.name || getCurrentUserProfile()?.email))
        || (typeof auth !== 'undefined' && (auth?.currentUser?.displayName || auth?.currentUser?.email))
        || sessionStorage.getItem('adminEmail')
        || sessionStorage.getItem('teacherName')
        || 'School Admin';
    const role = (typeof getCurrentUserRole === 'function' ? getCurrentUserRole() : null) || 'Super Admin';

    const logEntry = {
        id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        user,
        role,
        action,
        details,
        affectedRecord,
        timestamp: new Date().toISOString(),
        formattedTime: new Date().toLocaleString()
    };

    // Local log
    let logs = JSON.parse(localStorage.getItem('auditLogs') || '[]');
    logs.unshift(logEntry);
    if (logs.length > 500) logs = logs.slice(0, 500);
    localStorage.setItem('auditLogs', JSON.stringify(logs));

    if (typeof adminState !== 'undefined' && adminState && Array.isArray(adminState.auditLogs)) {
        adminState.auditLogs = logs;
    }

    // Sync to Node REST server
    try {
        fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ auditLogs: logs })
        }).catch(() => {});
    } catch (e) {}

    // Firestore log
    if (isFirebaseActive && db) {
        try {
            await db.collection('auditLogs').doc(logEntry.id).set(logEntry);
        } catch (e) {
            console.warn('Failed to push audit log:', e);
        }
    }

    return logEntry;
}

async function fetchAuditLogs(limit = 100) {
    const localLogs = JSON.parse(localStorage.getItem('auditLogs') || '[]');
    if (!isFirebaseActive || !db) return localLogs;

    try {
        const snapshot = await db.collection('auditLogs')
            .orderBy('timestamp', 'desc')
            .limit(limit)
            .get();
        const logs = snapshot.docs.map(d => d.data());
        if (logs.length) {
            localStorage.setItem('auditLogs', JSON.stringify(logs));
            return logs;
        }
    } catch (e) {
        console.warn('Error fetching audit logs:', e);
    }

    return localLogs;
}

// ──────────────────────────────────────────────────────────────────────────────
// REAL-TIME LISTENERS (legacy support + admin refresh)
// ──────────────────────────────────────────────────────────────────────────────

function setupRealtimeListeners(onDataUpdateCallback) {
    if (!isFirebaseActive || !db) return;

    const schoolId = localStorage.getItem('schoolId') || 'default_school';
    const legacyCollections = ['students', 'scores', 'schoolInfo', 'studentReportDetails', 'parentContacts', 'attendanceMarks', 'attendanceSettings'];

    legacyCollections.forEach(colName => {
        db.collection('schools').doc(schoolId).collection(colName).doc('main_data')
            .onSnapshot(doc => {
                if (doc.exists && doc.data().payload) {
                    try {
                        const remoteData = JSON.parse(doc.data().payload);
                        localStorage.setItem(colName, JSON.stringify(remoteData));
                        if (typeof onDataUpdateCallback === 'function') {
                            onDataUpdateCallback(colName, remoteData);
                        }
                    } catch (err) {
                        console.error(`Snapshot parse error for ${colName}:`, err);
                    }
                }
            }, err => console.warn(`Snapshot error for ${colName}:`, err));
    });
}

// Real-time listener for admin collections
function setupAdminRealtimeListeners(collectionsConfig, onUpdate) {
    if (!isFirebaseActive || !db) return [];
    const unsubscribers = [];

    collectionsConfig.forEach(({ name, query }) => {
        const ref = query ? query(db.collection(name)) : db.collection(name);
        const unsub = ref.onSnapshot(snap => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            localStorage.setItem(name, JSON.stringify(data));
            if (typeof onUpdate === 'function') onUpdate(name, data);
        });
        unsubscribers.push(unsub);
    });

    return unsubscribers;
}

const SCHOOL_PAYLOAD_KEYS = [
    'students', 'teachers', 'classes', 'subjects', 'academicYears', 'terms',
    'results', 'reports', 'gradingScales', 'scores', 'schoolInfo',
    'schoolSettings', 'studentReportDetails', 'parentContacts',
    'attendanceMarks', 'attendanceSettings', 'auditLogs'
];

function schoolDocId() {
    return localStorage.getItem('schoolId') || 'living_spring';
}

function isFirebaseConnected() {
    return !!(typeof isFirebaseActive !== 'undefined' && isFirebaseActive && db);
}

function getFirebaseStatusText() {
    if (isFirebaseConnected()) return 'CLOUD';
    const cfg = getStoredFirebaseConfig();
    if (cfg && cfg.apiKey && cfg.projectId) return 'OFFLINE';
    return 'LOCAL';
}

async function pushSchoolToFirebase() {
    if (!isFirebaseConnected()) throw new Error('Firebase is not connected. Paste your config first.');
    const schoolId = schoolDocId();
    localStorage.setItem('schoolId', schoolId);
    const batchWrites = [];
    for (const key of SCHOOL_PAYLOAD_KEYS) {
        let data;
        try { data = JSON.parse(localStorage.getItem(key) || (key === 'scores' || key.endsWith('Settings') || key.includes('Info') || key.includes('Details') || key.includes('Contacts') || key.includes('Marks') ? '{}' : '[]')); }
        catch (e) { data = key === 'scores' ? {} : []; }
        if (data == null) continue;
        batchWrites.push(
            db.collection('schools').doc(schoolId).collection(key).doc('main_data').set({
                payload: JSON.stringify(data),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            })
        );
    }
    const arrays = ['students', 'teachers', 'classes', 'subjects', 'academicYears', 'terms', 'results', 'reports', 'gradingScales'];
    for (const col of arrays) {
        const items = JSON.parse(localStorage.getItem(col) || '[]');
        if (!Array.isArray(items)) continue;
        for (const item of items) {
            const id = String(item.id || item.uid || ('id_' + Date.now() + Math.random().toString(36).slice(2, 6)));
            batchWrites.push(db.collection(col).doc(id).set({ ...item, id }, { merge: true }));
        }
    }
    const settings = JSON.parse(localStorage.getItem('schoolSettings') || '{}');
    batchWrites.push(db.collection('schoolSettings').doc('main').set({ ...settings, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }));
    await Promise.all(batchWrites);
    await logActivity('Firebase Sync', 'Uploaded school data to Firestore');
    return { ok: true, collections: SCHOOL_PAYLOAD_KEYS.length };
}

async function pullSchoolFromFirebase() {
    if (!isFirebaseConnected()) return false;
    const schoolId = schoolDocId();

    // Fetch every collection in parallel. The old sequential loop made sign-in
    // wait for ~28 network round trips one after another, which stalled the UI
    // badly on slow or flaky connections.
    const jobs = [];

    SCHOOL_PAYLOAD_KEYS.forEach(key => {
        jobs.push((async () => {
            const doc = await db.collection('schools').doc(schoolId).collection(key).doc('main_data').get();
            if (doc.exists && doc.data().payload) {
                localStorage.setItem(key, doc.data().payload);
                return true;
            }
            return false;
        })().catch(() => false));
    });

    const arrays = ['students', 'teachers', 'classes', 'subjects', 'academicYears', 'terms', 'results', 'reports', 'gradingScales'];
    arrays.forEach(col => {
        jobs.push((async () => {
            const snap = await db.collection(col).get();
            if (!snap.empty) {
                const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                localStorage.setItem(col, JSON.stringify(data));
                return true;
            }
            return false;
        })().catch(() => false));
    });

    jobs.push((async () => {
        const settingsDoc = await db.collection('schoolSettings').doc('main').get();
        if (settingsDoc.exists) {
            localStorage.setItem('schoolSettings', JSON.stringify(settingsDoc.data()));
            return true;
        }
        return false;
    })().catch(() => false));

    // Cap the whole sync so a dead or slow connection can never stall the UI.
    const results = await Promise.race([
        Promise.allSettled(jobs),
        new Promise(resolve => setTimeout(() => resolve(null), 12000))
    ]);
    if (!results) return false;
    return results.some(r => r.status === 'fulfilled' && r.value === true);
}

async function provisionAuthUser(email, password, displayName, role) {
    if (!isFirebaseConnected() || typeof firebase === 'undefined') throw new Error('Firebase is not connected.');
    if (!email || !password || password.length < 6) throw new Error('Email and a password of at least 6 characters are required.');
    const secondary = firebase.initializeApp(getStoredFirebaseConfig(), 'provision_' + Date.now());
    try {
        const creds = await secondary.auth().createUserWithEmailAndPassword(email, password);
        await db.collection('teachers').doc(creds.user.uid).set({
            id: creds.user.uid,
            uid: creds.user.uid,
            email,
            name: displayName || email,
            displayName: displayName || email,
            role: role || 'Teacher',
            assignedClasses: [],
            assignedSubjects: [],
            status: 'active',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        await secondary.auth().signOut();
        return creds.user.uid;
    } finally {
        try { await secondary.delete(); } catch (e) {}
    }
}

async function provisionStaffFromLocal() {
    if (!isFirebaseConnected()) throw new Error('Firebase is not connected.');
    const teachers = JSON.parse(localStorage.getItem('teachers') || '[]');
    const created = [];
    const skipped = [];
    const people = [];
    // Strict access: only accounts with a saved password are provisioned.
    teachers.forEach(t => {
        if (t.email && t.password) people.push({ email: t.email, name: t.name, role: t.role || 'Teacher', password: t.password });
        else if (t.email) skipped.push(t.email + ' (no password set)');
    });
    for (const p of people) {
        try {
            await provisionAuthUser(p.email, p.password, p.name, p.role);
            created.push(p.email);
        } catch (e) {
            skipped.push(p.email + ' (' + (e.code || e.message) + ')');
        }
    }
    return { created, skipped };
}

function startSchoolRealtime(onChange) {
    if (!isFirebaseConnected()) return;
    setupRealtimeListeners(function (name, data) {
        if (typeof onChange === 'function') onChange(name, data);
    });
    setupAdminRealtimeListeners(
        ['students', 'teachers', 'classes', 'subjects', 'reports', 'results', 'academicYears', 'terms', 'users', 'gradingScales'].map(name => ({ name })),
        function (name, data) {
            if (typeof onChange === 'function') onChange(name, data);
        }
    );
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    initFirebase();
});
