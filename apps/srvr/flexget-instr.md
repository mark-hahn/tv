# update flexget processing 

## generation of config.yml
- see apps/srvr/config-logic.md for how /root/dev/apps/tv/apps/srvr/config is currently used
  - this is only convenience for understanding old code, it is not for new code
- see new sample flexget config in apps/srvr/sample-flexget.yml
- static files will need to be changed to match new sample-flexget.yml structure
   - keep static files in local workspace for editing
      - no other config files should be stored locally
         - other config files are maintained as data files on server
      - local static files are authoritative
      - srvr deploy should copy static files to server config folder 
         - deploy should not overwrite any other config files

## processing on usb server
- see new sample flexget config in apps/srvr/sample-flexget.yml
- flexget should run every 15 mins
- flexget should not send files to qbittorrent for downloading
- instead flexget will do two operations every run
   - flexget will write a file /home/xobtlu/flexget/flexget-data.json 
   - flexget will then run a script /home/xobtlu/flexget/send-data.sh
      - script will send flexget-data.json to server in hahnca.com
      - keep authoritative script source locally for editing
      - deploy script to usb server after editing

## server processing of flexget-data.json
- a new endpoint will accept flexget-data.json from usb server
  - use nginx
- a persistant file apps/srvr/data/pending-flexget.json will be kept
   - data from flexget-data.json will be merged in pending-flexget.json
      - each candidate file to download will be parsed into show name, season, and episode
         - use parseFileSeasonEpisode or logic from that
      - candidate will be ignored if a decision has already been made for the episode 
         - or if an episode video file already exists or is being processed
         - or if parsed show is not in emby
      - add a timestamp to each new candidate added
   - pending-flexget.json should be a map with combined show name, season, and episode as keys
   - values are lists of candidate files to send to qbittorrent for downloading
      - each list entry should keep all needed info from flexget-data.json
         - info will be used in decision algorithm
         - info may be used to send file to qbt
   - the list value will be used to decide which candidate to send to qbt
      - a file from list will be sent to qbittorrent for downloading
      - after a decision is made change the value to "decided"
         - this will be used to block new candidates for same episode

## decision logic for candidate to send to qbittorrent for downloading
- decision logic will be run after each merging of flexget-data
   - don't run if nothing changed
- decision logic to choose a candidate
   - if only one candidate choose it
   - only decide after timestamp of most recent candidate is 24 hrs old
   - choose based on these priorities, highest first
      - highest quality resolution, 640 is default for missing data
      - highest bitdepth, 8 is default for missing data
      - position of group in apps/srvr/data/prefTorProviders.txt file
        - first in file is most preferred
        - get group from parse-torrent-title using wrapped version that removes extension
        - prefTorProviders is kept locally for editing and is deployed when changed
        - group compare is case-insensitive
        - if no group data then consider candidate lower than any other group
      - number of seeds
- when decided send candidate to qbittorrent
- log each candidate decision
   - use log file at apps/srvr/data/flexget-decision.log at server
   - include info used to make decision

## run one-time test of config logic
- create folder `/root/dev/apps/tv/apps/srvr/config-test`
- deploy new static files to config-test
- copy config data files from `/root/dev/apps/tv/apps/srvr/config`
- test merge logic to create final config-test/config.yml
- i will manually examine final config-test/config.yml for correctness

## instructions
- create a plan in temp.md
- include example of new config.yml
- make no changes other than writing plan
- notify me of any incompleteness, contradictions, ambiguity, or impossible actions
- feel free to make suggestions

