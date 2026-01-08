/**
 * NeverLose Running Tracker - Backend Server
 * Handles Strava OAuth authentication and API proxy
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

// Configuration from environment variables
// For local development, create a .env file with your Strava credentials
// For production (Render), set these in the Environment Variables dashboard
const CONFIG = {
    STRAVA_CLIENT_ID: process.env.STRAVA_CLIENT_ID || '',
    STRAVA_CLIENT_SECRET: process.env.STRAVA_CLIENT_SECRET || '',
    PORT: process.env.PORT || 3000,
    BASE_URL: process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`
};

// Dynamic redirect URI based on environment
const REDIRECT_URI = `${CONFIG.BASE_URL}/auth/strava/callback`;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
// Also serve apple_health_export folder for testing
app.use('/apple_health_export', express.static(path.join(__dirname, '../apple_health_export')));

// Strava OAuth: Generate authorization URL
app.get('/auth/strava', (req, res) => {
    const scope = 'read,activity:read_all';
    const authUrl = `https://www.strava.com/oauth/authorize?client_id=${CONFIG.STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scope}&approval_prompt=auto`;
    res.redirect(authUrl);
});

// Strava OAuth: Handle callback and exchange code for tokens
app.get('/auth/strava/callback', async (req, res) => {
    const { code, error } = req.query;

    if (error) {
        return res.redirect(`/?error=${encodeURIComponent(error)}`);
    }

    if (!code) {
        return res.redirect('/?error=no_code');
    }

    try {
        // Exchange authorization code for access token
        const tokenResponse = await fetch('https://www.strava.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: CONFIG.STRAVA_CLIENT_ID,
                client_secret: CONFIG.STRAVA_CLIENT_SECRET,
                code: code,
                grant_type: 'authorization_code'
            })
        });

        const tokenData = await tokenResponse.json();

        if (tokenData.errors) {
            console.error('Strava token error:', tokenData.errors);
            return res.redirect(`/?error=${encodeURIComponent(JSON.stringify(tokenData.errors))}`);
        }

        // Redirect to frontend with tokens (they'll be stored client-side)
        // In production, you'd want to use httpOnly cookies or a more secure method
        const params = new URLSearchParams({
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_at: tokenData.expires_at,
            athlete_id: tokenData.athlete?.id || '',
            athlete_name: `${tokenData.athlete?.firstname || ''} ${tokenData.athlete?.lastname || ''}`.trim()
        });

        res.redirect(`/?strava_auth=success&${params.toString()}`);
    } catch (error) {
        console.error('OAuth error:', error);
        res.redirect(`/?error=${encodeURIComponent(error.message)}`);
    }
});

// Strava OAuth: Refresh access token
app.post('/auth/strava/refresh', async (req, res) => {
    const { refresh_token } = req.body;

    if (!refresh_token) {
        return res.status(400).json({ error: 'refresh_token required' });
    }

    try {
        const response = await fetch('https://www.strava.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: CONFIG.STRAVA_CLIENT_ID,
                client_secret: CONFIG.STRAVA_CLIENT_SECRET,
                refresh_token: refresh_token,
                grant_type: 'refresh_token'
            })
        });

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Token refresh error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Proxy Strava API requests (to avoid CORS issues)
app.get('/api/strava/activities', async (req, res) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
        return res.status(401).json({ error: 'Authorization header required' });
    }

    try {
        const { page = 1, per_page = 50, after, before } = req.query;
        
        let url = `https://www.strava.com/api/v3/athlete/activities?page=${page}&per_page=${per_page}`;
        if (after) url += `&after=${after}`;
        if (before) url += `&before=${before}`;

        const response = await fetch(url, {
            headers: { 'Authorization': authHeader }
        });

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Strava API error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get detailed activity
app.get('/api/strava/activities/:id', async (req, res) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
        return res.status(401).json({ error: 'Authorization header required' });
    }

    try {
        const response = await fetch(`https://www.strava.com/api/v3/activities/${req.params.id}`, {
            headers: { 'Authorization': authHeader }
        });

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Strava API error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get activity streams (detailed HR, pace, etc.)
app.get('/api/strava/activities/:id/streams', async (req, res) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
        return res.status(401).json({ error: 'Authorization header required' });
    }

    try {
        // Request heart rate and time streams
        const keys = req.query.keys || 'heartrate,time';
        const response = await fetch(
            `https://www.strava.com/api/v3/activities/${req.params.id}/streams?keys=${keys}&key_by_type=true`,
            { headers: { 'Authorization': authHeader } }
        );

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Strava Streams API error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Serve the main app for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start server
app.listen(CONFIG.PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║         🏃 NeverLose Running Tracker Server 🏃            ║
╠═══════════════════════════════════════════════════════════╣
║  Server running at: ${CONFIG.BASE_URL}
║                                                           ║
║  Strava OAuth configured:                                 ║
║  Client ID: ${CONFIG.STRAVA_CLIENT_ID === 'YOUR_CLIENT_ID' ? '❌ Not set' : '✅ ' + CONFIG.STRAVA_CLIENT_ID}
║  Callback URL: ${REDIRECT_URI}
║                                                           ║
║  Environment: ${process.env.NODE_ENV || 'development'}
╚═══════════════════════════════════════════════════════════╝
    `);
});

