import express, { Request, Response } from 'express';
import {
  getWildfireRisk,
  assessDangerLevel,
  EnvironmentalData,
  DangerAssessment
} from '../lib/dangerLevels';
import { calculateDistance } from '../lib/utils';

const router = express.Router();

interface DangerZone {
  temperature: number;
  airQuality: number | string;
  windSpeed?: number | string;
  humidity?: number | string;
  location: { lat: number; lng: number };
  dangerLevel: string;
  dangerDescription: string;
  timestamp: string;
}

// Keep up to 50 in-memory danger zone records
let dangerZones: DangerZone[] = [];

// SSE subscription set
const sseSubscribers = new Set<Response>();

/**
 * Build SSE data once, encode once
 */
function buildDangerZonesSSE() {
  return `data: ${JSON.stringify({ dangerZones })}\n\n`;
}

/**
 * Notify all SSE subscribers
 */
function notifySubscribers() {
  const data = buildDangerZonesSSE();
  for (const res of sseSubscribers) {
    res.write(data);
  }
}

// GET => handle SSE or normal queries
router.get('/', async (req: Request, res: Response) => {
  // 1) If requesting SSE
  if (req.query.subscribe === 'true') {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Immediately send existing data
    res.write(buildDangerZonesSSE());

    // Add to subscribers
    sseSubscribers.add(res);

    // Remove on client disconnect
    req.on('close', () => {
      sseSubscribers.delete(res);
    });
    return;
  }

  // 2) Otherwise, handle normal GET
  const Temperature = req.query.Temperature;
  const AirQuality = req.query.AirQuality;
  const LocationLat = req.query.LocationLat;
  const LocationLong = req.query.LocationLong;
  const WindSpeed = req.query.WindSpeed;
  const Humidity = req.query.Humidity;

  // If no temperature is provided, just return stored danger zones
  if (!Temperature) {
    return res.json({ dangerZones });
  }

  try {
    // Parse environment inputs
    const envData: EnvironmentalData = {
      temperature: parseFloat(Temperature as string),
      airQuality: AirQuality ? parseFloat(AirQuality as string) : undefined,
      windSpeed: WindSpeed ? parseFloat(WindSpeed as string) : undefined,
      humidity: Humidity ? parseFloat(Humidity as string) : undefined,
      location: {
        lat: LocationLat ? parseFloat(LocationLat as string) : 0,
        lng: LocationLong ? parseFloat(LocationLong as string) : 0,
      },
    };

    let dangerLevelResult: DangerAssessment | undefined;

    const hasLocation =
      LocationLat !== undefined &&
      LocationLong !== undefined &&
      !isNaN(envData.location.lat) &&
      !isNaN(envData.location.lng);

    // If location is provided, do location-based approach
    if (hasLocation) {
      const riskResult = await getWildfireRisk(envData);
      dangerLevelResult = {
        level: riskResult.riskLevel as any,
        description: riskResult.riskExplanation,
      };
    } else {
      // Fallback
      dangerLevelResult = assessDangerLevel(envData);
    }

    if (!dangerLevelResult) {
      return res.status(400).json({ error: 'Unable to calculate danger level.' });
    }

    // Construct new or updated DangerZone
    const newRecord: DangerZone = {
      temperature: envData.temperature,
      airQuality: envData.airQuality !== undefined ? envData.airQuality : 'N/A',
      windSpeed: envData.windSpeed !== undefined ? envData.windSpeed : 'N/A',
      humidity: envData.humidity !== undefined ? envData.humidity : 'N/A',
      location: {
        lat: envData.location.lat,
        lng: envData.location.lng,
      },
      dangerLevel: dangerLevelResult.level,
      dangerDescription: dangerLevelResult.description,
      timestamp: new Date().toISOString(),
    };

    // Check if an existing zone is within 5 km
    const existingIndex = dangerZones.findIndex((zone) => {
      const dist = calculateDistance(
        zone.location.lat,
        zone.location.lng,
        newRecord.location.lat,
        newRecord.location.lng
      );
      return dist < 5;
    });

    // Update if found; otherwise insert
    if (existingIndex !== -1) {
      const updatedZone = {
        ...dangerZones[existingIndex],
        ...newRecord,
      };
      dangerZones[existingIndex] = updatedZone;
      notifySubscribers();
      return res.json({ success: true, data: updatedZone });
    } else {
      dangerZones = [newRecord, ...dangerZones.slice(0, 49)];
      notifySubscribers();
      return res.json({ success: true, data: newRecord });
    }
  } catch (error) {
    console.error('Error processing data:', error);
    return res.status(500).json({ error: 'Failed to process data' });
  }
});

export default router;
