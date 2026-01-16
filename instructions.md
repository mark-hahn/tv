

## make all these changes to integrate separate repo/projects to a new monorepo.  ask me for any decisions not covered here

- install or make changes to repos, github, pm2, pnpm, corepack,  Turborepo,  worktrees, and any others needed. ensure the  same Node major/minor version is installed on remote server, wsl, and windows. use nvm where possible.  Run all CLI tasks in WSL: pnpm install, pnpm dev, build scripts, git hooks, release scripts.

- use pnpm,  Turborepo with Local cache, Git worktrees + PM2 cwd

- Standardize dev tooling to  WSL (Node, pnpm, git, scripts). Open repo via VS Code Remote WSL.  Keep repo project folder under WSL filesystem, not /mnt/c.

- “Document the setup steps in a short DEV_SETUP.md in the  main tv project.  

- Minimize Windows dependencies: Windows only for VS Code UI + browser

- all code is javascript with nodejs or vite/vue

- remote server is hahnca.com with ssh access that needs no login

- keep tv as a project folder in wsl with only production files going to remote server for hosting

- remote dirs are "hahnca.com:~/dev/apps/<project names>". <project names> are  tv-series-srvr, tv-proc,  torrents-srvr, and tv-shared.  remote dir tv-series-client is only for hosting of production released files.

-  tv-shared is a shared module. tv-shared has no git or github

- old local dir is \Users\mark\apps\tv-series-client.  use folder /root/apps/tv in wsl for new main monorepo project.

- keep old repos as archived read-only

- current repos except tv-shared are all on GitHub and accessible via SSH URLs

- on Local laptop run apps/web in Vite dev mode and use the remote server for APIs while you work on the UI.

- the 3 old project names for api servers on linux server are tv-series-srvr, tv-proc, and torrents-srvr. the shared module is tv-shared, the vite/vue web ui project, on windows, is tv-series-client

- the monorepo naming scheme should look like @tv/<names> where <old names>:<new names> are:  tv-series-client: "client", tv-series-srvr: "srvr", tv-proc: "down", and torrents-srvr: "api", and tv-shared:"share". main project with monorepo should be named "tv".  

- github repo should be at https://github.com/mark-hahn/tv

- do as much as possible yourself with minimal work for me

- don't make unecessary changes
