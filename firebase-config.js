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
            // Sessions persist across page navigations and refreshes on the device.
            auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
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

let authHelperApp = null;
function getAuthHelperApp() {
    if (!authHelperApp && typeof firebase !== 'undefined') {
        try {
            authHelperApp = firebase.app('auth_helper');
        } catch (e) {
            try {
                authHelperApp = firebase.initializeApp(getStoredFirebaseConfig(), 'auth_helper');
            } catch (err) {
                authHelperApp = firebaseApp;
            }
        }
    }
    return authHelperApp;
}

async function loadUserProfile(uid) {
    const email = (auth && auth.currentUser?.email) || '';
    
    // 1. Instant check from local cache for sub-millisecond profile resolution
    try {
        const teachers = JSON.parse(localStorage.getItem('teachers') || '[]');
        const users = JSON.parse(localStorage.getItem('users') || '[]');
        const localMatch = teachers.find(t => (uid && (t.id === uid || t.uid === uid)) || (email && (t.email || '').toLowerCase() === email.toLowerCase()))
            || users.find(u => (uid && (u.id === uid || u.uid === uid)) || (email && (u.email || '').toLowerCase() === email.toLowerCase()));

        if (localMatch) {
            currentUserProfile = {
                ...localMatch,
                uid: uid || localMatch.uid || localMatch.id,
                displayName: localMatch.name || localMatch.displayName || email || 'Teacher'
            };
            if (currentUserProfile.status === 'inactive' || currentUserProfile.status === 'deleted' || currentUserProfile.isDeleted) {
                if (auth) await auth.signOut().catch(() => {});
                currentUserProfile = null;
                throw new Error('Your account has been deactivated / deleted by the Administrator. Please contact your school administrator.');
            }
        }
    } catch (e) {
        if (e.message && (e.message.includes('deactivated') || e.message.includes('deleted'))) throw e;
    }

    if (!db) {
        if (!currentUserProfile && uid) {
            currentUserProfile = {
                uid,
                email,
                displayName: (auth && auth.currentUser?.displayName) || email || 'Teacher',
                role: 'Teacher',
                assignedClasses: [],
                assignedSubjects: [],
                status: 'active'
            };
        }
        return currentUserProfile;
    }

    // 2. Fast background check against Firestore with a tight timeout so UI never hangs
    try {
        const fetchRemoteProfile = async () => {
            let doc = await db.collection('teachers').doc(uid).get();
            if (doc.exists) {
                return { uid, ...doc.data(), displayName: doc.data().name || doc.data().displayName };
            }
            if (email) {
                const snap = await db.collection('teachers')
                    .where('email', '==', email)
                    .limit(1).get();
                if (!snap.empty) {
                    const data = snap.docs[0].data();
                    return { uid, ...data, id: snap.docs[0].id, displayName: data.name || data.displayName };
                }
            }
            return null;
        };

        const remote = await Promise.race([
            fetchRemoteProfile(),
            new Promise(resolve => setTimeout(() => resolve(null), 2000))
        ]);

        if (remote) {
            currentUserProfile = { ...(currentUserProfile || {}), ...remote };
            if (currentUserProfile.status === 'inactive' || currentUserProfile.status === 'deleted' || currentUserProfile.isDeleted) {
                if (auth) await auth.signOut().catch(() => {});
                currentUserProfile = null;
                throw new Error('Your account has been deactivated / deleted by the Administrator. Please contact your school administrator.');
            }
        }
    } catch (e) {
        if (e.message && (e.message.includes('deactivated') || e.message.includes('deleted'))) throw e;
        console.warn('Could not load user profile from cloud:', e);
    }

    if (!currentUserProfile) {
        currentUserProfile = {
            uid,
            email,
            displayName: (auth && auth.currentUser?.displayName) || email || 'Teacher',
            role: 'Teacher',
            assignedClasses: [],
            assignedSubjects: [],
            status: 'active'
        };
    }

    return currentUserProfile;
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
    try { await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch (e) {}
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
    
    // Use reusable singleton secondary helper app to eliminate heavy initialization latency
    const helperApp = getAuthHelperApp();
    if (!helperApp) throw new Error('Firebase Auth helper could not be created.');
    
    const helperAuth = helperApp.auth();
    const creds = await helperAuth.createUserWithEmailAndPassword(email, password);

    try {
        if (displayName && creds.user && creds.user.updateProfile) {
            await creds.user.updateProfile({ displayName }).catch(() => {});
        }
    } catch (e) {}

    const profileData = {
        id: creds.user.uid,
        uid: creds.user.uid,
        email,
        password,
        name: displayName || email,
        displayName: displayName || email,
        role,
        assignedClasses: extraData.assignedClasses || [],
        assignedSubjects: extraData.assignedSubjects || [],
        phone: extraData.phone || '',
        status: extraData.status || 'active',
        createdAt: new Date().toISOString()
    };

    // Immediately cache in local lists for instant local and cross-tab login without delay
    try {
        const teachers = JSON.parse(localStorage.getItem('teachers') || '[]');
        const tIdx = teachers.findIndex(t => (t.email || '').toLowerCase() === email.toLowerCase());
        if (tIdx >= 0) teachers[tIdx] = { ...teachers[tIdx], ...profileData };
        else teachers.push(profileData);
        localStorage.setItem('teachers', JSON.stringify(teachers));

        const users = JSON.parse(localStorage.getItem('users') || '[]');
        const uIdx = users.findIndex(u => (u.email || '').toLowerCase() === email.toLowerCase());
        if (uIdx >= 0) users[uIdx] = { ...users[uIdx], ...profileData };
        else users.push(profileData);
        localStorage.setItem('users', JSON.stringify(users));

        if (typeof syncSaveCollection === 'function') {
            syncSaveCollection('teachers', teachers).catch(() => {});
            syncSaveCollection('users', users).catch(() => {});
        }
    } catch (e) {}

    // Create staff profile in both teachers and users collections in Firestore
    if (db) {
        const schoolId = localStorage.getItem('schoolId') || 'default_school';
        Promise.all([
            db.collection('teachers').doc(creds.user.uid).set(profileData, { merge: true }),
            db.collection('users').doc(creds.user.uid).set(profileData, { merge: true }),
            db.collection('schools').doc(schoolId).collection('teachers').doc(creds.user.uid).set(profileData, { merge: true }),
            db.collection('schools').doc(schoolId).collection('users').doc(creds.user.uid).set(profileData, { merge: true })
        ]).catch(err => console.warn('Firestore profile creation notice:', err));
    }

    logActivity('Staff Registration', `Created staff account ${email} with role ${role}`).catch(() => {});
    helperAuth.signOut().catch(() => {});
    return creds;
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

// ──────────────────────────────────────────────────────────────────────────────
// CONTINUOUS AUTO-SYNC & INSTANT CROSS-TAB ENGINE
// ──────────────────────────────────────────────────────────────────────────────

const ALL_SYNC_COLLECTIONS = [
    'students', 'teachers', 'classes', 'subjects', 'academicYears', 'terms',
    'results', 'reports', 'gradingScales', 'scores', 'schoolInfo',
    'schoolSettings', 'studentReportDetails', 'parentContacts',
    'attendanceMarks', 'attendanceSettings', 'timetables', 'examTimetables',
    'auditLogs', 'schoolDepartments', 'users', 'alumni'
];

// Cross-tab broadcast channel for instantaneous zero-latency synchronization across open tabs/portals
const _syncBroadcastChannel = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('onereal_cross_portal_sync') : null;
const _onerealSyncSubscribers = new Set();

function registerSyncSubscriber(callback) {
    if (typeof callback === 'function') _onerealSyncSubscribers.add(callback);
    return () => _onerealSyncSubscribers.delete(callback);
}

function notifySyncSubscribers(collection, data) {
    _onerealSyncSubscribers.forEach(cb => {
        try { cb(collection, data); } catch (e) { console.warn('Sync subscriber notification error:', e); }
    });
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('onerealDataSynced', { detail: { collection, data } }));
    }
}

if (_syncBroadcastChannel) {
    _syncBroadcastChannel.onmessage = (event) => {
        const msg = event?.data;
        if (msg && msg.type === 'ONEREAL_SYNC' && msg.collection) {
            try {
                if (msg.data !== undefined) {
                    try {
                        localStorage.setItem(msg.collection, JSON.stringify(msg.data));
                    } catch (err) {}
                }
                notifySyncSubscribers(msg.collection, msg.data);
            } catch (e) {}
        }
    };
}

if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
        if (e.key && ALL_SYNC_COLLECTIONS.includes(e.key) && e.newValue) {
            try {
                const parsed = JSON.parse(e.newValue);
                notifySyncSubscribers(e.key, parsed);
            } catch (err) {}
        }
    });
}

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

    // Instant local broadcast to all other open tabs/portals
    if (_syncBroadcastChannel) {
        try {
            _syncBroadcastChannel.postMessage({
                type: 'ONEREAL_SYNC',
                collection: collectionName,
                data: data,
                timestamp: Date.now()
            });
        } catch (e) {}
    }
    notifySyncSubscribers(collectionName, data);

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
    const collectionsToSync = ALL_SYNC_COLLECTIONS;

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
                let anyUpdated = false;
                collectionsToSync.forEach(col => {
                    if (serverData[col] !== undefined && serverData[col] !== null) {
                        const localRaw = localStorage.getItem(col);
                        const serverRaw = JSON.stringify(serverData[col]);
                        if (localRaw !== serverRaw) {
                            localStorage.setItem(col, serverRaw);
                            notifySyncSubscribers(col, serverData[col]);
                            anyUpdated = true;
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
    setTimeout(runAutoSyncCycle, 1000);
    // Fast 8-second sync interval for rapid multi-portal and cross-device consistency
    autoSyncInterval = setInterval(runAutoSyncCycle, 8000);

    window.addEventListener('online', runAutoSyncCycle);
    window.addEventListener('focus', runAutoSyncCycle);
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
    if (!isFirebaseActive || !db) return [];

    const schoolId = localStorage.getItem('schoolId') || 'default_school';
    const unsubscribers = [];
    const collectionsToListen = ALL_SYNC_COLLECTIONS;

    collectionsToListen.forEach(colName => {
        try {
            const unsub = db.collection('schools').doc(schoolId).collection(colName).doc('main_data')
                .onSnapshot(doc => {
                    if (doc.exists && doc.data() && doc.data().payload) {
                        try {
                            const remoteData = JSON.parse(doc.data().payload);
                            const currentLocal = localStorage.getItem(colName);
                            const remoteStr = JSON.stringify(remoteData);
                            if (currentLocal !== remoteStr) {
                                localStorage.setItem(colName, remoteStr);
                                if (typeof onDataUpdateCallback === 'function') {
                                    onDataUpdateCallback(colName, remoteData);
                                }
                                notifySyncSubscribers(colName, remoteData);
                            }
                        } catch (err) {
                            console.error(`Snapshot parse error for ${colName}:`, err);
                        }
                    }
                }, err => {
                    // Fail silently for background listeners
                });
            unsubscribers.push(unsub);
        } catch (e) {}
    });

    return unsubscribers;
}

// Real-time listener for admin collections
function setupAdminRealtimeListeners(collectionsConfig, onUpdate) {
    if (!isFirebaseActive || !db) return [];
    const unsubscribers = [];

    collectionsConfig.forEach(({ name, query }) => {
        try {
            const ref = query ? query(db.collection(name)) : db.collection(name);
            const unsub = ref.onSnapshot(snap => {
                const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                localStorage.setItem(name, JSON.stringify(data));
                if (typeof onUpdate === 'function') onUpdate(name, data);
                notifySyncSubscribers(name, data);
            }, () => {});
            unsubscribers.push(unsub);
        } catch (e) {}
    });

    return unsubscribers;
}

const SCHOOL_PAYLOAD_KEYS = ALL_SYNC_COLLECTIONS;

function schoolDocId() {
    return localStorage.getItem('schoolId') || 'default_school';
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

    // Cap cloud pull to 3s max so a slow Firebase query never stalls login/actions
    const results = await Promise.race([
        Promise.allSettled(jobs),
        new Promise(resolve => setTimeout(() => resolve(null), 3000))
    ]);
    if (!results) return false;
    return results.some(r => r.status === 'fulfilled' && r.value === true);
}

// Hydrate from server endpoint fast and seamlessly
async function hydrateSchoolFromServer() {
    try {
        const res = await fetch('/api/sync');
        if (!res.ok) return false;
        const dbData = await res.json();
        if (!dbData || typeof dbData !== 'object') return false;

        let changed = false;
        const keys = [
            'students', 'classes', 'subjects', 'teachers', 'users',
            'academicYears', 'terms', 'results', 'reports', 'gradingScales',
            'schoolSettings', 'schoolInfo', 'scores', 'studentReportDetails',
            'parentContacts', 'attendanceMarks', 'attendanceSettings', 'alumni',
            'timetables', 'examTimetables', 'auditLogs', 'schoolDepartments'
        ];

        keys.forEach(k => {
            const remote = dbData[k];
            if (remote === undefined || remote === null) return;
            try {
                const localRaw = localStorage.getItem(k);
                const local = localRaw ? JSON.parse(localRaw) : null;
                if (Array.isArray(remote) && !remote.length && Array.isArray(local) && local.length) return;

                let mergedStr = '';
                if (Array.isArray(remote) && Array.isArray(local) && local.length > 0) {
                    const map = new Map();
                    local.forEach(item => {
                        if (item) {
                            const id = String(item.id || item.uid || item.email || '');
                            if (id) map.set(id, item);
                        }
                    });
                    remote.forEach(item => {
                        if (item) {
                            const id = String(item.id || item.uid || item.email || '');
                            if (id) {
                                const existing = map.get(id);
                                map.set(id, existing ? { ...existing, ...item } : item);
                            } else {
                                map.set('idx_' + Math.random(), item);
                            }
                        }
                    });
                    mergedStr = JSON.stringify(Array.from(map.values()));
                } else if (typeof remote === 'object' && !Array.isArray(remote) && local && typeof local === 'object' && !Array.isArray(local)) {
                    mergedStr = JSON.stringify({ ...local, ...remote });
                } else {
                    mergedStr = JSON.stringify(remote);
                }

                if (localRaw !== mergedStr) {
                    localStorage.setItem(k, mergedStr);
                    changed = true;
                }
            } catch (e) {}
        });
        return changed;
    } catch (e) {
        return false;
    }
}

async function provisionAuthUser(email, password, displayName, role) {
    if (!isFirebaseConnected() || typeof firebase === 'undefined') throw new Error('Firebase is not connected.');
    if (!email || !password || password.length < 6) throw new Error('Email and a password of at least 6 characters are required.');
    const helperApp = getAuthHelperApp();
    if (!helperApp) throw new Error('Firebase Auth helper could not be created.');
    const helperAuth = helperApp.auth();
    const creds = await helperAuth.createUserWithEmailAndPassword(email, password);
    const userData = {
        id: creds.user.uid,
        uid: creds.user.uid,
        email,
        name: displayName || email,
        displayName: displayName || email,
        role: role || 'Teacher',
        assignedClasses: [],
        assignedSubjects: [],
        status: 'active',
        createdAt: new Date().toISOString()
    };
    if (db) {
        const schoolId = localStorage.getItem('schoolId') || 'default_school';
        await Promise.all([
            db.collection('teachers').doc(creds.user.uid).set(userData, { merge: true }),
            db.collection('users').doc(creds.user.uid).set(userData, { merge: true }),
            db.collection('schools').doc(schoolId).collection('teachers').doc(creds.user.uid).set(userData, { merge: true })
        ]).catch(() => {});
    }
    helperAuth.signOut().catch(() => {});
    return creds.user.uid;
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

// ──────────────────────────────────────────────────────────────────────────────
// CROSS-PORTAL & MULTI-DEVICE REALTIME SYNC ENGINE
// ──────────────────────────────────────────────────────────────────────────────

let schoolSyncChannel = null;
try {
    if (typeof BroadcastChannel !== 'undefined') {
        schoolSyncChannel = new BroadcastChannel('onereal_school_sync');
        schoolSyncChannel.onmessage = (event) => {
            if (event && event.data && event.data.collection) {
                const { collection, data } = event.data;
                try {
                    localStorage.setItem(collection, typeof data === 'string' ? data : JSON.stringify(data));
                } catch (e) {}
                window.dispatchEvent(new CustomEvent('onereal_data_updated', {
                    detail: { collection, data }
                }));
            }
        };
    }
} catch (e) {}

window.addEventListener('storage', (e) => {
    if (e.key && e.newValue) {
        try {
            const parsed = JSON.parse(e.newValue);
            window.dispatchEvent(new CustomEvent('onereal_data_updated', {
                detail: { collection: e.key, data: parsed }
            }));
        } catch (err) {}
    }
});

function broadcastDataChange(collection, data) {
    if (!collection) return;
    try {
        if (schoolSyncChannel) {
            schoolSyncChannel.postMessage({ collection, data, timestamp: Date.now() });
        }
        window.dispatchEvent(new CustomEvent('onereal_data_updated', {
            detail: { collection, data }
        }));
    } catch (e) {}
}

// ──────────────────────────────────────────────────────────────────────────────
// TEACHER SCORES <-> ADMIN RESULTS BRIDGE
// ──────────────────────────────────────────────────────────────────────────────

async function syncScoresMapToResults(scoresMap, defaultYear = '2025/2026', defaultTerm = '1') {
    if (!scoresMap || typeof scoresMap !== 'object') return [];
    const localResults = JSON.parse(localStorage.getItem('results') || '[]');
    const students = JSON.parse(localStorage.getItem('students') || '[]');
    const classes = JSON.parse(localStorage.getItem('classes') || '[]');
    const subjects = JSON.parse(localStorage.getItem('subjects') || '[]');
    const activeClass = localStorage.getItem('currentClass') || '';

    const resultsMap = new Map();
    localResults.forEach(r => { if (r && r.id) resultsMap.set(r.id, r); });

    const updatedResults = [];
    const activeYear = JSON.parse(localStorage.getItem('activeAcademicYear') || 'null')?.id || defaultYear;
    const activeTerm = JSON.parse(localStorage.getItem('activeTerm') || 'null')?.id || defaultTerm;

    function processStudentScore(classKey, subjectKey, studentId, entry) {
        if (!entry || typeof entry !== 'object') return;
        const studentObj = students.find(s => String(s.id) === String(studentId) || s.studentId === String(studentId));
        const classObj = classes.find(c => c.id === classKey || c.name === classKey);
        const subjectObj = subjects.find(sub => sub.id === subjectKey || sub.name === subjectKey);

        const studentName = studentObj?.name || entry.studentName || '';
        const className = classObj?.name || classKey || '';
        const subjectName = subjectObj?.name || subjectKey || '';

        const resultDocId = `res_${studentId}_${classKey}_${subjectKey}_${activeYear}_${activeTerm}`.replace(/[\/\s]/g, '_');
        const existing = resultsMap.get(resultDocId) || {};

        const normalized = {
            id: resultDocId,
            studentId: String(studentId),
            studentName: studentName || existing.studentName || '',
            classId: classKey,
            className: className || existing.className || '',
            subjectId: subjectKey,
            subjectName: subjectName || existing.subjectName || '',
            academicYearId: activeYear,
            termId: activeTerm,
            classScore: entry.classScore !== undefined ? entry.classScore : (existing.classScore ?? 0),
            classScore50: entry.classScore50 !== undefined ? entry.classScore50 : (existing.classScore50 ?? ''),
            examScore: entry.examScore !== undefined ? entry.examScore : (existing.examScore ?? 0),
            examScore50: entry.examScore50 !== undefined ? entry.examScore50 : (existing.examScore50 ?? ''),
            totalScore: entry.totalScore !== undefined ? entry.totalScore : (existing.totalScore ?? 0),
            grade: entry.grade || existing.grade || '',
            remark: entry.remark || existing.remark || '',
            status: entry.status || existing.status || 'Submitted',
            locked: entry.locked !== undefined ? entry.locked : (existing.locked !== undefined ? existing.locked : false),
            updatedAt: new Date().toISOString()
        };

        resultsMap.set(resultDocId, normalized);
        updatedResults.push(normalized);
    }

    Object.keys(scoresMap).forEach(key1 => {
        const val1 = scoresMap[key1];
        if (!val1 || typeof val1 !== 'object') return;

        // Check if val1 has student entries directly (2-level: scores[subject][studentId])
        const subKeys = Object.keys(val1);
        if (subKeys.length > 0) {
            const firstChild = val1[subKeys[0]];
            if (firstChild && typeof firstChild === 'object' && (firstChild.classScore !== undefined || firstChild.examScore !== undefined || firstChild.totalScore !== undefined)) {
                // 2-level structure: key1 is subjectKey, subKeys are studentIds
                const subjectKey = key1;
                const classKey = activeClass || (classes[0]?.id || 'General');
                subKeys.forEach(studentId => {
                    processStudentScore(classKey, subjectKey, studentId, val1[studentId]);
                });
            } else {
                // 3-level structure: key1 is classKey, key2 is subjectKey, key3 is studentId
                const classKey = key1;
                subKeys.forEach(subjectKey => {
                    const studentScores = val1[subjectKey];
                    if (studentScores && typeof studentScores === 'object') {
                        Object.keys(studentScores).forEach(studentId => {
                            processStudentScore(classKey, subjectKey, studentId, studentScores[studentId]);
                        });
                    }
                });
            }
        }
    });

    const mergedResults = Array.from(resultsMap.values());
    localStorage.setItem('results', JSON.stringify(mergedResults));
    broadcastDataChange('results', mergedResults);

    if (isFirebaseActive && db && updatedResults.length > 0) {
        try {
            const batch = db.batch();
            const schoolDoc = db.collection('schools').doc(DEFAULT_FIREBASE_CONFIG.projectId || 'onereal_school');
            updatedResults.slice(0, 450).forEach(res => {
                const ref = schoolDoc.collection('results').doc(res.id);
                batch.set(ref, res, { merge: true });
            });
            await batch.commit();
        } catch (e) {
            console.warn('Batch result sync notice:', e.message);
        }
    }

    return mergedResults;
}

async function syncResultStatusToScores(resultIds, newStatus, locked = false) {
    if (!Array.isArray(resultIds) || resultIds.length === 0) return;
    const results = JSON.parse(localStorage.getItem('results') || '[]');
    const scores = JSON.parse(localStorage.getItem('scores') || '{}');
    const reports = JSON.parse(localStorage.getItem('reports') || '[]');
    let modifiedScores = false;

    results.forEach(r => {
        if (resultIds.includes(r.id)) {
            r.status = newStatus;
            r.locked = locked;
            r.approvedAt = newStatus === 'Approved' ? new Date().toISOString() : r.approvedAt;
            r.updatedAt = new Date().toISOString();

            // Check 3-level scores
            if (scores[r.classId] && scores[r.classId][r.subjectId] && scores[r.classId][r.subjectId][r.studentId]) {
                scores[r.classId][r.subjectId][r.studentId].status = newStatus;
                scores[r.classId][r.subjectId][r.studentId].locked = locked;
                modifiedScores = true;
            }
            // Also check 2-level scores
            if (scores[r.subjectId] && scores[r.subjectId][r.studentId]) {
                scores[r.subjectId][r.studentId].status = newStatus;
                scores[r.subjectId][r.studentId].locked = locked;
                modifiedScores = true;
            }
        }
    });

    localStorage.setItem('results', JSON.stringify(results));
    broadcastDataChange('results', results);

    if (modifiedScores) {
        localStorage.setItem('scores', JSON.stringify(scores));
        broadcastDataChange('scores', scores);
    }

    reports.forEach(rp => {
        if (resultIds.some(id => id.includes(rp.studentId || rp.id))) {
            rp.status = newStatus;
            rp.locked = locked;
        }
    });
    localStorage.setItem('reports', JSON.stringify(reports));
    broadcastDataChange('reports', reports);

    if (isFirebaseActive && db) {
        try {
            const batch = db.batch();
            const schoolDoc = db.collection('schools').doc(DEFAULT_FIREBASE_CONFIG.projectId || 'onereal_school');
            resultIds.slice(0, 450).forEach(id => {
                const r = results.find(x => x.id === id);
                if (r) {
                    batch.set(schoolDoc.collection('results').doc(id), { status: newStatus, locked, approvedAt: r.approvedAt || null, updatedAt: r.updatedAt }, { merge: true });
                }
            });
            if (modifiedScores) {
                batch.set(schoolDoc.collection('scores').doc('matrix'), scores, { merge: true });
            }
            await batch.commit();
        } catch (e) {
            console.warn('Firestore status sync notice:', e.message);
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// COMPLETE CASCADE DELETION ENGINE
// ──────────────────────────────────────────────────────────────────────────────

async function deleteUserCascade(identifier) {
    if (!identifier) return false;
    const norm = String(identifier).trim().toLowerCase();

    let users = JSON.parse(localStorage.getItem('users') || '[]');
    let teachers = JSON.parse(localStorage.getItem('teachers') || '[]');
    let classes = JSON.parse(localStorage.getItem('classes') || '[]');
    let resetReqs = JSON.parse(localStorage.getItem('passwordResetRequests') || '[]');

    const targetUser = users.find(u => u.uid === identifier || u.id === identifier || (u.email && u.email.toLowerCase() === norm));
    const targetTeacher = teachers.find(t => t.id === identifier || t.uid === identifier || (t.email && t.email.toLowerCase() === norm));
    const targetEmail = (targetUser?.email || targetTeacher?.email || (norm.includes('@') ? norm : '')).toLowerCase();
    const targetName = targetUser?.displayName || targetUser?.name || targetTeacher?.name || '';
    const targetIds = [identifier, targetUser?.id, targetUser?.uid, targetTeacher?.id, targetTeacher?.uid].filter(Boolean);

    // 1. Purge from users
    users = users.filter(u => !targetIds.includes(u.id) && !targetIds.includes(u.uid) && (!targetEmail || (u.email || '').toLowerCase() !== targetEmail));
    localStorage.setItem('users', JSON.stringify(users));
    broadcastDataChange('users', users);

    // 2. Purge from teachers
    teachers = teachers.filter(t => !targetIds.includes(t.id) && !targetIds.includes(t.uid) && (!targetEmail || (t.email || '').toLowerCase() !== targetEmail));
    localStorage.setItem('teachers', JSON.stringify(teachers));
    broadcastDataChange('teachers', teachers);

    // 3. Unassign from all classes
    let classModified = false;
    classes.forEach(c => {
        if (targetIds.includes(c.classTeacherId) || (targetName && c.classTeacherName === targetName)) {
            c.classTeacherId = '';
            c.classTeacherName = '';
            classModified = true;
        }
        if (Array.isArray(c.assignedTeacherIds)) {
            const before = c.assignedTeacherIds.length;
            c.assignedTeacherIds = c.assignedTeacherIds.filter(id => !targetIds.includes(id));
            if (c.assignedTeacherIds.length !== before) classModified = true;
        }
    });
    if (classModified) {
        localStorage.setItem('classes', JSON.stringify(classes));
        broadcastDataChange('classes', classes);
    }

    // 4. Purge pending password reset requests
    if (targetEmail) {
        resetReqs = resetReqs.filter(r => (r.email || '').toLowerCase() !== targetEmail);
        localStorage.setItem('passwordResetRequests', JSON.stringify(resetReqs));
        broadcastDataChange('passwordResetRequests', resetReqs);
    }

    // 5. Commit Firestore Deletes
    if (isFirebaseActive && db) {
        try {
            const batch = db.batch();
            targetIds.forEach(id => {
                batch.delete(db.collection('users').doc(id));
                batch.delete(db.collection('teachers').doc(id));
            });
            if (targetEmail) {
                const userSnap = await db.collection('users').where('email', '==', targetEmail).get();
                userSnap.forEach(doc => batch.delete(doc.ref));
                const teacherSnap = await db.collection('teachers').where('email', '==', targetEmail).get();
                teacherSnap.forEach(doc => batch.delete(doc.ref));
            }
            if (classModified) {
                classes.forEach(c => {
                    batch.set(db.collection('classes').doc(c.id), c, { merge: true });
                });
            }
            await batch.commit();
        } catch (e) {
            console.warn('Firestore cascade delete notice:', e.message);
        }
    }

    logActivity('User Deleted (Cascade)', `Permanently deleted user ${targetName || targetEmail || identifier} across all systems`).catch(() => {});
    return true;
}

function startSchoolRealtime(onChange) {
    if (!isFirebaseConnected()) return;
    const collectionsToListen = [
        'students', 'teachers', 'classes', 'subjects', 'reports',
        'results', 'academicYears', 'terms', 'users', 'gradingScales',
        'scores', 'schoolSettings', 'schoolInfo', 'parentContacts', 'studentReportDetails'
    ];

    setupRealtimeListeners(function (name, data) {
        if (typeof onChange === 'function') onChange(name, data);
        broadcastDataChange(name, data);
    });

    setupAdminRealtimeListeners(
        collectionsToListen.map(name => ({ name })),
        function (name, data) {
            if (typeof onChange === 'function') onChange(name, data);
            broadcastDataChange(name, data);
        }
    );
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    initFirebase();
});
