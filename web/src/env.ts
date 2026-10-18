// True when the app is served from this machine or the local network (Docker on a laptop), not the live
// site. Local and live have separate databases, so the same id can be a different item: the UI shows a
// "LOCAL" badge so the two are never confused.
const host = window.location.hostname;
export const IS_LOCAL =
  host === 'localhost' || host.endsWith('.local') || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
