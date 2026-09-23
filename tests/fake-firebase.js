// js/storage.js reads window.FIREBASE_CONFIG at load. In the suite there is no
// network and no firebase SDK, so it gets nothing — createStorage treats a null
// config as offline-only, which is exactly the mode we want to test the merge in.
window.FIREBASE_CONFIG = null;
