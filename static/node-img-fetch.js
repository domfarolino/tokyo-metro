import { writeFile } from 'node:fs/promises';


const lines = [['g', 19], ['m', 25], ['h', 22], ['t', 23], ['c', 20], ['y', 24], ['z', 14], ['n', 19], ['f', 16]];

for (const line of lines) {
  const num_stops = line[1];
  for (let stop = 1; stop <= num_stops; ++stop) {
    let stop_number_string = String(stop);
    if (stop < 10) {
      stop_number_string = '0' + stop_number_string;
    }
    const kURL = `https://www.tokyometro.jp/library/common/img/station/icon_${line[0]}${stop_number_string}.png`;
    console.log(kURL);

    const response = await fetch(kURL, {headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36'
    }});
    await writeFile(`${line[0]}${stop_number_string}.png`, response.body);
  }
}
