let cred;

/*
https://dev.emby.media/doc/restapi/index.html
https://dev.emby.media/doc/restapi/Item-Information.html
https://dev.emby.media/reference/RestAPI.html
https://dev.emby.media/home/sdk/apiclients/index.html
*/

const testCred = 
{markUsrId: "894c752d448f45a3a1260ccaabd0adff",
token:      "aad53eb6d92243c3b8ebd3151233260c"}

export async function init(credIn) { 
  cred = credIn; 
}

export function showListUrl(cred, startIdx=0, limit=10000) {
  return `https://hahnca.com:8920 / emby / Users 
          / ${cred.markUsrId} / Items
    ?SortBy=SortName
    &SortOrder=Ascending
    &IncludeItemTypes=Series
    &Recursive=true 
    &Fields= Name              %2c Id                %2c
             IsFavorite        %2c Played            %2c 
             UnplayedItemCount %2c DateCreated       %2c 
             ExternalUrls      %2c Genres            %2c 
             Overview          %2c Path              %2c 
             People            %2c PremiereDate      %2c 
             IsUnaired         %2c ProviderIds
    &StartIndex=${startIdx}
    &ParentId=4514ec850e5ad0c47b58444e17b6346c
    &Limit=${limit}
    &X-Emby-Token=${cred.token}
  `.replace(/\s*/g, "");
}

export function childrenUrl(cred, parentId='', unAired=false) {
  if(parentId.startsWith("noemby-")) {
    console.error(`childrenUrl, noemby parentId: ${parentId}`);
    return '';
  }
  return `https://hahnca.com:8920 / emby / Users 
          / ${cred.markUsrId} / Items /
    ? ParentId=${parentId}
    ${unAired ? '& IsUnaired = true' : ''}
    & Fields = MediaSources,DateCreated,Genres,Overview,People,ProviderIds,ExternalUrls,Path,SortName,ProductionYear,Status,UserData,PlayAccess,IsFolder,Type,Tags,PremiereDate
    & X-Emby-Token = ${cred.token}
  `.replace(/\s*/g, "");
}

export function postUserDataUrl(cred, id) {
  return `https://hahnca.com:8920 / emby / Users 
          / ${cred.markUsrId} / Items / ${id} / UserData
    ? X-Emby-Token=${cred.token}
  `.replace(/\s*/g, "");
}

export function favoriteUrl(cred, id) {
  return encodeURI(`https://hahnca.com:8920 / emby / Users 
          / ${cred.markUsrId} / FavoriteItems / ${id}
    ?X-Emby-Client=Emby Web
    &X-Emby-Device-Name=Chrome
    &X-Emby-Device-Id=f4079adb-6e48-4d54-9185-5d92d3b7176b
    &X-Emby-Client-Version=1.0.0
    &X-Emby-Token=${cred.token}
  `.replace(/\s*/g, ""));
}

export function deleteShowUrl(cred, id) {
  return `https://hahnca.com:8920 / emby / Items / ${id}
    ?X-Emby-Client=EmbyWeb
    &X-Emby-Device-Name=Chrome
    &X-Emby-Device-Id=f4079adb-6e48-4d54-9185-5d92d3b7176b
    &X-Emby-Client-Version=4.6.4.0
    &X-Emby-Token=${cred.token}
  `.replace(/\s*/g, "");
}

export function embyPageUrl(id) {
  return `https://hahnca.com:8920 / web / index.html #! / item
    ?id=${id}&serverId=ae3349983dbe45d9aa1d317a7753483e
  `.replace(/\s*/g, "");
}

export function collectionListUrl(cred, collId) {
  return `https://hahnca.com:8920 / emby / Users / 
          ${cred.markUsrId} / Items
    ?ParentId=${collId}
    &ImageTypeLimit=1
    &Fields=PrimaryImageAspectRatio,ProductionYear,CanDelete
    &EnableTotalRecordCount=false
    &X-Emby-Client=EmbyWeb
    &X-Emby-Device-Name=Chrome
    &X-Emby-Device-Id=f4079adb-6e48-4d54-9185-5d92d3b7176b
    &X-Emby-Client-Version=4.6.4.0
    &X-Emby-Token=${cred.token}
  `.replace(/\s*/g, "");
}

export function collectionUrl(cred, showId, collId) {
  return `https://hahnca.com:8920 / emby / 
          Collections / ${collId} / Items
    ?Ids=${showId}
    &userId=${cred.markUsrId}
    &X-Emby-Client=Emby Web
    &X-Emby-Device-Name=Chrome
    &X-Emby-Device-Id=f4079adb-6e48-4d54-9185-5d92d3b7176b
    &X-Emby-Client-Version=4.6.4.0
    &X-Emby-Token=${cred.token}
  `.replace(/\s*/g, "");
}
 /////////////////// api key urls ////////////////////////

const markUsrId = "894c752d448f45a3a1260ccaabd0adff";
const apiKey    ='9863c23d912349599e395950609c84cc';
const hahnca    = 'https://hahnca.com:8920/emby/';

const deviceId = (player) => 
        (player == 'roku') 
        ? '9f53d43e-e5f7-5161-881a-d91843d0d372'   
        : 'ca632bcd-7279-4fc2-b5b8-6f92ae6ddb08';
        
export function sessionUrl(player) {
        return `${hahnca}   Sessions
        ? ControllableByUserId = ${cred.markUsrId}
        & deviceId = ${deviceId(player)} 
        & api_key  = ${apiKey}`
        .replace(/\s*/g, "");
}

export function playRokuUrl( sessionId, episodeId) {
  return {url: `${hahnca}  Sessions /
                ${sessionId} / Playing
                ? ItemIds     = ${episodeId} 
                & PlayCommand = PlayNow
                & api_key     = ${apiKey} `
                .replace(/\s*/g, ""),
          body: {
            ControllingUserId:   markUsrId,
            SubtitleStreamIndex: 1,
            AudioStreamIndex:    1,
            StartIndex:          1,
          }
        };
}

export function stopRokuUrl(sessionId) {
  return {url: `${hahnca}  Sessions /
                ${sessionId} / Playing / stop
                ? api_key = ${apiKey} `
                .replace(/\s*/g, ""),
          body: {
            ControllingUserId:   markUsrId,
            Command: "Stop",
            SeekPositionTicks: 0,
          }
        };
}
/*

---- stop ---- works ----
curl -X 'POST'   'https://hahnca.com:8920/emby/Sessions/f1fd0596d93fc5ad959006d3cdafcc71/Playing/Stop?api_key=9863c23d912349599e395950609c84cc'   -H 'accept: *\/*'   -H 'Content-Type: application/json'   -d '{
  "Command": "Stop",
  "SeekPositionTicks": 0,
  "ControllingUserId": "894c752d448f45a3a1260ccaabd0adff"
}'


---- getCurrentlyWatching data ----
{ 
    "PlayState": {
        "PositionTicks": 13720000000,
        "CanSeek": true,
        "IsPaused": true,
        "IsMuted": false,
        "AudioStreamIndex": 1,
        "SubtitleStreamIndex": 2,
        "MediaSourceId": "5b65209d5560efc10bedf1ea143817c6",
        "PlayMethod": "Transcode",
        "RepeatMode": "RepeatNone",
        "SubtitleOffset": 0,
        "PlaybackRate": 1
    },
    "AdditionalUsers": [],
    "RemoteEndPoint": "192.168.1.44",
    "Protocol": "HTTP/1.1",
    "PlayableMediaTypes": [
        "Audio",
        "Video",
        "Photo"
    ],
    "PlaylistIndex": 0,
    "PlaylistLength": 1,
    "Id": "f1fd0596d93fc5ad959006d3cdafcc71",
    "ServerId": "ae3349983dbe45d9aa1d317a7753483e",
    "UserId": "894c752d448f45a3a1260ccaabd0adff",
    "UserName": "mark",
    "Client": "Roku SG",
    "LastActivityDate": "2025-01-09T22:31:50.9443462Z",
    "DeviceName": "Roku Ultra",
    "NowPlayingItem": {
        "Name": "VIII",
        "ServerId": "ae3349983dbe45d9aa1d317a7753483e",
        "Id": "4784184",
        "DateCreated": "2024-10-05T03:32:29.0000000Z",
        "PresentationUniqueKey": "367392-en-4514ec850e5ad0c47b58444e17b6346c-002 - 0001",
        "Container": "mkv",
        "PremiereDate": "2024-09-12T07:00:00.0000000Z",
        "ExternalUrls": [
            {
                "Name": "IMDb",
                "Url": "https://www.imdb.com/title/tt21152280"
            },
            {
                "Name": "TheTVDB",
                "Url": "https://thetvdb.com/?tab=episode&id=10585954"
            },
            {
                "Name": "Trakt",
                "Url": "https://trakt.tv/search/imdb/tt21152280"
            }
        ],
        "Path": "/mnt/media/tv/The Old Man/Season 2/The Old Man S02E01 VIII 1080p DSNP WEB-DL DDP5 1 H 264-APEX.mkv",
        "Overview": "Dan Chase and Harold Harper are now in Afghanistan; they have to evade the Taliban in order to save Emily.",
        "Taglines": [],
        "Genres": [],
        "RunTimeTicks": 28670080000,
        "Size": 2024506589,
        "FileName": "The Old Man S02E01 VIII 1080p DSNP WEB-DL DDP5 1 H 264-APEX.mkv",
        "Bitrate": 5649113,
        "ProductionYear": 2024,
        "IndexNumber": 1,
        "ParentIndexNumber": 2,
        "ProviderIds": {
            "Tvdb": "10585954",
            "IMDB": "tt21152280"
        },
        "IsFolder": false,
        "ParentId": "4784183",
        "Type": "Episode",
        "Studios": [],
        "GenreItems": [],
        "ParentLogoItemId": "4692721",
        "ParentBackdropItemId": "4692721",
        "ParentBackdropImageTags": [
            "eff8a616376f6f3dacbc7fb4e50c9eab"
        ],
        "SeriesName": "The Old Man",
        "SeriesId": "4692721",
        "SeasonId": "4784183",
        "PrimaryImageAspectRatio": 1.7777777777777777,
        "SeriesPrimaryImageTag": "26c3f00231652d41f2f5770ac09e02d2",
        "SeasonName": "Season 2",
        "MediaStreams": [
            {
                "Codec": "h264",
                "Language": "eng",
                "ColorTransfer": "bt709",
                "ColorPrimaries": "bt709",
                "ColorSpace": "bt709",
                "TimeBase": "1/1000",
                "VideoRange": "SDR",
                "DisplayTitle": "1080p H264",
                "DisplayLanguage": "English",
                "NalLengthSize": "4",
                "IsInterlaced": false,
                "BitRate": 5649113,
                "BitDepth": 8,
                "RefFrames": 1,
                "IsDefault": true,
                "IsForced": false,
                "Height": 1080,
                "Width": 1920,
                "AverageFrameRate": 23.976025,
                "RealFrameRate": 23.976025,
                "Profile": "High",
                "Type": "Video",
                "AspectRatio": "16:9",
                "Index": 0,
                "IsExternal": false,
                "IsTextSubtitleStream": false,
                "SupportsExternalStream": false,
                "Protocol": "File",
                "PixelFormat": "yuv420p",
                "Level": 40,
                "IsAnamorphic": false,
                "ExtendedVideoType": "None",
                "ExtendedVideoSubType": "None",
                "ExtendedVideoSubTypeDescription": "None",
                "AttachmentSize": 0
            },
            {
                "Codec": "eac3",
                "Language": "eng",
                "TimeBase": "1/1000",
                "DisplayTitle": "English EAC3 5.1 (Default)",
                "DisplayLanguage": "English",
                "IsInterlaced": false,
                "ChannelLayout": "5.1",
                "BitRate": 256000,
                "Channels": 6,
                "SampleRate": 48000,
                "IsDefault": true,
                "IsForced": false,
                "Type": "Audio",
                "Index": 1,
                "IsExternal": false,
                "IsTextSubtitleStream": false,
                "SupportsExternalStream": false,
                "Protocol": "File",
                "ExtendedVideoType": "None",
                "ExtendedVideoSubType": "None",
                "ExtendedVideoSubTypeDescription": "None",
                "AttachmentSize": 0
            },
            {
                "Codec": "subrip",
                "Language": "eng",
                "TimeBase": "1/1000",
                "Title": "Forced",
                "DisplayTitle": "English (Default Forced SUBRIP)",
                "DisplayLanguage": "English",
                "IsInterlaced": false,
                "IsDefault": true,
                "IsForced": true,
                "Type": "Subtitle",
                "Index": 2,
                "IsExternal": false,
                "IsTextSubtitleStream": true,
                "SupportsExternalStream": true,
                "Protocol": "File",
                "ExtendedVideoType": "None",
                "ExtendedVideoSubType": "None",
                "ExtendedVideoSubTypeDescription": "None",
                "AttachmentSize": 0,
                "SubtitleLocationType": "InternalStream"
            },
            {
                "Codec": "subrip",
                "Language": "eng",
                "TimeBase": "1/1000",
                "DisplayTitle": "English (SUBRIP)",
                "DisplayLanguage": "English",
                "IsInterlaced": false,
                "IsDefault": false,
                "IsForced": false,
                "Type": "Subtitle",
                "Index": 3,
                "IsExternal": false,
                "IsTextSubtitleStream": true,
                "SupportsExternalStream": true,
                "Protocol": "File",
                "ExtendedVideoType": "None",
                "ExtendedVideoSubType": "None",
                "ExtendedVideoSubTypeDescription": "None",
                "AttachmentSize": 0,
                "SubtitleLocationType": "InternalStream"
            },
            {
                "Codec": "subrip",
                "Language": "eng",
                "TimeBase": "1/1000",
                "Title": "SDH",
                "DisplayTitle": "English (SUBRIP)",
                "DisplayLanguage": "English",
                "IsInterlaced": false,
                "IsDefault": false,
                "IsForced": false,
                "Type": "Subtitle",
                "Index": 4,
                "IsExternal": false,
                "IsTextSubtitleStream": true,
                "SupportsExternalStream": true,
                "Protocol": "File",
                "ExtendedVideoType": "None",
                "ExtendedVideoSubType": "None",
                "ExtendedVideoSubTypeDescription": "None",
                "AttachmentSize": 0,
                "SubtitleLocationType": "InternalStream"
            },
            {
                "Codec": "subrip",
                "Language": "cze",
                "TimeBase": "1/1000",
                "DisplayTitle": "Czech (SUBRIP)",
                "DisplayLanguage": "Czech",
                "IsInterlaced": false,
                "IsDefault": false,
                "IsForced": false,
                "Type": "Subtitle",
                "Index": 5,
                "IsExternal": false,
                "IsTextSubtitleStream": true,
                "SupportsExternalStream": true,
                "Protocol": "File",
                "ExtendedVideoType": "None",
                "ExtendedVideoSubType": "None",
                "ExtendedVideoSubTypeDescription": "None",
                "AttachmentSize": 0,
                "SubtitleLocationType": "InternalStream"
            },
            {
                "Codec": "subrip",
                "Language": "dan",
                "TimeBase": "1/1000",
                "DisplayTitle": "Danish (SUBRIP)",
                "DisplayLanguage": "Danish",
                "IsInterlaced": false,
                "IsDefault": false,
                "IsForced": false,
                "Type": "Subtitle",
                "Index": 6,
                "IsExternal": false,
                "IsTextSubtitleStream": true,
                "SupportsExternalStream": true,
                "Protocol": "File",
                "ExtendedVideoType": "None",
                "ExtendedVideoSubType": "None",
                "ExtendedVideoSubTypeDescription": "None",
                "AttachmentSize": 0,
                "SubtitleLocationType": "InternalStream"
            },
            {
                "Codec": "subrip",
                "Language": "ger",
                "TimeBase": "1/1000",
                "DisplayTitle": "German (SUBRIP)",
                "DisplayLanguage": "German",
                "IsInterlaced": false,
                "IsDefault": false,
                "IsForced": false,
                "Type": "Subtitle",
                "Index": 7,
                "IsExternal": false,
                "IsTextSubtitleStream": true,
                "SupportsExternalStream": true,
                "Protocol": "File",
                "ExtendedVideoType": "None",
                "ExtendedVideoSubType": "None",
                "ExtendedVideoSubTypeDescription": "None",
                "AttachmentSize": 0,
                "SubtitleLocationType": "InternalStream"
            },
            {
                "Codec": "subrip",
                "Language": "gre",
                "TimeBase": "1/1000",
                "DisplayTitle": "Greek, Modern (1453-) (SUBRIP)",
                "DisplayLanguage": "Greek, Modern (1453-)",
                "IsInterlaced": false,
                "IsDefault": false,
                "IsForced": false,
                "Type": "Subtitle",
                "Index": 8,
                "IsExternal": false,
                "IsTextSubtitleStream": true,
                "SupportsExternalStream": true,
                "Protocol": "File",
                "ExtendedVideoType": "None",
                "ExtendedVideoSubType": "None",
                "ExtendedVideoSubTypeDescription": "None",
                "AttachmentSize": 0,
                "SubtitleLocationType": "InternalStream"
            },
            {
                "Codec": "subrip",
                "Language": "spa",
                "TimeBase": "1/1000",
                "Title": "Spanish (Latin America)",
                "DisplayTitle": "Spanish (SUBRIP)",
                "DisplayLanguage": "Spanish",
                "IsInterlaced": false,
                "IsDefault": false,
                "IsForced": false,
                "Type": "Subtitle",
                "Index": 9,
                "IsExternal": false,
                "IsTextSubtitleStream": true,
                "SupportsExternalStream": true,
                "Protocol": "File",
                "ExtendedVideoType": "None",
                "ExtendedVideoSubType": "None",
                "ExtendedVideoSubTypeDescription": "None",
                "AttachmentSize": 0,
                "SubtitleLocationType": "InternalStream"
            },
            {
                "Codec": "subrip",
                "Language": "spa",
                "TimeBase": "1/1000",
                "Title": "Spanish (Spain)",
                "DisplayTitle": "Spanish (SUBRIP)",
                "DisplayLanguage": "Spanish",
                "IsInterlaced": false,
                "IsDefault": false,
                "IsForced": false,
                "Type": "Subtitle",
                "Index": 10,
                "IsExternal": false,
                "IsTextSubtitleStream": true,
                "SupportsExternalStream": true,
                "Protocol": "File",
                "ExtendedVideoType": "None",
                "ExtendedVideoSubType": "None",
                "ExtendedVideoSubTypeDescription": "None",
                "AttachmentSize": 0,
                "SubtitleLocationType": "InternalStream"
            },
            {
                "Codec": "subrip",
                "Language": "fin",
                "TimeBase": "1/1000",
                "DisplayTitle": "Finnish (SUBRIP)",
                "DisplayLanguage": "Finnish",
                "IsInterlaced": false,
                "IsDefault": false,
                "IsForced": false,
                "Type": "Subtitle",
                "Index": 11,
                "IsExternal": false,
                "IsTextSubtitleStream": true,
                "SupportsExternalStream": true,
                "Protocol": "File",
                "ExtendedVideoType": "None",
                "ExtendedVideoSubType": "None",
                "ExtendedVideoSubTypeDescription": "None",
                "AttachmentSize": 0,
                "SubtitleLocationType": "InternalStream"
            },
            {
                "Codec": "subrip",
                "Language": "fre",
                "TimeBase": "1/1000",
                "Title": "French (France)",
                "DisplayTitle": "French (SUBRIP)",
                "DisplayLanguage": "French",
                "IsInterlaced": false,
                "IsDefault": false,
                "IsForced": false,
                "Type": "Subtitle",
                "Index": 12,
                "IsExternal": false,
                "IsTextSubtitleStream": true,
                "SupportsExternalStream": true,
                "Protocol": "File",
                "ExtendedVideoType": "None",
                "ExtendedVideoSubType": "None",
                "ExtendedVideoSubTypeDescription": "None",
                "AttachmentSize": 0,
                "SubtitleLocationType": "InternalStream"
            },
            {
                "Codec": "subrip",
                "Language": "hun",
                "TimeBase": "1/1000",
                "DisplayTitle": "Hungarian (SUBRIP)",
                "DisplayLanguage": "Hungarian",
                "IsInterlaced": false,
                "IsDefault": false,
                "IsForced": false,
                "Type": "Subtitle",
                "Index": 13,
                "IsExternal": false,
                "IsTextSubtitleStream": true,
                "SupportsExternalStream": true,
                "Protocol": "File",
                "ExtendedVideoType": "None",
                "ExtendedVideoSubType": "None",
                "ExtendedVideoSubTypeDescription": "None",
                "AttachmentSize": 0,
                "SubtitleLocationType": "InternalStream"
            },
            {
                "Codec": "subrip",
                "Language": "ita",
                "TimeBase": "1/1000",
                "DisplayTitle": "Italian (SUBRIP)",
                "DisplayLanguage": "Italian",
                "IsInterlaced": false,
                "IsDefault": false,
                "IsForced": false,
                "Type": "Subtitle",
                "Index": 14,
                "IsExternal": false,
                "IsTextSubtitleStream": true,
                "SupportsExternalStream": true,
                "Protocol": "File",
                "ExtendedVideoType": "None",
                "ExtendedVideoSubType": "None",
                "ExtendedVideoSubTypeDescription": "None",
                "AttachmentSize": 0,
                "SubtitleLocationType": "InternalStream"
            },
            {
                "Codec": "subrip",
                "Language": "jpn",
                "TimeBase": "1/1000",
                "DisplayTitle": "Japanese (SUBRIP)",
                "DisplayLanguage": "Japanese",
                "IsInterlaced": false,
                "IsDefault": false,
                "IsForced": false,
                "Type": "Subtitle",
                "Index": 15,
                "IsExternal": false,
                "IsTextSubtitleStream": true,
                "SupportsExternalStream": true,
                "Protocol": "File",
                "ExtendedVideoType": "None",
                "ExtendedVideoSubType": "None",
                "ExtendedVideoSubTypeDescription": "None",
                "AttachmentSize": 0,
                "SubtitleLocationType": "InternalStream"
            },
            {
                "Codec": "subrip",
                "Language": "kor",
                "TimeBase": "1/1000",
                "DisplayTitle": "Korean (SUBRIP)",
                "DisplayLanguage": "Korean",
                "IsInterlaced": false,
                "IsDefault": false,
                "IsForced": false,
                "Type": "Subtitle",
                "Index": 16,
                "IsExternal": false,
                "IsTextSubtitleStream": true,
                "SupportsExternalStream": true,
                "Protocol": "File",
                "ExtendedVideoType": "None",
                "ExtendedVideoSubType": "None",
                "ExtendedVideoSubTypeDescription": "None",
                "AttachmentSize": 0,
                "SubtitleLocationType": "InternalStream"
            },
            {
                "Codec": "subrip",
                "Language": "dut",
                "TimeBase": "1/1000",
                "DisplayTitle": "Dutch (SUBRIP)",
                "DisplayLanguage": "Dutch",
                "IsInterlaced": false,
                "IsDefault": false,
                "IsForced": false,
                "Type": "Subtitle",
                "Index": 17,
                "IsExternal": false,
                "IsTextSubtitleStream": true,
                "SupportsExternalStream": true,
                "Protocol": "File",
                "ExtendedVideoType": "None",
                "ExtendedVideoSubType": "None",
                "ExtendedVideoSubTypeDescription": "None",
                "AttachmentSize": 0,
                "SubtitleLocationType": "InternalStream"
            },
            {
                "Codec": "subrip",
                "Language": "nor",
                "TimeBase": "1/1000",
                "DisplayTitle": "Norwegian (SUBRIP)",
                "DisplayLanguage": "Norwegian",
                "IsInterlaced": false,
                "IsDefault": false,
                "IsForced": false,
                "Type": "Subtitle",
                "Index": 18,
                "IsExternal": false,
                "IsTextSubtitleStream": true,
                "SupportsExternalStream": true,
                "Protocol": "File",
                "ExtendedVideoType": "None",
                "ExtendedVideoSubType": "None",
                "ExtendedVideoSubTypeDescription": "None",
                "AttachmentSize": 0,
                "SubtitleLocationType": "InternalStream"
            },
            {
                "Codec": "subrip",
                "Language": "pol",
                "TimeBase": "1/1000",
                "DisplayTitle": "Polish (SUBRIP)",
                "DisplayLanguage": "Polish",
                "IsInterlaced": false,
                "IsDefault": false,
                "IsForced": false,
                "Type": "Subtitle",
                "Index": 19,
                "IsExternal": false,
                "IsTextSubtitleStream": true,
                "SupportsExternalStream": true,
                "Protocol": "File",
                "ExtendedVideoType": "None",
                "ExtendedVideoSubType": "None",
                "ExtendedVideoSubTypeDescription": "None",
                "AttachmentSize": 0,
                "SubtitleLocationType": "InternalStream"
            },
            {
                "Codec": "subrip",
                "Language": "por",
                "TimeBase": "1/1000",
                "Title": "Portuguese (Brazil)",
                "DisplayTitle": "Portuguese (SUBRIP)",
                "DisplayLanguage": "Portuguese",
                "IsInterlaced": false,
                "IsDefault": false,
                "IsForced": false,
                "Type": "Subtitle",
                "Index": 20,
                "IsExternal": false,
                "IsTextSubtitleStream": true,
                "SupportsExternalStream": true,
                "Protocol": "File",
                "ExtendedVideoType": "None",
                "ExtendedVideoSubType": "None",
                "ExtendedVideoSubTypeDescription": "None",
                "AttachmentSize": 0,
                "SubtitleLocationType": "InternalStream"
            },
            {
                "Codec": "subrip",
                "Language": "por",
                "TimeBase": "1/1000",
                "Title": "Portuguese (Portugal)",
                "DisplayTitle": "Portuguese (SUBRIP)",
                "DisplayLanguage": "Portuguese",
                "IsInterlaced": false,
                "IsDefault": false,
                "IsForced": false,
                "Type": "Subtitle",
                "Index": 21,
                "IsExternal": false,
                "IsTextSubtitleStream": true,
                "SupportsExternalStream": true,
                "Protocol": "File",
                "ExtendedVideoType": "None",
                "ExtendedVideoSubType": "None",
                "ExtendedVideoSubTypeDescription": "None",
                "AttachmentSize": 0,
                "SubtitleLocationType": "InternalStream"
            },
            {
                "Codec": "subrip",
                "Language": "rum",
                "TimeBase": "1/1000",
                "DisplayTitle": "Romanian (SUBRIP)",
                "DisplayLanguage": "Romanian",
                "IsInterlaced": false,
                "IsDefault": false,
                "IsForced": false,
                "Type": "Subtitle",
                "Index": 22,
                "IsExternal": false,
                "IsTextSubtitleStream": true,
                "SupportsExternalStream": true,
                "Protocol": "File",
                "ExtendedVideoType": "None",
                "ExtendedVideoSubType": "None",
                "ExtendedVideoSubTypeDescription": "None",
                "AttachmentSize": 0,
                "SubtitleLocationType": "InternalStream"
            },
            {
                "Codec": "subrip",
                "Language": "slo",
                "TimeBase": "1/1000",
                "DisplayTitle": "Slovak (SUBRIP)",
                "DisplayLanguage": "Slovak",
                "IsInterlaced": false,
                "IsDefault": false,
                "IsForced": false,
                "Type": "Subtitle",
                "Index": 23,
                "IsExternal": false,
                "IsTextSubtitleStream": true,
                "SupportsExternalStream": true,
                "Protocol": "File",
                "ExtendedVideoType": "None",
                "ExtendedVideoSubType": "None",
                "ExtendedVideoSubTypeDescription": "None",
                "AttachmentSize": 0,
                "SubtitleLocationType": "InternalStream"
            },
            {
                "Codec": "subrip",
                "Language": "swe",
                "TimeBase": "1/1000",
                "DisplayTitle": "Swedish (SUBRIP)",
                "DisplayLanguage": "Swedish",
                "IsInterlaced": false,
                "IsDefault": false,
                "IsForced": false,
                "Type": "Subtitle",
                "Index": 24,
                "IsExternal": false,
                "IsTextSubtitleStream": true,
                "SupportsExternalStream": true,
                "Protocol": "File",
                "ExtendedVideoType": "None",
                "ExtendedVideoSubType": "None",
                "ExtendedVideoSubTypeDescription": "None",
                "AttachmentSize": 0,
                "SubtitleLocationType": "InternalStream"
            },
            {
                "Codec": "subrip",
                "Language": "tur",
                "TimeBase": "1/1000",
                "DisplayTitle": "Turkish (SUBRIP)",
                "DisplayLanguage": "Turkish",
                "IsInterlaced": false,
                "IsDefault": false,
                "IsForced": false,
                "Type": "Subtitle",
                "Index": 25,
                "IsExternal": false,
                "IsTextSubtitleStream": true,
                "SupportsExternalStream": true,
                "Protocol": "File",
                "ExtendedVideoType": "None",
                "ExtendedVideoSubType": "None",
                "ExtendedVideoSubTypeDescription": "None",
                "AttachmentSize": 0,
                "SubtitleLocationType": "InternalStream"
            },
            {
                "Codec": "subrip",
                "Language": "chi",
                "TimeBase": "1/1000",
                "Title": "Chinese (Traditional)",
                "DisplayTitle": "Chinese Traditional (SUBRIP)",
                "DisplayLanguage": "Chinese Traditional",
                "IsInterlaced": false,
                "IsDefault": false,
                "IsForced": false,
                "Type": "Subtitle",
                "Index": 26,
                "IsExternal": false,
                "IsTextSubtitleStream": true,
                "SupportsExternalStream": true,
                "Protocol": "File",
                "ExtendedVideoType": "None",
                "ExtendedVideoSubType": "None",
                "ExtendedVideoSubTypeDescription": "None",
                "AttachmentSize": 0,
                "SubtitleLocationType": "InternalStream"
            }
        ],
        "ImageTags": {
            "Primary": "c54b3fb5f2a4101f671b584f15cfb01a"
        },
        "BackdropImageTags": [],
        "ParentLogoImageTag": "16945e975ea039baf0a30645c411cba8",
        "ParentThumbItemId": "4692721",
        "ParentThumbImageTag": "1f9692c6fdaed96f93f76421a38d8f25",
        "Chapters": [
            {
                "StartPositionTicks": 0,
                "Name": "Chapter 01",
                "MarkerType": "Chapter",
                "ChapterIndex": 0
            },
            {
                "StartPositionTicks": 1815570000,
                "Name": "Intro",
                "MarkerType": "Chapter",
                "ChapterIndex": 1
            },
            {
                "StartPositionTicks": 2059980000,
                "Name": "Chapter 03",
                "MarkerType": "Chapter",
                "ChapterIndex": 2
            },
            {
                "StartPositionTicks": 27338170000,
                "Name": "Credits",
                "MarkerType": "Chapter",
                "ChapterIndex": 3
            }
        ],
        "MediaType": "Video",
        "Width": 1920,
        "Height": 1080
    },
    "InternalDeviceId": 33,
    "DeviceId": "9f53d43e-e5f7-5161-881a-d91843d0d372",
    "ApplicationVersion": "4.1.31",
    "AppIconUrl": "https://github.com/MediaBrowser/Emby.Resources/raw/master/images/devices/roku.jpg",
    "SupportedCommands": [
        "GoHome",
        "SendString",
        "GoToSearch",
        "GoToSettings",
        "DisplayContent",
        "DisplayMessage",
        "SetAudioStreamIndex",
        "SetSubtitleStreamIndex",
        "PlayMediaSource",
        "Mute",
        "Unmute",
        "ToggleMute",
        "VolumeUp",
        "VolumeDown",
        "SetVolume",
        "ToggleOsdMenu"
    ],
    "SupportsRemoteControl": true
}

[
  {
    "PlayState": {
      "CanSeek": false,
      "IsPaused": false,
      "IsMuted": false,
      "RepeatMode": "RepeatNone",
      "SubtitleOffset": 0,
      "PlaybackRate": 1
    },
    "AdditionalUsers": [],
    "RemoteEndPoint": "192.168.1.44",
    "Protocol": "HTTP/1.1",
    "PlayableMediaTypes": [
      "Audio",
      "Video",
      "Photo"
    ],
    "PlaylistIndex": 0,
    "PlaylistLength": 0,
    "Id": "f1fd0596d93fc5ad959006d3cdafcc71",
    "ServerId": "ae3349983dbe45d9aa1d317a7753483e",
    "UserId": "894c752d448f45a3a1260ccaabd0adff",
    "UserName": "mark",
    "Client": "Roku SG",
    "LastActivityDate": "2025-01-09T05:06:20.1338829Z",
    "DeviceName": "Roku Ultra",
    "InternalDeviceId": 33,
    "DeviceId": "9f53d43e-e5f7-5161-881a-d91843d0d372",
    "ApplicationVersion": "4.1.31",
    "AppIconUrl": "https://github.com/MediaBrowser/Emby.Resources/raw/master/images/devices/roku.jpg",
    "SupportedCommands": [
      "GoHome",
      "SendString",
      "GoToSearch",
      "GoToSettings",
      "DisplayContent",
      "DisplayMessage",
      "SetAudioStreamIndex",
      "SetSubtitleStreamIndex",
      "PlayMediaSource",
      "Mute",
      "Unmute",
      "ToggleMute",
      "VolumeUp",
      "VolumeDown",
      "SetVolume",
      "ToggleOsdMenu"
    ],
    "SupportsRemoteControl": true
  }
]

 'POST' \
  'https://hahnca.com:8920/emby/Sessions/f1fd0596d93fc5ad959006d3cdafcc71/Playing?ItemIds=4785434&PlayCommand=PlayNow&api_key=9863c23d912349599e395950609c84cc' \
  -H 'accept: *\/*' \
  -H 'Content-Type: application/json' \
  -d '{
  "ControllingUserId": "894c752d448f45a3a1260ccaabd0adff",
  "SubtitleStreamIndex": 2,
  "AudioStreamIndex": 1,
  "MediaSourceId": "d32472ba46a0cb977c224d5645307288",
  "StartIndex": 1
*/