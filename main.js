/* global L Papa */

/*
 * Script to display two tables from Google Sheets as point and geometry layers using Leaflet
 * The Sheets are then imported using PapaParse and overwrite the initially loaded layers
 */

// PASTE YOUR URLs HERE
// these URLs come from Google Sheets 'shareable link' form
// the first is the geometry layer and the second the points
let geomURL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTsAyA0Hpk_-WpKyN1dfqi5IPEIC3rqEiL-uwElxJpw_U7BYntc8sDw-8sWsL87JCDU4lVg2aNi65ES/pub?output=csv";
let pointsURL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSFQw9sVY16eQmN5TIjOH7CUaxeZnl_v6LcdE2goig1pSe9I3hipeOn1sOwmC4fS0AURefRWwcKExct/pub?output=csv";

window.addEventListener("DOMContentLoaded", init);

let map;
let sidebar;
let panelID = "my-info-panel";

// --- ΧΩΡΙΚΗ ΕΠΙΓΝΩΣΗ (state + helpers) ---
const spatial = { enabled: true, radiusKm: 3, center: null };
let filterRing = null;

function km(a, b) {
  return a.distanceTo(b) / 1000;
}
function isTile(l) {
  return l instanceof L.TileLayer;
}
function applySpatialFilter() {
  if (!spatial.enabled || !spatial.center) {
    // reset: εμφάνιση όλων
    map.eachLayer((l) => {
      if (isTile(l)) return;
      if (l instanceof L.Marker && l.setOpacity) l.setOpacity(1);
      if (l instanceof L.Path && l.setStyle) {
        const baseFill =
          l.options && typeof l.options.fillOpacity === "number"
            ? l.options.fillOpacity
            : 0.3;
        l.setStyle({ opacity: 1, fillOpacity: baseFill });
      }
    });
    if (filterRing) {
      map.removeLayer(filterRing);
      filterRing = null;
    }
    return;
  }

  // κράτα/ζωγράφισε κύκλο φίλτρου
  if (filterRing)
    filterRing
      .setLatLng(spatial.center)
      .setRadius(spatial.radiusKm * 1000);
  else
    filterRing = L.circle(spatial.center, {
      radius: spatial.radiusKm * 1000,
      color: "green",
      fillOpacity: 0.1,
    }).addTo(map);

  map.eachLayer((l) => {
    if (isTile(l)) return;
    // MARKERS
    if (l instanceof L.Marker && l.getLatLng && l.setOpacity) {
      const d = km(spatial.center, l.getLatLng());
      l.setOpacity(d <= spatial.radiusKm ? 1 : 0);
    }
    // ΓΕΩΜΕΤΡΙΕΣ (Polygon/Polyline/CircleMarker): κρίνουμε με βάση το κέντρο των bounds
    if (l instanceof L.Path && l.getBounds && l.setStyle) {
      const c = l.getBounds().getCenter();
      const d = km(spatial.center, c);
      const show = d <= spatial.radiusKm;
      const baseFill =
        l.options && typeof l.options.fillOpacity === "number"
          ? l.options.fillOpacity
          : 0.3;
      l.setStyle({ opacity: show ? 1 : 0, fillOpacity: show ? baseFill : 0 });
    }
  });
}

/*
 * init() is called when the page has loaded
 */
function init() {
  // Create a new Leaflet map (π.χ. Αθήνα)
  map = L.map("map").setView([37.9755, 23.7349], 14);

  // This is the Carto Positron basemap
  L.tileLayer(
    "https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_all/{z}/{x}/{y}{r}.png",
    {
      attribution:
        "&copy; <a href='http://www.openstreetmap.org/copyright'>OpenStreetMap</a> &copy; <a href='http://cartodb.com/attributions'>CartoDB</a>",
      subdomains: "abcd",
      maxZoom: 19,
    }
  ).addTo(map);

  // --- Κουμπί εντοπισμού θέσης (πάνω αριστερά) ---
  const locateButton = L.control({ position: "topleft" });
  locateButton.onAdd = function (map) {
    const btn = L.DomUtil.create("button", "leaflet-bar");
    btn.innerHTML = "📍";
    btn.title = "Εντόπισέ με & εφάρμοσε φίλτρο";
    btn.style.width = "34px";
    btn.style.height = "34px";
    btn.onclick = () => map.locate({ setView: true, maxZoom: 16 });
    return btn;
  };
  locateButton.addTo(map);

  // Όταν βρεθεί η θέση
  map.on("locationfound", function (e) {
    const userIcon = L.icon({
      iconUrl: "img/my_pin.png", // βάλε το δικό σου εικονίδιο
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -28],
    });
    L.marker(e.latlng, { icon: userIcon })
      .addTo(map)
      .bindPopup(`Είσαι εδώ (ακρ. ~${Math.round(e.accuracy)}m)`);

    // ορισμός κέντρου φίλτρου κοντινότητας
    spatial.center = e.latlng;
    spatial.radiusKm = 3; // default ακτίνα
    applySpatialFilter();
  });

  // Προαιρετικά: δεξί κλικ = θέσε χειροκίνητα κέντρο φίλτρου
  map.on("contextmenu", function (e) {
    spatial.center = e.latlng;
    applySpatialFilter();
  });

  // Προαιρετικά: διπλό κλικ = καθάρισε το φίλτρο
  map.on("dblclick", function () {
    spatial.center = null;
    applySpatialFilter();
  });

  // Sidebar
  sidebar = L.control
    .sidebar({
      container: "sidebar",
      closeButton: true,
      position: "right",
    })
    .addTo(map);

  let panelContent = {
    id: panelID,
    tab: "<i class='fa fa-bars active'></i>",
    pane: "<p id='sidebar-content'></p>",
    title: "<h2 id='sidebar-title'>Nothing selected</h2>",
  };
  sidebar.addPanel(panelContent);

  map.on("click", function () {
    sidebar.close(panelID);
  });

  // Use PapaParse to load data from Google Sheets
  // And call the respective functions to add those to the map.
  Papa.parse(geomURL, {
    download: true,
    header: true,
    complete: addGeoms,
  });
  Papa.parse(pointsURL, {
    download: true,
    header: true,
    complete: addPoints,
  });
}

/*
 * Expects a JSON representation of the table with properties columns
 * and a 'geometry' column that can be parsed by parseGeom()
 */
function addGeoms(data) {
  data = data.data;
  // Convert the PapaParse JSON into a single GeoJSON FeatureCollection
  let fc = {
    type: "FeatureCollection",
    features: [],
  };

 for (let row in data) {
  if (data[row].include == "y") {
    let features = parseGeom(JSON.parse(data[row].geometry));
    features.forEach((el) => {
      el.properties = { name: data[row].name, description: data[row].description };
      fc.features.push(el);
    });
  }
} // <-- κλείνει το for

// νέο polygon εδώ ...


  // --- ΝΕΑ ΠΕΡΙΟΧΗ (Polygon) με popup) — ΜΟΝΟ ΜΙΑ ΦΟΡΑ, εκτός του for ---
  const areaCoords = [
    [37.98, 23.73],
    [37.981, 23.738],
    [37.976, 23.739],
    [37.975, 23.731],
  ];
  L.polygon(areaCoords, { color: "blue", weight: 2, fillOpacity: 0.3 })
    .addTo(map)
    .bindPopup(
      "<b>Νέα Περιοχή:</b> Κέντρο Αθήνας<br/>Περιοχή ενδιαφέροντος."
    );

  // Στυλ γεωμετριών
  let geomStyle = { color: "#2ca25f", fillColor: "#99d8c9", weight: 2 };
  let geomHoverStyle = { color: "green", fillColor: "#2ca25f", weight: 3 };

  L.geoJSON(fc, {
    onEachFeature: function (feature, layer) {
      layer.on({
        mouseout: function (e) {
          e.target.setStyle(geomStyle);
        },
        mouseover: function (e) {
          e.target.setStyle(geomHoverStyle);
        },
        click: function (e) {
          // if this isn't added, then map.click is also fired!
          L.DomEvent.stopPropagation(e);

          document.getElementById("sidebar-title").innerHTML =
            e.target.feature.properties.name;
          document.getElementById("sidebar-content").innerHTML =
            e.target.feature.properties.description;
          sidebar.open(panelID);
        },
      });
    },
    style: geomStyle,
  }).addTo(map);

  // Εφάρμοσε φίλτρο (αν υπάρχει κέντρο)
  applySpatialFilter();
}

/*
 * addPoints is a bit simpler, as no GeoJSON is needed for the points
 */
function addPoints(data) {
  data = data.data;
  let pointGroupLayer = L.layerGroup().addTo(map);

  // Επιλογή τύπου marker
  // marker: standard point with an icon
  // circleMarker: a circle with a radius set in pixels
  // circle: a circle with a radius set in meters
  let markerType = "marker";

  // Marker radius (για circleMarker/circle)
  let markerRadius = 100;

  // --- ΑΛΛΑΓΗ ΓΡΑΦΙΚΟΥ ΠΙΝΕΖΑΣ (custom εικόνα για markers) ---
  const customIcon = L.icon({
    iconUrl: "img/custom-pin.png", // δικό σου .png/.svg
    iconSize: [38, 38],
    iconAnchor: [19, 38],
    popupAnchor: [0, -30],
    shadowUrl: "css/images/marker-shadow.png",
    shadowAnchor: [12, 40],
  });

  for (let row = 0; row < data.length; row++) {
    let marker;
    if (markerType === "circleMarker") {
      marker = L.circleMarker([data[row].lat, data[row].lon], { radius: markerRadius });
    } else if (markerType === "circle") {
      marker = L.circle([data[row].lat, data[row].lon], { radius: markerRadius });
    } else {
      marker = L.marker([data[row].lat, data[row].lon], { icon: customIcon });
    }

    marker.addTo(pointGroupLayer);

    // Sidebar περιεχόμενο
    marker.feature = {
      properties: {
        name: data[row].name,
        description: data[row].description,
      },
    };
    marker.on({
      click: function (e) {
        L.DomEvent.stopPropagation(e);
        document.getElementById("sidebar-title").innerHTML =
          e.target.feature.properties.name;
        document.getElementById("sidebar-content").innerHTML =
          e.target.feature.properties.description;
        sidebar.open(panelID);
      },
    });
  } // <-- Κλείνει το for

  // --- ΝΕΑ ΤΟΠΟΘΕΣΙΑ (Marker) με popup) — ΜΟΝΟ ΜΙΑ ΦΟΡΑ, εκτός του for ---
  const extraMarker = L.marker([37.9755, 23.7349], { icon: customIcon }).addTo(map);
  extraMarker.bindPopup("<b>Νέα Τοποθεσία:</b> Πλατεία Συντάγματος<br/>Αθήνα, Ελλάδα");

  // Εφάρμοσε φίλτρο (αν υπάρχει κέντρο)
  applySpatialFilter();
} // <-- Κλείνει η addPoints

/*
 * Accepts any GeoJSON-ish object and returns an Array of
 * GeoJSON Features. Attempts to guess the geometry type
 * when a bare coordinates Array is supplied.
 */
function parseGeom(gj) {
  // FeatureCollection
  if (gj.type === "FeatureCollection") {
    return gj.features;
  }
  // Feature
  else if (gj.type === "Feature") {
    return [gj];
  }
  // Geometry
  else if ("type" in gj) {
    return [{ type: "Feature", geometry: gj }];
  }
  // Coordinates
  else {
    let type;
    if (typeof gj[0] === "number") {
      type = "Point";
    } else if (typeof gj[0][0] === "number") {
      type = "LineString";
    } else if (typeof gj[0][0][0] === "number") {
      type = "Polygon";
    } else {
      type = "MultiPolygon";
    }
    return [{ type: "Feature", geometry: { type: type, coordinates: gj } }];
  }
} // <-- Κλείνει η parseGeom και ΤΕΛΟΣ ΑΡΧΕΙΟΥ
