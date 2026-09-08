/* Movie IDs stay numeric so existing browser libraries and links remain valid. */
(function titleIdentityModule(root) {
  "use strict";
  function identity(value) {
    const record = value && typeof value === "object" ? value : { id: value };
    const raw = String(record.id ?? "");
    const tagged = raw.match(/^(movie|tv):(\d+)$/);
    const mediaType = tagged?.[1] || record.mediaType || "movie";
    if (!["movie", "tv"].includes(mediaType)) return null;
    if (tagged && record.mediaType && tagged[1] !== record.mediaType) return null;
    const tmdbId = Number(tagged ? tagged[2] : raw);
    if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) return null;
    return { id: mediaType === "tv" ? `tv:${tmdbId}` : tmdbId, tmdbId, mediaType };
  }
  const api = {
    identity,
    key: (value) => identity(value)?.id ?? null,
    valid: (value) => identity(value) !== null,
    mediaFilter: (value, fallback = "both") => ["movie", "tv", "both"].includes(value) ? value : fallback,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TitleIdentity = api;
})(typeof window !== "undefined" ? window : globalThis);
