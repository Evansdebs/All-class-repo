// ============================================================================
// Firebase Configuration & Service Layer — OneReal School Management System
// ============================================================================

// Default Firebase Config (fill in from Firebase Console or use Admin Dashboard)
const DEFAULT_FIREBASE_CONFIG = {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: ""
};

let firebaseApp = null;
let db = null;
let auth = null;
let storage = null;
let isFirebaseActive = false;

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

function initFirebase(config = getStoredFirebaseConfig()) {
    if (typeof firebase === 'undefined') {
        console.warn('Firebase SDK not loaded.');
        isFirebaseActive = false;
        return false;
    }

    if (!config || !config.apiKey || !config.projectId) {
        console.log('Firebase config incomplete.');
        isFirebaseActive = false;
        return false;
    }

    try {
        if (!firebase.apps.length) {
            firebaseApp = firebase.initializeApp(config);
        } else {
            firebaseApp = firebase.app();
        }

        db = firebase.firestore();
        auth = firebase.auth();
        if (firebase.storage) storage = firebase.storage();

        // Enable offline persistence
        db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
            if (err.code !== 'failed-precondition' && err.code !== 'unimplemented') {
                console.warn('Persistence error:', err);
            }
        });

        isFirebaseActive = true;

        // Auth state observer
        auth.onAuthStateChanged(async (user) => {
            if (user) {
                await loadUserProfile(user.uid);
            } else {
                currentUserProfile = null;
            }
            updateAuthUI(user);
        });

        console.log('Firebase initialized successfully!');
        return true;
    } catch (error) {
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
        const doc = await db.collection('users').doc(uid).get();
        if (doc.exists) {
            currentUserProfile = { uid, ...doc.data() };
        } else {
            // Create a basic profile if none exists (first-time login)
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

        // Check if teacher account has been deactivated by administrator
        if (currentUserProfile.status === 'inactive') {
            await auth.signOut();
            currentUserProfile = null;
            throw new Error('Your account has been deactivated by the Administrator. Please contact your school administrator.');
        }

        return currentUserProfile;
    } catch (e) {
        if (e.message.includes('deactivated')) throw e;
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
    const creds = await auth.signInWithEmailAndPassword(email, password);
    const profile = await loadUserProfile(creds.user.uid);
    if (profile?.status === 'inactive') {
        await auth.signOut();
        throw new Error('Your account has been deactivated by the Administrator.');
    }
    await logActivity('User Login', `Logged in as ${email}`);
    return creds;
}

async function registerFirebaseUser(email, password, displayName, role = 'Teacher') {
    if (!auth) throw new Error('Firebase Auth not initialized.');
    const creds = await auth.createUserWithEmailAndPassword(email, password);

    // Create user profile in Firestore
    if (db) {
        await db.collection('users').doc(creds.user.uid).set({
            uid: creds.user.uid,
            email,
            displayName: displayName || email,
            role,
            assignedClasses: [],
            assignedSubjects: [],
            status: 'active',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    }

    await loadUserProfile(creds.user.uid);
    await logActivity('User Registration', `Created account ${email} with role ${role}`);
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
function getGradingScaleForClass(classId) {
    if (!classId) return getActiveGradingScale();

    const classes = JSON.parse(localStorage.getItem('classes') || '[]');
    const cls = classes.find(c => c.id === classId || c.name === classId);

    if (cls?.gradingScaleId) {
        const scales = JSON.parse(localStorage.getItem('gradingScales') || '[]');
        const customScale = scales.find(s => s.id === cls.gradingScaleId);
        if (customScale?.items) return customScale.items;
    }

    // Auto-detect JHS vs Primary level
    const className = (cls?.name || classId).toLowerCase();
    if (className.includes('jhs') || cls?.level === 'JHS') {
        return PRESET_GRADING_SCALES.JHS_BECE.items;
    }

    return getActiveGradingScale();
}

function getGradeForScore(totalScore, scale = null) {
    const activeScale = scale || getActiveGradingScale();
    if (totalScore < 0) totalScore = 0;
    if (totalScore > 100) totalScore = 100;

    for (const item of activeScale) {
        if (totalScore >= item.min && totalScore <= item.max) {
            return item;
        }
    }
    return activeScale[activeScale.length - 1];
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
// SCHOOL SETTINGS — Fetch & Cache
// ──────────────────────────────────────────────────────────────────────────────

async function fetchSchoolSettings() {
    const cached = localStorage.getItem('schoolSettings');
    let settings = cached ? JSON.parse(cached) : null;

    if (isFirebaseActive && db) {
        try {
            const doc = await db.collection('schoolSettings').doc('main').get();
            if (doc.exists) {
                settings = doc.data();
                localStorage.setItem('schoolSettings', JSON.stringify(settings));
            }
        } catch (e) {
            console.warn('Could not fetch school settings:', e);
        }
    }

    return settings;
}

async function saveSchoolSettings(settings) {
    localStorage.setItem('schoolSettings', JSON.stringify(settings));
    if (isFirebaseActive && db) {
        await db.collection('schoolSettings').doc('main').set({
            ...settings,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }
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
    const snap = await db.collection(collectionName).get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    localStorage.setItem(collectionName, JSON.stringify(data));
    return data;
}

async function addDocument(collectionName, data) {
    if (!isFirebaseActive || !db) {
        const items = JSON.parse(localStorage.getItem(collectionName) || '[]');
        const newItem = { id: `local_${Date.now()}`, ...data, createdAt: new Date().toISOString() };
        items.push(newItem);
        localStorage.setItem(collectionName, JSON.stringify(items));
        return newItem;
    }
    const ref = await db.collection(collectionName).add({
        ...data,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return { id: ref.id, ...data };
}

async function updateDocument(collectionName, docId, data) {
    if (!isFirebaseActive || !db) {
        const items = JSON.parse(localStorage.getItem(collectionName) || '[]');
        const idx = items.findIndex(i => i.id === docId);
        if (idx >= 0) { items[idx] = { ...items[idx], ...data }; localStorage.setItem(collectionName, JSON.stringify(items)); }
        return;
    }
    await db.collection(collectionName).doc(docId).update({
        ...data,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
}

async function deleteDocument(collectionName, docId) {
    if (!isFirebaseActive || !db) {
        const items = JSON.parse(localStorage.getItem(collectionName) || '[]').filter(i => i.id !== docId);
        localStorage.setItem(collectionName, JSON.stringify(items));
        return;
    }
    await db.collection(collectionName).doc(docId).delete();
}

async function getDocument(collectionName, docId) {
    if (!isFirebaseActive || !db) {
        const items = JSON.parse(localStorage.getItem(collectionName) || '[]');
        return items.find(i => i.id === docId) || null;
    }
    const doc = await db.collection(collectionName).doc(docId).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

// ──────────────────────────────────────────────────────────────────────────────
// LEGACY SYNC FUNCTIONS (backward-compatible with report.js)
// ──────────────────────────────────────────────────────────────────────────────

async function syncSaveCollection(collectionName, data) {
    localStorage.setItem(collectionName, JSON.stringify(data));

    // Sync to REST API backend
    try {
        const payload = {};
        payload[collectionName] = data;
        fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(() => {});
    } catch (e) {}

    if (!isFirebaseActive || !db) return;

    try {
        const schoolId = localStorage.getItem('schoolId') || 'default_school';
        await db.collection('schools').doc(schoolId).collection(collectionName).doc('main_data').set({
            payload: JSON.stringify(data),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (err) {
        console.error(`Firebase Sync Error on ${collectionName}:`, err);
    }
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
    const user = auth?.currentUser?.email || 'System';
    const role = getCurrentUserRole();

    const logEntry = {
        id: `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
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
    const legacyCollections = ['students', 'scores', 'schoolInfo', 'studentReportDetails', 'parentContacts'];

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

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    initFirebase();
});
