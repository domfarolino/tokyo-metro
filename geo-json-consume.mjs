import { readFile } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';

import { JSDOM } from 'jsdom';
import { SVG, registerWindow } from '@svgdotjs/svg.js';

const kLines = [
  {name: 'ginza', color: '#FF9500'},
  /*
  {name: 'marunouchi', color: ''},
  {name: 'hibiya', color: ''},
  {name: 'tozai', color: ''},
  {name: 'chiyoda', color: ''},
  {name: 'yurakucho', color: ''},
  {name: 'hanzomon', color: ''},
  {name: 'namboku', color: ''},
  {name: 'fukutoshin', color: ''}
  */
];

async function generateSvgWithLibrary(coordinates, width, height, line_color) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const document = dom.window.document;
  const body = document.body;

  // Register the JSDOM window and document with SVG.js
  registerWindow(dom.window, document);

  const draw = SVG().addTo(body).size(width, height);
  for (const coord of coordinates) {
    console.log(coord.type);
    if (coord.type === 'LineString') {
      draw.polyline(coord.coords.map(p => [p.longitude_norm * width, p.latitude_norm * height])).fill('none').stroke({ color : line_color, width: 5 });
    } else if (coord.type === 'Point') {
      draw.circle(15).fill(line_color).center(coord.coords[0].longitude_norm * width, coord.coords[0].latitude_norm * height); 
    } else if (coord.type === 'Polygon') {
      // draw.polygon(coord.coords.map(p => [p.longitude_norm * width, p.latitude_norm * height])).stroke({ color : 'black', width: 6 });
    }
  }

  return body.innerHTML;
}

let aspect_ratio = undefined;

async function generateNormalizedCoordinates(json) {
  const returnCoords = [];

  let min_X = Infinity,
      max_X = -Infinity,
      min_Y = Infinity,
      max_Y = -Infinity;

  for (const feature of json['features']) {
    const geometry_type = feature['geometry']['type'];

    let coordinates = feature['geometry']['coordinates'];
    if (geometry_type === 'Polygon') {
      // For some reason `Polygon` coordinates are packaged like this.
      coordinates = coordinates[0];
    } else if (geometry_type === 'LineString') {
      if (feature.properties.railway !== 'subway') {
        continue;
      }
      // Do nothing to re-package coordinates of the `LineString`.
    } else if (geometry_type === 'Point') {
      if (feature.properties.railway === 'stop') {
        console.log(feature.properties['name:en']);
        coordinates = [coordinates];
      } else {
        continue;
      }
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

  const rangeLat = max_Y - min_Y;
  const rangeLong = max_X - min_X;
  aspect_ratio = rangeLong / rangeLat;

  for (const feature of json['features']) {
    const geometry_type = feature['geometry']['type'];

    let coordinates = feature['geometry']['coordinates'];
    if (geometry_type === 'Polygon') {
      // For some reason `Polygon` coordinates are packaged like this.
      coordinates = coordinates[0];
    } else if (geometry_type === 'LineString') {
      if (feature.properties.railway !== 'subway') {
        continue;
      }
      // Do nothing to re-package coordinates of the `LineString`.
    } else if (geometry_type === 'Point') {
      if (feature.properties.railway === 'stop') {
        coordinates = [coordinates];
      } else {
        continue;
      }
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

  return returnCoords;
}

const kBaseSize = 500;

for (const line of kLines) {
  const line_json = JSON.parse(await readFile(`${line.name}.json`, 'utf8'));
  const normalized_coordinates = await generateNormalizedCoordinates(line_json);
  const svg_output = await generateSvgWithLibrary(normalized_coordinates, /*width=*/kBaseSize * aspect_ratio, /*height=*/kBaseSize, line.color);
  await writeFile(`${line.name}.svg`, svg_output);
}
