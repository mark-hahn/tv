<template>
  <div
    id="local"
    :style="{
      height: '100%',
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      backgroundColor: '#fafafa',
    }"
  >
    <div
      id="localFiles"
      :style="{
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flex:
          showAsr ||
          showEmb ||
          showFix ||
          showInfo ||
          showOpn ||
          showText ||
          showHist
            ? '0 0 50%'
            : '1 1 auto',
        borderBottom:
          showAsr ||
          showEmb ||
          showFix ||
          showInfo ||
          showOpn ||
          showText ||
          showHist
            ? '1px solid #ddd'
            : 'none',
      }"
    >
      <!-- Header -->
      <div
        :style="{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          padding: '8px',
          borderBottom: '1px solid #000',
          flex: '0 0 auto',
        }"
      >
        <!-- Row 1: title left, Subs through Ref buttons right — hidden in movie mode -->
        <div
          v-if="!movieMode"
          style="
            display: flex;
            align-items: center;
            justify-content: space-between;
          "
        >
          <div class="pane-header-title">Local files</div>

          <div style="display: flex; align-items: center; gap: 10px">
            <span
              v-if="loading"
              style="
                color: #808080;
                font-weight: bold;
                white-space: nowrap;
                font-size: 13px;
              "
              >Loading</span
            >
            <button
              @click="clickSubs()"
              :style="{
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
                backgroundColor:
                  subsPending.length > 0 ? 'lightgray' : 'whitesmoke',
              }"
            >
              Subs
            </button>

            <button
              @click="clickEmb"
              :style="{
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
                backgroundColor: showEmb ? '#ddd' : 'whitesmoke',
              }"
            >
              EmbSub
            </button>

            <button
              @click="clickOpn"
              :style="{
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
                backgroundColor: showOpn ? '#ddd' : 'whitesmoke',
              }"
            >
              OpnSub
            </button>

            <button
              @click="clickAsr"
              :style="{
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
                backgroundColor: showAsr ? '#ddd' : 'whitesmoke',
              }"
            >
              Asr
            </button>

            <button
              @click="clickFix"
              :style="{
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
                backgroundColor: showFix ? '#ddd' : 'whitesmoke',
              }"
            >
              Fix
            </button>

            <button
              @click="clickPlay"
              :disabled="selectedFiles.size === 0 && !selectedName"
              :style="{
                cursor:
                  selectedFiles.size > 0 || selectedName
                    ? 'pointer'
                    : 'default',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
                '--btn-bg':
                  selectedFiles.size > 0 || selectedName
                    ? 'whitesmoke'
                    : '#e8e8e8',
                color:
                  selectedFiles.size > 0 || selectedName ? 'inherit' : '#aaa',
              }"
            >
              Play
            </button>

            <button
              @click="clickHist"
              :disabled="!historyReady"
              title="Show activity history"
              :style="{
                cursor: historyReady ? 'pointer' : 'default',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
                '--btn-bg': !historyReady
                  ? '#e8e8e8'
                  : showHist
                    ? '#ddd'
                    : 'whitesmoke',
                color: historyReady ? 'inherit' : '#aaa',
              }"
            >
              Hist
            </button>

            <button
              @click="clickView"
              :disabled="!viewReady"
              title="View text file"
              :style="{
                cursor: viewReady ? 'pointer' : 'default',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
                '--btn-bg': !viewReady
                  ? '#e8e8e8'
                  : showText
                    ? '#ddd'
                    : 'whitesmoke',
                color: viewReady ? 'inherit' : '#aaa',
              }"
            >
              View
            </button>

            <button
              @click="clickSwap"
              :disabled="!swapReady || loading"
              title="Make this .old/.alt file the active one"
              :style="{
                cursor: swapReady && !loading ? 'pointer' : 'default',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
                '--btn-bg': swapReady && !loading ? 'whitesmoke' : '#e8e8e8',
                color: swapReady && !loading ? 'inherit' : '#aaa',
              }"
            >
              Swap
            </button>

            <button
              @click="refresh"
              :disabled="loading"
              style="
                cursor: pointer;
                border-radius: 7px;
                padding: 4px 10px;
                border: 1px solid #bbb;
                background-color: whitesmoke;
              "
            >
              Refresh
            </button>
          </div>
        </div>

        <!-- Row 2: search + rename inputs left, Sel through Del buttons right -->
        <div
          v-if="!movieMode"
          style="
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-top: 6px;
          "
        >
          <div style="display: flex; align-items: center; gap: 10px">
            <input
              v-model="searchInput"
              @keyup.enter="searchLocal"
              placeholder="Search"
              style="width: 120px"
            />
            <input
              v-model="renameInput"
              @focus="onRenameFocus"
              @keyup.enter="renameLocalFile"
              placeholder="Rename"
              style="width: 120px"
            />
          </div>

          <div style="display: flex; align-items: center; gap: 10px">
            <span
              v-if="selectedFiles.size > 0"
              style="
                font-size: 15px;
                font-weight: bold;
                color: green;
                align-self: center;
                white-space: nowrap;
              "
              >Sel: {{ selectedFiles.size }}</span
            >
            <button
              @click="toShow"
              :disabled="!selectedName && selectedFiles.size === 0"
              :style="{
                cursor:
                  selectedName || selectedFiles.size > 0
                    ? 'pointer'
                    : 'default',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
                '--btn-bg':
                  selectedName || selectedFiles.size > 0
                    ? 'whitesmoke'
                    : '#e8e8e8',
                color:
                  selectedName || selectedFiles.size > 0 ? 'inherit' : '#aaa',
              }"
            >
              Sel
            </button>

            <button
              @click="selectTopLevel"
              :style="{
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
                '--btn-bg': 'whitesmoke',
              }"
            >
              From
            </button>

            <button
              @click="localFirstClick"
              :disabled="!selectedName && selectedFiles.size === 0"
              :style="{
                cursor:
                  selectedName || selectedFiles.size > 0
                    ? 'pointer'
                    : 'default',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
                '--btn-bg':
                  selectedName || selectedFiles.size > 0
                    ? 'whitesmoke'
                    : '#e8e8e8',
                color:
                  selectedName || selectedFiles.size > 0 ? 'inherit' : '#aaa',
              }"
            >
              First
            </button>

            <button
              @click="badGrpClick"
              :style="{
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
              }"
            >
              Bad Grp
            </button>

            <button
              @click="clickInfo"
              :style="{
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
                '--btn-bg': showInfo ? '#ddd' : 'whitesmoke',
              }"
            >
              Info
            </button>

            <button
              @click="deleteSelected"
              :disabled="loading || (!selectedName && selectedFiles.size === 0)"
              title="Delete selected files"
              :style="{
                cursor:
                  !loading && (selectedName || selectedFiles.size > 0)
                    ? 'pointer'
                    : 'default',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
                '--btn-bg':
                  !loading && (selectedName || selectedFiles.size > 0)
                    ? 'whitesmoke'
                    : '#e8e8e8',
                color:
                  !loading && (selectedName || selectedFiles.size > 0)
                    ? 'inherit'
                    : '#aaa',
              }"
            >
              Del
            </button>
          </div>
        </div>

        <!-- Row 2: movie mode — title + First/Refresh/Del -->
        <div
          v-else
          style="
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-top: 0;
          "
        >
          <div class="pane-header-title">Local Movies</div>
          <div style="display: flex; align-items: center; gap: 10px">
            <button
              @click="clickSubs()"
              :style="{
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
                backgroundColor:
                  subsPending.length > 0 ? 'lightgray' : 'whitesmoke',
              }"
            >
              Subs
            </button>

            <button
              @click="clickEmb"
              :style="{
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
                backgroundColor: showEmb ? '#ddd' : 'whitesmoke',
              }"
            >
              EmbSub
            </button>

            <button
              @click="clickOpn"
              :style="{
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
                backgroundColor: showOpn ? '#ddd' : 'whitesmoke',
              }"
            >
              OpnSub
            </button>

            <button
              @click="clickAsr"
              :style="{
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
                backgroundColor: showAsr ? '#ddd' : 'whitesmoke',
              }"
            >
              Asr
            </button>

            <button
              @click="localFirstClick"
              :disabled="!selectedName && selectedFiles.size === 0"
              :style="{
                cursor:
                  selectedName || selectedFiles.size > 0
                    ? 'pointer'
                    : 'default',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
                '--btn-bg':
                  selectedName || selectedFiles.size > 0
                    ? 'whitesmoke'
                    : '#e8e8e8',
                color:
                  selectedName || selectedFiles.size > 0 ? 'inherit' : '#aaa',
              }"
            >
              First
            </button>

            <button
              @click="clickPlay"
              :disabled="selectedFiles.size === 0 && !selectedName"
              :style="{
                cursor:
                  selectedFiles.size > 0 || selectedName
                    ? 'pointer'
                    : 'default',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
                '--btn-bg':
                  selectedFiles.size > 0 || selectedName
                    ? 'whitesmoke'
                    : '#e8e8e8',
                color:
                  selectedFiles.size > 0 || selectedName ? 'inherit' : '#aaa',
              }"
            >
              Play
            </button>

            <button
              @click="clickHist"
              :disabled="!historyReady"
              title="Show activity history"
              :style="{
                cursor: historyReady ? 'pointer' : 'default',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
                '--btn-bg': !historyReady
                  ? '#e8e8e8'
                  : showHist
                    ? '#ddd'
                    : 'whitesmoke',
                color: historyReady ? 'inherit' : '#aaa',
              }"
            >
              Hist
            </button>

            <button
              @click="clickView"
              :disabled="!viewReady"
              title="View text file"
              :style="{
                cursor: viewReady ? 'pointer' : 'default',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
                '--btn-bg': !viewReady
                  ? '#e8e8e8'
                  : showText
                    ? '#ddd'
                    : 'whitesmoke',
                color: viewReady ? 'inherit' : '#aaa',
              }"
            >
              View
            </button>

            <button
              @click="clickSwap"
              :disabled="!swapReady || loading"
              title="Make this .old/.alt file the active one"
              :style="{
                cursor: swapReady && !loading ? 'pointer' : 'default',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
                '--btn-bg': swapReady && !loading ? 'whitesmoke' : '#e8e8e8',
                color: swapReady && !loading ? 'inherit' : '#aaa',
              }"
            >
              Swap
            </button>

            <button
              @click="refresh"
              :disabled="loading"
              style="
                cursor: pointer;
                border-radius: 7px;
                padding: 4px 10px;
                border: 1px solid #bbb;
                background-color: whitesmoke;
              "
            >
              Refresh
            </button>

            <button
              @click="clickInfo"
              :style="{
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
                '--btn-bg': showInfo ? '#ddd' : 'whitesmoke',
              }"
            >
              Info
            </button>

            <button
              @click="deleteSelected"
              :disabled="loading || (!selectedName && selectedFiles.size === 0)"
              title="Delete selected files"
              :style="{
                cursor:
                  !loading && (selectedName || selectedFiles.size > 0)
                    ? 'pointer'
                    : 'default',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
                '--btn-bg':
                  !loading && (selectedName || selectedFiles.size > 0)
                    ? 'whitesmoke'
                    : '#e8e8e8',
                color:
                  !loading && (selectedName || selectedFiles.size > 0)
                    ? 'inherit'
                    : '#aaa',
              }"
            >
              Del
            </button>
          </div>
        </div>
      </div>

      <!-- Tree -->
      <div
        :style="{
          flex: '1 1 auto',
          overflow: 'auto',
          padding: '0px 8px',
        }"
      >
        <div
          v-if="error"
          style="color: red; margin: 10px 0"
        >
          {{ error }}
        </div>
        <tree-node
          v-for="node in tree"
          :key="node.name"
          :node="node"
          :ref="(el) => setNodeRef(el, node.name)"
          :copy-path="true"
          :selected="selectedFolders.has(node.name)"
          :selected-files="selectedFiles"
          @node-click="handleNodeClick"
        />
      </div>
    </div>

    <!-- Emb Pane -->
    <div
      id="embPane"
      v-show="showEmb"
      :style="{
        flex: '1 1 50%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: '#fafafa',
        color: '#000',
        fontFamily: 'monospace',
        padding: '10px',
        borderLeft: '1px solid #ddd',
      }"
    >
      <div
        style="
          flex: 0 0 auto;
          border-bottom: 1px solid #ddd;
          padding-bottom: 5px;
          margin-bottom: 5px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        "
      >
        <div>
          <strong>Emb Output</strong>
          <span v-if="embBusy">(Running)</span>
        </div>
        <div>
          <button
            @click="applyEmb"
            :disabled="embBusy"
            :style="{
              cursor: embBusy ? 'not-allowed' : 'pointer',
              borderRadius: '4px',
              padding: '2px 8px',
              border: '1px solid #bbb',
              backgroundColor: 'whitesmoke',
              marginRight: '5px',
              opacity: embBusy ? 0.6 : 1,
            }"
          >
            Apply
          </button>
          <button
            @click="clearEmbLog"
            :style="{
              cursor: 'pointer',
              borderRadius: '4px',
              padding: '2px 8px',
              border: '1px solid #bbb',
              backgroundColor: 'whitesmoke',
              marginRight: '5px',
            }"
          >
            Clear
          </button>
          <button
            @click="showEmb = false"
            title="Close"
            :style="{
              cursor: 'pointer',
              borderRadius: '4px',
              padding: '2px 8px',
              border: '1px solid #bbb',
              backgroundColor: 'whitesmoke',
              fontWeight: 'bold',
              marginLeft: '5px',
            }"
          >
            ✕
          </button>
        </div>
      </div>
      <div
        ref="embScroll"
        style="
          flex: 1 1 auto;
          overflow: auto;
          white-space: pre-wrap;
          background-color: #fff;
          border: 1px solid #eee;
          padding: 4px;
        "
      >
        {{ embLogs }}
      </div>
    </div>

    <!-- Open (OpenSubtitles search) Pane -->
    <div
      id="opnPane"
      v-show="showOpn"
      :style="{
        flex: '1 1 50%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: '#fafafa',
        color: '#000',
        fontFamily: 'monospace',
        padding: '10px',
        borderLeft: '1px solid #ddd',
      }"
    >
      <div
        style="
          flex: 0 0 auto;
          border-bottom: 1px solid #ddd;
          padding-bottom: 5px;
          margin-bottom: 5px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        "
      >
        <div>
          <strong>OpenSubs Search</strong>
          <span v-if="opnBusy"> (Searching...)</span>
        </div>
        <div>
          <button
            @click="applyOpn"
            :disabled="opnBusy"
            :style="{
              cursor: opnBusy ? 'not-allowed' : 'pointer',
              borderRadius: '4px',
              padding: '2px 8px',
              border: '1px solid #bbb',
              backgroundColor: 'whitesmoke',
              marginRight: '5px',
              opacity: opnBusy ? 0.6 : 1,
            }"
          >
            Apply
          </button>
          <button
            @click="clearOpn"
            :style="{
              cursor: 'pointer',
              borderRadius: '4px',
              padding: '2px 8px',
              border: '1px solid #bbb',
              backgroundColor: 'whitesmoke',
              marginRight: '5px',
            }"
          >
            Clear
          </button>
          <button
            @click="showOpn = false"
            title="Close"
            :style="{
              cursor: 'pointer',
              borderRadius: '4px',
              padding: '2px 8px',
              border: '1px solid #bbb',
              backgroundColor: 'whitesmoke',
              fontWeight: 'bold',
              marginLeft: '5px',
            }"
          >
            ✕
          </button>
        </div>
      </div>
      <div
        style="
          flex: 1 1 auto;
          overflow: auto;
          background-color: #fff;
          border: 1px solid #eee;
          padding: 4px;
        "
      >
        <div
          v-if="opnBusy"
          style="color: #888; padding: 8px"
        >
          Searching...
        </div>
        <div
          v-else-if="!opnSearched"
          style="color: #888; padding: 8px"
        >
          Press Apply to search
        </div>
        <div
          v-else-if="opnResults.length === 0"
          style="color: #888; padding: 8px"
        >
          No results
        </div>
        <template v-else>
          <div
            v-for="group in opnResults"
            :key="group.videoPath"
            style="margin-bottom: 12px"
          >
            <div
              style="
                font-weight: bold;
                margin-bottom: 4px;
                word-break: break-all;
              "
            >
              {{ group.videoPath.split("/").pop() }}
            </div>
            <div
              v-if="group.error"
              style="color: red; padding-left: 8px"
            >
              {{ group.error }}
            </div>
            <div
              v-else-if="group.items.length === 0"
              style="color: #888; padding-left: 8px"
            >
              No results
            </div>
            <div
              v-else
              v-for="item in group.items"
              :key="item.file_id"
              style="
                padding: 2px 8px;
                border-bottom: 1px solid #f0f0f0;
                font-size: 0.92em;
              "
            >
              {{ item.release }} <span style="color: #888">{{ item.tag }}</span>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Asr Pane -->
    <div
      id="asrPane"
      v-show="showAsr"
      :style="{
        flex: '1 1 50%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: '#fafafa',
        color: '#000',
        fontFamily: 'monospace',
        padding: '10px',
        borderLeft: '1px solid #ddd',
      }"
    >
      <div
        style="
          flex: 0 0 auto;
          border-bottom: 1px solid #ddd;
          padding-bottom: 5px;
          margin-bottom: 5px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        "
      >
        <div>
          <strong>ASR Output</strong>
          <span v-if="asrBusy">(Running)</span>
          <span
            v-if="asrQueueLen > 0"
            style="margin-left: 6px; font-size: 0.85em; color: #555"
            >[Queue: {{ asrQueueLen }}]</span
          >
        </div>
        <div>
          <button
            @click="clickQueue"
            :style="{
              cursor: 'pointer',
              borderRadius: '4px',
              padding: '2px 8px',
              border: '1px solid #bbb',
              '--btn-bg': asrQueueMode ? 'lightgray' : 'whitesmoke',
              marginRight: '5px',
            }"
          >
            Queue
          </button>
          <button
            @click="startAsr"
            :style="{
              cursor: 'pointer',
              borderRadius: '4px',
              padding: '2px 8px',
              border: '1px solid #bbb',
              backgroundColor: 'whitesmoke',
              marginRight: '5px',
            }"
          >
            Start
          </button>
          <button
            @click="abortAsrRun"
            :disabled="!asrBusy"
            title="Stop the running ASR job"
            :style="{
              cursor: asrBusy ? 'pointer' : 'default',
              borderRadius: '4px',
              padding: '2px 8px',
              border: '1px solid #bbb',
              opacity: asrBusy ? 1 : 0.5,
              backgroundColor: 'whitesmoke',
              marginRight: '5px',
            }"
          >
            Abort
          </button>
          <button
            @click="clearAsrLog"
            :style="{
              cursor: 'pointer',
              borderRadius: '4px',
              padding: '2px 8px',
              border: '1px solid #bbb',
              backgroundColor: 'whitesmoke',
              marginRight: '5px',
            }"
          >
            Clear
          </button>
          <button
            @click="showAsr = false"
            title="Close"
            :style="{
              cursor: 'pointer',
              borderRadius: '4px',
              padding: '2px 8px',
              border: '1px solid #bbb',
              backgroundColor: 'whitesmoke',
              fontWeight: 'bold',
              marginLeft: '5px',
            }"
          >
            ✕
          </button>
        </div>
      </div>
      <div
        v-if="!asrQueueMode"
        ref="asrScroll"
        style="
          flex: 1 1 auto;
          overflow: auto;
          white-space: pre-wrap;
          background-color: #fff;
          border: 1px solid #eee;
          padding: 4px;
        "
      >
        {{ asrDisplay }}
      </div>
      <div
        v-else
        style="
          flex: 1 1 auto;
          overflow: auto;
          background-color: #fff;
          border: 1px solid #eee;
          padding: 4px;
        "
      >
        <div
          v-if="asrQueueEntries.length === 0"
          style="color: #888; padding: 8px"
        >
          Queue is empty
        </div>
        <div
          v-for="entry in sortedAsrQueue"
          :key="entry.videoPath"
          @click="removeFromQueue(entry.videoPath)"
          :style="{
            cursor: 'pointer',
            padding: '6px 8px',
            borderBottom: '1px solid #eee',
            display: 'flex',
            flexDirection: 'column',
          }"
        >
          <span style="font-size: 14px; word-break: break-all">{{
            entry.videoPath.split("/").pop()
          }}</span>
          <span style="font-size: 14px; color: #666">
            Added by {{ entry.source || "unknown" }}, at
            {{ formatAsrTime(entry.addedAt)
            }}<span
              v-if="
                asrBusy && asrQueueEntries[0]?.videoPath === entry.videoPath
              "
              style="color: #c77"
              >, Processing</span
            >
          </span>
        </div>
      </div>
    </div>

    <!-- Fix Pane -->
    <div
      id="fixPane"
      v-show="showFix"
      :style="{
        flex: '1 1 50%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: '#fafafa',
        color: '#000',
        fontFamily: 'monospace',
        padding: '10px',
        borderLeft: '1px solid #ddd',
      }"
    >
      <div
        style="
          flex: 0 0 auto;
          border-bottom: 1px solid #ddd;
          padding-bottom: 5px;
          margin-bottom: 5px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        "
      >
        <div>
          <strong>FFMPEG Output</strong> <span v-if="fixBusy">(Running)</span>
        </div>
        <div>
          <button
            @click="startFix"
            :disabled="fixBusy"
            :style="{
              cursor: fixBusy ? 'not-allowed' : 'pointer',
              borderRadius: '4px',
              padding: '2px 8px',
              border: '1px solid #bbb',
              backgroundColor: 'whitesmoke',
              marginRight: '5px',
              opacity: fixBusy ? 0.6 : 1,
            }"
          >
            Start
          </button>
          <button
            @click="clearFixLog"
            :style="{
              cursor: 'pointer',
              borderRadius: '4px',
              padding: '2px 8px',
              border: '1px solid #bbb',
              backgroundColor: 'whitesmoke',
              marginRight: '5px',
            }"
          >
            Clear
          </button>
          <button
            @click="killFix"
            :disabled="!fixBusy"
            :style="{
              cursor: !fixBusy ? 'not-allowed' : 'pointer',
              borderRadius: '4px',
              padding: '2px 8px',
              border: '1px solid #bbb',
              backgroundColor: 'whitesmoke',
              opacity: !fixBusy ? 0.6 : 1,
            }"
          >
            Kill
          </button>
          <button
            @click="showFix = false"
            title="Close"
            :style="{
              cursor: 'pointer',
              borderRadius: '4px',
              padding: '2px 8px',
              border: '1px solid #bbb',
              backgroundColor: 'whitesmoke',
              fontWeight: 'bold',
              marginLeft: '5px',
            }"
          >
            ✕
          </button>
        </div>
      </div>
      <div
        ref="fixScroll"
        style="
          flex: 1 1 auto;
          overflow: auto;
          white-space: pre-wrap;
          background-color: #fff;
          border: 1px solid #eee;
          padding: 4px;
        "
      >
        {{ fixLogs }}
      </div>
    </div>

    <!-- Text View Pane -->
    <div
      id="textViewPane"
      v-show="showText"
      :style="{
        flex: '1 1 50%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: '#fafafa',
        color: '#000',
        fontFamily: 'monospace',
        padding: '10px',
        borderLeft: '1px solid #ddd',
      }"
    >
      <div
        style="
          flex: 1 1 auto;
          overflow: auto;
          white-space: pre;
          background-color: #fff;
          border: 1px solid #eee;
          padding: 4px;
        "
      >
        {{ textLoading ? "Loading..." : textContent }}
      </div>
    </div>

    <!-- History Pane -->
    <div
      id="historyPane"
      v-show="showHist"
      :style="{
        flex: '1 1 50%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: '#fafafa',
        color: '#000',
        fontFamily: 'monospace',
        padding: '10px',
        borderLeft: '1px solid #ddd',
      }"
    >
      <div
        style="
          flex: 1 1 auto;
          overflow: auto;
          white-space: pre;
          background-color: #fff;
          border: 1px solid #eee;
          padding: 4px;
          font-size: 14.3px;
        "
      >
        {{ histLoading ? "Loading..." : histContent }}
      </div>
    </div>

    <!-- Info Pane -->
    <div
      id="infoPane"
      v-show="showInfo"
      :style="{
        flex: '1 1 50%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: '#fafafa',
        color: '#000',
        fontFamily: 'monospace',
        padding: '10px',
        borderLeft: '1px solid #ddd',
      }"
    >
      <div
        style="
          flex: 0 0 auto;
          border-bottom: 1px solid #ddd;
          padding-bottom: 5px;
          margin-bottom: 5px;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        "
      >
        <div style="min-width: 0; margin-right: 8px; overflow: hidden">
          <template v-if="infoMultiFiles.length > 0">
            <div style="white-space: pre-wrap; word-break: break-word">
              {{ infoMultiTitle }}
            </div>
            <div
              v-if="infoMultiMeta"
              style="margin-top: 2px"
            >
              {{ infoMultiMeta }}
            </div>
          </template>
          <template v-else>
            <div style="white-space: pre-wrap; word-break: break-word">
              {{ wrapFileName(infoFileName) }}
            </div>
            <div
              v-if="infoFileMeta"
              style="margin-top: 2px"
            >
              {{ infoFileMeta }}
            </div>
          </template>
        </div>
        <button
          @click="showInfo = false"
          title="Close"
          :style="{
            cursor: 'pointer',
            borderRadius: '4px',
            padding: '2px 8px',
            border: '1px solid #bbb',
            backgroundColor: 'whitesmoke',
            fontWeight: 'bold',
            flexShrink: 0,
          }"
        >
          ✕
        </button>
      </div>
      <div
        style="
          flex: 1 1 auto;
          overflow: auto;
          background-color: #fff;
          border: 1px solid #eee;
          padding: 4px;
          font-size: 12px;
        "
      >
        <span
          v-if="infoLoading"
          style="color: #666"
          >Loading...</span
        >
        <template v-else-if="infoMultiFiles.length > 0">
          <div
            v-for="(f, idx) in infoMultiFiles"
            :key="idx"
            style="
              padding: 3px 2px;
              border-bottom: 1px solid #eee;
              line-height: 1.5;
            "
          >
            <div
              style="
                font-family: sans-serif;
                font-size: 13px;
                white-space: pre-wrap;
                word-break: break-word;
              "
            >
              {{ wrapFileName(f.name) }}
            </div>
            <div
              v-if="f.meta"
              style="color: #555; font-size: 11px"
            >
              {{ f.meta }}
            </div>
          </div>
        </template>
        <template v-else-if="!infoFileName && infoText">
          <span style="color: #888">{{ infoText }}</span>
        </template>
        <template v-else-if="!infoFileName">
          <span style="color: #888">No files selected</span>
        </template>
        <template v-else>
          <div
            v-for="(item, idx) in infoLines"
            :key="idx"
            @click="infoSelectedLine = idx"
            :style="{
              backgroundColor:
                infoSelectedLine === idx ? '#fffde7' : 'transparent',
              whiteSpace: 'pre-wrap',
              lineHeight: '1.5',
              padding: '0 2px',
              cursor: 'default',
              minHeight: '1.5em',
              fontWeight:
                item.line &&
                !item.line.includes(':') &&
                item.line.trim() === item.line &&
                item.line.trim().length > 0
                  ? 'bold'
                  : 'normal',
              fontFamily: /^=+$/.test(item.line)
                ? 'monospace'
                : item.line &&
                    !item.line.includes(':') &&
                    item.line.trim() === item.line &&
                    item.line.trim().length > 0
                  ? 'sans-serif'
                  : 'inherit',
              fontSize:
                item.line &&
                !item.line.includes(':') &&
                item.line.trim() === item.line &&
                item.line.trim().length > 0
                  ? '13px'
                  : 'inherit',
              textDecoration:
                item.line &&
                !item.line.includes(':') &&
                item.line.trim() === item.line &&
                item.line.trim().length > 0 &&
                !/^=+$/.test(item.line)
                  ? 'underline'
                  : 'none',
              color: 'inherit',
            }"
          >
            {{ item.line || "\u00a0" }}
          </div>
        </template>
      </div>
    </div>

    <!-- Toast -->
    <div
      v-if="toastMessage"
      :style="{
        position: 'fixed',
        top: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: '#333',
        color: '#fff',
        padding: '12px 24px',
        borderRadius: '8px',
        fontSize: '15px',
        fontWeight: 'bold',
        zIndex: 10000,
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      }"
    >
      {{ toastMessage }}
    </div>
  </div>
</template>

<script>
import TreeNode from "./tree-node.vue";
import { config } from "../config.js";
import {
  deletePath,
  handleAsr,
  handleFix,
  embApply,
  enqueueSubs,
  enqueueGenSrt,
  generateEmb,
  getAsrLog,
  getAsrQueue,
  getLocalHistory,
  addToAsrQueue,
  abortAsr,
  openChannel,
  removeFromAsrQueue,
  killAsrProcess,
  searchOpn,
  toggleBadGroup,
} from "../srvr.js";
import evtBus from "../evtBus.js";
import * as util from "../util.js";
import parseTorrentTitle from "parse-torrent-title";
import { unilog, logHere } from "../log.js";

const TEXT_VIEW_MAX_BYTES = 2 * 1024 * 1024;
// info pane shows only the head of a text file
const TEXT_INFO_MAX_CHARS = 2048;
const VIDEO_EXT_RE = /\.(mkv|mp4|avi|m4v|mov|wmv|mpg|mpeg|ts|m2ts|webm)$/i;
// trailing chain of `.old` / `.alt` markers, e.g. ".old", ".old.old", ".alt"
const OLD_SUFFIX_RE = /^(.+?)((?:\.(?:old|alt))+)$/i;

// --- smartTitleMatch Helpers (copied from packages/share) ---

export default {
  name: "Local",
  components: { TreeNode },
  props: {
    active: Boolean,
    show: Object,
    allShows: Array,
    movieMode: { type: Boolean, default: false },
  },
  data() {
    return {
      tree: [],
      selectedName: null, // For top-level folder selection (first of selectedFolders)
      selectedFolders: new Set(), // Multi-select top-level folders
      selectedFiles: new Set(), // For file selection inside a folder
      selectionParentPath: null, // To enforce "same folder" rule
      lastSelectedFile: null, // For check-range logic
      loading: false,
      error: null,
      hasLoaded: false,
      searchInput: "",
      renameInput: "",

      // Asr
      showAsr: false,
      asrLineObjs: [], // { text, detail } — detail lines are the Tail progress
      asrBusy: false,
      activeAsrPath: null,
      ignoreLogs: false,
      asrQueueMode: false,
      asrQueueEntries: [],
      asrQueueLen: 0,
      asrLogChannel: null,
      asrQueueChannel: null,

      // Emb
      showEmb: false,
      embLogs: "",
      embBusy: false,
      embLogChannel: null,

      // Open (OpenSubtitles search)
      showOpn: false,
      opnResults: [],
      opnBusy: false,
      opnSearched: false,

      // Fix (ffmpeg)
      showFix: false,
      fixLogs: "",
      fixBusy: false,
      activeFixPath: null,
      ignoreFixLogs: false,
      fixLogOffset: 0,
      fixLogChannel: null,

      // Subs progress tracking
      subsPending: [],
      subsProgressChannel: null,

      // Info pane
      showInfo: false,
      infoText: "",
      infoFileName: "",
      infoFileMeta: "",
      infoLoading: false,
      infoSelectedLine: null,
      infoMultiFiles: [], // [{name, meta}] for multi-file display
      infoMultiTitle: "", // common prefix of multi-file names
      infoMultiMeta: "", // aggregated size | oldest date | newest date

      // Text view pane
      showText: false,
      textContent: "",
      textLoading: false,
      textProbeOk: false, // selected file passed the is-text probe

      // History pane
      showHist: false,
      histContent: "",
      histLoading: false,

      // Toast
      toastMessage: "",
      toastTimer: null,
    };
  },
  created() {
    this.nodeRefs = new Map();
  },
  beforeUpdate() {
    this.nodeRefs.clear();
  },
  watch: {
    show(val) {},
    movieMode() {
      this.hasLoaded = false;
      this.tree = [];
      this.selectedFolders = new Set();
      this.selectedFiles = new Set();
      this.fetchFiles();
    },
    selectedName() {
      this.handleSelectionChanged();
    },
    selectedFiles: {
      deep: true,
      handler() {
        this.handleSelectionChanged();
      },
    },
    active(val) {
      if (val && !this.loading) {
        this.fetchFiles();
      }
    },
    asrDisplay() {
      const el = this.$refs.asrScroll;
      if (!el) return;
      // Auto-scroll only if we are already near the bottom
      const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      if (isAtBottom) {
        this.$nextTick(() => {
          this.scrollToAsrBottom();
        });
      }
    },
    showAsr(val) {
      if (val) {
        this.$nextTick(() => {
          this.scrollToAsrBottom();
        });
      }
    },
    embLogs() {
      const el = this.$refs.embScroll;
      if (!el) return;
      const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      if (isAtBottom) {
        this.$nextTick(() => {
          if (el) el.scrollTop = el.scrollHeight;
        });
      }
    },
    showEmb(val) {
      if (val) {
        this.$nextTick(() => {
          if (this.$refs.embScroll)
            this.$refs.embScroll.scrollTop = this.$refs.embScroll.scrollHeight;
        });
      }
    },
    fixLogs() {
      const el = this.$refs.fixScroll;
      if (!el) return;
      const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      if (isAtBottom) {
        this.$nextTick(() => {
          this.scrollToFixBottom();
        });
      }
    },
    showFix(val) {
      if (val) {
        this.$nextTick(() => {
          this.scrollToFixBottom();
        });
      }
    },
  },
  mounted() {
    if (this.active && !this.hasLoaded) {
      this.fetchFiles();
    }
    evtBus.off("fix-log", this.onFixLog);
    evtBus.on("fix-log", this.onFixLog);
    this.initAsrState();
    this.startAsrLogChannel();
    this.startAsrQueueChannel();
    this.startEmbLogChannel();
    this.startSubsProgressChannel();

    this._onLocalDelKey = () => {
      if (!this.loading && (this.selectedName || this.selectedFiles.size > 0))
        this.deleteSelected();
    };
    evtBus.on("localDelKey", this._onLocalDelKey);
    evtBus.on("localArrowKey", this.onLocalArrowKey);
  },
  unmounted() {
    evtBus.off("fix-log", this.onFixLog);
    evtBus.off("localArrowKey", this.onLocalArrowKey);
    this.stopFixPolling();
    this.stopAsrLogChannel();
    this.stopAsrQueueChannel();
    this.stopEmbLogChannel();
    this.stopSubsProgressChannel();
    if (this._onLocalDelKey) evtBus.off("localDelKey", this._onLocalDelKey);
  },
  computed: {
    // Rendered ASR output.
    asrDisplay() {
      return this.asrLineObjs
        .map((e) => (typeof e === "string" ? e : (e?.text ?? "")))
        .join("\n");
    },
    sortedAsrQueue() {
      return [...this.asrQueueEntries].sort(
        (a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0),
      );
    },
    // relPath of the single selected file, or null
    singleSelectedFile() {
      if (this.selectedFolders.size > 0) return null;
      if (this.selectedFiles.size !== 1) return null;
      const relPath = [...this.selectedFiles][0];
      const node = this.findNodeByPath(relPath);
      if (!node || node.type !== "file") return null;
      return relPath;
    },
    viewReady() {
      const relPath = this.singleSelectedFile;
      if (!relPath) return false;
      const node = this.findNodeByPath(relPath);
      if (node.size == null || node.size > TEXT_VIEW_MAX_BYTES) return false;
      return this.textProbeOk;
    },
    historyReady() {
      const relPath = this.singleSelectedFile;
      return !!relPath && VIDEO_EXT_RE.test(relPath);
    },
    // { relPath, basePath } when the one selected file is an .old/.alt sidecar
    // of a video file sitting beside it, else null
    swapInfo() {
      const relPath = this.singleSelectedFile;
      if (!relPath) return null;
      const parts = relPath.split("/");
      const m = OLD_SUFFIX_RE.exec(parts[parts.length - 1]);
      if (!m) return null;
      const baseName = m[1];
      if (!VIDEO_EXT_RE.test(baseName)) return null;
      const basePath = [...parts.slice(0, -1), baseName].join("/");
      const baseNode = this.findNodeByPath(basePath);
      if (!baseNode || baseNode.type !== "file") return null;
      return { relPath, basePath };
    },
    swapReady() {
      return !!this.swapInfo;
    },
    infoLines() {
      if (!this.infoText) return [];
      const lines = this.infoText.split("\n");
      let inVideo = false;
      return lines.map((line) => {
        if (
          line &&
          !line.includes(":") &&
          line.trim() === line &&
          line.trim().length > 0 &&
          !/^=+$/.test(line)
        ) {
          inVideo = /^Video\b/.test(line.trim());
        }
        return { line, inVideo };
      });
    },
  },
  methods: {
    showToastError(msg) {
      this.toastMessage = `❌ ${String(msg || "")}`;
      if (this.toastTimer) clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        this.toastMessage = "";
        this.toastTimer = null;
      }, 5000);
    },
    showToastInfo(msg) {
      this.toastMessage = String(msg || "");
      if (this.toastTimer) clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        this.toastMessage = "";
        this.toastTimer = null;
      }, 5000);
    },
    wrapFileName(name) {
      return util.wrapFileName(name);
    },
    formatAsrTime(ts) {
      if (!ts) return "";
      const d = new Date(ts);
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      const parts = fmt.formatToParts(d);
      const p = {};
      for (const { type, value } of parts) p[type] = value;
      let hh = p.hour;
      if (hh === "24") hh = "00";
      return `${p.month}/${p.day} ${hh}:${p.minute}:${p.second}`;
    },
    formatFileSize(bytes) {
      if (bytes == null) return "";
      if (bytes >= 1024 * 1024 * 1024)
        return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
      if (bytes >= 1024 * 1024)
        return (bytes / (1024 * 1024)).toFixed(1) + " MB";
      if (bytes >= 1024) return (bytes / 1024).toFixed(0) + " KB";
      return bytes + " B";
    },
    scrollToAsrBottom() {
      const el = this.$refs.asrScroll;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    },
    scrollToFixBottom() {
      const el = this.$refs.fixScroll;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    },
    async fetchFiles() {
      this.loading = true;
      this.error = null;
      try {
        const endpoint = this.movieMode
          ? "/api/local/movies"
          : "/api/local/files";
        const url = `${config.torrentsApiUrl}${endpoint}`;
        const res = await fetch(url);
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`HTTP ${res.status}: ${txt}`);
        }
        const rootTree = await res.json();
        this.tree = this.processTree(rootTree);
        this.hasLoaded = true;
      } catch (e) {
        this.error = e.message || "Failed to load files";
      } finally {
        this.loading = false;
      }
    },
    processTree(nodes) {
      if (!nodes) return [];

      // Sort nodes first.
      // - If nodes match "Season X", use numeric sort (S1 < S2 < S10).
      // - Otherwise use standard ASCII sort (30 Rock < 3rd Rock).
      nodes.sort((a, b) => {
        // Group folders before files
        const aIsFolder =
          a.type === "folder" || (a.children && a.children.length > 0);
        const bIsFolder =
          b.type === "folder" || (b.children && b.children.length > 0);
        if (aIsFolder && !bIsFolder) return -1;
        if (!aIsFolder && bIsFolder) return 1;

        const seasonRegex = /^Season \s*(\d+)$/i;
        const ma = seasonRegex.exec(a.name);
        const mb = seasonRegex.exec(b.name);

        if (ma && mb) {
          const na = parseInt(ma[1], 10);
          const nb = parseInt(mb[1], 10);
          return na - nb;
        }
        // Fallback to standard sort (case insensitive? or just standard?)
        // User wants "30 Rock" < "3rd Rock" which suggests standard string comparison or ASCII.
        // localeCompare usually handles this "correctly" for languages, but let's check ASCII specific cases.
        // In ASCII '0' < 'r', so "30 Rock" comes before "3rd Rock".
        // localeCompare generally respects this.
        return a.name.localeCompare(b.name, undefined, { numeric: false });
      });

      nodes.forEach((n) => {
        if (n.children) n.children = this.processTree(n.children);
      });

      // For "Season X" folders, we re-structure children into groups (thirds)
      // Check if current level is inside a "Season X" or if we are iterating "Season X" folders?
      // Wait, the logic is: "in local pane file list inside every folder named 'Season <season number>' sort the files..."
      // So if *we* (the list of nodes `nodes`) are children of a Season X folder...
      // But we don't know who our parent is here easily unless we pass ctx.
      // Alternatively, we look for folders named "Season ..." and process THEIR children.

      // Actually, standard iteration:
      // If `n` is a folder and its name matches "Season \d+", then process `n.children`.
      return nodes.map((node) => {
        if (node.type === "folder" && /^Season \d+$/i.test(node.name)) {
          // Re-sort children
          // Split into video, srt, other.
          const videos = [];
          const subs = [];
          const others = [];

          const VIDEO_EXTS = new Set([
            "mkv",
            "avi",
            "mp4",
            "m4v",
            "mov",
            "wmv",
            "webm",
            "mpg",
            "mpeg",
            "ts",
            "m2ts",
          ]);

          const getExt = (name) => {
            const s = String(name || "");
            const i = s.lastIndexOf(".");
            if (i < 0) return "";
            return s.slice(i + 1).toLowerCase();
          };

          const isVideo = (name) => VIDEO_EXTS.has(getExt(name));
          const isSrt = (name) =>
            getExt(name) === "srt" || name.toLowerCase().endsWith(".chosen");

          const getEpisode = (name) => {
            let parsedPtt = null;
            try {
              parsedPtt = parseTorrentTitle.parse(name);
            } catch (e) {}
            const se = util.parseFileSeasonEpisode(name, "", parsedPtt, null);
            if (se && se.episode != null) return se.episode;
            return 999999;
          };

          const sortByEpisode = (a, b) => {
            const epA = getEpisode(a.name);
            const epB = getEpisode(b.name);
            if (epA !== epB) return epA - epB;
            return a.name.localeCompare(b.name, undefined, {
              numeric: true,
              sensitivity: "base",
            });
          };

          const folders = (node.children || []).filter(
            (c) => c.type === "folder",
          );
          const files = (node.children || []).filter((c) => c.type === "file");

          for (const f of files) {
            if (isVideo(f.name)) videos.push(f);
            else if (isSrt(f.name)) subs.push(f);
            else others.push(f);
          }

          videos.sort(sortByEpisode);
          subs.sort(sortByEpisode);
          others.sort(sortByEpisode);

          // Insert separators.
          // How to representation separators in `tree-node`?
          // We can add a dummy node with type="separator". We need to update tree-node to render it.

          const newChildren = [...folders];
          if (videos.length) {
            newChildren.push(...videos);
          }
          if (subs.length) {
            if (newChildren.length)
              newChildren.push({ type: "separator", name: "sep1" });
            newChildren.push(...subs);
          }
          if (others.length) {
            if (newChildren.length)
              newChildren.push({ type: "separator", name: "sep2" });
            newChildren.push(...others);
          }
          node.children = newChildren;
        }
        return node;
      });
    },
    setNodeRef(el, name) {
      if (el) this.nodeRefs.set(name, el);
    },
    // Keyboard right arrow — open (expand) the first selected folder.
    onLocalArrowKey() {
      const firstFolder = [...this.selectedFolders][0];
      if (!firstFolder) return;
      const cmp = this.nodeRefs.get(firstFolder);
      if (!cmp) return;
      cmp.expand();
      this.$nextTick(() => {
        cmp.$el?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    toShow() {
      // 1. Determine selected top-level folder
      let folderName = this.selectedName;
      if (!folderName && this.selectedFiles.size > 0) {
        // Assume first file's root
        const path = [...this.selectedFiles][0];
        if (path) {
          const parts = path.split("/");
          if (parts.length > 0) folderName = parts[0];
        }
      }

      if (!folderName) {
        alert("Please select a file or folder first.");
        return;
      }

      if (!this.allShows || !this.allShows.length) {
        unilog(1095, "No shows loaded.");
        return;
      }

      // 2. Find matching show
      // Folder -> Show: forceChoice = true
      const match = util.smartTitleMatch(
        folderName,
        this.allShows || [],
        null,
        true,
      );

      if (match) {
        this.$emit("select-show", match);
      } else {
        alert(`No show found matching folder "${folderName}"`);
      }
    },
    onRenameFocus() {
      if (this.renameInput) return;
      if (this.selectedFiles.size === 1) {
        const fullPath = Array.from(this.selectedFiles)[0];
        const parts = fullPath.split("/");
        const fileName = parts.pop();
        this.renameInput = fileName;
      }
    },
    async renameLocalFile() {
      if (!this.renameInput) return;
      if (this.selectedFiles.size !== 1) return;

      const oldPath = Array.from(this.selectedFiles)[0];
      const newName = this.renameInput.trim();
      if (!newName) return;

      const parts = oldPath.split("/");
      const oldName = parts[parts.length - 1];
      if (oldName === newName) return;

      this.loading = true;
      try {
        const url = `${config.torrentsApiUrl}/api/local/rename`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldPath, newName }),
        });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(txt);
        }
        this.renameInput = "";
        this.selectedFiles.clear();
        this.lastSelectedFile = null;
        await this.fetchFiles();
      } catch (e) {
        unilog(
          1002,
          `Rename failed for ${oldName} -> ${newName}: ${e?.message || String(e)}`,
        );
        this.error = e.message || "Rename failed";
        this.loading = false;
      }
    },
    async clickSwap() {
      const info = this.swapInfo;
      if (!info) return;
      const sidecarName = info.relPath.split("/").pop();

      this.loading = true;
      try {
        const url = `${config.torrentsApiUrl}/api/local/swap`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            relPath: info.relPath,
            movieMode: this.movieMode,
          }),
        });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(txt);
        }
        this.selectedFiles.clear();
        this.lastSelectedFile = null;
        await this.fetchFiles();
      } catch (e) {
        unilog(2084, `swap failed for ${sidecarName}: ${e?.message || String(e)}`);
        this.error = e.message || "Swap failed";
        this.loading = false;
      }
    },
    searchLocal() {
      const raw = this.searchInput.trim();
      if (!raw) return;
      const norm = raw
        .replace(/[^a-zA-Z\s]/g, "")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, " ");
      if (!norm) return;

      for (const node of this.tree) {
        const nodeName = (node.name || "")
          .replace(/[^a-zA-Z\s]/g, "")
          .toLowerCase()
          .trim()
          .replace(/\s+/g, " ");
        if (!nodeName.includes(norm)) continue;

        this.selectedName = node.name;
        this.selectedFiles.clear();
        this.selectionParentPath = null;
        this.lastSelectedFile = null;

        this.$nextTick(() => {
          const cmp = this.nodeRefs.get(node.name);
          if (cmp && cmp.$el) {
            cmp.$el.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        });
        return;
      }
    },
    async selectTopLevel() {
      // 1. Get current show name
      const showName = this.show ? this.show.name : null;
      if (!showName) {
        // Fallback or ignore if no show selected
        unilog(1094, "No current show selected.");
        return;
      }

      // 2. Find matching top-level folder
      let folderName = null;
      if (this.tree && this.tree.length) {
        // Show -> Folder: forceChoice = true
        const match = util.smartTitleMatch(showName, this.tree, null, true);
        if (match) folderName = match;
      }

      if (!folderName) {
        unilog(1093, `Folder "${showName}" not found in tree.`);
        return;
      }

      const nodeIndex = this.tree.findIndex((n) => n.name === folderName);
      if (nodeIndex === -1) {
        unilog(1092, `Folder "${folderName}" not found in tree.`);
        return;
      }
      const node = this.tree[nodeIndex];

      // 4. Select and expand
      this.selectedName = node.name;
      this.selectedFiles.clear();
      this.selectionParentPath = null;
      this.lastSelectedFile = null;

      // 5. Expand target & Collapse others
      this.nodeRefs.forEach((cmp, name) => {
        if (name !== folderName) {
          if (typeof cmp.collapse === "function") {
            cmp.collapse();
          }
        } else {
          if (typeof cmp.expand === "function") {
            cmp.expand();
          }
        }
      });

      // 6. Wait for DOM updates (collapsing) then Scroll
      this.$nextTick(() => {
        const cmp = this.nodeRefs.get(folderName);
        if (cmp && cmp.$el) {
          cmp.$el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    },
    countRecursive(node) {
      if (!node) return 0;
      if (node.type === "file") return 1;
      if (node.children) {
        return node.children.reduce(
          (acc, c) => acc + this.countRecursive(c),
          0,
        );
      }
      return 0;
    },
    findNodeByPath(relPath) {
      if (!relPath) return null;
      const parts = relPath.split("/");
      let current = this.tree;
      let node = null;
      for (const part of parts) {
        if (!current) return null;
        node = current.find((n) => n.name === part);
        if (!node) return null;
        current = node.children;
      }
      return node;
    },
    async deleteSelected() {
      if (this.selectedFolders.size === 0 && this.selectedFiles.size === 0)
        return;

      let fileCount = 0;
      let pathsToDelete = [];

      if (this.selectedFolders.size > 0) {
        // One or more top-level folders selected
        for (const folderName of this.selectedFolders) {
          const node = this.tree.find((n) => n.name === folderName);
          if (node) {
            fileCount += this.countRecursive(node);
            pathsToDelete.push(folderName);
          }
        }
      } else {
        // Selected files/folders
        for (const relPath of this.selectedFiles) {
          const node = this.findNodeByPath(relPath);
          if (node) {
            fileCount += this.countRecursive(node);
          } else {
            // If strictly not found, assume 1 (maybe a loose file?) or 0.
            // But if it's in selectedFiles it should be in the tree presumably.
            // Fallback to 1 just to be safe in count logic.
            fileCount += 1;
          }
          pathsToDelete.push(relPath);
        }
      }

      const itemLabel = pathsToDelete.length === 1 ? "item" : "items";
      const fileLabel = fileCount === 1 ? "file" : "files";
      const confirmMsg = `Are you sure you want to delete ${pathsToDelete.length} ${itemLabel} containing ${fileCount} ${fileLabel}?\nThis cannot be undone.`;

      if (!confirm(confirmMsg)) return;

      this.loading = true;
      try {
        const root = this.movieMode ? "/mnt/media/movies" : "/mnt/media/tv";
        for (const relPath of pathsToDelete) {
          const fullPath = `${root}/${relPath}`;
          await deletePath(fullPath);
        }

        this.selectedFiles.clear();
        this.selectedName = null; // Clear top level selection too
        this.selectedFolders = new Set();
        this.selectionParentPath = null;
        this.lastSelectedFile = null;
        evtBus.emit("localFoldersChanged");
        await this.refresh();
      } catch (e) {
        unilog(1003, "Error deleting files:", e);
        alert(`Error deleting files: ${e.message}`);
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },
    refresh() {
      return this.fetchFiles();
    },
    handleNodeClick({ node, depth, fullPath, ctrlKey, shiftKey }) {
      // 1. Top-level folder selection (folders at depth 0 only)
      if (depth === 0 && node.type !== "file") {
        // If clicking top-level folder, clear any file selection context
        this.selectedFiles.clear();
        this.selectionParentPath = null;
        if (ctrlKey) {
          if (this.selectedFolders.has(node.name)) {
            this.selectedFolders.delete(node.name);
          } else {
            this.selectedFolders.add(node.name);
          }
          this.selectedFolders = new Set(this.selectedFolders);
          this.selectedName = [...this.selectedFolders][0] || null;
        } else {
          this.selectedFolders = new Set([node.name]);
          this.selectedName = node.name;
        }
        this.lastSelectedFile = null;
        return;
      }

      // 2. File OR Folder selection
      // Allow selecting nested folders too
      if (node.type === "file" || node.type === "folder") {
        const parentPath = fullPath.substring(0, fullPath.lastIndexOf("/"));

        // If switching folders, or if a top-level folder was previously selected, reset.
        if (this.selectedName) {
          this.selectedName = null;
          this.selectedFolders = new Set();
        }

        if (
          this.selectionParentPath &&
          this.selectionParentPath !== parentPath &&
          !this.selectedFiles.has(fullPath)
        ) {
          this.selectedFiles.clear();
          this.selectionParentPath = null;
        }

        if (!this.selectionParentPath) {
          this.selectionParentPath = parentPath;
        }

        if (
          shiftKey &&
          this.lastSelectedFile &&
          this.selectionParentPath === parentPath
        ) {
          // Handle range selection
          const siblings = this.getSiblings(this.selectionParentPath);
          if (siblings) {
            const idx1 = siblings.findIndex(
              (n) => this.getPath(parentPath, n.name) === this.lastSelectedFile,
            );
            const idx2 = siblings.findIndex((n) => n.name === node.name);

            if (idx1 !== -1 && idx2 !== -1) {
              const start = Math.min(idx1, idx2);
              const end = Math.max(idx1, idx2);
              const range = siblings.slice(start, end + 1);

              for (const s of range) {
                if (s.type === "file" || s.type === "folder") {
                  this.selectedFiles.add(this.getPath(parentPath, s.name));
                }
              }
            }
          }
        } else if (ctrlKey) {
          // Toggle
          if (this.selectedFiles.has(fullPath)) {
            this.selectedFiles.delete(fullPath);
            if (this.selectedFiles.size === 0) {
              this.selectionParentPath = null;
            }
          } else {
            this.selectedFiles.add(fullPath);
          }
          this.lastSelectedFile = fullPath;
        } else {
          // Single select
          this.selectedFiles.clear();
          this.selectedFiles.add(fullPath);
          this.selectionParentPath = parentPath;
          this.lastSelectedFile = fullPath;
        }
      }
    },
    getPath(parent, name) {
      return parent ? `${parent}/${name}` : name;
    },
    getSiblings(parentPath) {
      // Traverse tree to find the array of children for this path
      // parentPath e.g. "ShowName/Season 1"
      if (!parentPath) return this.tree; // depth-0 items
      const parts = parentPath.split("/");
      // First part is top level
      let current = this.tree.find((n) => n.name === parts[0]);
      if (!current) return [];

      for (let i = 1; i < parts.length; i++) {
        if (!current.children) return [];
        current = current.children.find((n) => n.name === parts[i]);
        if (!current) return [];
      }
      return current.children || [];
    },
    // Subtitles logic
    clickPlay() {
      const mediaRoot = this.movieMode ? "/mnt/media/movies" : "/mnt/media/tv";
      const videoPath = this.collectFilePaths()
        .filter((p) => /\.(mkv|mp4|avi|m4v|mov|webm)$/i.test(p))
        .map((p) => `${mediaRoot}/${p}`)[0];
      if (!videoPath) return;
      evtBus.emit("playEpisodePath", videoPath);
    },
    clickSubs() {
      const mediaRoot = this.movieMode ? "/mnt/media/movies" : "/mnt/media/tv";
      const videoPaths = this.collectFilePaths()
        .filter((p) => /\.(mkv|mp4|avi|m4v|mov|webm)$/i.test(p))
        .map((p) => `${mediaRoot}/${p}`);
      if (videoPaths.length === 0) {
        alert("No video files selected");
        return;
      }
      for (const p of videoPaths) {
        if (!this.subsPending.includes(p)) this.subsPending.push(p);
      }
      enqueueSubs(videoPaths, true).catch((e) =>
        unilog(1004, "enqueueSubs", e),
      );
    },
    onSubsProgress({ path }) {
      const idx = this.subsPending.indexOf(path);
      if (idx !== -1) {
        this.subsPending.splice(idx, 1);
        if (this.subsPending.length === 0) {
          this.fetchFiles();
        }
      }
    },
    startSubsProgressChannel() {
      if (this.subsProgressChannel) return;
      this.subsProgressChannel = openChannel("subsProgress", {
        onDelta: this.onSubsProgress,
      });
    },
    stopSubsProgressChannel() {
      this.subsProgressChannel?.close();
      this.subsProgressChannel = null;
    },
    clickAsr() {
      this.showAsr = !this.showAsr;
      if (this.showAsr) {
        this.showEmb = false;
        this.showOpn = false;
        this.showFix = false;
        this.showInfo = false;
        this.showText = false;
        this.showHist = false;
      }
    },
    pushAsrLine(text) {
      this.asrLineObjs.push({ text, detail: false });
    },
    async clearAsrLog() {
      this.asrLineObjs = [];
      this.asrQueueMode = false;
    },
    async startAsr() {
      const mediaRoot = this.movieMode ? "/mnt/media/movies" : "/mnt/media/tv";
      const videoPaths = this.collectFilePaths()
        .filter((p) => /\.(mkv|mp4|avi|m4v|mov|webm)$/i.test(p))
        .map((p) => `${mediaRoot}/${p}`);
      if (videoPaths.length === 0) {
        this.pushAsrLine("[Error] No video files selected.");
        return;
      }
      this.asrQueueMode = false;
      try {
        await addToAsrQueue(videoPaths);
        this.pushAsrLine(`Queued ${videoPaths.length} file(s) for ASR.`);
      } catch (e) {
        this.pushAsrLine(`Error: ${e.message}`);
      }
    },
    async abortAsrRun() {
      try {
        const res = await abortAsr();
        if (!res?.ok) this.pushAsrLine(`Abort: ${res?.error || "failed"}`);
      } catch (e) {
        this.pushAsrLine(`Error: ${e.message}`);
      }
    },
    async killAsr() {
      try {
        await killAsrProcess();
        this.pushAsrLine(`[Kill command sent]`);
      } catch (e) {
        this.pushAsrLine(`Error killing ASR: ${e.message}`);
      }
    },
    onAsrLog(entry) {
      if (this.ignoreLogs) return;
      const line =
        typeof entry === "string" ? { text: entry, detail: false } : entry;
      if (!line?.text) return; // ignore empty
      const msg = line.text;

      const el = this.$refs.asrScroll;
      let atBottom = true;
      if (el) {
        atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      }

      this.asrLineObjs.push(line);

      // Auto-detect running state from logs if we missed initial state
      if (msg.includes("matches (running)")) {
        // This matches 'asr is running (PID...)' from status/check
        this.asrBusy = true;
      }

      if (msg.includes("[asr] EXIT")) {
        this.asrBusy = false;
      }

      // Check for Processing line from status command
      // "Processing: /mnt/media/..."
      const match = msg.match(/^Processing: (.+)$/m);
      if (match) {
        this.activeAsrPath = match[1].trim();
      }

      if (atBottom) {
        this.$nextTick(() => {
          if (el) el.scrollTop = el.scrollHeight;
        });
      }
    },
    startAsrLogChannel() {
      if (this.asrLogChannel) return;
      this.asrLogChannel = openChannel("asrLog", {
        onSnapshot: (payload) => {
          if (payload?.lines != null) this.asrLineObjs = payload.lines;
        },
        onDelta: (payload) => this.onAsrLog(payload?.line),
      });
    },
    stopAsrLogChannel() {
      this.asrLogChannel?.close();
      this.asrLogChannel = null;
    },
    async initAsrState() {
      try {
        const [logRes, queueRes] = await Promise.all([
          getAsrLog(),
          getAsrQueue(),
        ]);
        if (logRes?.lines) this.asrLineObjs = logRes.lines;
        if (queueRes) {
          this.asrQueueLen = queueRes.count ?? 0;
          this.asrBusy = queueRes.running ?? false;
        }
      } catch (e) {
        unilog(1005, "Failed to init Asr State", e);
      }
    },
    onAsrQueueUpdate({ count, running, entries }) {
      this.asrQueueLen = count ?? 0;
      if (running !== undefined) this.asrBusy = running;
      if (entries !== undefined) this.asrQueueEntries = entries;
    },
    startAsrQueueChannel() {
      if (this.asrQueueChannel) return;
      this.asrQueueChannel = openChannel("asrQueue", {
        onSnapshot: this.onAsrQueueUpdate,
        onDelta: this.onAsrQueueUpdate,
      });
    },
    stopAsrQueueChannel() {
      this.asrQueueChannel?.close();
      this.asrQueueChannel = null;
    },
    async clickQueue() {
      this.asrQueueMode = !this.asrQueueMode;
      if (this.asrQueueMode) {
        await this.fetchAsrQueue();
      }
    },
    async fetchAsrLog() {
      try {
        const res = await getAsrLog();
        if (res?.lines != null) this.asrLineObjs = res.lines;
      } catch (e) {
        unilog(1006, "fetchAsrLog error", e);
      }
    },
    async fetchAsrQueue() {
      try {
        const res = await getAsrQueue();
        if (res) {
          this.asrQueueEntries = res.entries ?? [];
          this.asrQueueLen = res.count ?? 0;
          this.asrBusy = res.running ?? this.asrBusy;
        }
      } catch (e) {
        unilog(1007, "fetchAsrQueue error", e);
      }
    },
    async removeFromQueue(videoPath) {
      if (!confirm(`Remove from queue?\n${videoPath}`)) return;
      try {
        await removeFromAsrQueue(videoPath);
        await this.fetchAsrQueue();
      } catch (e) {
        unilog(1008, "removeFromQueue error", e);
      }
    },
    clickFix() {
      this.showFix = !this.showFix;
      if (this.showFix) {
        this.showAsr = false;
        this.showEmb = false;
        this.showOpn = false;
        this.showInfo = false;
        this.showText = false;
        this.showHist = false;
        this.initFixState();
      } else {
        this.stopFixPolling();
      }
    },
    async clearFixLog() {
      this.fixLogs = "";
      this.fixLogOffset = 0;
    },
    async startFix() {
      if (this.fixBusy) return;

      let startPath = null;
      if (this.selectedFiles.size === 1) {
        const relPath = [...this.selectedFiles][0];
        startPath = relPath;
      } else if (this.selectedName) {
        const node = this.tree.find((n) => n.name === this.selectedName);
        if (node && node.type === "folder") startPath = node.name;
      }

      if (!startPath) {
        if (this.activeFixPath) startPath = this.activeFixPath;
        else {
          this.fixLogs += "\n[Error] No file or folder selected for ffmpeg.\n";
          return;
        }
      }

      this.fixBusy = true;
      this.activeFixPath = startPath;
      this.ignoreFixLogs = true;
      this.fixLogs = "";
      this.fixLogOffset = 0;
      this.showFix = true;
      this.showAsr = false;
      this.showInfo = false;

      try {
        this.ignoreFixLogs = false;
        const res = await handleFix({ action: "start", path: startPath });
        if (res && res.error) {
          this.fixLogs += `Start Error: ${res.error}\nStderr: ${res.stderr || ""}\n`;
          this.fixBusy = false;
          return;
        }
        if (res && res.stdout) {
          unilog(1009, "Fix Start stdout:", res.stdout);
        }
        this.startFixPolling();
      } catch (e) {
        this.ignoreFixLogs = false;
        this.fixLogs += `Error starting ffmpeg: ${e.message}\n`;
        this.fixBusy = false;
      }
    },
    async killFix() {
      try {
        const res = await handleFix({ action: "kill" });
        this.fixLogs += `\n[Kill command sent]\n`;
        if (res && res.stdout) this.fixLogs += res.stdout;
        if (res && res.stderr) this.fixLogs += res.stderr;
      } catch (e) {
        this.fixLogs += `\nError killing ffmpeg: ${e.message}\n`;
      }
      this.fixBusy = false;
      this.stopFixPolling();
    },
    applyFixLogChunk(chunk, { replace = false } = {}) {
      if (chunk == null || chunk === "") return;

      if (replace) {
        this.fixLogs = "";
      }

      const el = this.$refs.fixScroll;
      let atBottom = true;
      if (el) {
        atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      }

      let text = String(chunk);
      while (text.length > 0) {
        const crIdx = text.indexOf("\r");
        if (crIdx === -1) {
          this.fixLogs += text;
          break;
        }

        if (crIdx > 0) {
          this.fixLogs += text.slice(0, crIdx);
        }

        text = text.slice(crIdx + 1);
        let nextBoundary = text.length;
        const nextCr = text.indexOf("\r");
        const nextNl = text.indexOf("\n");
        if (nextCr !== -1) nextBoundary = Math.min(nextBoundary, nextCr);
        if (nextNl !== -1) nextBoundary = Math.min(nextBoundary, nextNl + 1);

        const progress = text.slice(0, nextBoundary);
        const lastNl = this.fixLogs.lastIndexOf("\n");
        if (lastNl !== -1) {
          this.fixLogs = this.fixLogs.slice(0, lastNl + 1) + progress;
        } else {
          this.fixLogs = progress;
        }
        text = text.slice(nextBoundary);
      }

      if (this.fixLogs.includes("[fix] EXIT")) {
        this.fixBusy = false;
      }

      if (atBottom) {
        this.$nextTick(() => {
          if (el) el.scrollTop = el.scrollHeight;
        });
      }
    },
    onFixLog(msg) {
      if (this.ignoreFixLogs) return;
      if (!msg) return;

      this.applyFixLogChunk(msg);
    },
    startFixPolling({ reset = true } = {}) {
      this.stopFixPolling();
      const applyFixLogPayload = (res, options = {}) => {
        if (!res) return;
        const replace = options.replace === true;
        if (replace) this.fixLogs = "";
        if (typeof res.log === "string" && res.log.length > 0) {
          this.applyFixLogChunk(res.log);
        }
        if (Number.isFinite(res.nextOffset)) {
          this.fixLogOffset = res.nextOffset;
        }
        if (res.currentPath) {
          this.activeFixPath = res.currentPath;
        }
        this.fixBusy = !!res.running;
        if (!res.running) this.stopFixPolling();
      };
      this.fixLogChannel = openChannel("fixLog", {
        onSnapshot: (res) => applyFixLogPayload(res, { replace: reset }),
        onDelta: (res) => applyFixLogPayload(res),
      });
    },
    stopFixPolling() {
      this.fixLogChannel?.close();
      this.fixLogChannel = null;
    },
    async syncFixLog(reset = false) {
      try {
        const res = await handleFix({
          action: "tail",
          offset: reset ? 0 : this.fixLogOffset,
        });
        if (reset) {
          this.fixLogs = "";
        }
        if (res && typeof res.log === "string" && res.log.length > 0) {
          this.applyFixLogChunk(res.log);
        }
        if (res && Number.isFinite(res.nextOffset)) {
          this.fixLogOffset = res.nextOffset;
        }
        if (res && res.currentPath) {
          this.activeFixPath = res.currentPath;
        }
        if (res) {
          this.fixBusy = !!res.running;
          if (!res.running) this.stopFixPolling();
        }
      } catch (e) {
        unilog(1010, "Failed to sync Fix log", e);
      }
    },
    async initFixState() {
      try {
        const res = await handleFix({ action: "check" });
        if (res && res.running) {
          this.fixBusy = true;
          this.activeFixPath = res.currentPath || this.activeFixPath;
          await this.syncFixLog(true);
          this.startFixPolling();
        } else {
          this.fixBusy = false;
          if (res && (res.hasLog || res.status)) {
            this.activeFixPath = res.currentPath || this.activeFixPath;
            await this.syncFixLog(true);
          }
          this.stopFixPolling();
        }
      } catch (e) {
        unilog(1011, "Failed to init Fix State", e);
      }
    },
    clickEmb() {
      this.showEmb = !this.showEmb;
      if (this.showEmb) {
        this.showAsr = false;
        this.showOpn = false;
        this.showFix = false;
        this.showInfo = false;
        this.showText = false;
        this.showHist = false;
      }
    },
    async applyEmb() {
      if (this.embBusy) return;
      this.embBusy = true;
      this.showEmb = true;
      this.showAsr = false;
      this.showOpn = false;
      this.showFix = false;
      this.showInfo = false;

      try {
        const mediaRoot = this.movieMode
          ? "/mnt/media/movies"
          : "/mnt/media/tv";
        const videoPaths = this.collectFilePaths()
          .filter((p) => /\.(mkv|mp4|avi|m4v|mov|webm)$/i.test(p))
          .map((p) => `${mediaRoot}/${p}`);
        if (videoPaths.length === 0) {
          this.embLogs += "[Error] No video files selected.\n\n";
          this.embBusy = false;
          return;
        }
        const res = await generateEmb(videoPaths);
        if (res && res.ok) {
          this.embLogs += `[Queued ${res.queued} file(s) for emb extraction]\n`;
        } else {
          this.embLogs += `[emb apply error: ${JSON.stringify(res)}]\n`;
        }
      } catch (e) {
        this.embLogs += `[Error: ${e.message}]\n`;
      }

      this.embBusy = false;
    },
    clearEmbLog() {
      this.embLogs = "";
    },
    onEmbLog(msg) {
      if (!msg) return;
      const el = this.$refs.embScroll;
      const atBottom =
        !el || el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      this.embLogs += (msg.endsWith("\n") ? msg : msg + "\n") + "\n";
      if (atBottom) {
        this.$nextTick(() => {
          if (el) el.scrollTop = el.scrollHeight;
        });
      }
    },
    startEmbLogChannel() {
      if (this.embLogChannel) return;
      this.embLogChannel = openChannel("embLog", {
        onSnapshot: (payload) => {
          if (payload?.lines != null) this.embLogs = payload.lines;
        },
        onDelta: (payload) => this.onEmbLog(payload?.line),
      });
    },
    stopEmbLogChannel() {
      this.embLogChannel?.close();
      this.embLogChannel = null;
    },
    clickOpn() {
      this.showOpn = !this.showOpn;
      if (this.showOpn) {
        this.showAsr = false;
        this.showEmb = false;
        this.showFix = false;
        this.showInfo = false;
        this.showText = false;
        this.showHist = false;
      }
    },
    async applyOpn() {
      if (this.opnBusy) return;
      const mediaRoot = this.movieMode ? "/mnt/media/movies" : "/mnt/media/tv";
      const videoPaths = this.collectFilePaths()
        .filter((p) => /\.(mkv|mp4|avi|m4v|mov|webm)$/i.test(p))
        .map((p) => `${mediaRoot}/${p}`);
      if (videoPaths.length === 0) {
        this.opnResults = [
          { videoPath: "", items: [], error: "No video files selected" },
        ];
        this.opnSearched = true;
        return;
      }
      this.opnBusy = true;
      try {
        const res = await searchOpn(videoPaths);
        this.opnResults = res?.results ?? [];
      } catch (e) {
        this.opnResults = [{ videoPath: "", items: [], error: e.message }];
      } finally {
        this.opnBusy = false;
        this.opnSearched = true;
      }
    },
    clearOpn() {
      this.opnResults = [];
      this.opnSearched = false;
    },
    async badGrpClick() {
      // Check if exactly one file is selected
      if (this.selectedFiles.size === 0) {
        this.showToastError("No file selected.");
        return;
      }
      if (this.selectedFiles.size > 1) {
        this.showToastError("More than one file selected.");
        return;
      }

      // Get the file path and extract the filename
      const filePath = Array.from(this.selectedFiles)[0];
      const parts = filePath.split("/");
      const fileName = parts[parts.length - 1];

      // Parse the filename to extract the group (strip extension first, same as server isBadGroup)
      let parsed = null;
      try {
        const nameNoExt = fileName.replace(/\.[a-z0-9]{2,4}$/i, "");
        parsed = parseTorrentTitle.parse(nameNoExt);
      } catch (e) {
        this.showToastError("Failed to parse filename.");
        return;
      }

      const group = String(parsed?.group || "").trim();
      if (!group) {
        this.showToastError("Selected file has no group name.");
        return;
      }

      // Call toggleBadGroup
      try {
        const result = await toggleBadGroup(group);
        if (result?.action === "added") {
          this.showToastInfo(`Added bad group: ${group}`);
        } else if (result?.action === "removed") {
          this.showToastInfo(`Removed bad group: ${group}`);
        }
      } catch (e) {
        this.showToastError(e?.message || String(e));
      }
    },
    async clickInfo() {
      if (this.showInfo) {
        this.showInfo = false;
        return;
      }
      this.showInfo = true;
      this.showAsr = false;
      this.showEmb = false;
      this.showOpn = false;
      this.showFix = false;
      this.showText = false;
      this.showHist = false;
      await this.loadInfo();
    },
    async clickHist() {
      if (this.showHist) {
        this.showHist = false;
        return;
      }
      if (!this.historyReady) return;
      this.showHist = true;
      this.showAsr = false;
      this.showEmb = false;
      this.showOpn = false;
      this.showFix = false;
      this.showInfo = false;
      this.showText = false;
      await this.loadHistory();
    },
    async clickView() {
      if (this.showText) {
        this.showText = false;
        return;
      }
      if (!this.viewReady) return;
      this.showText = true;
      this.showAsr = false;
      this.showEmb = false;
      this.showOpn = false;
      this.showFix = false;
      this.showInfo = false;
      this.showHist = false;
      await this.loadTextFile();
    },
    async loadHistory() {
      const relPath = this.singleSelectedFile;
      if (!relPath || !this.historyReady) {
        this.showHist = false;
        return;
      }
      this.histContent = "";
      this.histLoading = true;
      this._histPath = relPath;
      try {
        const data = await getLocalHistory({
          relPath,
          movieMode: this.movieMode,
        });
        if (this._histPath !== relPath) return;
        this.histContent = data?.text || "No timestamped history found.";
      } catch (e) {
        if (this._histPath !== relPath) return;
        this.histContent = `History error: ${e?.message || String(e)}`;
      } finally {
        if (this._histPath === relPath) this.histLoading = false;
      }
    },
    // probe:true asks only whether the file is viewable text
    // maxChars (optional) limits the content to the head of the file
    async fetchTextFile(relPath, probe, maxChars) {
      try {
        const url = `${config.torrentsApiUrl}/api/local/textfile`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            relPath,
            movieMode: this.movieMode,
            probe: !!probe,
            maxChars: maxChars || 0,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
      } catch (e) {
        unilog(1568, `textfile fetch failed: ${e.message}`);
        return null;
      }
    },
    // enable/disable the View button for the current selection
    async probeTextFile() {
      this.textProbeOk = false;
      const relPath = this.singleSelectedFile;
      const node = relPath ? this.findNodeByPath(relPath) : null;
      if (!node || node.size == null || node.size > TEXT_VIEW_MAX_BYTES) {
        this.showText = false;
        return;
      }
      this._textPath = relPath;
      const data = await this.fetchTextFile(relPath, true);
      if (this._textPath !== relPath) return; // selection changed while fetching
      this.textProbeOk = !!(data && data.isText && !data.tooBig);
      if (!this.showText) return;
      if (this.textProbeOk) await this.loadTextFile();
      else this.showText = false;
    },
    async loadTextFile() {
      const relPath = this.singleSelectedFile;
      if (!relPath) {
        this.showText = false;
        return;
      }
      this.textContent = "";
      this.textLoading = true;
      this._textPath = relPath;
      const data = await this.fetchTextFile(relPath, false);
      if (this._textPath !== relPath) return; // selection changed while fetching
      this.textLoading = false;
      if (!data || data.content == null) {
        this.showText = false;
        return;
      }
      this.textContent = data.content;
    },
    // Collect all file paths from a selection (handles folders recursively)
    collectFilePaths() {
      const paths = [];
      const collectNode = (n, prefix) => {
        const fullPath = prefix ? `${prefix}/${n.name}` : n.name;
        if (n.type === "file") {
          paths.push(fullPath);
        } else if (n.children) {
          n.children.forEach((c) => collectNode(c, fullPath));
        }
      };
      if (this.selectedName) {
        const node = this.tree.find((n) => n.name === this.selectedName);
        if (node) collectNode(node, null);
      } else {
        for (const relPath of this.selectedFiles) {
          const node = this.findNodeByPath(relPath);
          if (node)
            collectNode(
              node,
              relPath.substring(0, relPath.lastIndexOf("/")) || null,
            );
        }
      }
      return paths;
    },
    async loadInfo() {
      this.infoText = "";
      this.infoFileName = "";
      this.infoFileMeta = "";
      this.infoMultiFiles = [];
      this.infoMultiTitle = "";
      this.infoMultiMeta = "";
      this.infoSelectedLine = null;
      this.infoLoading = true;

      // Collect selected file paths
      const filePaths = this.collectFilePaths();

      const VIDEO_EXTS = new Set([
        "mkv",
        "avi",
        "mp4",
        "m4v",
        "mov",
        "wmv",
        "webm",
        "mpg",
        "mpeg",
        "ts",
        "m2ts",
      ]);
      const getExt = (name) => {
        const i = name.lastIndexOf(".");
        return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
      };

      if (filePaths.length === 0) {
        // No selection
        this.infoLoading = false;
        return;
      }

      if (filePaths.length === 1) {
        // Single file — full mediainfo
        const relPath = filePaths[0];
        const fileName = relPath.split("/").pop();
        this.infoFileName = fileName;
        const node = this.findNodeByPath(relPath);
        let sizeStr = "";
        let dateStr = "";
        if (node && node.size != null) {
          sizeStr = this.formatFileSize(node.size);
          dateStr = (node.date || "").replace(/:\d+\.\d+$|:\d+$/, "");
          this.infoFileMeta = dateStr ? `${sizeStr} | ${dateStr}` : sizeStr;
        }
        // non-video file: show the head of its text, if it is text
        if (!VIDEO_EXTS.has(getExt(fileName))) {
          const textData = await this.fetchTextFile(
            relPath,
            false,
            TEXT_INFO_MAX_CHARS,
          );
          if (textData && textData.isText && textData.content != null) {
            this.infoText = textData.content;
            this.infoLoading = false;
            return;
          }
        }
        try {
          const url = `${config.torrentsApiUrl}/api/local/mediainfo`;
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              relPath,
              movieMode: this.movieMode,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
          this.infoText = data.output || "";
          const subsCount = data.subsCount ?? 0;
          const srtsCount = data.srtsCount ?? 0;
          let widthStr = "";
          let rateStr = "";
          let durStr = "";
          const widthMatch = this.infoText.match(
            /^Height\s+:\s+(\d[\d\s]*)pixels/m,
          );
          if (widthMatch) {
            widthStr = widthMatch[1].replace(/\s/g, "") + " px";
          }
          let bitDepthStr = "";
          const videoSecs = this.infoText.split(/\n\n+/);
          const videoSec = videoSecs.find((s) => /^Video\b/.test(s.trim()));
          if (videoSec) {
            const bitrateMatch = videoSec.match(
              /^Bit rate\s+:\s+([\d\s\.]+(?:kb|Mb)\/s)/m,
            );
            if (bitrateMatch) {
              rateStr = bitrateMatch[1].replace(/\s(?=\d)/g, "").trim();
            }
            const durLine = videoSec.match(/^Duration\s+:\s+(.+)/m);
            if (durLine) {
              const raw = durLine[1];
              const hm = raw.match(/(\d+)\s*h/);
              const mm = raw.match(/(\d+)\s*min/);
              const total =
                (hm ? parseInt(hm[1]) : 0) * 60 + (mm ? parseInt(mm[1]) : 0);
              if (total > 0) durStr = total + " min";
            }
            const bdLine = videoSec.match(/^Bit depth\s+:\s+(\d+)\s*bits/m);
            if (bdLine) bitDepthStr = bdLine[1] + " bits";
          }
          this.infoFileMeta = [
            sizeStr,
            durStr,
            dateStr,
            widthStr,
            bitDepthStr,
            rateStr,
          ]
            .filter(Boolean)
            .join(" | ");
          const subsPart = `${subsCount} sub`;
          const srtsPart = `${srtsCount} srt`;
          this.infoFileMeta += ` | ${subsPart} | ${srtsPart}`;
        } catch (e) {
          this.infoText = `Error: ${e.message}`;
        } finally {
          this.infoLoading = false;
        }
      } else {
        // Multiple files — show header list only
        const entries = [];
        for (const relPath of filePaths) {
          const fileName = relPath.split("/").pop();
          const node = this.findNodeByPath(relPath);
          let sizeStr = "";
          let dateStr = "";
          if (node && node.size != null) {
            sizeStr = this.formatFileSize(node.size);
            dateStr = (node.date || "").replace(/:\d+\.\d+$|:\d+$/, "");
          }
          let rStr = "";
          let dStr = "";
          let wStr = "";
          try {
            const url = `${config.torrentsApiUrl}/api/local/mediainfo`;
            const res = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                relPath,
                movieMode: this.movieMode,
              }),
            });
            const data = await res.json();
            let bdStr = "";
            if (res.ok && data.output) {
              const wm = data.output.match(/^Height\s+:\s+(\d[\d\s]*)pixels/m);
              if (wm) wStr = wm[1].replace(/\s/g, "") + " px";
              const vSecs = data.output.split(/\n\n+/);
              const vSec = vSecs.find((s) => /^Video\b/.test(s.trim()));
              if (vSec) {
                const bm = vSec.match(
                  /^Bit rate\s+:\s+([\d\s\.]+(?:kb|Mb)\/s)/m,
                );
                if (bm) rStr = bm[1].replace(/\s(?=\d)/g, "").trim();
                const durLine = vSec.match(/^Duration\s+:\s+(.+)/m);
                if (durLine) {
                  const raw = durLine[1];
                  const hm = raw.match(/(\d+)\s*h/);
                  const mm = raw.match(/(\d+)\s*min/);
                  const total =
                    (hm ? parseInt(hm[1]) : 0) * 60 +
                    (mm ? parseInt(mm[1]) : 0);
                  if (total > 0) dStr = total + " min";
                }
                const bdLine = vSec.match(/^Bit depth\s+:\s+(\d+)\s*bits/m);
                if (bdLine) bdStr = bdLine[1] + " bits";
              }
            }
            const subsCount = data.subsCount ?? 0;
            const srtsCount = data.srtsCount ?? 0;
            const subsPart = `${subsCount} sub`;
            const srtsPart = `${srtsCount} srt`;
            const meta =
              [sizeStr, dStr, dateStr, wStr, bdStr, rStr]
                .filter(Boolean)
                .join(" | ") + ` | ${subsPart} | ${srtsPart}`;
            entries.push({ name: fileName, meta });
          } catch (_) {
            const meta = [sizeStr, dateStr].filter(Boolean).join(" | ");
            entries.push({ name: fileName, meta });
          }
        }
        this.infoMultiFiles = entries;

        // Compute aggregate header for multi-file
        const names = filePaths.map((p) => p.split("/").pop());
        // Common sections via recursive longest-common-substring
        const MIN_SECT = 8;
        const s0 = names[0] || "";
        const s1 = names.length > 1 ? names[1] : "";
        if (!s1) {
          this.infoMultiTitle = s0;
        } else {
          const lcsRange = (aS, aE, bS, bE) => {
            let best = { a: aS, b: bS, len: 0 };
            for (let i = aS; i < aE; i++) {
              for (let j = bS; j < bE; j++) {
                let k = 0;
                while (i + k < aE && j + k < bE && s0[i + k] === s1[j + k]) k++;
                if (k > best.len) best = { a: i, b: j, len: k };
              }
            }
            return best;
          };
          const rawSects = [];
          const findSects = (aS, aE, bS, bE) => {
            if (aS >= aE || bS >= bE) return;
            const m = lcsRange(aS, aE, bS, bE);
            if (m.len < MIN_SECT) return;
            findSects(aS, m.a, bS, m.b);
            rawSects.push(s0.slice(m.a, m.a + m.len));
            findSects(m.a + m.len, aE, m.b + m.len, bE);
          };
          findSects(0, s0.length, 0, s1.length);
          const valid = rawSects.filter((t) =>
            names.every((nm) => nm.includes(t)),
          );
          if (valid.length === 0) {
            this.infoMultiTitle = s0;
          } else {
            const parts = valid
              .map((t) => t.replace(/^\.+|\.+$/g, ""))
              .filter(Boolean);
            const last = parts[parts.length - 1] || "";
            const hasTrail =
              last &&
              names.some((nm) => nm.indexOf(last) + last.length < nm.length);
            this.infoMultiTitle =
              parts.join(" ... ") + (hasTrail ? " ..." : "");
          }
        }

        let totalSize = 0;
        const allDates = [];
        for (const relPath of filePaths) {
          const node = this.findNodeByPath(relPath);
          if (node && node.size != null) totalSize += node.size;
          if (node && node.date) {
            const d = (node.date || "").replace(/:\d+\.\d+$|:\d+$/, "");
            if (d) allDates.push(d);
          }
        }
        const sizeAgg = this.formatFileSize(totalSize);
        allDates.sort();
        if (allDates.length >= 2) {
          this.infoMultiMeta = `${sizeAgg} | ${allDates[0]} | ${allDates[allDates.length - 1]}`;
        } else if (allDates.length === 1) {
          this.infoMultiMeta = `${sizeAgg} | ${allDates[0]}`;
        } else {
          this.infoMultiMeta = sizeAgg;
        }

        this.infoLoading = false;
      }
    },
    handleSelectionChanged() {
      if (this.showInfo) {
        if (this._infoRefreshTimer) clearTimeout(this._infoRefreshTimer);
        this._infoRefreshTimer = setTimeout(() => {
          this.refreshInfo();
        }, 300);
      }
      if (this._textProbeTimer) clearTimeout(this._textProbeTimer);
      this._textProbeTimer = setTimeout(() => {
        this.probeTextFile();
      }, 300);
      if (this.showHist) {
        if (!this.historyReady) {
          this.showHist = false;
        } else {
          if (this._histRefreshTimer) clearTimeout(this._histRefreshTimer);
          this._histRefreshTimer = setTimeout(() => {
            this.loadHistory();
          }, 300);
        }
      }
    },
    async refreshInfo() {
      // Re-run loadInfo without toggling off
      await this.loadInfo();
    },

    // First: scroll to first selected item
    localFirstClick() {
      const targetName =
        this.selectedName ||
        (this.selectedFiles.size > 0
          ? [...this.selectedFiles][0]?.split("/")[0]
          : null);
      if (!targetName) return;
      const el = this.nodeRefs.get(targetName);
      if (el) {
        const domEl = el.$el || el;
        if (domEl && domEl.scrollIntoView) {
          domEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    },
  },
};
</script>
