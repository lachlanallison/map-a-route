# Map a Route

A calm, fast route planner for runners and cyclists. Click to drop points, snap to real paths, see elevation, export GPX — all in your browser. No account, no server.

**Live site:** https://lachlanallison.github.io/map-a-route/

## Features

- Interactive Leaflet map with CyclOSM tiles
- Snap to roads/paths via **Valhalla** (no key required) or **OpenRouteService** (optional key)
- Elevation profile via **Open-Meteo** (with **Open-Elevation** as backup)
- GPX import and export
- Out-and-back, finish-loop helpers, and turn-by-turn directions
- Save routes locally (persisted in `localStorage`)
- Light / dark theme, miles / kilometres toggle

## OpenRouteService key

If you want to use OpenRouteService as the routing provider instead of Valhalla, users supply their own API key through the in-app settings. Keys are stored only in the user's `localStorage` — nothing is committed to the repo or sent anywhere besides OpenRouteService.

## Credits

- Tiles: [CyclOSM](https://www.cyclosm.org/)
- Map data: [OpenStreetMap](https://www.openstreetmap.org/copyright)
- Elevation: [Open-Meteo](https://open-meteo.com/)
- Routing: [Valhalla](https://valhalla.github.io/valhalla/) / [OpenRouteService](https://openrouteservice.org/)
- Map library: [Leaflet](https://leafletjs.com/)
- Charts: [Chart.js](https://www.chartjs.org/)

Built by [Lachlan](https://lachlanallison.com).

## License

MIT.
