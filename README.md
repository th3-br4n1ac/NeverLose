# NeverLose Running Tracker 🏃

A comprehensive running training tracker that integrates Apple Health and Strava data.

## Features

- **Apple Health Import**: Upload your `export.xml` file to import all running workouts
- **Strava Integration**: Connect your Strava account to sync activities
- **Dashboard**: View weekly/monthly statistics, comparisons, and recent activity
- **Workouts List**: Search, filter, and sort all your workouts
- **Analytics**: Charts for distance trends, pace progression, heart rate zones, training volume
- **Training Calendar**: Plan workouts and track completion

## Quick Start

### 1. Install Dependencies

```bash
cd NeverLose
npm install
```

### 2. Configure Strava API (Optional)

To enable Strava integration:

1. Go to [Strava API Settings](https://www.strava.com/settings/api)
2. Create a new application:
   - **Application Name**: NeverLose Running Tracker
   - **Category**: Training
   - **Website**: http://localhost:3000
   - **Authorization Callback Domain**: localhost
3. Copy your **Client ID** and **Client Secret**
4. Edit `server/index.js` and update the CONFIG section:

```javascript
const CONFIG = {
    STRAVA_CLIENT_ID: 'your_client_id_here',
    STRAVA_CLIENT_SECRET: 'your_client_secret_here',
    // ...
};
```

### 3. Start the Server

```bash
npm start
```

### 4. Open the App

Navigate to [http://localhost:3000](http://localhost:3000)

## Usage

### Import Apple Health Data

1. On your iPhone, open the **Health** app
2. Tap your profile picture → **Export All Health Data**
3. Extract the zip file and locate `export.xml`
4. In the app, click **Upload Apple Health** and select the file

### Connect Strava

1. Click **Connect Strava**
2. Authorize the app on Strava's website
3. Your running activities will be automatically synced

### View Analytics

- Navigate to **Analytics** for detailed charts
- Adjust the time range using the dropdown
- Charts include:
  - Distance over time
  - Pace progression
  - Heart rate zone distribution
  - Training volume
  - Day of week distribution

### Plan Workouts

1. Go to **Calendar**
2. Click a day or use **+ Plan Workout**
3. Set the workout type, distance, and notes
4. Completed workouts will show as green, planned as blue, missed as red

## Data Storage

All data is stored locally in your browser using IndexedDB:
- Workouts (Apple Health + Strava)
- Planned workouts
- Settings
- Strava token cache

No data is sent to any external server except for Strava API calls.

## Tech Stack

- **Backend**: Node.js + Express (for OAuth only)
- **Frontend**: Vanilla JavaScript
- **Storage**: IndexedDB
- **Charts**: Chart.js
- **Styling**: Custom CSS with CSS Variables

## File Structure

```
NeverLose/
├── server/
│   └── index.js          # Express server for Strava OAuth
├── public/
│   ├── index.html        # Main HTML
│   ├── styles.css        # All styles
│   ├── app.js            # Main application logic
│   ├── db.js             # IndexedDB manager
│   ├── strava.js         # Strava API client
│   ├── parser.js         # Apple Health XML parser
│   ├── charts.js         # Chart.js configurations
│   └── calendar.js       # Calendar manager
├── package.json
└── README.md
```

## License

MIT

