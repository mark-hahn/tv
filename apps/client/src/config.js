// Configuration for different environments
// Default to the public nginx endpoint.
// Override if needed: VITE_TORRENTS_API_URL=https://... (or http://localhost:...)
const TORRENTS_API_URL = import.meta.env.VITE_TORRENTS_API_URL || 'https://hahnca.com/torrents-api';

export const config = {
  torrentsApiUrl: TORRENTS_API_URL
};
