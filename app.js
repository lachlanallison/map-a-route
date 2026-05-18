const map = L.map("map", { zoomControl: true }).setView(
  [37.7749, -122.4194],
  12
);

const cyclosmTile = L.tileLayer("https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://www.cyclosm.org/">CyclOSM</a>',
  maxZoom: 20,
});

const osmTile = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
});

let activeTileLayer = cyclosmTile;
activeTileLayer.addTo(map);

const updateTileLayer = () => {
  const isRunning = activitySelect.value === "running";
  const newLayer = isRunning ? osmTile : cyclosmTile;
  if (newLayer !== activeTileLayer) {
    map.removeLayer(activeTileLayer);
    newLayer.addTo(map);
    activeTileLayer = newLayer;
  }
};

const ACCENT = getComputedStyle(document.documentElement)
  .getPropertyValue("--accent")
  .trim() || "#2f6b4f";
const ROUTE_COLOR = getComputedStyle(document.documentElement)
  .getPropertyValue("--route")
  .trim() || "#dd6b20";

const directPolyline = L.polyline([], {
  color: ACCENT,
  weight: 4,
  opacity: 0.85,
  dashArray: "2 8",
  lineCap: "round",
}).addTo(map);

const routePolyline = L.polyline([], {
  color: ROUTE_COLOR,
  weight: 5,
  opacity: 0.95,
  lineCap: "round",
  lineJoin: "round",
}).addTo(map);

const markers = [];
const latlngs = [];
let elevationData = null;
let elevationSamples = null;
let elevationChart = null;
let routeGeometry = null;
let routeDistanceMeters = 0;
let loopEnabled = false;
let routingEnabled = false;
let routeRequestId = 0;
let locationMarker = null;
let allowAutoFit = false;
let useMiles = false;
let elevationTimer = null;
let rideBackEnabled = false;
let rideBackGeometry = null;
let elevationInFlight = false;
let routeSegments = null;
let routingTimer = null;
let autoRoutingEnabled = true;
const routeCache = new Map();
const timers = new Map();

const $ = (id) => document.getElementById(id);

const distanceValue = $("distanceValue");
const gainValue = $("gainValue");
const lossValue = $("lossValue");
const statusEl = $("status");
const mapHint = $("mapHint");
const pointCount = $("pointCount");
const undoBtn = $("undoBtn");
const clearBtn = $("clearBtn");
const loopBtn = $("loopBtn");
const rideBackBtn = $("rideBackBtn");
const elevationBtn = $("elevationBtn");
const unitsBtn = $("unitsBtn");
const routingToggle = $("routingToggle");
const autoRouteToggle = $("autoRouteToggle");
const updateRouteBtn = $("updateRouteBtn");
const routingOptions = $("routingOptions");
const activitySelect = $("activitySelect");
const cyclingPriority = $("cyclingPriority");
const providerSelect = $("providerSelect");
const apiKeyInput = $("apiKeyInput");
const apiKeyGroup = $("apiKeyGroup");
const saveKeyBtn = $("saveKeyBtn");
const editKeyBtn = $("editKeyBtn");
const helpKeyBtn = $("helpKeyBtn");
const apiHelpModal = $("apiHelpModal");
const closeModalBtn = $("closeModalBtn");
const locateBtn = $("locateBtn");
const exportBtn = $("exportBtn");
const themeBtn = $("themeBtn");
const directionsToggleBtn = $("directionsToggleBtn");
const directionsPanel = $("directionsPanel");
const directionsList = $("directionsList");
const debugPanel = $("debugPanel");
const debugList = $("debugList");
const debugToggleBtn = $("debugToggleBtn");
const testElevationBtn = $("testElevationBtn");
const clearDebugBtn = $("clearDebugBtn");
const routeNameInput = $("routeNameInput");
const saveRouteBtn = $("saveRouteBtn");
const savedRoutesSelect = $("savedRoutesSelect");
const loadRouteBtn = $("loadRouteBtn");
const deleteRouteBtn = $("deleteRouteBtn");
const gpxInput = $("gpxInput");

const METERS_IN_KM = 1000;
const METERS_IN_MILE = 1609.344;
const ORS_URL = "https://api.openrouteservice.org/v2/directions";
const ORS_KEY_STORAGE = "ors-api-key";
const VALHALLA_URL = "https://valhalla1.openstreetmap.de/route?json=";
const LOCATION_STORAGE = "map-route-start-location";
const CURRENT_ROUTE_STORAGE = "map-route-current";
const SAVED_ROUTES_STORAGE = "map-route-saved";
const THEME_STORAGE = "map-route-theme";
const UNITS_STORAGE = "map-route-units";
const DEBUG_STORAGE = "map-route-debug-open";

const setStatus = (message, isError = false) => {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", Boolean(isError));
};

const logDebug = (message) => {
  const item = document.createElement("li");
  const time = new Date().toLocaleTimeString([], { hour12: false });
  item.textContent = `${time}  ${message}`;
  debugList.prepend(item);
  while (debugList.children.length > 200) {
    debugList.removeChild(debugList.lastChild);
  }
};

const clearDebugLog = () => {
  debugList.innerHTML = "";
};

const startTimer = (label) => {
  timers.set(label, performance.now());
};

const endTimer = (label, suffix = "") => {
  if (!timers.has(label)) {
    return;
  }
  const elapsed = performance.now() - timers.get(label);
  timers.delete(label);
  logDebug(`${label}: ${elapsed.toFixed(1)} ms${suffix ? ` ${suffix}` : ""}`);
};

const invalidateRoute = () => {
  routeRequestId += 1;
};

const formatDistance = (meters) => {
  if (useMiles) {
    if (meters < METERS_IN_MILE) {
      const feet = meters * 3.28084;
      return `${Math.round(feet)} ft`;
    }
    const miles = meters / METERS_IN_MILE;
    return `${miles.toFixed(2)} mi`;
  }
  if (meters < METERS_IN_KM) {
    return `${Math.round(meters)} m`;
  }
  const km = meters / METERS_IN_KM;
  return `${km.toFixed(2)} km`;
};

const getDistanceMeters = (points) => {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += points[i - 1].distanceTo(points[i]);
  }
  return total;
};

const getDirectPathWithLoop = () => {
  if (!loopEnabled || latlngs.length < 2) {
    return latlngs;
  }
  return [...latlngs, latlngs[0]];
};

const getActivePath = () => {
  if (rideBackEnabled && rideBackGeometry && rideBackGeometry.length > 1) {
    return rideBackGeometry;
  }
  if (routingEnabled && routeGeometry && routeGeometry.length > 1) {
    return routeGeometry;
  }
  return getDirectPathWithLoop();
};

const updateDistance = () => {
  const totalMeters = rideBackEnabled && rideBackGeometry
    ? getDistanceMeters(rideBackGeometry)
    : routingEnabled && routeDistanceMeters > 0
      ? routeDistanceMeters
      : getDistanceMeters(getDirectPathWithLoop());
  distanceValue.textContent = formatDistance(totalMeters);
};

const updateHint = () => {
  if (!mapHint) return;
  if (latlngs.length === 0) {
    mapHint.classList.remove("hidden");
    mapHint.firstElementChild.textContent =
      "Click the map to add your first point.";
  } else if (latlngs.length === 1) {
    mapHint.classList.remove("hidden");
    mapHint.firstElementChild.textContent = "Keep clicking to extend the route.";
  } else {
    mapHint.classList.add("hidden");
  }
};

const updateButtons = () => {
  const hasPoints = latlngs.length > 0;
  const hasRoute = latlngs.length > 1;
  undoBtn.disabled = !hasPoints;
  clearBtn.disabled = !hasPoints;
  loopBtn.disabled = latlngs.length < 2;
  rideBackBtn.disabled = latlngs.length < 2;
  elevationBtn.disabled = !hasRoute;
  exportBtn.disabled = !hasRoute;
  if (pointCount) {
    pointCount.textContent = `${latlngs.length} ${
      latlngs.length === 1 ? "point" : "points"
    }`;
  }
  updateHint();
};

const updateCyclingControls = () => {
  const isCycling = activitySelect.value === "cycling";
  cyclingPriority.disabled = !isCycling;
};

const updateProviderControls = () => {
  const usingOrs = providerSelect.value === "ors";
  apiKeyInput.disabled = !usingOrs;
  saveKeyBtn.disabled = !usingOrs;
  editKeyBtn.disabled = !usingOrs;
  helpKeyBtn.disabled = !usingOrs;
  if (apiKeyGroup) {
    apiKeyGroup.style.display = usingOrs ? "" : "none";
  }
};

const updateRoutingOptionsState = () => {
  if (!routingOptions) return;
  routingOptions.setAttribute("aria-disabled", routingEnabled ? "false" : "true");
};

const formatStepDistance = (meters) => {
  if (useMiles) {
    return `${(meters / METERS_IN_MILE).toFixed(2)} mi`;
  }
  return `${(meters / METERS_IN_KM).toFixed(2)} km`;
};

const formatChartDistance = (value) => {
  if (useMiles) {
    if (value < 1) {
      const feet = value * 5280;
      return `${Math.round(feet)} ft`;
    }
    return `${value.toFixed(2)} mi`;
  }
  if (value < 1) {
    return `${Math.round(value * 1000)} m`;
  }
  return `${value.toFixed(2)} km`;
};

const clearDirections = () => {
  directionsList.innerHTML = "";
  directionsPanel.classList.add("hidden");
  if (directionsToggleBtn) directionsToggleBtn.textContent = "Hide";
};

const renderDirections = (steps) => {
  directionsList.innerHTML = "";
  if (!steps || steps.length === 0) {
    clearDirections();
    return;
  }
  steps.forEach((step) => {
    const item = document.createElement("li");
    const distance = step.distance
      ? ` (${formatStepDistance(step.distance)})`
      : "";
    item.textContent = `${step.instruction || step.name || "Continue"}${distance}`;
    directionsList.appendChild(item);
  });
  directionsPanel.classList.remove("hidden");
  if (directionsToggleBtn) directionsToggleBtn.textContent = "Hide";
};

const updatePolylines = () => {
  const directPath = getDirectPathWithLoop();
  if (rideBackEnabled && rideBackGeometry) {
    directPolyline.setLatLngs([]);
    routePolyline.setLatLngs(rideBackGeometry);
  } else if (routingEnabled && routeGeometry) {
    directPolyline.setLatLngs([]);
    routePolyline.setLatLngs(routeGeometry);
  } else {
    directPolyline.setLatLngs(directPath);
    routePolyline.setLatLngs([]);
  }
  const activePath = getActivePath();
  if (allowAutoFit && activePath.length > 1) {
    map.fitBounds(L.latLngBounds(activePath), { padding: [40, 40] });
  }
};

const resetElevation = () => {
  elevationData = null;
  elevationSamples = null;
  updateElevationStats(null);
  renderChart(null, null);
};

const clearRouteSegments = () => {
  routeSegments = null;
};

const clearRideBack = () => {
  rideBackEnabled = false;
  rideBackGeometry = null;
  rideBackBtn.textContent = "Out & back";
};

const serializeRoute = () => ({
  points: latlngs.map((point) => ({ lat: point.lat, lng: point.lng })),
  loopEnabled,
  rideBackEnabled,
  activity: activitySelect.value,
  routingEnabled,
  provider: providerSelect.value,
  cyclingPriority: cyclingPriority.value,
});

const persistCurrentRoute = () => {
  try {
    if (latlngs.length < 2) {
      localStorage.removeItem(CURRENT_ROUTE_STORAGE);
      return;
    }
    localStorage.setItem(CURRENT_ROUTE_STORAGE, JSON.stringify(serializeRoute()));
  } catch (_) {
    /* storage may be full or unavailable */
  }
};

const clearCurrentRoute = () => {
  try {
    localStorage.removeItem(CURRENT_ROUTE_STORAGE);
  } catch (_) {
    /* ignore */
  }
};

const loadSavedRoutes = () => {
  try {
    const raw = localStorage.getItem(SAVED_ROUTES_STORAGE);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
};

const saveRoutesList = (routes) => {
  try {
    localStorage.setItem(SAVED_ROUTES_STORAGE, JSON.stringify(routes));
  } catch (error) {
    setStatus("Unable to save — browser storage is full.", true);
  }
};

const refreshSavedRoutesSelect = () => {
  const routes = loadSavedRoutes();
  savedRoutesSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = routes.length ? "Select a saved route…" : "No saved routes yet";
  savedRoutesSelect.appendChild(placeholder);
  routes
    .slice()
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    .forEach((route) => {
      const option = document.createElement("option");
      option.value = route.id;
      option.textContent = route.name;
      savedRoutesSelect.appendChild(option);
    });
};

const applyRouteData = (data) => {
  if (!data?.points || data.points.length < 2) {
    return;
  }
  clearRoute({ silent: true });
  data.points.forEach((point) => {
    const latlng = L.latLng(point.lat, point.lng);
    latlngs.push(latlng);
    markers.push(createMarker(latlng));
  });
  loopEnabled = Boolean(data.loopEnabled);
  loopBtn.textContent = loopEnabled ? "Remove loop" : "Finish loop";
  rideBackEnabled = Boolean(data.rideBackEnabled);
  rideBackBtn.textContent = rideBackEnabled ? "Remove out & back" : "Out & back";
  activitySelect.value = data.activity || "cycling";
  routingToggle.checked = Boolean(data.routingEnabled);
  routingEnabled = routingToggle.checked;
  providerSelect.value = data.provider || "valhalla";
  cyclingPriority.value = data.cyclingPriority || "paths";
  updateCyclingControls();
  updateProviderControls();
  updateRoutingOptionsState();
  allowAutoFit = true;
  routeGeometry = null;
  routeDistanceMeters = 0;
  clearRouteSegments();
  resetElevation();
  updatePolylines();
  updateDistance();
  updateButtons();
  clearDirections();
  if (rideBackEnabled) {
    rideBackGeometry = buildRideBackGeometry(getDirectPathWithLoop());
  }
  refreshRouteIfNeeded();
  scheduleElevationUpdate();
  persistCurrentRoute();
};

const restoreCurrentRoute = () => {
  try {
    const raw = localStorage.getItem(CURRENT_ROUTE_STORAGE);
    if (!raw) {
      return false;
    }
    const data = JSON.parse(raw);
    applyRouteData(data);
    setStatus("Restored your last route.");
    return true;
  } catch (error) {
    return false;
  }
};

const saveNamedRoute = () => {
  const name = routeNameInput.value.trim();
  if (!name) {
    setStatus("Enter a name to save this route.", true);
    routeNameInput.focus();
    return;
  }
  if (latlngs.length < 2) {
    setStatus("Add at least two points before saving.", true);
    return;
  }
  const routes = loadSavedRoutes();
  const existingIndex = routes.findIndex((route) => route.name === name);
  const generateId = () =>
    (crypto.randomUUID && crypto.randomUUID()) ||
    `route-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const entry = {
    id: existingIndex >= 0 ? routes[existingIndex].id : generateId(),
    name,
    data: serializeRoute(),
    updatedAt: new Date().toISOString(),
  };
  if (existingIndex >= 0) {
    routes[existingIndex] = entry;
    setStatus(`Updated "${name}".`);
  } else {
    routes.push(entry);
    setStatus(`Saved "${name}".`);
  }
  saveRoutesList(routes);
  refreshSavedRoutesSelect();
  savedRoutesSelect.value = entry.id;
  routeNameInput.value = "";
};

const loadNamedRoute = () => {
  const id = savedRoutesSelect.value;
  if (!id) {
    setStatus("Pick a saved route to load.", true);
    return;
  }
  const routes = loadSavedRoutes();
  const route = routes.find((entry) => entry.id === id);
  if (!route) {
    setStatus("That saved route could not be found.", true);
    return;
  }
  applyRouteData(route.data);
  setStatus(`Loaded "${route.name}".`);
};

const deleteNamedRoute = () => {
  const id = savedRoutesSelect.value;
  if (!id) {
    setStatus("Pick a saved route to delete.", true);
    return;
  }
  const routes = loadSavedRoutes();
  const route = routes.find((entry) => entry.id === id);
  const filtered = routes.filter((entry) => entry.id !== id);
  saveRoutesList(filtered);
  refreshSavedRoutesSelect();
  setStatus(route ? `Deleted "${route.name}".` : "Route deleted.");
};

const parseGpx = async (file) => {
  const text = await file.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error("Invalid GPX file.");
  }
  const points = Array.from(doc.querySelectorAll("trkpt, rtept")).map((node) => ({
    lat: parseFloat(node.getAttribute("lat")),
    lng: parseFloat(node.getAttribute("lon")),
  }));
  return points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
};

const handleGpxImport = async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  try {
    const points = await parseGpx(file);
    if (points.length < 2) {
      setStatus("This GPX file has no usable track points.", true);
      return;
    }
    applyRouteData({ points, loopEnabled: false, rideBackEnabled: false });
    setStatus(`Imported ${points.length} points from ${file.name}.`);
  } catch (error) {
    logDebug(`GPX import error: ${error?.message || error}`);
    setStatus("Unable to read that GPX file.", true);
  } finally {
    gpxInput.value = "";
  }
};

const scheduleElevationUpdate = () => {
  if (latlngs.length < 2) {
    return;
  }
  if (elevationTimer) {
    clearTimeout(elevationTimer);
  }
  elevationTimer = setTimeout(() => {
    fetchElevations();
  }, 800);
};

const scheduleRoutingUpdate = (delay = 800) => {
  if (!routingEnabled || !autoRoutingEnabled) {
    return;
  }
  if (routingTimer) {
    clearTimeout(routingTimer);
  }
  routingTimer = setTimeout(() => {
    refreshRouteIfNeeded();
  }, delay);
};

const createMarker = (latlng) =>
  L.circleMarker(latlng, {
    radius: 6,
    color: ACCENT,
    weight: 2,
    fillColor: "#ffffff",
    fillOpacity: 1,
    pane: "markerPane",
  }).addTo(map);

const addPoint = (latlng) => {
  latlngs.push(latlng);
  markers.push(createMarker(latlng));
  allowAutoFit = false;
  clearRideBack();
  clearRouteSegments();
  resetElevation();
  updatePolylines();
  updateDistance();
  updateButtons();
  setStatus(
    latlngs.length === 1
      ? "First point placed."
      : `Point ${latlngs.length} added.`
  );
  scheduleRoutingUpdate();
  scheduleElevationUpdate();
  persistCurrentRoute();
};

const clearRoute = ({ silent = false } = {}) => {
  markers.forEach((marker) => marker.remove());
  markers.length = 0;
  latlngs.length = 0;
  directPolyline.setLatLngs([]);
  routePolyline.setLatLngs([]);
  routeGeometry = null;
  routeDistanceMeters = 0;
  loopEnabled = false;
  loopBtn.textContent = "Finish loop";
  allowAutoFit = false;
  invalidateRoute();
  clearRideBack();
  clearRouteSegments();
  resetElevation();
  clearDirections();
  clearCurrentRoute();
  updateDistance();
  updateButtons();
  if (!silent) {
    setStatus("Route cleared.");
  }
};

const undoPoint = () => {
  const marker = markers.pop();
  if (marker) {
    marker.remove();
  }
  latlngs.pop();
  allowAutoFit = false;
  clearRideBack();

  if (latlngs.length === 0) {
    routeGeometry = null;
    routeDistanceMeters = 0;
    invalidateRoute();
    clearRouteSegments();
    resetElevation();
    clearDirections();
    updatePolylines();
    updateDistance();
    updateButtons();
    setStatus("Route cleared.");
    clearCurrentRoute();
    return;
  }

  const served = tryApplyCachedRouteForCurrentPath({ silent: true });
  if (served) {
    invalidateRoute();
    updateButtons();
    setStatus("Last point removed.");
    persistCurrentRoute();
    return;
  }

  routeGeometry = null;
  routeDistanceMeters = 0;
  invalidateRoute();
  clearRouteSegments();
  resetElevation();
  clearDirections();
  updatePolylines();
  updateDistance();
  updateButtons();
  setStatus("Last point removed.");
  scheduleRoutingUpdate();
  persistCurrentRoute();
};

const toggleLoop = () => {
  loopEnabled = !loopEnabled;
  loopBtn.textContent = loopEnabled ? "Remove loop" : "Finish loop";
  routeGeometry = null;
  routeDistanceMeters = 0;
  invalidateRoute();
  clearRideBack();
  clearRouteSegments();
  resetElevation();
  clearDirections();
  updatePolylines();
  updateDistance();
  scheduleRoutingUpdate();
  scheduleElevationUpdate();
  persistCurrentRoute();
};

const buildDirectSegments = () =>
  latlngs.slice(1).map((point, index) => [latlngs[index], point]);

const downsampleRoutePoints = (points, maxPoints = 40) => {
  if (points.length <= maxPoints) {
    return points;
  }
  const step = Math.ceil(points.length / maxPoints);
  const sampled = [];
  for (let i = 0; i < points.length; i += step) {
    sampled.push(points[i]);
  }
  if (sampled[sampled.length - 1] !== points[points.length - 1]) {
    sampled.push(points[points.length - 1]);
  }
  return sampled;
};

const normalizePathForCache = (points) =>
  points.map((point) => [
    Number(point.lng.toFixed(5)),
    Number(point.lat.toFixed(5)),
  ]);

const getRouteCacheKey = (provider, profile, path, extra = {}) =>
  JSON.stringify({
    provider,
    profile,
    path: normalizePathForCache(path),
    extra,
  });

const applyCachedRoute = (cached, { fit = false, silent = false } = {}) => {
  routeGeometry = cached.geometry
    ? cached.geometry.map((point) => L.latLng(point.lat, point.lng))
    : null;
  routeSegments = cached.segments
    ? cached.segments.map((segment) =>
        segment.map((point) => L.latLng(point.lat, point.lng))
      )
    : null;
  routeDistanceMeters = cached.distance || 0;
  if (rideBackEnabled && routeGeometry) {
    rideBackGeometry = buildRideBackGeometry(routeGeometry);
  }
  renderDirections(cached.steps || []);
  allowAutoFit = fit;
  resetElevation();
  updatePolylines();
  updateDistance();
  if (!silent) setStatus("Route restored from cache.");
  scheduleElevationUpdate();
};

const getCurrentRouteCacheKey = () => {
  if (!routingEnabled || latlngs.length < 2) return null;
  const rawPath = loopEnabled ? [...latlngs, latlngs[0]] : latlngs;
  const path = downsampleRoutePoints(rawPath, 40);
  if (providerSelect.value === "ors") {
    const profile = getRoutingProfile();
    return getRouteCacheKey("ors", profile, path, {
      cyclingPreference: cyclingPriority.value,
    });
  }
  const costing = activitySelect.value === "running" ? "pedestrian" : "bicycle";
  return getRouteCacheKey("valhalla", costing, path, {
    useRoads: getCyclingUseRoads(),
  });
};

const tryApplyCachedRouteForCurrentPath = ({ silent = false } = {}) => {
  const key = getCurrentRouteCacheKey();
  if (!key || !routeCache.has(key)) return false;
  applyCachedRoute(routeCache.get(key), { fit: false, silent });
  return true;
};

const cacheRoute = (key, geometry, segments, distance, steps) => {
  routeCache.set(key, {
    geometry:
      geometry?.map((point) => ({ lat: point.lat, lng: point.lng })) || null,
    segments:
      segments?.map((segment) =>
        segment.map((point) => ({ lat: point.lat, lng: point.lng }))
      ) || null,
    distance,
    steps: steps || [],
  });
};

const chooseIntervalMeters = (rawInterval) => {
  if (rawInterval <= 1) return 1;
  if (rawInterval <= 2) return 2;
  return 5;
};

const samplePolyline = (points, intervalMeters, maxPoints = 100) => {
  if (!points || points.length === 0) {
    return [];
  }
  if (points.length === 1) {
    return [points[0]];
  }
  const distances = [0];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += points[i - 1].distanceTo(points[i]);
    distances.push(total);
  }
  if (total === 0) {
    return [points[0]];
  }
  const interval = Math.max(1, intervalMeters);
  const targetCount = Math.min(
    maxPoints,
    Math.max(2, Math.floor(total / interval) + 1)
  );
  const step = total / (targetCount - 1);
  const sampled = [];
  let segmentIndex = 1;
  for (let i = 0; i < targetCount; i += 1) {
    const target = step * i;
    while (segmentIndex < distances.length - 1 && distances[segmentIndex] < target) {
      segmentIndex += 1;
    }
    const prevIndex = Math.max(1, segmentIndex);
    const prevDist = distances[prevIndex - 1];
    const nextDist = distances[prevIndex];
    const ratio = nextDist === prevDist ? 0 : (target - prevDist) / (nextDist - prevDist);
    const p1 = points[prevIndex - 1];
    const p2 = points[prevIndex];
    sampled.push(
      L.latLng(
        p1.lat + (p2.lat - p1.lat) * ratio,
        p1.lng + (p2.lng - p1.lng) * ratio
      )
    );
  }
  return sampled;
};

const getElevationSegments = () => {
  if (rideBackEnabled && rideBackGeometry) {
    return [rideBackGeometry];
  }
  if (routingEnabled && routeSegments && routeSegments.length > 0) {
    return routeSegments;
  }
  return buildDirectSegments();
};

const buildElevationSamplePoints = (segments, maxPointsPerSegment = 100) => {
  const totalLength = segments.reduce(
    (sum, segment) => sum + getDistanceMeters(segment),
    0
  );
  if (!totalLength) {
    return [];
  }
  const targetTotal = Math.min(120, Math.max(40, segments.length * 30));
  const points = [];
  segments.forEach((segment, index) => {
    const segmentLength = getDistanceMeters(segment);
    if (!segmentLength) {
      return;
    }
    const share = Math.max(
      2,
      Math.round((segmentLength / totalLength) * targetTotal)
    );
    const perSegment = Math.min(maxPointsPerSegment, share);
    const rawInterval = segmentLength / (perSegment - 1);
    const interval = chooseIntervalMeters(rawInterval);
    const sampled = samplePolyline(segment, interval, perSegment);
    if (sampled.length === 0) {
      return;
    }
    if (index > 0) {
      sampled.shift();
    }
    points.push(...sampled);
  });
  return points;
};

const buildRideBackGeometry = (path) => {
  if (!path || path.length < 2) {
    return null;
  }
  const reversed = [...path].reverse().slice(1);
  return [...path, ...reversed];
};

const toggleRideBack = () => {
  rideBackEnabled = !rideBackEnabled;
  if (rideBackEnabled) {
    loopEnabled = false;
    loopBtn.textContent = "Finish loop";
    if (routingEnabled && routeGeometry) {
      rideBackGeometry = buildRideBackGeometry(routeGeometry);
    } else {
      rideBackGeometry = buildRideBackGeometry(getDirectPathWithLoop());
    }
    rideBackBtn.textContent = "Remove out & back";
    scheduleElevationUpdate();
  } else {
    clearRideBack();
  }
  updatePolylines();
  updateDistance();
  scheduleRoutingUpdate();
  persistCurrentRoute();
};

const chunkArray = (items, chunkSize) => {
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
};

const decodePolyline = (encoded, precision = 6) => {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates = [];
  const factor = 10 ** precision;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte = null;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    coordinates.push(L.latLng(lat / factor, lng / factor));
  }

  return coordinates;
};

const getCyclingProfile = () => {
  switch (cyclingPriority.value) {
    case "roads":
      return "cycling-road";
    case "paths":
    case "balanced":
    default:
      return "cycling-regular";
  }
};

const getRoutingProfile = () => {
  if (activitySelect.value === "running") {
    return "foot-walking";
  }
  return getCyclingProfile();
};

const getCyclingUseRoads = () => {
  switch (cyclingPriority.value) {
    case "paths":
      return 0.1;
    case "roads":
      return 0.9;
    case "balanced":
    default:
      return 0.5;
  }
};

const getStoredApiKey = () => {
  try {
    return localStorage.getItem(ORS_KEY_STORAGE) || "";
  } catch (_) {
    return "";
  }
};

const refreshApiKeyUI = () => {
  const hasKey = Boolean(getStoredApiKey());
  if (apiKeyGroup) {
    apiKeyGroup.classList.toggle("has-key", hasKey);
  }
  if (hasKey) {
    apiKeyInput.value = "";
    apiKeyInput.placeholder = "Key saved — click Edit to change";
  } else {
    apiKeyInput.placeholder = "Paste OpenRouteService key";
  }
};

const saveApiKey = () => {
  const key = apiKeyInput.value.trim();
  try {
    if (!key) {
      localStorage.removeItem(ORS_KEY_STORAGE);
      setStatus("API key cleared.");
    } else {
      localStorage.setItem(ORS_KEY_STORAGE, key);
      setStatus("API key saved.");
    }
  } catch (_) {
    setStatus("Unable to save key — storage unavailable.", true);
    return;
  }
  refreshApiKeyUI();
  if (routingEnabled && providerSelect.value === "ors") {
    scheduleRoutingUpdate(0);
  }
};

const editApiKey = () => {
  if (apiKeyGroup) {
    apiKeyGroup.classList.remove("has-key");
  }
  apiKeyInput.value = "";
  apiKeyInput.focus();
};

const openApiHelp = () => {
  apiHelpModal.classList.remove("hidden");
  closeModalBtn.focus();
};

const closeApiHelp = () => {
  apiHelpModal.classList.add("hidden");
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = 12000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      mode: "cors",
      cache: "no-store",
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const shouldRetryStatus = (status) => status === 429 || (status >= 500 && status < 600);

const fetchWithRetry = async (url, options = {}, retries = 2, timeoutMs = 12000) => {
  let attempt = 0;
  while (attempt <= retries) {
    try {
      const response = await fetchWithTimeout(url, options, timeoutMs);
      if (!response.ok && shouldRetryStatus(response.status) && attempt < retries) {
        const backoff = 500 * 2 ** attempt + Math.random() * 200;
        logDebug(`Retrying ${response.status} in ${Math.round(backoff)} ms`);
        await sleep(backoff);
        attempt += 1;
        continue;
      }
      return response;
    } catch (error) {
      if (attempt >= retries) {
        throw error;
      }
      const backoff = 500 * 2 ** attempt + Math.random() * 200;
      logDebug(`Retrying fetch error in ${Math.round(backoff)} ms`);
      await sleep(backoff);
      attempt += 1;
    }
  }
  throw new Error("Retries exhausted.");
};

const fetchElevationsFromOpenMeteo = async (points) => {
  startTimer("Elevation: Open-Meteo request");
  const batches = chunkArray(points, 100);
  const elevations = [];
  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    const latitudes = batch.map((p) => p.lat.toFixed(5)).join(",");
    const longitudes = batch.map((p) => p.lng.toFixed(5)).join(",");
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${latitudes}&longitude=${longitudes}`;
    let response;
    try {
      logDebug(`Open-Meteo request: ${batch.length} points`);
      response = await fetchWithRetry(url, {}, 2, 12000);
    } catch (error) {
      logDebug(`Open-Meteo fetch error: ${error?.name || "error"} ${error?.message || error}`);
      throw error;
    }
    if (!response.ok) {
      const text = await response.text();
      logDebug(`Open-Meteo ${response.status}: ${text.slice(0, 160)}`);
      throw new Error(`Open-Meteo ${response.status}`);
    }
    const data = await response.json();
    if (!Array.isArray(data.elevation)) {
      throw new Error("Open-Meteo response missing elevation array.");
    }
    data.elevation.forEach((value) => {
      if (typeof value === "number") elevations.push(value);
    });
    if (i < batches.length - 1) {
      await sleep(200);
    }
  }
  endTimer("Elevation: Open-Meteo request", `(${elevations.length} points)`);
  return elevations;
};

const fetchElevationsFromOpenElevation = async (points) => {
  startTimer("Elevation: Open-Elevation request");
  const batches = chunkArray(points, 100);
  const elevations = [];
  for (const batch of batches) {
    const locations = batch
      .map((point) => `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`)
      .join("|");
    const url = `https://api.open-elevation.com/api/v1/lookup?locations=${locations}`;
    let response;
    try {
      logDebug(`Open-Elevation request: ${batch.length} points`);
      response = await fetchWithRetry(url, {}, 1, 25000);
    } catch (error) {
      logDebug(`Open-Elevation fetch error: ${error?.name || "error"} ${error?.message || error}`);
      throw error;
    }
    if (!response.ok) {
      const text = await response.text();
      logDebug(`Open-Elevation ${response.status}: ${text.slice(0, 160)}`);
      throw new Error(`Open-Elevation ${response.status}`);
    }
    const data = await response.json();
    if (!data.results) {
      throw new Error("Open-Elevation response missing data.");
    }
    data.results.forEach((result) => {
      if (typeof result.elevation === "number") {
        elevations.push(result.elevation);
      }
    });
  }
  endTimer("Elevation: Open-Elevation request", `(${elevations.length} points)`);
  return elevations;
};

const fetchElevations = async () => {
  const segments = getElevationSegments();
  if (!segments || segments.length === 0) {
    setStatus("Add at least two points to fetch elevation.", true);
    return;
  }

  if (location.protocol === "file:") {
    setStatus(
      "Elevation needs a local server — file:// blocks cross-origin calls.",
      true
    );
    logDebug("Elevation blocked: running from file://");
    return;
  }

  if (elevationInFlight) {
    return;
  }

  elevationInFlight = true;
  elevationBtn.disabled = true;
  setStatus("Fetching elevation data…");

  try {
    startTimer("Elevation: sample points");
    const sampledPath = buildElevationSamplePoints(segments, 100);
    endTimer("Elevation: sample points", `(${sampledPath.length} points)`);
    elevationSamples = sampledPath;

    startTimer("Elevation: Open-Meteo total");
    const elevations = await fetchElevationsFromOpenMeteo(sampledPath);
    endTimer("Elevation: Open-Meteo total");
    if (elevations.length < 2) {
      throw new Error("Open-Meteo returned insufficient data.");
    }

    elevationData = elevations;
    updateElevationStats(elevationData);
    renderChart(elevationData, elevationSamples);
    setStatus("Elevation updated.");
  } catch (error) {
    logDebug(`Open-Meteo failed: ${error?.message || error}. Falling back to Open-Elevation…`);
    setStatus("Primary elevation source unavailable. Trying backup (this can take up to 25s)…");
    try {
      startTimer("Elevation: fallback sample");
      const sampledPath = buildElevationSamplePoints(segments, 100);
      endTimer("Elevation: fallback sample", `(${sampledPath.length} points)`);
      elevationSamples = sampledPath;
      startTimer("Elevation: Open-Elevation total");
      const elevations = await fetchElevationsFromOpenElevation(sampledPath);
      endTimer("Elevation: Open-Elevation total");
      if (elevations.length < 2) {
        throw new Error("Open-Elevation returned insufficient data.");
      }
      elevationData = elevations;
      updateElevationStats(elevationData);
      renderChart(elevationData, elevationSamples);
      setStatus("Elevation updated (backup source).");
      return;
    } catch (fallbackError) {
      logDebug(`Open-Elevation failed: ${fallbackError?.message || fallbackError}`);
      resetElevation();
      setStatus(
        "Couldn't load elevation. Both providers are rate-limited or down — please try again in a moment.",
        true
      );
    }
  } finally {
    elevationInFlight = false;
    updateButtons();
  }
};

const testElevationEndpoints = async () => {
  const testPoints = [
    L.latLng(-33.8688, 151.2093),
    L.latLng(-33.87, 151.215),
  ];
  logDebug("Testing Open-Meteo endpoint…");
  try {
    const results = await fetchElevationsFromOpenMeteo(testPoints);
    logDebug(`Open-Meteo OK (${results.length} points)`);
  } catch (error) {
    logDebug(`Open-Meteo test failed: ${error?.message || error}`);
  }

  logDebug("Testing Open-Elevation endpoint…");
  try {
    const results = await fetchElevationsFromOpenElevation(testPoints);
    logDebug(`Open-Elevation OK (${results.length} points)`);
  } catch (error) {
    logDebug(`Open-Elevation test failed: ${error?.message || error}`);
  }
};

const updateElevationStats = (elevations) => {
  if (!elevations || elevations.length < 2) {
    gainValue.textContent = "0 m";
    lossValue.textContent = "0 m";
    return;
  }

  let gain = 0;
  let loss = 0;
  for (let i = 1; i < elevations.length; i += 1) {
    const delta = elevations[i] - elevations[i - 1];
    if (delta > 0) {
      gain += delta;
    } else if (delta < 0) {
      loss += Math.abs(delta);
    }
  }

  gainValue.textContent = `${Math.round(gain)} m`;
  lossValue.textContent = `${Math.round(loss)} m`;
};

const getDistanceSeriesFor = (points) => {
  const distances = [0];
  for (let i = 1; i < points.length; i += 1) {
    const segment = points[i - 1].distanceTo(points[i]);
    distances.push(distances[i - 1] + segment);
  }
  if (useMiles) {
    return distances.map((value) => value / METERS_IN_MILE);
  }
  return distances.map((value) => value / METERS_IN_KM);
};

const renderChart = (elevations, points) => {
  const ctx = document.getElementById("elevationChart");
  if (!ctx || typeof Chart === "undefined") {
    return;
  }
  startTimer("Chart: render");
  const labels = elevations && points ? getDistanceSeriesFor(points) : [];
  const unitLabel = useMiles ? "mi" : "km";
  const data = elevations ? elevations.map((value) => Math.round(value)) : [];
  const dataPoints =
    labels.length && data.length
      ? labels.map((x, index) => ({ x, y: data[index] }))
      : [];

  const muted = getComputedStyle(document.documentElement)
    .getPropertyValue("--muted")
    .trim() || "#7a7568";
  const inkSoft = getComputedStyle(document.documentElement)
    .getPropertyValue("--ink-soft")
    .trim() || "#3a3b36";
  const border = getComputedStyle(document.documentElement)
    .getPropertyValue("--border")
    .trim() || "#e6ddc8";

  if (elevationChart) {
    elevationChart.destroy();
  }

  elevationChart = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Elevation (m)",
          data: dataPoints,
          borderColor: ROUTE_COLOR,
          backgroundColor: `${ROUTE_COLOR}26`,
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          type: "linear",
          grid: { color: border },
          ticks: {
            color: muted,
            maxTicksLimit: 6,
            autoSkip: true,
            callback: (value) => formatChartDistance(Number(value)),
          },
          title: {
            display: true,
            text: `Distance (${unitLabel})`,
            color: inkSoft,
          },
        },
        y: {
          grid: { color: border },
          ticks: { color: muted, maxTicksLimit: 5 },
          title: {
            display: true,
            text: "Elevation (m)",
            color: inkSoft,
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) =>
              items.length ? formatChartDistance(items[0].parsed.x) : "",
            label: (item) => `Elevation: ${Math.round(item.parsed.y)} m`,
          },
        },
      },
    },
  });
  endTimer("Chart: render");
};

const buildRouteWithValhalla = async () => {
  const requestId = routeRequestId + 1;
  routeRequestId = requestId;
  const costing = activitySelect.value === "running" ? "pedestrian" : "bicycle";
  const rawPath = loopEnabled ? [...latlngs, latlngs[0]] : latlngs;
  const path = downsampleRoutePoints(rawPath, 40);
  const cacheKey = getRouteCacheKey("valhalla", costing, path, {
    useRoads: getCyclingUseRoads(),
  });
  if (routeCache.has(cacheKey)) {
    applyCachedRoute(routeCache.get(cacheKey));
    return;
  }
  const payload = {
    locations: path.map((point) => ({
      lat: Number(point.lat.toFixed(6)),
      lon: Number(point.lng.toFixed(6)),
      type: "break",
    })),
    costing,
    units: "kilometers",
  };

  if (costing === "bicycle") {
    payload.costing_options = {
      bicycle: {
        bicycle_type: "hybrid",
        use_roads: getCyclingUseRoads(),
        use_living_streets: 0.8,
      },
    };
  } else {
    payload.costing_options = {
      pedestrian: {
        walkway_factor: 0.3,
        sidewalk_factor: 0.7,
        alley_factor: 2.5,
      },
    };
  }

  const url = `${VALHALLA_URL}${encodeURIComponent(JSON.stringify(payload))}`;
  setStatus("Fetching route from Valhalla…");

  try {
    startTimer("Routing: Valhalla fetch");
    const response = await fetch(url);
    endTimer("Routing: Valhalla fetch");
    if (!response.ok) {
      throw new Error(`Routing request failed (${response.status}).`);
    }
    startTimer("Routing: Valhalla parse");
    const data = await response.json();
    endTimer("Routing: Valhalla parse");
    if (!data.trip || !data.trip.legs) {
      throw new Error("Routing response missing data.");
    }
    if (routeRequestId !== requestId || !routingEnabled) {
      return;
    }
    startTimer("Routing: Valhalla decode");
    const merged = [];
    routeSegments = [];
    const steps = [];
    data.trip.legs.forEach((leg, index) => {
      if (!leg.shape) {
        return;
      }
      const decoded = decodePolyline(leg.shape, 6);
      if (index > 0 && decoded.length > 0) {
        decoded.shift();
      }
      merged.push(...decoded);
      if (decoded.length > 1) {
        routeSegments.push(decoded);
      }
      if (Array.isArray(leg.maneuvers)) {
        leg.maneuvers.forEach((m) => {
          steps.push({
            instruction: m.instruction || m.verbal_pre_transition_instruction,
            distance: (m.length || 0) * METERS_IN_KM,
          });
        });
      }
    });
    endTimer("Routing: Valhalla decode", `(${merged.length} points)`);
    routeGeometry = merged.length > 1 ? merged : null;
    routeDistanceMeters = data.trip.summary
      ? data.trip.summary.length * METERS_IN_KM
      : 0;
    if (rideBackEnabled) {
      rideBackGeometry = buildRideBackGeometry(routeGeometry);
    }
    cacheRoute(cacheKey, routeGeometry, routeSegments, routeDistanceMeters, steps);
    allowAutoFit = false;
    resetElevation();
    updatePolylines();
    updateDistance();
    renderDirections(steps);
    setStatus("Route updated.");
    scheduleElevationUpdate();
  } catch (error) {
    routeGeometry = null;
    routeDistanceMeters = 0;
    updatePolylines();
    updateDistance();
    clearDirections();
    setStatus(
      "Couldn't route that path. Try fewer points or another provider.",
      true
    );
    logDebug(`Routing error: ${error?.message || error}`);
  }
};

const buildRoute = async () => {
  if (!routingEnabled || latlngs.length < 2) {
    routeGeometry = null;
    routeDistanceMeters = 0;
    updatePolylines();
    updateDistance();
    return;
  }

  if (providerSelect.value === "valhalla") {
    await buildRouteWithValhalla();
    return;
  }

  const apiKey = getStoredApiKey();
  if (!apiKey) {
    setStatus("Add an OpenRouteService key to use this provider.", true);
    return;
  }

  const requestId = routeRequestId + 1;
  routeRequestId = requestId;
  const profile = getRoutingProfile();
  const rawPath = loopEnabled ? [...latlngs, latlngs[0]] : latlngs;
  const path = downsampleRoutePoints(rawPath, 40);
  const cacheKey = getRouteCacheKey("ors", profile, path, {
    cyclingPreference: cyclingPriority.value,
  });
  if (routeCache.has(cacheKey)) {
    applyCachedRoute(routeCache.get(cacheKey));
    return;
  }
  const payload = {
    coordinates: path.map((point) => [
      Number(point.lng.toFixed(6)),
      Number(point.lat.toFixed(6)),
    ]),
    instructions: true,
    options: {
      avoid_features: ["steps"],
    },
  };
  if (profile.startsWith("foot-")) {
    payload.options.profile_params = {
      weightings: {
        green: { factor: 0.8 },
        quiet: { factor: 0.8 },
      },
    };
  }
  const url = `${ORS_URL}/${profile}/geojson`;

  setStatus("Fetching route from OpenRouteService…");

  try {
    startTimer("Routing: ORS fetch");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    endTimer("Routing: ORS fetch");
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      logDebug(`ORS body: ${text.slice(0, 200)}`);
      throw new Error(`Routing request failed (${response.status}).`);
    }
    startTimer("Routing: ORS parse");
    const data = await response.json();
    endTimer("Routing: ORS parse");
    if (!data.features || !data.features[0]) {
      throw new Error("Routing response missing data.");
    }
    if (routeRequestId !== requestId || !routingEnabled) {
      return;
    }
    startTimer("Routing: ORS decode");
    const geometry = data.features[0].geometry;
    routeGeometry = geometry?.coordinates
      ? geometry.coordinates.map(([lng, lat]) => L.latLng(lat, lng))
      : null;
    const wayPoints = data.features[0].properties?.way_points;
    if (routeGeometry && Array.isArray(wayPoints) && wayPoints.length > 1) {
      routeSegments = [];
      for (let i = 0; i < wayPoints.length - 1; i += 1) {
        const start = wayPoints[i];
        const end = wayPoints[i + 1];
        if (typeof start !== "number" || typeof end !== "number") {
          continue;
        }
        const segment = routeGeometry.slice(start, end + 1);
        if (segment.length > 1) {
          routeSegments.push(segment);
        }
      }
    } else if (routeGeometry) {
      routeSegments = [routeGeometry];
    }
    endTimer("Routing: ORS decode", `(${routeGeometry?.length || 0} points)`);
    routeDistanceMeters = data.features[0].properties?.summary?.distance || 0;
    if (rideBackEnabled) {
      rideBackGeometry = buildRideBackGeometry(routeGeometry);
    }
    const steps =
      data.features[0].properties?.segments?.flatMap(
        (segment) => segment.steps || []
      ) || [];
    renderDirections(steps);
    cacheRoute(cacheKey, routeGeometry, routeSegments, routeDistanceMeters, steps);
    allowAutoFit = false;
    resetElevation();
    updatePolylines();
    updateDistance();
    setStatus("Route updated.");
    scheduleElevationUpdate();
  } catch (error) {
    routeGeometry = null;
    routeDistanceMeters = 0;
    updatePolylines();
    updateDistance();
    clearDirections();
    setStatus(
      "Couldn't route that path. Check your API key or try Valhalla.",
      true
    );
    logDebug(`Routing error: ${error?.message || error}`);
  }
};

const refreshRouteIfNeeded = () => {
  if (routingEnabled) {
    buildRoute();
  } else {
    updatePolylines();
    updateDistance();
  }
};

const locateUser = () => {
  if (!navigator.geolocation) {
    setStatus("Geolocation isn't supported in this browser.", true);
    return;
  }
  setStatus("Locating you…");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const latlng = L.latLng(
        position.coords.latitude,
        position.coords.longitude
      );
      if (locationMarker) {
        locationMarker.remove();
      }
      locationMarker = L.circleMarker(latlng, {
        radius: 7,
        color: ACCENT,
        weight: 2,
        fillColor: "#d1ecd9",
        fillOpacity: 0.9,
      }).addTo(map);
      map.setView(latlng, 14);
      try {
        localStorage.setItem(
          LOCATION_STORAGE,
          JSON.stringify({ lat: latlng.lat, lng: latlng.lng })
        );
      } catch (_) {
        /* ignore */
      }
      setStatus("Centred on your location.");
    },
    () => {
      setStatus("Couldn't access your location.", true);
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
};

const loadSavedLocation = () => {
  try {
    const raw = localStorage.getItem(LOCATION_STORAGE);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (typeof parsed?.lat === "number" && typeof parsed?.lng === "number") {
      return L.latLng(parsed.lat, parsed.lng);
    }
  } catch (_) {
    return null;
  }
  return null;
};

const themeLabel = document.querySelector(".theme-label");

const applyTheme = (theme) => {
  document.documentElement.setAttribute("data-theme", theme);
  if (themeLabel) {
    themeLabel.textContent = theme === "dark" ? "Light" : "Dark";
  }
  themeBtn.setAttribute(
    "aria-label",
    theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
  );
  try {
    localStorage.setItem(THEME_STORAGE, theme);
  } catch (_) {
    /* ignore */
  }
  // Re-render chart so axis colors pick up the new theme.
  if (elevationData && elevationSamples) {
    renderChart(elevationData, elevationSamples);
  }
};

const initTheme = () => {
  let saved = null;
  try {
    saved = localStorage.getItem(THEME_STORAGE);
  } catch (_) {
    /* ignore */
  }
  if (saved === "light" || saved === "dark") {
    applyTheme(saved);
    return;
  }
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(prefersDark ? "dark" : "light");
};

const setUnitsMode = (nextUseMiles, persist = true) => {
  useMiles = nextUseMiles;
  const icon = unitsBtn.querySelector(".btn-icon");
  const label = unitsBtn.querySelector(".btn-label");
  if (icon) icon.textContent = useMiles ? "mi" : "km";
  if (label) label.textContent = useMiles ? "Miles" : "Kilometres";
  unitsBtn.setAttribute("aria-pressed", useMiles ? "true" : "false");
  updateDistance();
  renderChart(elevationData, elevationSamples);
  if (persist) {
    try {
      localStorage.setItem(UNITS_STORAGE, useMiles ? "mi" : "km");
    } catch (_) {
      /* ignore */
    }
  }
};

const initUnits = () => {
  let saved = null;
  try {
    saved = localStorage.getItem(UNITS_STORAGE);
  } catch (_) {
    /* ignore */
  }
  setUnitsMode(saved === "mi", false);
};

const buildGpx = (points) => {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<gpx version="1.1" creator="Map a Route" xmlns="http://www.topografix.com/GPX/1/1">'
  );
  lines.push("<trk><name>Mapped Route</name><trkseg>");
  points.forEach((point) => {
    lines.push(
      `<trkpt lat="${point.lat.toFixed(6)}" lon="${point.lng.toFixed(6)}"></trkpt>`
    );
  });
  lines.push("</trkseg></trk></gpx>");
  return lines.join("");
};

const downloadGpx = () => {
  const path = getActivePath();
  if (path.length < 2) {
    setStatus("Add at least two points before exporting.", true);
    return;
  }
  const gpx = buildGpx(path);
  const blob = new Blob([gpx], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  link.download = `map-a-route-${stamp}.gpx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus("GPX exported.");
};

const setDebugOpen = (open) => {
  debugPanel.dataset.open = open ? "true" : "false";
  debugToggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
  try {
    localStorage.setItem(DEBUG_STORAGE, open ? "1" : "0");
  } catch (_) {
    /* ignore */
  }
};

const initDebug = () => {
  let saved = null;
  try {
    saved = localStorage.getItem(DEBUG_STORAGE);
  } catch (_) {
    /* ignore */
  }
  setDebugOpen(saved === "1");
};

// ------- Event wiring -------
map.on("click", (event) => addPoint(event.latlng));
undoBtn.addEventListener("click", undoPoint);
clearBtn.addEventListener("click", () => clearRoute());
loopBtn.addEventListener("click", toggleLoop);
elevationBtn.addEventListener("click", fetchElevations);
routingToggle.addEventListener("change", () => {
  routingEnabled = routingToggle.checked;
  routeGeometry = null;
  routeDistanceMeters = 0;
  invalidateRoute();
  resetElevation();
  clearDirections();
  clearRideBack();
  updateRoutingOptionsState();
  if (routingEnabled) {
    if (providerSelect.value === "ors" && !getStoredApiKey()) {
      openApiHelp();
    }
    scheduleRoutingUpdate(0);
  } else {
    updatePolylines();
    updateDistance();
  }
  persistCurrentRoute();
});
autoRouteToggle.addEventListener("change", () => {
  autoRoutingEnabled = autoRouteToggle.checked;
  if (autoRoutingEnabled && routingEnabled) {
    scheduleRoutingUpdate(0);
  }
});
activitySelect.addEventListener("change", () => {
  routeGeometry = null;
  routeDistanceMeters = 0;
  resetElevation();
  clearDirections();
  updateCyclingControls();
  updateTileLayer();
  refreshRouteIfNeeded();
  persistCurrentRoute();
});
cyclingPriority.addEventListener("change", () => {
  routeGeometry = null;
  routeDistanceMeters = 0;
  resetElevation();
  clearDirections();
  refreshRouteIfNeeded();
  persistCurrentRoute();
});
providerSelect.addEventListener("change", () => {
  routeGeometry = null;
  routeDistanceMeters = 0;
  resetElevation();
  clearDirections();
  clearRideBack();
  updateProviderControls();
  if (
    routingEnabled &&
    providerSelect.value === "ors" &&
    !getStoredApiKey()
  ) {
    openApiHelp();
  }
  scheduleRoutingUpdate();
  persistCurrentRoute();
});
saveKeyBtn.addEventListener("click", saveApiKey);
editKeyBtn.addEventListener("click", editApiKey);
apiKeyInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    saveApiKey();
  }
});
helpKeyBtn.addEventListener("click", openApiHelp);
closeModalBtn.addEventListener("click", closeApiHelp);
apiHelpModal.addEventListener("click", (event) => {
  if (event.target === apiHelpModal) {
    closeApiHelp();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !apiHelpModal.classList.contains("hidden")) {
    closeApiHelp();
  }
});
rideBackBtn.addEventListener("click", toggleRideBack);
directionsToggleBtn.addEventListener("click", () => {
  directionsPanel.classList.add("hidden");
});
debugToggleBtn.addEventListener("click", () => {
  const open = debugPanel.dataset.open !== "true";
  setDebugOpen(open);
});
testElevationBtn.addEventListener("click", testElevationEndpoints);
clearDebugBtn.addEventListener("click", clearDebugLog);
locateBtn.addEventListener("click", locateUser);
exportBtn.addEventListener("click", downloadGpx);
unitsBtn.addEventListener("click", () => setUnitsMode(!useMiles));
themeBtn.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
});
saveRouteBtn.addEventListener("click", saveNamedRoute);
routeNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    saveNamedRoute();
  }
});
loadRouteBtn.addEventListener("click", loadNamedRoute);
deleteRouteBtn.addEventListener("click", deleteNamedRoute);
gpxInput.addEventListener("change", handleGpxImport);
updateRouteBtn.addEventListener("click", () => {
  if (!routingEnabled) {
    setStatus("Turn on Snap to roads first.", true);
    return;
  }
  refreshRouteIfNeeded();
});

// ------- Bootstrap -------
routingEnabled = routingToggle.checked;
autoRoutingEnabled = autoRouteToggle.checked;
initTheme();
initUnits();
initDebug();
updateCyclingControls();
updateProviderControls();
updateRoutingOptionsState();
updateTileLayer();
updateButtons();
renderChart(null, null);
clearDirections();
apiKeyInput.value = "";
refreshApiKeyUI();
refreshSavedRoutesSelect();

const restored = restoreCurrentRoute();
if (!restored) {
  setStatus("Ready — click the map to start.");
  const savedLocation = loadSavedLocation();
  if (savedLocation) {
    map.setView(savedLocation, 14);
    if (locationMarker) {
      locationMarker.remove();
    }
    locationMarker = L.circleMarker(savedLocation, {
      radius: 7,
      color: ACCENT,
      weight: 2,
      fillColor: "#d1ecd9",
      fillOpacity: 0.9,
    }).addTo(map);
  } else {
    locateUser();
  }
}
