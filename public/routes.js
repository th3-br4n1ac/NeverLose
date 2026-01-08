/**
 * Routes Manager
 * Handles GPX parsing, map visualization, playback, and route comparison
 */

class RoutesManager {
    constructor() {
        this.map = null;
        this.routes = [];
        this.currentRoute = null;
        this.comparisonRoute = null;
        this.playbackInterval = null;
        this.playbackIndex = 0;
        this.playbackSpeed = 50; // ms between points (deprecated, use currentSpeedMultiplier)
        this.currentSpeedMultiplier = 10; // Speed multiplier for time-based playback
        this.currentElapsedTime = 0; // Current elapsed time in playback (for seeking)
        this.isPlaying = false;
        this.markers = {};
        this.polylines = {};
        this.useMetric = true; // Unit preference
    }

    // Set unit preference (metric = km, imperial = mi)
    setUnitPreference(useMetric) {
        this.useMetric = useMetric;
    }

    // Initialize the map
    initMap(containerId) {
        if (this.map) {
            this.map.remove();
        }

        this.map = L.map(containerId).setView([32.7, -97.1], 13);

        // Dark themed map tiles
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 20
        }).addTo(this.map);

        return this.map;
    }

    // Parse GPX file content
    parseGPX(gpxContent, filename) {
        const parser = new DOMParser();
        const gpxDoc = parser.parseFromString(gpxContent, 'text/xml');
        
        const trackPoints = gpxDoc.querySelectorAll('trkpt');
        const trackName = gpxDoc.querySelector('trk > name')?.textContent || filename;
        
        const points = [];
        let totalDistance = 0;
        let prevPoint = null;

        trackPoints.forEach((pt, index) => {
            const lat = parseFloat(pt.getAttribute('lat'));
            const lon = parseFloat(pt.getAttribute('lon'));
            const ele = parseFloat(pt.querySelector('ele')?.textContent) || 0;
            const time = pt.querySelector('time')?.textContent;
            const speed = parseFloat(pt.querySelector('extensions > speed')?.textContent) || 0;
            
            // Try to get heart rate from various possible locations
            const hr = parseFloat(
                pt.querySelector('extensions > hr')?.textContent ||
                pt.querySelector('extensions > heartrate')?.textContent ||
                pt.querySelector('extensions > gpxtpx\\:hr')?.textContent ||
                pt.querySelector('hr')?.textContent
            ) || 0;

            const point = { lat, lon, ele, time: new Date(time), speed, hr, index };

            // Calculate distance from previous point
            if (prevPoint) {
                const dist = this.haversineDistance(prevPoint.lat, prevPoint.lon, lat, lon);
                totalDistance += dist;
                point.cumulativeDistance = totalDistance;
            } else {
                point.cumulativeDistance = 0;
            }

            points.push(point);
            prevPoint = point;
        });

        // Calculate duration
        const duration = points.length > 1 
            ? (points[points.length - 1].time - points[0].time) / 1000 / 60 
            : 0;

        // Calculate average pace
        const avgPace = totalDistance > 0 ? duration / totalDistance : 0;

        return {
            name: trackName,
            filename,
            points,
            totalDistance,
            duration,
            avgPace,
            startTime: points[0]?.time,
            endTime: points[points.length - 1]?.time,
            bounds: this.calculateBounds(points),
            centerPoint: this.calculateCenter(points)
        };
    }

    // Calculate haversine distance between two points (in km)
    haversineDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in km
        const dLat = this.toRad(lat2 - lat1);
        const dLon = this.toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    toRad(deg) {
        return deg * (Math.PI / 180);
    }

    // Calculate bounding box
    calculateBounds(points) {
        if (points.length === 0) return null;
        
        let minLat = Infinity, maxLat = -Infinity;
        let minLon = Infinity, maxLon = -Infinity;

        points.forEach(p => {
            minLat = Math.min(minLat, p.lat);
            maxLat = Math.max(maxLat, p.lat);
            minLon = Math.min(minLon, p.lon);
            maxLon = Math.max(maxLon, p.lon);
        });

        return [[minLat, minLon], [maxLat, maxLon]];
    }

    // Calculate center point
    calculateCenter(points) {
        if (points.length === 0) return null;
        
        const sumLat = points.reduce((sum, p) => sum + p.lat, 0);
        const sumLon = points.reduce((sum, p) => sum + p.lon, 0);
        
        return {
            lat: sumLat / points.length,
            lon: sumLon / points.length
        };
    }

    // Display a route on the map
    displayRoute(route, options = {}) {
        const {
            color = '#ff6b35',
            weight = 4,
            opacity = 0.9,
            id = 'main',
            showMarkers = true,
            fitBounds = true
        } = options;

        // Remove existing polyline with same id
        if (this.polylines[id]) {
            this.map.removeLayer(this.polylines[id]);
        }

        // Create path coordinates
        const latlngs = route.points.map(p => [p.lat, p.lon]);

        // Create gradient polyline based on speed
        const polyline = L.polyline(latlngs, {
            color,
            weight,
            opacity,
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(this.map);

        this.polylines[id] = polyline;

        // Add start/end markers
        if (showMarkers && route.points.length > 0) {
            // Remove existing markers
            if (this.markers[`${id}_start`]) {
                this.map.removeLayer(this.markers[`${id}_start`]);
            }
            if (this.markers[`${id}_end`]) {
                this.map.removeLayer(this.markers[`${id}_end`]);
            }

            const startIcon = L.divIcon({
                className: 'route-marker start-marker',
                html: '<div class="marker-dot" style="background: #22c55e;">▶</div>',
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            });

            const endIcon = L.divIcon({
                className: 'route-marker end-marker',
                html: '<div class="marker-dot" style="background: #ef4444;">◼</div>',
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            });

            const start = route.points[0];
            const end = route.points[route.points.length - 1];

            this.markers[`${id}_start`] = L.marker([start.lat, start.lon], { icon: startIcon })
                .addTo(this.map)
                .bindPopup(`<b>Start</b><br>${route.startTime?.toLocaleString()}`);

            this.markers[`${id}_end`] = L.marker([end.lat, end.lon], { icon: endIcon })
                .addTo(this.map)
                .bindPopup(`<b>Finish</b><br>${route.endTime?.toLocaleString()}<br>Distance: ${route.totalDistance.toFixed(2)} km`);
        }

        // Fit map to bounds
        if (fitBounds && route.bounds) {
            this.map.fitBounds(route.bounds, { padding: [50, 50] });
        }

        return polyline;
    }

    // Create animated runner marker
    createRunnerMarker(id = 'runner') {
        if (this.markers[id]) {
            this.map.removeLayer(this.markers[id]);
        }

        const runnerIcon = L.divIcon({
            className: 'runner-marker',
            html: '<div class="runner-dot">🏃</div>',
            iconSize: [40, 40],
            iconAnchor: [20, 20]
        });

        this.markers[id] = L.marker([0, 0], { 
            icon: runnerIcon,
            zIndexOffset: 1000 
        });

        return this.markers[id];
    }

    // Start playback (time-based like race mode)
    startPlayback(route, options = {}) {
        const {
            speedMultiplier = 10,
            onProgress = null,
            onComplete = null,
            startTime = null // Optional: start from specific elapsed time (for seeking)
        } = options;

        this.stopPlayback();
        this.currentRoute = route;
        this.currentSpeedMultiplier = speedMultiplier;
        
        // Get total duration in milliseconds
        const duration = route.points[route.points.length - 1].time - route.points[0].time;
        
        // Start from stored elapsed time if resuming, or from startTime if provided, or from 0
        let initialElapsedTime = startTime !== null ? startTime : (this.currentElapsedTime || 0);
        initialElapsedTime = Math.max(0, Math.min(initialElapsedTime, duration));
        
        this.playbackIndex = 0;
        this.isPlaying = true;

        // Create runner marker
        const runnerIcon = L.divIcon({
            className: 'runner-marker',
            html: `<div class="runner-dot" style="background: #ff6b35;">1</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });

        if (this.markers['runner']) this.map.removeLayer(this.markers['runner']);
        
        // Find initial position based on elapsed time
        let initialIdx = 0;
        for (let i = 0; i < route.points.length - 1; i++) {
            const pointTime = route.points[i].time - route.points[0].time;
            if (pointTime >= initialElapsedTime) {
                initialIdx = i;
                break;
            }
        }
        if (initialIdx === 0 && initialElapsedTime > 0) {
            initialIdx = route.points.length - 1;
        }
        
        this.markers['runner'] = L.marker([route.points[initialIdx].lat, route.points[initialIdx].lon], { 
            icon: runnerIcon, 
            zIndexOffset: 1000 
        }).addTo(this.map);

        // Create race widget for single runner
        this.createSingleRunnerWidget();

        // Track current position index
        let idx = initialIdx;
        let elapsedTime = initialElapsedTime;
        
        // Animation runs at 50ms intervals (20 fps) for smooth playback
        const animationInterval = 50;
        let runnerFinished = false;

        this.playbackInterval = setInterval(() => {
            // Read speed dynamically so it can be changed during playback
            const speedMultiplier = this.currentSpeedMultiplier || 10;
            elapsedTime += animationInterval * speedMultiplier;

            // Find position based on elapsed time
            while (idx < route.points.length - 1) {
                const pointTime = route.points[idx].time - route.points[0].time;
                if (pointTime >= elapsedTime) break;
                idx++;
            }

            const point = route.points[idx];
            this.markers['runner'].setLatLng([point.lat, point.lon]);

            // Store elapsed time for seeking
            this.currentElapsedTime = elapsedTime;
            this.playbackIndex = idx;

            // Update race widget
            this.updateSingleRunnerWidget(point, route, elapsedTime);

            // Check for finish
            if (!runnerFinished && idx >= route.points.length - 1) {
                runnerFinished = true;
            }

            const progress = Math.min((elapsedTime / duration) * 100, 100);

            if (onProgress) {
                onProgress({
                    index: idx,
                    total: route.points.length,
                    point,
                    elapsed: elapsedTime,
                    elapsedTime,
                    distance: point.cumulativeDistance,
                    progress,
                    speedMultiplier: this.currentSpeedMultiplier
                });
            }

            // Stop when finished
            if (runnerFinished) {
                this.stopPlayback();
                if (onComplete) onComplete();
            }
        }, animationInterval);
    }

    // Stop playback
    stopPlayback() {
        if (this.playbackInterval) {
            clearInterval(this.playbackInterval);
            this.playbackInterval = null;
        }
        this.isPlaying = false;
        // Keep elapsedTime for resume, but reset when starting fresh
        // Remove race widget when stopping
        this.removeRaceWidget();
    }

    // Pause/resume playback
    togglePlayback() {
        if (this.isPlaying) {
            this.stopPlayback();
        } else if (this.currentRoute) {
            const speedMultiplier = this.currentSpeedMultiplier || 10;
            // Resume from stored elapsed time
            this.startPlayback(this.currentRoute, { 
                speedMultiplier,
                startTime: this.currentElapsedTime || 0
            });
        }
    }

    // Set playback position (by percentage 0-100)
    setPlaybackPosition(percent) {
        if (!this.currentRoute) return;
        
        const duration = this.currentRoute.points[this.currentRoute.points.length - 1].time - 
                        this.currentRoute.points[0].time;
        const targetElapsedTime = (percent / 100) * duration;
        
        // Find index for this elapsed time
        let targetIdx = 0;
        for (let i = 0; i < this.currentRoute.points.length - 1; i++) {
            const pointTime = this.currentRoute.points[i].time - this.currentRoute.points[0].time;
            if (pointTime >= targetElapsedTime) {
                targetIdx = i;
                break;
            }
        }
        if (targetIdx === 0 && targetElapsedTime > 0) {
            targetIdx = this.currentRoute.points.length - 1;
        }
        
        this.playbackIndex = targetIdx;
        this.currentElapsedTime = targetElapsedTime;
        
        // Update marker position
        if (this.markers['runner']) {
            const point = this.currentRoute.points[targetIdx];
            this.markers['runner'].setLatLng([point.lat, point.lon]);
            
            // Update widget if exists
            this.updateSingleRunnerWidget(point, this.currentRoute, targetElapsedTime);
        }
    }

    // Calculate route similarity (returns 0-1, higher is more similar)
    calculateSimilarity(route1, route2) {
        // Compare center points distance
        const centerDist = this.haversineDistance(
            route1.centerPoint.lat, route1.centerPoint.lon,
            route2.centerPoint.lat, route2.centerPoint.lon
        );

        // If centers are more than 2km apart, routes are probably different
        if (centerDist > 2) return 0;

        // Compare bounding box overlap
        const overlap = this.calculateBoundsOverlap(route1.bounds, route2.bounds);
        
        // Compare total distance similarity
        const distRatio = Math.min(route1.totalDistance, route2.totalDistance) / 
                         Math.max(route1.totalDistance, route2.totalDistance);

        // Combined similarity score
        return (overlap * 0.5 + distRatio * 0.3 + Math.max(0, 1 - centerDist / 2) * 0.2);
    }

    // Calculate bounding box overlap
    calculateBoundsOverlap(bounds1, bounds2) {
        if (!bounds1 || !bounds2) return 0;

        const [[minLat1, minLon1], [maxLat1, maxLon1]] = bounds1;
        const [[minLat2, minLon2], [maxLat2, maxLon2]] = bounds2;

        const overlapLat = Math.max(0, Math.min(maxLat1, maxLat2) - Math.max(minLat1, minLat2));
        const overlapLon = Math.max(0, Math.min(maxLon1, maxLon2) - Math.max(minLon1, minLon2));

        const area1 = (maxLat1 - minLat1) * (maxLon1 - minLon1);
        const area2 = (maxLat2 - minLat2) * (maxLon2 - minLon2);
        const overlapArea = overlapLat * overlapLon;

        return overlapArea / Math.min(area1, area2);
    }

    // Find similar routes
    findSimilarRoutes(targetRoute, allRoutes, threshold = 0.5) {
        return allRoutes
            .filter(r => r.filename !== targetRoute.filename)
            .map(r => ({
                route: r,
                similarity: this.calculateSimilarity(targetRoute, r)
            }))
            .filter(r => r.similarity >= threshold)
            .sort((a, b) => b.similarity - a.similarity);
    }

    // Compare two routes side by side
    compareRoutes(route1, route2) {
        // Display both routes
        this.displayRoute(route1, { color: '#ff6b35', id: 'route1', weight: 5 });
        this.displayRoute(route2, { color: '#3b82f6', id: 'route2', weight: 5, showMarkers: false });

        // Create combined bounds
        const allPoints = [...route1.points, ...route2.points];
        const combinedBounds = this.calculateBounds(allPoints);
        this.map.fitBounds(combinedBounds, { padding: [50, 50] });

        // Return comparison stats
        return {
            route1: {
                name: route1.name,
                distance: route1.totalDistance,
                duration: route1.duration,
                pace: route1.avgPace
            },
            route2: {
                name: route2.name,
                distance: route2.totalDistance,
                duration: route2.duration,
                pace: route2.avgPace
            },
            distanceDiff: route1.totalDistance - route2.totalDistance,
            durationDiff: route1.duration - route2.duration,
            paceDiff: route1.avgPace - route2.avgPace
        };
    }

    // Compare two routes with overlay (align start points)
    compareRoutesOverlay(route1, route2) {
        // Clear existing
        this.clearMap();

        // Display route1 at its original position
        this.displayRoute(route1, { color: '#ff6b35', id: 'route1', weight: 5, fitBounds: false });

        // Calculate initial offset to align route2's start to route1's start
        const start1 = route1.points[0];
        const start2 = route2.points[0];
        this.overlayOffset = {
            lat: start1.lat - start2.lat,
            lon: start1.lon - start2.lon
        };

        // Store route2 for later use
        this.overlayRoute2 = route2;

        // Display the overlay route
        this.updateOverlayRoute(route2);

        // Fit bounds to route1 (both routes now overlap here)
        this.map.fitBounds(route1.bounds, { padding: [50, 50] });

        // Return comparison stats (same as regular compare)
        return {
            route1: {
                name: route1.name,
                distance: route1.totalDistance,
                duration: route1.duration,
                pace: route1.avgPace
            },
            route2: {
                name: route2.name,
                distance: route2.totalDistance,
                duration: route2.duration,
                pace: route2.avgPace
            },
            distanceDiff: route1.totalDistance - route2.totalDistance,
            durationDiff: route1.duration - route2.duration,
            paceDiff: route1.avgPace - route2.avgPace
        };
    }

    // Update overlay route position
    updateOverlayRoute(route2) {
        // Create offset route2 points
        const offsetPoints = route2.points.map(p => ({
            ...p,
            lat: p.lat + this.overlayOffset.lat,
            lon: p.lon + this.overlayOffset.lon
        }));

        // Display offset route2
        const latlngs = offsetPoints.map(p => [p.lat, p.lon]);
        
        if (this.polylines['route2']) {
            this.map.removeLayer(this.polylines['route2']);
        }

        const polyline = L.polyline(latlngs, {
            color: '#3b82f6',
            weight: 5,
            opacity: 0.9,
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(this.map);

        this.polylines['route2'] = polyline;

        // Remove old markers
        if (this.markers['route2_end']) {
            this.map.removeLayer(this.markers['route2_end']);
        }
        if (this.markers['route2_drag']) {
            this.map.removeLayer(this.markers['route2_drag']);
        }

        // Add draggable handle at start of route2
        const start2Offset = offsetPoints[0];
        const dragIcon = L.divIcon({
            className: 'route-marker drag-marker',
            html: '<div class="marker-dot" style="background: #3b82f6; cursor: grab;">✥</div>',
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });

        const dragMarker = L.marker([start2Offset.lat, start2Offset.lon], { 
            icon: dragIcon,
            draggable: true,
            zIndexOffset: 1000
        }).addTo(this.map);

        dragMarker.bindTooltip('Drag to reposition Route 2', { permanent: false, direction: 'top' });

        // Handle drag events
        dragMarker.on('drag', (e) => {
            const newPos = e.target.getLatLng();
            const originalStart = route2.points[0];
            this.overlayOffset = {
                lat: newPos.lat - originalStart.lat,
                lon: newPos.lng - originalStart.lon
            };
            
            // Update polyline position
            const newLatlngs = route2.points.map(p => [
                p.lat + this.overlayOffset.lat, 
                p.lon + this.overlayOffset.lon
            ]);
            this.polylines['route2'].setLatLngs(newLatlngs);

            // Update end marker position
            if (this.markers['route2_end']) {
                const end = route2.points[route2.points.length - 1];
                this.markers['route2_end'].setLatLng([
                    end.lat + this.overlayOffset.lat,
                    end.lon + this.overlayOffset.lon
                ]);
            }
        });

        this.markers['route2_drag'] = dragMarker;

        // Add end marker for route2 (offset position)
        const end2 = offsetPoints[offsetPoints.length - 1];
        const endIcon = L.divIcon({
            className: 'route-marker end-marker',
            html: '<div class="marker-dot" style="background: #3b82f6;">◼</div>',
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });

        this.markers['route2_end'] = L.marker([end2.lat, end2.lon], { icon: endIcon })
            .addTo(this.map)
            .bindPopup(`<b>Route 2 Finish</b><br>Distance: ${route2.totalDistance.toFixed(2)} km`);
    }

    // Get current overlay offset
    getOverlayOffset() {
        return this.overlayOffset || { lat: 0, lon: 0 };
    }

    // Get stats from a point (HR if available, otherwise pace from speed)
    getPointStats(point, route = null, elapsedMs = 0) {
        // Check for heart rate in the point data first
        if (point.hr && point.hr > 0) {
            return { type: 'hr', value: Math.round(point.hr), unit: 'bpm' };
        }
        
        // Try to get HR from linked workout
        if (route) {
            const hr = this.getHeartRateAtTime(route, elapsedMs);
            if (hr && hr > 0) {
                return { type: 'hr', value: Math.round(hr), unit: 'bpm' };
            }
        }
        
        // Fall back to pace from speed (speed is in m/s)
        if (point.speed && point.speed > 0) {
            // Convert m/s to min/km
            const paceMinPerKm = (1000 / point.speed) / 60;
            if (paceMinPerKm < 20) { // Reasonable pace (< 20 min/km)
                return { type: 'pace', value: this.formatPace(paceMinPerKm), unit: '/km' };
            }
        }
        
        return { type: 'none', value: '--', unit: '' };
    }

    // Create race stats widget on the map
    createRaceWidget() {
        // Remove existing widget
        this.removeRaceWidget();
        
        const paceUnit = this.useMetric ? '/km' : '/mi';
        const widget = L.control({ position: 'topright' });
        widget.onAdd = () => {
            const div = L.DomUtil.create('div', 'race-stats-widget');
            div.innerHTML = `
                <div class="race-widget-runner" style="border-color: #ff6b35;">
                    <div class="race-widget-header">
                        <span class="race-widget-marker" style="background: #ff6b35;">1</span>
                        <span class="race-widget-label">Runner 1</span>
                    </div>
                    <div class="race-widget-stats">
                        <div class="race-widget-stat">
                            <span class="race-widget-icon">⚡</span>
                            <span id="raceWidget1Pace">--:--</span>
                            <span class="race-widget-unit" id="raceWidget1PaceUnit">${paceUnit}</span>
                        </div>
                        <div class="race-widget-stat">
                            <span class="race-widget-icon">❤️</span>
                            <span id="raceWidget1HR">--</span>
                            <span class="race-widget-unit">bpm</span>
                        </div>
                    </div>
                </div>
                <div class="race-widget-runner" style="border-color: #3b82f6;">
                    <div class="race-widget-header">
                        <span class="race-widget-marker" style="background: #3b82f6;">2</span>
                        <span class="race-widget-label">Runner 2</span>
                    </div>
                    <div class="race-widget-stats">
                        <div class="race-widget-stat">
                            <span class="race-widget-icon">⚡</span>
                            <span id="raceWidget2Pace">--:--</span>
                            <span class="race-widget-unit" id="raceWidget2PaceUnit">${paceUnit}</span>
                        </div>
                        <div class="race-widget-stat">
                            <span class="race-widget-icon">❤️</span>
                            <span id="raceWidget2HR">--</span>
                            <span class="race-widget-unit">bpm</span>
                        </div>
                    </div>
                </div>
            `;
            return div;
        };
        widget.addTo(this.map);
        this.raceWidget = widget;
    }

    // Remove race stats widget
    removeRaceWidget() {
        if (this.raceWidget) {
            this.map.removeControl(this.raceWidget);
            this.raceWidget = null;
        }
    }

    // Update race widget stats
    updateRaceWidget(runner1Stats, runner2Stats, route1, route2, elapsedTime) {
        // Get pace from speed for each runner
        const pace1 = this.getPaceFromPoint(runner1Stats.point);
        const pace2 = this.getPaceFromPoint(runner2Stats.point);
        
        // Get HR for each runner
        const hr1 = this.getHeartRateAtTime(route1, elapsedTime);
        const hr2 = this.getHeartRateAtTime(route2, elapsedTime);
        
        // Update widget
        const pace1El = document.getElementById('raceWidget1Pace');
        const hr1El = document.getElementById('raceWidget1HR');
        const pace2El = document.getElementById('raceWidget2Pace');
        const hr2El = document.getElementById('raceWidget2HR');
        
        if (pace1El) pace1El.textContent = pace1 || '--:--';
        if (hr1El) hr1El.textContent = hr1 ? Math.round(hr1) : '--';
        if (pace2El) pace2El.textContent = pace2 || '--:--';
        if (hr2El) hr2El.textContent = hr2 ? Math.round(hr2) : '--';
    }

    // Create single runner widget for playback
    createSingleRunnerWidget() {
        this.removeRaceWidget();
        
        const paceUnit = this.useMetric ? '/km' : '/mi';
        const widget = L.control({ position: 'topright' });
        widget.onAdd = () => {
            const div = L.DomUtil.create('div', 'race-stats-widget');
            div.innerHTML = `
                <div class="race-widget-runner" style="border-color: #ff6b35;">
                    <div class="race-widget-header">
                        <span class="race-widget-marker" style="background: #ff6b35;">1</span>
                        <span class="race-widget-label">Runner</span>
                    </div>
                    <div class="race-widget-stats">
                        <div class="race-widget-stat">
                            <span class="race-widget-icon">⚡</span>
                            <span id="singleRunnerPace">--:--</span>
                            <span class="race-widget-unit" id="singleRunnerPaceUnit">${paceUnit}</span>
                        </div>
                        <div class="race-widget-stat">
                            <span class="race-widget-icon">❤️</span>
                            <span id="singleRunnerHR">--</span>
                            <span class="race-widget-unit">bpm</span>
                        </div>
                    </div>
                </div>
            `;
            return div;
        };
        widget.addTo(this.map);
        this.raceWidget = widget;
    }

    // Update single runner widget stats
    updateSingleRunnerWidget(point, route, elapsedTime) {
        const pace = this.getPaceFromPoint(point);
        const hr = this.getHeartRateAtTime(route, elapsedTime);
        
        const paceEl = document.getElementById('singleRunnerPace');
        const hrEl = document.getElementById('singleRunnerHR');
        
        if (paceEl) paceEl.textContent = pace || '--:--';
        if (hrEl) hrEl.textContent = hr ? Math.round(hr) : '--';
    }

    // Get formatted pace from a track point
    getPaceFromPoint(point) {
        if (point && point.speed && point.speed > 0) {
            let paceMinPerKm = (1000 / point.speed) / 60;
            // Convert to min/mile if using imperial
            if (!this.useMetric) {
                paceMinPerKm = paceMinPerKm * 1.60934;
            }
            if (paceMinPerKm < 20) {
                return this.formatPace(paceMinPerKm);
            }
        }
        return null;
    }

    // Link route to workout data for heart rate
    linkRouteToWorkout(route, workouts) {
        if (!route.startTime || !workouts || workouts.length === 0) return null;

        const routeStart = route.startTime.getTime();
        
        // Find workout that matches this route's start time (within 5 minutes)
        const matchingWorkout = workouts.find(w => {
            const workoutStart = (w.dateObj || new Date(w.date)).getTime();
            const timeDiff = Math.abs(routeStart - workoutStart);
            return timeDiff < 5 * 60 * 1000; // 5 minutes tolerance
        });

        if (matchingWorkout) {
            // Copy HR data directly to route (for persistence)
            route.heartRateAvg = matchingWorkout.heartRateAvg;
            route.heartRateMin = matchingWorkout.heartRateMin;
            route.heartRateMax = matchingWorkout.heartRateMax;
            
            // Copy detailed HR samples if available (for instantaneous HR during playback)
            if (matchingWorkout.heartRateData && matchingWorkout.heartRateData.length > 0) {
                route.heartRateData = matchingWorkout.heartRateData;
                console.log(`Linked ${route.heartRateData.length} HR samples to route ${route.name}`);
            }
            
            // Store reference for other uses
            route.linkedWorkoutId = matchingWorkout.id;
        }

        return matchingWorkout;
    }

    // Interpolate heart rate for a specific point in time
    getHeartRateAtTime(route, elapsedMs) {
        // Check for detailed HR data on the route itself
        if (route.heartRateData && route.heartRateData.length > 0) {
            // Find the closest HR data point
            const targetTime = route.startTime.getTime() + elapsedMs;
            let closest = route.heartRateData[0];
            let closestDiff = Infinity;
            
            for (const hrPoint of route.heartRateData) {
                const diff = Math.abs(hrPoint.time - targetTime);
                if (diff < closestDiff) {
                    closestDiff = diff;
                    closest = hrPoint;
                }
            }
            return closest.value;
        }
        
        // Fall back to average HR if no detailed data
        return route.heartRateAvg || null;
    }

    // Set playback speed (can be called during playback)
    setPlaybackSpeed(speed) {
        this.currentSpeedMultiplier = speed;
    }

    // Animated dual playback for comparison (time-based racing)
    startComparisonPlayback(route1, route2, options = {}) {
        const { speedMultiplier = 10, onProgress = null, onComplete = null, useOverlay = false } = options;

        this.stopPlayback();
        this.isPlaying = true;
        this.currentSpeedMultiplier = speedMultiplier; // Store as instance property

        // Get overlay offset if in overlay mode
        const offset = useOverlay ? this.getOverlayOffset() : { lat: 0, lon: 0 };

        // Create simple runner markers (just numbers)
        const runner1Icon = L.divIcon({
            className: 'runner-marker',
            html: `<div class="runner-dot" style="background: #ff6b35;">1</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });

        const runner2Icon = L.divIcon({
            className: 'runner-marker',
            html: `<div class="runner-dot" style="background: #3b82f6;">2</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });

        if (this.markers['runner1']) this.map.removeLayer(this.markers['runner1']);
        if (this.markers['runner2']) this.map.removeLayer(this.markers['runner2']);

        // Position runner2 with offset if in overlay mode
        const start2Lat = route2.points[0].lat + offset.lat;
        const start2Lon = route2.points[0].lon + offset.lon;

        this.markers['runner1'] = L.marker([route1.points[0].lat, route1.points[0].lon], { icon: runner1Icon, zIndexOffset: 1000 }).addTo(this.map);
        this.markers['runner2'] = L.marker([start2Lat, start2Lon], { icon: runner2Icon, zIndexOffset: 1000 }).addTo(this.map);

        // Create race stats widget
        this.createRaceWidget();

        // Get total duration of each route in milliseconds
        const duration1 = route1.points[route1.points.length - 1].time - route1.points[0].time;
        const duration2 = route2.points[route2.points.length - 1].time - route2.points[0].time;
        const maxDuration = Math.max(duration1, duration2);

        // Track current position indices
        let idx1 = 0;
        let idx2 = 0;
        let elapsedTime = 0;
        
        // Animation runs at 50ms intervals (20 fps) for smooth playback
        const animationInterval = 50;

        // Track finish states
        let runner1Finished = false;
        let runner2Finished = false;

        this.playbackInterval = setInterval(() => {
            // Read speed dynamically so it can be changed during playback
            const timeStepPerTick = animationInterval * this.currentSpeedMultiplier;
            elapsedTime += timeStepPerTick;

            // Find position for runner 1 based on elapsed time
            while (idx1 < route1.points.length - 1) {
                const pointTime = route1.points[idx1].time - route1.points[0].time;
                if (pointTime >= elapsedTime) break;
                idx1++;
            }

            // Find position for runner 2 based on elapsed time
            while (idx2 < route2.points.length - 1) {
                const pointTime = route2.points[idx2].time - route2.points[0].time;
                if (pointTime >= elapsedTime) break;
                idx2++;
            }

            const p1 = route1.points[idx1];
            const p2 = route2.points[idx2];

            // Apply offset to runner2 if in overlay mode
            const p2Lat = p2.lat + offset.lat;
            const p2Lon = p2.lon + offset.lon;

            this.markers['runner1'].setLatLng([p1.lat, p1.lon]);
            this.markers['runner2'].setLatLng([p2Lat, p2Lon]);

            // Update race widget with pace and HR data
            this.updateRaceWidget(
                { point: p1 }, 
                { point: p2 }, 
                route1, 
                route2, 
                elapsedTime
            );

            // Check for finishes
            if (!runner1Finished && idx1 >= route1.points.length - 1) {
                runner1Finished = true;
            }
            if (!runner2Finished && idx2 >= route2.points.length - 1) {
                runner2Finished = true;
            }

            const progress = Math.min((elapsedTime / maxDuration) * 100, 100);

            if (onProgress) {
                onProgress({
                    elapsedTime,
                    maxDuration,
                    speedMultiplier: this.currentSpeedMultiplier,
                    runner1: { 
                        point: p1, 
                        distance: p1.cumulativeDistance,
                        finished: runner1Finished,
                        finishTime: duration1
                    },
                    runner2: { 
                        point: p2, 
                        distance: p2.cumulativeDistance,
                        finished: runner2Finished,
                        finishTime: duration2
                    },
                    progress
                });
            }

            // Stop when both have finished
            if (runner1Finished && runner2Finished) {
                this.stopPlayback();
                if (onComplete) onComplete();
            }
        }, animationInterval);
    }

    // Clear map
    clearMap() {
        Object.values(this.polylines).forEach(p => this.map.removeLayer(p));
        Object.values(this.markers).forEach(m => this.map.removeLayer(m));
        this.polylines = {};
        this.markers = {};
    }

    // Format pace as MM:SS
    formatPace(minPerKm) {
        if (!minPerKm || minPerKm === Infinity) return '--:--';
        const mins = Math.floor(minPerKm);
        const secs = Math.round((minPerKm - mins) * 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // Format duration
    formatDuration(minutes) {
        const hrs = Math.floor(minutes / 60);
        const mins = Math.floor(minutes % 60);
        const secs = Math.round((minutes % 1) * 60);
        if (hrs > 0) {
            return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
}

// Create global routes manager instance
const routesManager = new RoutesManager();

