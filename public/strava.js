/**
 * Strava API Integration
 * Handles OAuth, token management, and API calls
 */

class StravaClient {
    constructor() {
        this.accessToken = null;
        this.refreshToken = null;
        this.expiresAt = null;
        this.athleteId = null;
        this.athleteName = null;
        this.loadTokens();
    }

    // Load tokens from localStorage
    loadTokens() {
        this.accessToken = localStorage.getItem('strava_access_token');
        this.refreshToken = localStorage.getItem('strava_refresh_token');
        this.expiresAt = parseInt(localStorage.getItem('strava_expires_at') || '0');
        this.athleteId = localStorage.getItem('strava_athlete_id');
        this.athleteName = localStorage.getItem('strava_athlete_name');
    }

    // Save tokens to localStorage
    saveTokens(accessToken, refreshToken, expiresAt, athleteId, athleteName) {
        this.accessToken = accessToken;
        this.refreshToken = refreshToken;
        this.expiresAt = expiresAt;
        this.athleteId = athleteId;
        this.athleteName = athleteName;

        localStorage.setItem('strava_access_token', accessToken);
        localStorage.setItem('strava_refresh_token', refreshToken);
        localStorage.setItem('strava_expires_at', expiresAt.toString());
        if (athleteId) localStorage.setItem('strava_athlete_id', athleteId);
        if (athleteName) localStorage.setItem('strava_athlete_name', athleteName);
    }

    // Clear tokens (disconnect)
    clearTokens() {
        this.accessToken = null;
        this.refreshToken = null;
        this.expiresAt = null;
        this.athleteId = null;
        this.athleteName = null;

        localStorage.removeItem('strava_access_token');
        localStorage.removeItem('strava_refresh_token');
        localStorage.removeItem('strava_expires_at');
        localStorage.removeItem('strava_athlete_id');
        localStorage.removeItem('strava_athlete_name');
    }

    // Check if connected
    isConnected() {
        return !!this.accessToken;
    }

    // Check if token is expired (with 5 min buffer)
    isTokenExpired() {
        return Date.now() / 1000 > (this.expiresAt - 300);
    }

    // Initiate OAuth flow
    connect() {
        window.location.href = '/auth/strava';
    }

    // Handle OAuth callback (called from URL params)
    handleCallback() {
        const params = new URLSearchParams(window.location.search);
        
        if (params.get('strava_auth') === 'success') {
            this.saveTokens(
                params.get('access_token'),
                params.get('refresh_token'),
                parseInt(params.get('expires_at')),
                params.get('athlete_id'),
                params.get('athlete_name')
            );
            
            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);
            return true;
        }
        
        if (params.get('error')) {
            console.error('Strava OAuth error:', params.get('error'));
            window.history.replaceState({}, document.title, window.location.pathname);
        }
        
        return false;
    }

    // Refresh access token if expired
    async refreshAccessToken() {
        if (!this.refreshToken) {
            throw new Error('No refresh token available');
        }

        try {
            const response = await fetch('/auth/strava/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: this.refreshToken })
            });

            const data = await response.json();
            
            if (data.access_token) {
                this.saveTokens(
                    data.access_token,
                    data.refresh_token,
                    data.expires_at,
                    this.athleteId,
                    this.athleteName
                );
                return true;
            }
            
            throw new Error('Failed to refresh token');
        } catch (error) {
            console.error('Token refresh error:', error);
            this.clearTokens();
            throw error;
        }
    }

    // Get valid access token (refreshing if needed)
    async getValidToken() {
        if (!this.accessToken) {
            throw new Error('Not connected to Strava');
        }

        if (this.isTokenExpired()) {
            await this.refreshAccessToken();
        }

        return this.accessToken;
    }

    // Fetch activities from Strava
    async fetchActivities(options = {}) {
        const token = await this.getValidToken();
        
        const params = new URLSearchParams();
        params.set('page', options.page || 1);
        params.set('per_page', options.perPage || 50);
        if (options.after) params.set('after', options.after);
        if (options.before) params.set('before', options.before);

        const response = await fetch(`/api/strava/activities?${params}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            throw new Error(`Strava API error: ${response.status}`);
        }

        return response.json();
    }

    // Fetch all activities (handles pagination)
    async fetchAllActivities(options = {}) {
        const allActivities = [];
        let page = 1;
        const perPage = 100;
        let hasMore = true;

        while (hasMore) {
            const activities = await this.fetchActivities({ 
                ...options, 
                page, 
                perPage 
            });
            
            allActivities.push(...activities);
            
            if (activities.length < perPage) {
                hasMore = false;
            } else {
                page++;
            }

            // Add small delay to avoid rate limiting
            await new Promise(r => setTimeout(r, 100));
        }

        return allActivities;
    }

    // Fetch only running activities and transform to our format
    async fetchRunningActivities() {
        const activities = await this.fetchAllActivities();
        
        return activities
            .filter(a => a.type === 'Run')
            .map(a => this.transformActivity(a));
    }

    // Fetch activity streams (detailed HR data)
    async fetchActivityStreams(activityId, keys = 'heartrate,time') {
        const token = await this.getValidToken();
        
        const response = await fetch(`/api/strava/activities/${activityId}/streams?keys=${keys}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            throw new Error(`Strava Streams API error: ${response.status}`);
        }

        return response.json();
    }

    // Fetch HR stream for an activity and convert to our format
    async fetchHeartRateData(activityId, startDate) {
        try {
            const streams = await this.fetchActivityStreams(activityId, 'heartrate,time');
            
            // Handle different response formats
            let heartrateStream, timeStream;
            
            if (Array.isArray(streams)) {
                // If streams is an array, find heartrate and time streams
                heartrateStream = streams.find(s => s.type === 'heartrate');
                timeStream = streams.find(s => s.type === 'time');
            } else {
                // If streams is an object with key_by_type=true
                heartrateStream = streams.heartrate;
                timeStream = streams.time;
            }
            
            if (!heartrateStream || !timeStream || !heartrateStream.data || !timeStream.data) {
                console.log(`No HR streams available for activity ${activityId}`);
                return null;
            }

            const startTime = new Date(startDate).getTime();
            const hrData = [];
            const hrArray = heartrateStream.data;
            const timeArray = timeStream.data;

            for (let i = 0; i < Math.min(hrArray.length, timeArray.length); i++) {
                hrData.push({
                    time: startTime + (timeArray[i] * 1000), // time is in seconds from start
                    value: hrArray[i]
                });
            }

            return hrData.length > 0 ? hrData : null;
        } catch (error) {
            console.error(`Error fetching HR stream for activity ${activityId}:`, error);
            return null;
        }
    }

    // Transform Strava activity to our workout format
    transformActivity(activity) {
        const durationMin = activity.moving_time / 60;
        const distanceKm = activity.distance / 1000;
        const distanceMi = distanceKm / 1.60934;
        
        // Calculate pace (min/km)
        const paceMinPerKm = distanceKm > 0 ? durationMin / distanceKm : 0;
        
        return {
            id: `strava_${activity.id}`,
            stravaId: activity.id,
            source: 'strava',
            name: activity.name,
            date: activity.start_date,
            dateObj: new Date(activity.start_date),
            displayDate: new Date(activity.start_date).toLocaleDateString('en-US', {
                weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
            }),
            duration: durationMin,
            durationFormatted: this.formatDuration(durationMin),
            distanceKm: distanceKm,
            distanceMi: distanceMi,
            pace: paceMinPerKm,
            paceFormatted: this.formatPace(paceMinPerKm),
            calories: activity.calories || 0,
            heartRateAvg: activity.average_heartrate || null,
            heartRateMax: activity.max_heartrate || null,
            heartRateMin: null, // Strava doesn't provide min HR in summary
            cadenceAvg: activity.average_cadence ? activity.average_cadence * 2 : null, // Strava gives steps/min per foot
            elevationGain: activity.total_elevation_gain,
            movingTime: activity.moving_time,
            elapsedTime: activity.elapsed_time,
            kudosCount: activity.kudos_count,
            achievementCount: activity.achievement_count,
            year: new Date(activity.start_date).getFullYear()
        };
    }

    // Format duration as MM:SS
    formatDuration(minutes) {
        const mins = Math.floor(minutes);
        const secs = Math.round((minutes - mins) * 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // Format pace as MM:SS
    formatPace(minPerKm) {
        if (!minPerKm || minPerKm === Infinity) return '--:--';
        const mins = Math.floor(minPerKm);
        const secs = Math.round((minPerKm - mins) * 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
}

// Create global Strava client instance
const strava = new StravaClient();

