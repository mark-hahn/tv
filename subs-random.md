# Random provider page subtitle detection sample

Generated from normal API search results for: Friends, Cheers, Frasier, Severance, Breaking Bad, The Office, The Simpsons, and 3rd Rock from the Sun.

Candidate pool: 365 unique IPTorrents/TorrentLeech detail URLs. Ten were shuffled and scored with `GET /api/tor/subs`.

| Result | Confidence | Source | URL | Show | Title | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| no | medium | page-text | https://www.torrentleech.org/torrent/1582320#torrentinfo | Cheers | Cheers S02 1080p Amazon WEB-DL DD+ 2 0 H 264-TrollHD | no subtitle evidence found in provider page text |
| no | medium | page-text | https://iptorrents.com/t/6460972 | Severance | Severance S02E05 1080p WEB H264-SuccessfulCrab | no subtitle evidence found in provider page text |
| maybe | low | group-prior | https://iptorrents.com/t/6497340 | Severance | Severance S02E07 1080p WEB h264-ETHEL | ETHEL has correlated with subtitles, but the page has no direct proof |
| no | medium | page-text | https://iptorrents.com/t/7497535 | Frasier | Frasier S04E05 Head Game 1080p AMZN WEB-DL DD 2 0 H 264-playWEB | no subtitle evidence found in provider page text |
| no | medium | page-text | https://iptorrents.com/t/7497652 | Frasier | Frasier S05E09 Perspectives on Christmas 1080p AMZN WEB-DL DD 2 0 H 264-playWEB | no subtitle evidence found in provider page text |
| no | medium | page-text | https://iptorrents.com/t/7565853 | The Office | The Office US S09E14 Vandalism Extended Cut REPACK 1080p AMZN WEB-DL DDP5 1 H 264-Kitsune | no subtitle evidence found in provider page text |
| no | medium | page-text | https://www.torrentleech.org/torrent/241616755#torrentinfo | The Simpsons | The Simpsons S37E02 REPACK 1080p x265-ELiTE | no subtitle evidence found in provider page text |
| no | medium | page-text | https://www.torrentleech.org/torrent/241207231#torrentinfo | The Office | The Office US S07 Superfan Extended Cuts 1080p WebRip H264 Will1869 | no subtitle evidence found in provider page text |
| no | medium | page-text | https://iptorrents.com/t/6859570 | Breaking Bad | Breaking Bad 2008 S03 1080p NF WEB-DL DDP5 1 AV1-Vialle | no subtitle evidence found in provider page text |
| yes | high | page-mediainfo | https://www.torrentleech.org/torrent/1659312#torrentinfo | Cheers | Cheers S06 720p AMZN WEB-DL x265-HETeam | MediaInfo Text section found |
