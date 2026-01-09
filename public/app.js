/**
 * NeverLose Running Tracker - Main Application
 * Orchestrates all components and handles UI interactions
 */

class App {
    constructor() {
        this.workouts = [];
        this.filteredWorkouts = [];
        this.plannedWorkouts = [];
        this.routes = [];
        this.selectedComparisonWorkouts = [];
        this.comparisonMaps = []; // Store comparison map instances
        this.selectedRoute = null;
        this.comparisonMode = false;
        this.currentPage = 1;
        this.pageSize = 20;
        this.useMetric = true;
        this.maxHR = 190;
        this.restingHR = 60;
        this.sortColumn = 'date';
        this.sortDirection = 'desc';
        this.deduplicateWorkouts = true; // Merge similar Apple/Strava workouts

        this.init();
    }

    // Get local date string (YYYY-MM-DD) without timezone conversion
    getLocalDateString(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // Deduplicate workouts - when Apple and Strava have similar workouts, keep Apple
    deduplicateWorkoutsList(workouts) {
        if (!this.deduplicateWorkouts) return workouts;

        const appleWorkouts = workouts.filter(w => w.source === 'apple');
        const stravaWorkouts = workouts.filter(w => w.source === 'strava');
        const otherWorkouts = workouts.filter(w => w.source !== 'apple' && w.source !== 'strava');

        // Find Strava workouts that are duplicates of Apple workouts and merge their data
        const stravaDuplicateIds = new Set();
        const mergedAppleWorkouts = appleWorkouts.map(appleW => {
            const appleTime = (appleW.dateObj || new Date(appleW.date)).getTime();
            const appleDist = appleW.distanceKm || 0;
            
            // Find matching Strava workout
            for (const stravaW of stravaWorkouts) {
                const stravaTime = (stravaW.dateObj || new Date(stravaW.date)).getTime();
                const stravaDist = stravaW.distanceKm || 0;

                // Check time similarity (within 10 minutes)
                const timeDiff = Math.abs(stravaTime - appleTime);
                const timeMatch = timeDiff < 10 * 60 * 1000; // 10 minutes

                // Check distance similarity (within 10% or 0.5km, whichever is greater)
                const distDiff = Math.abs(stravaDist - appleDist);
                const distThreshold = Math.max(0.5, Math.max(stravaDist, appleDist) * 0.1);
                const distMatch = distDiff < distThreshold;

                // If both time and distance match, it's a duplicate - merge Strava data into Apple workout
                // Don't require additional similarity threshold if they pass basic checks
                if (timeMatch && distMatch) {
                    const timeSimilarity = 1 - (timeDiff / (10 * 60 * 1000));
                    const distSimilarity = 1 - (distDiff / distThreshold);
                    const similarity = (timeSimilarity + distSimilarity) / 2;

                    console.log(`[Dedup] Found duplicate: Apple ${appleW.id} (${appleW.date}) matches Strava ${stravaW.id} (${stravaW.date}), similarity: ${(similarity * 100).toFixed(1)}%`);
                    stravaDuplicateIds.add(stravaW.id);
                    
                    // Merge Strava data into Apple workout (fill missing fields)
                    const merged = { ...appleW };
                    
                    // Fill missing HR data from Strava (check for null/undefined, not just falsy)
                    // Use == null to catch both null and undefined
                    // Always prefer Strava HR values if available, as they're usually more accurate
                    if (stravaW.heartRateAvg != null && ((merged.heartRateAvg == null) || stravaW.heartRateData && stravaW.heartRateData.length > 0)) {
                        merged.heartRateAvg = stravaW.heartRateAvg;
                        console.log(`[Dedup] Merged HR avg ${stravaW.heartRateAvg} from Strava to Apple workout ${appleW.id}`);
                    }
                    if (stravaW.heartRateMax != null && (merged.heartRateMax == null || (stravaW.heartRateData && stravaW.heartRateData.length > 0))) {
                        merged.heartRateMax = stravaW.heartRateMax;
                    }
                    if (stravaW.heartRateMin != null && (merged.heartRateMin == null || (stravaW.heartRateData && stravaW.heartRateData.length > 0))) {
                        merged.heartRateMin = stravaW.heartRateMin;
                    }
                    
                    // Always merge HR data from Strava if it exists and is more detailed
                    if (stravaW.heartRateData && stravaW.heartRateData.length > 0) {
                        if (!merged.heartRateData || merged.heartRateData.length === 0 || stravaW.heartRateData.length > merged.heartRateData.length) {
                            merged.heartRateData = stravaW.heartRateData;
                            console.log(`[Dedup] Merged ${stravaW.heartRateData.length} HR data points from Strava to Apple workout ${appleW.id}`);
                            
                            // Recalculate HR stats from the more detailed Strava data
                            const hrValues = stravaW.heartRateData.map(hr => typeof hr === 'object' ? hr.value : hr);
                            merged.heartRateAvg = Math.round(hrValues.reduce((sum, val) => sum + val, 0) / hrValues.length);
                            merged.heartRateMin = Math.min(...hrValues);
                            merged.heartRateMax = Math.max(...hrValues);
                            console.log(`[Dedup] Calculated HR stats from Strava data: avg=${merged.heartRateAvg}, min=${merged.heartRateMin}, max=${merged.heartRateMax}`);
                        }
                    }
                    
                    // Fill missing other metrics from Strava
                    if (!merged.calories && stravaW.calories) merged.calories = stravaW.calories;
                    if (!merged.elevation) {
                        merged.elevation = stravaW.elevation || stravaW.elevationGain;
                    }
                    if (!merged.pace && stravaW.pace) merged.pace = stravaW.pace;
                    if (!merged.paceMinPerKm) {
                        merged.paceMinPerKm = merged.pace || stravaW.pace || stravaW.paceMinPerKm;
                    }
                    if (!merged.cadence && (stravaW.cadence || stravaW.cadenceAvg)) {
                        merged.cadence = stravaW.cadence || stravaW.cadenceAvg;
                    }
                    if (!merged.cadenceAvg && stravaW.cadenceAvg) merged.cadenceAvg = stravaW.cadenceAvg;
                    if (!merged.cadenceData || merged.cadenceData.length === 0) {
                        if (stravaW.cadenceData && stravaW.cadenceData.length > 0) {
                            merged.cadenceData = stravaW.cadenceData;
                        }
                    }
                    
                    // Fill missing stride data from Strava (though usually Apple has this)
                    // But preserve Apple's stride data if it exists
                    if (!merged.strideLength && stravaW.strideLength) merged.strideLength = stravaW.strideLength;
                    if ((!merged.strideLengthData || merged.strideLengthData.length === 0) && stravaW.strideLengthData && stravaW.strideLengthData.length > 0) {
                        merged.strideLengthData = stravaW.strideLengthData;
                    }
                    // Only use Strava's strideLengthAvg if Apple doesn't have one
                    if (!merged.strideLengthAvg && stravaW.strideLengthAvg) merged.strideLengthAvg = stravaW.strideLengthAvg;
                    
                    // Calculate HR stats from HR data if we have data but missing stats
                    if (merged.heartRateData && merged.heartRateData.length > 0) {
                        if ((merged.heartRateAvg == null) || (merged.heartRateMin == null) || (merged.heartRateMax == null)) {
                            const hrValues = merged.heartRateData.map(hr => typeof hr === 'object' ? hr.value : hr);
                            if (merged.heartRateAvg == null) {
                                merged.heartRateAvg = Math.round(hrValues.reduce((sum, val) => sum + val, 0) / hrValues.length);
                                console.log(`[Dedup] Calculated HR avg ${merged.heartRateAvg} from ${hrValues.length} HR data points for Apple workout ${appleW.id}`);
                            }
                            if (merged.heartRateMin == null) merged.heartRateMin = Math.min(...hrValues);
                            if (merged.heartRateMax == null) merged.heartRateMax = Math.max(...hrValues);
                        }
                    }
                    
                    // Calculate stride stats from stride data if we have data but missing average
                    if (merged.strideLengthData && merged.strideLengthData.length > 0 && !merged.strideLengthAvg) {
                        const strideValues = merged.strideLengthData.map(s => typeof s === 'object' ? s.value : s);
                        merged.strideLengthAvg = strideValues.reduce((sum, val) => sum + val, 0) / strideValues.length;
                        console.log(`[Dedup] Calculated stride avg ${merged.strideLengthAvg.toFixed(3)} from ${strideValues.length} stride data points for Apple workout ${appleW.id}`);
                    }
                    
                    // Mark as merged so we know it has data from both sources
                    merged.mergedFromStrava = true;
                    
                    return merged;
                }
            }
            
            // No matching Strava workout found, return original
            return appleW;
        });

        // Filter out duplicate Strava workouts
        const filteredStrava = stravaWorkouts.filter(w => !stravaDuplicateIds.has(w.id));

        return [...mergedAppleWorkouts, ...filteredStrava, ...otherWorkouts];
    }

    // Debug function to check workout data (call from console: app.debugWorkout('2025-05-15'))
    debugWorkout(dateString) {
        const targetDate = new Date(dateString + 'T00:00:00');
        const workouts = this.workouts.filter(w => {
            const wDate = w.dateObj || new Date(w.date);
            return wDate.toDateString() === targetDate.toDateString();
        });
        
        console.log(`=== DEBUG: Workouts for ${dateString} ===`);
        console.log(`Found ${workouts.length} workouts:`);
        workouts.forEach(w => {
            console.log(`\n${w.source.toUpperCase()} Workout:`, {
                id: w.id,
                date: w.date,
                distanceKm: w.distanceKm,
                heartRateAvg: w.heartRateAvg,
                heartRateMax: w.heartRateMax,
                heartRateMin: w.heartRateMin,
                heartRateDataLength: w.heartRateData?.length || 0,
                strideLengthAvg: w.strideLengthAvg,
                strideLength: w.strideLength,
                strideLengthDataLength: w.strideLengthData?.length || 0,
                mergedFromStrava: w.mergedFromStrava
            });
        });
        
        // Check deduplicated version
        const deduped = this.deduplicateWorkoutsList([...this.workouts]);
        const dedupedWorkouts = deduped.filter(w => {
            const wDate = w.dateObj || new Date(w.date);
            return wDate.toDateString() === targetDate.toDateString();
        });
        
        console.log(`\n=== After Deduplication ===`);
        console.log(`Found ${dedupedWorkouts.length} workouts:`);
        dedupedWorkouts.forEach(w => {
            console.log(`\n${w.source.toUpperCase()} Workout:`, {
                id: w.id,
                date: w.date,
                distanceKm: w.distanceKm,
                heartRateAvg: w.heartRateAvg,
                heartRateMax: w.heartRateMax,
                heartRateMin: w.heartRateMin,
                heartRateDataLength: w.heartRateData?.length || 0,
                strideLengthAvg: w.strideLengthAvg,
                strideLength: w.strideLength,
                strideLengthDataLength: w.strideLengthData?.length || 0,
                mergedFromStrava: w.mergedFromStrava
            });
        });
        
        // Check enriched version
        const enriched = dedupedWorkouts.map(w => this.enrichWorkoutData(w));
        console.log(`\n=== After Enrichment ===`);
        enriched.forEach(w => {
            console.log(`\n${w.source.toUpperCase()} Workout:`, {
                id: w.id,
                date: w.date,
                distanceKm: w.distanceKm,
                heartRateAvg: w.heartRateAvg,
                heartRateMax: w.heartRateMax,
                heartRateMin: w.heartRateMin,
                heartRateDataLength: w.heartRateData?.length || 0,
                strideLengthAvg: w.strideLengthAvg,
                strideLength: w.strideLength,
                strideLengthDataLength: w.strideLengthData?.length || 0,
                mergedFromStrava: w.mergedFromStrava
            });
        });
        
        return { original: workouts, deduped: dedupedWorkouts, enriched };
    }

    async init() {
        // Handle Strava OAuth callback
        strava.handleCallback();

        // Load data from IndexedDB
        await this.loadData();

        // Setup event listeners
        this.setupEventListeners();

        // Update UI
        this.updateUI();

        // Restore last viewed page from localStorage
        const savedPage = localStorage.getItem('currentPage');
        if (savedPage && ['dashboard', 'analytics', 'calendar', 'workouts', 'routes'].includes(savedPage)) {
            this.navigateTo(savedPage);
        }

        // If Strava is connected, handle auto-sync
        if (strava.isConnected()) {
            this.updateStravaStatus();

            // Check if we should auto-sync (every 15 minutes for active use)
            const lastSync = await db.getSetting('strava_last_sync');
            const autoSyncEnabled = await db.getSetting('strava_auto_sync', true);
            const syncInterval = 15 * 60 * 1000; // 15 minutes

            if (autoSyncEnabled && (!lastSync || Date.now() - lastSync > syncInterval)) {
                this.syncStravaActivities(true); // silent sync
            }

            // Set up periodic background sync every 15 minutes
            this.setupAutoSync();
        }

        // Update last sync display
        this.updateLastSyncDisplay();
    }

    // Setup automatic background sync
    setupAutoSync() {
        // Clear any existing interval
        if (this.autoSyncInterval) {
            clearInterval(this.autoSyncInterval);
        }

        // Sync every 15 minutes if connected
        this.autoSyncInterval = setInterval(async () => {
            const autoSyncEnabled = await db.getSetting('strava_auto_sync', true);
            if (strava.isConnected() && autoSyncEnabled) {
                console.log('Auto-syncing Strava activities...');
                this.syncStravaActivities(true); // silent sync
            }
        }, 15 * 60 * 1000); // 15 minutes
    }

    // Update the last sync timestamp display
    async updateLastSyncDisplay() {
        const lastSync = await db.getSetting('strava_last_sync');
        const lastSyncEl = document.getElementById('lastSyncTime');

        if (lastSyncEl && lastSync) {
            const date = new Date(lastSync);
            const now = new Date();
            const diffMs = now - date;
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMins / 60);
            const diffDays = Math.floor(diffHours / 24);

            let timeAgo;
            if (diffMins < 1) {
                timeAgo = 'just now';
            } else if (diffMins < 60) {
                timeAgo = `${diffMins}m ago`;
            } else if (diffHours < 24) {
                timeAgo = `${diffHours}h ago`;
            } else {
                timeAgo = `${diffDays}d ago`;
            }

            lastSyncEl.textContent = `Last sync: ${timeAgo}`;
            lastSyncEl.title = date.toLocaleString();
        }
    }

    async loadData() {
        try {
            // Load workouts
            this.workouts = await db.getAllWorkouts();
            this.filteredWorkouts = this.deduplicateWorkoutsList([...this.workouts]);

            // Load planned workouts
            this.plannedWorkouts = await db.getAllPlannedWorkouts();

            // Load default training plan if no planned workouts exist
            if (this.plannedWorkouts.length === 0 && typeof DEFAULT_TRAINING_PLAN !== 'undefined') {
                await this.loadDefaultPlan();
            }

            // Load routes from IndexedDB
            this.routes = await db.getAllRoutes() || [];

            // Link routes to workouts for HR data on initial load
            if (this.routes.length > 0 && this.workouts.length > 0) {
                await this.linkRoutesToWorkouts();
            }

            // Load settings
            this.useMetric = await db.getSetting('useMetric', true);
            this.maxHR = await db.getSetting('maxHR', 190);
            this.restingHR = await db.getSetting('restingHR', 60);

            // Update UI with loaded settings
            this.updateUnitToggle();
            document.getElementById('maxHR').value = this.maxHR;
            document.getElementById('restingHR').value = this.restingHR;

            // Update Apple Health status
            const appleWorkouts = this.workouts.filter(w => w.source === 'apple');
            if (appleWorkouts.length > 0) {
                this.updateAppleHealthStatus(appleWorkouts.length);
            }
        } catch (error) {
            console.error('Error loading data:', error);
        }
    }

    setupEventListeners() {
        // Mobile menu toggle
        const hamburger = document.getElementById('hamburgerBtn');
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebarOverlay');

        if (hamburger) {
            hamburger.addEventListener('click', () => {
                sidebar.classList.toggle('open');
                overlay.classList.toggle('active');
            });
        }

        if (overlay) {
            overlay.addEventListener('click', () => {
                sidebar.classList.remove('open');
                overlay.classList.remove('active');
            });
        }

        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                this.navigateTo(item.dataset.page);
                // Close mobile menu after navigation
                if (sidebar) sidebar.classList.remove('open');
                if (overlay) overlay.classList.remove('active');
            });
        });

        // Upload button
        document.getElementById('uploadXmlBtn').addEventListener('click', () => {
            document.getElementById('uploadModal').classList.add('active');
        });

        // Connect Strava button
        document.getElementById('connectStravaBtn').addEventListener('click', () => {
            if (strava.isConnected()) {
                this.syncStravaActivities();
            } else {
                strava.connect();
            }
        });

        // File upload
        const uploadZone = document.getElementById('uploadZone');
        const fileInput = document.getElementById('fileInput');

        uploadZone.addEventListener('click', (e) => {
            // Don't trigger if clicking the file input directly (label handles it)
            if (e.target !== fileInput && !e.target.closest('label')) {
                fileInput.click();
            }
        });
        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('dragover');
        });
        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('dragover');
        });
        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
                this.handleFileUpload(e.dataTransfer.files[0]);
            }
        });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                this.handleFileUpload(e.target.files[0]);
            }
        });
        
        // iOS sometimes needs input event as well
        fileInput.addEventListener('input', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                this.handleFileUpload(e.target.files[0]);
            }
        });

        // Modal close buttons
        document.getElementById('closeUpload').addEventListener('click', () => {
            document.getElementById('uploadModal').classList.remove('active');
        });
        document.getElementById('closeSettings').addEventListener('click', () => {
            document.getElementById('settingsModal').classList.remove('active');
        });
        document.getElementById('closePlannedWorkout').addEventListener('click', () => {
            document.getElementById('plannedWorkoutModal').classList.remove('active');
        });

        // Settings
        document.getElementById('settingsBtn').addEventListener('click', async () => {
            document.getElementById('settingsModal').classList.add('active');
            if (strava.isConnected()) {
                document.getElementById('stravaSettings').style.display = 'block';
                document.getElementById('stravaAthleteName').textContent = strava.athleteName || 'Connected';
                // Load auto-sync setting
                const autoSync = await db.getSetting('strava_auto_sync', true);
                document.getElementById('autoSyncToggle').checked = autoSync;
            }
        });

        // Unit toggle
        document.querySelectorAll('.toggle-btn[data-unit]').forEach(btn => {
            btn.addEventListener('click', async () => {
                this.useMetric = btn.dataset.unit === 'km';
                try {
                    await db.setSetting('useMetric', this.useMetric);
                } catch (e) {
                    console.error('Failed to save unit setting:', e);
                }
                this.updateUnitToggle();
                this.updateUI();
            });
        });

        // Max HR setting
        document.getElementById('maxHR').addEventListener('change', async (e) => {
            const newMaxHR = parseInt(e.target.value) || 190;
            // Validate that max HR > resting HR
            if (this.restingHR && newMaxHR <= this.restingHR) {
                alert(`Max HR must be greater than Resting HR (${this.restingHR} bpm). Please adjust your values.`);
                e.target.value = this.maxHR;
                return;
            }
            this.maxHR = newMaxHR;
            try {
                await db.setSetting('maxHR', this.maxHR);
            } catch (e) {
                console.error('Failed to save maxHR setting:', e);
            }
            this.updateCharts();
        });

        // Resting HR setting
        document.getElementById('restingHR').addEventListener('change', async (e) => {
            const newRestingHR = parseInt(e.target.value) || 60;
            // Validate that resting HR < max HR
            if (this.maxHR && newRestingHR >= this.maxHR) {
                alert(`Resting HR must be less than Max HR (${this.maxHR} bpm). Please adjust your values.`);
                e.target.value = this.restingHR;
                return;
            }
            // Validate reasonable range
            if (newRestingHR < 30 || newRestingHR > 100) {
                alert('Resting HR should be between 30 and 100 bpm. Please enter a valid value.');
                e.target.value = this.restingHR;
                return;
            }
            this.restingHR = newRestingHR;
            try {
                await db.setSetting('restingHR', this.restingHR);
            } catch (e) {
                console.error('Failed to save restingHR setting:', e);
            }
            this.updateCharts();
        });

        // Clear Apple Health data
        document.getElementById('clearAllData').addEventListener('click', async () => {
            if (confirm('Are you sure you want to delete all Apple Health data? This will not affect your Strava data. This cannot be undone.')) {
                await db.clearWorkoutsBySource('apple');
                // Reload data and update UI
                await this.loadData();
                this.updateUI();
                alert('Apple Health data cleared successfully!');
            }
        });

        // Export data
        document.getElementById('exportData').addEventListener('click', async () => {
            const data = await db.exportData();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `neverlose-export-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
        });

        // Disconnect Strava
        document.getElementById('disconnectStrava').addEventListener('click', () => {
            strava.clearTokens();
            this.updateStravaStatus();
            document.getElementById('stravaSettings').style.display = 'none';
            document.getElementById('settingsModal').classList.remove('active');
        });

        // Auto-sync toggle
        document.getElementById('autoSyncToggle').addEventListener('change', async (e) => {
            await db.setSetting('strava_auto_sync', e.target.checked);
            if (e.target.checked) {
                this.setupAutoSync();
            } else if (this.autoSyncInterval) {
                clearInterval(this.autoSyncInterval);
            }
        });

        // Force sync button
        document.getElementById('forceSyncStrava').addEventListener('click', () => {
            document.getElementById('settingsModal').classList.remove('active');
            this.syncStravaActivities(false);
        });

        // Workouts search and filters
        document.getElementById('workoutSearch').addEventListener('input',
            this.debounce(() => this.filterWorkouts(), 300));
        document.getElementById('sourceFilter').addEventListener('change', () => this.filterWorkouts());
        document.getElementById('dateRange').addEventListener('change', () => this.filterWorkouts());

        // Calendar navigation
        document.getElementById('prevMonth').addEventListener('click', () => calendar.prevMonth());
        document.getElementById('nextMonth').addEventListener('click', () => calendar.nextMonth());

        // Add planned workout
        document.getElementById('addPlannedWorkout').addEventListener('click', () => {
            document.getElementById('plannedDate').value = new Date().toISOString().split('T')[0];
            document.getElementById('plannedWorkoutModal').classList.add('active');
        });

        document.getElementById('savePlannedWorkout').addEventListener('click', () => this.savePlannedWorkout());

        // CSV upload for training plan
        document.getElementById('uploadPlanCsv').addEventListener('click', () => {
            document.getElementById('planCsvInput').click();
        });

        document.getElementById('planCsvInput').addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.importPlanFromCsv(e.target.files[0]);
                e.target.value = ''; // Reset for re-upload
            }
        });

        // Download CSV template
        document.getElementById('downloadPlanTemplate').addEventListener('click', () => {
            this.downloadPlanTemplate();
        });

        // Clear calendar
        document.getElementById('clearCalendarBtn').addEventListener('click', async () => {
            if (confirm('Are you sure you want to clear ALL planned workouts? This cannot be undone.')) {
                await db.clearPlannedWorkouts();
                this.plannedWorkouts = [];

                if (document.querySelector('#page-calendar.active')) {
                    const deduplicatedWorkouts = this.deduplicateWorkoutsList([...this.workouts]);
                    calendar.init(deduplicatedWorkouts, this.plannedWorkouts, this.useMetric);
                }

                alert('Calendar cleared successfully!');
            }
        });

        // Planned workout type change
        document.getElementById('plannedType').addEventListener('change', (e) => {
            document.getElementById('distanceGroup').style.display =
                e.target.value === 'rest' ? 'none' : 'block';
        });

        // Calendar day click handler
        calendar.setDayClickHandler((date, workouts, planned) => {
            // Use local date to avoid timezone issues
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;

            // If there's a completed workout, show detailed view
            if (workouts && workouts.length > 0) {
                this.showWorkoutDetail(workouts[0], date);
                return;
            }

            // Otherwise show planned workout modal
            document.getElementById('plannedDate').value = dateStr;

            // Update modal title and delete button visibility
            const modalTitle = document.getElementById('plannedModalTitle');
            const deleteBtn = document.getElementById('deletePlannedWorkout');

            // Update distance unit label
            const unit = this.useMetric ? 'km' : 'mi';
            document.getElementById('plannedDistanceUnit').textContent = unit;

            if (planned) {
                modalTitle.textContent = 'Edit Planned Workout';
                document.getElementById('plannedType').value = planned.type;
                // Convert distance from km (stored) to display unit
                const displayDistance = planned.distance 
                    ? (this.useMetric ? planned.distance : planned.distance / 1.60934).toFixed(1)
                    : '';
                document.getElementById('plannedDistance').value = displayDistance;
                document.getElementById('plannedNotes').value = planned.notes || '';
                deleteBtn.style.display = 'block';
                deleteBtn.dataset.date = dateStr;
            } else {
                modalTitle.textContent = 'Plan Workout';
                document.getElementById('plannedType').value = 'easy';
                document.getElementById('plannedDistance').value = '';
                document.getElementById('plannedNotes').value = '';
                deleteBtn.style.display = 'none';
            }

            // Hide completed workout info (since no workout exists)
            document.getElementById('completedWorkoutInfo').style.display = 'none';

            document.getElementById('plannedWorkoutModal').classList.add('active');
        });

        // Close workout detail modal
        document.getElementById('closeWorkoutDetail').addEventListener('click', () => {
            document.getElementById('workoutDetailModal').classList.remove('active');
        });

        // Delete planned workout
        document.getElementById('deletePlannedWorkout').addEventListener('click', async () => {
            const dateStr = document.getElementById('deletePlannedWorkout').dataset.date;
            if (dateStr && confirm('Delete this planned workout?')) {
                await db.deletePlannedWorkout(`planned_${dateStr}`);
                this.plannedWorkouts = await db.getAllPlannedWorkouts();
                document.getElementById('plannedWorkoutModal').classList.remove('active');

                if (document.querySelector('#page-calendar.active')) {
                    calendar.updatePlannedWorkouts(this.plannedWorkouts);
                }
            }
        });

        // Analytics range change
        document.getElementById('analyticsRange').addEventListener('change', (e) => {
            const range = e.target.value;
            const customRangeDiv = document.getElementById('customDateRange');
            if (range === 'custom') {
                customRangeDiv.classList.add('active');
            } else {
                customRangeDiv.classList.remove('active');
            }
            this.updateCharts();
        });
        
        // Custom date picker setup
        this.setupCustomDatePicker();
        
        // Comparison controls
        document.getElementById('openComparisonModal')?.addEventListener('click', () => this.openComparisonModal());
        document.getElementById('clearComparison')?.addEventListener('click', () => this.clearComparison());
        document.getElementById('applyComparison')?.addEventListener('click', () => this.applyComparison());
        document.getElementById('comparisonMetric')?.addEventListener('change', () => this.updateComparisonChart());

        // Table sorting
        document.querySelector('.workouts-table thead').addEventListener('click', (e) => {
            const th = e.target.closest('th[data-sort]');
            if (th) {
                this.sortWorkouts(th.dataset.sort);
            }
        });

        // Routes page event listeners
        this.setupRoutesEventListeners();
    }

    // Setup custom date picker
    setupCustomDatePicker() {
        const modal = document.getElementById('datePickerModal');
        const startInput = document.getElementById('startDate');
        const endInput = document.getElementById('endDate');
        const prevBtn = document.getElementById('datePickerPrevMonth');
        const nextBtn = document.getElementById('datePickerNextMonth');
        const monthYearEl = document.getElementById('datePickerMonthYear');
        const daysContainer = document.getElementById('datePickerDays');
        const todayBtn = document.getElementById('datePickerToday');
        const clearBtn = document.getElementById('datePickerClear');

        let currentDate = new Date();
        let currentMonth = currentDate.getMonth();
        let currentYear = currentDate.getFullYear();
        let activeInput = null;
        let selectedStartDate = null;
        let selectedEndDate = null;

        // Open date picker when clicking on date inputs
        [startInput, endInput].forEach(input => {
            input.addEventListener('click', (e) => {
                e.preventDefault();
                activeInput = input;
                const existingDate = input === startInput ? selectedStartDate : selectedEndDate;
                if (existingDate) {
                    currentMonth = existingDate.getMonth();
                    currentYear = existingDate.getFullYear();
                }
                renderCalendar();
                modal.classList.add('active');
            });
        });

        // Close modal when clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });

        // Navigation
        prevBtn.addEventListener('click', () => {
            currentMonth--;
            if (currentMonth < 0) {
                currentMonth = 11;
                currentYear--;
            }
            renderCalendar();
        });

        nextBtn.addEventListener('click', () => {
            currentMonth++;
            if (currentMonth > 11) {
                currentMonth = 0;
                currentYear++;
            }
            renderCalendar();
        });

        // Today button
        todayBtn.addEventListener('click', () => {
            const today = new Date();
            selectDate(today);
        });

        // Store reference to app instance
        const appInstance = this;

        // Clear button
        clearBtn.addEventListener('click', () => {
            if (activeInput === startInput) {
                selectedStartDate = null;
                startInput.value = '';
            } else {
                selectedEndDate = null;
                endInput.value = '';
            }
            appInstance.updateCharts();
            modal.classList.remove('active');
        });

        function renderCalendar() {
            const firstDay = new Date(currentYear, currentMonth, 1);
            const lastDay = new Date(currentYear, currentMonth + 1, 0);
            const daysInMonth = lastDay.getDate();
            const startingDayOfWeek = firstDay.getDay();

            monthYearEl.textContent = firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

            daysContainer.innerHTML = '';

            // Previous month days
            const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
            const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
            const daysInPrevMonth = new Date(prevYear, prevMonth + 1, 0).getDate();

            for (let i = startingDayOfWeek - 1; i >= 0; i--) {
                const day = daysInPrevMonth - i;
                const date = new Date(prevYear, prevMonth, day);
                const dayEl = createDayElement(date, true);
                daysContainer.appendChild(dayEl);
            }

            // Current month days
            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(currentYear, currentMonth, day);
                const dayEl = createDayElement(date, false);
                daysContainer.appendChild(dayEl);
            }

            // Next month days to fill the grid
            const totalCells = daysContainer.children.length;
            const remainingCells = 42 - totalCells; // 6 rows × 7 days
            const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
            const nextYear = currentMonth === 11 ? currentYear + 1 : currentYear;

            for (let day = 1; day <= remainingCells; day++) {
                const date = new Date(nextYear, nextMonth, day);
                const dayEl = createDayElement(date, true);
                daysContainer.appendChild(dayEl);
            }
        }

        function createDayElement(date, isOtherMonth) {
            const dayEl = document.createElement('div');
            dayEl.className = 'date-picker-day';
            dayEl.textContent = date.getDate();

            if (isOtherMonth) {
                dayEl.classList.add('other-month');
            }

            const today = new Date();
            if (date.toDateString() === today.toDateString()) {
                dayEl.classList.add('today');
            }

            // Check if date is selected
            if (selectedStartDate && date.toDateString() === selectedStartDate.toDateString()) {
                dayEl.classList.add('selected', 'range-start');
            }
            if (selectedEndDate && date.toDateString() === selectedEndDate.toDateString()) {
                dayEl.classList.add('selected', 'range-end');
            }

            // Check if date is in range
            if (selectedStartDate && selectedEndDate) {
                if (date > selectedStartDate && date < selectedEndDate) {
                    dayEl.classList.add('in-range');
                }
            }

            dayEl.addEventListener('click', () => {
                if (!isOtherMonth) {
                    selectDate(date);
                }
            });

            return dayEl;
        }

        function selectDate(date) {
            if (activeInput === startInput) {
                selectedStartDate = new Date(date);
                startInput.value = formatDate(selectedStartDate);
                
                // If end date is before start date, clear it
                if (selectedEndDate && selectedEndDate < selectedStartDate) {
                    selectedEndDate = null;
                    endInput.value = '';
                }
                
                // If end date is set, close modal. Otherwise switch to end date input
                if (selectedEndDate) {
                    modal.classList.remove('active');
                } else {
                    activeInput = endInput;
                    renderCalendar();
                }
            } else {
                // Selecting end date
                if (!selectedStartDate || date >= selectedStartDate) {
                    selectedEndDate = new Date(date);
                    endInput.value = formatDate(selectedEndDate);
                    modal.classList.remove('active');
                } else {
                    // End date is before start date, swap them
                    selectedEndDate = selectedStartDate;
                    selectedStartDate = new Date(date);
                    startInput.value = formatDate(selectedStartDate);
                    endInput.value = formatDate(selectedEndDate);
                    modal.classList.remove('active');
                }
            }

            appInstance.updateCharts();
        }

        function formatDate(date) {
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const year = date.getFullYear();
            return `${month}/${day}/${year}`;
        }

        // Parse existing dates from inputs on load
        function parseDateFromInput(input) {
            const value = input.value;
            if (!value) return null;
            
            // Handle MM/DD/YYYY format
            const parts = value.split('/');
            if (parts.length === 3) {
                return new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
            }
            return null;
        }

        // Load existing dates
        const existingStart = parseDateFromInput(startInput);
        const existingEnd = parseDateFromInput(endInput);
        if (existingStart) selectedStartDate = existingStart;
        if (existingEnd) selectedEndDate = existingEnd;
    }

    // Setup routes page event listeners
    setupRoutesEventListeners() {
        // GPX Upload button
        document.getElementById('uploadGpxBtn').addEventListener('click', () => {
            document.getElementById('gpxInput').click();
        });

        // GPX file input
        document.getElementById('gpxInput').addEventListener('change', (e) => {
            this.handleGpxUpload(e.target.files);
        });

        // Route search
        document.getElementById('routeSearch').addEventListener('input',
            this.debounce(() => this.filterRoutes(), 300));

        // Route sorting
        document.getElementById('routeSortBy').addEventListener('change', () => this.renderRoutesList());
        document.getElementById('routeHRFilter').addEventListener('change', () => this.renderRoutesList());

        // Playback controls
        document.getElementById('playbackPlayPause').addEventListener('click', () => this.togglePlayback());
        document.getElementById('playbackPrev').addEventListener('click', () => this.seekPlayback(-5));
        document.getElementById('playbackNext').addEventListener('click', () => this.seekPlayback(5));
        document.getElementById('playbackSpeed').addEventListener('change', (e) => {
            const newSpeed = parseFloat(e.target.value) || 10;
            routesManager.setPlaybackSpeed(newSpeed);
        });
        document.getElementById('playbackSlider').addEventListener('input', (e) => {
            const percent = parseFloat(e.target.value);
            if (this.selectedRoute && routesManager.currentRoute) {
                // If playing, pause first, then seek
                const wasPlaying = routesManager.isPlaying;
                if (wasPlaying) {
                    routesManager.stopPlayback();
                }
                
                routesManager.setPlaybackPosition(percent);
                
                // If was playing, resume from new position
                if (wasPlaying) {
                    const speedMultiplier = routesManager.currentSpeedMultiplier || 10;
                    routesManager.startPlayback(routesManager.currentRoute, {
                        speedMultiplier,
                        startTime: routesManager.currentElapsedTime
                    });
                }
            }
        });

        // Route actions
        document.getElementById('playRouteBtn').addEventListener('click', () => this.playRoute());
        document.getElementById('compareRouteBtn').addEventListener('click', () => this.openComparisonMode());

        // Comparison panel
        document.getElementById('closeComparison').addEventListener('click', () => this.closeComparisonMode());
        document.getElementById('compareRoute1').addEventListener('change', () => this.updateComparison());
        document.getElementById('compareRoute2').addEventListener('change', () => this.updateComparison());
        document.getElementById('overlayMode').addEventListener('change', () => this.updateComparison());
        document.getElementById('raceRoutesBtn').addEventListener('click', () => this.startRace());

        // Live speed change during race
        document.getElementById('raceSpeed').addEventListener('change', (e) => {
            const newSpeed = parseFloat(e.target.value) || 10;
            routesManager.setPlaybackSpeed(newSpeed);
        });
    }

    // Initialize routes page
    initRoutesPage() {
        // Initialize map if not already done
        if (!routesManager.map) {
            routesManager.initMap('routeMap');
        }

        // Link routes to workouts for heart rate data
        this.linkRoutesToWorkouts();

        // Render routes list
        this.renderRoutesList();

        // If we have routes, show the first one
        if (this.routes.length > 0 && !this.selectedRoute) {
            this.selectRoute(this.routes[0]);
        }
    }

    // Link routes to workout data for heart rate
    async linkRoutesToWorkouts() {
        if (this.routes.length === 0 || this.workouts.length === 0) return;

        let linkedCount = 0;
        let newlyLinkedCount = 0;

        // Debug: Check if any workouts have detailed HR data
        const workoutsWithHR = this.workouts.filter(w => w.heartRateData && w.heartRateData.length > 0);
        console.log(`Found ${workoutsWithHR.length} workouts with detailed HR data out of ${this.workouts.length} total`);

        this.routes.forEach(route => {
            const hadHRBefore = route.heartRateData && route.heartRateData.length > 0;

            // Always try to link - workout data may have been updated
            const match = routesManager.linkRouteToWorkout(route, this.workouts);

            if (match) {
                linkedCount++;
                const hasHRNow = route.heartRateData && route.heartRateData.length > 0;
                if (hasHRNow && !hadHRBefore) {
                    newlyLinkedCount++;
                }
            }
        });

        // Save routes to persist the linked HR data
        if (newlyLinkedCount > 0) {
            await db.saveRoutes(this.routes);
            console.log(`Linked ${newlyLinkedCount} new routes with detailed HR data (${linkedCount} total linked)`);
        } else if (linkedCount > 0) {
            console.log(`${linkedCount} routes linked to workouts (HR data already up to date)`);
        }
    }

    // Handle GPX file upload
    async handleGpxUpload(files) {
        const routesList = document.getElementById('routesList');
        routesList.innerHTML = '<div class="route-loading">Loading routes...</div>';

        const newRoutes = [];

        for (const file of files) {
            try {
                const content = await this.readFileAsText(file);
                const route = routesManager.parseGPX(content, file.name);
                newRoutes.push(route);
            } catch (error) {
                console.error('Error parsing GPX file:', file.name, error);
            }
        }

        // Add to existing routes and save
        this.routes = [...this.routes, ...newRoutes];

        // Link new routes to workout data for heart rate
        newRoutes.forEach(route => {
            routesManager.linkRouteToWorkout(route, this.workouts);
        });

        await db.saveRoutes(this.routes);

        // Sort by date descending
        this.routes.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));

        // Render the list
        this.renderRoutesList();

        // Select first new route if any
        if (newRoutes.length > 0) {
            this.selectRoute(newRoutes[0]);
        }
    }

    // Read file as text helper
    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    // Render routes list
    renderRoutesList() {
        const container = document.getElementById('routesList');
        const searchTerm = document.getElementById('routeSearch').value.toLowerCase();
        const sortBy = document.getElementById('routeSortBy').value;
        const hrFilter = document.getElementById('routeHRFilter').value;

        // Apply HR filter first
        let filteredRoutes = this.filterRoutesByHR(this.routes, hrFilter);

        // Store filtered routes for use in comparison dropdowns
        this.filteredRoutesByHR = filteredRoutes;

        // Apply search filter
        if (searchTerm) {
            filteredRoutes = filteredRoutes.filter(r =>
                r.name.toLowerCase().includes(searchTerm) ||
                (r.startTime && r.startTime.toISOString().includes(searchTerm)) ||
                (r.locationName && r.locationName.toLowerCase().includes(searchTerm))
            );
        }

        if (filteredRoutes.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>No routes found matching your filters.</p>
                </div>
            `;
            return;
        }

        // Handle location grouping
        if (sortBy === 'location') {
            this.renderRoutesGroupedByLocation(container, filteredRoutes);
            return;
        }

        // Sort routes
        const sortedRoutes = this.sortRoutes([...filteredRoutes], sortBy);

        container.innerHTML = sortedRoutes.map((route) => this.renderRouteItem(route)).join('');

        // Add click handlers
        this.attachRouteClickHandlers(container);
    }

    // Filter routes by HR data availability
    filterRoutesByHR(routes, hrFilter) {
        if (hrFilter === 'all') return routes;

        return routes.filter(route => {
            const hasDetailedHR = route.heartRateData && route.heartRateData.length > 0;
            const hasAvgHR = route.heartRateAvg && route.heartRateAvg > 0;

            switch (hrFilter) {
                case 'detailed':
                    return hasDetailedHR;
                case 'avg-only':
                    return !hasDetailedHR && hasAvgHR;
                case 'none':
                    return !hasDetailedHR && !hasAvgHR;
                default:
                    return true;
            }
        });
    }

    // Sort routes by various attributes
    sortRoutes(routes, sortBy) {
        const [field, direction] = sortBy.split('-');
        const asc = direction === 'asc';

        return routes.sort((a, b) => {
            let valA, valB;

            switch (field) {
                case 'date':
                    valA = a.startTime ? a.startTime.getTime() : 0;
                    valB = b.startTime ? b.startTime.getTime() : 0;
                    break;
                case 'distance':
                    valA = a.totalDistance || 0;
                    valB = b.totalDistance || 0;
                    break;
                case 'duration':
                    valA = a.duration || 0;
                    valB = b.duration || 0;
                    break;
                case 'pace':
                    valA = a.avgPace || Infinity;
                    valB = b.avgPace || Infinity;
                    break;
                default:
                    valA = a.startTime ? a.startTime.getTime() : 0;
                    valB = b.startTime ? b.startTime.getTime() : 0;
            }

            return asc ? valA - valB : valB - valA;
        });
    }

    // Cluster routes by geographic location
    clusterRoutesByLocation(routes, thresholdKm = 2) {
        const clusters = [];
        const assigned = new Set();

        routes.forEach(route => {
            if (assigned.has(route.filename) || !route.centerPoint) return;

            // Start a new cluster
            const cluster = {
                routes: [route],
                center: { ...route.centerPoint },
                name: this.getLocationName(route.centerPoint)
            };

            // Find all routes within threshold of this cluster
            routes.forEach(other => {
                if (assigned.has(other.filename) || other === route || !other.centerPoint) return;

                const distance = routesManager.haversineDistance(
                    cluster.center.lat, cluster.center.lon,
                    other.centerPoint.lat, other.centerPoint.lon
                );

                if (distance <= thresholdKm) {
                    cluster.routes.push(other);
                    assigned.add(other.filename);
                }
            });

            assigned.add(route.filename);
            clusters.push(cluster);
        });

        // Sort clusters by number of routes (descending)
        return clusters.sort((a, b) => b.routes.length - a.routes.length);
    }

    // Get a human-readable location name based on coordinates
    getLocationName(point) {
        // Round to approximate neighborhood precision
        const latRound = Math.round(point.lat * 100) / 100;
        const lonRound = Math.round(point.lon * 100) / 100;

        // Create a simple name based on coordinates
        // In a real app, you'd use reverse geocoding API
        const latDir = latRound >= 0 ? 'N' : 'S';
        const lonDir = lonRound >= 0 ? 'E' : 'W';

        return `Area ${Math.abs(latRound).toFixed(2)}°${latDir}, ${Math.abs(lonRound).toFixed(2)}°${lonDir}`;
    }

    // Render routes grouped by location
    renderRoutesGroupedByLocation(container, routes) {
        const clusters = this.clusterRoutesByLocation(routes);

        let html = '';

        clusters.forEach((cluster, clusterIdx) => {
            // Sort routes within cluster by date (newest first)
            cluster.routes.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));

            html += `
                <div class="location-group" data-cluster="${clusterIdx}">
                    <div class="location-group-header">
                        <h4>
                            <span>📍</span>
                            ${cluster.name}
                        </h4>
                        <span class="group-count">${cluster.routes.length} run${cluster.routes.length > 1 ? 's' : ''}</span>
                        <span class="group-toggle">▼</span>
                    </div>
                    <div class="location-group-routes">
                        ${cluster.routes.map(route => this.renderRouteItem(route, true)).join('')}
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;

        // Add click handlers for route items
        this.attachRouteClickHandlers(container);

        // Add click handlers for group headers (collapse/expand)
        container.querySelectorAll('.location-group-header').forEach(header => {
            header.addEventListener('click', (e) => {
                e.stopPropagation();
                const group = header.closest('.location-group');
                group.classList.toggle('collapsed');
            });
        });
    }

    // Render a single route item
    renderRouteItem(route, showLocation = false) {
        const locationHtml = showLocation && route.centerPoint ?
            `<div class="route-item-location">📍 ${this.getLocationName(route.centerPoint)}</div>` : '';

        const unit = this.useMetric ? 'km' : 'mi';
        const distance = this.useMetric ? route.totalDistance : route.totalDistance / 1.60934;
        const pace = this.useMetric ? route.avgPace : route.avgPace * 1.60934;

        // Show HR badge based on type of HR data available
        let hrBadge = '';
        if (route.heartRateData && route.heartRateData.length > 0) {
            hrBadge = `<span class="hr-badge detailed" title="Detailed HR (${route.heartRateData.length} samples)">❤️</span>`;
        } else if (route.heartRateAvg && route.heartRateAvg > 0) {
            hrBadge = `<span class="hr-badge avg" title="Avg HR: ${Math.round(route.heartRateAvg)} bpm">🩶</span>`;
        }

        return `
            <div class="route-item ${this.selectedRoute === route ? 'selected' : ''}"
                 data-route-index="${this.routes.indexOf(route)}">
                <div class="route-item-name">${route.name} ${hrBadge}</div>
                <div class="route-item-date">${route.startTime ? route.startTime.toLocaleString() : 'Unknown date'}</div>
                <div class="route-item-stats">
                    <span>📏 ${distance.toFixed(2)} ${unit}</span>
                    <span>⏱️ ${routesManager.formatDuration(route.duration)}</span>
                    <span>⚡ ${routesManager.formatPace(pace)}/${unit}</span>
                </div>
                ${showLocation ? '' : locationHtml}
            </div>
        `;
    }

    // Attach click handlers to route items
    attachRouteClickHandlers(container) {
        container.querySelectorAll('.route-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(item.dataset.routeIndex);
                this.selectRoute(this.routes[index]);
            });
        });
    }

    // Filter routes
    filterRoutes() {
        this.renderRoutesList();
    }

    // Select a route
    selectRoute(route) {
        this.selectedRoute = route;

        // Update selection in list
        document.querySelectorAll('.route-item').forEach(item => {
            item.classList.toggle('selected',
                this.routes.indexOf(route) === parseInt(item.dataset.routeIndex));
        });

        // Display on map
        routesManager.clearMap();
        routesManager.displayRoute(route);

        // Update info panel
        this.updateRouteInfoPanel(route);
        document.getElementById('routeInfoPanel').style.display = 'block';
        document.getElementById('playbackControls').style.display = 'none';

        // Find and show similar routes
        this.showSimilarRoutes(route);
    }

    // Update route info panel
    updateRouteInfoPanel(route) {
        const unit = this.useMetric ? 'km' : 'mi';
        const distance = this.useMetric ? route.totalDistance : route.totalDistance / 1.60934;
        const pace = this.useMetric ? route.avgPace : route.avgPace * 1.60934;

        // Add HR indicator to name based on type of data
        let hrIndicator = '';
        if (route.heartRateData && route.heartRateData.length > 0) {
            hrIndicator = ' ❤️';
        } else if (route.heartRateAvg && route.heartRateAvg > 0) {
            hrIndicator = ' 🩶';
        }
        document.getElementById('routeInfoName').textContent = route.name + hrIndicator;
        document.getElementById('routeInfoDistance').textContent = `${distance.toFixed(2)} ${unit}`;
        document.getElementById('routeInfoDuration').textContent = routesManager.formatDuration(route.duration);

        // Show HR info based on available data
        const hasDetailedHR = route.heartRateData && route.heartRateData.length > 0;
        const hasAvgHR = route.heartRateAvg && route.heartRateAvg > 0;

        if (hasDetailedHR) {
            document.getElementById('routeInfoPace').innerHTML = `
                <span>${routesManager.formatPace(pace)}/${unit}</span>
                <span style="color: #ef4444; margin-left: 8px;">❤️ ${Math.round(route.heartRateAvg)} bpm avg (${route.heartRateData.length} samples)</span>
            `;
        } else if (hasAvgHR) {
            document.getElementById('routeInfoPace').innerHTML = `
                <span>${routesManager.formatPace(pace)}/${unit}</span>
                <span style="color: #9ca3af; margin-left: 8px;">🩶 ${Math.round(route.heartRateAvg)} bpm avg</span>
            `;
        } else {
            document.getElementById('routeInfoPace').textContent = `${routesManager.formatPace(pace)}/${unit}`;
        }

        document.getElementById('routeInfoDate').textContent = route.startTime
            ? route.startTime.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
            : '-';
    }

    // Show similar routes
    showSimilarRoutes(route) {
        const similar = routesManager.findSimilarRoutes(route, this.routes, 0.4);
        const panel = document.getElementById('routeInfoPanel');
        const unit = this.useMetric ? 'km' : 'mi';

        // Remove existing similar routes section
        const existingSimilar = panel.querySelector('.similar-routes');
        if (existingSimilar) existingSimilar.remove();

        if (similar.length > 0) {
            const html = `
                <div class="similar-routes">
                    <h4>Similar Routes (${similar.length})</h4>
                    ${similar.slice(0, 5).map(s => {
                        const dist = this.useMetric ? s.route.totalDistance : s.route.totalDistance / 1.60934;
                        const hrBadge = this.getHRBadge(s.route);
                        return `
                        <div class="similar-route-item" data-route-index="${this.routes.indexOf(s.route)}">
                            <span>${s.route.name.substring(0, 20)}${s.route.name.length > 20 ? '...' : ''}${hrBadge}</span>
                            <span class="similar-route-stats">${dist.toFixed(2)} ${unit} · ${Math.round(s.similarity * 100)}%</span>
                        </div>
                    `}).join('')}
                </div>
            `;
            panel.insertAdjacentHTML('beforeend', html);

            // Add click handlers
            panel.querySelectorAll('.similar-route-item').forEach(item => {
                item.addEventListener('click', () => {
                    const idx = parseInt(item.dataset.routeIndex);
                    this.openComparisonWithRoute(this.routes[idx]);
                });
            });
        }
    }

    // Play route animation
    playRoute() {
        if (!this.selectedRoute) return;

        document.getElementById('playbackControls').style.display = 'block';
        document.getElementById('playbackPlayPause').textContent = '⏸️ Pause';

        const unit = this.useMetric ? 'km' : 'mi';
        const speedMultiplier = parseFloat(document.getElementById('playbackSpeed').value) || 10;
        
        // Reset elapsed time when starting fresh playback
        routesManager.currentElapsedTime = 0;
        document.getElementById('playbackSlider').value = 0;

        routesManager.startPlayback(this.selectedRoute, {
            speedMultiplier: speedMultiplier,
            startTime: 0, // Always start from beginning when clicking Play
            onProgress: (progress) => {
                const percent = progress.progress || (progress.index / progress.total) * 100;
                document.getElementById('playbackSlider').value = percent;

                // Convert distance based on unit preference
                const distanceDisplay = this.useMetric ? progress.distance : progress.distance / 1.60934;
                document.getElementById('playbackDistance').textContent =
                    `${distanceDisplay.toFixed(2)} ${unit}`;
                
                const elapsedTime = progress.elapsedTime || progress.elapsed;
                document.getElementById('playbackTime').textContent =
                    routesManager.formatDuration(elapsedTime / 60000);

                // Calculate current pace (convert if needed)
                if (elapsedTime > 0 && progress.distance > 0) {
                    const pacePerKm = (elapsedTime / 60000) / progress.distance;
                    const paceDisplay = this.useMetric ? pacePerKm : pacePerKm * 1.60934;
                    document.getElementById('playbackPace').textContent =
                        `${routesManager.formatPace(paceDisplay)}/${unit}`;
                }
            },
            onComplete: () => {
                document.getElementById('playbackPlayPause').textContent = '▶️ Play';
            }
        });
    }

    // Toggle playback
    togglePlayback() {
        if (routesManager.isPlaying) {
            routesManager.stopPlayback();
            document.getElementById('playbackPlayPause').textContent = '▶️ Play';
        } else {
            this.playRoute();
        }
    }

    // Seek playback (delta is in percentage points, e.g., -5 for 5% back)
    seekPlayback(deltaPercent) {
        if (!this.selectedRoute || !routesManager.currentRoute) return;
        
        const slider = document.getElementById('playbackSlider');
        const currentPercent = parseFloat(slider.value) || 0;
        const newPercent = Math.max(0, Math.min(100, currentPercent + deltaPercent));
        
        const wasPlaying = routesManager.isPlaying;
        if (wasPlaying) {
            routesManager.stopPlayback();
        }
        
        routesManager.setPlaybackPosition(newPercent);
        slider.value = newPercent;
        
        // Update displayed stats
        if (routesManager.currentRoute && routesManager.currentElapsedTime !== undefined) {
            const point = routesManager.currentRoute.points[routesManager.playbackIndex];
            const unit = this.useMetric ? 'km' : 'mi';
            const distanceDisplay = this.useMetric ? point.cumulativeDistance : point.cumulativeDistance / 1.60934;
            
            document.getElementById('playbackDistance').textContent = `${distanceDisplay.toFixed(2)} ${unit}`;
            document.getElementById('playbackTime').textContent = 
                routesManager.formatDuration(routesManager.currentElapsedTime / 60000);
        }
        
        // If was playing, resume from new position
        if (wasPlaying) {
            const speedMultiplier = routesManager.currentSpeedMultiplier || 10;
            routesManager.startPlayback(routesManager.currentRoute, {
                speedMultiplier,
                startTime: routesManager.currentElapsedTime
            });
        }
    }

    // Open comparison mode
    openComparisonMode() {
        this.comparisonMode = true;
        document.getElementById('comparisonPanel').style.display = 'block';

        // Use HR-filtered routes if filter is active, otherwise all routes
        const hrFilter = document.getElementById('routeHRFilter').value;
        const routesToCompare = this.filterRoutesByHR(this.routes, hrFilter);
        this.comparisonRoutes = routesToCompare; // Store for use in race

        // Populate route selects
        const select1 = document.getElementById('compareRoute1');
        const select2 = document.getElementById('compareRoute2');

        const unit = this.useMetric ? 'km' : 'mi';
        const options = routesToCompare.map((r, i) => {
            const distance = this.useMetric ? r.totalDistance : r.totalDistance / 1.60934;
            const hrBadge = this.getHRBadge(r);
            return `<option value="${i}">${r.name} (${distance.toFixed(1)} ${unit})${hrBadge}</option>`;
        }).join('');

        select1.innerHTML = options;
        select2.innerHTML = options;

        // Set first select to current route
        if (this.selectedRoute) {
            const idx = routesToCompare.indexOf(this.selectedRoute);
            if (idx >= 0) select1.value = idx;
        }

        // Find most similar route for comparison
        if (this.selectedRoute && routesToCompare.length > 1) {
            const similar = routesManager.findSimilarRoutes(this.selectedRoute, routesToCompare, 0);
            if (similar.length > 0) {
                select2.value = routesToCompare.indexOf(similar[0].route);
            } else {
                const currentIdx = routesToCompare.indexOf(this.selectedRoute);
                select2.value = currentIdx === 0 ? 1 : 0;
            }
        }

        this.updateComparison();
    }

    // Get HR badge for route option
    getHRBadge(route) {
        if (route.heartRateData && route.heartRateData.length > 0) {
            return ' ❤️';
        } else if (route.heartRateAvg && route.heartRateAvg > 0) {
            return ' 🩶';
        }
        return '';
    }

    // Open comparison with specific route
    openComparisonWithRoute(route) {
        this.openComparisonMode();
        // Use index from comparisonRoutes (filtered list) not this.routes
        const idx = this.comparisonRoutes.indexOf(route);
        if (idx >= 0) {
            document.getElementById('compareRoute2').value = idx;
        }
        this.updateComparison();
    }

    // Close comparison mode
    closeComparisonMode() {
        this.comparisonMode = false;
        document.getElementById('comparisonPanel').style.display = 'none';
        routesManager.stopPlayback();

        // Redisplay selected route
        if (this.selectedRoute) {
            routesManager.clearMap();
            routesManager.displayRoute(this.selectedRoute);
        }
    }

    // Update comparison view
    updateComparison() {
        const idx1 = parseInt(document.getElementById('compareRoute1').value);
        const idx2 = parseInt(document.getElementById('compareRoute2').value);
        const overlayMode = document.getElementById('overlayMode').checked;

        if (isNaN(idx1) || isNaN(idx2)) return;

        // Use the filtered comparison routes
        const routes = this.comparisonRoutes || this.routes;
        const route1 = routes[idx1];
        const route2 = routes[idx2];

        // Display both routes (with overlay if enabled)
        const comparison = overlayMode
            ? routesManager.compareRoutesOverlay(route1, route2)
            : routesManager.compareRoutes(route1, route2);

        const unit = this.useMetric ? 'km' : 'mi';
        const dist1 = this.useMetric ? comparison.route1.distance : comparison.route1.distance / 1.60934;
        const dist2 = this.useMetric ? comparison.route2.distance : comparison.route2.distance / 1.60934;
        const pace1 = this.useMetric ? comparison.route1.pace : comparison.route1.pace * 1.60934;
        const pace2 = this.useMetric ? comparison.route2.pace : comparison.route2.pace * 1.60934;

        // Update stats
        document.getElementById('compareStats1').innerHTML = `
            <span>📏 ${dist1.toFixed(2)} ${unit}</span>
            <span>⏱️ ${routesManager.formatDuration(comparison.route1.duration)}</span>
            <span>⚡ ${routesManager.formatPace(pace1)}/${unit}</span>
        `;

        document.getElementById('compareStats2').innerHTML = `
            <span>📏 ${dist2.toFixed(2)} ${unit}</span>
            <span>⏱️ ${routesManager.formatDuration(comparison.route2.duration)}</span>
            <span>⚡ ${routesManager.formatPace(pace2)}/${unit}</span>
        `;

        // Show difference
        const timeDiff = comparison.durationDiff;
        const diffClass = timeDiff < 0 ? 'faster' : 'slower';
        const diffText = timeDiff < 0 ? 'faster' : 'slower';

        document.getElementById('comparisonDiff').innerHTML = `
            Route 1 was <span class="${diffClass}">${routesManager.formatDuration(Math.abs(timeDiff))} ${diffText}</span> than Route 2
        `;
    }

    // Start race between two routes
    startRace() {
        const idx1 = parseInt(document.getElementById('compareRoute1').value);
        const idx2 = parseInt(document.getElementById('compareRoute2').value);
        const overlayMode = document.getElementById('overlayMode').checked;

        if (isNaN(idx1) || isNaN(idx2)) return;

        // Use the filtered comparison routes
        const routes = this.comparisonRoutes || this.routes;
        const route1 = routes[idx1];
        const route2 = routes[idx2];

        const raceUnit = this.useMetric ? 'km' : 'mi';
        const speedMultiplier = parseFloat(document.getElementById('raceSpeed').value) || 10;

        routesManager.startComparisonPlayback(route1, route2, {
            speedMultiplier: speedMultiplier,
            useOverlay: overlayMode,
            onProgress: (progress) => {
                const dist1 = this.useMetric ? progress.runner1.distance : progress.runner1.distance / 1.60934;
                const dist2 = this.useMetric ? progress.runner2.distance : progress.runner2.distance / 1.60934;
                const elapsed = routesManager.formatDuration(progress.elapsedTime / 60000);
                const speedText = progress.speedMultiplier === 1 ? 'Real-time' : `${progress.speedMultiplier}x speed`;

                // Show who's ahead by distance at the current time
                const distDiff = Math.abs(dist1 - dist2);
                let leadText = '';
                if (progress.runner1.finished && progress.runner2.finished) {
                    leadText = '';
                } else if (progress.runner1.finished) {
                    leadText = '<span style="color: #ff6b35">🏁 Runner 1 finished!</span>';
                } else if (progress.runner2.finished) {
                    leadText = '<span style="color: #3b82f6">🏁 Runner 2 finished!</span>';
                } else if (dist1 > dist2) {
                    leadText = `<span style="color: #ff6b35">Runner 1 leads by ${distDiff.toFixed(2)} ${raceUnit}</span>`;
                } else if (dist2 > dist1) {
                    leadText = `<span style="color: #3b82f6">Runner 2 leads by ${distDiff.toFixed(2)} ${raceUnit}</span>`;
                } else {
                    leadText = '<span style="color: #22c55e">Dead heat!</span>';
                }

                document.getElementById('comparisonDiff').innerHTML = `
                    <strong>⏱️ Race Time: ${elapsed}</strong> <span style="color: var(--text-muted); font-size: 0.85rem">(${speedText})</span><br>
                    <span style="color: #ff6b35">Route 1: ${dist1.toFixed(2)} ${raceUnit}</span> |
                    <span style="color: #3b82f6">Route 2: ${dist2.toFixed(2)} ${raceUnit}</span><br>
                    ${leadText}
                `;
            },
            onComplete: () => {
                // route1 and route2 are captured from the outer scope
                const winner = route1.duration < route2.duration ? 1 : 2;
                const winnerColor = winner === 1 ? '#ff6b35' : '#3b82f6';
                const timeDiff = Math.abs(route1.duration - route2.duration);
                document.getElementById('comparisonDiff').innerHTML = `
                    <span style="color: ${winnerColor}; font-size: 1.2rem">🏆 Route ${winner} wins!</span><br>
                    <span style="font-size: 0.9rem">Faster by ${routesManager.formatDuration(timeDiff)}</span>
                `;
            }
        });
    }

    // Navigate to page
    navigateTo(page) {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.page === page);
        });
        document.querySelectorAll('.page').forEach(p => {
            p.classList.toggle('active', p.id === `page-${page}`);
        });

        // Save current page to localStorage for persistence across refreshes
        localStorage.setItem('currentPage', page);

        // Update page-specific content
        if (page === 'analytics') {
            // Initialize custom date range defaults if not set
            const startDateInput = document.getElementById('startDate');
            const endDateInput = document.getElementById('endDate');
            if (startDateInput && !startDateInput.value) {
                const defaultStart = new Date();
                defaultStart.setDate(defaultStart.getDate() - 365);
                const month = String(defaultStart.getMonth() + 1).padStart(2, '0');
                const day = String(defaultStart.getDate()).padStart(2, '0');
                const year = defaultStart.getFullYear();
                startDateInput.value = `${month}/${day}/${year}`;
            }
            if (endDateInput && !endDateInput.value) {
                const defaultEnd = new Date();
                const month = String(defaultEnd.getMonth() + 1).padStart(2, '0');
                const day = String(defaultEnd.getDate()).padStart(2, '0');
                const year = defaultEnd.getFullYear();
                endDateInput.value = `${month}/${day}/${year}`;
            }
            this.updateCharts();
        } else if (page === 'calendar') {
            // Apply deduplication to calendar workouts
            const deduplicatedWorkouts = this.deduplicateWorkoutsList([...this.workouts]);
            calendar.init(deduplicatedWorkouts, this.plannedWorkouts, this.useMetric);
        } else if (page === 'workouts') {
            this.renderWorkoutsTable();
        } else if (page === 'routes') {
            this.initRoutesPage();
        }
    }

    // Handle file upload
    async handleFileUpload(file) {
        const uploadZone = document.getElementById('uploadZone');
        const uploadProgress = document.getElementById('uploadProgress');
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');

        // Show immediate feedback
        uploadZone.style.display = 'none';
        uploadProgress.style.display = 'block';
        progressText.textContent = `Loading file: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)...`;
        progressBar.style.width = '0%';

        // Small delay to ensure UI updates on iOS
        await new Promise(r => setTimeout(r, 100));

        try {
            // Ensure parser is available - use window.appleParser to avoid ReferenceError
            if (!window.appleParser) {
                console.error('Parser check:', {
                    windowAppleParser: window.appleParser,
                    typeofWindow: typeof window,
                    scriptsLoaded: document.querySelectorAll('script[src*="parser"]').length
                });
                throw new Error('Apple Health Parser not loaded. Please refresh the page and ensure parser.js is loaded before app.js.');
            }
            
            const workouts = await window.appleParser.parseFile(file, (progress) => {
                progressBar.style.width = `${progress.percent}%`;
                progressText.textContent = `Processing... ${progress.workoutsFound} workouts found (${progress.percent}%)`;
            });

            progressText.textContent = `Saving ${workouts.length} workouts...`;
            await new Promise(r => setTimeout(r, 50));

            // Clear existing Apple Health workouts
            await db.clearWorkoutsBySource('apple');

            // On iOS, limit detailed data to prevent memory crashes
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                          (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
            
            if (isIOS) {
                // Limit HR/cadence/stride data to 100 points per workout on iOS
                for (const workout of workouts) {
                    if (workout.heartRateData && workout.heartRateData.length > 100) {
                        const step = Math.ceil(workout.heartRateData.length / 100);
                        workout.heartRateData = workout.heartRateData.filter((_, i) => i % step === 0);
                    }
                    if (workout.cadenceData && workout.cadenceData.length > 100) {
                        const step = Math.ceil(workout.cadenceData.length / 100);
                        workout.cadenceData = workout.cadenceData.filter((_, i) => i % step === 0);
                    }
                    if (workout.strideLengthData && workout.strideLengthData.length > 100) {
                        const step = Math.ceil(workout.strideLengthData.length / 100);
                        workout.strideLengthData = workout.strideLengthData.filter((_, i) => i % step === 0);
                    }
                }
            }

            // Save workouts in batches to avoid overwhelming IndexedDB
            const batchSize = isIOS ? 10 : 50;
            for (let i = 0; i < workouts.length; i += batchSize) {
                const batch = workouts.slice(i, i + batchSize);
                await db.saveWorkouts(batch);
                progressText.textContent = `Saving... ${Math.min(i + batchSize, workouts.length)}/${workouts.length}`;
                await new Promise(r => setTimeout(r, isIOS ? 100 : 10));
            }

            // Update local state
            this.workouts = await db.getAllWorkouts();
            this.filteredWorkouts = this.deduplicateWorkoutsList([...this.workouts]);

            // Re-link routes to workouts for heart rate data
            await this.linkRoutesToWorkouts();

            // Update UI
            this.updateAppleHealthStatus(workouts.length);
            this.updateUI();

            // Close modal
            document.getElementById('uploadModal').classList.remove('active');
            uploadZone.style.display = 'block';
            uploadProgress.style.display = 'none';

        } catch (error) {
            console.error('Error processing file:', error);
            progressText.textContent = 'Error processing file!';
            // Reset UI after error
            setTimeout(() => {
                uploadZone.style.display = 'block';
                uploadProgress.style.display = 'none';
            }, 3000);
        }
    }

    // Sync Strava activities
    // silent: if true, don't show UI feedback (for background sync)
    async syncStravaActivities(silent = false) {
        const btn = document.getElementById('connectStravaBtn');
        const syncStatus = document.getElementById('syncStatus');

        if (!silent) {
            btn.innerHTML = '<span class="spinner"></span> Syncing...';
            btn.disabled = true;
        }

        // Show sync status indicator
        if (syncStatus) {
            syncStatus.classList.add('syncing');
            syncStatus.title = 'Syncing with Strava...';
        }

        try {
            const activities = await strava.fetchRunningActivities();

            // Fetch detailed HR data for activities
            // Try to fetch HR streams for activities that don't have HR data yet
            // Even if average_heartrate is not in summary, HR might be in streams
            const existingWorkouts = await db.getAllWorkouts();
            const existingStravaIdsWithHR = new Set(
                existingWorkouts
                    .filter(w => w.source === 'strava' && w.heartRateData && w.heartRateData.length > 0)
                    .map(w => w.stravaId)
            );

            // Find activities that need HR data:
            // 1. Don't already have HR data in database, OR
            // 2. Have average_heartrate in summary but no detailed HR streams
            const activitiesNeedingHR = activities.filter(a =>
                !existingStravaIdsWithHR.has(a.stravaId)
            );

            console.log(`Found ${activities.length} activities, ${activitiesNeedingHR.length} need HR data check`);

            let hrFetched = 0;
            for (const activity of activitiesNeedingHR) {
                try {
                    if (!silent) {
                        btn.innerHTML = `<span class="spinner"></span> Checking HR ${hrFetched + 1}/${activitiesNeedingHR.length}...`;
                    }
                    // Try to fetch HR streams even if average_heartrate is missing from summary
                    // HR data might still be available in streams
                    console.log(`Checking HR for activity ${activity.stravaId} (${activity.date}) - summary has HR: ${!!activity.heartRateAvg}`);
                    const hrData = await strava.fetchHeartRateData(activity.stravaId, activity.date);
                    if (hrData && hrData.length > 0) {
                        activity.heartRateData = hrData;
                        // If we got HR data from streams but not from summary, calculate avg/min/max
                        if (!activity.heartRateAvg && hrData.length > 0) {
                            const hrValues = hrData.map(d => typeof d === 'object' ? d.value : d);
                            activity.heartRateAvg = Math.round(hrValues.reduce((a, b) => a + b, 0) / hrValues.length);
                            activity.heartRateMin = Math.min(...hrValues);
                            activity.heartRateMax = Math.max(...hrValues);
                            console.log(`✓ Calculated HR stats from streams for activity ${activity.stravaId} (${activity.date}): avg=${activity.heartRateAvg}, min=${activity.heartRateMin}, max=${activity.heartRateMax}`);
                        } else {
                            console.log(`✓ Found HR data in streams for activity ${activity.stravaId} (${activity.date}): ${hrData.length} samples`);
                        }
                        hrFetched++;
                    } else {
                        console.log(`✗ No HR data in streams for activity ${activity.stravaId} (${activity.date})`);
                    }
                    // Small delay to avoid rate limiting
                    await new Promise(r => setTimeout(r, 200));
                } catch (e) {
                    console.warn(`Failed to fetch HR for activity ${activity.stravaId}:`, e);
                }
            }

            // For activities that already have HR data, copy it from existing
            for (const activity of activities) {
                const existing = existingWorkouts.find(w =>
                    w.source === 'strava' && w.stravaId === activity.stravaId
                );
                if (existing) {
                    if (existing.heartRateData && !activity.heartRateData) {
                        activity.heartRateData = existing.heartRateData;
                    }
                    // Preserve calculated HR stats if they exist (from streams)
                    if (existing.heartRateAvg && !activity.heartRateAvg) {
                        activity.heartRateAvg = existing.heartRateAvg;
                    }
                    if (existing.heartRateMin && !activity.heartRateMin) {
                        activity.heartRateMin = existing.heartRateMin;
                    }
                    if (existing.heartRateMax && !activity.heartRateMax) {
                        activity.heartRateMax = existing.heartRateMax;
                    }
                }
            }

            console.log(`Fetched detailed HR for ${hrFetched} new activities`);

            // Clear existing Strava workouts and save new ones
            await db.clearWorkoutsBySource('strava');
            await db.saveWorkouts(activities);
            await db.setSetting('strava_last_sync', Date.now());

            // Update local state
            this.workouts = await db.getAllWorkouts();
            this.filteredWorkouts = this.deduplicateWorkoutsList([...this.workouts]);

            // Re-link routes to workouts for heart rate data
            await this.linkRoutesToWorkouts();

            // Update UI
            this.updateStravaStatus();
            this.updateLastSyncDisplay();
            this.updateUI();

            // Show success briefly
            if (syncStatus) {
                syncStatus.classList.remove('syncing');
                syncStatus.classList.add('success');
                setTimeout(() => syncStatus.classList.remove('success'), 2000);
            }

        } catch (error) {
            console.error('Error syncing Strava:', error);
            if (!silent) {
                alert('Error syncing with Strava. Please try again.');
            }
            if (syncStatus) {
                syncStatus.classList.remove('syncing');
                syncStatus.classList.add('error');
                setTimeout(() => syncStatus.classList.remove('error'), 3000);
            }
        } finally {
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                    <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/>
                </svg>
                ${strava.isConnected() ? 'Sync Strava' : 'Connect Strava'}
            `;
            btn.disabled = false;
        }
    }

    // Update Strava connection status
    updateStravaStatus() {
        const statusText = document.getElementById('stravaStatusText');
        const statusItem = document.getElementById('stravaStatus').querySelector('.source-status');
        const btn = document.getElementById('connectStravaBtn');

        if (strava.isConnected()) {
            const stravaCount = this.workouts.filter(w => w.source === 'strava').length;
            statusText.textContent = `${stravaCount} runs`;
            statusItem.classList.remove('disconnected');
            statusItem.classList.add('connected');
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                    <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/>
                </svg>
                Sync Strava
            `;
        } else {
            statusText.textContent = 'Not connected';
            statusItem.classList.add('disconnected');
            statusItem.classList.remove('connected');
        }
    }

    // Update Apple Health status
    updateAppleHealthStatus(count) {
        const statusItem = document.getElementById('appleHealthStatus');
        const status = statusItem.querySelector('.source-status');
        status.textContent = `${count} runs`;
        status.classList.remove('disconnected');
        status.classList.add('connected');
    }

    // Update all UI elements
    updateUI() {
        this.updateDashboardStats();
        this.updateRecentActivity();
        // Use deduplicated workouts for charts to avoid counting duplicates
        const deduplicatedWorkouts = this.deduplicateWorkoutsList([...this.workouts]);
        charts.createWeeklyMileageChart('weeklyMileageChart', deduplicatedWorkouts, this.useMetric);
        this.renderWorkoutsTable();
    }

    // Update dashboard statistics
    updateDashboardStats() {
        const now = new Date();
        const unit = this.useMetric ? 'km' : 'mi';

        // Update unit labels
        document.getElementById('weekDistanceUnit').textContent = unit;
        document.getElementById('monthDistanceUnit').textContent = unit;
        document.getElementById('avgPaceUnit').textContent = `/${unit}`;

        // Use deduplicated workouts for dashboard stats to avoid counting duplicates
        const deduplicatedWorkouts = this.deduplicateWorkoutsList([...this.workouts]);

        // This week
        const weekStart = new Date(now);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        weekStart.setHours(0, 0, 0, 0);

        const thisWeekWorkouts = deduplicatedWorkouts.filter(w => {
            const d = w.dateObj || new Date(w.date);
            return d >= weekStart;
        });

        const weekDistanceKm = thisWeekWorkouts.reduce((sum, w) => sum + (w.distanceKm || 0), 0);
        document.getElementById('weekDistance').textContent =
            (this.useMetric ? weekDistanceKm : weekDistanceKm / 1.60934).toFixed(1);

        // Last week comparison
        const lastWeekStart = new Date(weekStart);
        lastWeekStart.setDate(lastWeekStart.getDate() - 7);
        const lastWeekEnd = new Date(weekStart);

        const lastWeekWorkouts = deduplicatedWorkouts.filter(w => {
            const d = w.dateObj || new Date(w.date);
            return d >= lastWeekStart && d < lastWeekEnd;
        });

        const lastWeekDistanceKm = lastWeekWorkouts.reduce((sum, w) => sum + (w.distanceKm || 0), 0);
        this.updateCompare('weekCompare', weekDistanceKm, lastWeekDistanceKm);

        // This month
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const thisMonthWorkouts = deduplicatedWorkouts.filter(w => {
            const d = w.dateObj || new Date(w.date);
            return d >= monthStart;
        });

        const monthDistanceKm = thisMonthWorkouts.reduce((sum, w) => sum + (w.distanceKm || 0), 0);
        document.getElementById('monthDistance').textContent =
            (this.useMetric ? monthDistanceKm : monthDistanceKm / 1.60934).toFixed(1);

        // Last month comparison
        const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 1);

        const lastMonthWorkouts = deduplicatedWorkouts.filter(w => {
            const d = w.dateObj || new Date(w.date);
            return d >= lastMonthStart && d < lastMonthEnd;
        });

        const lastMonthDistanceKm = lastMonthWorkouts.reduce((sum, w) => sum + (w.distanceKm || 0), 0);
        this.updateCompare('monthCompare', monthDistanceKm, lastMonthDistanceKm);

        // Total runs - use deduplicated count
        document.getElementById('totalRuns').textContent = deduplicatedWorkouts.length;

        // Average pace - calculate from distance/duration if missing
        const validPaceWorkouts = deduplicatedWorkouts.filter(w => {
            let pace = w.pace || w.paceMinPerKm;
            if (!pace && w.distanceKm && w.duration && w.distanceKm > 0 && w.duration > 0) {
                pace = w.duration / w.distanceKm;
            }
            return pace && pace > 0 && pace < 20;
        }).map(w => {
            let pace = w.pace || w.paceMinPerKm;
            if (!pace && w.distanceKm && w.duration && w.distanceKm > 0 && w.duration > 0) {
                pace = w.duration / w.distanceKm;
            }
            return pace;
        });
        
        if (validPaceWorkouts.length > 0) {
            const avgPace = validPaceWorkouts.reduce((sum, p) => sum + p, 0) / validPaceWorkouts.length;
            const displayPace = this.useMetric ? avgPace : avgPace * 1.60934;
            document.getElementById('avgPace').textContent = this.formatPace(displayPace);
        }
    }

    // Update comparison indicator
    updateCompare(elementId, current, previous) {
        const element = document.getElementById(elementId);
        if (!element) return;

        if (previous === 0) {
            element.textContent = '';
            return;
        }

        const diff = ((current - previous) / previous) * 100;
        const sign = diff >= 0 ? '+' : '';
        element.textContent = `${sign}${diff.toFixed(0)}% vs last`;
        element.className = `stat-compare ${diff >= 0 ? 'positive' : 'negative'}`;
    }

    // Update recent activity list
    updateRecentActivity() {
        const container = document.getElementById('recentActivity');
        // Use deduplicated workouts to avoid showing duplicates
        const deduplicatedWorkouts = this.deduplicateWorkoutsList([...this.workouts]);
        const recent = deduplicatedWorkouts
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 5);

        if (recent.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>No workouts yet. Upload Apple Health data or connect Strava to get started.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = recent.map((w, index) => {
            const d = w.dateObj || new Date(w.date);
            // Convert distance based on unit preference
            const distanceKm = w.distanceKm || 0;
            const distance = this.useMetric ? distanceKm : distanceKm / 1.60934;
            const unit = this.useMetric ? 'km' : 'mi';

            // Calculate pace from distance and duration if missing
            let paceMinPerKm = w.pace || w.paceMinPerKm || 0;
            if (!paceMinPerKm && w.distanceKm && w.duration && w.distanceKm > 0 && w.duration > 0) {
                paceMinPerKm = w.duration / w.distanceKm;
            }
            const paceDisplay = paceMinPerKm > 0
                ? this.formatPace(this.useMetric ? paceMinPerKm : paceMinPerKm * 1.60934)
                : '--:--';

            return `
                <div class="activity-item" data-workout-id="${w.id}" style="cursor: pointer;">
                    <div class="activity-date">
                        <div class="day">${d.getDate()}</div>
                        <div class="month">${d.toLocaleString('en-US', { month: 'short' })}</div>
                    </div>
                    <div class="activity-details">
                        <div class="activity-title">${w.name || 'Running'}</div>
                        <div class="activity-meta">
                            <span>${distance.toFixed(2)} ${unit}</span>
                            <span>${w.durationFormatted || '--:--'}</span>
                            <span>${paceDisplay}/${unit}</span>
                        </div>
                    </div>
                    <div class="activity-source">
                        ${w.source === 'apple' ? '<span class="source-badge apple">🍎</span>' : ''}
                        ${w.source === 'strava' ? '<span class="source-badge strava">🔶</span>' : ''}
                    </div>
                </div>
            `;
        }).join('');

        // Add click handlers to activity items
        container.querySelectorAll('.activity-item').forEach((item, index) => {
            item.addEventListener('click', () => {
                const workout = recent[index];
                if (workout) {
                    const workoutDate = workout.dateObj || new Date(workout.date);
                    this.showWorkoutDetail(workout, workoutDate);
                }
            });
        });
    }

    // Enrich workout with calculated metrics and matching data
    enrichWorkoutData(workout) {
        const enriched = { ...workout };
        const workoutTime = (enriched.dateObj || new Date(enriched.date)).getTime();
        
        // Check for matching route data if routes are loaded
        if (this.routes && this.routes.length > 0) {
            const matchingRoute = this.routes.find(r => {
                if (!r.startTime) return false;
                const routeStart = r.startTime instanceof Date ? r.startTime.getTime() : new Date(r.startTime).getTime();
                const timeDiff = Math.abs(routeStart - workoutTime);
                return timeDiff < 5 * 60 * 1000; // 5 minutes tolerance
            });
            
            // Get HR data and other metrics from route if available and not in workout
            if (matchingRoute) {
                if ((!enriched.heartRateData || enriched.heartRateData.length === 0) && matchingRoute.heartRateData && matchingRoute.heartRateData.length > 0) {
                    enriched.heartRateData = matchingRoute.heartRateData;
                }
                if (!enriched.heartRateAvg && matchingRoute.heartRateAvg) enriched.heartRateAvg = matchingRoute.heartRateAvg;
                if (!enriched.heartRateMin && matchingRoute.heartRateMin) enriched.heartRateMin = matchingRoute.heartRateMin;
                if (!enriched.heartRateMax && matchingRoute.heartRateMax) enriched.heartRateMax = matchingRoute.heartRateMax;
            }
        }
        
        // Check for matching workout from other source for additional data
        if (this.workouts && this.workouts.length > 0) {
            const otherSource = enriched.source === 'apple' ? 'strava' : 'apple';
            const matchingWorkout = this.workouts.find(w => {
                if (w.source !== otherSource) return false;
                const wTime = (w.dateObj || new Date(w.date)).getTime();
                const timeDiff = Math.abs(wTime - workoutTime);
                return timeDiff < 10 * 60 * 1000; // Within 10 minutes
            });
            
            // Fill missing data from matching workout (use explicit null/undefined checks)
            if (matchingWorkout) {
                // Use == null to catch both null and undefined
                if ((enriched.heartRateAvg == null) && matchingWorkout.heartRateAvg != null) {
                    enriched.heartRateAvg = matchingWorkout.heartRateAvg;
                    console.log(`[Enrich] Merged HR avg ${matchingWorkout.heartRateAvg} from ${matchingWorkout.source} to ${enriched.source} workout ${enriched.id}`);
                }
                if ((enriched.heartRateMin == null) && matchingWorkout.heartRateMin != null) {
                    enriched.heartRateMin = matchingWorkout.heartRateMin;
                }
                if ((enriched.heartRateMax == null) && matchingWorkout.heartRateMax != null) {
                    enriched.heartRateMax = matchingWorkout.heartRateMax;
                }
                if ((!enriched.heartRateData || enriched.heartRateData.length === 0) && matchingWorkout.heartRateData && matchingWorkout.heartRateData.length > 0) {
                    enriched.heartRateData = matchingWorkout.heartRateData;
                    console.log(`[Enrich] Merged ${matchingWorkout.heartRateData.length} HR data points from ${matchingWorkout.source} to ${enriched.source} workout ${enriched.id}`);
                }
                if (!enriched.pace && matchingWorkout.pace) enriched.pace = matchingWorkout.pace;
                if (!enriched.paceMinPerKm) {
                    enriched.paceMinPerKm = enriched.pace || matchingWorkout.pace || matchingWorkout.paceMinPerKm;
                }
                if (!enriched.strideLength && matchingWorkout.strideLength) enriched.strideLength = matchingWorkout.strideLength;
                if (!enriched.strideLengthAvg && matchingWorkout.strideLengthAvg) enriched.strideLengthAvg = matchingWorkout.strideLengthAvg;
                if ((!enriched.strideLengthData || enriched.strideLengthData.length === 0) && matchingWorkout.strideLengthData && matchingWorkout.strideLengthData.length > 0) {
                    enriched.strideLengthData = matchingWorkout.strideLengthData;
                }
                if (!enriched.cadence && matchingWorkout.cadence) enriched.cadence = matchingWorkout.cadence;
                if (!enriched.cadenceAvg && matchingWorkout.cadenceAvg) enriched.cadenceAvg = matchingWorkout.cadenceAvg;
                if ((!enriched.cadenceData || enriched.cadenceData.length === 0) && matchingWorkout.cadenceData && matchingWorkout.cadenceData.length > 0) {
                    enriched.cadenceData = matchingWorkout.cadenceData;
                }
            }
        }
        
        // Calculate pace from distance and duration if missing
        if (!enriched.pace && !enriched.paceMinPerKm && enriched.distanceKm && enriched.duration && enriched.distanceKm > 0 && enriched.duration > 0) {
            enriched.pace = enriched.duration / enriched.distanceKm;
            enriched.paceMinPerKm = enriched.pace;
        }
        
        // Calculate HR stats from detailed HR data if missing
        if (enriched.heartRateData && enriched.heartRateData.length > 0) {
            if (!enriched.heartRateAvg || !enriched.heartRateMin || !enriched.heartRateMax) {
                const hrValues = enriched.heartRateData.map(hr => typeof hr === 'object' ? hr.value : hr);
                if (!enriched.heartRateAvg) {
                    enriched.heartRateAvg = Math.round(hrValues.reduce((sum, val) => sum + val, 0) / hrValues.length);
                }
                if (!enriched.heartRateMin) enriched.heartRateMin = Math.min(...hrValues);
                if (!enriched.heartRateMax) enriched.heartRateMax = Math.max(...hrValues);
            }
        }
        
        // Calculate stride stats from detailed stride data if average is missing
        if (enriched.strideLengthData && enriched.strideLengthData.length > 0 && !enriched.strideLengthAvg) {
            const strideValues = enriched.strideLengthData.map(s => typeof s === 'object' ? s.value : s);
            enriched.strideLengthAvg = strideValues.reduce((sum, val) => sum + val, 0) / strideValues.length;
            if (enriched.id && enriched.id.includes('2025-05')) {
                console.log(`[Enrich] Calculated stride avg ${enriched.strideLengthAvg.toFixed(3)} from ${strideValues.length} stride data points for workout ${enriched.id}`);
            }
        }
        
        // Calculate cadence stats from detailed cadence data if average is missing
        if (enriched.cadenceData && enriched.cadenceData.length > 0 && !enriched.cadenceAvg) {
            const cadenceValues = enriched.cadenceData.map(c => typeof c === 'object' ? c.value : c);
            enriched.cadenceAvg = Math.round(cadenceValues.reduce((sum, val) => sum + val, 0) / cadenceValues.length);
        }
        
        return enriched;
    }

    // Filter workouts
    filterWorkouts() {
        const search = document.getElementById('workoutSearch').value.toLowerCase();
        const source = document.getElementById('sourceFilter').value;
        const days = parseInt(document.getElementById('dateRange').value) || 0;

        let filtered = [...this.workouts];

        // Apply deduplication only when showing all sources
        if (!source || source === 'all') {
            filtered = this.deduplicateWorkoutsList(filtered);
        }
        
        // Enrich all workouts with calculated metrics before filtering
        filtered = filtered.map(w => this.enrichWorkoutData(w));

        // Search filter
        if (search) {
            filtered = filtered.filter(w =>
                (w.displayDate && w.displayDate.toLowerCase().includes(search)) ||
                (w.name && w.name.toLowerCase().includes(search)) ||
                (w.sourceName && w.sourceName.toLowerCase().includes(search))
            );
        }

        // Source filter
        if (source === 'apple') {
            filtered = filtered.filter(w => w.source === 'apple');
        } else if (source === 'strava') {
            filtered = filtered.filter(w => w.source === 'strava');
        } else if (source === 'both') {
            // Find workouts on same date from both sources
            const appleMap = new Map();
            const stravaMap = new Map();

            this.workouts.forEach(w => {
                const d = w.dateObj || new Date(w.date);
                const dateKey = this.getLocalDateString(d);
                if (w.source === 'apple') appleMap.set(dateKey, w);
                if (w.source === 'strava') stravaMap.set(dateKey, w);
            });

            filtered = filtered.filter(w => {
                const d = w.dateObj || new Date(w.date);
                const dateKey = this.getLocalDateString(d);
                return appleMap.has(dateKey) && stravaMap.has(dateKey);
            });
        }

        // Date range filter
        if (days > 0) {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - days);
            filtered = filtered.filter(w => {
                const d = w.dateObj || new Date(w.date);
                return d >= cutoff;
            });
        }

        // Re-enrich all filtered workouts to ensure metrics are calculated
        // This ensures data is always available regardless of when filtering happens
        filtered = filtered.map(w => this.enrichWorkoutData(w));
        
        this.filteredWorkouts = filtered;
        this.currentPage = 1;
        this.sortWorkouts(this.sortColumn);
    }

    // Sort workouts
    sortWorkouts(column) {
        if (this.sortColumn === column) {
            this.sortDirection = this.sortDirection === 'desc' ? 'asc' : 'desc';
        } else {
            this.sortColumn = column;
            this.sortDirection = 'desc';
        }

        this.filteredWorkouts.sort((a, b) => {
            let valA, valB;

            switch (column) {
                case 'date':
                    valA = new Date(a.date);
                    valB = new Date(b.date);
                    break;
                case 'duration':
                    valA = a.duration || 0;
                    valB = b.duration || 0;
                    break;
                case 'distance':
                    valA = a.distanceKm || 0;
                    valB = b.distanceKm || 0;
                    break;
                case 'pace':
                    valA = a.pace || Infinity;
                    valB = b.pace || Infinity;
                    break;
                case 'calories':
                    valA = a.calories || 0;
                    valB = b.calories || 0;
                    break;
                case 'heartrate':
                    // Calculate HR average from detailed data if missing
                    let hrA = a.heartRateAvg;
                    if (!hrA && a.heartRateData && a.heartRateData.length > 0) {
                        const hrValues = a.heartRateData.map(hr => typeof hr === 'object' ? hr.value : hr);
                        hrA = hrValues.reduce((sum, val) => sum + val, 0) / hrValues.length;
                    }
                    let hrB = b.heartRateAvg;
                    if (!hrB && b.heartRateData && b.heartRateData.length > 0) {
                        const hrValues = b.heartRateData.map(hr => typeof hr === 'object' ? hr.value : hr);
                        hrB = hrValues.reduce((sum, val) => sum + val, 0) / hrValues.length;
                    }
                    valA = hrA || 0;
                    valB = hrB || 0;
                    break;
                default:
                    valA = new Date(a.date);
                    valB = new Date(b.date);
            }

            return this.sortDirection === 'desc' ? valB - valA : valA - valB;
        });

        this.renderWorkoutsTable();
    }

    // Render workouts table
    renderWorkoutsTable() {
        // Update sort indicators
        document.querySelectorAll('.workouts-table th[data-sort]').forEach(th => {
            const sortValue = th.dataset.sort;
            const sortArrow = this.sortColumn === sortValue ? (this.sortDirection === 'desc' ? ' ↓' : ' ↑') : '';
            const baseText = th.textContent.replace(/ [↓↑]/, '').trim();
            th.textContent = baseText + sortArrow;
        });

        const tbody = document.getElementById('workoutsTableBody');
        const start = (this.currentPage - 1) * this.pageSize;
        const end = Math.min(start + this.pageSize, this.filteredWorkouts.length);
        const pageData = this.filteredWorkouts.slice(start, end);

        if (pageData.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7">
                        <div class="empty-state">
                            <div class="icon">🏃</div>
                            <h3>No workouts found</h3>
                            <p>Upload Apple Health data or connect Strava to get started</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        const unit = this.useMetric ? 'km' : 'mi';

        tbody.innerHTML = pageData.map((w, idx) => {
            const d = w.dateObj || new Date(w.date);
            const distance = this.useMetric ? w.distanceKm : w.distanceMi;
            
            // Debug: Log workout if it's the one we're looking for
            if (w.id && (w.id.includes('2025-05-16') || w.id.includes('2025-05-15'))) {
                console.log(`[Render] Rendering workout ${w.id}:`, {
                    heartRateAvg: w.heartRateAvg,
                    heartRateMin: w.heartRateMin,
                    heartRateMax: w.heartRateMax,
                    heartRateDataLength: w.heartRateData?.length || 0,
                    mergedFromStrava: w.mergedFromStrava
                });
            }
            
            // Calculate pace from distance and duration if missing
            let paceMinPerKm = w.pace || w.paceMinPerKm;
            if (!paceMinPerKm && w.distanceKm && w.duration && w.distanceKm > 0 && w.duration > 0) {
                paceMinPerKm = w.duration / w.distanceKm;
            }
            const pace = paceMinPerKm ? (this.useMetric ? paceMinPerKm : paceMinPerKm * 1.60934) : null;
            const workoutIndex = start + idx;

            let hrDisplay = '--';
            let hrAvg = w.heartRateAvg;
            let hrMin = w.heartRateMin;
            let hrMax = w.heartRateMax;
            
            // If no average HR but we have detailed HR data, calculate it
            // Use == null to catch both null and undefined, but allow 0 as valid
            if ((hrAvg == null) && w.heartRateData && w.heartRateData.length > 0) {
                const hrValues = w.heartRateData.map(hr => typeof hr === 'object' ? hr.value : hr);
                hrAvg = hrValues.reduce((sum, val) => sum + val, 0) / hrValues.length;
                hrMin = Math.min(...hrValues);
                hrMax = Math.max(...hrValues);
            }
            
            // Display HR if we have a valid value (including 0, but not null/undefined)
            if (hrAvg != null && !isNaN(hrAvg) && isFinite(hrAvg)) {
                hrDisplay = `<span style="color: var(--accent-primary)">${Math.round(hrAvg)}</span>`;
                if (hrMin != null || hrMax != null) {
                    hrDisplay += ` <span style="color: var(--text-muted)">(${Math.round(hrMin != null ? hrMin : 0)}-${Math.round(hrMax != null ? hrMax : 0)})</span>`;
                }
            } else {
                // Debug: Log why HR is not displaying
                if (w.id && (w.id.includes('2025-05-16') || w.id.includes('2025-05-15'))) {
                    console.log(`[Render] Workout ${w.id} HR not displaying:`, {
                        hrAvg,
                        hrMin,
                        hrMax,
                        heartRateAvg: w.heartRateAvg,
                        heartRateDataLength: w.heartRateData?.length || 0,
                        isNaN: isNaN(hrAvg),
                        isFinite: isFinite(hrAvg),
                        mergedFromStrava: w.mergedFromStrava
                    });
                }
            }

            return `
                <tr class="workout-row" data-workout-index="${workoutIndex}" style="cursor: pointer;">
                    <td>
                        <div style="font-weight: 500">${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                        <div style="font-size: 0.85rem; color: var(--text-muted)">${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div>
                    </td>
                    <td style="font-family: 'JetBrains Mono', monospace">${w.durationFormatted || '--:--'}</td>
                    <td style="font-family: 'JetBrains Mono', monospace">${(distance || 0).toFixed(2)} ${unit}</td>
                    <td style="font-family: 'JetBrains Mono', monospace">${pace ? this.formatPace(pace) : '--:--'}/${unit}</td>
                    <td style="font-family: 'JetBrains Mono', monospace">${Math.round(w.calories || 0)}</td>
                    <td>${hrDisplay}</td>
                    <td>
                        ${w.source === 'apple' ? 
                            (w.mergedFromStrava ? 
                                '<span class="source-badge apple">🍎 Apple</span> <span class="source-badge strava">🔶</span>' : 
                                '<span class="source-badge apple">🍎 Apple</span>') : ''}
                        ${w.source === 'strava' ? '<span class="source-badge strava">🔶 Strava</span>' : ''}
                    </td>
                </tr>
            `;
        }).join('');

        // Add click handlers to workout rows
        tbody.querySelectorAll('.workout-row').forEach(row => {
            row.addEventListener('click', () => {
                const index = parseInt(row.dataset.workoutIndex);
                const workout = this.filteredWorkouts[index];
                if (workout) {
                    const date = workout.dateObj || new Date(workout.date);
                    this.showWorkoutDetail(workout, date);
                }
            });
        });

        this.renderPagination();
    }

    // Render pagination
    renderPagination() {
        const pagination = document.getElementById('workoutsPagination');
        const totalPages = Math.ceil(this.filteredWorkouts.length / this.pageSize);
        const start = (this.currentPage - 1) * this.pageSize + 1;
        const end = Math.min(this.currentPage * this.pageSize, this.filteredWorkouts.length);

        pagination.innerHTML = `
            <div class="pagination-info">
                Showing ${start}-${end} of ${this.filteredWorkouts.length} workouts
            </div>
            <div class="pagination-controls">
                <button ${this.currentPage <= 1 ? 'disabled' : ''} onclick="app.prevPage()">← Prev</button>
                <button ${this.currentPage >= totalPages ? 'disabled' : ''} onclick="app.nextPage()">Next →</button>
            </div>
        `;
    }

    prevPage() {
        if (this.currentPage > 1) {
            this.currentPage--;
            this.renderWorkoutsTable();
        }
    }

    nextPage() {
        const totalPages = Math.ceil(this.filteredWorkouts.length / this.pageSize);
        if (this.currentPage < totalPages) {
            this.currentPage++;
            this.renderWorkoutsTable();
        }
    }

    // Update charts
    updateCharts() {
        const rangeSelect = document.getElementById('analyticsRange');
        const range = rangeSelect?.value || '365';
        let filtered = this.workouts;

        if (range === 'custom') {
            const startDateStr = document.getElementById('startDate')?.value;
            const endDateStr = document.getElementById('endDate')?.value;
            
            // Parse dates from MM/DD/YYYY format
            let startDate = null;
            let endDate = null;
            
            if (startDateStr) {
                const parts = startDateStr.split('/');
                if (parts.length === 3) {
                    startDate = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
                }
            }
            
            if (endDateStr) {
                const parts = endDateStr.split('/');
                if (parts.length === 3) {
                    endDate = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
                }
            }
            
            if (startDate && endDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                
                filtered = this.workouts.filter(w => {
                    const d = w.dateObj || new Date(w.date);
                    return d >= start && d <= end;
                });
            }
        } else if (range !== 'all') {
            const days = parseInt(range) || 365;
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - days);
            filtered = this.workouts.filter(w => {
                const d = w.dateObj || new Date(w.date);
                return d >= cutoff;
            });
        }

        // Use deduplicated workouts for analytics
        filtered = this.deduplicateWorkoutsList([...filtered]);
        charts.updateAllCharts(filtered, this.useMetric, this.maxHR, this.restingHR);
    }

    // Comparison functionality

    openComparisonModal() {
        const modal = document.getElementById('comparisonModal');
        const list = document.getElementById('comparisonWorkoutsList');
        
        // Get deduplicated workouts sorted by date
        const deduplicated = this.deduplicateWorkoutsList([...this.workouts]);
        const sorted = deduplicated.sort((a, b) => {
            const dateA = a.dateObj || new Date(a.date);
            const dateB = b.dateObj || new Date(b.date);
            return dateB - dateA;
        });

        list.innerHTML = sorted.map((w, idx) => {
            const d = w.dateObj || new Date(w.date);
            const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const distanceKm = w.distanceKm || 0;
            const distance = this.useMetric ? distanceKm : distanceKm / 1.60934;
            const unit = this.useMetric ? 'km' : 'mi';
            const isSelected = this.selectedComparisonWorkouts.some(sw => sw.id === w.id);
            
            // Generate route shape preview
            const routeShapeId = `routeShape_${idx}`;
            
            return `
                <div class="comparison-workout-item" data-workout-id="${w.id}" style="
                    padding: 12px;
                    border: 1px solid var(--border-color);
                    border-radius: 8px;
                    margin-bottom: 8px;
                    cursor: pointer;
                    background: ${isSelected ? 'rgba(255, 107, 53, 0.1)' : 'var(--bg-tertiary)'};
                    display: flex;
                    align-items: center;
                    gap: 12px;
                ">
                    <input type="checkbox" ${isSelected ? 'checked' : ''} data-workout-id="${w.id}" style="width: 18px; height: 18px; cursor: pointer; flex-shrink: 0;">
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: 500;">${dateStr}</div>
                        <div style="font-size: 0.85rem; color: var(--text-secondary);">
                            ${distance.toFixed(2)} ${unit} • ${w.durationFormatted || '--:--'} • ${w.name || 'Running'}
                        </div>
                    </div>
                    <canvas id="${routeShapeId}" width="80" height="50" style="
                        border-radius: 4px;
                        background: var(--bg-secondary);
                        border: 1px solid var(--border-color);
                        flex-shrink: 0;
                        pointer-events: none;
                    "></canvas>
                </div>
            `;
        }).join('');

        // Draw route shapes and add click handlers
        list.querySelectorAll('.comparison-workout-item').forEach((item, idx) => {
            const workoutId = item.dataset.workoutId;
            const workout = sorted.find(w => w.id === workoutId);
            
            // Draw route shape preview
            const canvas = item.querySelector('canvas');
            if (canvas) {
                this.drawRouteShape(canvas, workout);
            }
            
            // Add click handler to the entire item
            const checkbox = item.querySelector('input[type="checkbox"]');
            
            // Handle clicks on the item itself (but not on checkbox)
            item.addEventListener('click', (e) => {
                // If clicking directly on checkbox, let it handle itself
                if (e.target === checkbox || e.target.type === 'checkbox') {
                    return;
                }
                
                // Toggle checkbox when clicking anywhere else on the item
                e.preventDefault();
                checkbox.checked = !checkbox.checked;
                
                // Update selection
                const isChecked = checkbox.checked;
                if (isChecked) {
                    if (!this.selectedComparisonWorkouts.some(w => w.id === workoutId)) {
                        this.selectedComparisonWorkouts.push(workout);
                    }
                } else {
                    this.selectedComparisonWorkouts = this.selectedComparisonWorkouts.filter(w => w.id !== workoutId);
                }
                
                // Update visual state
                item.style.background = isChecked ? 'rgba(255, 107, 53, 0.1)' : 'var(--bg-tertiary)';
            });
            
            // Handle checkbox changes
            checkbox.addEventListener('change', (e) => {
                const isChecked = checkbox.checked;
                
                if (isChecked) {
                    if (!this.selectedComparisonWorkouts.some(w => w.id === workoutId)) {
                        this.selectedComparisonWorkouts.push(workout);
                    }
                } else {
                    this.selectedComparisonWorkouts = this.selectedComparisonWorkouts.filter(w => w.id !== workoutId);
                }
                
                // Update visual state
                item.style.background = isChecked ? 'rgba(255, 107, 53, 0.1)' : 'var(--bg-tertiary)';
            });
        });

        modal.classList.add('active');
    }

    applyComparison() {
        if (this.selectedComparisonWorkouts.length === 0) {
            alert('Please select at least one run to compare.');
            return;
        }

        if (this.selectedComparisonWorkouts.length > 5) {
            alert('Please select no more than 5 runs to compare for best visualization.');
            this.selectedComparisonWorkouts = this.selectedComparisonWorkouts.slice(0, 5);
        }

        document.getElementById('comparisonModal').classList.remove('active');
        this.showComparison();
    }

    showComparison() {
        const comparisonSection = document.getElementById('comparisonCharts');
        const clearBtn = document.getElementById('clearComparison');
        
        if (this.selectedComparisonWorkouts.length > 0) {
            comparisonSection.style.display = 'block';
            clearBtn.style.display = 'block';
            
            // Update comparison chart based on selected metric
            this.updateComparisonChart();
        }
    }

    updateComparisonChart() {
        if (this.selectedComparisonWorkouts.length === 0) return;
        
        // Clean up existing comparison maps before updating
        if (this.comparisonMaps) {
            this.comparisonMaps.forEach(map => {
                if (map && typeof map.remove === 'function') {
                    map.remove();
                }
            });
            this.comparisonMaps = [];
        }
        
        const metric = document.getElementById('comparisonMetric')?.value || 'heartrate';
        const titleElement = document.getElementById('comparisonChartTitle');
        
        // Update title based on selected metric
        const titles = {
            'heartrate': 'Heart Rate Comparison',
            'pace': 'Pace Comparison',
            'cadence': 'Cadence Comparison',
            'stride': 'Stride Length Comparison'
        };
        if (titleElement) {
            titleElement.textContent = titles[metric] || 'Comparison';
        }
        
        // Create the selected comparison chart
        charts.createComparisonChart('comparisonChart', this.selectedComparisonWorkouts, metric, this.useMetric, this.maxHR, this.restingHR);
        
        // Update comparison stats (which will recreate the maps)
        this.updateComparisonStats(metric);
    }

    clearComparison() {
        this.selectedComparisonWorkouts = [];
        
        // Destroy all comparison maps
        if (this.comparisonMaps) {
            this.comparisonMaps.forEach(map => {
                if (map && typeof map.remove === 'function') {
                    map.remove();
                }
            });
            this.comparisonMaps = [];
        }
        
        document.getElementById('comparisonCharts').style.display = 'none';
        document.getElementById('clearComparison').style.display = 'none';
        
        // Destroy comparison chart
        charts.destroyChart('comparisonChart');
    }

    updateComparisonStats(metric) {
        const statsContainer = document.getElementById('comparisonStats');
        if (!statsContainer) return;

        statsContainer.innerHTML = this.selectedComparisonWorkouts.map((w, index) => {
            const mergedWorkout = this.getMergedWorkoutData(w);
            const d = mergedWorkout.dateObj || new Date(mergedWorkout.date);
            const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const distanceKm = mergedWorkout.distanceKm || 0;
            const distance = this.useMetric ? distanceKm : distanceKm / 1.60934;
            const unit = this.useMetric ? 'km' : 'mi';
            
            // Calculate pace
            let paceMinPerKm = mergedWorkout.pace || mergedWorkout.paceMinPerKm || 0;
            if (!paceMinPerKm && mergedWorkout.distanceKm && mergedWorkout.duration && mergedWorkout.distanceKm > 0 && mergedWorkout.duration > 0) {
                paceMinPerKm = mergedWorkout.duration / mergedWorkout.distanceKm;
            }
            const avgPace = paceMinPerKm > 0
                ? this.formatPace(this.useMetric ? paceMinPerKm : paceMinPerKm * 1.60934) + `/${unit}`
                : '--:--';
            
            // Calculate best pace from route data
            const bestPace = this.getBestPaceFromRoute(mergedWorkout);
            const bestPaceDisplay = bestPace ? this.formatPace(bestPace) + `/${unit}` : '--:--';
            
            // Heart rate stats
            let hrMin = mergedWorkout.heartRateMin;
            let hrMax = mergedWorkout.heartRateMax;
            if ((!hrMin || !hrMax) && mergedWorkout.heartRateData && mergedWorkout.heartRateData.length > 0) {
                const hrValues = mergedWorkout.heartRateData.map(hr => typeof hr === 'object' ? hr.value : hr);
                if (!hrMin) hrMin = Math.min(...hrValues);
                if (!hrMax) hrMax = Math.max(...hrValues);
            }
            
            // Calculate VO2max
            const vo2max = this.calculateVO2Max(mergedWorkout);
            
            // Cadence
            const cadence = mergedWorkout.cadenceAvg || mergedWorkout.cadence;
            const cadenceDisplay = cadence ? Math.round(cadence) + ' spm' : '--';
            
            // Stride length
            const stride = mergedWorkout.strideLengthAvg;
            const strideDisplay = stride ? (this.useMetric ? stride.toFixed(2) + ' m' : (stride * 3.28084).toFixed(2) + ' ft') : '--';
            
            // Elevation
            const elevation = mergedWorkout.elevation || 0;
            const elevationDisplay = elevation ? Math.round(elevation) + ' m' : '--';
            
            // Calories
            const calories = mergedWorkout.calories || 0;
            const caloriesDisplay = calories ? Math.round(calories) : '--';

            return `
                <div class="comparison-stat-card" style="
                    background: var(--bg-card);
                    border: 1px solid var(--border-color);
                    border-radius: 12px;
                    padding: 16px;
                ">
                    <h4 style="margin-bottom: 16px; color: var(--text-primary); font-size: 1.1rem;">Run ${index + 1}: ${dateStr}</h4>
                    
                    <!-- Primary Stats -->
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 16px;">
                        <div>
                            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 4px;">Distance</div>
                            <div style="font-size: 1.1rem; font-weight: 600; color: var(--text-primary);">${distance.toFixed(2)} ${unit}</div>
                        </div>
                        <div>
                            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 4px;">Duration</div>
                            <div style="font-size: 1.1rem; font-weight: 600; color: var(--text-primary);">${mergedWorkout.durationFormatted || '--:--'}</div>
                        </div>
                        <div>
                            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 4px;">Avg Pace</div>
                            <div style="font-size: 1.1rem; font-weight: 600; color: var(--text-primary);">${avgPace}</div>
                        </div>
                        <div>
                            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 4px;">Avg HR</div>
                            <div style="font-size: 1.1rem; font-weight: 600; color: var(--accent-primary);">${mergedWorkout.heartRateAvg ? Math.round(mergedWorkout.heartRateAvg) + ' bpm' : '--'}</div>
                        </div>
                        <div>
                            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 4px;">Est. VO2MAX</div>
                            <div style="font-size: 1.1rem; font-weight: 600; color: var(--text-primary);">${vo2max ? vo2max.toFixed(1) : '--'}</div>
                        </div>
                        <div>
                            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 4px;">Calories</div>
                            <div style="font-size: 1.1rem; font-weight: 600; color: var(--text-primary);">${caloriesDisplay}</div>
                        </div>
                    </div>
                    
                    <!-- Additional Stats -->
                    <div style="border-top: 1px solid var(--border-color); padding-top: 12px; margin-bottom: 16px;">
                        <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 8px; font-weight: 500;">Additional Stats</div>
                        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; font-size: 0.85rem;">
                            <div>
                                <span style="color: var(--text-secondary);">Max HR:</span>
                                <span style="color: var(--text-primary); margin-left: 4px;">${hrMax ? Math.round(hrMax) + ' bpm' : '--'}</span>
                            </div>
                            <div>
                                <span style="color: var(--text-secondary);">Min HR:</span>
                                <span style="color: var(--text-primary); margin-left: 4px;">${hrMin ? Math.round(hrMin) + ' bpm' : '--'}</span>
                            </div>
                            <div>
                                <span style="color: var(--text-secondary);">Best Pace:</span>
                                <span style="color: var(--text-primary); margin-left: 4px;">${bestPaceDisplay}</span>
                            </div>
                            <div>
                                <span style="color: var(--text-secondary);">Elevation Gain:</span>
                                <span style="color: var(--text-primary); margin-left: 4px;">${elevationDisplay}</span>
                            </div>
                            <div>
                                <span style="color: var(--text-secondary);">Cadence:</span>
                                <span style="color: var(--text-primary); margin-left: 4px;">${cadenceDisplay}</span>
                            </div>
                            <div>
                                <span style="color: var(--text-secondary);">Stride Length:</span>
                                <span style="color: var(--text-primary); margin-left: 4px;">${strideDisplay}</span>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Route Map -->
                    <div class="comparison-route-map" id="comparisonRouteMap_${index}" style="
                        height: 250px; 
                        width: 100%; 
                        border-radius: 8px; 
                        margin-top: 12px;
                        background: var(--bg-tertiary);
                        border: 1px solid var(--border-color);
                    "></div>
                </div>
            `;
        }).join('');

        // Create route maps for each workout
        this.selectedComparisonWorkouts.forEach((workout, index) => {
            this.createComparisonRouteMap(workout, index);
        });
    }

    // Draw route shape preview on canvas
    drawRouteShape(canvas, workout) {
        if (!canvas) return;
        
        // Find matching route
        let matchingRoute = workout.matchingRoute;
        
        if (!matchingRoute) {
            const workoutTime = (workout.dateObj || new Date(workout.date)).getTime();
            matchingRoute = this.routes.find(r => {
                if (!r.startTime || !r.points || r.points.length === 0) return false;
                const routeStart = r.startTime instanceof Date ? r.startTime.getTime() : new Date(r.startTime).getTime();
                const timeDiff = Math.abs(routeStart - workoutTime);
                return timeDiff < 5 * 60 * 1000; // 5 minutes tolerance
            });
        }

        if (!matchingRoute || !matchingRoute.points || matchingRoute.points.length === 0) {
            // Draw placeholder
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#606070';
            ctx.font = '10px Outfit';
            ctx.textAlign = 'center';
            ctx.fillText('No route', canvas.width / 2, canvas.height / 2);
            return;
        }

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Calculate bounds of route points
        const points = matchingRoute.points;
        let minLat = Infinity, maxLat = -Infinity;
        let minLon = Infinity, maxLon = -Infinity;
        
        points.forEach(p => {
            if (p.lat < minLat) minLat = p.lat;
            if (p.lat > maxLat) maxLat = p.lat;
            if (p.lon < minLon) minLon = p.lon;
            if (p.lon > maxLon) maxLon = p.lon;
        });
        
        const latRange = maxLat - minLat;
        const lonRange = maxLon - minLon;
        
        // Add padding
        const padding = Math.max(latRange, lonRange) * 0.1;
        const paddedLatRange = latRange + padding * 2;
        const paddedLonRange = lonRange + padding * 2;
        
        // Calculate scale to fit canvas (accounting for aspect ratio)
        const canvasAspect = canvas.width / canvas.height;
        const routeAspect = paddedLonRange / paddedLatRange;
        
        let scaleX, scaleY;
        if (routeAspect > canvasAspect) {
            scaleX = (canvas.width - 4) / paddedLonRange;
            scaleY = scaleX;
        } else {
            scaleY = (canvas.height - 4) / paddedLatRange;
            scaleX = scaleY;
        }
        
        // Draw route line
        ctx.strokeStyle = '#ff6b35';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        
        points.forEach((p, idx) => {
            const x = ((p.lon - minLon + padding) * scaleX) + 2;
            const y = canvas.height - ((p.lat - minLat + padding) * scaleY) - 2; // Flip Y axis
            
            if (idx === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        
        ctx.stroke();
        
        // Draw start marker (green dot)
        if (points.length > 0) {
            const startX = ((points[0].lon - minLon + padding) * scaleX) + 2;
            const startY = canvas.height - ((points[0].lat - minLat + padding) * scaleY) - 2;
            ctx.fillStyle = '#22c55e';
            ctx.beginPath();
            ctx.arc(startX, startY, 3, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Draw end marker (red dot)
        if (points.length > 1) {
            const endP = points[points.length - 1];
            const endX = ((endP.lon - minLon + padding) * scaleX) + 2;
            const endY = canvas.height - ((endP.lat - minLat + padding) * scaleY) - 2;
            ctx.fillStyle = '#ef4444';
            ctx.beginPath();
            ctx.arc(endX, endY, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Create route map for comparison view
    createComparisonRouteMap(workout, index) {
        const mapContainer = document.getElementById(`comparisonRouteMap_${index}`);
        if (!mapContainer) return;

        // Find matching route
        let matchingRoute = workout.matchingRoute;
        
        if (!matchingRoute) {
            // Find route by time matching
            const workoutTime = (workout.dateObj || new Date(workout.date)).getTime();
            matchingRoute = this.routes.find(r => {
                if (!r.startTime) return false;
                const routeStart = r.startTime instanceof Date ? r.startTime.getTime() : new Date(r.startTime).getTime();
                const timeDiff = Math.abs(routeStart - workoutTime);
                return timeDiff < 5 * 60 * 1000; // 5 minutes tolerance
            });
        }

        if (!matchingRoute || !matchingRoute.points || matchingRoute.points.length === 0) {
            mapContainer.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-secondary);">No route data available</div>';
            return;
        }

        // Destroy existing map if it exists
        if (this.comparisonMaps && this.comparisonMaps[index]) {
            this.comparisonMaps[index].remove();
        }
        if (!this.comparisonMaps) {
            this.comparisonMaps = [];
        }

        // Wait a bit for the container to be visible
        setTimeout(() => {
            try {
                // Create new map
                const map = L.map(mapContainer, {
                    zoomControl: true,
                    attributionControl: true
                }).setView([0, 0], 13);

                L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
                }).addTo(map);

                // Create route line
                const coordinates = matchingRoute.points.map(p => [p.lat, p.lon]);
                const routeLine = L.polyline(coordinates, {
                    color: '#ff6b35',
                    weight: 4,
                    opacity: 0.9
                }).addTo(map);

                // Add start/end markers
                if (coordinates.length > 0) {
                    L.marker(coordinates[0], {
                        icon: L.divIcon({
                            className: 'route-marker start',
                            html: '<div style="background: #22c55e; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px;">S</div>',
                            iconSize: [24, 24],
                            iconAnchor: [12, 12]
                        })
                    }).addTo(map);

                    L.marker(coordinates[coordinates.length - 1], {
                        icon: L.divIcon({
                            className: 'route-marker end',
                            html: '<div style="background: #ef4444; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px;">F</div>',
                            iconSize: [24, 24],
                            iconAnchor: [12, 12]
                        })
                    }).addTo(map);
                }

                // Fit map to route bounds
                map.fitBounds(routeLine.getBounds(), { padding: [20, 20] });
                
                // Invalidate size to ensure proper rendering
                setTimeout(() => {
                    map.invalidateSize();
                }, 100);

                // Store map reference
                this.comparisonMaps[index] = map;
            } catch (error) {
                console.error('Error creating comparison route map:', error);
                mapContainer.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-secondary);">Error loading map</div>';
            }
        }, 100);
    }

    // Save planned workout
    async savePlannedWorkout() {
        const date = document.getElementById('plannedDate').value;
        const type = document.getElementById('plannedType').value;
        const inputDistance = parseFloat(document.getElementById('plannedDistance').value) || 0;
        const notes = document.getElementById('plannedNotes').value;

        // Convert distance to km for storage (always store in km)
        const distance = this.useMetric ? inputDistance : inputDistance * 1.60934;

        const workout = {
            id: `planned_${date}`,
            date,
            type,
            distance,
            notes
        };

        await db.savePlannedWorkout(workout);
        this.plannedWorkouts = await db.getAllPlannedWorkouts();

        document.getElementById('plannedWorkoutModal').classList.remove('active');

        if (document.querySelector('#page-calendar.active')) {
            calendar.updatePlannedWorkouts(this.plannedWorkouts);
        }
    }

    // Import training plan from CSV
    async importPlanFromCsv(file) {
        try {
            const text = await file.text();
            const lines = text.trim().split('\n');

            if (lines.length < 2) {
                alert('CSV file is empty or has no data rows');
                return;
            }

            // Parse header
            const header = this.parseCsvLine(lines[0]).map(h => h.toLowerCase().trim());
            const dateIdx = header.indexOf('date');
            const typeIdx = header.indexOf('type');
            const distanceIdx = header.indexOf('distance');
            const notesIdx = header.indexOf('notes');

            if (dateIdx === -1 || typeIdx === -1) {
                alert('CSV must have "date" and "type" columns');
                return;
            }

            const validTypes = ['easy', 'tempo', 'interval', 'long', 'recovery', 'race', 'rest'];
            const workouts = [];
            const errors = [];

            // Parse data rows
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                const values = this.parseCsvLine(line);
                const date = values[dateIdx]?.trim();
                const type = values[typeIdx]?.trim().toLowerCase();
                const distance = distanceIdx !== -1 ? parseFloat(values[distanceIdx]) || 0 : 0;
                const notes = notesIdx !== -1 ? values[notesIdx]?.trim() || '' : '';

                // Validate date format
                if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                    errors.push(`Row ${i + 1}: Invalid date "${date}" (use YYYY-MM-DD)`);
                    continue;
                }

                // Validate type
                if (!validTypes.includes(type)) {
                    errors.push(`Row ${i + 1}: Invalid type "${type}" (use: ${validTypes.join(', ')})`);
                    continue;
                }

                // Convert distance to km for storage (CSV values are assumed to be in user's current unit)
                const distanceKm = this.useMetric ? distance : distance * 1.60934;
                
                workouts.push({
                    id: `planned_${date}`,
                    date,
                    type,
                    distance: distanceKm,
                    notes
                });
            }

            if (errors.length > 0) {
                const proceed = confirm(
                    `Found ${errors.length} error(s):\n\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n...and ${errors.length - 5} more` : ''}\n\nImport ${workouts.length} valid workouts anyway?`
                );
                if (!proceed) return;
            }

            if (workouts.length === 0) {
                alert('No valid workouts found in CSV');
                return;
            }

            // Ask user if they want to replace or merge
            const replace = confirm(
                `Found ${workouts.length} planned workouts.\n\nClick OK to REPLACE all existing planned workouts.\nClick Cancel to MERGE with existing (overwrites duplicates).`
            );

            if (replace) {
                await db.clearPlannedWorkouts();
            }

            await db.savePlannedWorkouts(workouts);
            this.plannedWorkouts = await db.getAllPlannedWorkouts();

            // Update calendar
            if (document.querySelector('#page-calendar.active')) {
                calendar.updatePlannedWorkouts(this.plannedWorkouts);
            }

            alert(`Successfully imported ${workouts.length} planned workouts!`);

        } catch (error) {
            console.error('Error importing CSV:', error);
            alert('Error importing CSV: ' + error.message);
        }
    }

    // Parse a single CSV line (handles quoted fields)
    parseCsvLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current);
        return result;
    }

    // Download CSV template
    // Load the default training plan into the database
    // Note: DEFAULT_TRAINING_PLAN distances are in MILES - store as-is since we track unit preference
    async loadDefaultPlan() {
        if (typeof DEFAULT_TRAINING_PLAN === 'undefined') {
            console.warn('Default training plan not available');
            return;
        }

        console.log(`Loading default training plan with ${DEFAULT_TRAINING_PLAN.length} workouts...`);

        // Default plan is in miles - store in km for consistency (internal storage is always km)
        const workouts = DEFAULT_TRAINING_PLAN.map(w => ({
            id: `planned_${w.date}`,
            date: w.date,
            type: w.type,
            // Store in km (convert from miles)
            distance: w.distance ? w.distance * 1.60934 : 0,
            notes: w.notes || ''
        }));

        await db.savePlannedWorkouts(workouts);
        this.plannedWorkouts = await db.getAllPlannedWorkouts();

        console.log(`Loaded ${this.plannedWorkouts.length} planned workouts`);
    }

    downloadPlanTemplate() {
        const template = `date,type,distance,notes
2026-01-13,easy,6,Base building run
2026-01-14,tempo,8,20 min tempo effort
2026-01-15,rest,,Rest day
2026-01-16,interval,7,8x400m with 200m jog recovery
2026-01-17,easy,5,Recovery run
2026-01-18,long,18,Easy pace long run
2026-01-19,rest,,
2026-01-20,easy,8,
2026-01-21,tempo,10,2x15 min tempo with 5 min jog
2026-01-22,rest,,
2026-01-23,interval,8,5x1000m at 5K pace
2026-01-24,easy,6,Shakeout run
2026-01-25,long,21,Progressive long run
2026-01-26,recovery,4,Easy recovery`;

        const blob = new Blob([template], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'training_plan_template.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // Update unit toggle UI
    updateUnitToggle() {
        document.querySelectorAll('.toggle-btn[data-unit]').forEach(btn => {
            btn.classList.toggle('active',
                (this.useMetric && btn.dataset.unit === 'km') ||
                (!this.useMetric && btn.dataset.unit === 'mi')
            );
        });
        // Update routes manager unit preference
        if (typeof routesManager !== 'undefined') {
            routesManager.setUnitPreference(this.useMetric);
        }
    }

    // Format pace as MM:SS
    // Show detailed workout information
    showWorkoutDetail(workout, date) {
        // Try to find matching workout from the other source to merge data
        const mergedWorkout = this.getMergedWorkoutData(workout, date);

        const unit = this.useMetric ? 'km' : 'mi';
        const dist = this.useMetric ? (mergedWorkout.distanceKm || 0) : (mergedWorkout.distanceMi || 0);
        
        // Calculate pace from distance and duration if missing
        let paceMinPerKm = mergedWorkout.pace || mergedWorkout.paceMinPerKm;
        if (!paceMinPerKm && mergedWorkout.distanceKm && mergedWorkout.duration && mergedWorkout.distanceKm > 0 && mergedWorkout.duration > 0) {
            paceMinPerKm = mergedWorkout.duration / mergedWorkout.distanceKm;
        }
        const pace = paceMinPerKm ? (this.useMetric ? paceMinPerKm : paceMinPerKm * 1.60934) : null;

        // Format date for title
        const dateStr = date.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        // Add source badge to title - show both if data was merged
        let sourceBadge = '';
        if (mergedWorkout.source === 'apple') {
            sourceBadge = mergedWorkout.mergedFromStrava ? '🍎🔶' : '🍎';
        } else if (mergedWorkout.source === 'strava') {
            sourceBadge = '🔶';
        }
        document.getElementById('workoutDetailTitle').textContent = `${sourceBadge} ${dateStr}`;

        // Summary stats
        document.getElementById('detailDistance').textContent = `${dist.toFixed(2)} ${unit}`;
        document.getElementById('detailDuration').textContent = this.formatDuration(mergedWorkout.duration);
        document.getElementById('detailPace').textContent = `${this.formatPace(pace)}/${unit}`;
        
        // Calculate HR average from detailed data if needed
        let hrAvg = mergedWorkout.heartRateAvg;
        if (!hrAvg && mergedWorkout.heartRateData && mergedWorkout.heartRateData.length > 0) {
            const hrValues = mergedWorkout.heartRateData.map(hr => typeof hr === 'object' ? hr.value : hr);
            hrAvg = hrValues.reduce((sum, val) => sum + val, 0) / hrValues.length;
        }
        document.getElementById('detailHR').textContent = hrAvg ?
            `${Math.round(hrAvg)} bpm` : '--';
        
        document.getElementById('detailCalories').textContent = mergedWorkout.calories ?
            `${Math.round(mergedWorkout.calories)}` : '--';

        // Calculate estimated VO2max
        const vo2max = this.calculateVO2Max(mergedWorkout);
        document.getElementById('detailVO2').textContent = vo2max ? vo2max.toFixed(1) : '--';

        // Additional stats - calculate min/max from detailed data if needed
        let hrMin = mergedWorkout.heartRateMin;
        let hrMax = mergedWorkout.heartRateMax;
        if ((!hrMin || !hrMax) && mergedWorkout.heartRateData && mergedWorkout.heartRateData.length > 0) {
            const hrValues = mergedWorkout.heartRateData.map(hr => typeof hr === 'object' ? hr.value : hr);
            if (!hrMin) hrMin = Math.min(...hrValues);
            if (!hrMax) hrMax = Math.max(...hrValues);
        }
        document.getElementById('detailMaxHR').textContent = hrMax ?
            `${Math.round(hrMax)} bpm` : '--';
        document.getElementById('detailMinHR').textContent = hrMin ?
            `${Math.round(hrMin)} bpm` : '--';

        // Best pace from route data
        const bestPace = this.getBestPaceFromRoute(mergedWorkout);
        document.getElementById('detailBestPace').textContent = bestPace ?
            `${this.formatPace(bestPace)}/${unit}` : '--';

        document.getElementById('detailElevation').textContent = mergedWorkout.elevation ?
            `${Math.round(mergedWorkout.elevation)} m` : '--';
        document.getElementById('detailCadence').textContent = (mergedWorkout.cadenceAvg || mergedWorkout.cadence) ?
            `${Math.round(mergedWorkout.cadenceAvg || mergedWorkout.cadence)} spm` : '--';
        // Calculate strideLengthAvg from detailed data if missing
        let strideDisplay = mergedWorkout.strideLengthAvg || mergedWorkout.strideLength;
        if (!strideDisplay && mergedWorkout.strideLengthData && mergedWorkout.strideLengthData.length > 0) {
            const strideValues = mergedWorkout.strideLengthData.map(s => typeof s === 'object' ? s.value : s);
            strideDisplay = strideValues.reduce((sum, val) => sum + val, 0) / strideValues.length;
            console.log(`[Detail] Calculated stride avg ${strideDisplay.toFixed(3)} from ${strideValues.length} stride data points for workout ${mergedWorkout.id}`);
        }
        document.getElementById('detailStride').textContent = strideDisplay ?
            `${strideDisplay.toFixed(2)} m` : '--';

        // Create HR zones chart
        this.createHRZonesChart(mergedWorkout);

        // Create pace chart (if we have detailed data)
        this.createPaceDetailChart(mergedWorkout);

        // Create HR chart (if we have detailed data)
        this.createHRDetailChart(mergedWorkout);

        // Create cadence chart (if we have detailed data)
        this.createCadenceDetailChart(mergedWorkout);

        // Create stride length chart (if we have detailed data)
        this.createStrideDetailChart(mergedWorkout);

        // Show route map if available
        this.showDetailRouteMap(mergedWorkout);

        // Show modal
        document.getElementById('workoutDetailModal').classList.add('active');
    }

    // Show route map in workout detail modal
    showDetailRouteMap(workout) {
        const routeSection = document.getElementById('detailRouteSection');
        const mapContainer = document.getElementById('detailRouteMap');
        const statsContainer = document.getElementById('detailRouteStats');

        // Find matching route - use same logic as routes tab (routesManager.linkRouteToWorkout)
        // First check if route is already in merged workout
        let matchingRoute = workout.matchingRoute;
        
        // If not found, search through all routes to find one that matches this workout
        if (!matchingRoute) {
            const workoutTime = (workout.dateObj || new Date(workout.date)).getTime();
            
            // Use same matching logic as linkRouteToWorkout - find route with matching start time
            matchingRoute = this.routes.find(r => {
                if (!r.startTime) return false;
                // Handle both Date objects and ISO strings (same as routesManager)
                const routeStart = r.startTime instanceof Date ? r.startTime.getTime() : new Date(r.startTime).getTime();
                const timeDiff = Math.abs(routeStart - workoutTime);
                return timeDiff < 5 * 60 * 1000; // 5 minutes tolerance (same as linkRouteToWorkout)
            });
        }

        if (!matchingRoute || !matchingRoute.points || matchingRoute.points.length === 0) {
            routeSection.style.display = 'none';
            return;
        }

        routeSection.style.display = 'block';

        // Clean up previous map if exists
        if (this.detailMap) {
            this.detailMap.remove();
            this.detailMap = null;
        }

        // Wait for modal to be visible before creating map
        setTimeout(() => {
            // Create new map
            this.detailMap = L.map(mapContainer).setView([0, 0], 13);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
            }).addTo(this.detailMap);

            // Create route line
            const coordinates = matchingRoute.points.map(p => [p.lat, p.lon]);
            const routeLine = L.polyline(coordinates, {
                color: '#ff6b35',
                weight: 4,
                opacity: 0.9
            }).addTo(this.detailMap);

            // Add start/end markers
            if (coordinates.length > 0) {
                L.marker(coordinates[0], {
                    icon: L.divIcon({
                        className: 'route-marker start',
                        html: '<div style="background: #22c55e; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px;">S</div>',
                        iconSize: [24, 24],
                        iconAnchor: [12, 12]
                    })
                }).addTo(this.detailMap);

                L.marker(coordinates[coordinates.length - 1], {
                    icon: L.divIcon({
                        className: 'route-marker end',
                        html: '<div style="background: #ef4444; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px;">F</div>',
                        iconSize: [24, 24],
                        iconAnchor: [12, 12]
                    })
                }).addTo(this.detailMap);
            }

            // Fit map to route bounds
            this.detailMap.fitBounds(routeLine.getBounds(), { padding: [20, 20] });
            
            // Invalidate size after modal animation completes
            setTimeout(() => {
                if (this.detailMap) {
                    this.detailMap.invalidateSize();
                }
            }, 300);
        }, 100);

        // Show route stats
        const unit = this.useMetric ? 'km' : 'mi';
        const distance = this.useMetric ? matchingRoute.totalDistance : matchingRoute.totalDistance / 1.60934;
        const pace = this.useMetric ? matchingRoute.avgPace : matchingRoute.avgPace * 1.60934;

        statsContainer.innerHTML = `
            <div class="route-detail-stat">
                <span class="stat-label">Route Distance</span>
                <span class="stat-value">${distance.toFixed(2)} ${unit}</span>
            </div>
            <div class="route-detail-stat">
                <span class="stat-label">Route Avg Pace</span>
                <span class="stat-value">${this.formatPace(pace)}/${unit}</span>
            </div>
            <div class="route-detail-stat">
                <span class="stat-label">Elevation Gain</span>
                <span class="stat-value">${matchingRoute.elevationGain ? Math.round(matchingRoute.elevationGain) + ' m' : '--'}</span>
            </div>
        `;
    }

    // Merge workout data from Apple and Strava sources
    getMergedWorkoutData(workout, date) {
        const workoutTime = (workout.dateObj || new Date(workout.date)).getTime();

        // Find matching workout from other source
        const otherSource = workout.source === 'apple' ? 'strava' : 'apple';
        const matchingWorkout = this.workouts.find(w => {
            if (w.source !== otherSource) return false;
            const wTime = (w.dateObj || new Date(w.date)).getTime();
            const timeDiff = Math.abs(wTime - workoutTime);
            return timeDiff < 10 * 60 * 1000; // Within 10 minutes
        });

        // Find matching route for detailed data - use same logic as routesManager.linkRouteToWorkout
        const matchingRoute = this.routes.find(r => {
            if (!r.startTime) return false;
            // Handle both Date objects and ISO strings
            const routeStart = r.startTime instanceof Date ? r.startTime.getTime() : new Date(r.startTime).getTime();
            const timeDiff = Math.abs(routeStart - workoutTime);
            return timeDiff < 5 * 60 * 1000; // 5 minutes tolerance
        });

        // Merge data - prefer existing values, fill gaps from other sources
        const merged = { ...workout };

        if (matchingWorkout) {
            // Fill missing fields from matching workout (use explicit null/undefined checks)
            if (!merged.heartRateAvg && matchingWorkout.heartRateAvg) merged.heartRateAvg = matchingWorkout.heartRateAvg;
            if (!merged.heartRateMax && matchingWorkout.heartRateMax) merged.heartRateMax = matchingWorkout.heartRateMax;
            if (!merged.heartRateMin && matchingWorkout.heartRateMin) merged.heartRateMin = matchingWorkout.heartRateMin;
            if ((!merged.heartRateData || merged.heartRateData.length === 0) && matchingWorkout.heartRateData && matchingWorkout.heartRateData.length > 0) {
                merged.heartRateData = matchingWorkout.heartRateData;
            }
            if (!merged.calories && matchingWorkout.calories) merged.calories = matchingWorkout.calories;
            if (!merged.elevation && matchingWorkout.elevation) merged.elevation = matchingWorkout.elevation;
            if (!merged.cadence && matchingWorkout.cadence) merged.cadence = matchingWorkout.cadence;
            if (!merged.strideLength && matchingWorkout.strideLength) merged.strideLength = matchingWorkout.strideLength;
            if (!merged.pace && matchingWorkout.pace) merged.pace = matchingWorkout.pace;
            if (!merged.paceMinPerKm) {
                merged.paceMinPerKm = merged.pace || matchingWorkout.pace || matchingWorkout.paceMinPerKm;
            }
            if ((!merged.cadenceData || merged.cadenceData.length === 0) && matchingWorkout.cadenceData && matchingWorkout.cadenceData.length > 0) {
                merged.cadenceData = matchingWorkout.cadenceData;
            }
            if ((!merged.strideLengthData || merged.strideLengthData.length === 0) && matchingWorkout.strideLengthData && matchingWorkout.strideLengthData.length > 0) {
                merged.strideLengthData = matchingWorkout.strideLengthData;
            }
            if (!merged.cadenceAvg && matchingWorkout.cadenceAvg) merged.cadenceAvg = matchingWorkout.cadenceAvg;
            if (!merged.strideLengthAvg && matchingWorkout.strideLengthAvg) merged.strideLengthAvg = matchingWorkout.strideLengthAvg;
        }
        
        // Calculate pace from distance and duration if still missing
        if (!merged.pace && !merged.paceMinPerKm && merged.distanceKm && merged.duration && merged.distanceKm > 0 && merged.duration > 0) {
            merged.pace = merged.duration / merged.distanceKm;
            merged.paceMinPerKm = merged.pace;
        }

        if (matchingRoute) {
            // Get elevation from route if available
            if (!merged.elevation && matchingRoute.points) {
                merged.elevation = this.calculateElevationGain(matchingRoute.points);
            }
            // Get HR data from route if available
            if ((!merged.heartRateData || merged.heartRateData.length === 0) && matchingRoute.heartRateData && matchingRoute.heartRateData.length > 0) {
                merged.heartRateData = matchingRoute.heartRateData;
            }
            if (!merged.heartRateAvg && matchingRoute.heartRateAvg) merged.heartRateAvg = matchingRoute.heartRateAvg;
            if (!merged.heartRateMin && matchingRoute.heartRateMin) merged.heartRateMin = matchingRoute.heartRateMin;
            if (!merged.heartRateMax && matchingRoute.heartRateMax) merged.heartRateMax = matchingRoute.heartRateMax;
            merged.matchingRoute = matchingRoute;
        }

        // Calculate HR stats from detailed data if averages are missing
        if (merged.heartRateData && merged.heartRateData.length > 0) {
            if (!merged.heartRateAvg || !merged.heartRateMin || !merged.heartRateMax) {
                const hrValues = merged.heartRateData.map(hr => typeof hr === 'object' ? hr.value : hr);
                if (!merged.heartRateAvg) {
                    merged.heartRateAvg = Math.round(hrValues.reduce((sum, val) => sum + val, 0) / hrValues.length);
                }
                if (!merged.heartRateMin) merged.heartRateMin = Math.min(...hrValues);
                if (!merged.heartRateMax) merged.heartRateMax = Math.max(...hrValues);
            }
        }
        
        // Calculate stride stats from detailed data if average is missing
        if (merged.strideLengthData && merged.strideLengthData.length > 0 && !merged.strideLengthAvg) {
            const strideValues = merged.strideLengthData.map(s => typeof s === 'object' ? s.value : s);
            merged.strideLengthAvg = strideValues.reduce((sum, val) => sum + val, 0) / strideValues.length;
        }
        
        // Calculate cadence stats from detailed data if average is missing
        if (merged.cadenceData && merged.cadenceData.length > 0 && !merged.cadenceAvg) {
            const cadenceValues = merged.cadenceData.map(c => typeof c === 'object' ? c.value : c);
            merged.cadenceAvg = Math.round(cadenceValues.reduce((sum, val) => sum + val, 0) / cadenceValues.length);
        }

        return merged;
    }

    // Calculate elevation gain from route points
    calculateElevationGain(points) {
        let gain = 0;
        for (let i = 1; i < points.length; i++) {
            if (points[i].ele && points[i-1].ele) {
                const diff = points[i].ele - points[i-1].ele;
                if (diff > 0) gain += diff;
            }
        }
        return gain > 0 ? gain : null;
    }

    // Get best pace from route data
    getBestPaceFromRoute(workout) {
        const route = workout.matchingRoute || this.routes.find(r => {
            if (!r.startTime || !workout.dateObj) return false;
            const routeStart = new Date(r.startTime).getTime();
            const workoutStart = workout.dateObj.getTime();
            return Math.abs(routeStart - workoutStart) < 5 * 60 * 1000;
        });

        if (!route || !route.points) return null;

        // Find fastest pace (lowest min/km)
        let bestPace = Infinity;
        for (const point of route.points) {
            if (point.speed && point.speed > 0) {
                const paceMinPerKm = (1000 / point.speed) / 60;
                if (paceMinPerKm > 2 && paceMinPerKm < bestPace) { // Sanity check
                    bestPace = paceMinPerKm;
                }
            }
        }

        if (bestPace === Infinity) return null;
        return this.useMetric ? bestPace : bestPace * 1.60934;
    }

    // Calculate estimated VO2max using Jack Daniels formula
    calculateVO2Max(workout) {
        if (!workout.duration || !workout.distanceKm || !workout.heartRateAvg) return null;

        const distanceMeters = workout.distanceKm * 1000;
        const timeMinutes = workout.duration;
        const avgHR = workout.heartRateAvg;

        // Velocity in meters per minute
        const velocity = distanceMeters / timeMinutes;

        // Calculate oxygen cost (ml/kg/min)
        const oxygenCost = -4.60 + 0.182258 * velocity + 0.000104 * velocity * velocity;

        // Calculate fraction of VO2max (%HRmax based estimate)
        const hrMax = this.maxHR;
        const percentHRmax = (avgHR / hrMax) * 100;
        const fractionVO2max = (percentHRmax - 37.182) / 63.094;

        if (fractionVO2max <= 0 || fractionVO2max > 1) return null;

        // Estimate VO2max
        const vo2max = oxygenCost / fractionVO2max;

        // Sanity check
        if (vo2max < 20 || vo2max > 90) return null;

        return vo2max;
    }

    // Helper: Calculate HR zone using Karvonen Formula (Heart Rate Reserve method)
    // Returns zone number (0-4) or null if invalid
    getHRZone(hrValue, maxHR = null, restingHR = null) {
        // Use instance values if not provided
        maxHR = maxHR || this.maxHR;
        restingHR = restingHR !== null ? restingHR : this.restingHR;

        // Edge case handling
        if (!hrValue || hrValue <= 0 || !maxHR || maxHR <= 0) return null;
        
        // If resting HR is not set or invalid, fallback to simple percentage method
        if (!restingHR || restingHR <= 0 || restingHR >= maxHR) {
            // Fallback: use simple percentage of max HR
            const percentMax = hrValue / maxHR;
            if (percentMax < 0.6) return 0;
            if (percentMax < 0.7) return 1;
            if (percentMax < 0.8) return 2;
            if (percentMax < 0.9) return 3;
            return 4;
        }

        // Calculate Heart Rate Reserve (HRR)
        const hrr = maxHR - restingHR;
        if (hrr <= 0) return null;

        // Calculate what percentage of HRR the current HR represents
        // Rearrange Karvonen: HR = ((Max HR - Resting HR) × % intensity) + Resting HR
        // To find % intensity: % intensity = (HR - Resting HR) / (Max HR - Resting HR)
        const hrPercent = (hrValue - restingHR) / hrr;

        // Determine zone based on HRR percentage
        if (hrPercent < 0.6) return 0;  // Zone 1: 50-60% of HRR
        if (hrPercent < 0.7) return 1;  // Zone 2: 60-70% of HRR
        if (hrPercent < 0.8) return 2;  // Zone 3: 70-80% of HRR
        if (hrPercent < 0.9) return 3;  // Zone 4: 80-90% of HRR
        return 4;  // Zone 5: 90-100% of HRR
    }

    // Helper: Calculate HR zone boundaries using Karvonen Formula
    // Returns array of zone objects with min/max HR values
    getHRZoneBoundaries(maxHR = null, restingHR = null) {
        maxHR = maxHR || this.maxHR;
        restingHR = restingHR !== null ? restingHR : this.restingHR;

        // If resting HR is not set or invalid, return null to indicate fallback
        if (!restingHR || restingHR <= 0 || restingHR >= maxHR) {
            return null; // Indicates should use simple percentage method
        }

        const hrr = maxHR - restingHR;
        if (hrr <= 0) return null;

        const zoneIntensities = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
        const zones = [
            { name: 'Zone 1 (Recovery)', min: 0.5, max: 0.6, color: '#10b981' },
            { name: 'Zone 2 (Aerobic)', min: 0.6, max: 0.7, color: '#3b82f6' },
            { name: 'Zone 3 (Tempo)', min: 0.7, max: 0.8, color: '#f59e0b' },
            { name: 'Zone 4 (Threshold)', min: 0.8, max: 0.9, color: '#f97316' },
            { name: 'Zone 5 (Max)', min: 0.9, max: 1.0, color: '#ef4444' }
        ];

        // Calculate actual HR values for each zone boundary
        return zones.map(z => {
            const minHR = (hrr * z.min) + restingHR;
            const maxHR = (hrr * z.max) + restingHR;
            return {
                ...z,
                minHR: Math.round(minHR),
                maxHR: Math.round(maxHR)
            };
        });
    }

    // Create HR zones chart for workout detail modal
    createHRZonesChart(workout) {
        const ctx = document.getElementById('detailHRZonesChart');
        if (!ctx) return;

        // Destroy existing chart
        if (this.hrZonesChartInstance) {
            this.hrZonesChartInstance.destroy();
        }

        const maxHR = this.maxHR;
        const restingHR = this.restingHR;
        
        // Get zone boundaries
        let zoneBoundaries = this.getHRZoneBoundaries(maxHR, restingHR);
        const useHRR = zoneBoundaries !== null;
        
        // Fallback zones if HRR not available
        if (!zoneBoundaries) {
            zoneBoundaries = [
                { name: 'Zone 1 (Recovery)', min: 0.5, max: 0.6, color: '#10b981' },
                { name: 'Zone 2 (Aerobic)', min: 0.6, max: 0.7, color: '#3b82f6' },
                { name: 'Zone 3 (Tempo)', min: 0.7, max: 0.8, color: '#f59e0b' },
                { name: 'Zone 4 (Threshold)', min: 0.8, max: 0.9, color: '#f97316' },
                { name: 'Zone 5 (Max)', min: 0.9, max: 1.0, color: '#ef4444' }
            ];
        }

        const zones = zoneBoundaries;

        // Calculate zone distribution
        let zoneMinutes = [0, 0, 0, 0, 0];

        if (workout.heartRateData && workout.heartRateData.length > 0) {
            // Use detailed HR data
            workout.heartRateData.forEach((hr, i) => {
                const hrValue = hr.value || hr;
                const zone = this.getHRZone(hrValue, maxHR, restingHR);
                if (zone !== null && zone >= 0 && zone <= 4) {
                    zoneMinutes[zone]++;
                }
            });

            // Convert to approximate minutes (assuming ~1 sample per second)
            const sampleRate = workout.heartRateData.length / (workout.duration || 1);
            zoneMinutes = zoneMinutes.map(z => z / sampleRate);
        } else if (workout.heartRateAvg) {
            // Estimate based on average HR
            const zone = this.getHRZone(workout.heartRateAvg, maxHR, restingHR);
            if (zone !== null && zone >= 0 && zone <= 4) {
                const primaryZone = zone;
                zoneMinutes[primaryZone] = workout.duration * 0.7;
                if (primaryZone > 0) zoneMinutes[primaryZone - 1] = workout.duration * 0.2;
                if (primaryZone < 4) zoneMinutes[primaryZone + 1] = workout.duration * 0.1;
            }
        }

        const total = zoneMinutes.reduce((a, b) => a + b, 0) || 1;
        const zonePercents = zoneMinutes.map(z => ((z / total) * 100).toFixed(1));

        this.hrZonesChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: zones.map(z => z.name.split(' ')[0] + ' ' + z.name.split(' ')[1]),
                datasets: [{
                    data: zonePercents,
                    backgroundColor: zones.map(z => z.color),
                    borderRadius: 6
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (context) => `${context.raw}%`
                        }
                    }
                },
                scales: {
                    x: {
                        max: 100,
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        ticks: { color: '#9ca3af' }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: '#9ca3af' }
                    }
                }
            }
        });

        // Update legend
        const legend = document.getElementById('detailHRZonesLegend');
        if (!legend) return;
        legend.innerHTML = zones.map((z, i) => {
            let zoneText = z.name;
            if (useHRR && z.minHR !== undefined && z.maxHR !== undefined) {
                zoneText += ` (${z.minHR}-${z.maxHR} bpm)`;
            }
            return `
                <div class="zone-legend-item">
                    <span class="zone-legend-color" style="background: ${z.color}"></span>
                    <span class="zone-legend-text">${zoneText}</span>
                    <span class="zone-legend-percent">${zonePercents[i]}%</span>
                </div>
            `;
        }).join('');
    }

    // Create pace detail chart
    createPaceDetailChart(workout) {
        const ctx = document.getElementById('paceDetailChart');
        if (!ctx) return;

        // Destroy existing chart
        if (this.paceDetailChartInstance) {
            this.paceDetailChartInstance.destroy();
        }

        // Use pre-merged route or find one
        const matchingRoute = workout.matchingRoute || this.routes.find(r => {
            if (!r.startTime || !workout.dateObj) return false;
            const routeStart = new Date(r.startTime).getTime();
            const workoutStart = workout.dateObj.getTime();
            return Math.abs(routeStart - workoutStart) < 5 * 60 * 1000;
        });

        let labels = [];
        let paceData = [];
        const unit = this.useMetric ? 'km' : 'mi';

        if (matchingRoute && matchingRoute.points && matchingRoute.points.length > 0) {
            // Use route data for pace - X axis is distance
            const sampleRate = Math.max(1, Math.floor(matchingRoute.points.length / 50));
            let cumulativeDistance = 0;

            for (let i = 0; i < matchingRoute.points.length; i += sampleRate) {
                const point = matchingRoute.points[i];
                
                // Calculate cumulative distance
                if (i > 0) {
                    const prevIdx = Math.max(0, i - sampleRate);
                    const prevPoint = matchingRoute.points[prevIdx];
                    const segmentDist = this.calculateDistance(
                        prevPoint.lat, prevPoint.lon, point.lat, point.lon
                    );
                    cumulativeDistance += segmentDist;
                }
                
                const displayDist = this.useMetric ? cumulativeDistance : cumulativeDistance / 1.60934;
                labels.push(displayDist.toFixed(2));

                if (point.speed && point.speed > 0) {
                    const paceMinPerKm = (1000 / point.speed) / 60;
                    const displayPace = this.useMetric ? paceMinPerKm : paceMinPerKm * 1.60934;
                    paceData.push(Math.min(displayPace, 15)); // Cap at 15 min/unit for display
                } else {
                    paceData.push(null);
                }
            }
        } else {
            // Show flat line at average pace across estimated distance
            let paceMinPerKm = workout.pace || workout.paceMinPerKm;
            if (!paceMinPerKm && workout.distanceKm && workout.duration && workout.distanceKm > 0 && workout.duration > 0) {
                paceMinPerKm = workout.duration / workout.distanceKm;
            }
            const avgPace = paceMinPerKm ? (this.useMetric ? paceMinPerKm : paceMinPerKm * 1.60934) : 0;
            const totalDist = this.useMetric ? (workout.distanceKm || 0) : (workout.distanceMi || 0);
            for (let i = 0; i <= 10; i++) {
                labels.push((totalDist * i / 10).toFixed(2));
                paceData.push(avgPace || null);
            }
        }

        this.paceDetailChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: `Pace (min/${unit})`,
                    data: paceData,
                    borderColor: '#ff6b35',
                    backgroundColor: 'rgba(255, 107, 53, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        title: { display: true, text: `Distance (${unit})`, color: '#9ca3af' },
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        ticks: { color: '#9ca3af' }
                    },
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: `Pace (min/${unit})`, color: '#9ca3af' },
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        ticks: { color: '#9ca3af' }
                    }
                }
            }
        });
    }

    // Calculate distance between two lat/lon points in km (Haversine formula)
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    // Create HR detail chart
    createHRDetailChart(workout) {
        const ctx = document.getElementById('hrDetailChart');
        if (!ctx) return;

        // Destroy existing chart
        if (this.hrDetailChartInstance) {
            this.hrDetailChartInstance.destroy();
        }

        let labels = [];
        let hrData = [];
        const unit = this.useMetric ? 'km' : 'mi';
        const maxHR = this.maxHR;

        // Try to get matching route for distance-based x-axis
        const matchingRoute = workout.matchingRoute || this.routes.find(r => {
            if (!r.startTime || !workout.dateObj) return false;
            const routeStart = new Date(r.startTime).getTime();
            const workoutStart = workout.dateObj.getTime();
            return Math.abs(routeStart - workoutStart) < 5 * 60 * 1000;
        });

        if (workout.heartRateData && workout.heartRateData.length > 0 && matchingRoute && matchingRoute.points) {
            // Use detailed HR data with distance-based x-axis
            const sampleRate = Math.max(1, Math.floor(workout.heartRateData.length / 100));
            const startTime = workout.heartRateData[0].time || 0;
            const workoutDuration = workout.duration * 60 * 1000; // in ms
            const totalDistKm = matchingRoute.totalDistance || workout.distanceKm || 0;

            for (let i = 0; i < workout.heartRateData.length; i += sampleRate) {
                const hr = workout.heartRateData[i];
                const elapsed = ((hr.time || i) - startTime);
                // Estimate distance based on time proportion
                const distKm = (elapsed / workoutDuration) * totalDistKm;
                const displayDist = this.useMetric ? distKm : distKm / 1.60934;
                labels.push(displayDist.toFixed(2));
                hrData.push(hr.value || hr);
            }
        } else if (workout.heartRateData && workout.heartRateData.length > 0) {
            // Use detailed HR data with distance estimated from workout
            const sampleRate = Math.max(1, Math.floor(workout.heartRateData.length / 100));
            const totalDistKm = workout.distanceKm || 0;

            for (let i = 0; i < workout.heartRateData.length; i += sampleRate) {
                const hr = workout.heartRateData[i];
                const distKm = (i / workout.heartRateData.length) * totalDistKm;
                const displayDist = this.useMetric ? distKm : distKm / 1.60934;
                labels.push(displayDist.toFixed(2));
                hrData.push(hr.value || hr);
            }
        } else if (workout.heartRateAvg) {
            // Show flat line at average across distance
            const totalDist = this.useMetric ? (workout.distanceKm || 0) : (workout.distanceMi || 0);
            for (let i = 0; i <= 10; i++) {
                labels.push((totalDist * i / 10).toFixed(2));
                hrData.push(workout.heartRateAvg);
            }
        } else {
            // No HR data
            document.getElementById('hrDetailChart').parentElement.innerHTML =
                '<p style="text-align: center; color: var(--text-muted); padding: 40px;">No heart rate data available</p>';
            return;
        }

        // Function to get zone color based on HR value using Karvonen formula
        const getZoneColor = (hr) => {
            const zone = this.getHRZone(hr, maxHR, this.restingHR);
            if (zone === null) return '#9ca3af'; // Gray for invalid
            
            const zoneColors = ['#10b981', '#3b82f6', '#f59e0b', '#f97316', '#ef4444'];
            return zoneColors[zone] || '#9ca3af';
        };

        // Create segment colors based on HR zones
        const segmentColors = hrData.map(hr => getZoneColor(hr));

        this.hrDetailChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Heart Rate (bpm)',
                    data: hrData,
                    segment: {
                        borderColor: (ctx) => {
                            if (ctx.p0DataIndex === undefined) return '#ef4444';
                            return getZoneColor(ctx.p0.parsed.y);
                        }
                    },
                    borderColor: '#ef4444',
                    backgroundColor: 'transparent',
                    fill: false,
                    tension: 0.3,
                    pointRadius: 0,
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        title: { display: true, text: `Distance (${unit})`, color: '#9ca3af' },
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        ticks: { color: '#9ca3af' }
                    },
                    y: {
                        beginAtZero: true,
                        max: Math.max(...hrData) + 10,
                        title: { display: true, text: 'Heart Rate (bpm)', color: '#9ca3af' },
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        ticks: { color: '#9ca3af' }
                    }
                }
            }
        });
    }

    // Create cadence detail chart
    createCadenceDetailChart(workout) {
        const ctx = document.getElementById('cadenceDetailChart');
        if (!ctx) return;

        // Destroy existing chart
        if (this.cadenceDetailChartInstance) {
            this.cadenceDetailChartInstance.destroy();
        }

        let labels = [];
        let cadenceData = [];
        const unit = this.useMetric ? 'km' : 'mi';
        const totalDistKm = workout.distanceKm || 0;

        if (workout.cadenceData && workout.cadenceData.length > 0) {
            // Use detailed cadence data with distance-based x-axis
            const sampleRate = Math.max(1, Math.floor(workout.cadenceData.length / 100));

            for (let i = 0; i < workout.cadenceData.length; i += sampleRate) {
                const c = workout.cadenceData[i];
                const distKm = (i / workout.cadenceData.length) * totalDistKm;
                const displayDist = this.useMetric ? distKm : distKm / 1.60934;
                labels.push(displayDist.toFixed(2));
                cadenceData.push(c.value || c);
            }
        } else if (workout.cadenceAvg) {
            // Show flat line at average across distance
            const totalDist = this.useMetric ? totalDistKm : (workout.distanceMi || 0);
            for (let i = 0; i <= 10; i++) {
                labels.push((totalDist * i / 10).toFixed(2));
                cadenceData.push(workout.cadenceAvg);
            }
        } else {
            // No cadence data
            ctx.parentElement.innerHTML =
                '<p style="text-align: center; color: var(--text-muted); padding: 40px;">No cadence data available</p>';
            return;
        }

        this.cadenceDetailChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Cadence (spm)',
                    data: cadenceData,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        title: { display: true, text: `Distance (${unit})`, color: '#9ca3af' },
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        ticks: { color: '#9ca3af' }
                    },
                    y: {
                        beginAtZero: true,
                        max: cadenceData.length > 0 ? Math.max(...cadenceData) + 10 : 200,
                        title: { display: true, text: 'Cadence (steps/min)', color: '#9ca3af' },
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        ticks: { color: '#9ca3af' }
                    }
                }
            }
        });
    }

    // Create stride length detail chart
    createStrideDetailChart(workout) {
        const ctx = document.getElementById('strideDetailChart');
        if (!ctx) return;

        // Destroy existing chart
        if (this.strideDetailChartInstance) {
            this.strideDetailChartInstance.destroy();
        }

        let labels = [];
        let strideData = [];
        const unit = this.useMetric ? 'km' : 'mi';
        const totalDistKm = workout.distanceKm || 0;

        if (workout.strideLengthData && workout.strideLengthData.length > 0) {
            // Use detailed stride length data with distance-based x-axis
            const sampleRate = Math.max(1, Math.floor(workout.strideLengthData.length / 100));

            for (let i = 0; i < workout.strideLengthData.length; i += sampleRate) {
                const s = workout.strideLengthData[i];
                const distKm = (i / workout.strideLengthData.length) * totalDistKm;
                const displayDist = this.useMetric ? distKm : distKm / 1.60934;
                labels.push(displayDist.toFixed(2));
                strideData.push(s.value || s);
            }
        } else if (workout.strideLengthAvg) {
            // Show flat line at average across distance
            const totalDist = this.useMetric ? totalDistKm : (workout.distanceMi || 0);
            for (let i = 0; i <= 10; i++) {
                labels.push((totalDist * i / 10).toFixed(2));
                strideData.push(workout.strideLengthAvg);
            }
        } else {
            // No stride data
            ctx.parentElement.innerHTML =
                '<p style="text-align: center; color: var(--text-muted); padding: 40px;">No stride length data available</p>';
            return;
        }

        this.strideDetailChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Stride Length (m)',
                    data: strideData,
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139, 92, 246, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        title: { display: true, text: `Distance (${unit})`, color: '#9ca3af' },
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        ticks: { color: '#9ca3af' }
                    },
                    y: {
                        beginAtZero: true,
                        max: strideData.length > 0 ? Math.max(...strideData) + 0.1 : 1.5,
                        title: { display: true, text: 'Stride Length (m)', color: '#9ca3af' },
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        ticks: { color: '#9ca3af' }
                    }
                }
            }
        });
    }

    // Format duration as MM:SS or HH:MM:SS
    formatDuration(minutes) {
        if (!minutes) return '--:--';
        const hrs = Math.floor(minutes / 60);
        const mins = Math.floor(minutes % 60);
        const secs = Math.round((minutes % 1) * 60);
        if (hrs > 0) {
            return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    formatPace(minPerUnit) {
        if (!minPerUnit || minPerUnit === Infinity) return '--:--';
        const mins = Math.floor(minPerUnit);
        const secs = Math.round((minPerUnit - mins) * 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // Debounce utility
    debounce(fn, delay) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn.apply(this, args), delay);
        };
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
