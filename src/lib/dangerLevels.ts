/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from 'fs';
import * as path from 'path';
import { calculateDistance } from './utils';

export type DangerLevel =
  | 'extreme'
  | 'very high'
  | 'high'
  | 'medium'
  | 'low'
  | 'normal'
  | 'no risk';

export interface EnvironmentalData {
  temperature: number;
  airQuality?: number;
  windSpeed?: number;
  humidity?: number;
  drynessIndex?: number;
  timeOfDay?: number; // 0..23 local hour
  location: {
    lat: number;
    lng: number;
  };
}

export interface DangerAssessment {
  level: DangerLevel;
  description: string;
}

/** 
 * If you're fetching the BC active fire data, define the URL here. 
 * If you want to skip it, set to ''.
 */
const ACTIVE_FIRE_URL =
  'https://services6.prod.bcwildfireservices.com/ubm4tcTYICKBpist/arcgis/rest/services/BCWS_FirePerimeters_PublicView/FeatureServer/0/query?returnGeometry=true&where=FIRE_STATUS%20%3C%3E%20%27Out%27&outSR=4326&outFields=*&inSR=4326&geometry=%7B%22xmin%22%3A-135%2C%22ymin%22%3A40.979898069620155%2C%22xmax%22%3A-89.99999999999999%2C%22ymax%22%3A66.51326044311188%2C%22spatialReference%22%3A%7B%22wkid%22%3A4326%7D%7D&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&geometryPrecision=6&resultType=tile&f=geojson';

/* =========================================
   PART 2) BASIC THRESHOLD LOGIC
   ========================================= */

export function assessDangerLevel(data: EnvironmentalData): DangerAssessment {
  const TEMP_THRESHOLDS = {
    extreme: 60,
    veryHigh: 45,
    high: 35,
    medium: 25,
    low: 15,
    normal: 5,
  };

  const AQI_THRESHOLDS = {
    extreme: 300,
    veryHigh: 200,
    high: 150,
    medium: 100,
    low: 50,
    normal: 0,
  };

  let tempLevel: DangerLevel = 'no risk';
  let aqiLevel: DangerLevel = 'no risk';

  // Temperature classification
  if (data.temperature >= TEMP_THRESHOLDS.extreme) {
    tempLevel = 'extreme';
  } else if (data.temperature >= TEMP_THRESHOLDS.veryHigh) {
    tempLevel = 'very high';
  } else if (data.temperature >= TEMP_THRESHOLDS.high) {
    tempLevel = 'high';
  } else if (data.temperature >= TEMP_THRESHOLDS.medium) {
    tempLevel = 'medium';
  } else if (data.temperature >= TEMP_THRESHOLDS.low) {
    tempLevel = 'low';
  } else if (data.temperature >= TEMP_THRESHOLDS.normal) {
    tempLevel = 'normal';
  }

  // Air-quality classification
  if (data.airQuality !== undefined) {
    if (data.airQuality >= AQI_THRESHOLDS.extreme) {
      aqiLevel = 'extreme';
    } else if (data.airQuality >= AQI_THRESHOLDS.veryHigh) {
      aqiLevel = 'very high';
    } else if (data.airQuality >= AQI_THRESHOLDS.high) {
      aqiLevel = 'high';
    } else if (data.airQuality >= AQI_THRESHOLDS.medium) {
      aqiLevel = 'medium';
    } else if (data.airQuality >= AQI_THRESHOLDS.low) {
      aqiLevel = 'low';
    } else {
      aqiLevel = 'normal';
    }
  }

  const dangerLevels: DangerLevel[] = [
    'no risk',
    'normal',
    'low',
    'medium',
    'high',
    'very high',
    'extreme',
  ];
  const overallLevel: DangerLevel = dangerLevels[
    Math.max(dangerLevels.indexOf(tempLevel), dangerLevels.indexOf(aqiLevel))
  ];

  let description = '';
  if (overallLevel !== 'no risk') {
    description = `Temperature classification: ${tempLevel}. AQI classification: ${aqiLevel}.`;
  } else {
    description = 'No significant environmental concerns detected.';
  }

  return {
    level: overallLevel,
    description,
  };
}

/* =========================================
   PART 3) HISTORICAL RECORD LOADING
   ========================================= */

interface HistoricalFireRecord {
  fire_id: string;
  date: string; // "YYYY-MM-DD"
  cause: string;
  area_burned: number;
  severity: string;
  location: {
    latitude: number;
    longitude: number;
  };
  incident_name?: string | null;
}

const historicalData: HistoricalFireRecord[] = [];
let loaded = false;

function unifyRecord(raw: any): HistoricalFireRecord | null {
  let dateStr: string | null = null;
  const hasYear = raw.Year !== undefined && raw.Month !== undefined;
  if (hasYear) {
    const y = parseInt(raw.Year, 10);
    const m = parseInt(raw.Month, 10);
    const d = parseInt(raw.Day, 10);
    const safeMonth = m >= 1 && m <= 12 ? m : 1;
    const safeDay = d >= 1 && d <= 31 ? d : 1;
    dateStr = `${String(y).padStart(4, '0')}-${String(safeMonth).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
  } else if (raw.date && typeof raw.date === 'string') {
    dateStr = raw.date;
  }
  if (!dateStr) {
    dateStr = '1970-01-01';
  }

  const cause = unifyCause(raw.cause);
  const severity = unifySeverity(raw.severity);

  let area = 0;
  if (typeof raw.area_burned === 'number' && !isNaN(raw.area_burned)) {
    area = raw.area_burned;
  }

  if (
    !raw.location ||
    typeof raw.location.latitude !== 'number' ||
    typeof raw.location.longitude !== 'number'
  ) {
    return null;
  }

  const fireId = raw.fire_id ? String(raw.fire_id) : 'unknown-id';
  let incident: string | null = null;
  if (raw.incident_name && typeof raw.incident_name === 'string') {
    incident = raw.incident_name;
  }

  return {
    fire_id: fireId,
    date: dateStr,
    cause,
    area_burned: area,
    severity,
    location: {
      latitude: raw.location.latitude,
      longitude: raw.location.longitude,
    },
    incident_name: incident,
  };
}

function unifyCause(causeVal: any): string {
  if (!causeVal || typeof causeVal !== 'string') return 'Unknown';
  const c = causeVal.trim().toUpperCase();
  if (['MAN', 'PERSON', 'H'].includes(c)) return 'Human';
  if (['LTG', 'LIGHTNING'].includes(c)) return 'Lightning';
  if (['SPONTANEOUS', 'SPONT'].includes(c)) return 'Spontaneous';
  return c; // fallback
}

function unifySeverity(sevVal: any): string {
  if (!sevVal || typeof sevVal !== 'string') return 'low';
  const s = sevVal.trim().toLowerCase();
  if (s.includes('very low')) return 'low';
  if (s.includes('extreme')) return 'extreme';
  if (s.includes('very high')) return 'very high';
  return s;
}

export function loadHistoricalWildfireData(): void {
  if (loaded) return;

  const files = [
    'wildfire_data_1_part1.json',
    'wildfire_data_1_part2.json',
    'wildfire_data_part1.json',
    'wildfire_data_part2.json',
    'wildfire_data_2.json',
  ];

  for (const fileName of files) {
    try {
      const filePath = path.join(process.cwd(), 'public', fileName);
      let fileContents = fs.readFileSync(filePath, 'utf8');
      fileContents = fileContents.replace(/\bNaN\b/g, 'null');
      const rawArray = JSON.parse(fileContents) as any[];
      for (const raw of rawArray) {
        const rec = unifyRecord(raw);
        if (rec) {
          historicalData.push(rec);
        }
      }
    } catch (err) {
      console.error(`Failed to load file ${fileName}:`, err);
    }
  }

  loaded = true;
  console.log(`Loaded ${historicalData.length} total unified wildfire records.`);
}

/* =========================================
   PART 4) WEIGHTING & PENALTY FUNCTIONS
   (All used inside computeRiskFromHistoryAndRealTime)
   ========================================= */

/** Weighted Recency Factor */
function getRecencyFactor(dateStr: string): number {
  const now = new Date();
  const fireDate = new Date(dateStr);
  const msInYear = 1000 * 3600 * 24 * 365;
  const yearsAgo = (now.getTime() - fireDate.getTime()) / msInYear;

  if (yearsAgo <= 2) return 1.0;
  if (yearsAgo <= 5) return 0.8;
  if (yearsAgo <= 10) return 0.5;
  return 0.2;
}

/** Cause-Based Weighting */
function getCauseFactor(cause: string): number {
  const c = cause.toLowerCase();
  if (c === 'lightning') return 1.2;
  if (c === 'human') return 1.1;
  if (c === 'spontaneous') return 1.05;
  return 1.0;
}

/** Region-Specific Seasonality Factor 
    We now actually use lat/lng to demonstrate usage. */
function getSeasonalityFactor(fireDateStr: string, lat: number, lng: number): number {
  const now = new Date();
  const fireDate = new Date(fireDateStr);
  const currentMonth = now.getMonth();
  const fireMonth = fireDate.getMonth();

  let factor = 1.0;

  // Example region-based tweak: if lat>55 => slightly longer season
  if (lat > 55) {
    factor *= 1.05;
  }
  // if lng < -120 => maybe dryness is higher
  if (lng < -120) {
    factor *= 1.02;
  }

  // Month-based logic
  if (fireMonth === currentMonth) {
    factor *= 1.15; 
  }
  // Typical "May--Sep"
  if (fireMonth >= 4 && fireMonth <= 8) {
    factor *= 1.1;
  }

  return factor;
}

/** Distance-based weighting:
    e.g. <=10 km => factor=1.0, at max => ~0.1 */
function getDistanceWeight(distKm: number, maxRadius: number): number {
  if (distKm <= 10) return 1.0;
  if (distKm >= maxRadius) return 0.1;
  const ratio = (distKm - 10) / (maxRadius - 10);
  return 1.0 - 0.9 * ratio; // from 1.0 down to 0.1
}

/** Consecutive-year penalty */
function getConsecutiveYearPenalty(fires: HistoricalFireRecord[]): number {
  if (fires.length < 2) return 0;
  const years = fires.map((f) => new Date(f.date).getFullYear()).sort((a, b) => a - b);

  let totalPenalty = 0;
  let consecutiveCount = 1;
  for (let i = 0; i < years.length - 1; i++) {
    if (years[i + 1] === years[i] + 1) {
      consecutiveCount++;
    } else {
      if (consecutiveCount >= 2) {
        totalPenalty += getPenaltyByConsecutiveCount(consecutiveCount);
      }
      consecutiveCount = 1;
    }
  }
  // final run
  if (consecutiveCount >= 2) {
    totalPenalty += getPenaltyByConsecutiveCount(consecutiveCount);
  }
  return totalPenalty;
}
function getPenaltyByConsecutiveCount(count: number): number {
  if (count === 2) return 0.2;
  if (count === 3) return 0.5;
  if (count >= 4) return 1.0;
  return 0;
}

/** Overlapping fires penalty */
function getOverlappingFiresPenalty(fires: HistoricalFireRecord[]): number {
  const yearCounts: Record<number, number> = {};
  for (const f of fires) {
    const y = new Date(f.date).getFullYear();
    yearCounts[y] = (yearCounts[y] || 0) + 1;
  }

  let penalty = 0;
  for (const yStr of Object.keys(yearCounts)) {
    const count = yearCounts[+yStr];
    if (count > 1) {
      penalty += (count - 1) * 0.1;
    }
  }
  return penalty;
}

/** Simple severity weighting with optional region-based logic. */
function adjustSeverityForLandscape(
  severity: string,
  yearsAgo: number,
  terrainType: 'grassland' | 'forest' | 'unknown'
): number {
  let base = 0;
  const s = severity.toLowerCase();
  if (s.includes('extreme') || s.includes('very high')) base = 3;
  else if (s.includes('high')) base = 2;
  else if (s.includes('medium')) base = 1;
  // low => 0

  // if terrain recovers quickly, reduce older fires
  if (terrainType === 'grassland' && yearsAgo > 5) {
    base *= 0.5;
  }
  return base;
}

/* =========================================
   PART 5) MAIN SCORING FUNCTION
   ========================================= */

   function computeRiskFromHistoryAndRealTime(
    env: EnvironmentalData,
    fires: HistoricalFireRecord[],
    maxRadius: number
  ): number {
    let historicalScore = 0;
    for (const fire of fires) {
      const dist = calculateDistance(
        env.location.lat,
        env.location.lng,
        fire.location.latitude,
        fire.location.longitude
      );
  
      const recencyFactor = getRecencyFactor(fire.date);
      const causeFactor = getCauseFactor(fire.cause);
      const seasonalityFactor = getSeasonalityFactor(
        fire.date,
        fire.location.latitude,
        fire.location.longitude
      );
      const distanceFactor = getDistanceWeight(dist, maxRadius);
  
      const yearsAgo = new Date().getFullYear() - new Date(fire.date).getFullYear();
      const terrainType: 'grassland' | 'forest' | 'unknown' = 'unknown';
      const severityValue = adjustSeverityForLandscape(fire.severity, yearsAgo, terrainType);
  
      const areaFactor = fire.area_burned > 500 ? 1.5 : 1.0;
  
      const fireScore =
        severityValue *
        areaFactor *
        recencyFactor *
        causeFactor *
        seasonalityFactor *
        distanceFactor;
  
      historicalScore += fireScore;
    }
  
    const consecutivePenalty = getConsecutiveYearPenalty(fires);
    const overlapPenalty = getOverlappingFiresPenalty(fires);
    const frequencyScore = Math.min(fires.length, 5);
  
    let total = historicalScore + consecutivePenalty + overlapPenalty + frequencyScore;
  
    // IMPROVED: Real-time environment factors with more aggressive scaling for extreme conditions
    // Temperature has a much stronger impact on the score
    if (env.temperature >= 60) total += 20;       // Extreme temperatures (>60°C) massively increase risk
    else if (env.temperature >= 45) total += 10;  // Very high temperatures significantly increase risk
    else if (env.temperature >= 35) total += 5;   // High temperatures increase risk
    else if (env.temperature >= 25) total += 2;   // Medium temperatures slightly increase risk
  
    if (env.airQuality !== undefined) {
      if (env.airQuality >= 300) total += 5;      // Extreme AQI
      else if (env.airQuality >= 200) total += 3; // Very high AQI
      else if (env.airQuality >= 150) total += 2; // High AQI
      else if (env.airQuality >= 100) total += 1; // Medium AQI
    }
  
    if (env.drynessIndex !== undefined) {
      if (env.drynessIndex >= 90) total += 8;     // Extremely dry conditions
      else if (env.drynessIndex >= 80) total += 5;
      else if (env.drynessIndex >= 60) total += 2;
    }
  
    // Humidity is inversely proportional to risk
    if (env.humidity !== undefined) {
      if (env.humidity < 10) total += 6;          // Extremely dry air
      else if (env.humidity < 20) total += 3;     // Very dry air
      else if (env.humidity < 30) total += 1;     // Dry air
    }
  
    // Wind speeds significantly affect fire spread
    if (env.windSpeed !== undefined) {
      if (env.windSpeed > 60) total += 8;         // Extremely high winds
      else if (env.windSpeed > 40) total += 4;    // Very high winds
      else if (env.windSpeed > 25) total += 2;    // High winds
    }
  
    if (env.timeOfDay !== undefined) {
      // Midday dryness
      if (env.timeOfDay >= 13 && env.timeOfDay <= 17) {
        total += 1;
      }
    }
  
    return total;
  }

/* =========================================
   PART 6) getWildfireRisk ENTRY POINT
   (with adaptive radius & optional active-fire fetch)
   ========================================= */

   export async function getWildfireRisk(
    env: EnvironmentalData
  ): Promise<{ riskLevel: string; riskExplanation: string }> {
    // First, assess the basic environmental danger level
    const basicAssessment = assessDangerLevel(env);
    
    // Load the historical wildfire data
    loadHistoricalWildfireData();
  
    // Adaptive radius
    let radius = 50;
    const quickCandidate = historicalData.filter((f) => {
      const dist = calculateDistance(
        env.location.lat,
        env.location.lng,
        f.location.latitude,
        f.location.longitude
      );
      return dist <= 50;
    });
  
    if (quickCandidate.length > 20) {
      radius = 30;
    } else if (quickCandidate.length < 5) {
      radius = 75;
    }
  
    const candidateFires = historicalData.filter((fire) => {
      const dist = calculateDistance(
        env.location.lat,
        env.location.lng,
        fire.location.latitude,
        fire.location.longitude
      );
      return dist <= radius;
    });
  
    candidateFires.sort((a, b) => {
      const distA = calculateDistance(
        env.location.lat,
        env.location.lng,
        a.location.latitude,
        a.location.longitude
      );
      const distB = calculateDistance(
        env.location.lat,
        env.location.lng,
        b.location.latitude,
        b.location.longitude
      );
      return distA - distB;
    });
    const nearestFires = candidateFires.slice(0, 15);
  
    let totalScore = computeRiskFromHistoryAndRealTime(env, nearestFires, radius);
  
    let activeFireNote = '';
    if (ACTIVE_FIRE_URL) {
      const penalty = await getActiveFirePenalty(env);
      if (penalty > 0) {
        totalScore += penalty;
        activeFireNote = `\nActive Fire Penalty = ${penalty}. Location is near/inside an active perimeter.`;
      }
    }
  
    // Determine risk level based on score AND basic assessment
    // This ensures extreme temperatures always result in at least high risk
    let riskLevel = determineRiskLevel(totalScore, basicAssessment.level);
  
    const riskExplanation = `
      Adaptive Radius: ${radius} km
      Found ${nearestFires.length} fires within radius
      Basic Assessment: ${basicAssessment.level} (${basicAssessment.description})
      Final Score: ${totalScore.toFixed(2)} => ${riskLevel}.${activeFireNote}
    `;
  
    return { riskLevel, riskExplanation };
  }

  function determineRiskLevel(totalScore: number, basicAssessmentLevel: DangerLevel): DangerLevel {
    // First determine score-based risk level
    let scoreBasedRisk: DangerLevel = 'no risk';
    if (totalScore >= 35) {
      scoreBasedRisk = 'extreme';
    } else if (totalScore >= 20) {
      scoreBasedRisk = 'very high';
    } else if (totalScore >= 12) {
      scoreBasedRisk = 'high';
    } else if (totalScore >= 6) {
      scoreBasedRisk = 'medium';
    } else if (totalScore >= 2) {
      scoreBasedRisk = 'low';
    }
  
    // Define danger level hierarchy for comparison
    const dangerLevels: DangerLevel[] = [
      'no risk',
      'normal',
      'low',
      'medium',
      'high',
      'very high',
      'extreme',
    ];
    
    // Return the higher of the two risk levels
    const scoreBasedIndex = dangerLevels.indexOf(scoreBasedRisk);
    const basicAssessmentIndex = dangerLevels.indexOf(basicAssessmentLevel);
    
    return dangerLevels[Math.max(scoreBasedIndex, basicAssessmentIndex)];
  }
  

/* =========================================
   PART 7) Active-Fire GeoJSON Check
   ========================================= */

// Fixing TypeScript errors with proper typing
interface GeoJsonFeature {
  geometry: {
    type: string;
    coordinates: any;
  };
}

interface GeoJsonResponse {
  features: GeoJsonFeature[];
}

async function getActiveFirePenalty(env: EnvironmentalData): Promise<number> {
  try {
    const res = await fetch(ACTIVE_FIRE_URL);
    if (!res.ok) {
      console.error('Active fire fetch failed:', res.statusText);
      return 0;
    }
    // Fix TypeScript errors by properly typing the geojson response
    const geojson = await res.json() as GeoJsonResponse;

    const lat = env.location.lat;
    const lng = env.location.lng;

    // We'll do a naive bounding-box check on each feature
    if (!geojson.features || !Array.isArray(geojson.features)) {
      return 0;
    }

    for (const feature of geojson.features) {
      const geometry = feature.geometry;
      if (!geometry) continue;

      // For demonstration, if it's a Polygon or MultiPolygon, 
      // get the bounding box from all coords.
      const coords = geometry.coordinates;
      if (!coords) continue;

      const boundingBox = getBoundingBox(geometry.type, coords);
      // If bounding box contains our lat/lng => we apply penalty
      if (isPointInBoundingBox(lat, lng, boundingBox)) {
        // You might do a deeper "point in polygon" test, but let's just penalty once.
        return 5; // we used to store this in ACTIVE_FIRE_PENALTY, but let's just return 5
      }
    }

    return 0;
  } catch (error) {
    console.error('Error fetching active-fire data:', error);
    return 0;
  }
}

function getBoundingBox(type: string, coords: any): [number, number, number, number] {
  // bounding box [minLat, minLng, maxLat, maxLng]
  // We'll accumulate min/max from all polygon points
  let minLat = 9999, maxLat = -9999, minLng = 9999, maxLng = -9999;

  // Polygons: coords = [ [ [lng, lat], ... ] ]
  // MultiPolygons: coords = [ [ [ [lng, lat], ... ] ], ... ]
  if (type === 'Polygon') {
    // coords[0] is the ring
    for (const [lng, lat] of coords[0]) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  } else if (type === 'MultiPolygon') {
    // coords = [ [ [ [lng, lat], ... ] ], [ [ ... ] ] ]
    for (const polygon of coords) {
      for (const ring of polygon) {
        for (const [lngVal, latVal] of ring) {
          if (latVal < minLat) minLat = latVal;
          if (latVal > maxLat) maxLat = latVal;
          if (lngVal < minLng) minLng = lngVal;
          if (lngVal > maxLng) maxLng = lngVal;
        }
      }
    }
  }

  return [minLat, minLng, maxLat, maxLng];
}

function isPointInBoundingBox(lat: number, lng: number, box: [number, number, number, number]): boolean {
  // box = [minLat, minLng, maxLat, maxLng]
  const [minLat, minLng, maxLat, maxLng] = box;
  return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
}