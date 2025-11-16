const FLIGHT_API_URL = "https://opensky-network.org/api/states/all";

const { computeBoundingBox, computeBalloonAltitudeRange } = require("./windborne");

const GROUND_BUFFER_M = 1000;  // 500 m above ground
const TOP_BUFFER_M = 100;     // 100 m below max balloon

function buildAltitudeWindowFromBalloons(points, opts = {}) {
    const range = computeBalloonAltitudeRange(points);
    if (!range) return null;

    const groundBuffer = opts.groundBuffer ?? GROUND_BUFFER_M;
    const topBuffer = opts.topBuffer ?? TOP_BUFFER_M;

    let minAlt = groundBuffer;
    let maxAlt = range.maxAlt - topBuffer;

    if (!isFinite(minAlt) || !isFinite(maxAlt)) return null;

    if (minAlt >= maxAlt) return null;

    return { minAlt, maxAlt };
}

async function fetchFlightsRaw(bbox) {
    if (!bbox) return [];

    const [[minLat, minLon], [maxLat, maxLon]] = bbox;

    const params = new URLSearchParams({
        lamin: String(minLat),
        lamax: String(maxLat),
        lomin: String(minLon),
        lomax: String(maxLon),
    });

    const url = `${FLIGHT_API_URL}?${params.toString()}`;

    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Flight API HTTP ${res.status} ${res.statusText}`);
    }

    const data = await res.json();

    if (!data || !Array.isArray(data.states)) {
        return [];
    }

    return data.states;
}

function normalizeFlights(states) {
    if (!Array.isArray(states)) return [];

    const normalized = [];

    for (let i = 0; i < states.length; i++) {
        const s = states[i];
        if (!Array.isArray(s)) continue;

        const [
            icao24,          // 0
            callsignRaw,     // 1
            origin_country,  // 2
            time_position,   // 3
            last_contact,    // 4
            lon,             // 5
            lat,             // 6
            baro_altitude,   // 7 (meters)
            on_ground,       // 8
            velocity,        // 9 (m/s)
            true_track,      // 10 (deg)
            vertical_rate,   // 11 (m/s)
            sensors,         // 12 (unused here)
            geo_altitude,    // 13 (meters)
            squawk,          // 14
            spi,             // 15
            position_source, // 16
            aircraft_category // 17
        ] = s;

        if (typeof lon !== "number" || typeof lat !== "number") continue;
        if (!isFinite(lon) || !isFinite(lat)) continue;

        // Prefer geometric altitude, fall back to barometric
        const altCandidate = (typeof geo_altitude === "number" && isFinite(geo_altitude))
            ? geo_altitude
            : (typeof baro_altitude === "number" && isFinite(baro_altitude)
                ? baro_altitude
                : null);

        if (altCandidate == null) continue;

        const callsign = callsignRaw && typeof callsignRaw === "string"
            ? callsignRaw.trim()
            : null;

        const id =
            (icao24 && typeof icao24 === "string" && icao24.trim()) ||
            (callsign && callsign) ||
            `flight-${i}`;

        normalized.push({
            id,
            icao24: icao24 || null,
            callsign,
            origin_country: origin_country || null,
            lon,
            lat,
            alt_m: altCandidate,
            on_ground: !!on_ground,
            velocity: typeof velocity === "number" ? velocity : null,
            true_track: typeof true_track === "number" ? true_track : null,
            vertical_rate: typeof vertical_rate === "number" ? vertical_rate : null,
            category: "Flight",
            aircraft_category: aircraft_category ?? null,
            time_position: time_position ?? null,
            last_contact: last_contact ?? null,
        });
    }

    return normalized;
}

function filterFlightsByAltitude(flights, altRange) {
    if (!altRange) return flights;

    const { minAlt, maxAlt } = altRange;

    return flights.filter((f) => {
        if (typeof f.alt_m !== "number" || !isFinite(f.alt_m)) return false;
        if (f.on_ground) return false;
        return f.alt_m >= minAlt && f.alt_m <= maxAlt;
    });
}

async function fetchFlightsForBalloons(balloons, opts = {}) {

    if (!Array.isArray(balloons) || !balloons.length) return [];

    const bbox = computeBoundingBox(balloons);
    if (!bbox) return [];

    const altWindow = buildAltitudeWindowFromBalloons(balloons, opts);
    console.log("altWindow from balloons:", altWindow);
    if (!altWindow) return [];

    const flightsRaw = await fetchFlightsRaw(bbox);

    if (!flightsRaw.length) return [];

    const normalizedFlights = normalizeFlights(flightsRaw);
    console.log(
        "normalized flights sample alt_m:",
        normalizedFlights.slice(0, 5).map(f => f.alt_m)
    );

    return filterFlightsByAltitude(normalizedFlights, altWindow);
}

function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km

    const toRad = (deg) => (deg * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

function findFlightsNearBalloons(balloons, flights, radiusKm = 50) {
    if (!Array.isArray(balloons) || !balloons.length) return [];
    if (!Array.isArray(flights) || !flights.length) return [];

    const result = [];

    for (const flight of flights) {
        if (typeof flight.lat !== "number" || typeof flight.lon !== "number") {
            continue;
        }

        let nearestDist = Infinity;
        let nearestBalloon = null;

        for (const balloon of balloons) {
            if (typeof balloon.lat !== "number" || typeof balloon.lon !== "number") {
                continue;
            }

            const distKm = haversineKm(
                balloon.lat,
                balloon.lon,
                flight.lat,
                flight.lon
            );

            if (distKm < nearestDist) {
                nearestDist = distKm;
                nearestBalloon = balloon;
            }
        }

        if (nearestBalloon && nearestDist <= radiusKm) {
            result.push({
                ...flight,
                nearest_balloon_id: nearestBalloon.id || nearestBalloon.name || null,
                distance_to_balloon_km: nearestDist,
            });
        }
    }

    return result;
}


module.exports = {
    fetchFlightsForBalloons,
    findFlightsNearBalloons,
};