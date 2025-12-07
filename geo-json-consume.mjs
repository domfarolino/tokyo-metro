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
  const returnCoords = [];

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
    returnCoords.push(entity);
  }

  // Merge as many line segments into one single adjoining "mega line" as
  // possible. Most GeoJSON `LineString` runs have starting coordinates that
  // match another segment's end coordinates, or vice versa. This gives us an
  // opportunity to find the segments that perfectly join with others, and turn
  // them into one long line. This is simpler, and it produces a WAY less choppy
  // SVG with no white gaps in between individiaul line segments.
  //
  // Note that a more generalized version of this algorithm would cater to the
  // possibility that many small segments could join into different larger
  // segments, with a handful of these larger segments remaining, that
  // themselves do not join together. Union find could join all connected
  // segments together, leaving us with a minimal set of combined segments that
  // cannot be combined further.
  //
  // In practice, this doesn't happen with Tokyo Metro, so we just pick a single
  // segment and treat it as the basis of our mega line. We then evaluate every
  // other segment and try and append/prepend it to our mega line. Anything
  // leftover is not merged. That case is only hit for a single disconnected
  // segment in both the Ginza and Fukutoshin lines, for some reason.
  //
  // Start by taking the first line segment as the start of our "mega line".
  let mega_line = returnCoords.find(entity => entity.type === 'LineString');
  let distinct_lines = -1;
  while (returnCoords.filter(entity => entity.type === 'LineString').length) {
    const current_distinct_lines = returnCoords.filter(entity => entity.type === 'LineString').length;
    if (distinct_lines === current_distinct_lines) {
      // We made no progress on the last round, so the merging is complete.
      // Break so we don't get stuck trying to merge the remaining runs into `mega_line`.
      break;
    }

    distinct_lines = current_distinct_lines;

    for (const line_segment of returnCoords) {
      // Don't consider Points or "used" LineStrings. Considering "used" line
      // segments wouldn't actually make this loop run forever, or anything bad
      // like that. It's just wasteful. The "used" status is only for filtering
      // out the merged ones after the loop.
      if (line_segment.type !== 'LineString') {
        continue;
      }

      // First, try and find a line segment that STARTS where `mega_line` ends.
      // That is, a segment, whose first coordinate matches `mega_line`'s last.
      // If we find one, then append all of `line_segment`'s coordinates to
      // `mega_line`'s coordinates, and mark `line_segment` as used, so we don't
      // consider it in the future.
      //
      // If we don't find a match, try the inverse: see if `line_segment` grows
      // `mega_line` from the other end, and should be prepended to it.
      //
      // Only comparing normalized latitude should be good enough, since it's
      // virutally impossible for two points of the same line to have the
      // *exact* same latitude and only differ in longitude. If this assumption
      // is broken, then we might greedily steal the wrong line segment here,
      // and break the flow of the line.
      if (line_segment.coords[0].latitude_norm === mega_line.coords.at(-1).latitude_norm) {
        line_segment.type = 'USED';
        // No need to preserve the first coordinate of `line_segment`, since
        // it's the same as `mega_line`'s last.
        mega_line.coords = mega_line.coords.concat(line_segment.coords.slice(1));
      } else if (line_segment.coords.at(-1).latitude_norm === mega_line.coords[0].latitude_norm) {
        line_segment.type = 'USED';
        mega_line.coords = line_segment.coords.concat(mega_line.coords.slice(1));
      }
    }
  }

  const final_line_strings = returnCoords.filter(entity => entity.type === 'LineString').length;
  console.log(`Was able to merge line into ${final_line_strings} line run(s).`);
  return returnCoords.filter(entity => entity.type != 'USED');
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
