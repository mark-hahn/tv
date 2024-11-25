import axios     from "axios"
import * as urls from "./urls.js";

let cred;
let firstEpi = null;

const getEpisodes = async (seasonId) => {
  const unairedObj = {};
  const unairedRes = await axios.get(
            urls.childrenUrl(cred, seasonId, true));
  for(let key in unairedRes.data.Items) {
    const episode       = unairedRes.data.Items[key];
    const episodeNumber = +episode.IndexNumber;
    unairedObj[episodeNumber] = true;
  }
  const Episodes = [];
  const episodes =
        (await axios.get(urls.childrenUrl(cred, seasonId)))
        .data.Items;
  for(let key in episodes) {
    const episode       = episodes[key];
    const episodeNumber = +episode.IndexNumber;
    // const showId        = episode.SeriesId;
    // const seasonId      = episode.SeasonId;
    const userData      = episode?.UserData;
    const watched       = !!userData?.Played;
    const haveFile      = (episode.LocationType != "Virtual");
    const unaired = 
        !!unairedObj[episodeNumber] && !watched && !haveFile;
    Episodes[episodeNumber] = {
        //  showId, seasonId, 
         watched, haveFile, unaired 
    };
  }
  return Episodes;
}

const getSeasons = async (showId) => {
  const Seasons = [];
  const seasons =
        (await axios.get(urls.childrenUrl(cred, showId)))
        .data.Items;
  for(let key in seasons) {
    let   season          = seasons[key];
    const seasonNumber    = +season.IndexNumber;
    Seasons[seasonNumber] = await getEpisodes(season.Id);
  }
  return Seasons;
};

self.onmessage = async (event) => {
  cred           = event.data.cred;
  const allShows = event.data.allShows;
  console.log(`worker started with ${allShows.length} shows`);

  const dbShows = {};
  for (let i = 0; i < allShows.length; i++) {
    const showId    = allShows[i].Id;
    dbShows[showId] = await getSeasons(showId);
  }
  self.postMessage(dbShows);

  // const jsonString = JSON.stringify(dbShows[23], null, 2);
  // console.log(jsonString);    

  console.log("worker done");
};

/*
{
  "Name": "Pilot",
  "ServerId": "ae3349983dbe45d9aa1d317a7753483e",
  "Id": "4787319",
  "MediaSources": [
    {
      "Protocol": "File",
      "Id": "05694886977020a312326ba2e6080d3a",
      "Type": "Placeholder",
      "Size": 0,
      "Name": "Pilot",
      "IsRemote": false,
      "SupportsTranscoding": true,
      "SupportsDirectStream": true,
      "SupportsDirectPlay": true,
      "IsInfiniteStream": false,
      "RequiresOpening": false,
      "RequiresClosing": false,
      "RequiresLooping": false,
      "SupportsProbing": false,
      "MediaStreams": [],
      "Formats": [],
      "RequiredHttpHeaders": {},
      "ReadAtNativeFramerate": false
    }
  ],
  "Size": 0,
  "IndexNumber": 1,
  "ParentIndexNumber": 1,
  "IsFolder": false,
  "Type": "Episode",
  "ParentLogoItemId": "4759942",
  "ParentBackdropItemId": "4759942",
  "ParentBackdropImageTags": [
    "40c0a1a40ad10cf72d034bdf66271cf5"
  ],
  "UserData": {
    "PlaybackPositionTicks": 0,
    "PlayCount": 0,
    "IsFavorite": false,
    "Played": true
  },
  "SeriesName": "Acapulco (2021)",
  "SeriesId": "4759942",
  "SeasonId": "4759943",
  "SeriesPrimaryImageTag": "699304709bb8752ecbe67a2601c01514",
  "SeasonName": "Season 1",
  "ImageTags": {},
  "BackdropImageTags": [],
  "ParentLogoImageTag": "9edd0cc08f2d67c7cb9bd088b53e0e63",
  "ParentThumbItemId": "4759942",
  "ParentThumbImageTag": "64f49a5c32a13e3832672391b9457c23",
  "LocationType": "Virtual",
  "MediaType": "Video"
}

[
  null,
  [
    null,
    {
      "showId": "23",
      "seasonId": "4555932",
      "watched": true,
      "haveFile": true,
      "unaired": false
    },
    {
      "showId": "23",
      "seasonId": "4555932",
      "watched": true,
      "haveFile": true,
      "unaired": false
    },
    {
      "showId": "23",
      "seasonId": "4555932",
      "watched": true,
      "haveFile": true,
      "unaired": false
    },
    {
      "showId": "23",
      "seasonId": "4555932",
      "watched": true,
      "haveFile": true,
      "unaired": false
    },
    {
      "showId": "23",
      "seasonId": "4555932",
      "watched": true,
      "haveFile": true,
      "unaired": false
    },
    {
      "showId": "23",
      "seasonId": "4555932",
      "watched": true,
      "haveFile": true,
      "unaired": false
    },
    {
      "showId": "23",
      "seasonId": "4555932",
      "watched": true,
      "haveFile": true,
      "unaired": false
    },
    {
      "showId": "23",
      "seasonId": "4555932",
      "watched": true,
      "haveFile": true,
      "unaired": false
    }
  ],
  [
    null,
    {
      "showId": "23",
      "seasonId": "4598548",
      "watched": true,
      "haveFile": true,
      "unaired": false
    },
    {
      "showId": "23",
      "seasonId": "4598548",
      "watched": true,
      "haveFile": true,
      "unaired": false
    },
    {
      "showId": "23",
      "seasonId": "4598548",
      "watched": true,
      "haveFile": true,
      "unaired": false
    },
    {
      "showId": "23",
      "seasonId": "4598548",
      "watched": true,
      "haveFile": true,
      "unaired": false
    },
    {
      "showId": "23",
      "seasonId": "4598548",
      "watched": true,
      "haveFile": true,
      "unaired": false
    },
    {
      "showId": "23",
      "seasonId": "4598548",
      "watched": true,
      "haveFile": true,
      "unaired": false
    },
    {
      "showId": "23",
      "seasonId": "4598548",
      "watched": true,
      "haveFile": true,
      "unaired": false
    }
  ],
  [
    null,
    {
      "showId": "23",
      "seasonId": "535",
      "watched": true,
      "haveFile": true,
      "unaired": false
    },
    {
      "showId": "23",
      "seasonId": "535",
      "watched": true,
      "haveFile": true,
      "unaired": false
    },
    {
      "showId": "23",
      "seasonId": "535",
      "watched": true,
      "haveFile": true,
      "unaired": false
    },
    {
      "showId": "23",
      "seasonId": "535",
      "watched": true,
      "haveFile": true,
      "unaired": false
    },
    {
      "showId": "23",
      "seasonId": "535",
      "watched": true,
      "haveFile": true,
      "unaired": false
    },
    {
      "showId": "23",
      "seasonId": "535",
      "watched": true,
      "haveFile": true,
      "unaired": false
    }
  ]
]
*/