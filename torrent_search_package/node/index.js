const TorrentSearchApi = require("torrent-search-api");
const fs = require("fs");
const path = require("path");
// const WebTorrent = require('webtorrent');

const GET_TORRENT = true; // true = download .torrent file; false = get magnet URL

// const client = new WebTorrent();

TorrentSearchApi.enableProvider("ThePirateBay");
TorrentSearchApi.enableProvider("LimeTorrents");
TorrentSearchApi.enableProvider("EZTV");

async function searchAndDownload(query) {
  try {
    const results = await TorrentSearchApi.search(query, "TV", 5);

    if (!results.length) {
      console.log("No results found.");
      return;
    }

    let torrent = null;
    let magnet = "";

    if (GET_TORRENT) {
      const torrentsDir = path.join(__dirname, "torrents");
      if (!fs.existsSync(torrentsDir)) fs.mkdirSync(torrentsDir);

      for (const result of results) {
        try {
          console.log(`  [${result.title}] fetching .torrent...`);
          const buf = await TorrentSearchApi.getTorrent(result);
          if (buf && buf.length) {
            const safeName = result.title.replace(/[^a-zA-Z0-9._\- ]/g, "_");
            const outFile = path.join(torrentsDir, `${safeName}.torrent`);
            fs.writeFileSync(outFile, buf);
            console.log("Torrent file written to", outFile);
            torrent = result;
            break;
          } else {
            console.log(`    (empty response)`);
          }
        } catch (e) {
          console.log(`    (error: ${e.message})`);
        }
      }

      if (!torrent) {
        console.log("No torrent file found in any result.");
        return;
      }
    } else {
      for (const result of results) {
        const m = await TorrentSearchApi.getMagnet(result);
        console.log(`  [${result.title}] magnet: ${m || "(empty)"}`);
        if (m) {
          torrent = result;
          magnet = m;
          break;
        }
      }

      if (!magnet) {
        console.log("No magnet URL found in any result.");
        return;
      }

      const outFile = path.join(__dirname, "magnent-url.txt");
      fs.writeFileSync(outFile, magnet);
      console.log("Magnet URL written to", outFile);
    }

    console.log("Found:", torrent.title);

    // client.add(magnet, { path: path.resolve('./downloads') }, torrent => {
    //   console.log('Metadata received:', torrent.name);

    //   torrent.on('done', () => {
    //     console.log('Download finished.');
    //   });

    //   torrent.on('download', () => {
    //     console.log(`Progress: ${(torrent.progress * 100).toFixed(2)}%`);
    //   });
    // });
  } catch (err) {
    console.error(err);
  }
}

searchAndDownload("friends");
