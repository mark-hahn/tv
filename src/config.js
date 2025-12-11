// Configuration for different environments
// The torrents server must be accessible from wherever the app is loaded
// If loading from hahnca.com, you need to either:
// 1. Access the app via localhost (e.g., http://localhost:5173 in dev)
// 2. Run torrents server on hahnca.com:3001
// 3. Use an SSH tunnel: ssh -L 3001:localhost:3001 user@localhost
export const config = {
  torrentsApiUrl: 'https://localhost:3001'
};
