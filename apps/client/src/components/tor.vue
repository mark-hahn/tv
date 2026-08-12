<template>
  <div
    class="torrents-container"
    :style="{
      height: '100%',
      width: '100%',
      display: 'flex',
      justifyContent: 'flex-start',
    }"
  >
    <div
      id="tor"
      ref="scroller"
      :style="{
        height: '100%',
        width: '100%',
        padding: '10px',
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        overflowX: 'hidden',
        maxWidth: '100%',
        boxSizing: 'border-box',
        backgroundColor: '#fafafa',
      }"
      @wheel.stop.prevent="handleScaledWheel"
    >
      <div
        id="header"
        :style="{
          position: 'sticky',
          top: '-10px',
          zIndex: 100,
          backgroundColor: '#fafafa',
          paddingTop: '15px',
          paddingLeft: '10px',
          paddingRight: '10px',
          paddingBottom: '10px',
          marginLeft: '0px',
          marginRight: '0px',
          marginTop: '-10px',
          marginBottom: '0px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
        }"
        class="pane-header-title"
      >
        <div
          style="
            display: flex;
            justify-content: space-between;
            align-items: center;
          "
        >
          <div style="margin-left: 0">
            {{ movieMode ? "Movies" : "Tor: " + headerShowName }}
          </div>
          <div style="display: flex; gap: 8px; align-items: center">
            <button
              @click.stop="
                showStream = false;
                openTorTabs();
              "
              style="
                font-size: 13px;
                cursor: pointer;
                border-radius: 7px;
                padding: 4px;
                border: 1px solid #bbb;
                background-color: whitesmoke;
              "
            >
              Tabs
            </button>
            <button
              v-if="!movieMode"
              @click.stop="showStream = !showStream"
              :style="{
                fontSize: '13px',
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px',
                border: '1px solid #bbb',
                '--btn-bg': showStream ? 'lightgray' : 'whitesmoke',
              }"
            >
              Stream
            </button>
            <button
              v-if="!movieMode"
              @click.stop="
                showStream = false;
                toggleCookieInputs();
              "
              style="
                font-size: 13px;
                cursor: pointer;
                border-radius: 7px;
                padding: 4px;
                border: 1px solid #bbb;
                background-color: whitesmoke;
              "
            >
              Cookies
            </button>
          </div>
        </div>
        <!-- Second header row: row-1 buttons on left, action buttons on right -->
        <div
          v-if="!showStream && !previewMode"
          style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 6px;
            margin-top: 6px;
          "
        >
          <div style="display: flex; gap: 8px; align-items: center">
            <button
              v-if="selectedItems.size > 0"
              @click.stop="
                showStream = false;
                openDetails();
              "
              style="
                font-size: 13px;
                cursor: pointer;
                border-radius: 7px;
                padding: 4px;
                border: 1px solid #bbb;
                background-color: whitesmoke;
              "
            >
              Tab
            </button>
            <button
              v-if="!movieMode"
              @click.stop="handleSearchButtonClick"
              style="
                font-size: 13px;
                cursor: pointer;
                border-radius: 7px;
                padding: 4px;
                border: 1px solid #bbb;
                background-color: whitesmoke;
              "
            >
              Search
            </button>
            <button
              @click.stop="torSendClick"
              :disabled="selectedItems.size === 0"
              :class="{ 'btn-disabled': selectedItems.size === 0 }"
              :style="{
                fontSize: '13px',
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px 8px',
                border: '1px solid #bbb',
                '--btn-bg': sendFlash ? 'lightgray' : 'whitesmoke',
              }"
            >
              Send
            </button>
            <button
              @click.stop="torHoldClick"
              :disabled="selectedItems.size === 0"
              :class="{ 'btn-disabled': selectedItems.size === 0 }"
              title="Send to qbt but hold the files on usb for preview"
              :style="{
                fontSize: '13px',
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px 8px',
                border: '1px solid #bbb',
                '--btn-bg': holdFlash ? 'lightgray' : 'whitesmoke',
              }"
            >
              Hold
            </button>
            <span
              v-if="loading"
              style="font-size: 13px; color: #666; align-self: center"
              >Searching</span
            >
            <input
              v-if="movieMode"
              v-model="movieSrchText"
              @keydown.stop
              @keydown.enter.stop="movieSearchEnter()"
              @click.stop
              placeholder="Movie title"
              style="
                width: 120px;
                font-size: 13px;
                padding: 4px;
                border: 1px solid #bbb;
                border-radius: 7px;
              "
            />
            <button
              v-if="movieMode"
              @click.stop="movieSearchEnter()"
              style="
                font-size: 13px;
                cursor: pointer;
                border-radius: 7px;
                padding: 4px;
                border: 1px solid #bbb;
                background-color: whitesmoke;
              "
            >
              Search
            </button>
          </div>
          <div style="display: flex; gap: 6px; align-items: center">
            <span
              v-if="selectedItems.size > 0"
              class="sel-count"
              style="
                font-size: 15px;
                font-weight: bold;
                color: green;
                align-self: center;
                white-space: nowrap;
                margin-right: 2px;
              "
              >Sel: {{ selectedItems.size }}</span
            >
            <button
              @click.stop="torAllClick"
              :disabled="selectedItems.size === 0"
              :class="{ 'btn-disabled': selectedItems.size === 0 }"
              style="
                font-size: 13px;
                cursor: pointer;
                border-radius: 7px;
                padding: 4px 8px;
                border: 1px solid #bbb;
              "
            >
              All
            </button>
            <button
              @click.stop="torGroupClick"
              :disabled="selectedItems.size === 0 && groupFilter === null"
              :class="{
                'btn-disabled':
                  selectedItems.size === 0 && groupFilter === null,
              }"
              :style="{
                fontSize: '13px',
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px 8px',
                border: '1px solid #bbb',
                '--btn-bg':
                  groupFilterFlash || groupFilter !== null
                    ? 'lightgray'
                    : 'whitesmoke',
              }"
            >
              Group
            </button>
            <button
              @click.stop="torShowFilterClick"
              :disabled="selectedItems.size === 0 && showFilter === null"
              :class="{
                'btn-disabled': selectedItems.size === 0 && showFilter === null,
              }"
              :style="{
                fontSize: '13px',
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px 8px',
                border: '1px solid #bbb',
                '--btn-bg': showFilter !== null ? 'lightgray' : 'whitesmoke',
              }"
            >
              Show
            </button>
            <button
              @click.stop="torFirstClick"
              :disabled="selectedItems.size === 0"
              :class="{ 'btn-disabled': selectedItems.size === 0 }"
              style="
                font-size: 13px;
                cursor: pointer;
                border-radius: 7px;
                padding: 4px 8px;
                border: 1px solid #bbb;
              "
            >
              First
            </button>
            <input
              v-if="!movieMode"
              v-model="seasonFilter"
              @keydown.stop
              @keydown.enter.stop="handleSearchButtonClick()"
              @click.stop
              placeholder="Season"
              style="
                width: 40px;
                font-size: 13px;
                padding: 4px;
                border: 1px solid #bbb;
                border-radius: 7px;
              "
            />
            <button
              @click.stop="torChkSubClick"
              :disabled="selectedItems.size === 0"
              :class="{ 'btn-disabled': selectedItems.size === 0 }"
              :style="{
                fontSize: '13px',
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px 8px',
                border: '1px solid #bbb',
                '--btn-bg': torSubCountBusy ? 'lightgray' : 'whitesmoke',
              }"
            >
              Chk Subs
            </button>
            <button
              @click.stop="torInfoClick"
              :disabled="selectedItems.size === 0 || torInfoBusy"
              :class="{
                'btn-disabled': selectedItems.size === 0 || torInfoBusy,
              }"
              :style="{
                fontSize: '13px',
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px 8px',
                border: '1px solid #bbb',
                '--btn-bg': torInfoBusy ? 'lightgray' : 'whitesmoke',
              }"
            >
              Info
            </button>
            <button
              @click.stop="torBadGrpClick"
              :disabled="selectedItems.size === 0"
              :class="{ 'btn-disabled': selectedItems.size === 0 }"
              style="
                font-size: 13px;
                cursor: pointer;
                border-radius: 7px;
                padding: 4px 8px;
                border: 1px solid #bbb;
              "
            >
              Bad Grp
            </button>
          </div>
        </div>
        <div
          style="
            height: 1px;
            width: 100%;
            background-color: #000;
            margin-top: 6px;
          "
        ></div>
        <div
          v-if="!showStream"
          style="
            margin-left: 0;
            margin-right: 20px;
            margin-top: 6px;
            font-weight: normal;
            font-size: 15px;
            color: #666;
            line-height: 1.1;
            overflow: visible;
            display: flex;
            align-items: center;
            justify-content: space-between;
            white-space: nowrap;
          "
        >
          <span
            ><strong>USB</strong>: {{ spaceUsbGb }} GB {{ spaceUsbPct }} |
            <strong>SRVR</strong>: {{ spaceSrvrGb }} GB {{ spaceSrvrPct }}</span
          >
          <span
            v-if="providerStats && Object.keys(providerStats).length > 0"
            style="color: #888; margin-left: 16px"
            v-html="headerIdsLine"
          ></span>
        </div>
        <div
          v-if="!showStream"
          style="
            height: 1px;
            width: 100%;
            background-color: #000;
            margin-top: 6px;
          "
        ></div>
      </div>
      <div
        id="unaired"
        v-if="!showStream && unaired"
        style="
          text-align: center;
          color: #666;
          margin-top: 50px;
          font-size: 18px;
        "
      >
        <div>Show not aired yet</div>
      </div>
      <Stream
        :show="currentShow"
        :visible="showStream"
      />
      <div
        id="cookie-inputs"
        @click.stop
        v-if="
          !showStream &&
          !loading &&
          ((isCookieRelatedError && !dismissCookieInputs) || showCookieInputs)
        "
        style="
          position: sticky;
          top: 120px;
          zindex: 120;
          padding: 15px 20px 15px 20px;
          margin-bottom: 10px;
          background: #fff;
          border-radius: 5px;
          border: 1px solid #ddd;
        "
      >
        <div style="margin-bottom: 10px">
          <label
            style="
              display: block;
              font-size: 12px;
              font-weight: bold;
              margin-bottom: 3px;
              color: #555;
            "
            >IPTorrents cf_clearance:</label
          >
          <input
            v-model="iptCfClearance"
            type="text"
            placeholder="Paste cf_clearance cookie value"
            style="
              width: 100%;
              padding: 6px;
              font-size: 12px;
              border: 1px solid #ccc;
              border-radius: 3px;
              box-sizing: border-box;
            "
          />
        </div>
        <div style="margin-bottom: 10px">
          <label
            style="
              display: block;
              font-size: 12px;
              font-weight: bold;
              margin-bottom: 3px;
              color: #555;
            "
            >TorrentLeech cf_clearance:</label
          >
          <input
            v-model="tlCfClearance"
            type="text"
            placeholder="Paste cf_clearance cookie value"
            style="
              width: 100%;
              padding: 6px;
              font-size: 12px;
              border: 1px solid #ccc;
              border-radius: 3px;
              box-sizing: border-box;
            "
          />
        </div>
        <div style="margin-top: 10px">
          <button
            @click.stop="saveCookies"
            :disabled="loading"
            style="
              padding: 8px 20px;
              font-size: 13px;
              font-weight: bold;
              cursor: pointer;
              border-radius: 5px;
              background: #4caf50;
              color: white;
              border: none;
              width: 100%;
            "
          >
            Save Cookies
          </button>
        </div>
      </div>
      <div
        id="debug-panel"
        @click.stop
        v-if="!loading &amp;&amp; showDebug"
        style="
          position: sticky;
          top: 120px;
          zindex: 119;
          padding: 12px 16px;
          margin-bottom: 10px;
          background: #fff;
          border-radius: 5px;
          border: 1px solid #ddd;
          font-weight: normal;
        "
      >
        <div
          style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
          "
        >
          <div style="font-weight: bold; color: #444; font-size: 12px">
            Debug
          </div>
          <div style="display: flex; gap: 8px; align-items: center">
            <button
              v-if="lastSearchUrl"
              @click.stop="copyDebugUrl"
              style="
                font-size: 12px;
                cursor: pointer;
                border-radius: 6px;
                padding: 2px 8px;
                border: 1px solid #bbb;
                background-color: whitesmoke;
              "
            >
              Copy URL
            </button>
            <button
              @click.stop="showDebug = false"
              style="
                font-size: 12px;
                cursor: pointer;
                border-radius: 6px;
                padding: 2px 8px;
                border: 1px solid #bbb;
                background-color: whitesmoke;
              "
            >
              Close
            </button>
          </div>
        </div>
        <div
          style="
            font-size: 12px;
            color: #555;
            line-height: 1.35;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
          "
        >
          <div
            v-if="debugCopyMsg"
            style="color: #2b6; margin-bottom: 6px"
          >
            {{ debugCopyMsg }}
          </div>
          <div v-if="lastSearchShow">
            <span style="font-weight: bold">show:</span> {{ lastSearchShow }}
          </div>
          <div v-if="lastSearchNeeded">
            <span style="font-weight: bold">needed:</span>
            {{ lastSearchNeeded }}
          </div>
          <div v-if="lastSearchUrl">
            <span style="font-weight: bold">url:</span> {{ lastSearchUrl }}
          </div>
          <div v-if="lastApiCount !== null">
            <span style="font-weight: bold">api count:</span> {{ lastApiCount }}
          </div>
          <div v-if="lastRawProviderCounts">
            <span style="font-weight: bold">rawProviderCounts:</span>
            {{ formatJsonInline(lastRawProviderCounts) }}
          </div>
          <div v-if="lastReturnedProviderCounts">
            <span style="font-weight: bold">returnedProviderCounts:</span>
            {{ formatJsonInline(lastReturnedProviderCounts) }}
          </div>
          <div v-if="lastWarningSummary">
            <span style="font-weight: bold">warningSummary:</span>
            {{ formatJsonInline(lastWarningSummary) }}
          </div>
        </div>
      </div>

      <div
        id="error"
        v-if="!unaired &amp;&amp; error"
        style="
          text-align: center;
          color: #c00;
          margin-top: 50px;
          font-size: 16px;
          white-space: pre-line;
          padding: 0 20px;
        "
      >
        <div>Error: {{ error }}</div>
      </div>
      <div
        id="warning"
        v-if="!unaired &amp;&amp; !error &amp;&amp; providerWarning"
        style="
          text-align: center;
          color: #b36b00;
          margin-top: 20px;
          font-size: 14px;
          white-space: pre-line;
          padding: 0 20px;
        "
      >
        <div>{{ providerWarning }}</div>
      </div>
      <div
        id="no-torrents-needed"
        v-if="!showStream && !unaired && noTorrentsNeeded && !loading && !error"
        style="
          text-align: center;
          color: #666;
          margin-top: 50px;
          font-size: 18px;
        "
      >
        <div>No torrents needed.</div>
      </div>
      <div
        id="torrents-list"
        v-if="
          !showStream &&
          !unaired &&
          (!loading || torrents.length > 0) &&
          !noTorrentsNeeded
        "
        style="
          padding: 10px;
          font-size: 14px;
          font-family: sans-serif;
          font-weight: normal;
        "
      >
        <div
          v-if="hasSearched &amp;&amp; filteredTorrents.length === 0 &amp;&amp; !error"
          style="text-align: center; color: #999; margin-top: 50px"
        >
          <div>No torrents found.</div>
        </div>
        <div
          v-for="(torrent, index) in filteredTorrents"
          :key="getTorrentCardKey(torrent, index)"
          @click="handleTorrentClick($event, torrent)"
          @click.stop
          @mousedown="$event.shiftKey && $event.preventDefault()"
          :style="getCardStyle(torrent)"
          @mouseenter="
            $event.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)'
          "
          @mouseleave="$event.currentTarget.style.boxShadow = 'none'"
        >
          <div
            v-if="isClicked(torrent)"
            style="
              position: absolute;
              top: 8px;
              right: 8px;
              color: #4caf50;
              font-size: 20px;
              font-weight: bold;
            "
          >
            ✓
          </div>
          <div
            v-if="isDownloadedBefore(torrent)"
            :style="getDownloadedBeforeIconStyle(torrent)"
            title="Downloaded before"
          >
            🕘
          </div>
          <div
            v-if="getDownloadStatus(torrent)"
            style="
              position: absolute;
              bottom: 8px;
              right: 52px;
              font-size: 11px;
              color: #666;
              max-width: 60%;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            "
          >
            {{ getDownloadStatusLabel(torrent) }}
          </div>
          <div
            v-if="SHOW_TITLE &amp;&amp; torrent.raw"
            style="
              font-size: 14px;
              font-weight: bold;
              color: #888;
              margin-bottom: 4px;
              white-space: normal;
              overflow-wrap: anywhere;
              word-break: break-word;
              font-family: sans-serif;
            "
          >
            {{ getDisplayTitleWithProvider(torrent) }}
          </div>
          <div
            v-if="getTorrentWarnings(torrent).length &gt; 0"
            style="
              font-size: 11px;
              color: #a33;
              margin-bottom: 4px;
              white-space: normal;
              overflow-wrap: anywhere;
              word-break: break-word;
            "
          >
            {{ formatTorrentWarnings(torrent) }}
          </div>
          <div
            style="
              margin-top: 8px;
              font-size: 13px;
              font-family: sans-serif;
              color: #333;
            "
          >
            <span
              v-if="!movieMode"
              style="color: blue !important"
              >{{ getDisplaySeasonEpisode(torrent) }}</span
            ><span
              v-if="torrent.parsed?.resolution"
              style="color: blue !important"
              >&nbsp;-&nbsp;{{ torrent.parsed.resolution }}</span
            ><span style="color: rgba(0, 0, 0, 0.5) !important"
              >&nbsp;&nbsp;{{
                fmtSize(torrent.raw?.size) || torrent.raw?.size || "N/A"
              }}
              |
              {{ torrent.raw?.seeds || 0 }} seeds<span
                v-if="torrent.raw?.provider"
                style="color: rgba(0, 0, 0, 0.5) !important"
                >&nbsp;|&nbsp;{{ formatProvider(torrent.raw.provider) }}</span
              ><span
                v-if="torrent.parsed?.group"
                :style="
                  badGroups.has(torrent.parsed.group.toLowerCase())
                    ? 'color: red !important; font-weight: bold'
                    : 'color: rgba(0, 0, 0, 0.5) !important'
                "
                >&nbsp;|&nbsp;{{ formatGroup(torrent.parsed.group) }}</span
              ><span
                v-if="getTorSubSummary(torrent)"
                style="font-size: 12px; color: #666; margin-left: 8px"
              >
                {{ getTorSubSummary(torrent) }}
              </span></span
            >
          </div>
          <div
            v-if="
              getDownloadStatus(torrent)?.status === 'error' &&
              getDownloadStatus(torrent)?.message
            "
            style="
              margin-top: 6px;
              font-size: 11px;
              color: #c00;
              white-space: normal;
              overflow-wrap: anywhere;
              word-break: break-word;
            "
          >
            {{ getDownloadStatus(torrent).message }}
          </div>
          <div
            v-if="isDownloadedBefore(torrent)"
            style="
              margin-top: 4px;
              font-size: 13px;
              color: #666;
              font-family: sans-serif;
            "
          >
            Sent recently
          </div>
        </div>
      </div>
    </div>
    <div
      id="download-modal"
      v-if="showModal"
      @click.stop="showModal = false"
      style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
      "
    >
      <div
        id="modal-content"
        @click.stop
        style="
          background: white;
          padding: 30px;
          border-radius: 10px;
          max-width: 500px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        "
      >
        <div style="font-size: 16px; margin-bottom: 20px; line-height: 1.5">
          Is it OK to download file
          <span style="font-weight: bold">{{
            [...selectedItems][0]?.raw?.title || "Unknown"
          }}</span
          >?
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end">
          <button
            @click.stop="cancelDownload"
            style="
              padding: 8px 20px;
              font-size: 14px;
              cursor: pointer;
              border-radius: 5px;
              border: 1px solid #ccc;
              background: white;
            "
          >
            Cancel
          </button>
          <button
            @click.stop="continueDownload"
            style="
              padding: 8px 20px;
              font-size: 14px;
              cursor: pointer;
              border-radius: 5px;
              border: 1px solid #ccc;
              background: white;
            "
          >
            OK
          </button>
        </div>
      </div>
    </div>
    <div
      id="error-modal"
      v-if="showErrorModal"
      @click.stop="closeErrorModal"
      style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
      "
    >
      <div
        id="modal-content"
        @click.stop
        style="
          background: white;
          padding: 30px;
          border-radius: 10px;
          max-width: 520px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        "
      >
        <div
          style="
            font-size: 16px;
            margin-bottom: 20px;
            line-height: 1.5;
            white-space: pre-line;
          "
        >
          {{ errorModalMsg }}
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end">
          <button
            @click.stop="closeErrorModal"
            style="
              padding: 8px 20px;
              font-size: 14px;
              cursor: pointer;
              border-radius: 5px;
              border: 1px solid #ccc;
              background: white;
            "
          >
            OK
          </button>
        </div>
      </div>
    </div>
    <div
      id="existing-delete-modal"
      v-if="showExistingDeleteModal"
      @click.stop="cancelExistingDelete"
      style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
      "
    >
      <div
        id="modal-content"
        @click.stop
        style="
          background: white;
          padding: 30px;
          border-radius: 10px;
          max-width: 520px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        "
      >
        <div
          style="
            font-size: 16px;
            margin-bottom: 20px;
            line-height: 1.5;
            white-space: pre-line;
          "
        >
          {{ existingDeleteModalMsg }}
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end">
          <button
            @click.stop="cancelExistingDelete"
            style="
              padding: 8px 20px;
              font-size: 14px;
              cursor: pointer;
              border-radius: 5px;
              border: 1px solid #ccc;
              background: white;
            "
          >
            Cancel
          </button>
          <button
            @click.stop="confirmExistingDelete"
            style="
              padding: 8px 20px;
              font-size: 14px;
              cursor: pointer;
              border-radius: 5px;
              border: 1px solid #ccc;
              background: white;
            "
          >
            Delete
          </button>
        </div>
      </div>
    </div>

    <div
      id="info-modal"
      v-if="showInfoModal"
      @click.stop="closeInfoModal"
      style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
      "
    >
      <div
        id="modal-content"
        @click.stop
        style="
          background: white;
          padding: 30px;
          border-radius: 10px;
          max-width: 520px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        "
      >
        <div
          style="
            font-size: 16px;
            margin-bottom: 20px;
            line-height: 1.5;
            white-space: pre-line;
          "
        >
          {{ infoModalMsg }}
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end">
          <button
            @click.stop="closeInfoModal"
            style="
              padding: 8px 20px;
              font-size: 14px;
              cursor: pointer;
              border-radius: 5px;
              border: 1px solid #ccc;
              background: white;
            "
          >
            OK
          </button>
        </div>
      </div>
    </div>

    <div
      id="torrent-info-modal"
      v-if="showTorrentInfoModal"
      @click.stop="closeTorrentInfoModal"
      style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
      "
    >
      <div
        id="modal-content"
        style="
          background: white;
          padding: 24px;
          border-radius: 10px;
          width: min(720px, calc(100vw - 40px));
          max-height: calc(100vh - 40px);
          display: flex;
          flex-direction: column;
          min-height: 0;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        "
      >
        <div
          style="
            flex: 0 0 auto;
            font-size: 20px;
            font-weight: 600;
            margin-bottom: 18px;
          "
        >
          Torrent Info
        </div>
        <div
          v-if="torrentInfoData && torrentInfoData.info"
          style="
            flex: 1 1 auto;
            min-height: 0;
            overflow-y: auto;
            display: grid;
            grid-template-columns: 130px 1fr;
            gap: 10px 14px;
            align-content: start;
          "
        >
          <div style="font-weight: 600">Name</div>
          <div style="word-break: break-word">
            {{ torrentInfoData.info.name || "--" }}
          </div>

          <div style="font-weight: 600">Info Hash</div>
          <div style="word-break: break-all">
            {{ torrentInfoData.info.infoHash || "--" }}
          </div>

          <div style="font-weight: 600">Size</div>
          <div>
            {{ formatTorrentBytes(torrentInfoData.info.totalSize) }}
          </div>

          <div style="font-weight: 600">Files</div>
          <div>{{ torrentInfoData.info.fileCount ?? "--" }}</div>

          <div style="font-weight: 600">Piece Length</div>
          <div>
            {{ formatTorrentBytes(torrentInfoData.info.pieceLength) }}
          </div>

          <div style="font-weight: 600">Private</div>
          <div>{{ torrentInfoData.info.private ? "Yes" : "No" }}</div>

          <div style="font-weight: 600">Created</div>
          <div>{{ formatTorrentDate(torrentInfoData.info.createdAt) }}</div>

          <div style="font-weight: 600">Created By</div>
          <div style="word-break: break-word">
            {{ torrentInfoData.info.createdBy || "--" }}
          </div>

          <div style="font-weight: 600">Comment</div>
          <div style="white-space: pre-wrap; word-break: break-word">
            {{ torrentInfoData.info.comment || "--" }}
          </div>

          <div style="font-weight: 600">Web Seeds</div>
          <div style="white-space: pre-wrap; word-break: break-word">
            {{ (torrentInfoData.info.webSeeds || []).join("\n") || "--" }}
          </div>

          <div style="font-weight: 600">Files</div>
          <div style="white-space: pre-wrap; word-break: break-word">
            <div
              v-for="file in torrentInfoData.info.files || []"
              :key="`${file.path}-${file.size}`"
              style="margin-bottom: 6px"
            >
              {{ file.path }}
              <span style="color: #666">
                ({{ formatTorrentBytes(file.size) }})
              </span>
            </div>
            <div
              v-if="
                !torrentInfoData.info.files ||
                torrentInfoData.info.files.length === 0
              "
            >
              --
            </div>
          </div>
        </div>
        <div
          style="
            flex: 0 0 auto;
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            margin-top: 20px;
          "
        >
          <button
            @click.stop="closeTorrentInfoModal"
            style="
              padding: 8px 20px;
              font-size: 14px;
              cursor: pointer;
              border-radius: 5px;
              border: 1px solid #ccc;
              background: white;
            "
          >
            Close
          </button>
        </div>
      </div>
    </div>

    <div
      id="emby-loading-modal"
      v-if="embyLoadingShow"
      @click.stop
      style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
      "
    >
      <div
        @click.stop
        style="
          background: white;
          padding: 30px;
          border-radius: 10px;
          max-width: 420px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
          text-align: center;
        "
      >
        <div style="font-size: 16px; font-weight: bold; margin-bottom: 12px">
          Loading show into Emby
        </div>
        <div style="font-size: 14px; color: #555">
          {{ embyLoadingStatus }}
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import evtBus from "../evtBus.js";
import * as emby from "../emby.js";
import * as util from "../util.js";
import { openExternalBlank } from "../util.js";
import { config } from "../config.js";
import Stream from "./stream.vue";
import parseTorrentTitle from "parse-torrent-title";
import * as srvr from "../srvr.js";
import { isHevc } from "@tv/share";
import { unilog, logHere } from "../log.js";

export default {
  name: "Torrents",
  components: { Stream },
  props: {
    simpleMode: {
      type: Boolean,
      default: false,
    },
    activeShow: {
      type: Object,
      default: null,
    },
    sizing: {
      type: Object,
      default: () => ({}),
    },
    previewMode: {
      type: Boolean,
      default: false,
    },
    movieMode: {
      type: Boolean,
      default: false,
    },
    active: {
      type: Boolean,
      default: false,
    },
    // Map pane Tor button request: { show, episodes, seq }. A new seq runs a
    // fresh episode search.
    episodeRequest: {
      type: Object,
      default: null,
    },
  },

  data() {
    return {
      torrents: [],
      showName: "",
      loading: false,
      error: null,
      hasSearched: false,
      providerWarning: "",
      maxResults: 500, // Constant for maximum results to fetch
      seasonFilter: "",
      iptCfClearance: "",
      tlCfClearance: "",
      currentShow: null,
      movieSrchText: "",
      SHOW_TITLE: true, // Show torrent title on card
      selectedItems: new Set(), // Currently selected torrents (multi-select)
      lastSelectedIndex: null, // Index in filteredTorrents for shift-select
      showModal: false, // Show download confirmation modal
      showErrorModal: false,
      errorModalMsg: "",
      showInfoModal: false,
      infoModalMsg: "",
      showTorrentInfoModal: false,
      torrentInfoData: null,
      torInfoBusy: false,

      showExistingDeleteModal: false,
      existingDeleteModalMsg: "",
      existingDeleteWrapper: null,
      existingDeleteResolve: null,
      flashingTorrent: null, // Torrent flashing after alt-click copy
      clickedTorrents: new Set(), // Track which torrents have been clicked
      downloadedTorrents: new Set(), // Track which torrents have been downloaded via Get button
      noTorrentsNeeded: false, // Flag when needed array is empty
      showCookieInputs: false, // Manual toggle for cookie input boxes
      dismissCookieInputs: false,
      showStream: false,
      unaired: false,

      lastNeeded: null,

      // Episode list (SxxExx) sent from the map pane Tor button; null otherwise.
      mapEpisodes: null,

      downloadedByHash: {},

      // Space display cells (2x2): rows USB/SRVR, cols GB/%.
      spaceUsbGb: "--",
      spaceUsbPct: "--%",
      spaceSrvrGb: "--",
      spaceSrvrPct: "--%",

      _didInitialScroll: false,

      lastAutoSearchedShowId: null,
      torSearchPhase: "idle",

      // Debug: last search request/response metadata
      showDebug: false,
      lastSearchUrl: "",
      lastSearchShow: "",
      lastSearchNeeded: "",
      lastRawProviderCounts: null,
      lastReturnedProviderCounts: null,
      lastApiCount: null,
      lastWarningSummary: null,
      debugCopyMsg: "",

      // Download queue/state (avoid dropped requests + show per-torrent results)
      downloadQueue: [],
      downloadQueueRunning: false,
      downloadStatus: {},

      // Emby-loading progress dialog
      embyLoadingShow: false,
      embyLoadingStatus: "",

      // More providers (TPB/LIM/EZT) state
      hasMoreProviders: false,
      providerStats: null,
      resultsShowId: null,

      // Cache torrent results from preview mode for later use
      previewTorCache: new Map(),

      // Simple cache: search URL -> result payload
      torSearchCache: new Map(),

      // Snapshot of seriesMap JSON from last search (for change detection on pane return)
      _savedSeriesMapJson: null,

      torSubCountBusy: false,
      torSubCountsVisible: false,
      torSubCountCache: {},
      torSubCountVisibleKeys: {},

      groupCounts: {},
      badGroups: new Set(),
      _badGroupsChannel: null,

      groupFilter: null, // non-null = group name filter is active
      groupFilterFlash: false, // true = flash button highlight for 500ms
      sendFlash: false, // true = flash Send button highlight for 500ms
      holdFlash: false, // true = flash Hold button highlight for 500ms

      showFilter: null, // non-null = show name filter is active
    };
  },

  watch: {
    episodeRequest(req) {
      if (req) void this.searchMapEpisodes(req);
    },
    movieMode(val) {
      if (!val) {
        this.torrents = [];
        this.movieSrchText = "";
        this.setTorSearchPhase("idle");
      }
    },
    activeShow() {
      this.showStream = false;
    },
    "currentShow.name"(newName, oldName) {
      if (newName !== oldName) this.seasonFilter = "";
    },
    seasonFilter(newVal, oldVal) {
      // The season is part of the provider query, so changing it makes any
      // previous results stale -- start the search sequence over on next click.
      if (newVal !== oldVal && this.torSearchPhase !== "idle") {
        this.lastNeeded = null;
        this.setTorSearchPhase("idle");
      }
    },
    active(val) {
      if (!val) this.showStream = false;
    },
  },

  computed: {
    headerShowName() {
      const name =
        this.showName || this.currentShow?.name || this.activeShow?.name || "";
      if (!name) return "";
      const hasYear = /\(\d{4}\)/.test(name);
      if (!hasYear) {
        const firstAired =
          this.currentShow?.firstAired || this.activeShow?.firstAired || "";
        const year = firstAired ? firstAired.substring(0, 4) : "";
        if (year) return `${name} (${year})`;
      }
      return name;
    },
    headerIdsLine() {
      if (this.providerStats && Object.keys(this.providerStats).length > 0) {
        return Object.entries(this.providerStats)
          .map(
            ([code, { filtered, total }]) =>
              `<strong>${code}</strong>: ${filtered}/${total}`,
          )
          .join("  |  ");
      }
      return "";
    },
    // Season typed in the Season box, as a number, or null when empty/invalid.
    // Used both to restrict the provider search and to filter results.
    seasonSearchNum() {
      if (this.movieMode) return null;
      if (String(this.seasonFilter).trim() === "") return null;
      const n = parseInt(this.seasonFilter, 10);
      return !isNaN(n) && n >= 0 ? n : null;
    },
    // Comma-separated unique seasons of the map-pane episode list, used to
    // restrict the provider query. Null when no map episode search is active.
    mapSeasonsParam() {
      if (!Array.isArray(this.mapEpisodes) || this.mapEpisodes.length === 0)
        return null;
      const seasons = new Set();
      for (const ep of this.mapEpisodes) {
        const m = /^S(\d+)E\d+$/i.exec(String(ep));
        if (m) seasons.add(parseInt(m[1], 10));
      }
      if (seasons.size === 0) return null;
      return Array.from(seasons)
        .sort((a, b) => a - b)
        .join(",");
    },
    filteredTorrents() {
      // Use season filter if present
      const sVal = parseInt(this.seasonFilter, 10);
      const hasSeasonFilter =
        !isNaN(sVal) && sVal >= 0 && String(this.seasonFilter).trim() !== "";

      const asNumber = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      };

      const hasWarn = (t) => this.getTorrentWarnings(t).length > 0;

      const getSeason = (t) => {
        if (t.seasonRange && t.seasonRange.isRange)
          return asNumber(t.seasonRange.startSeason);
        if (
          t.parsed &&
          t.parsed.season !== undefined &&
          t.parsed.season !== null
        )
          return asNumber(t.parsed.season);
        return 999999;
      };

      const getType = (t) => {
        // Season Range
        if (t.seasonRange && t.seasonRange.isRange) return 1;

        // Check for parsed structure
        if (t.parsed) {
          // Note: 0 is a valid season/episode, check against undefined/null
          const hasSeason =
            t.parsed.season !== undefined && t.parsed.season !== null;
          const hasEpisode =
            t.parsed.episode !== undefined && t.parsed.episode !== null;

          if (hasSeason && !hasEpisode) return 2; // Season Pack
          if (hasSeason && hasEpisode) return 3; // Individual Episode
        }

        return 4; // Other
      };

      let list = Array.isArray(this.torrents) ? this.torrents : [];

      if (hasSeasonFilter) {
        list = list.filter((t) => {
          if (t.seasonRange && t.seasonRange.isRange) {
            const s = Number(t.seasonRange.startSeason);
            const e = Number(t.seasonRange.endSeason);
            return (
              Number.isFinite(s) && Number.isFinite(e) && sVal >= s && sVal <= e
            );
          }
          if (
            t.parsed &&
            t.parsed.season !== undefined &&
            t.parsed.season !== null
          ) {
            return Number(t.parsed.season) === sVal;
          }
          return false;
        });
      }

      if (this.groupFilter) {
        const gf = this.groupFilter.toLowerCase();
        list = list.filter(
          (t) => String(t.parsed?.group || "").toLowerCase() === gf,
        );
      }

      if (this.showFilter) {
        const candidates = [{ name: this.showFilter }];
        list = list.filter((t) => {
          const name = this.torExtractShowName(t);
          if (!name) return false;
          return !!util.smartTitleMatch(name, candidates, null, false);
        });
      }

      return list.slice().sort((a, b) => {
        // 1. Highest Priority: Warnings (non-warned items first)
        const wa = hasWarn(a) ? 1 : 0;
        const wb = hasWarn(b) ? 1 : 0;
        if (wa !== wb) return wa - wb;

        // 2. Second Priority: Season
        const sA = getSeason(a);
        const sB = getSeason(b);
        if (sA !== sB) return sA - sB; // Ascending

        // 3. Third Priority: Type
        // Season Ranges (1) -> Season Packs (2) -> Individual Episodes (3) -> Other (4)
        const typeA = getType(a);
        const typeB = getType(b);
        if (typeA !== typeB) return typeA - typeB;

        // 4. Type-specific secondary
        if (typeA === 1) {
          // Season Range
          // Then by last in reverse order
          const s2A = asNumber(a.seasonRange?.endSeason);
          const s2B = asNumber(b.seasonRange?.endSeason);
          if (s2A !== s2B) return s2B - s2A; // Descending
        } else if (typeA === 3) {
          // Individual Episode
          // Then by episode
          const eA = asNumber(a.parsed?.episode);
          const eB = asNumber(b.parsed?.episode);
          if (eA !== eB) return eA - eB; // Ascending
        }

        // 5. Resolution (descending: 2160 > 1080 > 720 > unknown)
        const resNum = (t) => {
          const r = String(t.parsed?.resolution || "");
          const m = r.match(/(\d+)/);
          return m ? parseInt(m[1], 10) : 0;
        };
        const rA = resNum(a);
        const rB = resNum(b);
        if (rA !== rB) return rB - rA;

        // 5b. At equal resolution, hevc loses — it needs a full transcode for
        // chksrt, where h264 only needs a remux.
        const hA = this.torrentIsHevc(a) ? 1 : 0;
        const hB = this.torrentIsHevc(b) ? 1 : 0;
        if (hA !== hB) return hA - hB;

        // 6. Rest of priorities (Seeds -> Title)
        const sd = asNumber(b?.raw?.seeds) - asNumber(a?.raw?.seeds);
        if (sd !== 0) return sd;

        const ta = String(a?.raw?.title || a?.title || "");
        const tb = String(b?.raw?.title || b?.title || "");
        return ta.localeCompare(tb);
      });
    },
    trackerCounts() {
      const counts = {};
      this.torrents.forEach((torrent) => {
        const provider = torrent.raw?.provider || "Unknown";
        counts[provider] = (counts[provider] || 0) + 1;
      });
      return counts;
    },
    isCookieRelatedError() {
      // Also show for explicit cookie-related errors even if we got some results
      if (this.error) {
        const errorLower = this.error.toLowerCase();
        return (
          errorLower.includes("cf_clearance") ||
          errorLower.includes("access denied") ||
          errorLower.includes("403") ||
          errorLower.includes("401") ||
          errorLower.includes("forbidden")
        );
      }

      return false;
    },
  },

  mounted() {
    evtBus.on("paneChanged", this.onPaneChanged);
    evtBus.on("showTorrents", this.searchTorrents);
    evtBus.on("setTorShow", this.setTorShow);
    evtBus.on("resetTorrentsPane", this.resetPane);
    evtBus.on("refreshSpaceAvail", this.onRefreshSpaceAvail);
    evtBus.on("openStream", this.onOpenStream);
    evtBus.on("torArrowKey", this.onTorArrowKey);

    void this.loadDownloadedHistory();
    srvr
      .getGroupCounts()
      .then((counts) => {
        if (counts && typeof counts === "object") this.groupCounts = counts;
      })
      .catch(() => {});

    this.openBadGroupsChannel();
    void this.$nextTick(() => {
      this.scrollToBottom();
    });
  },

  unmounted() {
    evtBus.off("paneChanged", this.onPaneChanged);
    evtBus.off("setTorShow", this.setTorShow);
    evtBus.off("showTorrents", this.searchTorrents);
    evtBus.off("resetTorrentsPane", this.resetPane);
    evtBus.off("refreshSpaceAvail", this.onRefreshSpaceAvail);
    evtBus.off("openStream", this.onOpenStream);
    evtBus.off("torArrowKey", this.onTorArrowKey);
    this.closeBadGroupsChannel();
  },

  methods: {
    // Keyboard right arrow — same as clicking Send.
    async onTorArrowKey() {
      await this.torSendClick();
    },

    toggleDebug() {
      this.showDebug = !this.showDebug;
    },
    async copyDebugUrl() {
      const text = String(this.lastSearchUrl || "").trim();
      if (!text) return;

      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.setAttribute("readonly", "");
          ta.style.position = "fixed";
          ta.style.left = "-9999px";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
        this.debugCopyMsg = "Copied URL to clipboard";
      } catch {
        this.debugCopyMsg = "Copy failed (clipboard blocked)";
      }

      window.clearTimeout(this._debugCopyTimer);
      this._debugCopyTimer = window.setTimeout(() => {
        this.debugCopyMsg = "";
      }, 1500);
    },
    formatJsonInline(obj) {
      try {
        return JSON.stringify(obj);
      } catch {
        return String(obj);
      }
    },
    getTorrentWarnings(torrent) {
      const w = torrent?.warnings ?? torrent?.raw?.warnings;
      return Array.isArray(w) ? w : [];
    },
    formatTorrentWarnings(torrent) {
      const warnings = this.getTorrentWarnings(torrent);
      if (!warnings.length) return "";

      const codes = warnings.map((w) => w.code);
      const lowRes = codes.includes("low_res_480");
      const noSeeds = codes.includes("zero_seeds");

      if (lowRes && noSeeds) return "Warning: Low Resolution and No Seeds";
      if (lowRes) return "Warning: Low Resolution";
      if (noSeeds) return "Warning: No Seeds";

      return warnings
        .map((w) => {
          const code = String(w?.code || "").trim();
          const msg = String(w?.message || "").trim();
          if (code && msg && msg.toLowerCase() !== code.toLowerCase())
            return `${code} (${msg})`;
          return code || msg || "";
        })
        .filter(Boolean)
        .join(", ");
    },
    fmtSize(bytesOrHumanString) {
      return util.fmtBytesSize(bytesOrHumanString);
    },
    handleScaledWheel(event) {
      if (!event) return;
      const el = event.currentTarget;
      if (!el) return;
      const dy = event.deltaY || 0;
      const scaledDy = dy * 0.125;
      const max = Math.max(0, (el.scrollHeight || 0) - (el.clientHeight || 0));
      el.scrollTop = Math.max(0, Math.min(max, (el.scrollTop || 0) + scaledDy));
    },

    setTorSearchPhase(phase) {
      this.torSearchPhase = phase;
      this.hasSearched = phase !== "idle";
      this.noTorrentsNeeded = phase === "needed-none";
      this.hasMoreProviders = phase === "all-results";
    },

    resetTorResultsState() {
      this.torrents = [];
      this.mapEpisodes = null;
      this.error = null;
      this.selectedItems = new Set();
      this.lastSelectedIndex = null;
      this.clickedTorrents = new Set();
      this.providerWarning = "";
      this.loading = false;
      this.lastNeeded = null;
      this.groupFilter = null;
      this.showFilter = null;
      this.providerStats = null;
      this.lastRawProviderCounts = null;
      this.lastReturnedProviderCounts = null;
      this.lastApiCount = null;
      this.lastWarningSummary = null;
      this.resultsShowId = null;
      this.flashingTorrent = null;
      this.torSubCountBusy = false;
      this.torSubCountsVisible = false;
      this.torSubCountCache = {};
      this.torSubCountVisibleKeys = {};
      this._didInitialScroll = false;
      this.setTorSearchPhase("idle");
    },

    resolveCurrentShow() {
      if (
        (!this.currentShow || !this.currentShow.name) &&
        this.activeShow?.name
      ) {
        this.currentShow = this.activeShow;
        this.showName = this.activeShow?.name || this.showName;
      }
      return this.currentShow?.name ? this.currentShow : null;
    },

    async handleSearchButtonClick() {
      this.showStream = false;
      if (this.loading || this.unaired) return;

      if (this.previewMode) {
        await this.runFullProviderSearch();
        return;
      }

      switch (this.torSearchPhase) {
        case "idle":
          // A map pane episode list replaces the needed check entirely.
          if (this.mapEpisodes) {
            await this.searchMapEpisodes({
              show: this.currentShow,
              episodes: this.mapEpisodes,
            });
            return;
          }
          await this.runInitialNeededSearch();
          return;
        case "needed-none":
          await this.runForcedIptTlSearch();
          return;
        case "needed-results":
          await this.expandToAllProviders();
          return;
        case "all-results":
          // After a finished map pane episode search, the next click drops that
          // episode list and starts the normal needed / IPT+TL search over.
          if (this.mapEpisodes) {
            this.resetTorResultsState();
            await this.runInitialNeededSearch();
          }
          return;
        default:
          return;
      }
    },

    // Map pane Tor button: search only the episodes selected there. Their
    // seasons restrict the provider query and the list filters the results.
    async searchMapEpisodes({ show, episodes }) {
      if (this.movieMode) return;
      if (!Array.isArray(episodes) || episodes.length === 0) return;
      this.showStream = false;
      this.resetTorResultsState();
      this.unaired = !!show?.S1E1Unaired;
      this.currentShow = show || this.currentShow;
      this.showName = show?.name || this.showName;
      this.lastAutoSearchedShowId = show?.id || show?.name || null;
      this.seasonFilter = "";
      this.mapEpisodes = episodes.slice();
      if (this.unaired) return;

      // Skip the needed check and land in the all-providers state directly.
      // The IPT/TL pass has to run first because the all-providers pass reads
      // its results from the cache that pass writes.
      const iptTlResult = await this.loadTorrents(this.mapEpisodes, false, {
        phaseOverride: "all-results",
      });
      if (!iptTlResult) return;
      const result = await this.loadTorrents(this.mapEpisodes, true, {
        stagedResponse: true,
        preserveVisible: true,
        phaseOverride: "all-results",
      });
      if (result) this.setTorSearchPhase("all-results");
    },

    setTorShow(show) {
      this.resetTorResultsState();
      this.unaired = !!show?.S1E1Unaired;
      this.currentShow = show || null;
      this.showName = show?.name || "";
      this.lastAutoSearchedShowId = show?.id || show?.name || null;

      // No auto-search: the user clicks Search after optionally typing a season.
      // Preview mode has no Search button, so it still searches on its own.
      if (
        this.previewMode &&
        this.filteredTorrents.length === 0 &&
        !this.loading &&
        this.currentShow
      ) {
        void this.handleSearchButtonClick();
      }
    },

    onPaneChanged(pane) {
      if (pane === "tor") {
        // Keep space info fresh whenever Tor pane is shown.
        void this.updateSpaceAvail();

        // No auto-search on pane entry -- wait for the Search button so a season
        // can be typed first. Preview mode has no Search button, so it still runs.
        // Use $nextTick to ensure currentShow is set (in case setTorShow is called after paneChanged)
        this.$nextTick(() => {
          if (
            this.previewMode &&
            this.filteredTorrents.length === 0 &&
            !this.loading &&
            this.currentShow
          ) {
            void this.handleSearchButtonClick();
          }
        });
      }
    },

    openBadGroupsChannel() {
      if (this._badGroupsChannel) return;
      const applyBadGroups = (list) => {
        this.badGroups = new Set(Array.isArray(list) ? list : []);
      };
      this._badGroupsChannel = srvr.openChannel("badGroups", {
        onSnapshot: applyBadGroups,
        onDelta: applyBadGroups,
      });
    },

    closeBadGroupsChannel() {
      this._badGroupsChannel?.close();
      this._badGroupsChannel = null;
    },

    async _checkSeriesMapChanged(show) {
      if (!show || !show.id || show.inEmby === false) return;
      try {
        const fresh = await emby.getSeriesMap(show);
        const freshJson = JSON.stringify(fresh || []);
        if (freshJson !== this._savedSeriesMapJson) {
          this.lastAutoSearchedShowId = null; // allow re-search
          void this.searchTorrents(show);
        }
      } catch {
        /* ignore */
      }
    },

    onRefreshSpaceAvail() {
      void this.updateSpaceAvail();
    },
    openDetails() {
      const url = [...this.selectedItems][0]?.detailUrl;
      if (url) util.openExternalPage(url);
    },

    showError(msg) {
      this.errorModalMsg = String(msg || "");
      this.showErrorModal = true;
    },

    getErrorMessage(err) {
      if (!err) return "Unknown error";
      if (typeof err === "string") return err;
      if (typeof err?.message === "string" && err.message) return err.message;
      if (typeof err?.error === "string" && err.error) return err.error;
      try {
        return JSON.stringify(err);
      } catch {
        return String(err);
      }
    },

    closeErrorModal() {
      this.showErrorModal = false;
      this.errorModalMsg = "";
    },

    showInfo(msg) {
      this.infoModalMsg = String(msg || "");
      this.showInfoModal = true;
    },

    closeInfoModal() {
      this.showInfoModal = false;
      this.infoModalMsg = "";
    },

    closeTorrentInfoModal() {
      this.showTorrentInfoModal = false;
      this.torrentInfoData = null;
    },

    formatTorrentBytes(value) {
      const num = Number(value);
      if (!Number.isFinite(num) || num < 0) return "--";
      if (num === 0) return "0 B";
      const units = ["B", "KB", "MB", "GB", "TB"];
      let size = num;
      let unitIndex = 0;
      while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
      }
      const digits = size >= 100 || unitIndex === 0 ? 0 : size >= 10 ? 1 : 2;
      return `${size.toFixed(digits)} ${units[unitIndex]}`;
    },

    formatTorrentDate(value) {
      const raw = String(value || "").trim();
      if (!raw) return "--";
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) return raw;
      return parsed.toLocaleString();
    },

    confirmExistingDownloads(msg, wrapper) {
      this.existingDeleteModalMsg = String(msg || "");
      this.existingDeleteWrapper =
        wrapper && typeof wrapper === "object" ? wrapper : null;
      this.showExistingDeleteModal = true;
      return new Promise((resolve) => {
        this.existingDeleteResolve = resolve;
      });
    },

    cancelExistingDelete() {
      this.showExistingDeleteModal = false;
      this.existingDeleteModalMsg = "";
      this.existingDeleteWrapper = null;
      const resolve = this.existingDeleteResolve;
      this.existingDeleteResolve = null;
      if (typeof resolve === "function") resolve(false);
    },

    confirmExistingDelete() {
      this.showExistingDeleteModal = false;
      const resolve = this.existingDeleteResolve;
      this.existingDeleteResolve = null;
      if (typeof resolve === "function") resolve(true);
    },

    async deleteProcids(wrapper) {
      const payload = wrapper && typeof wrapper === "object" ? wrapper : null;
      if (!payload) return false;

      const procIds = Array.isArray(payload.procIds)
        ? payload.procIds
        : Array.isArray(payload.procids)
          ? payload.procids
          : Array.isArray(payload.existingProcids)
            ? payload.existingProcids
            : [];

      const merged = Array.from(
        new Set(
          procIds.filter(
            (v) => v !== null && v !== undefined && String(v) !== "",
          ),
        ),
      );
      if (merged.length === 0) return false;

      const url = `${config.tvDownUrl}/deleteProcids`;
      let res;
      try {
        res = await this.fetchWithTimeout(
          url,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ procIds: merged }),
          },
          60000,
        );
      } catch (e) {
        this.showError(e?.message || String(e));
        return false;
      }

      if (!res?.ok) {
        let detail = "";
        try {
          const ct = (res?.headers?.get?.("content-type") || "").toLowerCase();
          if (ct.includes("application/json")) {
            const j = await res.json();
            detail = j?.error
              ? String(j.error)
              : j?.message
                ? String(j.message)
                : JSON.stringify(j);
          } else {
            detail = await res.text();
          }
        } catch {
          // ignore
        }
        this.showError(
          detail ||
            `HTTP ${res?.status || ""}: ${res?.statusText || "delete failed"}`,
        );
        return false;
      }

      return true;
    },
    getScroller() {
      return this.$refs.scroller || null;
    },

    scrollToBottom() {
      const el = this.getScroller();
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    },
    downloadHistoryWindowMs() {
      return 365 * 24 * 60 * 60 * 1000;
    },

    async loadDownloadedHistory() {
      try {
        const res = await fetch(`${config.torrentsApiUrl}/api/tor/sent`);
        if (res.ok) {
          const j = await res.json();
          if (j && typeof j === "object" && !Array.isArray(j)) {
            const entryCount = Object.keys(j).length;
            unilog(1035, `loadDownloadedHistory: loaded ${entryCount} entries`);
            this.downloadedByHash = j;
          }
        }
      } catch (e) {
        unilog(1036, `loadDownloadedHistory: fetch failed:`, e.message);
      }
      this.pruneDownloadedHistory();
    },

    pruneDownloadedHistory() {
      const now = Date.now();
      const cutoff = now - this.downloadHistoryWindowMs();
      const map =
        this.downloadedByHash && typeof this.downloadedByHash === "object"
          ? this.downloadedByHash
          : {};
      const next = {};
      for (const [k, ts] of Object.entries(map)) {
        const t = Number(ts);
        if (Number.isFinite(t) && t >= cutoff) next[k] = t;
      }
      const changed = Object.keys(next).length !== Object.keys(map).length;
      if (changed) {
        const removed = Object.keys(map).length - Object.keys(next).length;
        unilog(
          1037,
          `pruneDownloadedHistory: removed ${removed} old entries (older than 1 year)`,
        );
        this.downloadedByHash = next;
      }
    },

    extractBtih(str) {
      const s = String(str || "");
      if (!s) return "";
      const m =
        /xt=urn:btih:([a-zA-Z0-9]+)/.exec(s) || /btih:([a-zA-Z0-9]+)/.exec(s);
      return m?.[1] ? String(m[1]).toLowerCase() : "";
    },

    getTorrentHash(torrent) {
      const direct =
        torrent?.raw?.infoHash ||
        torrent?.raw?.info_hash ||
        torrent?.raw?.hash ||
        torrent?.hash;
      if (typeof direct === "string" && direct) return direct.toLowerCase();

      const magnet =
        torrent?.raw?.magnet || torrent?.raw?.magnetLink || torrent?.raw?.link;
      if (typeof magnet === "string" && magnet) {
        const h = this.extractBtih(magnet);
        if (h) return h;
      }
      return "";
    },

    buildTorrentUploadFilename(torrent, fallbackTitle) {
      // qBittorrent's "watched folder" can miss modified/overwritten files.
      // Ensure each upload writes a *new* file by suffixing a stable unique token.
      const baseIn = String(
        torrent?.raw?.filename ||
          fallbackTitle ||
          torrent?.raw?.title ||
          torrent?.title ||
          "download",
      ).trim();
      const hash = this.getTorrentHash(torrent);
      const suffix = hash
        ? hash.slice(0, 10)
        : `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

      // Windows-safe filename (server may run on Windows and write to disk).
      let base = baseIn
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/[\u0000-\u001f]/g, "")
        .replace(/\s+/g, " ")
        .trim();

      // Remove extension so we can control it.
      base = base.replace(/\.torrent$/i, "");
      if (!base) base = "download";

      // Keep filenames reasonably short to avoid filesystem/path limits.
      const maxBaseLen = 150;
      if (base.length > maxBaseLen) base = base.slice(0, maxBaseLen).trim();

      return `${base}-${suffix}.torrent`;
    },

    getTorrentHistoryKey(torrent) {
      // Prefer hash; fall back to the title (as-is).
      const hash = this.getTorrentHash(torrent);
      if (hash) return hash;

      const title = torrent?.raw?.title || torrent?.title || "";
      const titleStr = typeof title === "string" ? title : String(title || "");
      const provider = String(torrent?.raw?.provider || "")
        .trim()
        .toLowerCase();

      // Titles can collide across providers (IPT/TL). Include provider in the identity.
      return provider ? `${titleStr}::${provider}` : titleStr;
    },

    getTorrentHistoryKeys(torrent) {
      const keys = [];
      const add = (k) => {
        const s = String(k || "");
        if (!s) return;
        if (!keys.includes(s)) keys.push(s);
      };

      const hash = this.getTorrentHash(torrent);
      if (hash) add(hash);

      const titleRaw = torrent?.raw?.title || torrent?.title || "";
      const titleStr =
        typeof titleRaw === "string" ? titleRaw : String(titleRaw || "");
      const titleTrim = titleStr.trim();
      const provider = String(torrent?.raw?.provider || "")
        .trim()
        .toLowerCase();

      // Legacy keys (historically stored as-is).
      if (provider) add(`${titleStr}::${provider}`);
      add(titleStr);

      // Normalized variants (fixes missing history icons when titles differ only by
      // punctuation/separators/case/whitespace or when provider field is missing).
      const norm = this.normalizeQbtNameForMatch(titleTrim);
      if (provider && norm) add(`${norm}::${provider}`);
      if (provider && titleTrim) add(`${titleTrim}::${provider}`);
      if (titleTrim) add(titleTrim);
      if (norm) add(norm);

      return keys;
    },

    getTorrentNowKey(torrent) {
      // Key used for "downloaded now" highlighting. Must disambiguate identical titles across providers.
      return this.getTorrentHistoryKey(torrent);
    },

    getTorrentIdentityKey(torrent) {
      const historyKey = this.getTorrentHistoryKey(torrent);
      const detailUrl = String(
        torrent?.detailUrl || torrent?.raw?.desc || "",
      ).trim();
      const seeds = Number(torrent?.raw?.seeds);
      const size = String(torrent?.raw?.size || "").trim();
      return `${historyKey}|${detailUrl}|${Number.isFinite(seeds) ? seeds : ""}|${size}`;
    },

    getTorrentCardKey(torrent) {
      return this.getTorrentIdentityKey(torrent);
    },

    reconcileVisibleTorrents(nextTorrents) {
      const existing = Array.isArray(this.torrents) ? this.torrents : [];
      const incoming = Array.isArray(nextTorrents) ? nextTorrents : [];
      const existingByKey = new Map(
        existing.map((torrent) => [
          this.getTorrentIdentityKey(torrent),
          torrent,
        ]),
      );

      const merged = incoming.map((torrent) => {
        const key = this.getTorrentIdentityKey(torrent);
        const current = existingByKey.get(key);
        if (!current) return torrent;

        for (const prop of Object.keys(current)) {
          if (!(prop in torrent)) delete current[prop];
        }
        Object.assign(current, torrent);
        return current;
      });

      const visibleSet = new Set(merged);
      this.torrents = merged;
      this.selectedItems = new Set(
        [...this.selectedItems].filter((torrent) => visibleSet.has(torrent)),
      );
      this.clickedTorrents = new Set(
        [...this.clickedTorrents].filter((torrent) => visibleSet.has(torrent)),
      );
      if (this.flashingTorrent && !visibleSet.has(this.flashingTorrent)) {
        this.flashingTorrent = null;
      }

      const firstSelected = [...this.selectedItems][0] || null;
      this.lastSelectedIndex = firstSelected
        ? this.filteredTorrents.indexOf(firstSelected)
        : null;
    },

    torrentIsHevc(torrent) {
      return isHevc(String(torrent?.raw?.title || torrent?.title || ""));
    },

    getDisplayTitleWithProvider(torrent) {
      const title = String(torrent?.raw?.title || torrent?.title || "").trim();
      return this.torrentIsHevc(torrent) ? `${title} (hevc)` : title;
    },

    rememberDownloadedTorrent(torrent) {
      const keys = this.getTorrentHistoryKeys(torrent);
      if (!keys.length) return;
      const now = Date.now();
      const map =
        this.downloadedByHash && typeof this.downloadedByHash === "object"
          ? this.downloadedByHash
          : {};
      // Reassign for reliable reactivity.
      const next = { ...map };
      for (const k of keys) next[k] = now;
      this.downloadedByHash = next;
      this.pruneDownloadedHistory();

      // Log to track "Sent recently" state changes
      const torTitle = String(
        torrent?.raw?.title || torrent?.title || "",
      ).trim();
      unilog(
        1038,
        `rememberDownloadedTorrent: "${torTitle}" | keys:`,
        keys.length,
        "| timestamp:",
        now,
      );

      // Persist to server.
      fetch(`${config.torrentsApiUrl}/api/tor/sent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys }),
      }).catch(() => {});
    },

    isDownloadedBefore(torrent) {
      const keys = this.getTorrentHistoryKeys(torrent);
      if (!keys.length) return false;
      const cutoff = Date.now() - this.downloadHistoryWindowMs();
      for (const k of keys) {
        const ts = Number(this.downloadedByHash?.[k]);
        if (Number.isFinite(ts) && ts >= cutoff) {
          return true;
        }
      }
      return false;
    },

    getDownloadedBeforeIconStyle(torrent) {
      const right = this.isClicked(torrent) ? 32 : 8;
      return {
        position: "absolute",
        top: "10px",
        right: `${right}px`,
        color: "#888",
        fontSize: "16px",
      };
    },
    resetPane() {
      this.resetTorResultsState();
      this.showModal = false;
      this.showName = "";
      this.currentShow = null;
      this.showCookieInputs = false;
      this.dismissCookieInputs = false;
      this.unaired = false;
      this.iptCfClearance = "";
      this.tlCfClearance = "";

      this.lastAutoSearchedShowId = null;
    },

    handleClose() {
      // Do not reset pane state on close.
      this.$emit("close");
    },

    async getSpaceAvail() {
      const url = new URL(`${config.torrentsApiUrl}/api/space/avail`);
      const res = await fetch(url.toString());
      if (!res.ok) {
        let detail = "";
        try {
          const ct = res.headers.get("content-type") || "";
          if (ct.includes("application/json")) {
            const j = await res.json();
            detail = j?.error ? String(j.error) : JSON.stringify(j);
          } else {
            detail = await res.text();
          }
        } catch {
          // ignore parse errors
        }
        throw new Error(`HTTP ${res.status}: ${detail || res.statusText}`);
      }
      return res.json();
    },

    async getSpaceUsb() {
      const url = new URL(`${config.torrentsApiUrl}/api/space/usb`);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },

    async getSpaceSrvr() {
      const url = new URL(`${config.torrentsApiUrl}/api/space/srvr`);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },

    pctUsed(total, used) {
      const t = Number(total);
      const u = Number(used);
      if (!Number.isFinite(t) || !Number.isFinite(u) || t <= 0) return "--%";
      const pct = Math.ceil((u / t) * 100);
      return `${Math.max(0, Math.min(100, pct))}%`;
    },

    pctAvail(total, used) {
      const t = Number(total);
      const u = Number(used);
      if (!Number.isFinite(t) || !Number.isFinite(u) || t <= 0) return "--%";
      const avail = Math.max(0, t - u);
      const pct = Math.floor((avail / t) * 100);
      return `${Math.max(0, Math.min(100, pct))}%`;
    },

    fmtAvailGb(total, used) {
      const t = Number(total);
      const u = Number(used);
      if (!Number.isFinite(t) || !Number.isFinite(u) || t <= 0) return "--";
      const avail = Math.max(0, t - u);
      // df-style GB: df reports 1K-blocks; dividing by 1e6 yields “GB”.
      // Our API returns bytes, so bytes / 1_024_000_000 matches that convention.
      return String(Math.round(avail / 1_024_000_000));
    },

    async updateSpaceAvail() {
      const hasAnyDigits = (txt) => /\d/.test(String(txt || ""));

      const applyUsb = (s) => {
        const t = Number(s?.usbSpaceTotal);
        const u = Number(s?.usbSpaceUsed);
        // total <= 0 means the probe failed server-side (ssh/quota error) —
        // keep whatever was last displayed rather than flashing "--".
        if (Number.isFinite(t) && Number.isFinite(u) && t > 0) {
          this.spaceUsbPct = this.pctAvail(t, u);
          this.spaceUsbGb = this.fmtAvailGb(t, u);
        }
      };

      const applySrvr = (s) => {
        if (
          Number.isFinite(Number(s?.mediaSpaceTotal)) &&
          Number.isFinite(Number(s?.mediaSpaceUsed))
        ) {
          this.spaceSrvrPct = this.pctAvail(
            s.mediaSpaceTotal,
            s.mediaSpaceUsed,
          );
          this.spaceSrvrGb = this.fmtAvailGb(
            s.mediaSpaceTotal,
            s.mediaSpaceUsed,
          );
        }
      };

      const usbPromise = this.getSpaceUsb()
        .then(applyUsb)
        .catch(() => {
          if (!hasAnyDigits(this.spaceUsbGb)) this.spaceUsbGb = "???";
          if (!hasAnyDigits(this.spaceUsbPct)) this.spaceUsbPct = "???%";
        });

      const srvrPromise = this.getSpaceSrvr()
        .then(applySrvr)
        .catch(() => {
          if (!hasAnyDigits(this.spaceSrvrGb)) this.spaceSrvrGb = "???";
          if (!hasAnyDigits(this.spaceSrvrPct)) this.spaceSrvrPct = "???%";
        });

      await Promise.all([usbPromise, srvrPromise]);
    },

    saveCookies() {
      // Save only; do not start any torrent loading.
      const iptCf = this.extractCfClearance(this.iptCfClearance);
      const tlCf = this.extractCfClearance(this.tlCfClearance);

      // Also persist to local torrents server so Node/Playwright tools can use it.
      // Best-effort; ignore errors.
      try {
        void fetch(`${config.torrentsApiUrl}/api/cf_clearance`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ipt_cf: iptCf || "",
            tl_cf: tlCf || "",
          }),
        });
      } catch {
        // ignore
      }

      // Always close the inputs when clicked, even if empty.
      this.showCookieInputs = false;
      this.dismissCookieInputs = true;

      // Don't retain potentially-stale values in UI state.
      this.iptCfClearance = "";
      this.tlCfClearance = "";
    },

    toggleCookieInputs() {
      this.dismissCookieInputs = false;
      this.showCookieInputs = !this.showCookieInputs;
    },

    onOpenStream(show) {
      this.currentShow = show;
      this.showStream = true;
    },

    handleMapButton() {
      const show = this.currentShow;
      if (show) {
        evtBus.emit("mapAction", { action: "open", show });
      }
    },

    async searchTorrents(show) {
      // Track this show so onPaneChanged doesn't re-trigger when switching panes.
      this.lastAutoSearchedShowId = show?.id || show?.name || null;

      // Reset state when switching shows
      this.resetTorResultsState();
      this.dismissCookieInputs = false;

      // Kick off space fetch ASAP; don't wait for torrent searching.
      void this.updateSpaceAvail();

      this.unaired = !!show?.S1E1Unaired;
      if (this.unaired) {
        // Short-circuit: show only the unaired message
        this.currentShow = show;
        this.showName = show?.name || "";
        return;
      }

      // (space fetch already started above)

      // Store the show for later use with Load button
      this.currentShow = show;
      if (show && show.name) {
        this.showName = show.name;
      }
    },

    async movieSearchEnter() {
      const q = this.movieSrchText.trim();
      if (!q) return;
      this.currentShow = { name: q };
      this.showName = q;
      this.torrents = [];
      this.setTorSearchPhase("idle");
      const result = await this.loadTorrents([], false, {
        phaseOverride: "all-results",
      });
      if (result) this.setTorSearchPhase("all-results");
    },

    async runInitialNeededSearch() {
      this.mapEpisodes = null;
      const currentShow = this.resolveCurrentShow();
      if (!currentShow) {
        this.error = "No show selected";
        return;
      }

      if (this.unaired) {
        return;
      }

      // Reset so a fresh first search is always performed
      this.lastNeeded = null;

      this.providerWarning = "";

      // With a season typed the search is for that season, not for what's
      // needed, so search even when nothing is needed.
      if (this.seasonSearchNum !== null) {
        const seasonResult = await this.loadTorrents(["force"], false, {
          phaseOverride: "needed-results",
        });
        if (seasonResult) this.setTorSearchPhase("needed-results");
        return;
      }

      if (!Array.isArray(this.lastNeeded)) {
        try {
          this.lastNeeded = await this.calculateNeeded(currentShow);
        } catch {
          this.lastNeeded = [];
        }
      }

      if (Array.isArray(this.lastNeeded) && this.lastNeeded.length === 0) {
        this.setTorSearchPhase("needed-none");
        return;
      }

      const result = await this.loadTorrents(this.lastNeeded || [], false, {
        phaseOverride: "needed-results",
      });
      if (result) this.setTorSearchPhase("needed-results");
    },

    async runForcedIptTlSearch() {
      this.mapEpisodes = null;
      const currentShow = this.resolveCurrentShow();
      if (!currentShow) {
        this.error = "No show selected";
        return;
      }
      if (this.unaired) return;

      this.providerWarning = "";
      const result = await this.loadTorrents(["force"], false, {
        phaseOverride: "needed-results",
      });
      if (result) this.setTorSearchPhase("needed-results");
    },

    async runFullProviderSearch() {
      this.mapEpisodes = null;
      const currentShow = this.resolveCurrentShow();
      if (!currentShow) {
        this.error = "No show selected";
        return;
      }
      if (this.unaired) return;

      this.providerWarning = "";
      const result = await this.loadTorrents(["force"], true, {
        phaseOverride: "all-results",
      });
      if (result) this.setTorSearchPhase("all-results");
    },

    async expandToAllProviders() {
      const currentShow = this.resolveCurrentShow();
      if (!currentShow) {
        this.error = "No show selected";
        return;
      }
      if (this.unaired) return;

      this.providerWarning = "";
      const result = await this.loadTorrents(
        this.mapEpisodes || ["force"],
        true,
        {
          stagedResponse: true,
          preserveVisible: true,
          phaseOverride: "all-results",
        },
      );
      if (result) this.setTorSearchPhase("all-results");
    },

    async searchClick() {
      return this.runInitialNeededSearch();
    },

    async forceClick() {
      return this.runForcedIptTlSearch();
    },

    openTorTabs() {
      const name = String(this.currentShow?.name || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\([^)]+\)\s*$/, "")
        .replace(/[?.]+\s*$/g, "")
        .trim();
      const searchQ = encodeURIComponent(name);
      const eztQ = name.replace(/\s+/g, "+");
      const urls = [
        `https://thepiratebay.org/search.php?q=${searchQ}&cat=205`,
        `https://www.limetorrents.lol/search/tv/${searchQ}/`,
        `https://eztvx.to/search/${eztQ}`,
        `https://iptorrents.com/tv?q=${searchQ}`,
        `https://www.torrentleech.org/torrents/browse/index/query/${searchQ}`,
      ];
      for (const url of urls) {
        openExternalBlank(url);
      }
    },

    async calculateNeeded(show) {
      const needed = [];

      // If not in Emby, return special marker
      if (!show || !show.id || show.inEmby === false) {
        return ["noemby"];
      }

      try {
        // Get series map (same way as list.vue does)
        const seriesMapIn = await emby.getSeriesMap(show);
        this._savedSeriesMapJson = JSON.stringify(seriesMapIn || []);
        if (!seriesMapIn || seriesMapIn.length === 0) {
          return needed;
        }

        // (debug logging removed)

        // Build seriesMap object from array
        const seriesMap = util.buildSeriesMap(seriesMapIn);
        if (!seriesMap) {
          return needed;
        }

        // Scan for needed episodes
        let hasStartedWatching = false;

        // Check if ANY episode in the entire series has been watched
        const anyEpisodeWatched = Object.values(seriesMap).some((episodes) =>
          Object.values(episodes).some((epiObj) => epiObj.played),
        );

        // If nothing watched, start collecting from first episode with no file
        if (!anyEpisodeWatched) {
          hasStartedWatching = true;
        }

        for (const [seasonNumStr, episodes] of Object.entries(seriesMap)) {
          const seasonNum = parseInt(seasonNumStr);
          if (isNaN(seasonNum)) continue;

          // Check if season has any episodes with state
          const seasonHasState = Object.values(episodes).some((epiObj) => {
            const { played, noFile, unaired, avail, deleted, error } = epiObj;
            return played || noFile || unaired || avail || deleted || error;
          });

          // Skip this entire season if no episodes have any state
          if (!seasonHasState) {
            continue;
          }

          const seasonNeeded = [];
          let allNeeded = true;
          let hasUnaired = false;
          let hasNoFile = false;

          // First pass: check if season has both unaired AND no file episodes
          for (const [episodeNumStr, epiObj] of Object.entries(episodes)) {
            const episodeNum = parseInt(episodeNumStr);
            if (isNaN(episodeNum)) continue;

            const { noFile, unaired } = epiObj;
            if (unaired) hasUnaired = true;
            if (noFile) hasNoFile = true;
          }

          // Determine if we should include individual episodes for this season
          const includeIndividualEpisodes = hasUnaired && hasNoFile;

          for (const [episodeNumStr, epiObj] of Object.entries(episodes)) {
            const episodeNum = parseInt(episodeNumStr);
            if (isNaN(episodeNum)) continue;

            const { played, noFile, unaired } = epiObj;

            // Stop if we hit an unaired episode (unless this season needs individual episodes)
            if (unaired) {
              // Process any accumulated season if any episodes were needed
              if (seasonNeeded.length > 0) {
                if (includeIndividualEpisodes) {
                  // Include all individual episodes for this season
                  seasonNeeded.forEach((ep) => needed.push(ep));
                } else if (allNeeded) {
                  needed.push(`S${seasonNum.toString().padStart(2, "0")}`);
                } else {
                  needed.push(`S${seasonNum.toString().padStart(2, "0")}`);
                  seasonNeeded.forEach((ep) => needed.push(ep));
                }
              }
              return needed; // Stop scanning
            }

            // Track if we've started watching
            if (played) {
              hasStartedWatching = true;
            }

            // Episode is needed if: started watching AND not played AND no file
            const isNeeded = hasStartedWatching && !played && noFile;

            if (isNeeded) {
              const epStr = `S${seasonNum.toString().padStart(2, "0")}E${episodeNum.toString().padStart(2, "0")}`;
              seasonNeeded.push(epStr);
            } else {
              allNeeded = false;
            }
          }

          // Add season if any episodes were needed
          if (seasonNeeded.length > 0 && hasStartedWatching) {
            if (includeIndividualEpisodes) {
              // Include all individual episodes (no season marker)
              seasonNeeded.forEach((ep) => needed.push(ep));
            } else if (allNeeded) {
              // All episodes in season are needed - just add season
              needed.push(`S${seasonNum.toString().padStart(2, "0")}`);
            } else {
              // Some episodes needed - add season AND individual episodes
              needed.push(`S${seasonNum.toString().padStart(2, "0")}`);
              seasonNeeded.forEach((ep) => needed.push(ep));
            }
          }
        }
      } catch (err) {}
      return needed;
    },

    extractCfClearance(input) {
      // Accept formats:
      // 1. cf_clearance:"value"
      // 2. cf_clearance: "value"
      // 3. "value"
      // 4. value
      if (!input) return "";

      const trimmed = input.trim();

      // Check for cf_clearance:"..." or cf_clearance: "..." format
      const match = trimmed.match(/^cf_clearance\s*:\s*"(.+)"$/);
      if (match) {
        return match[1];
      }

      // Check for quoted value
      if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.slice(1, -1);
      }

      // Return as-is
      return trimmed;
    },

    async loadTorrents(needed = [], more = false, options = {}) {
      if (!this.currentShow || !this.currentShow.name) {
        this.error = "No show selected";
        return null;
      }

      let url = "";
      let finalPayload = null;
      const {
        stagedResponse = false,
        preserveVisible = false,
        phaseOverride = null,
      } = options;

      this.loading = true;
      this.error = null;
      this.providerWarning = "";
      if (!more && !preserveVisible) {
        this.torrents = [];
      }

      // Reset more-providers state on each new load
      this.hasMoreProviders = false;
      if (!more && !preserveVisible) {
        this.providerStats = null;
      }

      // Reset debug metadata for this request
      this.lastRawProviderCounts = null;
      this.lastReturnedProviderCounts = null;
      this.lastApiCount = null;
      this.lastWarningSummary = null;

      try {
        // Some shows include trailing punctuation (e.g. "Can You Keep a Secret?")
        // that can hurt provider matching. For torrent searching, strip trailing ?/.
        const rawShowName = String(this.currentShow.name || "").trim();
        const showNameForSearch = rawShowName.replace(/[?.]+\s*$/g, "").trim();

        url = `${config.torrentsApiUrl}/api/search?show=${encodeURIComponent(showNameForSearch)}&limit=${this.maxResults}`;
        const showTvdbId = String(
          this.currentShow.tvdbId || this.currentShow.tvdbId || "",
        ).trim();
        if (showTvdbId) {
          url += `&tvdbId=${encodeURIComponent(showTvdbId)}`;
        }
        if (needed.length > 0) {
          url += `&needed=${encodeURIComponent(JSON.stringify(needed))}`;
        }
        if (this.mapSeasonsParam !== null) {
          url += `&season=${this.mapSeasonsParam}`;
        } else if (this.seasonSearchNum !== null) {
          url += `&season=${this.seasonSearchNum}`;
        }
        if (more) {
          url += `&more=true`;
        }
        if (stagedResponse) {
          url += `&staged=true`;
        }
        if (this.movieMode) {
          url += `&category=movie&more=true`;
        }

        // Debug info
        this.lastSearchUrl = url;
        this.lastSearchShow = showNameForSearch;
        this.lastSearchNeeded = Array.isArray(needed)
          ? JSON.stringify(needed)
          : String(needed);

        // Return cached result if available
        if (!stagedResponse && this.torSearchCache.has(url)) {
          const cached = this.torSearchCache.get(url);
          this.reconcileVisibleTorrents(cached.torrents);
          this.providerStats = cached.providerStats
            ? { ...cached.providerStats }
            : null;
          this.lastNeeded = cached.lastNeeded;
          this.setTorSearchPhase(cached.torSearchPhase || "needed-results");
          this._didInitialScroll = true;
          this.$nextTick(() => {
            const el = this.$refs.scroller;
            if (el) el.scrollTop = 0;
          });
          return { data: cached, torrents: cached.torrents.slice() };
        }

        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // Debug info from response
        this.lastApiCount = typeof data?.count === "number" ? data.count : null;
        this.lastWarningSummary =
          data && typeof data.warningSummary === "object"
            ? data.warningSummary
            : null;

        const iptTlTorrents = Array.isArray(data?.iptTlTorrents)
          ? data.iptTlTorrents
          : [];
        const extraProviderTorrents = Array.isArray(data?.extraProviderTorrents)
          ? data.extraProviderTorrents
          : [];
        const responseTorrents = stagedResponse
          ? [...iptTlTorrents, ...extraProviderTorrents]
          : data.torrents || [];

        // Set torrents first; some server versions may omit rawProviderCounts.
        if (stagedResponse) {
          this.reconcileVisibleTorrents(responseTorrents);
        } else {
          this.reconcileVisibleTorrents(responseTorrents);
        }
        if (!more && !preserveVisible) {
          this._didInitialScroll = true;
          this.$nextTick(() => {
            const el = this.$refs.scroller;
            if (el) el.scrollTop = 0;
          });
        }

        // Store more-providers state and per-provider stats from response
        this.hasMoreProviders = Boolean(data?.hasMoreProviders);
        if (data?.tpbError) {
          this.providerWarning = this.providerWarning
            ? `${this.providerWarning}\n\nTPB unavailable: apibay.org returned an error (likely down or blocking this server).`
            : "TPB unavailable: apibay.org returned an error (likely down or blocking this server).";
        }
        if (
          data?.providerStats &&
          typeof data.providerStats === "object" &&
          Object.keys(data.providerStats).length > 0
        ) {
          // Merge with existing stats (preserves TL/IPT when loading more providers)
          this.providerStats = Object.assign(
            {},
            this.providerStats || {},
            data.providerStats,
          );
        } else if (!more) {
          this.providerStats = null;
        }
        this.resultsShowId = this.currentShow?.id || null;
        const activeTorrents = Array.isArray(this.torrents)
          ? this.torrents
          : responseTorrents;

        // (debug logging removed)

        // Provider hit counts.
        // Prefer backend-reported rawProviderCounts when present, but fall back to deriving counts from
        // returned torrents because some server versions omit rawProviderCounts.
        const counts =
          data && typeof data.rawProviderCounts === "object"
            ? data.rawProviderCounts || {}
            : {};
        this.lastRawProviderCounts =
          Object.keys(counts).length > 0 ? counts : null;

        const toCount = (v) => {
          const n = Number(v);
          return Number.isFinite(n) ? n : 0;
        };

        const iptCountFromApi = toCount(
          counts.IpTorrents ??
            counts.IPTorrents ??
            counts.iptorrents ??
            counts.ipt ??
            counts.IPT ??
            counts.Iptorrents ??
            0,
        );
        const tlCountFromApi = toCount(
          counts.TorrentLeech ??
            counts.torrentleech ??
            counts.TL ??
            counts.tl ??
            counts.TorrentLeach ??
            0,
        );

        let iptCount = iptCountFromApi;
        let tlCount = tlCountFromApi;

        // Fallback: infer from returned torrents if counts were not provided.
        if (
          iptCount + tlCount === 0 &&
          Array.isArray(activeTorrents) &&
          activeTorrents.length > 0
        ) {
          for (const t of activeTorrents) {
            const providerRaw = String(
              t?.raw?.provider || t?.provider || "",
            ).toLowerCase();
            if (!providerRaw) continue;
            if (providerRaw.includes("torrentleech") || providerRaw === "tl") {
              tlCount += 1;
            } else if (
              providerRaw.includes("iptorrents") ||
              providerRaw === "ipt" ||
              providerRaw.includes("ipt")
            ) {
              iptCount += 1;
            }
          }

          // When we infer counts, populate the debug display so it's obvious what happened.
          this.lastRawProviderCounts = {
            inferred: true,
            IpTorrents: iptCount,
            TorrentLeech: tlCount,
          };
        }

        // If the backend reports raw provider hits but returns none, call it out explicitly.
        // This typically means results exist on IPT/TL but were filtered out server-side
        // (commonly because all hits have 0 seeds, or title parsing/matching rejected them).
        if (
          Array.isArray(activeTorrents) &&
          activeTorrents.length === 0 &&
          (iptCount > 0 || tlCount > 0)
        ) {
          const parts = [];
          if (iptCount > 0) parts.push(`IPTorrents: ${iptCount}`);
          if (tlCount > 0) parts.push(`TorrentLeech: ${tlCount}`);
          this.providerWarning = `Providers reported hits (${parts.join(", ")}), but none were returned. This is usually because all hits were filtered out (often 0 seeds) or title matching failed. Try Force, or check the provider site directly.`;
        }

        // Returned-per-provider counts (what the user actually sees in the list).
        const inferProvider = (torrent) => {
          const providerRaw = String(
            torrent?.raw?.provider || torrent?.provider || "",
          ).toLowerCase();
          const detailUrlLower = String(
            torrent?.detailUrl || torrent?.raw?.desc || "",
          ).toLowerCase();
          if (
            providerRaw.includes("torrentleech") ||
            detailUrlLower.includes("torrentleech") ||
            providerRaw === "tl"
          )
            return "torrentleech";
          if (
            providerRaw.includes("iptorrents") ||
            detailUrlLower.includes("iptorrents") ||
            providerRaw === "ipt"
          )
            return "iptorrents";
          return providerRaw || "unknown";
        };

        const returnedCounts = { iptorrents: 0, torrentleech: 0, unknown: 0 };
        if (Array.isArray(activeTorrents)) {
          for (const t of activeTorrents) {
            const p = inferProvider(t);
            if (p === "iptorrents") returnedCounts.iptorrents += 1;
            else if (p === "torrentleech") returnedCounts.torrentleech += 1;
            else returnedCounts.unknown += 1;
          }
        }
        this.lastReturnedProviderCounts = returnedCounts;

        // If exactly one provider returned results and the other returned none, show a cookie warning.
        const iptReturned = returnedCounts.iptorrents;
        const tlReturned = returnedCounts.torrentleech;
        const iptZero = iptReturned === 0;
        const tlZero = tlReturned === 0;
        const iptHas = iptReturned > 0;
        const tlHas = tlReturned > 0;

        if (
          Array.isArray(activeTorrents) &&
          activeTorrents.length > 0 &&
          ((iptHas && tlZero) || (tlHas && iptZero))
        ) {
          const missing = [];
          if (iptZero) missing.push("IPTorrents");
          if (tlZero) missing.push("TorrentLeech");
          const cookieWarning = `Warning: No results from ${missing.join(" and ")}. Check cookies for that provider.`;

          this.providerWarning = this.providerWarning
            ? `${this.providerWarning}\n\n${cookieWarning}`
            : cookieWarning;
        }

        finalPayload = {
          data,
          torrents: activeTorrents.slice(),
          phase: phaseOverride || this.torSearchPhase,
        };
        return finalPayload;
      } catch (err) {
        // Handle both Error objects and rejected promise values
        const errorMessage =
          err?.message ||
          err?.result ||
          err?.error ||
          (typeof err === "string" ? err : JSON.stringify(err));
        this.error = errorMessage;
        return null;
      } finally {
        this.loading = false;

        // Cache results by search URL
        if (
          url &&
          finalPayload &&
          finalPayload.torrents.length > 0 &&
          !stagedResponse
        ) {
          this.torSearchCache.set(url, {
            torrents: finalPayload.torrents.slice(),
            providerStats: this.providerStats
              ? { ...this.providerStats }
              : null,
            hasMoreProviders: this.hasMoreProviders,
            lastNeeded: this.lastNeeded,
            torSearchPhase: finalPayload.phase,
          });
        }

        // Cache results by show key for later reuse
        const _previewCacheKey = String(
          this.currentShow?.tvdbId || this.currentShow?.name || "",
        );
        if (
          _previewCacheKey &&
          finalPayload &&
          finalPayload.torrents.length > 0
        ) {
          this.previewTorCache.set(_previewCacheKey, {
            torrents: finalPayload.torrents.slice(),
            providerStats: this.providerStats
              ? { ...this.providerStats }
              : null,
            hasMoreProviders: this.hasMoreProviders,
            lastNeeded: this.lastNeeded,
            providerWarning: this.providerWarning || "",
            lastRawProviderCounts: this.lastRawProviderCounts || null,
            lastReturnedProviderCounts: this.lastReturnedProviderCounts || null,
            lastApiCount: this.lastApiCount ?? null,
            lastWarningSummary: this.lastWarningSummary || null,
            torSearchPhase: finalPayload.phase,
          });
        }
      }
    },

    async forceLoadTorrents() {
      // Force load all torrents by sending 'force' marker
      const result = await this.loadTorrents(["force"], false, {
        phaseOverride: "needed-results",
      });
      if (result) this.setTorSearchPhase("needed-results");
    },

    handleTorrentClick(event, torrent) {
      // Preview mode: no selection, no ctrl-click, always open browser tab
      if (this.previewMode) {
        const isCtrlClick = Boolean(event?.ctrlKey || event?.metaKey);
        if (isCtrlClick) return;
        if (torrent.detailUrl) {
          this.clickedTorrents.add(torrent);
          util.openExternalPage(torrent.detailUrl);
        }
        return;
      }

      const isAltClick = Boolean(event?.altKey);
      const isCtrlClick = Boolean(event?.ctrlKey || event?.metaKey);
      const isShiftClick = Boolean(event?.shiftKey);

      // Alt-click copies raw torrent title to clipboard (bash-quoted if needed).
      if (isAltClick) {
        const title = util.shellQuote(torrent.raw?.title ?? "");
        navigator.clipboard.writeText(title).catch(() => {});
        this.flashingTorrent = torrent;
        setTimeout(() => {
          this.flashingTorrent = null;
        }, 300);
        return;
      }

      const idx = this.filteredTorrents.indexOf(torrent);

      if (isShiftClick && this.lastSelectedIndex !== null) {
        event.preventDefault(); // prevent browser text selection on shift-click
        // Range-select from lastSelectedIndex to idx
        const lo = Math.min(this.lastSelectedIndex, idx);
        const hi = Math.max(this.lastSelectedIndex, idx);
        for (let i = lo; i <= hi; i++) {
          this.selectedItems.add(this.filteredTorrents[i]);
          this.clickedTorrents.add(this.filteredTorrents[i]);
        }
      } else if (isCtrlClick) {
        // Toggle clicked item
        if (this.selectedItems.has(torrent)) {
          this.selectedItems.delete(torrent);
        } else {
          this.selectedItems.add(torrent);
          this.clickedTorrents.add(torrent);
        }
        this.lastSelectedIndex = idx;
      } else {
        // Plain click: single-select
        this.selectedItems.clear();
        this.selectedItems.add(torrent);
        this.clickedTorrents.add(torrent);
        this.lastSelectedIndex = idx;
      }
      // Trigger reactivity for the Set
      this.selectedItems = new Set(this.selectedItems);
    },

    isClicked(torrent) {
      return this.clickedTorrents.has(torrent);
    },

    getCardStyle(torrent) {
      const isSelected = !this.previewMode && this.selectedItems.has(torrent);
      const isDownloaded = this.isDownloadedNow(torrent);
      const hasWarnings = this.getTorrentWarnings(torrent).length > 0;
      const isFlashing = this.flashingTorrent === torrent;
      let bgColor = "#fff";
      if (isFlashing) {
        bgColor = "#ffcccc"; // Flash on alt-click copy
      } else if (isSelected) {
        bgColor = "#fffacd"; // Light yellow for selected (takes priority)
      } else if (hasWarnings) {
        bgColor = "#fff0f0"; // Light red/pink for warnings
      }
      return {
        padding: "10px",
        background: bgColor,
        borderRadius: "5px",
        border: "1px solid #ddd",
        cursor: "pointer",
        transition: "all 0.2s",
        position: "relative",
      };
    },

    isDownloadedNow(torrent) {
      const key = this.getTorrentNowKey(torrent);
      if (!key) return false;
      return this.downloadedTorrents.has(key);
    },

    showDownloadModal() {
      this.showModal = true;
    },

    cancelDownload() {
      this.showModal = false;
      // Keep card selected
    },

    continueDownload() {
      // Keep the existing template bindings, but route through the queue.
      this.showModal = false;
      const first = [...this.selectedItems][0];
      void this.enqueueDownload(first);
    },

    statusKeyForTorrent(torrent) {
      return (
        this.getTorrentHistoryKey(torrent) ||
        this.getTorrentCardKey(torrent, 0) ||
        ""
      );
    },

    getTorSubCountKey(torrent) {
      return this.statusKeyForTorrent(torrent);
    },

    getTorSubSummary(torrent) {
      const key = this.getTorSubCountKey(torrent);
      if (
        !key ||
        !this.torSubCountsVisible ||
        !this.torSubCountVisibleKeys[key]
      ) {
        return "";
      }

      const entry = this.torSubCountCache?.[key] || null;
      if (!entry) return "";
      const parts = [];
      const providerSubs = entry.providerSubs || null;
      if (providerSubs?.status) {
        parts.push(`Provider subs: ${providerSubs.status}`);
      }
      if (entry.message) parts.push(String(entry.message));
      else if (entry.error) parts.push(`OpenSubs err: ${String(entry.error)}`);
      else parts.push(`OpenSubs: ${entry.count || 0}`);
      return parts.length ? ` | ${parts.join(" | ")}` : "";
    },

    getDownloadStatus(torrent) {
      const key = this.statusKeyForTorrent(torrent);
      if (!key) return null;
      return this.downloadStatus?.[key] || null;
    },

    getDownloadStatusLabel(torrent) {
      const st = this.getDownloadStatus(torrent);
      if (!st) return "";
      const s = String(st.status || "");
      if (s === "queued") return "Queued";
      if (s === "sending") return "Sending…";
      if (s === "ok") return "OK";
      if (s === "warn") return "Sent (verify pending)";
      if (s === "error") return "Error";
      return s;
    },

    setDownloadStatus(torrent, status, message) {
      const key = this.statusKeyForTorrent(torrent);
      if (!key) return;
      const next = {
        ...(this.downloadStatus && typeof this.downloadStatus === "object"
          ? this.downloadStatus
          : {}),
        [key]: {
          status,
          message: message ? String(message) : "",
          ts: Date.now(),
        },
      };
      this.downloadStatus = next;
    },

    async fetchWithTimeout(url, options = {}, ms = 0) {
      if (!ms) return fetch(url, options);

      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), ms);
      try {
        return await fetch(url, { ...options, signal: controller.signal });
      } finally {
        clearTimeout(t);
      }
    },

    enqueueDownload(torrent, options = {}) {
      if (!torrent) return;

      const opts = options && typeof options === "object" ? options : {};
      const forceDownload = Boolean(opts.forceDownload);
      const hold = Boolean(opts.hold);

      const key = this.statusKeyForTorrent(torrent);
      if (!key) return;

      const existing = this.downloadStatus?.[key]?.status;
      if (existing === "queued" || existing === "sending") return;

      this.downloadQueue.push({ torrent, key, forceDownload, hold });
      this.setDownloadStatus(torrent, "queued", "");

      // Track group choice immediately on send
      const group = String(torrent?.parsed?.group || "")
        .trim()
        .toLowerCase();
      if (group) {
        this.groupCounts[group] = (this.groupCounts[group] || 0) + 1;
        srvr.incrementGroupCount(group).catch(() => {});
      }

      void this.processDownloadQueue();
    },

    normalizeQbtNameForMatch(name) {
      let s = String(name || "").toLowerCase();
      if (!s) return "";
      // Drop the provider suffix we add in display titles.
      s = s.replace(/\s*\|\s*(tl|ipt)\s*$/i, "");
      // Normalize common separators.
      s = s.replace(/[\._\-]+/g, " ");
      // Remove brackets/parentheses but keep the content.
      s = s.replace(/[\[\]\(\){}]/g, " ");
      // Collapse whitespace.
      s = s.replace(/\s+/g, " ").trim();
      return s;
    },

    async ensureInEmby() {
      const show = this.currentShow;
      if (!show || show.inEmby !== false) return true;

      const showName = String(show.name || "").trim();
      const showTvdbId = String(show.tvdbId || "").trim();
      if (!showName || !showTvdbId) return true;

      // Save search results so they survive the show reload triggered by addSearchChoice
      const savedTorrents = this.torrents.slice();
      const savedSelected = new Set(this.selectedItems);
      const savedLastSelectedIndex = this.lastSelectedIndex;
      const savedHasSearched = this.hasSearched;
      const savedLastNeeded = this.lastNeeded;
      const savedProviderWarning = this.providerWarning;
      const savedProviderStats = this.providerStats;
      const savedClicked = new Set(this.clickedTorrents);
      const savedDownloaded = new Set(this.downloadedTorrents);

      // Suppress searchTorrents calls during the emby load
      const origSearchTorrents = this.searchTorrents;
      this.searchTorrents = () => {};

      this.embyLoadingShow = true;
      this.embyLoadingStatus = "Starting...";

      try {
        const result = await new Promise((resolve) => {
          evtBus.emit("reelSearchAction", {
            srchChoice: { name: showName, tvdbId: showTvdbId },
            action: "add",
            onDone: (res) => resolve(res),
            onStatus: (txt) => {
              this.embyLoadingStatus = String(txt || "");
            },
          });
        });

        if (result?.ok) {
          show.inEmby = true;
          if (result?.show) {
            this.currentShow = result.show;
          }
          this.embyLoadingStatus = "Done";
          await new Promise((r) => setTimeout(r, 800));
          return true;
        }
        this.embyLoadingStatus = "Failed to load show into Emby";
        await new Promise((r) => setTimeout(r, 2000));
        return false;
      } catch (e) {
        this.embyLoadingStatus = e?.message || String(e);
        await new Promise((r) => setTimeout(r, 2000));
        return false;
      } finally {
        // Restore searchTorrents handler
        this.searchTorrents = origSearchTorrents;

        // Restore search results
        this.torrents = savedTorrents;
        this.selectedItems = savedSelected;
        this.lastSelectedIndex = savedLastSelectedIndex;
        this.hasSearched = savedHasSearched;
        this.lastNeeded = savedLastNeeded;
        this.providerWarning = savedProviderWarning;
        this.providerStats = savedProviderStats;
        this.clickedTorrents = savedClicked;
        this.downloadedTorrents = savedDownloaded;

        this.embyLoadingShow = false;
        this.embyLoadingStatus = "";
      }
    },

    async processDownloadQueue() {
      if (this.downloadQueueRunning) return;
      this.downloadQueueRunning = true;

      try {
        // If current show is not in Emby, load it first before processing any downloads
        if (this.currentShow?.inEmby === false) {
          const loaded = await this.ensureInEmby();
          if (!loaded) {
            // Fail all queued items
            while (this.downloadQueue.length > 0) {
              const item = this.downloadQueue.shift();
              if (item?.torrent) {
                this.setDownloadStatus(
                  item.torrent,
                  "error",
                  "Failed to load show into Emby",
                );
              }
            }
            return;
          }
        }

        while (this.downloadQueue.length > 0) {
          const item = this.downloadQueue.shift();
          const torrent = item?.torrent;
          const forceDownload = Boolean(item?.forceDownload);
          const hold = Boolean(item?.hold);
          if (!torrent) continue;

          this.setDownloadStatus(torrent, "sending", "");
          const torrentTitle = String(
            torrent?.raw?.title || torrent?.title || "Unknown",
          );

          try {
            const result = await this.downloadTorrentInternal(torrent, {
              forceDownload,
            });
            if (result?.ok) {
              this.setDownloadStatus(torrent, "ok", result?.message || "");

              const successMessage = String(result?.message || "").trim();
              const shouldRememberDownload =
                !/^(Already downloaded|Already in qBittorrent|Restarting)$/i.test(
                  successMessage,
                );

              // Only persist history when the torrent was actually sent.
              if (shouldRememberDownload) {
                this.rememberDownloadedTorrent(torrent);
              }
              // Hold only after the send to qbt succeeded.
              if (hold) {
                await this.holdTorrentName(torrent);
              }
            } else {
              const msg = result?.message || `Failed to add: ${torrentTitle}`;
              this.setDownloadStatus(torrent, "error", msg);
            }
          } catch (err) {
            const msg = err?.message || String(err);
            this.setDownloadStatus(torrent, "error", msg);
          }
        }
      } finally {
        this.downloadQueueRunning = false;
      }
    },

    async downloadTorrentInternal(torrent, options = {}) {
      // Mark as downloaded immediately to change card color ("now" highlighting)
      const nowKey = this.getTorrentNowKey(torrent);
      if (nowKey) {
        this.downloadedTorrents.add(nowKey);
      }

      const opts = options && typeof options === "object" ? options : {};
      const forceDownload = Boolean(opts.forceDownload);

      const torrentTitle = torrent?.raw?.title || "Unknown";
      const isAlreadyInQbtMessage = (msg) =>
        /qbit\s*torrent\s+already\s+(has|downloaded)/i.test(String(msg || ""));

      // Mark as downloaded immediately to change card color
      try {
        const providerRaw = String(torrent?.raw?.provider || "").toLowerCase();
        const detailUrl = String(torrent?.detailUrl || "");
        const detailUrlLower = detailUrl.toLowerCase();
        const provider =
          providerRaw.includes("torrentleech") ||
          detailUrlLower.includes("torrentleech")
            ? "torrentleech"
            : providerRaw.includes("iptorrents") ||
                detailUrlLower.includes("iptorrents")
              ? "iptorrents"
              : providerRaw.includes("thepiratebay") ||
                  providerRaw.includes("piratebay") ||
                  providerRaw === "thepiratesbay"
                ? "thepiratebay"
                : providerRaw.includes("limetorrents")
                  ? "limetorrents"
                  : providerRaw.includes("eztv")
                    ? "eztv"
                    : providerRaw || "unknown";

        // For public providers (TPB/LIM/EZT), use the /api/torrent-file endpoint
        const isPublicProvider = [
          "thepiratebay",
          "limetorrents",
          "eztv",
        ].includes(provider);
        if (isPublicProvider) {
          const showName = String(
            torrent?.raw?.title || this.currentShow?.name || "",
          ).trim();
          const magnet =
            torrent?.raw?.magnet ||
            torrent?.raw?.magnetLink ||
            torrent?.raw?.link;
          const magnetParam =
            typeof magnet === "string" && magnet.startsWith("magnet:")
              ? `&magnet=${encodeURIComponent(magnet)}`
              : "";
          const linkParam =
            typeof magnet === "string" && magnet.startsWith("http")
              ? `&link=${encodeURIComponent(magnet)}`
              : "";
          const url = `${config.torrentsApiUrl}/api/torrent-file?show=${encodeURIComponent(showName)}${magnetParam}${linkParam}${this.movieMode ? "&savePath=" + encodeURIComponent("/home/xobtlu/movies") : ""}`;
          const res = await this.fetchWithTimeout(url, {}, 60000);
          if (!res.ok) {
            let detail = "";
            try {
              const ct = res.headers.get("content-type") || "";
              if (ct.includes("application/json")) {
                const j = await res.json();
                detail = j?.error ? String(j.error) : JSON.stringify(j);
              } else {
                detail = await res.text();
              }
            } catch {} // ignore
            return {
              ok: false,
              message: detail || `HTTP ${res.status}: ${res.statusText}`,
            };
          }
          return { ok: true, message: "" };
        }
        // tv-api /downloads now returns a wrapper:
        // - existingTitles: array of titles (same as old raw array)
        // - existingProcids: matching procids
        // - errorTitles: array of titles/objects that had download errors
        // - errors/forced results are additional props
        const normalizeDownloadsWrapper = (payload) => {
          if (Array.isArray(payload)) {
            return { existingTitles: payload, existingProcids: [] };
          }
          if (!payload || typeof payload !== "object") return null;

          const existingTitles = Array.isArray(payload.existingTitles)
            ? payload.existingTitles
            : Array.isArray(payload.alreadyDownloaded)
              ? payload.alreadyDownloaded
              : Array.isArray(payload.alreadyDownloadedTitles)
                ? payload.alreadyDownloadedTitles
                : Array.isArray(payload.downloads)
                  ? payload.downloads
                  : Array.isArray(payload.titles)
                    ? payload.titles
                    : Array.isArray(payload.already)
                      ? payload.already
                      : [];

          const existingProcids = Array.isArray(payload.existingProcids)
            ? payload.existingProcids
            : Array.isArray(payload.procids)
              ? payload.procids
              : [];

          const rawErrorTitles = Array.isArray(payload.errorTitles)
            ? payload.errorTitles
            : [];

          // errorTitles can be either:
          // - string[] (legacy: filenames)
          // - { title, procId }[] (new)
          const errorTitleItems = rawErrorTitles;
          const errorTitles = rawErrorTitles
            .map((x) => {
              if (x && typeof x === "object" && !Array.isArray(x)) {
                return x.title ?? x.Title ?? "";
              }
              return String(x ?? "");
            })
            .map((s) => String(s || "").trim())
            .filter(Boolean);

          const errorProcIds = rawErrorTitles
            .map((x) =>
              x && typeof x === "object" && !Array.isArray(x)
                ? (x.procId ?? x.procid ?? x.proc_id ?? x.procID ?? null)
                : null,
            )
            .filter((v) => v !== null && v !== undefined && String(v) !== "");

          return {
            ...payload,
            existingTitles,
            existingProcids,
            errorTitles,
            errorTitleItems,
            errorProcIds,
          };
        };

        const formatAlreadyDownloadedDialog = (titles) => {
          const unique = Array.from(
            new Set(
              (Array.isArray(titles) ? titles : [])
                .map((t) => String(t || "").trim())
                .filter(Boolean),
            ),
          );
          return (
            "No torrents sent to qbitTorrent.  these files have already been downloaded\n\n" +
            unique.join("\n") +
            "\n\nDo you want to delete these files?"
          );
        };

        const formatErrorDownloadsDialog = (titles) => {
          const unique = Array.from(
            new Set(
              (Array.isArray(titles) ? titles : [])
                .map((t) => String(t || "").trim())
                .filter(Boolean),
            ),
          );
          return (
            "The following files have download errors.  Click delete to remove the files.\n\n" +
            unique.join("\n")
          );
        };

        const normalizeErrorTitleItems = (items) => {
          const arr = Array.isArray(items) ? items : [];
          return arr
            .map((item) => {
              if (typeof item === "string") {
                return { title: item, procId: null };
              }
              if (item && typeof item === "object") {
                return {
                  title:
                    item.title ??
                    item.Title ??
                    item.name ??
                    item.file ??
                    item.filename ??
                    item.torrentTitle ??
                    "",
                  procId:
                    item.procId ??
                    item.procid ??
                    item.proc_id ??
                    item.procID ??
                    item.pid ??
                    item.id ??
                    null,
                  procIds: item.procIds ?? item.procids ?? null,
                };
              }
              return { title: "", procId: null };
            })
            .filter((x) => String(x.title || "").trim() || x.procId);
        };

        const collectProcIdsFromErrorTitles = (wrapper, errorItems) => {
          const procIds = [];

          const w = wrapper && typeof wrapper === "object" ? wrapper : null;
          const fromNormalized = Array.isArray(w?.errorProcIds)
            ? w.errorProcIds
            : [];
          for (const pid of fromNormalized) procIds.push(pid);

          const fromWrapper = Array.isArray(w?.errorProcIds)
            ? w.errorProcIds
            : Array.isArray(w?.errorProcids)
              ? w.errorProcids
              : [];
          for (const pid of fromWrapper) procIds.push(pid);

          const items = Array.isArray(errorItems) ? errorItems : [];
          for (const item of items) {
            if (!item || typeof item !== "object") continue;
            if (Array.isArray(item.procIds)) {
              for (const pid of item.procIds) procIds.push(pid);
            }
            if (item.procId !== null && item.procId !== undefined)
              procIds.push(item.procId);
          }

          return procIds
            .filter((v) => v !== null && v !== undefined && String(v) !== "")
            .map((v) => v);
        };

        // Quality gate: block send if qbt already has a higher-quality torrent for
        // the same show + S/E. forceDownload bypasses this check entirely.
        if (!forceDownload) {
          const newTitle = String(torrent?.raw?.title || torrent?.title || "");
          const seMatch = newTitle.match(/S(\d{2})E(\d{2})/i);
          if (seMatch) {
            const seStr = `S${seMatch[1]}E${seMatch[2]}`.toUpperCase();
            const torRes = (t) => {
              const s = String(t || "");
              if (/2160p|4k|uhd/i.test(s)) return 2160;
              if (/1080p|1080i/i.test(s)) return 1080;
              if (/720p|720i/i.test(s)) return 720;
              if (/576p|576i/i.test(s)) return 576;
              if (/480p|480i/i.test(s)) return 480;
              if (/384p|384i/i.test(s)) return 384;
              return 480;
            };
            const torDepth = (t) =>
              /10.?bit|hdr/i.test(String(t || "")) ? 10 : 8;
            const torBadGroup = (t) => {
              try {
                const parsed = parseTorrentTitle(
                  String(t || "").replace(/\.[a-z0-9]{2,4}$/i, ""),
                );
                return this.badGroups.has((parsed?.group || "").toLowerCase());
              } catch {
                return false;
              }
            };
            // Extract normalized show name using shared parseTitleFromFilename
            const showName = (t) => {
              const s = String(t || "");
              const parsed = util.parseTitleFromFilename(s, null, null);
              return parsed ? parsed.toLowerCase().trim() : "";
            };
            const newRes = torRes(newTitle);
            const newDepth = torDepth(newTitle);
            const newBad = torBadGroup(newTitle);
            const newHevc = isHevc(newTitle);
            const newShow = showName(newTitle);
            try {
              const qbtInfoUrl = new URL(
                `${config.torrentsApiUrl}/api/qbt/info`,
              );
              const qbtInfoRes = await this.fetchWithTimeout(
                qbtInfoUrl.toString(),
                {},
                15000,
              );
              if (qbtInfoRes && qbtInfoRes.ok) {
                const qbtList = await qbtInfoRes.json().catch(() => []);
                if (Array.isArray(qbtList)) {
                  for (const qt of qbtList) {
                    const qName = String(qt?.name || "");
                    const qSeMatch = qName.match(/S(\d{2})E(\d{2})/i);
                    if (!qSeMatch) continue;
                    const qSe = `S${qSeMatch[1]}E${qSeMatch[2]}`.toUpperCase();
                    if (qSe !== seStr) continue;
                    // Skip if the show names don't match
                    const qShow = showName(qName);
                    if (newShow && qShow && qShow !== newShow) continue;
                    const qRes = torRes(qName);
                    const qDepth = torDepth(qName);
                    const qBad = torBadGroup(qName);
                    const qHevc = isHevc(qName);
                    const qIsHigherQuality =
                      qRes > newRes ||
                      (qRes === newRes && qDepth > newDepth) ||
                      (qRes === newRes &&
                        qDepth === newDepth &&
                        !qHevc &&
                        newHevc) ||
                      (qRes === newRes &&
                        qDepth === newDepth &&
                        qHevc === newHevc &&
                        !qBad &&
                        newBad);
                    if (qIsHigherQuality) {
                      const showName =
                        this.currentShow?.name || newShow || "unknown show";
                      unilog(
                        1186,
                        `Client: qBittorrent has higher quality ${seStr} (${qRes}p vs ${newRes}p) for ${showName}: "${newTitle}"`,
                      );
                      this.showError(
                        `qBittorrent already has a higher quality version of ${seStr}:\n${qName}`,
                      );
                      return {
                        ok: false,
                        message: "Higher quality already in qBittorrent",
                      };
                    }
                  }
                }
              }
            } catch {
              // qbt check failed — proceed with the send
            }
          }
        }

        let downloadsRes = null;
        try {
          const downloadsUrl = `${config.torrentsApiUrl}/downloads`;

          const dlShowName = String(this.currentShow?.name || "").trim();
          const dlTvdbId = String(
            this.currentShow?.tvdbId || this.currentShow?.tvdbId || "",
          ).trim();
          const downloadsPayload =
            provider === "torrentleech"
              ? {
                  tl: { torrent },
                  ...(forceDownload ? { forceDownload: true } : {}),
                  ...(dlShowName ? { showName: dlShowName } : {}),
                  ...(dlTvdbId ? { tvdbId: dlTvdbId } : {}),
                  ...(this.movieMode
                    ? { savePath: "/home/xobtlu/movies" }
                    : {}),
                }
              : {
                  torrent,
                  ...(forceDownload ? { forceDownload: true } : {}),
                  ...(dlShowName ? { showName: dlShowName } : {}),
                  ...(dlTvdbId ? { tvdbId: dlTvdbId } : {}),
                  ...(this.movieMode
                    ? { savePath: "/home/xobtlu/movies" }
                    : {}),
                };

          let downloadsBody = "";
          try {
            downloadsBody = JSON.stringify(downloadsPayload);
          } catch (e) {
            unilog(1039, "downloads request JSON stringify failed", {
              error: e?.message || String(e),
            });
            throw e;
          }

          downloadsRes = await this.fetchWithTimeout(
            downloadsUrl,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: downloadsBody,
            },
            60000,
          );
        } catch {
          downloadsRes = null;
        }

        if (downloadsRes && downloadsRes.ok) {
          const ct = (
            downloadsRes.headers.get("content-type") || ""
          ).toLowerCase();
          const payload = ct.includes("application/json")
            ? await downloadsRes.json().catch(() => null)
            : await downloadsRes.text().catch(() => "");

          const wrapper = normalizeDownloadsWrapper(payload);
          const alreadyTitles = wrapper?.existingTitles;
          const errorTitlesRaw =
            wrapper?.errorTitleItems ?? wrapper?.errorTitles;

          const hadAlreadyTitles =
            Array.isArray(alreadyTitles) && alreadyTitles.length > 0;
          const procIdsToDelete = new Set();
          let existingDeleteClicked = false;
          let errorDeleteClicked = false;

          if (hadAlreadyTitles) {
            const confirmed = await this.confirmExistingDownloads(
              formatAlreadyDownloadedDialog(alreadyTitles),
              wrapper,
            );
            existingDeleteClicked = Boolean(confirmed);
            if (existingDeleteClicked) {
              const existing = Array.isArray(wrapper?.existingProcids)
                ? wrapper.existingProcids
                : [];
              for (const pid of existing) {
                if (pid !== null && pid !== undefined && String(pid) !== "")
                  procIdsToDelete.add(pid);
              }
            }
          }

          // After checking already-downloaded titles (regardless of deletion), offer to delete any error titles.
          const errorItems = normalizeErrorTitleItems(errorTitlesRaw);
          const hadErrorTitles = errorItems.length > 0;
          if (hadErrorTitles) {
            const titlesForDialog = errorItems
              .map((x) => x.title)
              .filter(Boolean);
            const confirmed = await this.confirmExistingDownloads(
              formatErrorDownloadsDialog(titlesForDialog),
              wrapper,
            );
            errorDeleteClicked = Boolean(confirmed);
            if (errorDeleteClicked) {
              const errorProcIds = collectProcIdsFromErrorTitles(
                wrapper,
                errorItems,
              );
              for (const pid of errorProcIds) procIdsToDelete.add(pid);
            }
          }

          // Call deleteProcids once if either dialog had Delete clicked.
          if (existingDeleteClicked || errorDeleteClicked) {
            if (procIdsToDelete.size > 0) {
              const ok = await this.deleteProcids({
                procIds: Array.from(procIdsToDelete),
              });
              if (!ok) {
                // deleteProcids already surfaced the error
              }
            } else {
              // Only show this if user explicitly requested deletion but we have no IDs.
              this.showError(
                "Cannot delete because the server did not return any procId values for these entries.",
              );
            }
          }

          // If the server returned errorTitles, we've already surfaced them via the dialog.
          // Avoid also showing a generic error modal like "Download Error" from wrapper.error/message.
          if (hadErrorTitles) {
            return {
              ok: false,
              message: String(
                wrapper?.error || wrapper?.message || "Download Error",
              ),
            };
          }

          if (hadAlreadyTitles) {
            return { ok: true, message: "Already downloaded" };
          }

          // If the endpoint returned a wrapper with success/result state, honor it.
          if (wrapper && typeof wrapper === "object") {
            if (
              wrapper.success ||
              wrapper.result === true ||
              wrapper.ok === true
            ) {
              return { ok: true, message: "" };
            }

            const errorMsg = wrapper.error || wrapper.message;
            if (errorMsg) {
              if (payload?.stage === "validate-torrent-files") {
                const torrentName = payload?.torrentName || "Unknown";
                this.showError(
                  `Torrent file name is missing a season or episode number.\n\nTorrent: ${torrentName}`,
                );
                return { ok: false, message: String(errorMsg) };
              }

              if (payload?.stage === "tv-blocked") {
                const confirmed = await this.showConfirmDialog(
                  `Torrent is blocked: ${payload.error || errorMsg}\n\nSend to qBittorrent anyway?`,
                );
                if (confirmed) {
                  void this.enqueueDownload(torrent, { forceDownload: true });
                }
                return { ok: false, message: String(errorMsg) };
              }

              if (isAlreadyInQbtMessage(errorMsg)) {
                if (forceDownload) {
                  // Force: delete then re-add
                  try {
                    const delUrl = new URL(
                      `${config.torrentsApiUrl}/api/qbt/delTorrent`,
                    );
                    await fetch(delUrl.toString(), {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        hash: wrapper?.hash || "",
                        deleteFiles: true,
                        title: torrentTitle,
                      }),
                    });
                  } catch {
                    /* ignore */
                  }
                  return { ok: true, message: "Restarting" };
                }
                this.showError(
                  `QbitTorrent already has torrent ${torrentTitle}`,
                );
                return { ok: true, message: "Already in qBittorrent" };
              }

              const isCloudflare =
                Boolean(
                  payload &&
                  typeof payload === "object" &&
                  (payload.isCloudflare || payload.stage === "cloudflare"),
                ) ||
                /cloudflare|just a moment|checking your browser/i.test(
                  String(errorMsg || ""),
                );

              if (isCloudflare && provider === "iptorrents") {
                const label = "IPTorrents";
                const cookieBox = "IPT";

                let popupBlocked = false;
                if (detailUrl) {
                  try {
                    const w = util.openExternalPage(detailUrl);
                    popupBlocked = !w;
                  } catch {
                    popupBlocked = true;
                  }
                }

                this.showError(
                  `${label} blocked the server request with a Cloudflare challenge page ("Just a moment...").\n\n` +
                    (detailUrl
                      ? popupBlocked
                        ? "Note: Browser blocked the popup tab.\n\n"
                        : "Opened the detail page in a new tab.\n\n"
                      : "") +
                    "Try:\n" +
                    `- Complete any “verify you are human” step in the detail tab.\n` +
                    `- Copy the latest cf_clearance cookie into the ${cookieBox} box and Save, then retry.\n` +
                    "- If it still fails, Cloudflare is likely fingerprinting requests from this network/IP.\n\n" +
                    (detailUrl ? `Detail URL:\n${detailUrl}` : ""),
                );
                return {
                  ok: false,
                  message: "Cloudflare challenge blocked server request",
                };
              }

              this.showError(errorMsg);
              return { ok: false, message: String(errorMsg) };
            }
          }
          // Unknown successful payload shape; fall back to legacy endpoint.
        } else if (downloadsRes && downloadsRes.status !== 404) {
          let detail = "";
          try {
            const ct = downloadsRes.headers.get("content-type") || "";
            if (ct.includes("application/json")) {
              const j = await downloadsRes.json();
              detail = j?.error
                ? String(j.error)
                : j?.message
                  ? String(j.message)
                  : JSON.stringify(j);
            } else {
              detail = await downloadsRes.text();
            }
          } catch {
            // ignore
          }

          if (isAlreadyInQbtMessage(detail)) {
            if (forceDownload) {
              // Force: delete then re-add — caller will retry
              return { ok: true, message: "Restarting" };
            }
            this.showError(`QbitTorrent already has torrent ${torrentTitle}`);
            return { ok: true, message: "Already in qBittorrent" };
          }

          throw new Error(
            detail || `HTTP ${downloadsRes.status}: ${downloadsRes.statusText}`,
          );
        }

        // Legacy server-side pipeline.
        const response = await this.fetchWithTimeout(
          `${config.torrentsApiUrl}/api/download`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              torrent,
              ...(forceDownload ? { forceDownload: true } : {}),
              ...(String(this.currentShow?.name || "").trim()
                ? { showName: String(this.currentShow?.name || "").trim() }
                : {}),
              ...(String(
                this.currentShow?.tvdbId || this.currentShow?.tvdbId || "",
              ).trim()
                ? {
                    tvdbId: String(
                      this.currentShow?.tvdbId ||
                        this.currentShow?.tvdbId ||
                        "",
                    ).trim(),
                  }
                : {}),
              ...(this.movieMode ? { savePath: "/home/xobtlu/movies" } : {}),
            }),
          },
          60000,
        );

        if (!response.ok) {
          let detail = "";
          try {
            const ct = response.headers.get("content-type") || "";
            if (ct.includes("application/json")) {
              const j = await response.json();
              detail = j?.error ? String(j.error) : JSON.stringify(j);
            } else {
              detail = await response.text();
            }
          } catch {
            // ignore
          }
          throw new Error(
            detail || `HTTP ${response.status}: ${response.statusText}`,
          );
        }

        const data = await response.json();

        // Check if download was successful
        if (data.success || data.result === true) {
          return { ok: true, message: "" };
        } else {
          const errorMsg = data.error || data.message || "Unknown error";
          const isCloudflare =
            Boolean(
              data &&
              typeof data === "object" &&
              (data.isCloudflare || data.stage === "cloudflare"),
            ) ||
            /cloudflare|just a moment|checking your browser/i.test(
              String(errorMsg || ""),
            );

          if (isCloudflare && provider === "iptorrents") {
            const label = "IPTorrents";
            const cookieBox = "IPT";

            let popupBlocked = false;
            if (detailUrl) {
              try {
                const w = util.openExternalPage(detailUrl);
                popupBlocked = !w;
              } catch {
                popupBlocked = true;
              }
            }

            this.showError(
              `${label} blocked the server request with a Cloudflare challenge page ("Just a moment...").\n\n` +
                (detailUrl
                  ? popupBlocked
                    ? "Note: Browser blocked the popup tab.\n\n"
                    : "Opened the detail page in a new tab.\n\n"
                  : "") +
                "Try:\n" +
                `- Complete any “verify you are human” step in the detail tab.\n` +
                `- Copy the latest cf_clearance cookie into the ${cookieBox} box and Save, then retry.\n` +
                "- If it still fails, Cloudflare is likely fingerprinting requests from this network/IP.\n\n" +
                (detailUrl ? `Detail URL:\n${detailUrl}` : ""),
            );
            return {
              ok: false,
              message: "Cloudflare challenge blocked server request",
            };
          } else {
            this.showError(errorMsg);
            return { ok: false, message: String(errorMsg) };
          }
        }
      } catch (error) {
        const errorMsg = error.message || String(error);
        this.showError(errorMsg);
        return { ok: false, message: String(errorMsg) };
      }
    },

    formatSeasonEpisode(seasonEpisode) {
      if (!seasonEpisode) return "";
      // Convert S01E02 to 1/2 without leading zeros
      const match = seasonEpisode.match(/S(\d+)(?:E(\d+))?/);
      if (!match) return seasonEpisode;

      const season = parseInt(match[1], 10);
      const episode = match[2] ? parseInt(match[2], 10) : null;

      if (episode !== null) {
        return `${season}/${episode}`;
      } else {
        return String(season);
      }
    },

    getDisplaySeasonEpisode(torrent) {
      // Handle dummy torrents
      if (torrent.notorrent) {
        return this.formatSeasonEpisode(torrent.notorrent);
      }

      // Check if torrent has parsed data
      if (!torrent.parsed) {
        return torrent.title || "";
      }

      // If this torrent represents a season range, show "start...end"
      if (torrent.seasonRange && torrent.seasonRange.isRange) {
        const start = Number(torrent.seasonRange.startSeason);
        const end = Number(torrent.seasonRange.endSeason);
        if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
          return `${start}...${end}`;
        }
      }

      // Log what we're working with
      // console.log('Torrent display data:', {
      //   title: torrent.parsed.title,
      //   season: torrent.parsed.season,
      //   episode: torrent.parsed.episode,
      //   seasonEpisode: torrent.parsed.seasonEpisode,
      //   rawTitle: torrent.raw?.title
      // });

      // If seasonEpisode is already set, use it
      if (torrent.parsed.seasonEpisode) {
        return this.formatSeasonEpisode(torrent.parsed.seasonEpisode);
      }

      // Otherwise construct from parsed season/episode
      const season = torrent.parsed.season;
      const episode = torrent.parsed.episode;

      if (season !== undefined && season !== null) {
        let result = `S${String(season).padStart(2, "0")}`;
        if (episode !== undefined && episode !== null) {
          result += `E${String(episode).padStart(2, "0")}`;
        }
        return this.formatSeasonEpisode(result);
      }

      // Fallback to title if no season info
      return torrent.parsed.title || "";
    },

    formatProvider(provider) {
      if (!provider) return "";
      const p = provider.toLowerCase();
      if (p === "iptorrents") return "IPT";
      if (p === "torrentleech") return "TL";
      if (p === "thepiratebay") return "TPB";
      if (p === "limetorrents") return "LIM";
      if (p === "eztv") return "EZT";
      return provider;
    },

    formatGroup(group) {
      if (!group) return "";
      const key = group.toLowerCase();
      const count = this.groupCounts[key];
      return count ? `${key} (${count})` : key;
    },

    // Helper: extract show name from a torrent using parse-torrent-title
    torExtractShowName(torrent) {
      const rawTitle = String(torrent?.raw?.title || torrent?.title || "");
      if (!rawTitle) return "";
      try {
        let parser = null;
        if (typeof parseTorrentTitle === "function") {
          parser = parseTorrentTitle;
        } else if (
          parseTorrentTitle &&
          typeof parseTorrentTitle.parse === "function"
        ) {
          parser = parseTorrentTitle.parse;
        } else if (
          parseTorrentTitle?.default &&
          typeof parseTorrentTitle.default.parse === "function"
        ) {
          parser = parseTorrentTitle.default.parse;
        }
        if (!parser) return rawTitle;
        const parsed = parser(rawTitle);
        return parsed?.title || rawTitle;
      } catch {
        return rawTitle;
      }
    },

    // Sel: emit selectShowFromCardTitle using show name from first selected torrent
    torSelClick() {
      const first = [...this.selectedItems][0];
      if (!first) return;
      const name = this.torExtractShowName(first);
      if (name) evtBus.emit("selectShowFromCardTitle", name);
    },

    // From: select all torrents matching current show
    torFromClick() {
      if (!this.currentShow) return;
      const candidates = [this.currentShow];
      const newSel = new Set();
      let firstIdx = null;
      for (let i = 0; i < this.filteredTorrents.length; i++) {
        const t = this.filteredTorrents[i];
        const name = this.torExtractShowName(t);
        if (!name) continue;
        const match = util.smartTitleMatch(name, candidates, null, false);
        if (match) {
          newSel.add(t);
          if (firstIdx === null) firstIdx = i;
        }
      }
      this.selectedItems = newSel;
      if (firstIdx !== null) {
        this.lastSelectedIndex = firstIdx;
        this.$nextTick(() => {
          const el = this.$refs.scroller;
          if (!el) return;
          const cards = el.querySelectorAll("#torrents-list > div");
          const card = cards[firstIdx];
          if (card) card.scrollIntoView({ block: "nearest" });
        });
      }
    },

    // All: select all torrents matching the show of the first selected item
    torAllClick() {
      const first = [...this.selectedItems][0];
      if (!first) return;
      const pivotName = this.torExtractShowName(first);
      if (!pivotName) return;
      const newSel = new Set();
      let firstIdx = null;
      for (let i = 0; i < this.filteredTorrents.length; i++) {
        const t = this.filteredTorrents[i];
        const name = this.torExtractShowName(t);
        if (!name) continue;
        const match = util.smartTitleMatch(
          name,
          [{ name: pivotName }],
          null,
          false,
        );
        if (match) {
          newSel.add(t);
          if (firstIdx === null) firstIdx = i;
        }
      }
      this.selectedItems = newSel;
      if (firstIdx !== null) {
        this.lastSelectedIndex = firstIdx;
        this.$nextTick(() => {
          const el = this.$refs.scroller;
          if (!el) return;
          const cards = el.querySelectorAll("#torrents-list > div");
          const card = cards[firstIdx];
          if (card) card.scrollIntoView({ block: "nearest" });
        });
      }
    },

    // Group: toggle a filter that shows only cards with the same group as the first selected card with a group
    torGroupClick() {
      this.showFilter = null;
      if (this.groupFilter !== null) {
        // Toggle off - keep current selectedItems (selected while filtering)
        this.groupFilter = null;
        return;
      }

      if (this.selectedItems.size === 0) return;

      // Find group from first visible selected card that has a group
      let group = null;
      for (const t of this.filteredTorrents) {
        if (!this.selectedItems.has(t)) continue;
        const g = String(t.parsed?.group || "").trim();
        if (g) {
          group = g;
          break;
        }
      }

      if (group) {
        // Keep only selected items that match the group so pre-filter selections
        // of non-matching cards don't reappear when filter is turned off
        const gLower = group.toLowerCase();
        const newSel = new Set();
        for (const t of this.selectedItems) {
          if (String(t.parsed?.group || "").toLowerCase() === gLower) {
            newSel.add(t);
          }
        }
        this.selectedItems = newSel;
        this.groupFilter = group;
      } else {
        // No group found - flash the button highlight for 500ms
        this.groupFilterFlash = true;
        window.clearTimeout(this._groupFilterFlashTimer);
        this._groupFilterFlashTimer = window.setTimeout(() => {
          this.groupFilterFlash = false;
        }, 500);
      }
    },

    // Show: toggle a filter that shows only cards for the same show as the first selected card
    torShowFilterClick() {
      if (this.showFilter !== null) {
        // Toggle off - keep current selectedItems (selected while filtering)
        this.showFilter = null;
        return;
      }

      const first = [...this.selectedItems][0];
      if (!first) return;
      const name = this.torExtractShowName(first);
      if (!name) return;

      // Keep only selected items that match the show so pre-filter selections
      // of non-matching cards don't reappear when filter is turned off
      const candidates = [{ name }];
      const newSel = new Set();
      for (const t of this.selectedItems) {
        const n = this.torExtractShowName(t);
        if (n && util.smartTitleMatch(n, candidates, null, false))
          newSel.add(t);
      }
      this.selectedItems = newSel;
      this.showFilter = name;
    },

    // First: scroll to first selected item
    torFirstClick() {
      const first = [...this.selectedItems][0];
      if (!first) return;
      const idx = this.filteredTorrents.indexOf(first);
      if (idx < 0) return;
      this.$nextTick(() => {
        const el = this.$refs.scroller;
        if (!el) return;
        const cards = el.querySelectorAll("#torrents-list > div");
        const card = cards[idx];
        if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    },
    async torChkSubClick() {
      if (this.torSubCountBusy) return;
      const selected = [...this.selectedItems];
      if (selected.length === 0) return;

      const visibleKeys = {};
      const pending = [];
      const cache =
        this.torSubCountCache && typeof this.torSubCountCache === "object"
          ? { ...this.torSubCountCache }
          : {};

      for (const torrent of selected) {
        const key = this.getTorSubCountKey(torrent);
        if (!key) continue;
        visibleKeys[key] = true;
        if (!cache[key]) {
          pending.push({ key, torrent });
        }
      }

      const selectedAlreadyVisible = Object.keys(visibleKeys).every(
        (key) => this.torSubCountVisibleKeys?.[key],
      );

      if (
        this.torSubCountsVisible &&
        pending.length === 0 &&
        selectedAlreadyVisible
      ) {
        this.torSubCountsVisible = false;
        this.torSubCountVisibleKeys = {};
        return;
      }

      if (pending.length === 0) {
        this.torSubCountVisibleKeys = {
          ...(this.torSubCountVisibleKeys || {}),
          ...visibleKeys,
        };
        this.torSubCountsVisible = true;
        return;
      }

      this.torSubCountBusy = true;
      const pendingKeys = new Set(pending.map((p) => p.key));
      const chkSubsChannel = srvr.openChannel("chkSubsResult", {
        onDelta: (results) => {
          for (const result of Array.isArray(results) ? results : []) {
            const key = String(result?.key || "").trim();
            if (!key || !pendingKeys.has(key)) continue;
            this.torSubCountCache = {
              ...this.torSubCountCache,
              [key]: result,
            };
            this.torSubCountVisibleKeys = {
              ...(this.torSubCountVisibleKeys || {}),
              [key]: true,
            };
            this.torSubCountsVisible = true;
          }
        },
      });
      try {
        const show = this.currentShow || this.activeShow || {};
        const response = await this.fetchWithTimeout(
          `${config.torrentsApiUrl}/api/tor/chk-subs`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items: pending,
              showContext: {
                name: String(show?.name || this.showName || "").trim(),
                imdbId: String(show?.imdbId || "").trim(),
                firstAired: String(show?.firstAired || "").trim(),
              },
            }),
          },
          120000,
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.success) {
          throw new Error(data?.error || `HTTP ${response.status}`);
        }

        // Merge any results not yet received via the channel.
        const nextCache = { ...this.torSubCountCache };
        for (const result of data?.results || []) {
          const key = String(result?.key || "").trim();
          if (!key) continue;
          nextCache[key] = result;
        }

        this.torSubCountCache = nextCache;
        this.torSubCountVisibleKeys = {
          ...(this.torSubCountVisibleKeys || {}),
          ...visibleKeys,
        };
        this.torSubCountsVisible = true;
      } catch (e) {
        this.showError(this.getErrorMessage(e));
      } finally {
        chkSubsChannel.close();
        this.torSubCountBusy = false;
      }
    },
    async torBadGrpClick() {
      const first = [...this.selectedItems][0];
      const group = String(first?.parsed?.group || "").trim();
      if (!group) {
        this.showError("Selected torrent has no group name.");
        return;
      }

      try {
        const result = await srvr.toggleBadGroup(group);
        if (result?.action === "added") {
          this.showInfo(`Added bad group: ${group}`);
        } else if (result?.action === "removed") {
          this.showInfo(`Removed bad group: ${group}`);
        }
      } catch (e) {
        this.showError(this.getErrorMessage(e));
      }
    },

    async torInfoClick() {
      const first = [...this.selectedItems][0];
      if (!first) return;

      this.torInfoBusy = true;
      try {
        const response = await fetch(`${config.torrentsApiUrl}/api/tor/info`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ torrent: first }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result?.error || `HTTP ${response.status}`);
        }
        if (!result?.success || !result?.info) {
          throw new Error(result?.error || "Failed to get torrent info.");
        }
        this.torrentInfoData = result;
        this.showTorrentInfoModal = true;
      } catch (e) {
        this.showError(this.getErrorMessage(e));
      } finally {
        this.torInfoBusy = false;
      }
    },

    // Show: open detail URL for first selected torrent
    torShowClick() {
      const first = [...this.selectedItems][0];
      if (!first || !first.detailUrl) return;
      util.openExternalPage(first.detailUrl);
    },

    // Send: enqueue download for each selected torrent
    async torSendClick() {
      this.sendFlash = true;
      window.clearTimeout(this._sendFlashTimer);
      this._sendFlashTimer = window.setTimeout(() => {
        this.sendFlash = false;
      }, 500);
      for (const t of this.selectedItems) {
        void this.enqueueDownload(t, { forceDownload: false });
      }
    },

    // Hold: send to qbt like Send, but also add the torrent name to the
    // persistent heldTorrents list so tv-down leaves the usb files alone until
    // the user previews them in the usb pane and unholds them.
    async torHoldClick() {
      this.holdFlash = true;
      window.clearTimeout(this._holdFlashTimer);
      this._holdFlashTimer = window.setTimeout(() => {
        this.holdFlash = false;
      }, 500);
      for (const t of this.selectedItems) {
        void this.enqueueDownload(t, { forceDownload: false, hold: true });
      }
    },

    // Add a torrent name to the persistent held list (after a successful send).
    async holdTorrentName(torrent) {
      const name = String(torrent?.raw?.title || torrent?.title || "").trim();
      if (!name) return;
      try {
        const res = await fetch(`${config.tvDownUrl}/hold`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ names: [name] }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        this.showError(`Hold failed for ${name}: ${this.getErrorMessage(e)}`);
      }
    },

    // Force: confirm then enqueue with forceDownload:true for each selected
    async torForceClick() {
      const count = this.selectedItems.size;
      if (count === 0) return;
      const msg = `Send ${count} selected torrent${count === 1 ? "" : "s"} to qbt even if already downloaded?`;
      const confirmed = await this.showConfirmDialog(msg);
      if (!confirmed) return;
      for (const t of this.selectedItems) {
        void this.enqueueDownload(t, { forceDownload: true });
      }
    },

    // Generic confirm dialog using a modal-like approach with Enter/Escape
    showConfirmDialog(msg) {
      return new Promise((resolve) => {
        if (!window.confirm(msg)) {
          resolve(false);
          return;
        }
        resolve(true);
      });
    },
  },
};
</script>
