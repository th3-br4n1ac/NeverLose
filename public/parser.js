/**
 * Apple Health XML Parser
 * Streaming parser for large export.xml files
 */

class AppleHealthParser {
    constructor() {
        this.workouts = [];
        this.heartRateRecords = []; // Store all HR records with timestamps
        this.hrRecordsSeen = new Set(); // Track seen HR records to avoid duplicates
        this.cadenceRecords = []; // Store cadence (step count) records
        this.cadenceRecordsSeen = new Set();
        this.strideLengthRecords = []; // Store stride length records
        this.strideLengthRecordsSeen = new Set();
        this.onProgress = null;
        this.onComplete = null;
    }

    // Parse file with progress callback
    async parseFile(file, onProgress) {
        this.workouts = [];
        this.heartRateRecords = [];
        this.hrRecordsSeen = new Set();
        this.cadenceRecords = [];
        this.cadenceRecordsSeen = new Set();
        this.strideLengthRecords = [];
        this.strideLengthRecordsSeen = new Set();
        this.onProgress = onProgress;

        // Check if Streams API is available (not supported on some mobile browsers)
        if (typeof file.stream === 'function') {
            return this.parseFileStream(file);
        } else {
            return this.parseFileReader(file);
        }
    }

    // Parse using Streams API (modern browsers)
    async parseFileStream(file) {
        const fileSize = file.size;
        let bytesRead = 0;
        let buffer = '';
        let recordBuffer = '';

        const reader = file.stream().getReader();
        const decoder = new TextDecoder();

        try {
            while (true) {
                const { done, value } = await reader.read();

                if (done) {
                    if (buffer.length > 0) {
                        this.extractWorkouts(buffer);
                    }
                    if (recordBuffer.length > 0) {
                        this.extractRecordsStreaming(recordBuffer);
                    }
                    break;
                }

                bytesRead += value.length;
                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;
                recordBuffer += chunk;

                const workoutResult = this.extractWorkouts(buffer);
                buffer = workoutResult.remaining;

                const recordResult = this.extractRecordsStreaming(recordBuffer);
                recordBuffer = recordResult.remaining;

                if (this.onProgress) {
                    this.onProgress({
                        percent: Math.round((bytesRead / fileSize) * 100),
                        bytesRead,
                        fileSize,
                        workoutsFound: this.workouts.length
                    });
                }

                await new Promise(r => setTimeout(r, 0));
            }

            return this.finalizeWorkouts();
        } catch (error) {
            console.error('Error parsing file with stream:', error);
            throw error;
        }
    }

    // Parse using FileReader API (fallback for mobile browsers)
    async parseFileReader(file) {
        const fileSize = file.size;
        const chunkSize = 1024 * 1024; // 1MB chunks
        let offset = 0;
        let buffer = '';
        let recordBuffer = '';

        while (offset < fileSize) {
            const chunk = await this.readChunk(file, offset, chunkSize);
            offset += chunkSize;

            buffer += chunk;
            recordBuffer += chunk;

            const workoutResult = this.extractWorkouts(buffer);
            buffer = workoutResult.remaining;

            const recordResult = this.extractRecordsStreaming(recordBuffer);
            recordBuffer = recordResult.remaining;

            if (this.onProgress) {
                this.onProgress({
                    percent: Math.round((Math.min(offset, fileSize) / fileSize) * 100),
                    bytesRead: Math.min(offset, fileSize),
                    fileSize,
                    workoutsFound: this.workouts.length
                });
            }

            await new Promise(r => setTimeout(r, 0));
        }

        // Process remaining buffers
        if (buffer.length > 0) {
            this.extractWorkouts(buffer);
        }
        if (recordBuffer.length > 0) {
            this.extractRecordsStreaming(recordBuffer);
        }

        return this.finalizeWorkouts();
    }

    // Read a chunk of the file using FileReader
    readChunk(file, offset, length) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            const blob = file.slice(offset, offset + length);
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsText(blob);
        });
    }

    // Finalize workouts after parsing
    finalizeWorkouts() {
        console.log(`Parsed ${this.heartRateRecords.length} HR, ${this.cadenceRecords.length} cadence, ${this.strideLengthRecords.length} stride records`);
        this.associateRecordsWithWorkouts();

        const workoutsWithHR = this.workouts.filter(w => w.heartRateData && w.heartRateData.length > 0);
        const workoutsWithCadence = this.workouts.filter(w => w.cadenceData && w.cadenceData.length > 0);
        const workoutsWithStride = this.workouts.filter(w => w.strideLengthData && w.strideLengthData.length > 0);
        console.log(`Workouts with detailed data: ${workoutsWithHR.length} HR, ${workoutsWithCadence.length} cadence, ${workoutsWithStride.length} stride`);

        return this.workouts;
    }

    // Extract all record types from buffer (streaming version)
    extractRecordsStreaming(buffer) {
        let lastMatchEnd = 0;

        // Extract HR records
        // HR records are NOT self-closing! They end with value="XX"> not />
        const hrPattern = /<Record[^>]*type="HKQuantityTypeIdentifierHeartRate"[^>]*startDate="([^"]+)"[^>]*value="(\d+)"[^>]*>/g;
        let match;

        while ((match = hrPattern.exec(buffer)) !== null) {
            lastMatchEnd = Math.max(lastMatchEnd, match.index + match[0].length);
            const startDate = match[1];
            const value = parseFloat(match[2]);

            if (startDate && value) {
                const key = `hr_${startDate}_${value}`;
                if (this.hrRecordsSeen.has(key)) continue;
                this.hrRecordsSeen.add(key);

                const isoDate = startDate.replace(' ', 'T').replace(' ', '');
                const timestamp = new Date(isoDate).getTime();

                if (!isNaN(timestamp)) {
                    this.heartRateRecords.push({ time: timestamp, value: value });
                }
            }
        }

        // Extract stride length records
        // Match: <Record type="HKQuantityTypeIdentifierRunningStrideLength" ... startDate="..." ... value="X.XX">
        const stridePattern = /<Record[^>]*type="HKQuantityTypeIdentifierRunningStrideLength"[^>]*startDate="([^"]+)"[^>]*value="([0-9.]+)"[^>]*>/g;

        while ((match = stridePattern.exec(buffer)) !== null) {
            lastMatchEnd = Math.max(lastMatchEnd, match.index + match[0].length);
            const startDate = match[1];
            const value = parseFloat(match[2]);

            if (startDate && value) {
                const key = `stride_${startDate}_${value}`;
                if (this.strideLengthRecordsSeen.has(key)) continue;
                this.strideLengthRecordsSeen.add(key);

                const isoDate = startDate.replace(' ', 'T').replace(' ', '');
                const timestamp = new Date(isoDate).getTime();

                if (!isNaN(timestamp)) {
                    this.strideLengthRecords.push({ time: timestamp, value: value });
                }
            }
        }

        // Extract step count records for cadence calculation
        // Match: <Record type="HKQuantityTypeIdentifierStepCount" ... startDate="..." endDate="..." value="XX">
        const stepPattern = /<Record[^>]*type="HKQuantityTypeIdentifierStepCount"[^>]*startDate="([^"]+)"[^>]*endDate="([^"]+)"[^>]*value="(\d+)"[^>]*>/g;

        while ((match = stepPattern.exec(buffer)) !== null) {
            lastMatchEnd = Math.max(lastMatchEnd, match.index + match[0].length);
            const startDate = match[1];
            const endDate = match[2];
            const steps = parseFloat(match[3]);

            if (startDate && endDate && steps) {
                const key = `step_${startDate}_${steps}`;
                if (this.cadenceRecordsSeen.has(key)) continue;
                this.cadenceRecordsSeen.add(key);

                const startIso = startDate.replace(' ', 'T').replace(' ', '');
                const endIso = endDate.replace(' ', 'T').replace(' ', '');
                const startTime = new Date(startIso).getTime();
                const endTime = new Date(endIso).getTime();
                const durationMin = (endTime - startTime) / 60000;

                if (!isNaN(startTime) && durationMin > 0) {
                    // Calculate cadence as steps per minute
                    const cadence = steps / durationMin;
                    // Only keep reasonable running cadence values (120-220 spm)
                    if (cadence >= 100 && cadence <= 250) {
                        this.cadenceRecords.push({
                            time: startTime,
                            value: Math.round(cadence),
                            steps: steps,
                            duration: durationMin
                        });
                    }
                }
            }
        }

        // Keep unprocessed part (anything after last complete record, or last 500 chars as safety)
        const keepFrom = lastMatchEnd > 0 ? lastMatchEnd : Math.max(0, buffer.length - 500);
        return { remaining: buffer.slice(keepFrom) };
    }

    // Associate all record types with workouts based on time overlap
    associateRecordsWithWorkouts() {
        // Sort all records by time for efficient lookup
        this.heartRateRecords.sort((a, b) => a.time - b.time);
        this.cadenceRecords.sort((a, b) => a.time - b.time);
        this.strideLengthRecords.sort((a, b) => a.time - b.time);

        for (const workout of this.workouts) {
            if (!workout.dateObj) continue;

            const workoutStart = workout.dateObj.getTime();
            const workoutEnd = workoutStart + (workout.duration * 60 * 1000); // duration is in minutes

            // Find all HR records within this workout's time range
            if (this.heartRateRecords.length > 0) {
                const workoutHR = this.heartRateRecords.filter(hr =>
                    hr.time >= workoutStart && hr.time <= workoutEnd
                );
                if (workoutHR.length > 0) {
                    workout.heartRateData = workoutHR;
                }
            }

            // Find all cadence records within this workout's time range
            if (this.cadenceRecords.length > 0) {
                const workoutCadence = this.cadenceRecords.filter(c =>
                    c.time >= workoutStart && c.time <= workoutEnd
                );
                if (workoutCadence.length > 0) {
                    workout.cadenceData = workoutCadence;
                    // Calculate average cadence from detailed data
                    const avgCadence = workoutCadence.reduce((sum, c) => sum + c.value, 0) / workoutCadence.length;
                    workout.cadenceAvg = Math.round(avgCadence);
                }
            }

            // Find all stride length records within this workout's time range
            if (this.strideLengthRecords.length > 0) {
                const workoutStride = this.strideLengthRecords.filter(s =>
                    s.time >= workoutStart && s.time <= workoutEnd
                );
                if (workoutStride.length > 0) {
                    workout.strideLengthData = workoutStride;
                    // Calculate average stride length from detailed data
                    const avgStride = workoutStride.reduce((sum, s) => sum + s.value, 0) / workoutStride.length;
                    workout.strideLengthAvg = avgStride;
                }
            }
        }
    }

    // Extract workout elements from buffer
    extractWorkouts(buffer) {
        let remaining = buffer;
        let lastIndex = 0;
        let searchStart = 0;

        while (searchStart < buffer.length) {
            const workoutStart = buffer.indexOf('<Workout', searchStart);
            if (workoutStart === -1) break;

            const tagEnd = buffer.indexOf('>', workoutStart);
            if (tagEnd === -1) {
                remaining = buffer.slice(workoutStart);
                break;
            }

            const openingTag = buffer.slice(workoutStart, tagEnd + 1);

            // Self-closing tag
            if (openingTag.endsWith('/>')) {
                if (openingTag.includes('HKWorkoutActivityTypeRunning')) {
                    const workout = this.parseWorkoutElement(openingTag);
                    if (workout) this.workouts.push(workout);
                }
                lastIndex = tagEnd + 1;
                searchStart = lastIndex;
                continue;
            }

            // Find closing tag
            const closingTag = '</Workout>';
            const workoutEnd = buffer.indexOf(closingTag, tagEnd);

            if (workoutEnd === -1) {
                remaining = buffer.slice(workoutStart);
                break;
            }

            if (openingTag.includes('HKWorkoutActivityTypeRunning')) {
                const workoutXml = buffer.slice(workoutStart, workoutEnd + closingTag.length);
                const workout = this.parseWorkoutElement(workoutXml);
                if (workout) this.workouts.push(workout);
            }

            lastIndex = workoutEnd + closingTag.length;
            searchStart = lastIndex;
        }

        if (lastIndex > 0) {
            remaining = buffer.slice(lastIndex);
        }

        return { remaining };
    }

    // Parse a single workout element
    parseWorkoutElement(xml) {
        try {
            const workout = {
                id: `apple_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                source: 'apple',
                startDate: this.extractAttribute(xml, 'startDate'),
                endDate: this.extractAttribute(xml, 'endDate'),
                duration: parseFloat(this.extractAttribute(xml, 'duration')) || 0,
                durationUnit: this.extractAttribute(xml, 'durationUnit') || 'min',
                sourceName: this.extractAttribute(xml, 'sourceName') || 'Apple Health',
                creationDate: this.extractAttribute(xml, 'creationDate'),
                distanceKm: 0,
                distanceMi: 0,
                calories: 0,
                heartRateAvg: null,
                heartRateMin: null,
                heartRateMax: null,
                cadenceAvg: null,
                strideLengthAvg: null,
                speedAvg: null
            };

            // Parse WorkoutStatistics
            const statsPattern = /<WorkoutStatistics[^>]+\/>/g;
            let statsMatch;

            while ((statsMatch = statsPattern.exec(xml)) !== null) {
                const statXml = statsMatch[0];
                const type = this.extractAttribute(statXml, 'type');

                switch (type) {
                    case 'HKQuantityTypeIdentifierDistanceWalkingRunning':
                        const distance = parseFloat(this.extractAttribute(statXml, 'sum')) || 0;
                        const unit = this.extractAttribute(statXml, 'unit') || 'mi';
                        if (unit === 'mi') {
                            workout.distanceMi = distance;
                            workout.distanceKm = distance * 1.60934;
                        } else {
                            workout.distanceKm = distance;
                            workout.distanceMi = distance / 1.60934;
                        }
                        break;
                    case 'HKQuantityTypeIdentifierActiveEnergyBurned':
                        workout.calories = parseFloat(this.extractAttribute(statXml, 'sum')) || 0;
                        break;
                    case 'HKQuantityTypeIdentifierHeartRate':
                        workout.heartRateAvg = parseFloat(this.extractAttribute(statXml, 'average')) || null;
                        workout.heartRateMin = parseFloat(this.extractAttribute(statXml, 'minimum')) || null;
                        workout.heartRateMax = parseFloat(this.extractAttribute(statXml, 'maximum')) || null;
                        break;
                    case 'HKQuantityTypeIdentifierRunningStrideLength':
                        workout.strideLengthAvg = parseFloat(this.extractAttribute(statXml, 'average')) || null;
                        break;
                    case 'HKQuantityTypeIdentifierRunningSpeed':
                        workout.speedAvg = parseFloat(this.extractAttribute(statXml, 'average')) || null;
                        break;
                }
            }

            // Try to get step count for cadence calculation
            const stepMatch = xml.match(/<WorkoutStatistics[^>]*type="HKQuantityTypeIdentifierStepCount"[^>]*\/>/);
            if (stepMatch) {
                const steps = parseFloat(this.extractAttribute(stepMatch[0], 'sum')) || 0;
                if (workout.duration > 0) {
                    workout.cadenceAvg = Math.round(steps / workout.duration);
                }
            }

            // Parse date
            if (workout.startDate) {
                const isoDate = workout.startDate.replace(' ', 'T').replace(' ', '');
                workout.dateObj = new Date(isoDate);
                workout.date = workout.dateObj.toISOString();
                workout.year = workout.dateObj.getFullYear();
                workout.displayDate = workout.dateObj.toLocaleDateString('en-US', {
                    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
                });
            }

            // Calculate pace
            if (workout.distanceKm > 0 && workout.duration > 0) {
                workout.pace = workout.duration / workout.distanceKm;
                workout.paceFormatted = this.formatPace(workout.pace);
            } else {
                workout.pace = 0;
                workout.paceFormatted = '--:--';
            }

            // Format duration
            workout.durationFormatted = this.formatDuration(workout.duration);

            // Create unique ID based on date and distance
            workout.id = `apple_${workout.date}_${workout.distanceKm.toFixed(2)}`;

            return workout;
        } catch (e) {
            console.error('Error parsing workout:', e);
            return null;
        }
    }

    // Extract XML attribute value
    extractAttribute(xml, attr) {
        const pattern = new RegExp(`${attr}="([^"]*)"`, 'i');
        const match = xml.match(pattern);
        return match ? this.decodeXmlEntities(match[1]) : null;
    }

    // Decode XML entities
    decodeXmlEntities(str) {
        return str
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'");
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

// Create global parser instance
const appleParser = new AppleHealthParser();
