const BASE_URL = "https://a.windbornesystems.com/treasure";

const BALLOON_ALT_UNIT = "km";

function balloonAltToMeters(altRaw) {
    if (altRaw == null) return null;
    if (BALLOON_ALT_UNIT === "km") return altRaw * 1000;
    if (BALLOON_ALT_UNIT === "ft") return altRaw * 0.3048;
    return altRaw; // already meters
}

async function fetchSnapshotRaw(hourAgo = 0) {
    const suffix = hourAgo.toString().padStart(2, "0");
    const url = `${BASE_URL}/${suffix}.json`;

    try {
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }

        let data;
        try {
            data = await res.json();
        } catch (err) {
            console.error(`Failed to parse JSON for ${suffix}.json:`, err.message);
            return null;
        }

        if (!Array.isArray(data)) {
            console.warn(`Unexpected structure for ${suffix}.json (expected array).`);
        }

        return data;
    } catch (err) {
        console.error(`Error fetching ${suffix}.json:`, err.message);
        return null;
    }
}

function computeBalloonAltitudeRange(points) {
    let minAlt = Infinity;
    let maxAlt = -Infinity;

    for (const p of points) {
        const a = p.alt_m;
        if (typeof a !== "number" || !isFinite(a)) continue;
        if (a < minAlt) minAlt = a;
        if (a > maxAlt) maxAlt = a;
    }

    if (!isFinite(minAlt)) return null;

    return { minAlt, maxAlt };
}

/**
 * Normalize raw array data into {id, lon, lat, alt, hourAgo}
 * Raw format is like: [ [lon, lat, alt], ... ]
 */
function normalizeSnapshot(raw, hourAgo) {
    if (!Array.isArray(raw)) return [];

    // loop through each triple and norm it
    const normalized = []
    let idx = 0;
    for (const triple of raw) {
        if (!Array.isArray(triple) || triple.length < 2) continue;
        const [lon, lat, alt = null] = triple;

        if (typeof lon !== "number" || typeof lat !== "number") continue;

        normalized.push({
            name: `b-${hourAgo}-${idx}`, // made up
            lon,
            lat,
            alt,      // maybe in kms?
            alt_m: balloonAltToMeters(alt),
            hourAgo,
            mag: 1,
            category: 'Balloon'
        });
        idx++;
    }
    return normalized;
}

/**
 * Fetch and normalize a single snapshot.
 */
async function fetchSnapshot(hourAgo = 0) {
    const raw = await fetchSnapshotRaw(hourAgo);
    if (!raw) return [];
    const points = normalizeSnapshot(raw, hourAgo);
    console.log(
        `Snapshot T-${hourAgo}h: ${points.length} valid balloon points`
    );
    return points;
}

/**
 * Compute a bounding box over a set of balloon points.
 * Returns [[minLat, minLon], [maxLat, maxLon]] padded by `padDeg`.
 */
function computeBoundingBox(points, padDeg = 2) {
    if (!points.length) return null; // fallback to no world

    let minLat = Infinity,
        maxLat = -Infinity,
        minLon = Infinity,
        maxLon = -Infinity;

    // loop through each point and find the min and max lat and lon
    for (const p of points) {
        if (typeof p.lat !== "number" || typeof p.lon !== "number") continue;
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lon < minLon) minLon = p.lon;
        if (p.lon > maxLon) maxLon = p.lon;
    }

    if (!isFinite(minLat)) return null;

    // pad the min and max lat and lon
    minLat = Math.max(-90, minLat - padDeg); // -90 is the min lat
    maxLat = Math.min(90, maxLat + padDeg); // 90 is the max lat
    minLon = Math.max(-180, minLon - padDeg); // -180 is the min lon
    maxLon = Math.min(180, maxLon + padDeg); // 180 is the max lon

    // return the min and max lat and lon
    return [
        [minLat, minLon],
        [maxLat, maxLon],
    ];
} // this kind of defines the bounding box of the balloon points we are interested in

module.exports = {
    fetchSnapshot,
    computeBoundingBox,
    computeBalloonAltitudeRange,
};
