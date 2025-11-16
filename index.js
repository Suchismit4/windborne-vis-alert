const { fetchSnapshot, computeBoundingBox } = require("./windborne");
const { fetchFlightsForBalloons, findFlightsNearBalloons } = require("./flights");

const path = require("path");
const express = require("express");

let currentBalloons = [];
let currentFlights = [];

async function updateBalloons() {
    try {
        try {
            currentBalloons = await fetchSnapshot(0);
        } catch (err) {
            console.error("Failed to fetch balloons at T-0h:", err.message);
            currentBalloons = await fetchSnapshot(1);
            console.log(`Failed to fetch balloons at T-0h, updated at T-1h, now have ${currentBalloons.length} points.`);
        }
    } catch (err) {
        console.error("Failed to update:", err.message);
    }
}

async function bootstrap() {
    await updateBalloons();
    currentFlights = await fetchFlightsForBalloons(currentBalloons);
    if (!currentBalloons.length) {
        console.error("No balloon data, aborting.");
        process.exit(1);
    }

    const app = express();

    app.set("view engine", "ejs");
    app.set("views", path.join(__dirname, "views"));

    // static assets
    app.use(express.static(path.join(__dirname, "public")));

    // Home page
    app.get("/", (req, res) => {
        res.render("index"); // views/index.ejs
    });

    // Live state API
    app.get("/api/balloons", async (req, res) => {
        await updateBalloons();
        currentFlights = await fetchFlightsForBalloons(currentBalloons);
        const nearbyFlights = findFlightsNearBalloons(
            currentBalloons,
            currentFlights,
            50 // radius in km; tweak or make query param
        );
        res.send(JSON.stringify({  
            balloons: currentBalloons,
            nearbyFlights: nearbyFlights,
        }));
    });

    app.get("/api/flights", async (req, res) => {
        await updateBalloons();
        currentFlights = await fetchFlightsForBalloons(currentBalloons);
        res.send(JSON.stringify({  
            flights: currentFlights,
        }));
    });

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Server listening on http://localhost:${PORT}`);
    });
}

bootstrap().catch((err) => {
    console.error("Fatal error in bootstrap:", err);
    process.exit(1);
});
