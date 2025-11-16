const map = new maplibregl.Map({
    container: 'map',
    style: 'https://demotiles.maplibre.org/globe.json',
    center: [0, 0],
    zoom: 2.4,
})


map.addControl(new maplibregl.NavigationControl({
    visualizePitch: true,
    visualizeRoll: true,
    showZoom: true,
    showCompass: true
}), 'top-right');

map.scrollZoom.enable();
map.dragPan.enable();
map.dragRotate.enable();
map.doubleClickZoom.enable();
map.keyboard.enable();

const secondsPerRev = 60;
const maxSpinZoom = 5;
const slowSpinZoom = 3;
const spinStepDuration = 1000; // ms

let spinEnabled = true;
let spinTimeoutId = null;

const clearSpinTimeout = () => {
    if (spinTimeoutId) {
        clearTimeout(spinTimeoutId);
        spinTimeoutId = null;
    }
};

const spinGlobe = () => {
    if (!spinEnabled) return;

    const zoom = map.getZoom();
    if (zoom >= maxSpinZoom) return;

    let distancePerSecond = 360 / secondsPerRev;

    if (zoom > slowSpinZoom) {
        const zoomDiff = (maxSpinZoom - zoom) / (maxSpinZoom - slowSpinZoom);
        distancePerSecond *= zoomDiff;
    }

    const center = map.getCenter();
    center.lng -= distancePerSecond;

    map.easeTo({
        center,
        duration: spinStepDuration,
        easing: n => n
    });

    // schedule next step as long as spinning is still enabled
    spinTimeoutId = setTimeout(spinGlobe, spinStepDuration);
};

const startSpin = () => {
    if (!spinEnabled) return;
    clearSpinTimeout();
    spinGlobe();
};

const onInteractionStart = () => {
    if (!spinEnabled) return;
    spinEnabled = false;           // permanently disable further spins
    clearSpinTimeout();
    map.stop();
};

map.on('mousedown', onInteractionStart);
map.on('dragstart', onInteractionStart);
map.on('rotatestart', onInteractionStart);
map.on('pitchstart', onInteractionStart);
map.on('touchstart', onInteractionStart);
map.on('wheel', onInteractionStart);

particlesJS.load('particles-js', '/js/config-particles.json', function () {
    console.log('callback - particles.js config loaded');
});


const BALLOON_URL = "/api/balloons";
const FLIGHT_URL = "/api/flights";

const renderPoints = (rawPoints, color, layerId, map, radius) => {
    const features = rawPoints.map(p => ({
        type: 'Feature',
        properties: {
            name: p.name,   
            magnitude: p.mag,
            category: p.category
        },
        geometry: {
            type: 'Point',
            coordinates: [p.lon, p.lat]
        }
    }));

    const geojson = {
        type: 'FeatureCollection',
        features: features
    };

    map.addSource(`${layerId}-source`, {
        type: 'geojson',
        data: geojson
    });

    map.addLayer({
        id: layerId,
        type: 'circle',
        source: `${layerId}-source`,
        paint: {
            'circle-radius': radius,
            'circle-color': color,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff'
        }
    });
}

map.on('load', async () => {
    startSpin(); // start spinning immediately on load
    console.log('map loaded');

    const balloons = await fetch(`${BALLOON_URL}`).then(res => res.json()).then(data => data.balloons);
    const flights = await fetch(`${FLIGHT_URL}`).then(res => res.json()).then(data => data.flights);
    const nearbyFlights = await fetch(`${BALLOON_URL}`).then(res => res.json()).then(data => data.nearbyFlights);

    renderPoints(balloons, '#0000ff', 'balloons', map, 5); // blue balloons
    renderPoints(flights, '#ff0000', 'flights', map, 5); // red flights
    renderPoints(nearbyFlights, 'rgba(0, 0, 0, 0.3)', 'nearby-flights', map, 10);
});