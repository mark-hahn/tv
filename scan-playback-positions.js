#!/usr/bin/env node

import fs from "fs";

const EMBY_BASE_URL = "https://hahnca.com:8920/emby";
const EMBY_USER_ID = "894c752d448f45a3a1260ccaabd0adff";
const EMBY_API_KEY = "9863c23d912349599e395950609c84cc";

function ticksToTime(ticks) {
  const ms = Math.round(ticks / 10000);
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
}

async function scanPlaybackPositions() {
  console.log("Fetching all shows from Emby...\n");

  // Fetch all series
  const showsUrl = `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items?api_key=${EMBY_API_KEY}&IncludeItemTypes=Series&Recursive=true&Fields=UserData&StartIndex=0&Limit=10000`;

  const showsResp = await fetch(showsUrl);
  if (!showsResp.ok) {
    console.error(`Failed to fetch shows: ${showsResp.status}`);
    return;
  }

  const showsData = await showsResp.json();
  const shows = showsData.Items || [];

  console.log(`Found ${shows.length} shows\n`);

  // Check for show-level PlaybackPositionTicks
  console.log("Checking show-level PlaybackPositionTicks...\n");
  const showsWithShowLevelPos = [];
  for (const show of shows) {
    const showPos = show.UserData?.PlaybackPositionTicks || 0;
    if (showPos > 0) {
      showsWithShowLevelPos.push({
        name: show.Name,
        id: show.Id,
        position: showPos,
        positionFormatted: ticksToTime(showPos),
      });
    }
  }

  if (showsWithShowLevelPos.length > 0) {
    console.log(
      `Found ${showsWithShowLevelPos.length} shows with show-level PlaybackPositionTicks:\n`,
    );
    for (const show of showsWithShowLevelPos) {
      console.log(
        `  ${show.name}: ${show.positionFormatted} (${show.position} ticks)`,
      );
    }
    console.log();
  } else {
    console.log("No shows have show-level PlaybackPositionTicks > 0\n");
  }

  console.log("Scanning episodes for playback positions...\n");

  const showsWithProgress = [];
  let totalShows = 0;
  let totalEpisodes = 0;
  let episodesWithProgress = 0;

  for (const show of shows) {
    totalShows++;
    const showName = show.Name;
    const showId = show.Id;

    // Fetch all episodes for this show
    const episodesUrl = `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items?ParentId=${showId}&IncludeItemTypes=Episode&Recursive=true&Fields=UserData&api_key=${EMBY_API_KEY}&Limit=10000`;

    const episodesResp = await fetch(episodesUrl);
    if (!episodesResp.ok) {
      console.error(
        `  Failed to fetch episodes for "${showName}": ${episodesResp.status}`,
      );
      continue;
    }

    const episodesData = await episodesResp.json();
    const episodes = episodesData.Items || [];
    totalEpisodes += episodes.length;

    const episodesWithPos = [];

    for (const ep of episodes) {
      const pos = ep.UserData?.PlaybackPositionTicks || 0;
      if (pos > 0) {
        episodesWithProgress++;
        episodesWithPos.push({
          season: ep.ParentIndexNumber,
          episode: ep.IndexNumber,
          name: ep.Name,
          position: pos,
          positionFormatted: ticksToTime(pos),
          runtime: ep.RunTimeTicks,
          runtimeFormatted: ep.RunTimeTicks
            ? ticksToTime(ep.RunTimeTicks)
            : "unknown",
        });
      }
    }

    if (episodesWithPos.length > 0) {
      showsWithProgress.push({
        name: showName,
        id: showId,
        episodes: episodesWithPos,
      });
    }

    // Progress indicator
    if (totalShows % 10 === 0) {
      process.stdout.write(
        `  Scanned ${totalShows}/${shows.length} shows...\r`,
      );
    }
  }

  // Write episodes with playback position to temp.txt
  const logLines = [];

  if (showsWithShowLevelPos.length > 0) {
    logLines.push("Shows with show-level PlaybackPositionTicks:");
    logLines.push("");
    for (const show of showsWithShowLevelPos) {
      logLines.push(`${show.name}`);
      logLines.push(`  Position: ${show.positionFormatted}`);
      logLines.push(`  Ticks: ${show.position}`);
      logLines.push("");
    }
    logLines.push("=".repeat(80));
    logLines.push("");
  }

  logLines.push("Episodes with playback position:");
  logLines.push("");

  for (const show of showsWithProgress) {
    // Sort by season/episode
    show.episodes.sort((a, b) => {
      if (a.season !== b.season) return a.season - b.season;
      return a.episode - b.episode;
    });

    for (const ep of show.episodes) {
      const epCode = `S${String(ep.season).padStart(2, "0")}E${String(ep.episode).padStart(2, "0")}`;
      const progress = ep.runtime
        ? `${Math.round((ep.position / ep.runtime) * 100)}%`
        : "??%";
      logLines.push(`${show.name} ${epCode} - ${ep.name}`);
      logLines.push(
        `  Position: ${ep.positionFormatted} / ${ep.runtimeFormatted} (${progress})`,
      );
      logLines.push(`  Ticks: ${ep.position}`);
      logLines.push("");
    }
  }

  fs.writeFileSync("temp.txt", logLines.join("\n"), "utf8");
  console.log(
    `Wrote ${showsWithShowLevelPos.length} shows and ${episodesWithProgress} episodes to temp.txt\n`,
  );

  console.log(`\n\n${"=".repeat(80)}`);
  console.log("STATISTICS");
  console.log("=".repeat(80));
  console.log(`Total shows scanned:                        ${totalShows}`);
  console.log(
    `Shows with show-level playback position:    ${showsWithShowLevelPos.length}`,
  );
  console.log(`Total episodes scanned:                     ${totalEpisodes}`);
  console.log(
    `Episodes with playback position:            ${episodesWithProgress}`,
  );
  console.log(
    `Shows with at least 1 in-progress episode:     ${showsWithProgress.length}`,
  );
  console.log();

  if (showsWithShowLevelPos.length > 0) {
    console.log("=".repeat(80));
    console.log("SHOWS WITH SHOW-LEVEL PLAYBACK POSITION");
    console.log("=".repeat(80));
    console.log();
    for (const show of showsWithShowLevelPos) {
      console.log(`${show.name}`);
      console.log(`  Position: ${show.positionFormatted}`);
      console.log(`  Ticks: ${show.position}`);
      console.log();
    }
  }

  if (showsWithProgress.length === 0) {
    console.log("No shows found with episode playback positions.");
    return;
  }

  console.log("=".repeat(80));
  console.log("SHOWS WITH IN-PROGRESS EPISODES");
  console.log("=".repeat(80));
  console.log();

  for (const show of showsWithProgress) {
    console.log(
      `\n${show.name} (${show.episodes.length} episode${show.episodes.length === 1 ? "" : "s"} in progress)`,
    );
    console.log("-".repeat(80));

    // Sort by season/episode
    show.episodes.sort((a, b) => {
      if (a.season !== b.season) return a.season - b.season;
      return a.episode - b.episode;
    });

    for (const ep of show.episodes) {
      const epCode = `S${String(ep.season).padStart(2, "0")}E${String(ep.episode).padStart(2, "0")}`;
      const progress = ep.runtime
        ? `${Math.round((ep.position / ep.runtime) * 100)}%`
        : "??%";
      console.log(`  ${epCode} - ${ep.name}`);
      console.log(
        `          Position: ${ep.positionFormatted} / ${ep.runtimeFormatted} (${progress})`,
      );
      console.log(`          Ticks: ${ep.position}`);
    }
  }

  console.log("\n" + "=".repeat(80));
}

scanPlaybackPositions().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
