const TorrentSearchApi = require("torrent-search-api");
// const WebTorrent = require('webtorrent');
// const path = require('path');

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

    const torrent = results[0];
    const magnet = await TorrentSearchApi.getMagnet(torrent);

    console.log("Downloading:", torrent.title);

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
