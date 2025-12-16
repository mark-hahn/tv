// Configuration for different environments
const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

export const config = {
  torrentsApiUrl: isDevelopment 
    ? window.location.origin
    : 'https://hahnca.com/torrents-api'
};
