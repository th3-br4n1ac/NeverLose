/**
 * Chart Manager
 * Creates and updates all charts in the application
 */

class ChartManager {
    constructor() {
        this.charts = {};
        this.defaultOptions = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false,
                    labels: {
                        color: '#a0a0b0',
                        font: { family: 'Outfit' }
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: '#606070' },
                    grid: { color: 'rgba(42, 42, 58, 0.5)' }
                },
                y: {
                    ticks: { color: '#606070' },
                    grid: { color: 'rgba(42, 42, 58, 0.5)' }
                }
            }
        };
    }

    // Destroy existing chart if it exists
    destroyChart(id) {
        if (this.charts[id]) {
            this.charts[id].destroy();
            delete this.charts[id];
        }
    }

    // Create weekly mileage bar chart
    createWeeklyMileageChart(canvasId, workouts, useMetric = true) {
        this.destroyChart(canvasId);
        
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        // Get last 12 weeks of data
        const weeklyData = this.aggregateByWeek(workouts, 12);
        const unit = useMetric ? 'km' : 'mi';
        
        this.charts[canvasId] = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: weeklyData.labels,
                datasets: [{
                    label: `Distance (${unit})`,
                    data: weeklyData.distances.map(d => useMetric ? d : d / 1.60934),
                    backgroundColor: 'rgba(255, 107, 53, 0.7)',
                    borderColor: '#ff6b35',
                    borderWidth: 1,
                    borderRadius: 6
                }]
            },
            options: {
                ...this.defaultOptions,
                plugins: {
                    ...this.defaultOptions.plugins,
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.parsed.y.toFixed(1)} ${unit}`
                        }
                    }
                }
            }
        });
    }

    // Create distance over time line chart
    createDistanceChart(canvasId, workouts, useMetric = true) {
        this.destroyChart(canvasId);
        
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        // Aggregate by month
        const monthlyData = this.aggregateByMonth(workouts);
        const unit = useMetric ? 'km' : 'mi';
        
        this.charts[canvasId] = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: monthlyData.labels,
                datasets: [{
                    label: `Distance (${unit})`,
                    data: monthlyData.distances.map(d => useMetric ? d : d / 1.60934),
                    borderColor: '#ff6b35',
                    backgroundColor: 'rgba(255, 107, 53, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointBackgroundColor: '#ff6b35',
                    pointRadius: 4
                }]
            },
            options: {
                ...this.defaultOptions,
                plugins: {
                    ...this.defaultOptions.plugins,
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.parsed.y.toFixed(1)} ${unit}`
                        }
                    }
                }
            }
        });
    }

    // Create pace progression chart
    createPaceChart(canvasId, workouts, useMetric = true) {
        this.destroyChart(canvasId);
        
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        // Get workouts sorted by date with valid pace
        const paceData = workouts
            .filter(w => w.pace && w.pace > 0 && w.pace < 20)
            .sort((a, b) => new Date(a.date) - new Date(b.date))
            .slice(-50); // Last 50 workouts

        const labels = paceData.map(w => {
            const d = new Date(w.date);
            return `${d.getMonth() + 1}/${d.getDate()}`;
        });

        const paces = paceData.map(w => useMetric ? w.pace : w.pace * 1.60934);
        
        this.charts[canvasId] = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Pace',
                    data: paces,
                    borderColor: '#22c55e',
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 3
                }]
            },
            options: {
                ...this.defaultOptions,
                scales: {
                    ...this.defaultOptions.scales,
                    y: {
                        ...this.defaultOptions.scales.y,
                        reverse: true, // Lower pace is better
                        ticks: {
                            color: '#606070',
                            callback: (val) => this.formatPace(val)
                        }
                    }
                },
                plugins: {
                    ...this.defaultOptions.plugins,
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `Pace: ${this.formatPace(ctx.parsed.y)} /${useMetric ? 'km' : 'mi'}`
                        }
                    }
                }
            }
        });
    }

    // Create heart rate zones chart
    createHRZonesChart(canvasId, workouts, maxHR = 190) {
        this.destroyChart(canvasId);
        
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        // Calculate zone distribution based on average HR
        const zones = this.calculateHRZones(workouts, maxHR);
        
        this.charts[canvasId] = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Zone 1', 'Zone 2', 'Zone 3', 'Zone 4', 'Zone 5'],
                datasets: [{
                    data: zones,
                    backgroundColor: [
                        'rgba(96, 165, 250, 0.8)',
                        'rgba(34, 197, 94, 0.8)',
                        'rgba(234, 179, 8, 0.8)',
                        'rgba(249, 115, 22, 0.8)',
                        'rgba(239, 68, 68, 0.8)'
                    ],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'right',
                        labels: {
                            color: '#a0a0b0',
                            padding: 12,
                            font: { family: 'Outfit', size: 11 }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.label}: ${ctx.parsed} workouts`
                        }
                    }
                }
            }
        });
    }

    // Create training volume chart
    createVolumeChart(canvasId, workouts) {
        this.destroyChart(canvasId);
        
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const weeklyData = this.aggregateByWeek(workouts, 12);
        
        this.charts[canvasId] = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: weeklyData.labels,
                datasets: [
                    {
                        label: 'Duration (min)',
                        data: weeklyData.durations,
                        backgroundColor: 'rgba(59, 130, 246, 0.7)',
                        borderColor: '#3b82f6',
                        borderWidth: 1,
                        borderRadius: 6,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Runs',
                        data: weeklyData.counts,
                        type: 'line',
                        borderColor: '#f7931e',
                        backgroundColor: 'transparent',
                        pointBackgroundColor: '#f7931e',
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                ...this.defaultOptions,
                plugins: {
                    legend: {
                        display: true,
                        labels: { color: '#a0a0b0' }
                    }
                },
                scales: {
                    x: this.defaultOptions.scales.x,
                    y: {
                        type: 'linear',
                        position: 'left',
                        ticks: { color: '#606070' },
                        grid: { color: 'rgba(42, 42, 58, 0.5)' }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        ticks: { color: '#606070' },
                        grid: { display: false }
                    }
                }
            }
        });
    }

    // Create day of week distribution chart
    createDayDistributionChart(canvasId, workouts) {
        this.destroyChart(canvasId);
        
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dayCounts = [0, 0, 0, 0, 0, 0, 0];
        
        workouts.forEach(w => {
            if (w.dateObj || w.date) {
                const d = w.dateObj || new Date(w.date);
                dayCounts[d.getDay()]++;
            }
        });
        
        this.charts[canvasId] = new Chart(canvas.getContext('2d'), {
            type: 'polarArea',
            data: {
                labels: days,
                datasets: [{
                    data: dayCounts,
                    backgroundColor: [
                        'rgba(239, 68, 68, 0.6)',
                        'rgba(249, 115, 22, 0.6)',
                        'rgba(234, 179, 8, 0.6)',
                        'rgba(34, 197, 94, 0.6)',
                        'rgba(59, 130, 246, 0.6)',
                        'rgba(168, 85, 247, 0.6)',
                        'rgba(236, 72, 153, 0.6)'
                    ]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'right',
                        labels: { color: '#a0a0b0' }
                    }
                },
                scales: {
                    r: {
                        ticks: { color: '#606070' },
                        grid: { color: 'rgba(42, 42, 58, 0.5)' }
                    }
                }
            }
        });
    }

    // Helper: Aggregate workouts by week
    aggregateByWeek(workouts, numWeeks = 12) {
        const now = new Date();
        const labels = [];
        const distances = [];
        const durations = [];
        const counts = [];

        for (let i = numWeeks - 1; i >= 0; i--) {
            const weekStart = new Date(now);
            weekStart.setDate(weekStart.getDate() - weekStart.getDay() - (i * 7));
            weekStart.setHours(0, 0, 0, 0);
            
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekEnd.getDate() + 7);

            const weekWorkouts = workouts.filter(w => {
                const d = w.dateObj || new Date(w.date);
                return d >= weekStart && d < weekEnd;
            });

            labels.push(`${weekStart.getMonth() + 1}/${weekStart.getDate()}`);
            distances.push(weekWorkouts.reduce((sum, w) => sum + (w.distanceKm || 0), 0));
            durations.push(weekWorkouts.reduce((sum, w) => sum + (w.duration || 0), 0));
            counts.push(weekWorkouts.length);
        }

        return { labels, distances, durations, counts };
    }

    // Helper: Aggregate workouts by month
    aggregateByMonth(workouts) {
        const monthMap = new Map();
        
        workouts.forEach(w => {
            const d = w.dateObj || new Date(w.date);
            const key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
            
            if (!monthMap.has(key)) {
                monthMap.set(key, { distance: 0, duration: 0, count: 0 });
            }
            
            const data = monthMap.get(key);
            data.distance += w.distanceKm || 0;
            data.duration += w.duration || 0;
            data.count++;
        });

        const sortedKeys = Array.from(monthMap.keys()).sort();
        const labels = sortedKeys.map(k => {
            const [year, month] = k.split('-');
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                              'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            return `${monthNames[parseInt(month) - 1]} ${year.slice(2)}`;
        });
        
        const distances = sortedKeys.map(k => monthMap.get(k).distance);
        const durations = sortedKeys.map(k => monthMap.get(k).duration);

        return { labels, distances, durations };
    }

    // Helper: Calculate HR zones distribution
    calculateHRZones(workouts, maxHR) {
        const zones = [0, 0, 0, 0, 0];
        const thresholds = [0.5, 0.6, 0.7, 0.8, 0.9]; // Zone boundaries as % of max

        workouts.forEach(w => {
            if (w.heartRateAvg) {
                const hrPercent = w.heartRateAvg / maxHR;
                if (hrPercent < thresholds[1]) zones[0]++;
                else if (hrPercent < thresholds[2]) zones[1]++;
                else if (hrPercent < thresholds[3]) zones[2]++;
                else if (hrPercent < thresholds[4]) zones[3]++;
                else zones[4]++;
            }
        });

        return zones;
    }

    // Helper: Format pace as MM:SS
    formatPace(minPerUnit) {
        if (!minPerUnit || minPerUnit === Infinity) return '--:--';
        const mins = Math.floor(minPerUnit);
        const secs = Math.round((minPerUnit - mins) * 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // Update all charts
    updateAllCharts(workouts, useMetric = true, maxHR = 190) {
        this.createWeeklyMileageChart('weeklyMileageChart', workouts, useMetric);
        this.createDistanceChart('distanceChart', workouts, useMetric);
        this.createPaceChart('paceChart', workouts, useMetric);
        this.createHRZonesChart('hrZonesChart', workouts, maxHR);
        this.createVolumeChart('volumeChart', workouts);
        this.createDayDistributionChart('dayDistributionChart', workouts);
    }

    // Create comparison chart with overlayed data for selected metric
    createComparisonChart(canvasId, workouts, metric, useMetric = true, maxHR = 190) {
        this.destroyChart(canvasId);
        
        switch(metric) {
            case 'heartrate':
                this.createComparisonHRChart(canvasId, workouts, useMetric, maxHR);
                break;
            case 'pace':
                this.createComparisonPaceChart(canvasId, workouts, useMetric);
                break;
            case 'cadence':
                this.createComparisonCadenceChart(canvasId, workouts);
                break;
            case 'stride':
                this.createComparisonStrideChart(canvasId, workouts, useMetric);
                break;
        }
    }

    // Helper: Normalize workout data by actual distance (in km or miles)
    normalizeByDistance(workout, dataField, useMetric = true) {
        const data = workout[dataField];
        if (!data || !Array.isArray(data) || data.length === 0) return null;
        
        const totalDistanceKm = workout.distanceKm || 0;
        if (totalDistanceKm === 0) return null;

        const totalDistance = useMetric ? totalDistanceKm : totalDistanceKm / 1.60934;
        const workoutStartTime = workout.dateObj ? workout.dateObj.getTime() : new Date(workout.date).getTime();
        const workoutDuration = workout.duration ? workout.duration * 60 * 1000 : 0; // duration in minutes, convert to ms
        
        let normalized = [];

        // Check if data points have timestamps
        const hasTimestamps = data.length > 0 && typeof data[0] === 'object' && data[0].time !== undefined;
        
        if (hasTimestamps && workoutDuration > 0) {
            // Find min and max timestamps to handle relative timestamps
            let minTime = Infinity;
            let maxTime = -Infinity;
            data.forEach(point => {
                const t = point.time;
                if (t < minTime) minTime = t;
                if (t > maxTime) maxTime = t;
            });
            
            // Calculate actual time span
            const timeSpan = maxTime - minTime;
            
            // Use time span if it's reasonable (within 2x of workout duration), otherwise use workout duration
            const effectiveDuration = (timeSpan > 0 && timeSpan < workoutDuration * 2) ? timeSpan : workoutDuration;
            
            // Data is time-based, map to distance using elapsed time proportion
            data.forEach((point) => {
                const timestamp = point.time;
                // Try absolute time first, fallback to relative
                let elapsedMs = timestamp - workoutStartTime;
                
                // If elapsed time seems wrong (negative or way too large), use relative time from first point
                if (elapsedMs < 0 || elapsedMs > workoutDuration * 3) {
                    elapsedMs = timestamp - minTime;
                }
                
                const timePercent = effectiveDuration > 0 ? elapsedMs / effectiveDuration : 0;
                
                // Convert time percentage to actual distance
                const distance = Math.max(0, Math.min(totalDistance, timePercent * totalDistance));
                const value = point.value !== undefined ? point.value : point;
                normalized.push({ x: distance, y: value });
            });
        } else {
            // Fallback: assume uniform distribution across distance
            const step = totalDistance / data.length;
            data.forEach((point, idx) => {
                const value = typeof point === 'object' ? (point.value !== undefined ? point.value : point) : point;
                // Distribute evenly across distance
                const distance = idx < data.length - 1 ? idx * step + (step / 2) : totalDistance - (step / 2);
                normalized.push({ x: distance, y: value });
            });
        }

        // Sort by x (distance) to ensure proper line drawing
        normalized.sort((a, b) => a.x - b.x);
        
        // Ensure we have points at 0 and total distance for better visualization
        if (normalized.length > 0) {
            if (normalized[0].x > 0.01) {
                normalized.unshift({ x: 0, y: normalized[0].y });
            }
            const lastX = normalized[normalized.length - 1].x;
            if (lastX < totalDistance - 0.01) {
                normalized.push({ x: totalDistance, y: normalized[normalized.length - 1].y });
            }
        }

        return normalized.length > 0 ? normalized : null;
    }

    // Create comparison HR chart
    createComparisonHRChart(canvasId, workouts, useMetric, maxHR) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const colors = ['#ff6b35', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7'];
        const datasets = [];

        workouts.forEach((workout, index) => {
            const hrData = this.normalizeByDistance(workout, 'heartRateData', useMetric);
            if (hrData && hrData.length > 0) {
                const d = workout.dateObj || new Date(workout.date);
                const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                const distanceKm = workout.distanceKm || 0;
                const distance = useMetric ? distanceKm : distanceKm / 1.60934;
                const unit = useMetric ? 'km' : 'mi';
                
                datasets.push({
                    label: `${dateStr} - ${distance.toFixed(1)}${unit}`,
                    data: hrData,
                    borderColor: colors[index % colors.length],
                    backgroundColor: colors[index % colors.length] + '20',
                    fill: false,
                    tension: 0.3,
                    pointRadius: 0,
                    borderWidth: 2
                });
            }
        });

        if (datasets.length === 0) return;

        this.charts[canvasId] = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: { datasets },
            options: {
                ...this.defaultOptions,
                plugins: {
                    ...this.defaultOptions.plugins,
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { color: '#a0a0b0', font: { family: 'Outfit', size: 11 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label}: ${Math.round(ctx.parsed.y)} bpm`
                        }
                    }
                },
                scales: {
                    x: {
                        ...this.defaultOptions.scales.x,
                        type: 'linear',
                        title: { display: true, text: `Distance (${useMetric ? 'km' : 'mi'})`, color: '#a0a0b0' },
                        min: 0,
                        ticks: {
                            callback: function(value) {
                                return value.toFixed(1);
                            }
                        }
                    },
                    y: {
                        ...this.defaultOptions.scales.y,
                        title: { display: true, text: 'Heart Rate (bpm)', color: '#a0a0b0' },
                        min: 0,
                        max: maxHR
                    }
                }
            }
        });
    }

    // Create comparison pace chart
    createComparisonPaceChart(canvasId, workouts, useMetric) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const colors = ['#ff6b35', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7'];
        const datasets = [];

        workouts.forEach((workout, index) => {
            // Calculate pace over distance from route points if available
            let paceData = null;
            if (workout.matchingRoute && workout.matchingRoute.points) {
                const route = workout.matchingRoute;
                const totalDistance = route.totalDistance || workout.distanceKm || 0;
                if (totalDistance > 0) {
                    paceData = [];
                    let cumulativeDistance = 0;
                    const distancePerPoint = totalDistance / route.points.length;
                    
                    route.points.forEach((point, idx) => {
                        if (point.speed && point.speed > 0) {
                            cumulativeDistance += distancePerPoint;
                            // Convert to display unit (km or miles)
                            const displayDistance = useMetric ? cumulativeDistance : cumulativeDistance / 1.60934;
                            const paceMinPerKm = 60 / point.speed; // Convert m/s to min/km
                            const pace = useMetric ? paceMinPerKm : paceMinPerKm * 1.60934;
                            paceData.push({ x: displayDistance, y: pace });
                        }
                    });
                }
            }

            if (!paceData || paceData.length === 0) {
                // Fallback: create constant pace line
                const pace = workout.pace || workout.paceMinPerKm || (workout.duration && workout.distanceKm ? workout.duration / workout.distanceKm : 0);
                if (pace > 0) {
                    const displayPace = useMetric ? pace : pace * 1.60934;
                    const totalDistanceKm = workout.distanceKm || 0;
                    const totalDistance = useMetric ? totalDistanceKm : totalDistanceKm / 1.60934;
                    paceData = [
                        { x: 0, y: displayPace },
                        { x: totalDistance, y: displayPace }
                    ];
                }
            }

            if (paceData && paceData.length > 0) {
                const d = workout.dateObj || new Date(workout.date);
                const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                const distanceKm = workout.distanceKm || 0;
                const distance = useMetric ? distanceKm : distanceKm / 1.60934;
                const unit = useMetric ? 'km' : 'mi';
                
                datasets.push({
                    label: `${dateStr} - ${distance.toFixed(1)}${unit}`,
                    data: paceData,
                    borderColor: colors[index % colors.length],
                    backgroundColor: colors[index % colors.length] + '20',
                    fill: false,
                    tension: 0.3,
                    pointRadius: 0,
                    borderWidth: 2
                });
            }
        });

        if (datasets.length === 0) return;

        this.charts[canvasId] = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: { datasets },
            options: {
                ...this.defaultOptions,
                plugins: {
                    ...this.defaultOptions.plugins,
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { color: '#a0a0b0', font: { family: 'Outfit', size: 11 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label}: ${this.formatPace(ctx.parsed.y)}/${useMetric ? 'km' : 'mi'}`
                        }
                    }
                },
                scales: {
                    x: {
                        ...this.defaultOptions.scales.x,
                        type: 'linear',
                        title: { display: true, text: `Distance (${useMetric ? 'km' : 'mi'})`, color: '#a0a0b0' },
                        min: 0,
                        ticks: {
                            callback: function(value) {
                                return value.toFixed(1);
                            }
                        }
                    },
                    y: {
                        ...this.defaultOptions.scales.y,
                        title: { display: true, text: `Pace (${useMetric ? 'min/km' : 'min/mi'})`, color: '#a0a0b0' },
                        reverse: true,
                        ticks: {
                            color: '#606070',
                            callback: (val) => this.formatPace(val)
                        }
                    }
                }
            }
        });
    }

    // Create comparison cadence chart
    createComparisonCadenceChart(canvasId, workouts, useMetric = true) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const colors = ['#ff6b35', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7'];
        const datasets = [];

        workouts.forEach((workout, index) => {
            const cadenceData = this.normalizeByDistance(workout, 'cadenceData', true); // Always use km for normalization
            if (cadenceData && cadenceData.length > 0) {
                const d = workout.dateObj || new Date(workout.date);
                const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                const distanceKm = workout.distanceKm || 0;
                const distance = useMetric ? distanceKm : distanceKm / 1.60934;
                const unit = useMetric ? 'km' : 'mi';
                
                // Convert cadenceData x values to use selected unit
                const cadenceDataConverted = cadenceData.map(point => ({
                    x: useMetric ? point.x : point.x / 1.60934,
                    y: point.y
                }));
                
                datasets.push({
                    label: `${dateStr} - ${distance.toFixed(1)}${unit}`,
                    data: cadenceDataConverted,
                    borderColor: colors[index % colors.length],
                    backgroundColor: colors[index % colors.length] + '20',
                    fill: false,
                    tension: 0.3,
                    pointRadius: 0,
                    borderWidth: 2
                });
            }
        });

        if (datasets.length === 0) return;

        this.charts[canvasId] = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: { datasets },
            options: {
                ...this.defaultOptions,
                plugins: {
                    ...this.defaultOptions.plugins,
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { color: '#a0a0b0', font: { family: 'Outfit', size: 11 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label}: ${Math.round(ctx.parsed.y)} spm`
                        }
                    }
                },
                scales: {
                    x: {
                        ...this.defaultOptions.scales.x,
                        type: 'linear',
                        title: { display: true, text: `Distance (${useMetric ? 'km' : 'mi'})`, color: '#a0a0b0' },
                        min: 0,
                        ticks: {
                            callback: function(value) {
                                return value.toFixed(1);
                            }
                        }
                    },
                    y: {
                        ...this.defaultOptions.scales.y,
                        title: { display: true, text: 'Cadence (spm)', color: '#a0a0b0' }
                    }
                }
            }
        });
    }

    // Create comparison stride chart
    createComparisonStrideChart(canvasId, workouts) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const colors = ['#ff6b35', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7'];
        const datasets = [];

        workouts.forEach((workout, index) => {
            const strideData = this.normalizeByDistance(workout, 'strideLengthData');
            if (strideData && strideData.length > 0) {
                const d = workout.dateObj || new Date(workout.date);
                const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                
                // Convert stride from meters to centimeters for better readability
                const strideDataCm = strideData.map(point => ({
                    x: point.x,
                    y: point.y * 100
                }));
                
                datasets.push({
                    label: `${dateStr} - ${workout.distanceKm ? workout.distanceKm.toFixed(1) : '--'}km`,
                    data: strideDataCm,
                    borderColor: colors[index % colors.length],
                    backgroundColor: colors[index % colors.length] + '20',
                    fill: false,
                    tension: 0.3,
                    pointRadius: 0,
                    borderWidth: 2
                });
            }
        });

        if (datasets.length === 0) return;

        this.charts[canvasId] = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: { datasets },
            options: {
                ...this.defaultOptions,
                plugins: {
                    ...this.defaultOptions.plugins,
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { color: '#a0a0b0', font: { family: 'Outfit', size: 11 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} cm`
                        }
                    }
                },
                scales: {
                    x: {
                        ...this.defaultOptions.scales.x,
                        type: 'linear',
                        title: { display: true, text: 'Distance (%)', color: '#a0a0b0' },
                        min: 0,
                        max: 100,
                        ticks: {
                            stepSize: 10,
                            callback: function(value) {
                                return value + '%';
                            }
                        }
                    },
                    y: {
                        ...this.defaultOptions.scales.y,
                        title: { display: true, text: 'Stride Length (cm)', color: '#a0a0b0' }
                    }
                }
            }
        });
    }
}

// Create global chart manager instance
const charts = new ChartManager();

