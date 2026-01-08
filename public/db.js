/**
 * IndexedDB Database Manager
 * Handles persistent storage for workouts, settings, and cached data
 */

const DB_NAME = 'NeverLoseDB';
const DB_VERSION = 2;

const STORES = {
    WORKOUTS: 'workouts',
    PLANNED_WORKOUTS: 'plannedWorkouts',
    SETTINGS: 'settings',
    STRAVA_CACHE: 'stravaCache',
    ROUTES: 'routes'
};

class Database {
    constructor() {
        this.db = null;
        this.ready = this.init();
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Workouts store (both Apple Health and Strava)
                if (!db.objectStoreNames.contains(STORES.WORKOUTS)) {
                    const workoutStore = db.createObjectStore(STORES.WORKOUTS, { keyPath: 'id' });
                    workoutStore.createIndex('date', 'date', { unique: false });
                    workoutStore.createIndex('source', 'source', { unique: false });
                    workoutStore.createIndex('dateSource', ['date', 'source'], { unique: false });
                }

                // Planned workouts store
                if (!db.objectStoreNames.contains(STORES.PLANNED_WORKOUTS)) {
                    const plannedStore = db.createObjectStore(STORES.PLANNED_WORKOUTS, { keyPath: 'id' });
                    plannedStore.createIndex('date', 'date', { unique: false });
                }

                // Settings store
                if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
                    db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
                }

                // Strava cache store
                if (!db.objectStoreNames.contains(STORES.STRAVA_CACHE)) {
                    db.createObjectStore(STORES.STRAVA_CACHE, { keyPath: 'key' });
                }

                // Routes store (GPX data)
                if (!db.objectStoreNames.contains(STORES.ROUTES)) {
                    const routesStore = db.createObjectStore(STORES.ROUTES, { keyPath: 'filename' });
                    routesStore.createIndex('startTime', 'startTime', { unique: false });
                }
            };
        });
    }

    async ensureReady() {
        await this.ready;
    }

    // Generic CRUD operations
    async add(storeName, data) {
        await this.ensureReady();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.add(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async put(storeName, data) {
        await this.ensureReady();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.put(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async get(storeName, key) {
        await this.ensureReady();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getAll(storeName) {
        await this.ensureReady();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async delete(storeName, key) {
        await this.ensureReady();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async clear(storeName) {
        await this.ensureReady();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // Bulk operations for performance
    async bulkPut(storeName, items) {
        await this.ensureReady();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            
            items.forEach(item => store.put(item));
            
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    // Workout-specific methods
    async saveWorkouts(workouts) {
        return this.bulkPut(STORES.WORKOUTS, workouts);
    }

    async getAllWorkouts() {
        return this.getAll(STORES.WORKOUTS);
    }

    async getWorkoutsBySource(source) {
        await this.ensureReady();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORES.WORKOUTS, 'readonly');
            const store = tx.objectStore(STORES.WORKOUTS);
            const index = store.index('source');
            const request = index.getAll(source);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async clearWorkoutsBySource(source) {
        const workouts = await this.getWorkoutsBySource(source);
        await this.ensureReady();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORES.WORKOUTS, 'readwrite');
            const store = tx.objectStore(STORES.WORKOUTS);
            workouts.forEach(w => store.delete(w.id));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    // Planned workout methods
    async savePlannedWorkout(workout) {
        return this.put(STORES.PLANNED_WORKOUTS, workout);
    }

    async savePlannedWorkouts(workouts) {
        await this.ready;
        const tx = this.db.transaction(STORES.PLANNED_WORKOUTS, 'readwrite');
        const store = tx.objectStore(STORES.PLANNED_WORKOUTS);
        
        for (const workout of workouts) {
            store.put(workout);
        }
        
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async clearPlannedWorkouts() {
        await this.ready;
        const tx = this.db.transaction(STORES.PLANNED_WORKOUTS, 'readwrite');
        const store = tx.objectStore(STORES.PLANNED_WORKOUTS);
        store.clear();
        
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async getAllPlannedWorkouts() {
        return this.getAll(STORES.PLANNED_WORKOUTS);
    }

    async deletePlannedWorkout(id) {
        return this.delete(STORES.PLANNED_WORKOUTS, id);
    }

    // Settings methods
    async getSetting(key, defaultValue = null) {
        const result = await this.get(STORES.SETTINGS, key);
        // Check if result exists (not undefined/null), then return its value
        // This properly handles false/0 values
        return result !== undefined && result !== null ? result.value : defaultValue;
    }

    async setSetting(key, value) {
        return this.put(STORES.SETTINGS, { key, value });
    }

    // Strava cache methods
    async getStravaCache(key) {
        const result = await this.get(STORES.STRAVA_CACHE, key);
        if (result && result.expiresAt > Date.now()) {
            return result.data;
        }
        return null;
    }

    async setStravaCache(key, data, ttlMinutes = 60) {
        return this.put(STORES.STRAVA_CACHE, {
            key,
            data,
            expiresAt: Date.now() + (ttlMinutes * 60 * 1000)
        });
    }

    // Route methods
    async saveRoutes(routes) {
        // Convert routes to storable format (serialize Date objects)
        const storableRoutes = routes.map(r => ({
            ...r,
            startTime: r.startTime ? r.startTime.toISOString() : null,
            endTime: r.endTime ? r.endTime.toISOString() : null,
            points: r.points.map(p => ({
                ...p,
                time: p.time ? p.time.toISOString() : null
            })),
            // Preserve HR data (heartRateData is already in timestamp format from parser)
            heartRateData: r.heartRateData || null,
            heartRateAvg: r.heartRateAvg || null,
            heartRateMin: r.heartRateMin || null,
            heartRateMax: r.heartRateMax || null,
            linkedWorkoutId: r.linkedWorkoutId || null
        }));
        return this.bulkPut(STORES.ROUTES, storableRoutes);
    }

    async getAllRoutes() {
        const routes = await this.getAll(STORES.ROUTES);
        // Restore Date objects
        return routes.map(r => ({
            ...r,
            startTime: r.startTime ? new Date(r.startTime) : null,
            endTime: r.endTime ? new Date(r.endTime) : null,
            points: r.points.map(p => ({
                ...p,
                time: p.time ? new Date(p.time) : null
            })),
            // HR data is restored as-is (timestamps remain as numbers)
            heartRateData: r.heartRateData || null,
            heartRateAvg: r.heartRateAvg || null,
            heartRateMin: r.heartRateMin || null,
            heartRateMax: r.heartRateMax || null,
            linkedWorkoutId: r.linkedWorkoutId || null
        }));
    }

    async clearRoutes() {
        return this.clear(STORES.ROUTES);
    }

    // Clear all data
    async clearAllData() {
        await Promise.all([
            this.clear(STORES.WORKOUTS),
            this.clear(STORES.PLANNED_WORKOUTS),
            this.clear(STORES.SETTINGS),
            this.clear(STORES.STRAVA_CACHE),
            this.clear(STORES.ROUTES)
        ]);
    }

    // Export all data as JSON
    async exportData() {
        const [workouts, plannedWorkouts, settings] = await Promise.all([
            this.getAll(STORES.WORKOUTS),
            this.getAll(STORES.PLANNED_WORKOUTS),
            this.getAll(STORES.SETTINGS)
        ]);

        return {
            exportDate: new Date().toISOString(),
            workouts,
            plannedWorkouts,
            settings
        };
    }
}

// Create global database instance
const db = new Database();

