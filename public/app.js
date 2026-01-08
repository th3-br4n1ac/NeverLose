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
        this.selectedRoute = null;
        this.comparisonMode = false;
        this.currentPage = 1;
        this.pageSize = 20;
        this.useMetric = true;
        this.maxHR = 190;
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

        // Find Strava workouts that are duplicates of Apple workouts
        const stravaDuplicateIds = new Set();

        for (const stravaW of stravaWorkouts) {
            const stravaTime = (stravaW.dateObj || new Date(stravaW.date)).getTime();
            const stravaDist = stravaW.distanceKm || 0;

            for (const appleW of appleWorkouts) {
                const appleTime = (appleW.dateObj || new Date(appleW.date)).getTime();
                const appleDist = appleW.distanceKm || 0;

                // Check time similarity (within 10 minutes)
                const timeDiff = Math.abs(stravaTime - appleTime);
                const timeMatch = timeDiff < 10 * 60 * 1000; // 10 minutes

                // Check distance similarity (within 10% or 0.5km, whichever is greater)
                const distDiff = Math.abs(stravaDist - appleDist);
                const distThreshold = Math.max(0.5, Math.max(stravaDist, appleDist) * 0.1);
                const distMatch = distDiff < distThreshold;

                // If both match, it's a duplicate - calculate similarity score
                if (timeMatch && distMatch) {
                    const timeSimilarity = 1 - (timeDiff / (10 * 60 * 1000));
                    const distSimilarity = 1 - (distDiff / distThreshold);
                    const similarity = (timeSimilarity + distSimilarity) / 2;

                    // 95% similarity threshold
                    if (similarity >= 0.5) { // Already passed tight filters, so lower threshold is fine
                        stravaDuplicateIds.add(stravaW.id);
                        break;
                    }
                }
            }
        }

        // Filter out duplicate Strava workouts
        const filteredStrava = stravaWorkouts.filter(w => !stravaDuplicateIds.has(w.id));

        return [...appleWorkouts, ...filteredStrava, ...otherWorkouts];
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

            // Update UI with loaded settings
            this.updateUnitToggle();
            document.getElementById('maxHR').value = this.maxHR;

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
            this.maxHR = parseInt(e.target.value) || 190;
            try {
                await db.setSetting('maxHR', this.maxHR);
            } catch (e) {
                console.error('Failed to save maxHR setting:', e);
            }
            this.updateCharts();
        });

        // Clear data
        document.getElementById('clearAllData').addEventListener('click', async () => {
            if (confirm('Are you sure you want to delete all local data? This cannot be undone.')) {
                await db.clearAllData();
                strava.clearTokens();
                location.reload();
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
        document.getElementById('analyticsRange').addEventListener('change', () => this.updateCharts());

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
        document.getElementById('playbackPrev').addEventListener('click', () => this.seekPlayback(-50));
        document.getElementById('playbackNext').addEventListener('click', () => this.seekPlayback(50));
        document.getElementById('playbackSpeed').addEventListener('change', (e) => {
            routesManager.playbackSpeed = parseInt(e.target.value);
        });
        document.getElementById('playbackSlider').addEventListener('input', (e) => {
            const percent = parseInt(e.target.value);
            if (this.selectedRoute) {
                const index = Math.floor((percent / 100) * this.selectedRoute.points.length);
                routesManager.setPlaybackPosition(index);
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

        routesManager.startPlayback(this.selectedRoute, {
            speed: parseInt(document.getElementById('playbackSpeed').value),
            onProgress: (progress) => {
                const percent = (progress.index / progress.total) * 100;
                document.getElementById('playbackSlider').value = percent;

                // Convert distance based on unit preference
                const distanceDisplay = this.useMetric ? progress.distance : progress.distance / 1.60934;
                document.getElementById('playbackDistance').textContent =
                    `${distanceDisplay.toFixed(2)} ${unit}`;
                document.getElementById('playbackTime').textContent =
                    routesManager.formatDuration(progress.elapsed / 60000);

                // Calculate current pace (convert if needed)
                if (progress.elapsed > 0 && progress.distance > 0) {
                    const pacePerKm = (progress.elapsed / 60000) / progress.distance;
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

    // Seek playback
    seekPlayback(delta) {
        if (!this.selectedRoute) return;
        const newIndex = routesManager.playbackIndex + delta;
        routesManager.setPlaybackPosition(newIndex);
        const percent = (newIndex / this.selectedRoute.points.length) * 100;
        document.getElementById('playbackSlider').value = percent;
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
            const workouts = await appleParser.parseFile(file, (progress) => {
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

            // Fetch detailed HR data for activities that have heart rate
            // Only fetch for new activities or those without HR data
            const existingWorkouts = await db.getAllWorkouts();
            const existingStravaIds = new Set(
                existingWorkouts
                    .filter(w => w.source === 'strava' && w.heartRateData && w.heartRateData.length > 0)
                    .map(w => w.stravaId)
            );

            const activitiesNeedingHR = activities.filter(a =>
                a.heartRateAvg && !existingStravaIds.has(a.stravaId)
            );

            console.log(`Found ${activities.length} activities, ${activitiesNeedingHR.length} need HR data`);

            let hrFetched = 0;
            for (const activity of activitiesNeedingHR) {
                try {
                    if (!silent) {
                        btn.innerHTML = `<span class="spinner"></span> Fetching HR ${hrFetched + 1}/${activitiesNeedingHR.length}...`;
                    }
                    const hrData = await strava.fetchHeartRateData(activity.stravaId, activity.date);
                    if (hrData && hrData.length > 0) {
                        activity.heartRateData = hrData;
                        hrFetched++;
                    }
                    // Small delay to avoid rate limiting
                    await new Promise(r => setTimeout(r, 200));
                } catch (e) {
                    console.warn(`Failed to fetch HR for activity ${activity.stravaId}:`, e);
                }
            }

            // For activities that already have HR data, copy it from existing
            for (const activity of activities) {
                if (!activity.heartRateData) {
                    const existing = existingWorkouts.find(w =>
                        w.source === 'strava' && w.stravaId === activity.stravaId && w.heartRateData
                    );
                    if (existing) {
                        activity.heartRateData = existing.heartRateData;
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
        charts.createWeeklyMileageChart('weeklyMileageChart', this.workouts, this.useMetric);
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

        // This week
        const weekStart = new Date(now);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        weekStart.setHours(0, 0, 0, 0);

        const thisWeekWorkouts = this.workouts.filter(w => {
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

        const lastWeekWorkouts = this.workouts.filter(w => {
            const d = w.dateObj || new Date(w.date);
            return d >= lastWeekStart && d < lastWeekEnd;
        });

        const lastWeekDistanceKm = lastWeekWorkouts.reduce((sum, w) => sum + (w.distanceKm || 0), 0);
        this.updateCompare('weekCompare', weekDistanceKm, lastWeekDistanceKm);

        // This month
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const thisMonthWorkouts = this.workouts.filter(w => {
            const d = w.dateObj || new Date(w.date);
            return d >= monthStart;
        });

        const monthDistanceKm = thisMonthWorkouts.reduce((sum, w) => sum + (w.distanceKm || 0), 0);
        document.getElementById('monthDistance').textContent =
            (this.useMetric ? monthDistanceKm : monthDistanceKm / 1.60934).toFixed(1);

        // Last month comparison
        const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 1);

        const lastMonthWorkouts = this.workouts.filter(w => {
            const d = w.dateObj || new Date(w.date);
            return d >= lastMonthStart && d < lastMonthEnd;
        });

        const lastMonthDistanceKm = lastMonthWorkouts.reduce((sum, w) => sum + (w.distanceKm || 0), 0);
        this.updateCompare('monthCompare', monthDistanceKm, lastMonthDistanceKm);

        // Total runs
        document.getElementById('totalRuns').textContent = this.workouts.length;

        // Average pace
        const validPaceWorkouts = this.workouts.filter(w => w.pace && w.pace > 0 && w.pace < 20);
        if (validPaceWorkouts.length > 0) {
            const avgPace = validPaceWorkouts.reduce((sum, w) => sum + w.pace, 0) / validPaceWorkouts.length;
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
        const recent = [...this.workouts]
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

        container.innerHTML = recent.map(w => {
            const d = w.dateObj || new Date(w.date);
            // Convert distance based on unit preference
            const distanceKm = w.distanceKm || 0;
            const distance = this.useMetric ? distanceKm : distanceKm / 1.60934;
            const unit = this.useMetric ? 'km' : 'mi';

            // Convert pace based on unit preference (pace is stored as min/km)
            const paceMinPerKm = w.pace || 0;
            const paceDisplay = paceMinPerKm > 0
                ? this.formatPace(this.useMetric ? paceMinPerKm : paceMinPerKm * 1.60934)
                : '--:--';

            return `
                <div class="activity-item">
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
            const pace = w.pace ? (this.useMetric ? w.pace : w.pace * 1.60934) : null;
            const workoutIndex = start + idx;

            let hrDisplay = '--';
            if (w.heartRateAvg) {
                hrDisplay = `<span style="color: var(--accent-primary)">${Math.round(w.heartRateAvg)}</span>`;
                if (w.heartRateMin || w.heartRateMax) {
                    hrDisplay += ` <span style="color: var(--text-muted)">(${w.heartRateMin || '--'}-${w.heartRateMax || '--'})</span>`;
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
                        ${w.source === 'apple' ? '<span class="source-badge apple">🍎 Apple</span>' : ''}
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
        const days = parseInt(document.getElementById('analyticsRange').value) || 365;
        let filtered = this.workouts;

        if (days !== 'all') {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - days);
            filtered = this.workouts.filter(w => {
                const d = w.dateObj || new Date(w.date);
                return d >= cutoff;
            });
        }

        charts.updateAllCharts(filtered, this.useMetric, this.maxHR);
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
        const pace = this.useMetric ? mergedWorkout.paceMinPerKm : (mergedWorkout.paceMinPerKm * 1.60934);

        // Format date for title
        const dateStr = date.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        // Add source badge to title
        const sourceBadge = mergedWorkout.source === 'apple' ? '🍎' :
                           mergedWorkout.source === 'strava' ? '🔶' : '';
        document.getElementById('workoutDetailTitle').textContent = `${sourceBadge} ${dateStr}`;

        // Summary stats
        document.getElementById('detailDistance').textContent = `${dist.toFixed(2)} ${unit}`;
        document.getElementById('detailDuration').textContent = this.formatDuration(mergedWorkout.duration);
        document.getElementById('detailPace').textContent = `${this.formatPace(pace)}/${unit}`;
        document.getElementById('detailHR').textContent = mergedWorkout.heartRateAvg ?
            `${Math.round(mergedWorkout.heartRateAvg)} bpm` : '--';
        document.getElementById('detailCalories').textContent = mergedWorkout.calories ?
            `${Math.round(mergedWorkout.calories)}` : '--';

        // Calculate estimated VO2max
        const vo2max = this.calculateVO2Max(mergedWorkout);
        document.getElementById('detailVO2').textContent = vo2max ? vo2max.toFixed(1) : '--';

        // Additional stats
        document.getElementById('detailMaxHR').textContent = mergedWorkout.heartRateMax ?
            `${Math.round(mergedWorkout.heartRateMax)} bpm` : '--';
        document.getElementById('detailMinHR').textContent = mergedWorkout.heartRateMin ?
            `${Math.round(mergedWorkout.heartRateMin)} bpm` : '--';

        // Best pace from route data
        const bestPace = this.getBestPaceFromRoute(mergedWorkout);
        document.getElementById('detailBestPace').textContent = bestPace ?
            `${this.formatPace(bestPace)}/${unit}` : '--';

        document.getElementById('detailElevation').textContent = mergedWorkout.elevation ?
            `${Math.round(mergedWorkout.elevation)} m` : '--';
        document.getElementById('detailCadence').textContent = (mergedWorkout.cadenceAvg || mergedWorkout.cadence) ?
            `${Math.round(mergedWorkout.cadenceAvg || mergedWorkout.cadence)} spm` : '--';
        document.getElementById('detailStride').textContent = (mergedWorkout.strideLengthAvg || mergedWorkout.strideLength) ?
            `${(mergedWorkout.strideLengthAvg || mergedWorkout.strideLength).toFixed(2)} m` : '--';

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

        // Find matching route
        const workoutTime = (workout.dateObj || new Date(workout.date)).getTime();
        const matchingRoute = workout.matchingRoute || this.routes.find(r => {
            if (!r.startTime) return false;
            const routeStart = new Date(r.startTime).getTime();
            return Math.abs(routeStart - workoutTime) < 5 * 60 * 1000;
        });

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

        // Find matching route for detailed data
        const matchingRoute = this.routes.find(r => {
            if (!r.startTime) return false;
            const routeStart = new Date(r.startTime).getTime();
            return Math.abs(routeStart - workoutTime) < 5 * 60 * 1000;
        });

        // Merge data - prefer existing values, fill gaps from other sources
        const merged = { ...workout };

        if (matchingWorkout) {
            // Fill missing fields from matching workout
            merged.heartRateAvg = merged.heartRateAvg || matchingWorkout.heartRateAvg;
            merged.heartRateMax = merged.heartRateMax || matchingWorkout.heartRateMax;
            merged.heartRateMin = merged.heartRateMin || matchingWorkout.heartRateMin;
            merged.calories = merged.calories || matchingWorkout.calories;
            merged.elevation = merged.elevation || matchingWorkout.elevation;
            merged.cadence = merged.cadence || matchingWorkout.cadence;
            merged.strideLength = merged.strideLength || matchingWorkout.strideLength;
            merged.heartRateData = merged.heartRateData || matchingWorkout.heartRateData;
            merged.cadenceData = merged.cadenceData || matchingWorkout.cadenceData;
            merged.strideLengthData = merged.strideLengthData || matchingWorkout.strideLengthData;
            merged.cadenceAvg = merged.cadenceAvg || matchingWorkout.cadenceAvg;
            merged.strideLengthAvg = merged.strideLengthAvg || matchingWorkout.strideLengthAvg;
        }

        if (matchingRoute) {
            // Get elevation from route if available
            if (!merged.elevation && matchingRoute.points) {
                merged.elevation = this.calculateElevationGain(matchingRoute.points);
            }
            // Get HR data from route if available
            merged.heartRateData = merged.heartRateData || matchingRoute.heartRateData;
            merged.matchingRoute = matchingRoute;
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

    // Create HR zones chart for workout detail modal
    createHRZonesChart(workout) {
        const ctx = document.getElementById('detailHRZonesChart');
        if (!ctx) return;

        // Destroy existing chart
        if (this.hrZonesChartInstance) {
            this.hrZonesChartInstance.destroy();
        }

        const maxHR = this.maxHR;
        const zones = [
            { name: 'Zone 1 (Recovery)', min: 0.5, max: 0.6, color: '#10b981' },
            { name: 'Zone 2 (Aerobic)', min: 0.6, max: 0.7, color: '#3b82f6' },
            { name: 'Zone 3 (Tempo)', min: 0.7, max: 0.8, color: '#f59e0b' },
            { name: 'Zone 4 (Threshold)', min: 0.8, max: 0.9, color: '#f97316' },
            { name: 'Zone 5 (Max)', min: 0.9, max: 1.0, color: '#ef4444' }
        ];

        // Calculate zone distribution
        let zoneMinutes = [0, 0, 0, 0, 0];

        if (workout.heartRateData && workout.heartRateData.length > 0) {
            // Use detailed HR data
            workout.heartRateData.forEach((hr, i) => {
                const hrValue = hr.value || hr;
                const percentMax = hrValue / maxHR;

                if (percentMax < 0.6) zoneMinutes[0]++;
                else if (percentMax < 0.7) zoneMinutes[1]++;
                else if (percentMax < 0.8) zoneMinutes[2]++;
                else if (percentMax < 0.9) zoneMinutes[3]++;
                else zoneMinutes[4]++;
            });

            // Convert to approximate minutes (assuming ~1 sample per second)
            const sampleRate = workout.heartRateData.length / (workout.duration || 1);
            zoneMinutes = zoneMinutes.map(z => z / sampleRate);
        } else if (workout.heartRateAvg) {
            // Estimate based on average HR
            const percentMax = workout.heartRateAvg / maxHR;
            const primaryZone = percentMax < 0.6 ? 0 : percentMax < 0.7 ? 1 :
                               percentMax < 0.8 ? 2 : percentMax < 0.9 ? 3 : 4;
            zoneMinutes[primaryZone] = workout.duration * 0.7;
            if (primaryZone > 0) zoneMinutes[primaryZone - 1] = workout.duration * 0.2;
            if (primaryZone < 4) zoneMinutes[primaryZone + 1] = workout.duration * 0.1;
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
        legend.innerHTML = zones.map((z, i) => `
            <div class="zone-legend-item">
                <span class="zone-legend-color" style="background: ${z.color}"></span>
                <span class="zone-legend-text">${z.name}</span>
                <span class="zone-legend-percent">${zonePercents[i]}%</span>
            </div>
        `).join('');
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
            const avgPace = this.useMetric ? workout.paceMinPerKm : (workout.paceMinPerKm * 1.60934);
            const totalDist = this.useMetric ? (workout.distanceKm || 0) : (workout.distanceMi || 0);
            for (let i = 0; i <= 10; i++) {
                labels.push((totalDist * i / 10).toFixed(2));
                paceData.push(avgPace);
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

        // Function to get zone color based on HR value
        const getZoneColor = (hr) => {
            const percent = hr / maxHR;
            if (percent < 0.6) return '#10b981'; // Zone 1 - Green
            if (percent < 0.7) return '#3b82f6'; // Zone 2 - Blue
            if (percent < 0.8) return '#f59e0b'; // Zone 3 - Yellow/Amber
            if (percent < 0.9) return '#f97316'; // Zone 4 - Orange
            return '#ef4444'; // Zone 5 - Red
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
