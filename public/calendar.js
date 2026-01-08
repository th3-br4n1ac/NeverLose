/**
 * Calendar Manager
 * Handles training calendar display and planned workouts
 */

class CalendarManager {
    constructor() {
        this.currentDate = new Date();
        this.workouts = [];
        this.plannedWorkouts = [];
        this.useMetric = true;
    }

    // Get local date string (YYYY-MM-DD) without timezone conversion
    getLocalDateString(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // Initialize calendar with data
    async init(workouts, plannedWorkouts, useMetric = true) {
        this.workouts = workouts;
        this.plannedWorkouts = plannedWorkouts;
        this.useMetric = useMetric;
        this.render();
    }

    // Update workouts
    updateWorkouts(workouts) {
        this.workouts = workouts;
        this.render();
    }

    // Update planned workouts
    updatePlannedWorkouts(plannedWorkouts) {
        this.plannedWorkouts = plannedWorkouts;
        this.render();
    }

    // Navigate to previous month
    prevMonth() {
        this.currentDate.setMonth(this.currentDate.getMonth() - 1);
        this.render();
    }

    // Navigate to next month
    nextMonth() {
        this.currentDate.setMonth(this.currentDate.getMonth() + 1);
        this.render();
    }

    // Render the calendar
    render() {
        const grid = document.getElementById('calendarGrid');
        const monthLabel = document.getElementById('currentMonth');
        
        if (!grid || !monthLabel) return;

        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        
        // Update month label
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                           'July', 'August', 'September', 'October', 'November', 'December'];
        monthLabel.textContent = `${monthNames[month]} ${year}`;

        // Clear grid
        grid.innerHTML = '';

        // Add day headers
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        dayNames.forEach(day => {
            const header = document.createElement('div');
            header.className = 'calendar-header';
            header.textContent = day;
            grid.appendChild(header);
        });

        // Get first day of month and total days
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const daysInPrevMonth = new Date(year, month, 0).getDate();

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Previous month days
        for (let i = firstDay - 1; i >= 0; i--) {
            const day = daysInPrevMonth - i;
            const date = new Date(year, month - 1, day);
            this.createDayCell(grid, day, date, true);
        }

        // Current month days
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const isToday = date.getTime() === today.getTime();
            this.createDayCell(grid, day, date, false, isToday);
        }

        // Next month days (fill remaining cells)
        const totalCells = grid.children.length - 7; // Subtract headers
        const remainingCells = 42 - totalCells; // 6 rows * 7 days
        for (let day = 1; day <= remainingCells; day++) {
            const date = new Date(year, month + 1, day);
            this.createDayCell(grid, day, date, true);
        }
    }

    // Create a day cell
    createDayCell(grid, day, date, isOtherMonth, isToday = false) {
        const cell = document.createElement('div');
        cell.className = 'calendar-day';
        if (isOtherMonth) cell.classList.add('other-month');
        if (isToday) cell.classList.add('today');

        // Day number
        const dayNum = document.createElement('div');
        dayNum.className = 'day-number';
        dayNum.textContent = day;
        cell.appendChild(dayNum);

        // Get workouts for this day
        const dayWorkouts = this.getWorkoutsForDate(date);
        const plannedWorkout = this.getPlannedWorkoutForDate(date);

        // Add planned workout (if exists and not completed)
        if (plannedWorkout && dayWorkouts.length === 0) {
            const isPast = date < new Date();
            const workoutDiv = document.createElement('div');
            workoutDiv.className = `day-workout ${isPast ? 'missed' : 'planned'}`;
            workoutDiv.textContent = this.formatPlannedWorkout(plannedWorkout);
            cell.appendChild(workoutDiv);
        }

        // Add completed workouts
        dayWorkouts.forEach(w => {
            const workoutDiv = document.createElement('div');
            
            // Check if it exceeded plan
            let status = 'completed';
            if (plannedWorkout && plannedWorkout.distance) {
                const actualDist = w.distanceKm || 0;
                if (actualDist > plannedWorkout.distance * 1.1) {
                    status = 'exceeded';
                }
            }
            
            workoutDiv.className = `day-workout ${status}`;
            workoutDiv.style.cursor = 'pointer';
            const dist = this.useMetric ? (w.distanceKm || 0) : (w.distanceMi || 0);
            const unit = this.useMetric ? 'km' : 'mi';
            workoutDiv.textContent = `${dist.toFixed(1)}${unit}`;
            
            // Add click handler to individual workout
            workoutDiv.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent triggering day click
                this.onDayClick(date, [w], plannedWorkout); // Pass single workout
            });
            
            cell.appendChild(workoutDiv);
        });

        // Click handler to view/edit day (only if clicking on cell, not on workout)
        cell.addEventListener('click', (e) => {
            // Only trigger if clicking directly on the cell or day number, not on workout divs
            if (e.target === cell || e.target.classList.contains('day-number')) {
                this.onDayClick(date, dayWorkouts, plannedWorkout);
            }
        });

        grid.appendChild(cell);
    }

    // Get completed workouts for a specific date
    getWorkoutsForDate(date) {
        const dateStr = this.getLocalDateString(date);
        return this.workouts.filter(w => {
            const wDate = w.dateObj || new Date(w.date);
            const wDateStr = this.getLocalDateString(wDate);
            return wDateStr === dateStr;
        });
    }

    // Get planned workout for a specific date
    getPlannedWorkoutForDate(date) {
        const dateStr = this.getLocalDateString(date);
        return this.plannedWorkouts.find(p => p.date === dateStr);
    }

    // Format planned workout for display
    formatPlannedWorkout(planned) {
        const types = {
            easy: '🏃 Easy',
            tempo: '⚡ Tempo',
            interval: '🔥 Intervals',
            long: '🛤️ Long',
            recovery: '🚶 Recovery',
            race: '🏆 Race',
            rest: '😴 Rest'
        };
        
        let text = types[planned.type] || planned.type;
        if (planned.distance && planned.type !== 'rest') {
            const dist = this.useMetric ? planned.distance : (planned.distance / 1.60934);
            const unit = this.useMetric ? 'km' : 'mi';
            text += ` ${dist.toFixed(1)}${unit}`;
        }
        return text;
    }

    // Handler for day click
    onDayClick(date, workouts, planned) {
        // This will be implemented by the app
        if (this.dayClickHandler) {
            this.dayClickHandler(date, workouts, planned);
        }
    }

    // Set day click handler
    setDayClickHandler(handler) {
        this.dayClickHandler = handler;
    }

    // Get weekly summary
    getWeeklySummary(weekStart) {
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);

        const weekWorkouts = this.workouts.filter(w => {
            const d = w.dateObj || new Date(w.date);
            return d >= weekStart && d < weekEnd;
        });

        const plannedDistance = this.plannedWorkouts
            .filter(p => {
                const d = new Date(p.date);
                return d >= weekStart && d < weekEnd && p.type !== 'rest';
            })
            .reduce((sum, p) => sum + (p.distance || 0), 0);

        const actualDistance = weekWorkouts.reduce((sum, w) => sum + (w.distanceKm || 0), 0);
        const totalDuration = weekWorkouts.reduce((sum, w) => sum + (w.duration || 0), 0);

        return {
            workouts: weekWorkouts.length,
            plannedDistance,
            actualDistance,
            completionRate: plannedDistance > 0 ? (actualDistance / plannedDistance * 100) : 0,
            totalDuration
        };
    }
}

// Create global calendar manager instance
const calendar = new CalendarManager();

