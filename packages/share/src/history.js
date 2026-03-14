const HISTORY_URL = "https://hahnca.com/tv-srvr/api/history";

export async function postHistory({
  tvdbId,
  showName,
  type,
  description,
  hash,
  fields,
}) {
  try {
    await fetch(HISTORY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tvdbId: tvdbId ?? null,
        showName,
        type,
        description,
        hash,
        fields,
      }),
    });
  } catch {
    // fire-and-forget: don't fail the main operation
  }
}
