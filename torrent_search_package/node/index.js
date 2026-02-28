const TorrentSearchApi = require("torrent-search-api");
const fs = require("fs");
const path = require("path");
// const WebTorrent = require('webtorrent');

const GET_TORRENT = false; // true = download .torrent file; false = get magnet URL
const TORRENT_LIST_ONLY = false; // true = just list results to results.txt, no download
const TEST_SEARCH_QEUERY = "friends";
const EXACT_MATCH_ONLY = true;

// const client = new WebTorrent();

TorrentSearchApi.enableProvider("ThePirateBay");
TorrentSearchApi.enableProvider("LimeTorrents");
TorrentSearchApi.enableProvider("EZTV");

async function searchAndDownload(query) {
  try {
    const results = await TorrentSearchApi.search(query, "TV", 200);

    if (!results.length) {
      console.log("No results found.");
      return;
    }

    const filtered = EXACT_MATCH_ONLY
      ? results.filter((r) => r.title === query)
      : results;
    if (!filtered.length) {
      console.log("No exact match results found.");
      return;
    }

    if (TORRENT_LIST_ONLY) {
      const lines = filtered.map(
        (r, i) =>
          `${i + 1}. [${r.provider}] ${r.title}  size:${r.size || "?"}  seeds:${r.seeds || "?"}  peers:${r.peers || "?"}`,
      );
      const outFile = path.join(__dirname, "results.txt");
      fs.writeFileSync(outFile, lines.join("\n") + "\n");
      console.log(`${filtered.length} results written to`, outFile);
      return;
    }

    let torrent = null;
    let magnet = "";

    if (GET_TORRENT) {
      const torrentsDir = path.join(__dirname, "torrents");
      if (!fs.existsSync(torrentsDir)) fs.mkdirSync(torrentsDir);

      for (const result of filtered) {
        try {
          const safeName = result.title.replace(/[^a-zA-Z0-9._\- ]/g, "_");
          const outFile = path.join(torrentsDir, `${safeName}.torrent`);
          console.log(`  [${result.title}] fetching .torrent...`);
          await TorrentSearchApi.downloadTorrent(result, outFile);
          if (fs.existsSync(outFile) && fs.statSync(outFile).size > 0) {
            console.log("Torrent file written to", outFile);
            torrent = result;
            break;
          } else {
            console.log(`    (empty response)`);
            if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
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
      for (const result of filtered) {
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

searchAndDownload(TEST_SEARCH_QEUERY);
