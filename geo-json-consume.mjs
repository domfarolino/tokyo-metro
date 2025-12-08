import { readFile } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';

import { JSDOM } from 'jsdom';
import { SVG, registerWindow } from '@svgdotjs/svg.js';

const kLines = [
  {name: 'ginza', color: '#FF9500'},
  {name: 'marunouchi', color: '#F62E36'},
  {name: 'hibiya', color: '#B5B5AC'},
  {name: 'tozai', color: '#009BBF'},
  {name: 'chiyoda', color: '#00BB85'},
  {name: 'yurakucho', color: '#C1A470'},
  {name: 'hanzomon', color: '#8F76D6'},
  {name: 'namboku', color: '#00AC9B'},
  {name: 'fukutoshin', color: '#9C5E31'}
];

function drawMetroLine(draw, width, height, coordinates, line_color) {
  const kThickness = 8;
  for (const coord of coordinates) {
    if (coord.type === 'LineString') {
      draw
        .polyline(coord.coords.map(p => [p.longitude_norm * width, p.latitude_norm * height]))
        .fill('none').stroke({ color : line_color, width: kThickness })
        .attr('stroke-linecap', 'round');
    } else if (coord.type === 'Point') {
      draw
        .circle(kThickness - 1)
        .fill('white')
        .center(coord.coords[0].longitude_norm * width, coord.coords[0].latitude_norm * height);
    }
  }
}

// These globals are set by the `computeAspectRatio()` function below.
let aspect_ratio = undefined;
// The aspect ratio and overall late/long range is needed to normalize each
// coordinate on a canvas of arbitrary size.
let min_X = Infinity,
    max_X = -Infinity,
    min_Y = Infinity,
    max_Y = -Infinity;
let rangeLat = undefined,
    rangeLong = undefined;

function computeAspectRatio() {
  for (const line of kLines) {
    for (const feature of line.json['features']) {
      const geometry_type = feature['geometry']['type'];

      let coordinates = feature['geometry']['coordinates'];
      // Ignore `Polygon` geometries; they only represent station platforms
      // which we don't care about.
      if (geometry_type === 'LineString' && feature.properties.railway === 'subway') {
        // Do nothing to re-package coordinates of the `LineString`.
      } else if (geometry_type === 'Point' && feature.properties.railway === 'stop') {
        coordinates = [coordinates];
      } else {
        // We must not care about this geometry point, so don't let it influence
        // our normalization.
        continue;
      }

      // OSM presents (lon, lat), because it aligns with the standard (x, y)
      // coordinate/plotting scheme.
      for (const [longitude, latitude] of coordinates) {
        min_X = Math.min(min_X, longitude);
        max_X = Math.max(max_X, longitude);

        min_Y = Math.min(min_Y, latitude);
        max_Y = Math.max(max_Y, latitude);
      }
    }
  }

  rangeLat = max_Y - min_Y;
  rangeLong = max_X - min_X;
  aspect_ratio = rangeLong / rangeLat;
}

function generateNormalizedCoordinates(json) {
  const normalizedCoords = [];

  for (const feature of json['features']) {
    const geometry_type = feature['geometry']['type'];

    let coordinates = feature['geometry']['coordinates'];
    if (geometry_type === 'LineString' && feature.properties.railway === 'subway') {
      // Do nothing to re-package coordinates of the `LineString`.
    } else if (geometry_type === 'Point' && feature.properties.railway === 'stop') {
      coordinates = [coordinates];
    } else {
      continue;
    }

    const entity = {
      type: geometry_type,
      coords: [],
    };

    for (let coordinate of coordinates) {
      const coords = {
        latitude: coordinate[1],
        longitude: coordinate[0],
        latitude_norm: 1 - ((coordinate[1] - min_Y) / rangeLat),
        longitude_norm: (coordinate[0] - min_X) / rangeLong,
      };
      entity.coords.push(coords);
    }
    normalizedCoords.push(entity);
  }

  // Most GeoJSON `LineString` runs start where another ends, or vice versa.
  // Merge as many adjoining line segments as possible. This is simpler, and it
  // produces a WAY smoother SVG with no missing gaps between adjoining segments
  // with sharp turns.
  //
  // Note that most of the time this will result in a single "mega" line
  // segment, which is idea. But for Tokyo Metro, for some reason the Ginza and
  // Fukutoshin lines have exactly 2 reduced line segments.
  const merged_segments = [];
  const line_segments = normalizedCoords.filter(entity => entity.type === 'LineString');
  const remaining_segments = new Set(line_segments);
  for (const current_segment of line_segments) {
    if (!remaining_segments.has(current_segment)) {
      // `current_segment` was already subsumed by a greater segment. No need to
      // consider it.
      continue;
    }
    remaining_segments.delete(current_segment);

    let performed_merge = true;
    while (performed_merge) {
      // Only set `performed_true` when a remaining segment merges with
      // `current_segment`. If this happened at least once, then we have to
      // re-consider at all remaining segments again, as `current_segment` has
      // changed, and may be compatible with other segments.
      performed_merge = false;
      // Iterate over a copy because we mutate it while iterating.
      for (const candidate of Array.from(remaining_segments)) {
        // If `candidate` starts where `current_segment` ends...
        if (candidate.coords[0].latitude_norm === current_segment.coords.at(-1).latitude_norm) {
          // No need to preserve `candidate`'s first coordinate, since it's the
          // same as the current line's last.
          performed_merge = true;
          current_segment.coords.push(...candidate.coords.slice(1));
          remaining_segments.delete(candidate);
        } else if (candidate.coords.at(-1).latitude_norm === current_segment.coords[0].latitude_norm) {
          performed_merge = true;
          current_segment.coords.unshift(...candidate.coords.slice(0, -1));
          remaining_segments.delete(candidate);
        }
      }
    }

    merged_segments.push(current_segment);
  }

  console.log(`Was able to merge line into ${merged_segments.length} line run(s).`);
  // Return an array with all merged `LineString`s first, and all `Point`s
  // after.
  return merged_segments
    .concat(normalizedCoords.filter(entity => entity.type !== 'LineString'));
}

const kBaseSize = 600;

// First, populate all `kLine` objects with the GeoJSON read from each file.
for (const line of kLines) {
  console.log(`Processing the ${line.name} line`);
  line.json = JSON.parse(await readFile(`${line.name}.geojson`, 'utf8'));
}

computeAspectRatio();

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const document = dom.window.document;
const body = document.body;

// Register the JSDOM window and document with SVG.js
registerWindow(dom.window, document);

const draw = SVG().addTo(body).viewbox(0, 0, /*width=*/kBaseSize * aspect_ratio, /*height=*/kBaseSize);

for (const line of kLines) {
  const normalized_coordinates = generateNormalizedCoordinates(line.json);
  console.log(`Drawing the ${line.name} line`);
  drawMetroLine(draw, /*width=*/kBaseSize * aspect_ratio, /*height=*/kBaseSize, normalized_coordinates, line.color);
}

await writeFile('tokyo-metro.svg', body.innerHTML);
