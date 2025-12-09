# Torrent Server Commands

## Overview

The TV series client sends torrent data to the remote server via WebSocket for processing and filtering. The server receives raw torrent search results, processes them, and returns a filtered subset for display.

## Commands

### setTorrents

**Purpose**: Receive raw torrent search results, process them, and return a filtered subset for display.

**Client sends**:
```javascript
setTorrents(torrents)
```

**Parameters**: Array of torrent objects from torrent-search-api

**Example torrent object from IPTorrents**:
```json
{
  "title": "3rd Rock From The Sun S01 1080p AMZN WEB-DL DD5 1 H 264-SiGMA",
  "seeds": "38",
  "peers": "1",
  "size": "33.6 GB",
  "desc": "https://iptorrents.com/t/6663586",
  "provider": "IpTorrents"
}
```

**Example torrent object from TorrentLeech**:
```json
{
  "provider": "TorrentLeech",
  "title": "3rd Rock from the Sun (1996) S01-S06 (1080p DVD AI UPSACLE x265 HEVC 10bit DD 2 0 EDGE2020)",
  "time": "2022-10-02 04:28:14",
  "seeds": 81,
  "peers": 6,
  "size": "79.3 GiB",
  "filename": "3rd.Rock.from.the.Sun.(1996).S01-S06.(1080p.DVD.AI.UPSACLE.x265.HEVC.10bit.DD.2.0.EDGE2020).torrent",
  "fid": "240907518",
  "rating": 7.8,
  "categoryID": 27,
  "new": false,
  "numComments": 5,
  "tags": ["comedy", "Family", "FREELEECH", "Sci-Fi"],
  "imdbID": "tt0115082",
  "igdbID": "",
  "tvmazeID": "s1053"
}
```

**Expected response**:
```json
{
  "torrents": [
    {
      ...originalTorrentFields,
      "torrentId": 123
    }
  ]
}
```

**Server responsibilities**:
1. Receive array of torrent objects
2. Assign a unique `torrentId` to each torrent
3. Store torrents in memory/database for later retrieval
4. Filter/sort/limit torrents based on quality, seeds, size, etc.
5. Return filtered subset with `torrentId` added to each

**Error response**:
```json
{
  "error": "Error message here"
}
```

### getTorrent

**Purpose**: Retrieve full torrent data by ID when user clicks on a torrent.

**Client sends**:
```javascript
getTorrent(torrentId)
```

**Parameters**: Integer torrentId (assigned by server in setTorrents response)

**Expected response**:
```json
{
  "torrent": {
    ...fullTorrentData,
    "torrentId": 123
  }
}
```

**Server responsibilities**:
1. Look up torrent by `torrentId`
2. Return complete torrent object
3. May include additional metadata or download information

**Error response**:
```json
{
  "error": "Torrent not found"
}
```

## Client Flow

1. User opens torrents pane for a TV show
2. Client fetches torrents from local server (https://localhost:3001)
3. Client sends all torrents to remote server via `setTorrents`
4. Client displays filtered torrents returned by server
5. User clicks a torrent card
6. Client calls `getTorrent` with the `torrentId`
7. Client processes full torrent data (download, show details, etc.)

## Error Handling

The client checks for `error` field in all responses:
- If `result.error` exists, display error message in torrents pane
- WebSocket rejections (status: "err") are caught and displayed
- Errors show in red error section of UI

## Implementation Notes

- TorrentLeech provides much richer metadata (tags, ratings, IMDb IDs)
- IPTorrents only provides basic fields
- Server can use tags like "FREELEECH" for filtering/prioritization
- Client expects `torrents` array in response (can be empty)
- All communication is JSON-serialized via WebSocket
