<template>
  <div
    id="map"
    ref="mapScroller"
    :style="{
      height: '100%',
      width: '100%',
      margin: 0,
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: 'white',
      overflow: 'hidden',
      maxWidth: '100%',
      boxSizing: 'border-box',
    }"
  >
    <!-- Progress modal (similar to web-add in list.vue)-->
    <div
      id="mapWorkingModal"
      v-if="mapWorking"
      @click.stop
      style="
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background-color: white;
        padding: 30px 40px;
        border: 2px solid black;
        border-radius: 10px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        z-index: 1000;
        text-align: center;
      "
    >
      <div style="font-size: 18px; font-weight: bold; margin-bottom: 10px">
        {{ mapWorkingTitle }}
      </div>
      <div style="font-size: 20px; color: #0066cc; margin-bottom: 15px">
        {{ mapWorkingShowName }}
      </div>
      <div style="font-size: 16px; color: #666; margin-bottom: 6px">
        {{ mapWorkingStatus || "Please wait ..." }}
      </div>
    </div>
    <div
      id="maperr"
      v-if="mapError &amp;&amp; Object.keys(seriesMap).length === 0"
      style="
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        width: 100%;
        font-size: 20px;
        font-weight: bold;
        color: red;
        text-align: center;
        padding: 20px;
      "
    >
      {{ mapError }}
    </div>
    <div
      id="maphdr"
      v-else
      style="
        position: sticky;
        top: 0px;
        z-index: 50;
        background-color: white;
        padding-bottom: 5px;
      "
    >
      <div
        id="maphdr1"
        style="
          margin: 0 5px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        "
      >
        <div
          id="mapshow"
          class="pane-header-title"
          :style="{
            marginLeft: '15px',
          }"
        >
          {{ mapShow?.name }}
        </div>
        <div style="display: flex">
          <div
            id="mapbuttons"
            v-if="!simpleMode"
            style="display: flex; gap: 5px; flex-shrink: 0"
          >
            <button
              @click.stop.prevent="noop"
              @pointerdown.stop.prevent="startArrowPan($event, -1)"
              @pointerup.stop.prevent="stopArrowPan"
              @pointercancel.stop.prevent="stopArrowPan"
              @lostpointercapture.stop.prevent="stopArrowPan"
              :disabled="!canPanLeft"
              :style="{
                opacity: canPanLeft ? 1 : 0.35,
                cursor: canPanLeft ? 'pointer' : 'default',
              }"
              style="
                font-size: 13.5px;
                margin: 4.5px;
                max-height: 21.5px;
                border-radius: 7px;
              "
            >
              ←
            </button>
            <button
              @click.stop.prevent="noop"
              @pointerdown.stop.prevent="startArrowPan($event, 1)"
              @pointerup.stop.prevent="stopArrowPan"
              @pointercancel.stop.prevent="stopArrowPan"
              @lostpointercapture.stop.prevent="stopArrowPan"
              :disabled="!canPanRight"
              :style="{
                opacity: canPanRight ? 1 : 0.35,
                cursor: canPanRight ? 'pointer' : 'default',
              }"
              style="
                font-size: 13.5px;
                margin: 4.5px;
                max-height: 21.5px;
                border-radius: 7px;
              "
            >
              →
            </button>
            <button
              @click.stop="toggleEpisodePane"
              :disabled="!hasSelectedCell"
              :style="{
                '--btn-bg': showEpisodePane ? 'lightgray' : 'whitesmoke',
                opacity: hasSelectedCell ? 1 : 0.35,
                cursor: hasSelectedCell ? 'pointer' : 'default',
              }"
              style="
                font-size: 13.5px;
                cursor: pointer;
                margin: 4.5px 0 4.5px 4.5px;
                max-height: 21.5px;
                border-radius: 7px;
              "
            >
              Episode
            </button>
            <button
              @click.stop="handleSelectedPlay"
              :disabled="!hasMapSelection"
              :style="{
                opacity: hasMapSelection ? 1 : 0.35,
                cursor: hasMapSelection ? 'pointer' : 'default',
              }"
              style="
                font-size: 13.5px;
                cursor: pointer;
                margin: 4.5px 0 4.5px 4.5px;
                max-height: 21.5px;
                border-radius: 7px;
              "
            >
              Play
            </button>
            <button
              v-if="mapShow?.inEmby !== false"
              @click.stop="handleSelectedEmby"
              :disabled="!firstSelectedEmbyId"
              :style="{
                opacity: firstSelectedEmbyId ? 1 : 0.35,
                cursor: firstSelectedEmbyId ? 'pointer' : 'default',
              }"
              style="
                font-size: 13.5px;
                cursor: pointer;
                margin: 4.5px 0 4.5px 4.5px;
                max-height: 21.5px;
                border-radius: 7px;
              "
            >
              Emby
            </button>
          </div>
          <div
            v-if="simpleMode"
            style="display: flex; gap: 5px; flex-shrink: 0"
          >
            <button
              @click.stop="toggleEpisodePane"
              :disabled="!hasSelectedCell"
              :style="{
                '--btn-bg': showEpisodePane ? 'lightgray' : 'whitesmoke',
                opacity: hasSelectedCell ? 1 : 0.35,
                cursor: hasSelectedCell ? 'pointer' : 'default',
              }"
              style="
                font-size: 13.5px;
                cursor: pointer;
                margin: 4.5px 0 4.5px 4.5px;
                max-height: 21.5px;
                border-radius: 7px;
              "
            >
              Episode
            </button>
            <button
              @click.stop="handleSelectedPlay"
              :disabled="!hasMapSelection"
              :style="{
                opacity: hasMapSelection ? 1 : 0.35,
                cursor: hasMapSelection ? 'pointer' : 'default',
              }"
              style="
                font-size: 13.5px;
                cursor: pointer;
                margin: 4.5px 0 4.5px 4.5px;
                max-height: 21.5px;
                border-radius: 7px;
              "
            >
              Play
            </button>
            <button
              v-if="mapShow?.inEmby !== false"
              @click.stop="handleSelectedEmby"
              :disabled="!firstSelectedEmbyId"
              :style="{
                opacity: firstSelectedEmbyId ? 1 : 0.35,
                cursor: firstSelectedEmbyId ? 'pointer' : 'default',
              }"
              style="
                font-size: 13.5px;
                cursor: pointer;
                margin: 4.5px 0 4.5px 4.5px;
                max-height: 21.5px;
                border-radius: 7px;
              "
            >
              Emby
            </button>
          </div>
        </div>
      </div>
      <div
        id="maphdr2"
        style="
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin: 0 10px 5px 10px;
          font-size: 15px;
        "
      >
        <div
          style="
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            color: red;
            padding-left: 5px;
          "
        >
          <span
            v-for="(part, idx) in hdr2Parts"
            :key="idx"
            style="white-space: nowrap"
            ><span
              v-if="idx &gt; 0"
              style="padding: 0 6px; font-weight: bold"
              >|</span
            ><span>{{ part }}</span></span
          ><span
            v-if="mapShow?.inEmby === false"
            style="white-space: nowrap"
            ><span
              v-if="hdr2Parts &amp;&amp; hdr2Parts.length &gt; 0"
              style="padding: 0 6px; font-weight: bold"
              >|</span
            ><span
              @click.stop.prevent="handleNotInEmbyClick($event)"
              style="font-weight: bold; cursor: pointer; white-space: nowrap"
              >Not In Emby</span
            ></span
          >
        </div>
        <div
          v-if="!simpleMode"
          style="display: flex; flex-shrink: 0; align-items: center"
        >
          <button
            @click.stop="handleSelectedWatch"
            :disabled="!hasMapSelection"
            :style="{
              opacity: hasMapSelection ? 1 : 0.35,
              cursor: hasMapSelection ? 'pointer' : 'default',
            }"
            style="
              font-size: 13.5px;
              cursor: pointer;
              margin: 4.5px 0 4.5px 4.5px;
              max-height: 21.5px;
              border-radius: 7px;
            "
          >
            Watched
          </button>
          <button
            @click.stop="handleMapIntroClick"
            :disabled="!firstSelectedCellPath"
            :style="{
              opacity: firstSelectedCellPath ? 1 : 0.35,
              cursor: firstSelectedCellPath ? 'pointer' : 'default',
            }"
            style="
              font-size: 13.5px;
              cursor: pointer;
              margin: 4.5px 0 4.5px 4.5px;
              max-height: 21.5px;
              border-radius: 7px;
            "
          >
            Intro
          </button>
          <button
            v-if="mapShow?.inEmby !== false"
            @click.stop="onPruneClick"
            :style="{ '--btn-bg': pruneFlash ? 'lightgray' : 'whitesmoke' }"
            style="
              font-size: 13.5px;
              cursor: pointer;
              margin: 4.5px 0 4.5px 4.5px;
              max-height: 21.5px;
              border-radius: 7px;
            "
          >
            Prune
          </button>
          <button
            @click.stop="handleSelectedDelete"
            :disabled="!hasMapSelection"
            :style="{
              opacity: hasMapSelection ? 1 : 0.35,
              cursor: hasMapSelection ? 'pointer' : 'default',
            }"
            style="
              font-size: 13.5px;
              cursor: pointer;
              margin: 4.5px 0 4.5px 4.5px;
              max-height: 21.5px;
              border-radius: 7px;
            "
          >
            Del
          </button>
        </div>
      </div>
    </div>
    <div
      v-if="!hideMapBottom"
      style="
        flex: 1 1 auto;
        min-height: 0px;
        margin-left: 15px;
        margin-right: 15px;
        box-sizing: border-box;
        display: flex;
        flex-direction: row;
        gap: 30px;
      "
    >
      <div
        id="maptable"
        style="
          flex: 1 1 auto;
          min-height: 0px;
          box-sizing: border-box;
          position: relative;
          overflow: hidden;
        "
      >
        <!-- No scrollbars: pan the table with arrows (horizontal) and mouse wheel (vertical).-->
        <div
          id="maptblpane"
          ref="mapViewport"
          @selectstart.prevent
          @wheel.stop.prevent="handleMapWheel"
          @pointerdown="handleMapPointerDown"
          @pointermove="handleMapPointerMove"
          @pointerup="handleMapPointerUp"
          @pointercancel="handleMapPointerUp"
          style="
            position: absolute;
            inset: 0;
            overflow: hidden;
            box-sizing: border-box;
            touch-action: none;
            user-select: none;
          "
        >
          <!-- Sticky header row: moves horizontally with pan but stays fixed vertically.-->
          <div
            ref="mapHeader"
            style="
              position: absolute;
              left: 0;
              right: 0;
              top: 0;
              overflow: hidden;
              box-sizing: border-box;
              background-color: white;
            "
          >
            <table
              :style="{
                fontSize: '16px',
                borderCollapse: 'collapse',
                transform: 'translate(' + -mapScrollLeft + 'px,0px)',
              }"
            >
              <tbody>
                <tr style="font-weight: bold">
                  <td
                    :style="{
                      width: '30px',
                      minWidth: '30px',
                      maxWidth: '30px',
                      height: '22px',
                      minHeight: '22px',
                      maxHeight: '22px',
                      lineHeight: '16px',
                      whiteSpace: 'nowrap',
                      verticalAlign: 'middle',
                      textAlign: 'center',
                      padding: '1px 4px',
                      border: '1px solid #ccc',
                      backgroundColor: 'white',
                    }"
                  >
                    &nbsp;
                  </td>
                  <td
                    v-for="season in seriesMapSeasons"
                    @mousedown.prevent
                    @click.alt.exact="handleSeasonAltClick($event, season)"
                    @click.exact="handleSeasonPlainClick($event, season)"
                    @click.ctrl="handleSeasonClick($event, season)"
                    :style="{
                      width: '30px',
                      minWidth: '30px',
                      maxWidth: '30px',
                      height: '22px',
                      minHeight: '22px',
                      maxHeight: '22px',
                      lineHeight: '16px',
                      whiteSpace: 'nowrap',
                      verticalAlign: 'middle',
                      padding: '1px 4px',
                      textAlign: 'center',
                      border: '1px solid #ccc',
                      backgroundColor:
                        copiedSeason === season
                          ? '#ffcccc'
                          : selectedSeasons.has(season)
                            ? 'lightgreen'
                            : 'white',
                      cursor: simpleMode ? 'default' : 'pointer',
                    }"
                    :key="season"
                  >
                    S{{ season }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <!-- Sticky top-left corner cell (covers the moving blank header cell when panning horizontally).-->
          <div
            style="
              position: absolute;
              left: 0;
              top: 0;
              z-index: 6;
              overflow: hidden;
              background-color: white;
              pointer-events: none;
            "
          >
            <table :style="{ fontSize: '16px', borderCollapse: 'collapse' }">
              <tbody>
                <tr style="font-weight: bold">
                  <td
                    :style="{
                      width: '30px',
                      minWidth: '30px',
                      maxWidth: '30px',
                      height: '22px',
                      minHeight: '22px',
                      maxHeight: '22px',
                      lineHeight: '16px',
                      whiteSpace: 'nowrap',
                      verticalAlign: 'middle',
                      textAlign: 'center',
                      padding: '1px 4px',
                      border: '1px solid #ccc',
                      backgroundColor: 'white',
                    }"
                  >
                    &nbsp;
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <!-- Body viewport starts below the sticky header.-->
          <div
            ref="mapBodyViewport"
            :key="'map-body-' + mapUpdateKey"
            :style="{
              position: 'absolute',
              left: '0',
              right: '0',
              top: mapHeaderH + 'px',
              bottom: '0',
              overflow: 'hidden',
              boxSizing: 'border-box',
            }"
          >
            <table
              ref="mapBodyTable"
              :style="{
                fontSize: '16px',
                borderCollapse: 'collapse',
                transform:
                  'translate(' + -mapScrollLeft + 'px,' + -mapScrollTop + 'px)',
              }"
            >
              <tbody>
                <tr
                  v-for="episode in seriesMapEpis"
                  :key="mapUpdateKey + '-ep-' + episode"
                  style="outline: thin solid"
                >
                  <td
                    :style="{
                      fontWeight: 'bold',
                      width: '30px',
                      minWidth: '30px',
                      maxWidth: '30px',
                      height: '22px',
                      minHeight: '22px',
                      maxHeight: '22px',
                      lineHeight: '16px',
                      whiteSpace: 'nowrap',
                      verticalAlign: 'middle',
                      textAlign: 'center',
                      padding: '1px 4px',
                      border: '1px solid #ccc',
                      backgroundColor: 'white',
                    }"
                  >
                    {{ episode }}
                  </td>
                  <td
                    v-for="season in seriesMapSeasons"
                    :key="mapUpdateKey + '-' + season + '.' + episode"
                    @mousedown.prevent
                    @click.alt.exact="
                      handleEpisodeAltClick($event, mapShow, season, episode)
                    "
                    @click.exact="
                      handleEpisodePlainClick($event, mapShow, season, episode)
                    "
                    @click.ctrl="
                      handleEpisodeClick($event, mapShow, season, episode)
                    "
                    @click.shift="
                      handleEpisodeClick($event, mapShow, season, episode)
                    "
                    @click.ctrl.shift="
                      handleEpisodeClick($event, mapShow, season, episode)
                    "
                    :style="{
                      cursor: 'pointer',
                      width: '30px',
                      minWidth: '30px',
                      maxWidth: '30px',
                      height: '22px',
                      minHeight: '22px',
                      maxHeight: '22px',
                      lineHeight: '16px',
                      whiteSpace: 'nowrap',
                      verticalAlign: 'middle',
                      padding: '1px 4px',
                      textAlign: 'center',
                      border: '1px solid #ccc',
                      backgroundColor:
                        copiedCellKey === cellKey(season, episode)
                          ? '#ffcccc'
                          : selectedCells.has(cellKey(season, episode))
                            ? 'lightgreen'
                            : seriesMap[season]?.[episode]?.error
                              ? 'yellow'
                              : seriesMap[season]?.[episode]?.noFile
                                ? '#faa'
                                : 'white',
                    }"
                  >
                    <span v-if="seriesMap?.[season]?.[episode]?.played"> w</span
                    ><span
                      v-if="
                        seriesMap?.[season]?.[episode]?.avail &&
                        !seriesMap?.[season]?.[episode]?.unaired &&
                        mapShow?.inEmby !== false
                      "
                    >
                      +</span
                    ><span
                      v-if="seriesMap?.[season]?.[episode]?.noFile &amp;&amp; !seriesMap?.[season]?.[episode]?.unaired"
                    >
                      -</span
                    ><span
                      v-if="seriesMap?.[season]?.[episode]?.unaired &amp;&amp; !seriesMap?.[season]?.[episode]?.played &amp;&amp; seriesMap?.[season]?.[episode]?.noFile"
                      >u</span
                    >
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <!-- Sticky season column (covers the moving season cells when panning horizontally).-->
          <div
            @pointerdown="handleMapPointerDown"
            @pointermove="handleMapPointerMove"
            @pointerup="handleMapPointerUp"
            @pointercancel="handleMapPointerUp"
            :style="{
              position: 'absolute',
              left: '0',
              top: mapHeaderH + 'px',
              bottom: '0',
              width: '30px',
              overflow: 'hidden',
              zIndex: 5,
              backgroundColor: 'white',
              pointerEvents: 'auto',
              touchAction: 'none',
            }"
          >
            <table
              :style="{
                fontSize: '16px',
                borderCollapse: 'collapse',
                transform: 'translate(0px,' + -mapScrollTop + 'px)',
              }"
            >
              <tbody>
                <tr
                  v-for="episode in seriesMapEpis"
                  :key="mapUpdateKey + '-sticky-ep-' + episode"
                  style="outline: thin solid"
                >
                  <td
                    :style="{
                      fontWeight: 'bold',
                      width: '30px',
                      minWidth: '30px',
                      maxWidth: '30px',
                      height: '22px',
                      minHeight: '22px',
                      maxHeight: '22px',
                      lineHeight: '16px',
                      whiteSpace: 'nowrap',
                      verticalAlign: 'middle',
                      textAlign: 'center',
                      padding: '1px 4px',
                      border: '1px solid #ccc',
                      backgroundColor: 'white',
                    }"
                  >
                    {{ episode }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <!-- Season dates table -->
      <div style="flex: 0 0 auto; overflow-y: auto; overflow-x: hidden">
        <table
          style="
            font-size: 16px;
            border-collapse: collapse;
            white-space: nowrap;
          "
        >
          <thead>
            <tr style="font-weight: bold">
              <th
                style="
                  padding: 1px 4px;
                  border: 1px solid #ccc;
                  text-align: center;
                  background-color: white;
                  height: 22px;
                  line-height: 16px;
                  vertical-align: middle;
                "
              ></th>
              <th
                style="
                  padding: 1px 4px;
                  border: 1px solid #ccc;
                  text-align: center;
                  background-color: white;
                  height: 22px;
                  line-height: 16px;
                  vertical-align: middle;
                "
              >
                Start
              </th>
              <th
                style="
                  padding: 1px 4px;
                  border: 1px solid #ccc;
                  text-align: center;
                  background-color: white;
                  height: 22px;
                  line-height: 16px;
                  vertical-align: middle;
                "
              >
                End
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="season in seriesMapSeasons"
              :key="'dates-' + season"
              style="outline: thin solid"
            >
              <td
                style="
                  font-weight: bold;
                  padding: 1px 4px;
                  border: 1px solid #ccc;
                  text-align: center;
                  height: 22px;
                  line-height: 16px;
                  vertical-align: middle;
                "
              >
                S{{ season }}
              </td>
              <td
                style="
                  padding: 4px 10px;
                  border: 1px solid #ccc;
                  text-align: center;
                  height: 22px;
                  line-height: 16px;
                  vertical-align: middle;
                "
              >
                {{ seasonDateRanges[season]?.start || "" }}
              </td>
              <td
                style="
                  padding: 4px 10px;
                  border: 1px solid #ccc;
                  text-align: center;
                  height: 22px;
                  line-height: 16px;
                  vertical-align: middle;
                "
              >
                {{ seasonDateRanges[season]?.end || "" }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <div
      v-if="
        !hideMapBottom &&
        showEpisodePane &&
        mapImageExpanded &&
        episodeInfo?.image
      "
      @click="mapImageExpanded = false"
      style="border-top: 6px solid black; cursor: pointer"
    >
      <img
        :src="episodeInfo.image"
        alt="episode"
        style="
          display: block;
          width: 100%;
          aspect-ratio: 16 / 9;
          object-fit: cover;
        "
      />
    </div>
    <div
      v-if="!hideMapBottom && showEpisodePane && selectedEpisode && episodeInfo"
      style="
        border-top: 3px solid black;
        flex: 0 0 auto;
        max-height: min(320px, 45vh);
        overflow: hidden;
      "
    >
      <div
        style="
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          padding: 4px 8px;
          border-bottom: 3px solid black;
        "
      >
        <div
          style="
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 0;
            flex: 1;
          "
        >
          <div
            v-if="displayEpisodeTitle(episodeInfo.name)"
            style="
              min-width: 0;
              font-size: 16px;
              font-weight: bold;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            "
          >
            {{ displayEpisodeTitle(episodeInfo.name) }}
          </div>
          <div style="flex: 0 0 auto; font-size: 16px; white-space: nowrap">
            {{ formatSelectedEpisode(selectedEpisode) }}
          </div>
        </div>
        <div
          style="
            flex: 0 0 auto;
            font-size: 14px;
            font-weight: bold;
            color: #555;
            white-space: nowrap;
          "
        >
          {{ formatEpisodeAired(episodeInfo.aired) }}
        </div>
      </div>
      <div
        style="
          display: grid;
          grid-template-columns: minmax(220px, 1fr) 1fr;
          gap: 0;
          padding: 7px 0;
          align-items: stretch;
          height: min(260px, calc(45vh - 48px));
          min-height: 150px;
          overflow: hidden;
        "
      >
        <button
          v-if="episodeInfo.image"
          @click.stop="mapImageExpanded = !mapImageExpanded"
          style="
            padding: 0;
            margin: 0;
            border: 0;
            background: transparent;
            cursor: pointer;
            height: 100%;
            overflow: hidden;
          "
        >
          <img
            :src="episodeInfo.image"
            alt="episode"
            style="
              display: block;
              width: 100%;
              height: 100%;
              aspect-ratio: 16 / 9;
              object-fit: cover;
            "
          />
        </button>
        <div
          v-else
          style="
            width: 100%;
            height: 100%;
            min-height: 140px;
            background-color: #ddd;
            aspect-ratio: 16 / 9;
          "
        ></div>
        <div
          style="
            padding: 4px 8px;
            min-height: 0;
            overflow-y: auto;
            color: #333;
            font-size: 16px;
            line-height: 22px;
          "
        >
          <div v-if="episodeInfo.overview">
            {{ episodeInfo.overview }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import * as tvdb from "../tvdb.js";
import * as emby from "../emby.js";
import * as srvr from "../srvr.js";
import * as urls from "../urls.js";
import evtBus from "../evtBus.js";

const MAP_ARROW_PAN_PX_PER_SEC = 400;
const MAP_PAN_SMOOTH_TAU_SEC = 0.1;

export default {
  name: "Map",
  components: {},

  props: {
    mapShow: {
      type: Object,
      default: null,
    },
    hideMapBottom: {
      type: Boolean,
      default: true,
    },
    seriesMapSeasons: {
      type: Array,
      default: () => [],
    },
    seriesMapEpis: {
      type: Array,
      default: () => [],
    },
    seriesMap: {
      type: Object,
      default: () => ({}),
    },
    mapError: {
      type: String,
      default: "",
    },
    simpleMode: {
      type: Boolean,
      default: false,
    },
    sizing: {
      type: Object,
      default: () => ({}),
    },
  },

  data() {
    return {
      seasonStates: {}, // Track original state for each season
      tvdbData: null,
      allTvdb: null,
      nextUpTxt: "",

      mapWorking: false,
      mapWorkingTitle: "",
      mapWorkingShowName: "",
      mapWorkingStatus: "",

      mapScrollLeft: 0,
      mapScrollTop: 0,
      mapDesiredLeft: 0,
      mapHeaderH: 0,
      mapMaxScrollLeft: 0,
      mapMaxScrollTop: 0,
      arrowPanActive: false,
      mapPanRafId: 0,
      mapPanLastTs: 0,
      arrowPanTargetLeft: 0,
      arrowPanDir: 0,
      mapTouchActive: false,
      mapTouchPointerId: -1,
      mapTouchLastX: 0,
      mapTouchLastY: 0,
      mapTouchMoved: false,
      mapTouchMovedDist: 0,
      mapTouchSuppressClickUntil: 0,
      mapUpdateKey: 0,
      pruneFlash: false,
      selectedSeasons: new Set(),
      selectedCells: new Set(),
      copiedSeason: null,
      copiedCellKey: null,
      selectionSeason: null,
      lastSelectedCell: null,
      showEpisodePane: false,
      selectedEpisode: null,
      episodeInfo: null,
      mapImageExpanded: false,
      episodeInfoRequestId: 0,
    };
  },

  computed: {
    datesLine() {
      if (!this.tvdbData) return "";
      const { firstAired, lastAired, status } = this.tvdbData;
      return ` ${firstAired || ""} ${lastAired || ""} ${status || ""}`;
    },
    firstAiredVal() {
      return this.tvdbData?.firstAired || "";
    },
    lastAiredVal() {
      return this.tvdbData?.lastAired || "";
    },
    statusVal() {
      return this.tvdbData?.status || "";
    },

    hdr2Parts() {
      const parts = [];

      const firstAired = this.firstAiredVal;
      const lastAired = this.lastAiredVal;
      if (firstAired || lastAired) {
        parts.push(
          firstAired && lastAired
            ? `${firstAired} / ${lastAired}`
            : firstAired || lastAired,
        );
      }
      const rt = this.tvdbData?.averageRuntime;
      if (rt) parts.push(`${rt} mins`);

      const status = this.statusVal;
      if (status) parts.push(status);

      if (this.mapShow?.watchGap) parts.push("Watch Gap");
      if (this.mapShow?.fileGap) parts.push("Missing File");
      if (this.mapShow?.waitStr?.length)
        parts.push("Waiting " + this.mapShow.waitStr);

      return parts;
    },

    seasonDateRanges() {
      const seasons = this.seriesMapSeasons;
      if (!seasons?.length) return {};
      const ead = this.tvdbData?.episodeAiredDates;
      const result = {};
      const firstSeason = Math.min(...seasons);
      const lastSeason = Math.max(...seasons);
      if (ead) {
        for (const season of seasons) {
          const padded = String(season).padStart(2, "0");
          const prefix = `S${padded}E`;
          const dates = Object.entries(ead)
            .filter(([k]) => k.startsWith(prefix))
            .map(([, v]) => v)
            .filter(Boolean)
            .sort();
          if (dates.length > 0) {
            let endDate = dates[dates.length - 1];
            if (
              season === lastSeason &&
              this.tvdbData?.lastAired &&
              this.tvdbData.lastAired > endDate
            ) {
              endDate = this.tvdbData.lastAired;
            }
            result[season] = {
              start: dates[0].replace(/-/g, "/"),
              end: endDate.replace(/-/g, "/"),
            };
          }
        }
      } else {
        // No episode-level data — show series firstAired/lastAired on first/last season only
        const fa = this.tvdbData?.firstAired;
        const la = this.tvdbData?.lastAired;
        for (const season of seasons) {
          result[season] = {
            start: season === firstSeason && fa ? fa.replace(/-/g, "/") : "-",
            end: season === lastSeason && la ? la.replace(/-/g, "/") : "-",
          };
        }
      }
      return result;
    },

    canPanLeft() {
      const eps = 0.5;
      return (this.mapScrollLeft || 0) > eps;
    },

    canPanRight() {
      const eps = 0.5;
      return (this.mapScrollLeft || 0) < (this.mapMaxScrollLeft || 0) - eps;
    },

    hasMapSelection() {
      return this.selectedSeasons.size > 0 || this.selectedCells.size > 0;
    },
    firstSelectedCellPath() {
      if (this.selectedCells.size === 0) return null;
      const firstKey = Array.from(this.selectedCells)[0];
      const { season, episode } = this.parseCellKey(firstKey);
      return this.seriesMap?.[season]?.[episode]?.path || null;
    },
    hasSelectedCell() {
      return this.selectedCells.size > 0;
    },
    firstSelectedEmbyId() {
      if (this.selectedCells.size === 0) return null;
      const firstKey = Array.from(this.selectedCells)[0];
      const { season, episode } = this.parseCellKey(firstKey);
      return this.seriesMap?.[season]?.[episode]?.id || null;
    },
  },

  watch: {
    async mapShow(newShow, oldShow) {
      this.showHistory = false;
      const showChanged = (newShow?.name || null) !== (oldShow?.name || null);
      if (showChanged) {
        this.selectedSeasons = new Set();
        this.selectedCells = new Set();
        this.selectionSeason = null;
        this.lastSelectedCell = null;
        this.selectedEpisode = null;
        this.episodeInfo = null;
        this.mapImageExpanded = false;
      }
      if (newShow && newShow.name) {
        this.seasonStates = {}; // Clear season states when show changes
        await this.loadTvdbData();
        if (!this.mapShow) return;
        await this.setNextWatch();
        if (!this.mapShow) return;
        this.$nextTick(() => {
          this.updateMapPanBounds();
        });
      }
    },
    seriesMapSeasons() {
      this.$nextTick(() => {
        this.updateMapPanBounds();
      });
    },
    seriesMapEpis() {
      this.$nextTick(() => {
        this.updateMapPanBounds();
      });
    },
    seriesMap() {
      // Triggered when seriesMap reference changes (e.g., from disk change refresh)
      this.seasonStates = {}; // Clear season states when map data changes
      this.mapUpdateKey++; // Increment key to force re-render
      this.$nextTick(() => {
        this.updateMapPanBounds();
      });
    },
  },

  emits: [
    "reload-shows",
    "prune",
    "set-date",
    "episode-click",
    "delete-episodes",
    "season-watched",
    "season-delete",
    "open-intro",
  ],

  async mounted() {
    if (this.mapShow && this.mapShow.name) {
      await this.loadTvdbData();
      await this.setNextWatch();
    }
    this.$nextTick(() => {
      this.updateMapPanBounds();
    });
    window.addEventListener("resize", this.updateMapPanBounds);
    evtBus.on("tvdbDataReady", this.onTvdbDataReady);
  },

  beforeUnmount() {
    window.removeEventListener("resize", this.updateMapPanBounds);
    evtBus.off("tvdbDataReady", this.onTvdbDataReady);
    this.stopArrowPan();
    this.stopMapPanLoop();
  },

  methods: {
    onPruneClick() {
      this.pruneFlash = true;
      this.$emit("prune", this.mapShow);
      setTimeout(() => {
        this.pruneFlash = false;
      }, 750);
    },

    onTvdbDataReady({ show, tvdbData }) {
      if (!tvdbData || !this.mapShow) return;
      if (show?.name === this.mapShow.name && !this.tvdbData) {
        this.tvdbData = tvdbData;
      }
    },

    noop() {},

    async handleNotInEmbyClick(event) {
      // Ctrl-click on "Not In Emby": create the server folder and refresh Emby.
      if (!event?.ctrlKey) return;

      const showName = String(this.mapShow?.name || "").trim();
      const tvdbId = String(
        this.mapShow?.tvdbId ||
          this.tvdbData?.tvdbId ||
          this.tvdbData?.tvdb_id ||
          "",
      ).trim();
      const seasons = Array.isArray(this.seriesMapSeasons)
        ? this.seriesMapSeasons
            .map((n) => Number(n))
            .filter((n) => Number.isFinite(n) && n > 0)
            .sort((a, b) => a - b)
        : [];

      if (!showName) return;
      if (!tvdbId) {
        console.error("Map: Not In Emby ctrl-click missing tvdbId", {
          mapShow: this.mapShow,
          tvdbData: this.tvdbData,
        });
        window.alert("Missing TvdbId; cannot create show folder.");
        return;
      }
      if (
        !this.tvdbData ||
        typeof this.tvdbData !== "object" ||
        Object.keys(this.tvdbData).length === 0
      ) {
        await this.loadTvdbData();
      }
      const hasTvdbData =
        !!this.tvdbData &&
        typeof this.tvdbData === "object" &&
        Object.keys(this.tvdbData).length > 0;
      if (!hasTvdbData) {
        console.error("Map: Not In Emby ctrl-click missing tvdbData", {
          showName,
          tvdbId,
          tvdbData: this.tvdbData,
        });
        window.alert("Missing TVDB data; cannot create show folder.");
        return;
      }

      const ok = window.confirm(
        `Create Emby folder + refresh library for "${showName}"?`,
      );
      if (!ok) return;

      this.mapWorking = true;
      this.mapWorkingTitle = "Creating show folder and refreshing Emby:";
      this.mapWorkingShowName = showName;
      this.mapWorkingStatus = "Starting...";

      const setStatus = (txt) => {
        this.mapWorkingStatus = String(txt || "");
        console.log(
          "Map: Not In Emby progress:",
          showName,
          this.mapWorkingStatus,
        );
      };

      try {
        const res = await emby.createShowFolderAndRefreshEmby({
          showName,
          tvdbId,
          seriesMapSeasons: seasons,
          tvdbData: this.tvdbData,
          onStatus: setStatus,
          createTimeoutMs: 15000,
          refreshTimeoutMs: 120000,
        });

        if (res?.status === "refreshfailed") {
          window.alert(
            `The folder for "${showName}" was created, but the Emby library refresh timed out.\nThe show should appear after Emby finishes scanning on its own.`,
          );
        } else if (!res?.createdFolder) {
          console.error("Map: createShowFolderAndRefreshEmby failed", {
            showName,
            tvdbId,
            res,
          });
          window.alert(res?.err || "Failed to create show folder.");
          return;
        }

        setStatus("Reloading shows...");
        // Trigger list reload so the show becomes a real Emby item.
        // Wait for List.newShows() to finish (web-add does this inline).
        await new Promise((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            resolve();
          };

          const timeoutMs = 60000;
          const t = setTimeout(() => {
            console.warn(
              "Map: timed out waiting for show reload after library-refresh-complete",
            );
            finish();
          }, timeoutMs);

          evtBus.emit("library-refresh-complete", {
            onDone: () => {
              clearTimeout(t);
              finish();
            },
          });
        });

        // Enqueue just the new show for processing
        await srvr
          .triggerShowSelect(showName)
          .catch((err) => console.error("triggerShowSelect failed:", err));
      } finally {
        this.mapWorking = false;
        this.mapWorkingTitle = "";
        this.mapWorkingShowName = "";
        this.mapWorkingStatus = "";
      }
    },

    handleMapPointerDown(event) {
      if (!event) return;
      // Only handle touch/pen drag as "scroll". Mouse drag isn't expected UX here.
      const pt = event.pointerType || "";
      if (pt !== "touch" && pt !== "pen") return;

      this.stopArrowPan();
      this.stopMapPanLoop();
      this.updateMapPanBounds();

      this.mapTouchActive = true;
      this.mapTouchPointerId = event.pointerId != null ? event.pointerId : -1;
      this.mapTouchLastX = event.clientX || 0;
      this.mapTouchLastY = event.clientY || 0;
      this.mapTouchMoved = false;
      this.mapTouchMovedDist = 0;

      try {
        if (
          event.currentTarget &&
          typeof event.currentTarget.setPointerCapture === "function" &&
          event.pointerId != null
        ) {
          event.currentTarget.setPointerCapture(event.pointerId);
        }
      } catch (_) {
        // ignore
      }
    },

    handleMapPointerMove(event) {
      if (!this.mapTouchActive) return;
      if (!event) return;
      if (
        this.mapTouchPointerId !== -1 &&
        event.pointerId != null &&
        event.pointerId !== this.mapTouchPointerId
      )
        return;

      // Prevent the browser from doing page scroll/gesture handling.
      try {
        event.preventDefault();
      } catch (_) {
        /* ignore */
      }

      this.updateMapPanBounds();

      const x = event.clientX || 0;
      const y = event.clientY || 0;
      const dx = x - this.mapTouchLastX;
      const dy = y - this.mapTouchLastY;
      this.mapTouchLastX = x;
      this.mapTouchLastY = y;

      const movedThis = Math.abs(dx) + Math.abs(dy);
      this.mapTouchMovedDist += movedThis;
      if (!this.mapTouchMoved && this.mapTouchMovedDist >= 4)
        this.mapTouchMoved = true;

      // Native-scroll semantics: finger left => reveal right (scrollLeft increases).
      this.mapScrollLeft = this.clamp(
        (this.mapScrollLeft || 0) - dx,
        0,
        this.mapMaxScrollLeft || 0,
      );
      this.mapDesiredLeft = this.mapScrollLeft;

      // Finger up => reveal lower rows (scrollTop increases).
      this.mapScrollTop = this.clamp(
        (this.mapScrollTop || 0) - dy,
        0,
        this.mapMaxScrollTop || 0,
      );
    },

    handleMapPointerUp(event) {
      if (!this.mapTouchActive) return;
      if (
        event?.pointerId != null &&
        this.mapTouchPointerId !== -1 &&
        event.pointerId !== this.mapTouchPointerId
      )
        return;

      if (this.mapTouchMoved) {
        // A click can fire after touch drag; suppress the close action briefly.
        this.mapTouchSuppressClickUntil = Date.now() + 300;
      }
      this.mapTouchActive = false;
      this.mapTouchPointerId = -1;
    },

    clamp(val, min, max) {
      return Math.min(max, Math.max(min, val));
    },

    updateMapPanBounds() {
      const header = this.$refs.mapHeader;
      const viewport = this.$refs.mapBodyViewport;
      const table = this.$refs.mapBodyTable;
      if (header) {
        const hh = header.offsetHeight || 0;
        if (hh && hh !== this.mapHeaderH) this.mapHeaderH = hh;
      }
      if (!viewport || !table) return;

      const vw = viewport.clientWidth || 0;
      const vh = viewport.clientHeight || 0;
      const tw = table.offsetWidth || 0;
      const th = table.offsetHeight || 0;

      this.mapMaxScrollLeft = Math.max(0, tw - vw);
      this.mapMaxScrollTop = Math.max(0, th - vh);

      this.mapScrollLeft = this.clamp(
        this.mapScrollLeft,
        0,
        this.mapMaxScrollLeft,
      );
      this.mapScrollTop = this.clamp(
        this.mapScrollTop,
        0,
        this.mapMaxScrollTop,
      );

      this.mapDesiredLeft = this.clamp(
        this.mapDesiredLeft,
        0,
        this.mapMaxScrollLeft,
      );
    },

    stopMapPanLoop() {
      this.mapPanLastTs = 0;
      if (this.mapPanRafId) {
        cancelAnimationFrame(this.mapPanRafId);
        this.mapPanRafId = 0;
      }
    },

    ensureMapPanLoop() {
      if (this.mapPanRafId) return;

      const tick = (ts) => {
        if (!this.mapPanLastTs) this.mapPanLastTs = ts;
        let dt = Math.max(0, (ts - this.mapPanLastTs) / 1000);
        this.mapPanLastTs = ts;
        dt = Math.min(dt, 0.05);

        // If holding an arrow, move the desired X smoothly toward the target.
        if (this.arrowPanActive && this.arrowPanDir !== 0) {
          const delta = MAP_ARROW_PAN_PX_PER_SEC * dt * this.arrowPanDir;
          const next = this.mapDesiredLeft + delta;
          if (this.arrowPanDir > 0) {
            this.mapDesiredLeft = Math.min(next, this.arrowPanTargetLeft);
            if (this.mapDesiredLeft >= this.arrowPanTargetLeft)
              this.stopArrowPan();
          } else {
            this.mapDesiredLeft = Math.max(next, this.arrowPanTargetLeft);
            if (this.mapDesiredLeft <= this.arrowPanTargetLeft)
              this.stopArrowPan();
          }
        }

        // Ease current toward desired.
        const alpha = 1 - Math.exp(-dt / MAP_PAN_SMOOTH_TAU_SEC);
        this.mapScrollLeft =
          this.mapScrollLeft +
          (this.mapDesiredLeft - this.mapScrollLeft) * alpha;

        const doneX = Math.abs(this.mapDesiredLeft - this.mapScrollLeft) < 0.25;
        if (!this.arrowPanActive && doneX) {
          this.mapScrollLeft = this.mapDesiredLeft;
          this.stopMapPanLoop();
          return;
        }

        this.mapPanRafId = requestAnimationFrame(tick);
      };

      this.mapPanRafId = requestAnimationFrame(tick);
    },

    handleMapWheel(event) {
      if (this.simpleMode) return;
      if (!event) return;
      // Vertical pan only.
      this.updateMapPanBounds();
      // On Windows mouse wheels, one notch often produces a fairly large deltaY.
      // Scale it down so one wheel "click" pans roughly one row.
      const dy = event.deltaY || 0;
      const scaledDy = dy * 0.125;
      this.mapScrollTop = this.clamp(
        this.mapScrollTop + scaledDy,
        0,
        this.mapMaxScrollTop,
      );
    },

    startArrowPan(event, dir) {
      if (this.simpleMode) return;
      if (dir !== -1 && dir !== 1) return;

      // If we're already at the end, do nothing.
      if (dir < 0 && !this.canPanLeft) return;
      if (dir > 0 && !this.canPanRight) return;

      this.updateMapPanBounds();

      // Sync desired with current before starting a new pan.
      this.mapDesiredLeft = this.clamp(
        this.mapDesiredLeft || this.mapScrollLeft,
        0,
        this.mapMaxScrollLeft,
      );

      // Press-and-hold should pan continuously to the edge.
      const target = dir > 0 ? this.mapMaxScrollLeft || 0 : 0;

      this.arrowPanActive = true;
      this.arrowPanDir = dir;
      this.arrowPanTargetLeft = target;
      this.ensureMapPanLoop();

      try {
        if (
          event?.currentTarget &&
          typeof event.currentTarget.setPointerCapture === "function" &&
          event.pointerId != null
        ) {
          event.currentTarget.setPointerCapture(event.pointerId);
        }
      } catch (_) {
        // ignore
      }

      // Movement happens inside the shared map pan loop.
    },

    stopArrowPan() {
      this.arrowPanActive = false;
      this.arrowPanDir = 0;
    },

    scrollMapToLeft() {
      // Legacy: click-jump behavior removed in favor of press-and-hold.
    },

    scrollMapToRight() {
      // Legacy: click-jump behavior removed in favor of press-and-hold.
    },

    async loadTvdbData() {
      try {
        // Always load all shows (hasEmby=0) to include no-emby shows
        // The cache from loadAllShows might only have emby shows (hasEmby=1)
        if (!this.allTvdb) {
          this.allTvdb = await tvdb.getAllTvdb(0);
        }
        if (this.mapShow && this.mapShow.name) {
          this.tvdbData = this.allTvdb[this.mapShow.name];
        }
      } catch (err) {
        console.error("loadTvdbData error:", err);
      }
    },
    formatEpisodeAired(aired) {
      return aired ? String(aired).replace(/-/g, "/") : "";
    },
    displayEpisodeTitle(name) {
      const title = String(name || "").trim();
      if (!title) return "";
      return /^(season|episode)\s+\d+$/i.test(title) ? "" : title;
    },
    cellKey(season, episode) {
      return `${season}.${episode}`;
    },
    flashCopiedSeason(season) {
      this.copiedSeason = season;
      setTimeout(() => {
        if (this.copiedSeason === season) this.copiedSeason = null;
      }, 300);
    },
    flashCopiedCell(key) {
      this.copiedCellKey = key;
      setTimeout(() => {
        if (this.copiedCellKey === key) this.copiedCellKey = null;
      }, 300);
    },
    getMapShowFolder() {
      const showPath = String(this.mapShow?.path || "").trim();
      if (showPath) {
        const parts = showPath.split("/").filter(Boolean);
        const last = parts[parts.length - 1];
        if (last) return last;
      }
      return String(this.mapShow?.name || "").trim();
    },
    getSeasonClipboardPath(season) {
      const showFolder = this.getMapShowFolder();
      if (!showFolder) return "";
      return `${showFolder}/Season ${season}`;
    },
    getEpisodeClipboardPath(season, episode) {
      const episodePath = String(
        this.seriesMap?.[season]?.[episode]?.path || "",
      ).trim();
      const showFolder = this.getMapShowFolder();
      if (!episodePath || !showFolder) return "";

      const marker = `/${showFolder}/`;
      const markerIdx = episodePath.indexOf(marker);
      if (markerIdx !== -1) {
        return episodePath.slice(markerIdx + 1);
      }

      const parts = episodePath.split("/").filter(Boolean);
      const fileName = parts[parts.length - 1] || "";
      if (!fileName) return "";
      return `${showFolder}/Season ${season}/${fileName}`;
    },
    async copyTextToClipboard(text) {
      if (!text) return false;
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        console.error("Copy failed", err);
        return false;
      }
    },
    async handleSeasonAltClick(event, season) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      const path = this.getSeasonClipboardPath(season);
      const ok = await this.copyTextToClipboard(path);
      if (ok) this.flashCopiedSeason(season);
    },
    async handleEpisodeAltClick(event, mapShow, season, episode) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      const path = this.getEpisodeClipboardPath(season, episode);
      const ok = await this.copyTextToClipboard(path);
      if (ok) this.flashCopiedCell(this.cellKey(season, episode));
    },
    parseCellKey(key) {
      const [season, episode] = String(key || "")
        .split(".")
        .map(Number);
      return { season, episode };
    },
    formatSelectedEpisode(selectedEpisode) {
      if (!selectedEpisode?.s || !selectedEpisode?.e) return "";
      return `(S${String(selectedEpisode.s).padStart(2, "0")}E${String(selectedEpisode.e).padStart(2, "0")})`;
    },
    clearMapSelectionDetails() {
      this.showEpisodePane = false;
      this.selectedEpisode = null;
      this.episodeInfo = null;
      this.mapImageExpanded = false;
      this.episodeInfoRequestId += 1;
    },
    getFirstSelectedCellTarget() {
      if (this.selectedCells.size === 0) return null;
      const firstKey = Array.from(this.selectedCells)[0];
      const { season, episode } = this.parseCellKey(firstKey);
      if (!season || !episode) return null;
      return { key: firstKey, season, episode };
    },
    async toggleEpisodePane() {
      const target = this.getFirstSelectedCellTarget();
      if (!target) return;

      if (
        this.showEpisodePane &&
        this.selectedEpisode?.s === target.season &&
        this.selectedEpisode?.e === target.episode
      ) {
        this.clearMapSelectionDetails();
        return;
      }

      this.showEpisodePane = true;
      await this.selectEpisode(target.season, target.episode);
    },
    syncOpenEpisodePaneToSelection() {
      if (!this.showEpisodePane) return;

      const target = this.getFirstSelectedCellTarget();
      if (!target) {
        this.clearMapSelectionDetails();
        return;
      }

      if (
        this.selectedEpisode?.s === target.season &&
        this.selectedEpisode?.e === target.episode &&
        this.episodeInfo
      ) {
        return;
      }

      this.showEpisodePane = true;
      this.selectEpisode(target.season, target.episode);
    },
    getSeasonEpisodeNumbers(season) {
      return this.seriesMapEpis.filter(
        (episode) => this.seriesMap?.[season]?.[episode],
      );
    },
    getSelectedMapTargets() {
      if (this.selectedCells.size > 0) {
        return Array.from(this.selectedCells)
          .map((key) => {
            const { season, episode } = this.parseCellKey(key);
            return { season, episode };
          })
          .sort((a, b) => a.season - b.season || a.episode - b.episode);
      }

      const targets = [];
      for (const season of this.seriesMapSeasons) {
        if (!this.selectedSeasons.has(season)) continue;
        for (const episode of this.getSeasonEpisodeNumbers(season)) {
          targets.push({ season, episode });
        }
      }
      return targets;
    },
    async selectEpisode(season, episode) {
      if (!this.mapShow?.name || !season || !episode) return;

      this.selectedEpisode = { s: season, e: episode };
      this.mapImageExpanded = false;
      this.episodeInfo = null;

      const reqId = ++this.episodeInfoRequestId;

      try {
        const data = await srvr.getTmdb({
          showName: this.mapShow.name,
          year: null,
          season,
          episode,
        });
        if (reqId !== this.episodeInfoRequestId) return;
        if (data?.image || data?.overview) {
          this.episodeInfo = {
            image: data.image ?? null,
            overview: data.overview ?? null,
            name: data.name ?? null,
            aired: data.aired ?? null,
          };
        } else {
          this.episodeInfo = null;
        }
      } catch (err) {
        if (reqId !== this.episodeInfoRequestId) return;
        console.error("selectEpisode getTmdb error:", err);
        this.episodeInfo = null;
      }
    },
    buildSelectedEpisodeActionEvent(overrides = {}) {
      return {
        stopPropagation() {},
        preventDefault() {},
        altKey: false,
        shiftKey: false,
        ctrlKey: false,
        ...overrides,
      };
    },
    performEpisodePlay(event, mapShow, season, episode) {
      const cell = this.seriesMap?.[season]?.[episode];
      if (cell?.path && !cell?.noFile) {
        this.$emit("play-episode", event, mapShow, season, episode);
      }
    },
    performEpisodeWatch(event, mapShow, season, episode) {
      this.$emit("episode-click", event, mapShow, season, episode);
    },
    performEpisodeDelete(event, mapShow, season, episode) {
      this.$emit("episode-click", event, mapShow, season, episode);
    },
    handleSelectedPlay() {
      const target = this.getSelectedMapTargets()[0];
      if (!target) return;
      this.performEpisodePlay(
        this.buildSelectedEpisodeActionEvent({ altKey: true }),
        this.mapShow,
        target.season,
        target.episode,
      );
    },
    handleMapIntroClick() {
      if (this.selectedCells.size === 0) return;
      const firstKey = Array.from(this.selectedCells)[0];
      const { season, episode } = this.parseCellKey(firstKey);
      const path = this.seriesMap?.[season]?.[episode]?.path || null;
      if (!path) return;
      this.$emit("open-intro", {
        show: this.mapShow,
        path,
        source: "map",
        season,
        episode,
      });
    },
    selectNextEpisodeWithFile(currentSeason, currentEpisode) {
      if (
        this.mapShow?.inEmby === false ||
        this.mapShow?.inLinda ||
        this.mapShow?.introDur != null
      ) {
        return null;
      }
      const seasons = this.seriesMapSeasons;
      const epis = this.seriesMapEpis;
      if (!seasons || !epis) return null;
      let found = false;
      for (const s of seasons) {
        for (const e of epis) {
          if (!found) {
            if (s === currentSeason && e === currentEpisode) found = true;
            continue;
          }
          const ep = this.seriesMap?.[s]?.[e];
          const needsIntro = !!ep && !ep.played;
          if (needsIntro && ep?.path && !ep?.noFile) {
            this.selectedSeasons = new Set();
            this.selectedCells = new Set([`${s}.${e}`]);
            return { path: ep.path, season: s, episode: e };
          }
        }
      }
      return null;
    },
    handleSelectedWatch() {
      const targets = this.getSelectedMapTargets();
      if (targets.length === 0) return;
      for (const target of targets) {
        this.performEpisodeWatch(
          this.buildSelectedEpisodeActionEvent({ shiftKey: true }),
          this.mapShow,
          target.season,
          target.episode,
        );
      }
    },
    handleSelectedDelete() {
      const targets = this.getSelectedMapTargets();
      if (targets.length === 0) return;
      this.$emit("delete-episodes", this.mapShow, targets);
    },
    handleSelectedEmby() {
      const id = this.firstSelectedEmbyId;
      if (!id) return;
      window.open(urls.embyPageUrl(id), "_blank");
    },
    handleEpisodePlainClick(event, mapShow, season, episode) {
      event?.preventDefault?.();

      event?.stopPropagation?.();

      const key = this.cellKey(season, episode);
      this.selectedSeasons = new Set();
      this.selectedCells = new Set([key]);
      this.selectionSeason = String(season);
      this.lastSelectedCell = key;
      this.syncOpenEpisodePaneToSelection();
    },
    handleEpisodeClick(event, mapShow, season, episode) {
      event?.preventDefault?.();

      event?.stopPropagation?.();

      const key = this.cellKey(season, episode);
      const seasonKey = String(season);

      if (this.selectedSeasons.size > 0) {
        this.selectedSeasons = new Set();
      }

      if (
        this.selectionSeason &&
        this.selectionSeason !== seasonKey &&
        !this.selectedCells.has(key)
      ) {
        this.selectedCells = new Set();
        this.selectionSeason = null;
      }

      if (!this.selectionSeason) {
        this.selectionSeason = seasonKey;
      }

      if (event?.shiftKey && this.selectedCells.size === 0) {
        this.selectedCells = new Set([key]);
        this.selectionSeason = seasonKey;
        this.lastSelectedCell = key;
        this.syncOpenEpisodePaneToSelection();
        return;
      }

      if (
        event?.shiftKey &&
        this.lastSelectedCell &&
        this.selectionSeason === seasonKey
      ) {
        const { season: lastSeason, episode: lastEpisode } = this.parseCellKey(
          this.lastSelectedCell,
        );
        if (String(lastSeason) === seasonKey) {
          const idx1 = this.seriesMapEpis.findIndex((ep) => ep === lastEpisode);
          const idx2 = this.seriesMapEpis.findIndex((ep) => ep === episode);
          if (idx1 !== -1 && idx2 !== -1) {
            const start = Math.min(idx1, idx2);
            const end = Math.max(idx1, idx2);
            const next = new Set(this.selectedCells);
            for (const ep of this.seriesMapEpis.slice(start, end + 1)) {
              next.add(this.cellKey(season, ep));
            }
            this.selectedCells = next;
          }
        }
      } else if (event?.ctrlKey) {
        const next = new Set(this.selectedCells);
        if (next.has(key)) {
          next.delete(key);
          if (next.size === 0) this.selectionSeason = null;
        } else {
          next.add(key);
        }
        this.selectedCells = next;
        this.lastSelectedCell = key;
      } else {
        this.selectedCells = new Set([key]);
        this.selectionSeason = seasonKey;
        this.lastSelectedCell = key;
      }

      this.syncOpenEpisodePaneToSelection();
    },
    handleSeasonPlainClick(event, season) {
      event?.preventDefault?.();
      if (this.simpleMode) {
        return;
      }
      event.stopPropagation();

      this.selectedCells = new Set();
      this.selectionSeason = null;
      this.lastSelectedCell = null;
      this.selectedSeasons = new Set([season]);
      this.syncOpenEpisodePaneToSelection();
    },
    handleSeasonClick(event, season) {
      event?.preventDefault?.();
      if (this.simpleMode) {
        return;
      }
      event.stopPropagation();

      this.selectedCells = new Set();
      this.selectionSeason = null;
      this.lastSelectedCell = null;

      const next = new Set(this.selectedSeasons);
      if (next.has(season)) next.delete(season);
      else next.add(season);
      this.selectedSeasons = next;
      this.syncOpenEpisodePaneToSelection();
    },

    async setNextWatch() {
      if (!this.mapShow || !this.mapShow.id) {
        this.nextUpTxt = "";
        return;
      }

      const show = this.mapShow;
      const afterWatched = await emby.afterLastWatched(show);
      const status = afterWatched.status;
      const readyToWatch = status === "ok";

      if (this.mapShow !== show) return;

      if (show.inEmby !== false && status !== "allWatched") {
        const { seasonNumber, episodeNumber } = afterWatched;
        const seaEpiTxt =
          `S${("" + seasonNumber).padStart(2, "0")} ` +
          `E${("" + episodeNumber).padStart(2, "0")}`;
        if (readyToWatch) {
          this.nextUpTxt = ` &nbsp; Next Up: ${seaEpiTxt}`;
        } else {
          this.nextUpTxt = ` 
                &nbsp; Next Up: ${seaEpiTxt} 
                &nbsp; ${status === "missing" ? "No File" : "Unaired"}`;
        }
      } else {
        this.nextUpTxt = "";
      }
    },
  },
};
</script>

<style scoped></style>
