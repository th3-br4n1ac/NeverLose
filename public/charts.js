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
}

// Create global chart manager instance
const charts = new ChartManager();

