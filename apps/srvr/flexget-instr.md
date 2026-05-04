

# update flexget processing 

## generation of config.yml
- examine how /root/dev/apps/tv/apps/srvr/config is currently used
   - `config1-header.txt`, `config3-middle.txt`, and `config5-footer.txt` are static
   - `config1-*` through `config5-*` are combined to make config.yml
   - config.yml is updated and deployed to usb server on any config file change
- static files will need to be changed to match new sample-flexget.yml structure
   - config files may need to be partitioned differently
   - keep static files in local workspace for editing
      - no other config files should be stored locally
         - they are maintained as data files on server
      - local static files are authoritative
      - srvr deploy should copy static files to server config folder 
         - deploy should not overwrite any other config files

## processing on usb server
- see new sample flexget config in apps/srvr/sample-flexget.yml
- flexget should not send files to qbittorrent for downloading
- instead it will do two operations every run
   - flexget will write a file /home/xobtlu/flexget/flexget-data.json 
   - flexget will then run a script /home/xobtlu/flexget/send-data.sh
      - script will send flexget-data.json to down server in hahnca.com
      - keep authoritative script source locally for editing
      - deploy script to usb server after editing

## down server processing of flexget-data.json
- a new endpoint will accept flexget-data.json from usb server
  - use nginx
- a persistant file apps/srvr/data/pending-flexget.json will be kept
   - data from flexget-data.json will be merged in pending-flexget.json
      - each candidate file to download will be parsed into show name, season, and episode
         - use parseFileSeasonEpisode or logic from that
      - candidate will be ignored if a decision has already been made for the episode 
         - or if an episode video file already exists or is being processed
      - add a timestamp to each new candidate added
   - pending-flexget.json should be a map with combined show name, season, and episode as keys
   - values are lists of candidate files to send to qbittorrent for downloading
      - each list entry should keep all needed info from flexget-data.json
         - info will be used in decision algorithm
         - info may be used to send file to qbt if necessary
   - the list value will be used to decide what to do for an episode
      - a file from list may be sent to qbittorrent for downloading
      - or the list value will be ignored
      - after a decision is made change the value to "decided"
         - this will be used to block new candidates for same episode

## decision logic for sending files to qbittorrent for downloading
- decision logic will be run after each merging of flexget-data
   - don't run if nothing changed
- decision logic rules
   - decide when timestamp of most recent candidate is 24 hrs old
   - choose based on these priorities, highest first
      - highest quality like 720, 1080, 2160
      - provider is from apps/srvr/data/prefTorProviders.txt file
        - 
        - prefTorProviders is kept locally for editing and is deployed when changed
      - number of seeds

- log each decision to send file to qbt or to ignore episode
   - include info used to make decision


# run one-time test of config logic
- create folder `/root/dev/apps/tv/apps/srvr/config-test`
- deploy new static files to config-test
- copy config data files from `/root/dev/apps/tv/apps/srvr/config`
- test merge logic to create final config-test/config.yml
- i will manually examine final config-test/config.yml for correctness

