<template>
  <div
    v-if="path"
    style="
      position: fixed;
      inset: 0;
      z-index: 5000;
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
    "
    @click.self="close"
  >
    <!-- Top bar -->
    <div
      style="
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 5001;
        display: flex;
        align-items: center;
        padding: 6px 14px 6px 0;
        background: rgba(0, 0, 0, 0.75);
      "
    >
      <!-- Chksrt filename (chksrt mode only) -->
      <div
        v-if="mode === 'chksrt'"
        style="
          flex: 1;
          display: flex;
          align-items: center;
          padding-left: 14px;
          overflow: hidden;
          gap: 6px;
        "
      >
        <span
          v-if="chksrtMatch"
          style="
            color: yellow;
            font-size: 13px;
            flex-shrink: 0;
            text-shadow: 0 0 3px #000;
            user-select: none;
          "
          >Match</span
        >
        <span
          style="
            color: white;
            font-size: 13px;
            user-select: none;
            text-shadow: 0 0 3px #000;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          "
          >{{ chksrtFilename }}{{ activeTrackSuffix }}</span
        >
      </div>
      <!-- Filename (non-chksrt, non-intro modes) -->
      <div
        v-else-if="mode !== 'intro'"
        style="
          padding-left: 14px;
          padding-right: 14px;
          overflow: hidden;
          flex-shrink: 1;
          min-width: 0;
        "
      >
        <span
          style="
            color: white;
            font-size: 13px;
            user-select: none;
            text-shadow: 0 0 3px #000;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            display: block;
          "
          >{{ path ? path.split("/").pop() : "" }}{{ activeTrackSuffix }}</span
        >
      </div>
      <!-- Intro mode: show name (left) -->
      <div
        v-else
        style="
          flex: 1;
          display: flex;
          align-items: center;
          padding-left: 14px;
          overflow: hidden;
          min-width: 0;
        "
      >
        <span
          style="
            color: white;
            font-size: 13px;
            user-select: none;
            text-shadow: 0 0 3px #000;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          "
          >{{ introRemainingCount > 0 ? `(${introRemainingCount}) ` : ""
          }}{{ introShow ? introShow.name : ""
          }}{{ introSeasonEpisodeLabel }}</span
        >
        <span
          v-if="windowed"
          style="
            color: yellow;
            font-size: 13px;
            margin-left: 10px;
            white-space: nowrap;
            user-select: none;
            text-shadow: 0 0 3px #000;
            flex-shrink: 0;
          "
          >{{ testTelemetry }}</span
        >
      </div>
      <!-- Intro mode: mark controls (right, next to X) -->
      <template v-if="mode === 'intro'">
        <div
          v-if="waitingForVideo"
          style="
            position: absolute;
            left: 0;
            right: 0;
            top: 0;
            bottom: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            color: yellow;
            font-size: 16px;
            user-select: none;
            text-shadow: 0 0 3px #000;
            pointer-events: none;
          "
        >
          Waiting for video
        </div>
        <template v-if="!waitingForVideo">
          <div
            v-if="seekTarget !== null"
            style="
              color: yellow;
              font-size: 13px;
              user-select: none;
              text-shadow: 0 0 3px #000;
              flex-shrink: 0;
              margin-right: 8px;
            "
          >
            {{ fmtTime(seekTarget * 1000) }}
          </div>
          <div
            style="
              color: white;
              font-size: 13px;
              min-width: 52px;
              text-align: right;
              user-select: none;
              text-shadow: 0 0 3px #000;
              flex-shrink: 0;
              margin-right: 14px;
            "
          >
            {{ fmtTime(currentTimeSec * 1000) }}
          </div>
        </template>
        <div
          @click.stop="clickIntroZero"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 0;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            background: rgba(0, 0, 0, 0.5);
            white-space: nowrap;
            flex-shrink: 0;
            margin-right: 6px;
            width: 50px;
            text-align: center;
          "
        >
          0
        </div>
        <div
          @click.stop="clickNavBack30"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            background: rgba(0, 0, 0, 0.5);
            white-space: nowrap;
            flex-shrink: 0;
            margin-right: 6px;
          "
        >
          &lt;&lt;
        </div>
        <div
          @click.stop="clickNavBack10"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            background: rgba(0, 0, 0, 0.5);
            white-space: nowrap;
            flex-shrink: 0;
            margin-right: 6px;
          "
        >
          &lt;
        </div>
        <div
          @click.stop="clickNavBack3"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            background: rgba(0, 0, 0, 0.5);
            white-space: nowrap;
            flex-shrink: 0;
            margin-right: 6px;
          "
        >
          &minus;
        </div>
        <div
          @click.stop="clickNavFwd10"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            background: rgba(0, 0, 0, 0.5);
            white-space: nowrap;
            flex-shrink: 0;
            margin-right: 6px;
          "
        >
          &gt;
        </div>
        <div
          @click.stop="clickNavFwd30"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            background: rgba(0, 0, 0, 0.5);
            white-space: nowrap;
            flex-shrink: 0;
            margin-right: 20px;
          "
        >
          &gt;&gt;
        </div>
        <div
          @click.stop="clickTrimSet"
          style="
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            color: white;
            background: rgba(0, 80, 0, 0.6);
            white-space: nowrap;
            flex-shrink: 0;
            width: 74px;
            min-width: 74px;
            text-align: center;
            margin-right: 6px;
          "
        >
          {{ trimPosLabel || "\u00a0" }}
        </div>
        <div
          @click.stop="clickTrimJump"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            background: rgba(0, 0, 100, 0.6);
            white-space: nowrap;
            flex-shrink: 0;
            margin-right: 6px;
          "
        >
          Trim
        </div>
        <div
          @click.stop="clickTrimClr"
          title="clear trim"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            background: rgba(100, 40, 0, 0.7);
            white-space: nowrap;
            flex-shrink: 0;
            margin-right: 20px;
          "
        >
          Clr
        </div>
        <div
          @click.stop="clickIntroPre"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            background: rgba(0, 0, 0, 0.5);
            white-space: nowrap;
            flex-shrink: 0;
            margin-right: 6px;
          "
        >
          Pre
        </div>
        <div
          @click.stop="clickIntroStart"
          style="
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            background: rgba(0, 80, 0, 0.6);
            white-space: nowrap;
            flex-shrink: 0;
            width: 74px;
            min-width: 74px;
            text-align: center;
            margin-right: 6px;
          "
          :style="{ color: startMark < 2000 ? 'yellow' : 'white' }"
        >
          {{ startMarkLabel || "\u00a0" }}
        </div>
        <div
          @click.stop="clickSkipSet"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            background: rgba(80, 0, 0, 0.6);
            white-space: nowrap;
            flex-shrink: 0;
            width: 74px;
            min-width: 74px;
            text-align: center;
            margin-right: 6px;
          "
        >
          {{ skipDurLabel || "\u00a0" }}
        </div>
        <div
          @click.stop="clickSkipTest"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            background: rgba(0, 0, 100, 0.6);
            white-space: nowrap;
            flex-shrink: 0;
            margin-right: 6px;
          "
        >
          Skip
        </div>
        <div
          @click.stop="clickSkipClr"
          title="clear skip"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            background: rgba(100, 40, 0, 0.7);
            white-space: nowrap;
            flex-shrink: 0;
            margin-right: 20px;
          "
        >
          Clr
        </div>
        <div
          @click.stop="clickIntroAnt"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            white-space: nowrap;
            flex-shrink: 0;
            margin-right: 6px;
          "
          :style="{
            background: introShow?.anticipating
              ? 'rgba(180, 50, 50, 0.9)'
              : 'rgba(0, 0, 0, 0.5)',
          }"
        >
          Ant
        </div>
        <div
          @click.stop="clickIntroSel"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            background: rgba(0, 0, 100, 0.5);
            white-space: nowrap;
            flex-shrink: 0;
            margin-right: 6px;
          "
        >
          Sel
        </div>
      </template>
      <!-- Timing slider (srt tracks only, not in chksrt/simple/intro mode) -->
      <div
        v-if="
          showSlider &&
          mode !== 'chksrt' &&
          mode !== 'simple' &&
          mode !== 'intro'
        "
        ref="slider"
        style="
          flex: 1;
          margin: 0 30px;
          position: relative;
          height: 44px;
          cursor: pointer;
          user-select: none;
        "
        @mousedown.stop.prevent="sliderMouseDown"
        @touchstart.stop.prevent="sliderTouchStart"
      >
        <!-- Tick marks and labels -->
        <template
          v-for="t in ticks"
          :key="t.val"
        >
          <div
            :style="{
              position: 'absolute',
              left: t.pct + '%',
              top: '8px',
              width: '1px',
              height: '10px',
              background: 'white',
              transform: 'translateX(-50%)',
            }"
          />
          <div
            :style="{
              position: 'absolute',
              left: t.pct + '%',
              top: '30px',
              fontSize: '12px',
              color: 'white',
              transform: 'translateX(-50%)',
              lineHeight: '1',
            }"
          >
            {{ t.val }}
          </div>
        </template>
        <!-- Line -->
        <div
          style="
            position: absolute;
            top: 22px;
            left: 0;
            right: 0;
            height: 2px;
            background: white;
          "
        />
        <!-- Ball -->
        <div
          :style="{
            position: 'absolute',
            top: '16px',
            left: ballPct + '%',
            width: '14px',
            height: '14px',
            borderRadius: '50%',
            background: 'white',
            transform: 'translateX(-50%)',
            boxShadow: '0 0 4px rgba(0,0,0,0.8)',
          }"
        />
      </div>
      <!-- Offset value -->
      <div
        v-if="
          showSlider &&
          mode !== 'chksrt' &&
          mode !== 'simple' &&
          mode !== 'intro'
        "
        style="
          color: white;
          font-size: 13px;
          min-width: 42px;
          text-align: right;
          padding-right: 8px;
          user-select: none;
          text-shadow: 0 0 3px #000;
        "
      >
        {{ offsetDisplay }}
      </div>
      <!-- Apply button (srt only, not in chksrt/simple/intro mode) -->
      <div
        v-if="
          showSlider &&
          mode !== 'chksrt' &&
          mode !== 'simple' &&
          mode !== 'intro'
        "
        @click.stop="applySliderOffset"
        style="
          color: white;
          font-size: 13px;
          padding: 2px 8px;
          border-radius: 4px;
          border: 1px solid #666;
          cursor: pointer;
          user-select: none;
          background: rgba(0, 0, 0, 0.5);
          margin-right: 8px;
          white-space: nowrap;
          text-shadow: 0 0 3px #000;
        "
      >
        Apply
      </div>
      <!-- Waiting for first cue (chksrt mode only) -->
      <div
        v-if="waitingForFirstCue"
        style="
          color: red;
          font-size: 13px;
          margin-right: 8px;
          white-space: nowrap;
          user-select: none;
          text-shadow: 0 0 3px #000;
        "
      >
        Waiting for first title
      </div>
      <!-- Chksrt OK / Bad buttons -->
      <div
        v-if="mode === 'chksrt'"
        @click.stop="clickOk"
        style="
          color: white;
          font-size: 13px;
          padding: 2px 8px;
          border-radius: 4px;
          border: 1px solid #666;
          cursor: pointer;
          user-select: none;
          background: rgba(0, 100, 0, 0.5);
          margin-right: 8px;
          white-space: nowrap;
          text-shadow: 0 0 3px #000;
        "
      >
        OK
      </div>
      <div
        v-if="mode === 'chksrt'"
        @click.stop="clickGenSrt"
        style="
          color: white;
          font-size: 13px;
          padding: 2px 8px;
          border-radius: 4px;
          border: 1px solid #666;
          cursor: pointer;
          user-select: none;
          background: rgba(120, 0, 0, 0.5);
          margin-right: 8px;
          white-space: nowrap;
          text-shadow: 0 0 3px #000;
        "
      >
        GenSrt
      </div>
      <!-- Subtitle choice buttons -->
      <div
        v-if="mode !== 'simple' && mode !== 'intro'"
        v-for="(choice, i) in subtitleChoices"
        :key="choice.id"
        @click.stop="onChoiceClick(choice, $event)"
        :style="{
          marginLeft:
            i === 0 && !showSlider && mode !== 'chksrt' ? 'auto' : '0',
          padding: '2px 8px',
          borderRadius: '4px',
          border:
            chksrtMatch &&
            (subtitleLabelMap.get(choice.id) ?? choice.label) ===
              chksrtMatch.choice
              ? '2px solid yellow'
              : activeTrackId === choice.id
                ? '2px solid white'
                : '1px solid #666',
          color: activeTrackId === choice.id ? 'white' : '#999',
          fontSize: '13px',
          cursor: 'pointer',
          userSelect: 'none',
          backgroundColor: 'rgba(0,0,0,0.5)',
          textShadow: '0 0 3px #000',
          fontWeight: 'bold',
          whiteSpace: 'nowrap',
          marginRight: '8px',
        }"
      >
        {{ subtitleLabelMap.get(choice.id) ?? choice.label }}
      </div>
      <!-- All Off: same as off + Save for every queued episode of this show -->
      <div
        v-if="mode === 'chksrt'"
        @click.stop="clickChksrtAllOff"
        title="leave subs as-is for all queued episodes of this show"
        style="
          color: white;
          font-size: 13px;
          padding: 2px 8px;
          border-radius: 4px;
          border: 1px solid #666;
          cursor: pointer;
          user-select: none;
          background: rgba(90, 0, 90, 0.6);
          margin-right: 8px;
          white-space: nowrap;
          text-shadow: 0 0 3px #000;
        "
      >
        All Off
      </div>
      <!-- Sel button (chksrt mode only) -->
      <div
        v-if="mode === 'chksrt'"
        @click.stop="clickChksrtAnt"
        style="
          color: white;
          font-size: 13px;
          padding: 2px 8px;
          border-radius: 4px;
          border: 1px solid #666;
          cursor: pointer;
          user-select: none;
          margin-right: 8px;
          white-space: nowrap;
          text-shadow: 0 0 3px #000;
        "
        :style="{
          background: chksrtShowObj?.anticipating
            ? 'rgba(180, 50, 50, 0.9)'
            : 'rgba(0, 0, 0, 0.5)',
        }"
      >
        Ant
      </div>
      <div
        v-if="mode === 'chksrt'"
        @click.stop="clickSel"
        style="
          color: white;
          font-size: 13px;
          padding: 2px 8px;
          border-radius: 4px;
          border: 1px solid #666;
          cursor: pointer;
          user-select: none;
          background: rgba(0, 0, 100, 0.5);
          margin-right: 8px;
          white-space: nowrap;
          text-shadow: 0 0 3px #000;
        "
      >
        Sel
      </div>
      <div
        v-if="mode === 'chksrt'"
        @click.stop="clickChksrtSnooze"
        style="
          color: white;
          font-size: 13px;
          padding: 2px 8px;
          border-radius: 4px;
          border: 1px solid #666;
          cursor: pointer;
          user-select: none;
          background: rgba(70, 45, 0, 0.75);
          margin-right: 8px;
          white-space: nowrap;
          text-shadow: 0 0 3px #000;
        "
      >
        Snooze
      </div>
      <div
        v-if="mode === 'chksrt'"
        @click.stop="clickChksrtNext"
        style="
          color: white;
          font-size: 13px;
          padding: 2px 8px;
          border-radius: 4px;
          border: 1px solid #666;
          cursor: pointer;
          user-select: none;
          background: rgba(0, 0, 0, 0.5);
          margin-right: 8px;
          white-space: nowrap;
          text-shadow: 0 0 3px #000;
        "
      >
        Save
      </div>
      <div
        v-if="audioTracks.length > 1"
        @click.stop="cycleAudioTrack"
        :title="activeAudioLabel"
        :style="{
          color: 'white',
          fontSize: '13px',
          padding: '2px 8px',
          borderRadius: '4px',
          border: '1px solid #666',
          cursor: 'pointer',
          userSelect: 'none',
          background: 'rgba(0, 0, 0, 0.5)',
          marginRight: '8px',
          whiteSpace: 'nowrap',
          textShadow: '0 0 3px #000',
        }"
      >
        Audio
      </div>
      <!-- Playback speed (click cycles 1x / 2x / 5x / 10x) -->
      <div
        @click.stop="cyclePlaybackRate"
        title="playback speed"
        :style="{
          marginLeft: 'auto',
          color: 'white',
          fontSize: '13px',
          padding: '2px 8px',
          borderRadius: '4px',
          border: '1px solid #666',
          cursor: 'pointer',
          userSelect: 'none',
          background:
            playbackRate === 1 ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 100, 0.9)',
          marginRight: '8px',
          whiteSpace: 'nowrap',
          flexShrink: 0,
          textShadow: '0 0 3px #000',
        }"
      >
        {{ playbackRate }}x
      </div>
      <!-- Intro mode: Strip (film strip of stills) — left of None -->
      <div
        v-if="mode === 'intro'"
        @click.stop="clickStrip"
        title="film strip of stills"
        style="
          color: white;
          font-size: 13px;
          padding: 2px 8px;
          border-radius: 4px;
          border: 1px solid #666;
          cursor: pointer;
          user-select: none;
          white-space: nowrap;
          flex-shrink: 0;
          margin-right: 8px;
          background: rgba(0, 0, 0, 0.5);
          text-shadow: 0 0 3px #000;
        "
      >
        Strip
      </div>
      <!-- Intro mode: None (checked, no intro) — sits just left of the X -->
      <div
        v-if="mode === 'intro'"
        @click.stop="clickIntroNone"
        title="checked, no intro"
        style="
          color: white;
          font-size: 13px;
          padding: 2px 8px;
          border-radius: 4px;
          border: 1px solid #666;
          cursor: pointer;
          user-select: none;
          white-space: nowrap;
          flex-shrink: 0;
          margin-right: 14px;
          text-shadow: 0 0 3px #000;
        "
        :style="{
          background: introNone
            ? 'rgba(180, 50, 50, 0.9)'
            : 'rgba(0, 0, 0, 0.5)',
        }"
      >
        None
      </div>
      <!-- X close -->
      <div
        @click.stop="close"
        :style="{
          color: 'white',
          fontSize: '28px',
          lineHeight: '1',
          cursor: 'pointer',
          userSelect: 'none',
          textShadow: '0 0 4px #000',
          paddingLeft: '14px',
        }"
      >
        ✕
      </div>
    </div>
    <video
      ref="vid"
      controls
      :autoplay="!windowed"
      :muted="playerMuted"
      crossorigin="anonymous"
      :src="vidSrc"
      style="max-width: 100%; max-height: 100%; outline: none; display: block"
      @dblclick="toggleFullscreen"
      @error="onVideoError"
      @timeupdate="onVideoTimeUpdate"
      @loadedmetadata="onVideoLoadedMetadata"
      @volumechange="onVideoVolumeChange"
      @durationchange="onVideoDurationChange"
      @seeked="onVideoSeeked"
      @seeking="onVideoSeeking"
      @play="onVideoPlay"
      @pause="onVideoPause"
    >
      <track
        v-if="activeTrackUrl"
        :key="activeTrackUrl"
        kind="subtitles"
        srclang="en"
        label="subtitles"
        :src="activeTrackUrl"
        default
        @load="onSubTrackLoad"
      />
    </video>
    <!-- Film strip: every still of the episode, wrapped, clicked to cue -->
    <div
      v-if="stripOpen"
      ref="strip"
      @scroll="onStripScroll"
      @click.self="stripOpen = false"
      style="
        position: fixed;
        inset: 0;
        z-index: 5100;
        background: #000;
        overflow-y: auto;
        display: flex;
        flex-wrap: wrap;
        align-content: flex-start;
        gap: 4px;
        padding: 4px;
      "
    >
      <div
        v-if="windowed"
        style="
          flex-basis: 100%;
          color: yellow;
          font-size: 13px;
          user-select: none;
          padding: 4px 8px;
        "
      >
        {{ stripStatusText }}
      </div>
      <div
        v-for="still in stills.slice(0, stripShown)"
        :key="still.ms"
        @click.stop="clickStill(still)"
        style="width: 200px; cursor: pointer; flex: 0 0 auto"
      >
        <img
          :src="still.url"
          loading="lazy"
          style="width: 200px; display: block"
        />
        <div
          style="
            color: #999;
            font-size: 10px;
            text-align: center;
            user-select: none;
          "
        >
          {{ fmtTime(still.ms) }}
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { config } from "../config.js";
import {
  applySubOffset,
  chksrtOk,
  chksrtOkShow,
  chksrtGenSrt,
  chksrtUnsnooze,
  chksrtSnooze,
  chksrtSelect,
  getChksrtHistory,
  addChksrtHistory,
  setTvdbFields,
  saveSeasonIntro,
  getStills,
} from "../srvr.js";

import { fmtPos, getSeasonIntro } from "@tv/share";
import { logHere, unilog } from "../log.js";

const TV_SRVR_URL = config.tvSrvrUrl;
const PLAYER_MUTE_STORAGE_KEY = "tvPlayerMuted";
const PLAYER_VOLUME_STORAGE_KEY = "tvPlayerVolume";
const SPEED_RATES = [1, 2, 5, 10];
// Film strip stills are rendered as they come into reach rather than all at
// once — a full episode is a few hundred images and the pane must open now.
const STRIP_PAGE = 60;
const STRIP_SCROLL_SLOP_PX = 400;
// Intro and chksrt panes are "windowed": no whole-episode source is loaded.
// Intro opens on a film strip of stills (tv-srvr stills.js) and streams a short
// window of the original from the still you click, starting WINDOW_LEAD_SECS
// before it; chksrt streams a window from the first subtitle cue. WINDOW_SECS
// must match the server's; a seek outside the current window fetches a new one.
const WINDOW_LEAD_SECS = 20;
const WINDOW_SECS = 140;
// While playing, the next window is appended to the same buffer this many
// seconds before the current one runs out, so playback never stalls.
const WINDOW_EXTEND_AT_SECS = 30;
const STILLS_POLL_MS = 500;
const FIRST_CUE_LEAD_SEC = 1;
// The chksrt stream is a ten minute mirror of the episode; a first cue past
// that is not reviewable, so it never sets the jump point.
const FIRST_CUE_MAX_SEC = 600;
// Never land on the last seconds of the mirror — there would be nothing left
// to watch.
const FIRST_CUE_TAIL_SEC = 5;
const FIRST_CUE_SEEK_POLL_MS = 400;
const FIRST_CUE_SEEK_TRIES = 8;
const FIRST_CUE_SEEK_SLOP_SEC = 2;
const offsetCache = new Map(); // in-memory per-file subtitle offset

function fmtTime(ms) {
  const totalSec = ms / 1000;
  const mm = Math.floor(totalSec / 60).toString();
  const ss = Math.floor(totalSec % 60)
    .toString()
    .padStart(2, "0");
  const t = Math.floor((totalSec % 1) * 10);
  return `${mm}:${ss}.${t}`;
}

function parseSeasonEpisodeFromPath(path) {
  if (!path) return { season: null, episode: null };
  const name = String(path).split("/").pop() || "";
  let m = name.match(/[sS](\d{1,2})[eE](\d{1,3})/);
  if (!m) m = name.match(/(?:^|[^0-9])(\d{1,2})x(\d{1,3})(?:[^0-9]|$)/i);
  if (!m) return { season: null, episode: null };

  const season = Number(m[1]);
  const episode = Number(m[2]);
  if (!Number.isFinite(season) || !Number.isFinite(episode)) {
    return { season: null, episode: null };
  }
  return { season, episode };
}

export default {
  name: "VideoPlayer",
  props: {
    path: { type: String, default: null },
    mode: { type: String, default: null },
    chksrtCount: { type: Number, default: 0 },
    introCount: { type: Number, default: 0 },
    introShow: { type: Object, default: null },
    introShows: { type: Array, default: () => [] },
    introSeason: { type: Number, default: null },
    introEpisode: { type: Number, default: null },
    introSource: { type: String, default: null },
  },
  emits: ["close", "chksrt-next", "chksrt-sel", "intro-next", "intro-sel"],
  data() {
    return {
      audioTracks: [],
      activeAudioIndex: null,
      subtitleTracks: [],
      firstCueSec: null,
      chksrtFirstCueSec: null,
      activeTrackId: null,
      subtitleOffset: 0,
      vidSrc: "",
      errorRetries: 0,
      chksrtMatch: null,
      startMark: 0,
      trimPos: null,
      skipDur: null,
      introNone: false,
      currentTimeSec: 0,
      seekTarget: null,
      playerMuted: false,
      playerVolume: 1,
      waitingForVideo: false,
      waitingForVideoTarget: null,
      pendingSourceResumeTime: null,
      pendingSourceResumePlay: false,
      playbackRate: 1,
      stripOpen: false,
      stripShown: STRIP_PAGE,
      stills: [],
      // windowed panes: stills progress from the server, the current window's
      // span, and how long the picture took after the last still click.
      stillsStatus: null,
      windowStart: null,
      windowEnd: null,
      pictureMs: null,
    };
  },
  computed: {
    streamUrl() {
      if (!this.path) return "";
      return this._buildStreamUrl(
        this.activeTrack?.type === "pgs" ? this.activeTrack.index : null,
      );
    },
    activeAudioTrack() {
      if (this.audioTracks.length === 0) return null;
      if (this.activeAudioIndex == null) return this.audioTracks[0] || null;
      return (
        this.audioTracks.find(
          (track) => track.index === this.activeAudioIndex,
        ) ||
        this.audioTracks[0] ||
        null
      );
    },
    activeAudioLabel() {
      return this.activeAudioTrack
        ? `Audio: ${this.activeAudioTrack.label}`
        : "Audio";
    },
    activeTrack() {
      if (!this.activeTrackId || this.activeTrackId === "off") return null;
      return (
        this.subtitleTracks.find((t) => t.id === this.activeTrackId) || null
      );
    },
    activeTrackUrl() {
      const track = this.activeTrack;
      if (!track || !this.path) return null;
      const base = `${TV_SRVR_URL}/api/subtitle?path=${encodeURIComponent(this.path)}`;
      if (
        track.type === "embedded" ||
        track.type === "forced" ||
        track.type === "pgs"
      )
        return `${base}&index=${track.index}`;
      if (track.type === "srt") {
        let url = `${base}&file=${encodeURIComponent(track.file)}`;
        if (this.subtitleOffset !== 0) url += `&offset=${this.subtitleOffset}`;
        return url;
      }
      return null;
    },
    showSlider() {
      return this.activeTrack?.type === "srt";
    },
    activeTrackSuffix() {
      const track = this.activeTrack;
      if (!track) return "";
      const keywords = ["SDH", "CC", "HI", "FORCED"];
      const src = [
        track.type === "forced" ? "forced" : "",
        track.label || "",
        track.file || "",
      ]
        .join(" ")
        .toUpperCase();
      const found = keywords.filter((k) => src.includes(k));
      return found.length ? " (" + found.join(", ") + ")" : "";
    },
    ballPct() {
      return ((this.subtitleOffset + 3) / 6) * 100;
    },
    offsetDisplay() {
      return this.subtitleOffset.toFixed(2);
    },
    ticks() {
      return [-3, -2, -1, 0, 1, 2, 3].map((v) => ({
        val: v,
        pct: ((v + 3) / 6) * 100,
      }));
    },
    subtitleChoices() {
      if (this.subtitleTracks.length === 0) return [];
      return [...this.subtitleTracks, { id: "off", label: "off" }];
    },
    waitingForFirstCue() {
      return (
        this.mode === "chksrt" &&
        this.firstCueSec !== null &&
        this.currentTimeSec < this.firstCueSec
      );
    },
    subtitleLabelMap() {
      const map = new Map();
      let n = 1;
      for (const t of this.subtitleTracks) {
        let char;
        if (t.type === "pgs") char = "*";
        else if (t.type === "sdh") char = "H";
        else if (t.type === "embedded") char = "T";
        else if (t.type === "forced") char = "F";
        else if (/\.asr\.srt$/.test(t.file || "")) char = "+";
        else if (/\.mb\d+\.srt$/.test(t.file || "")) char = ">";
        else if (/\.opn[A-Z2-7]{5}\.srt$/i.test(t.file || "")) {
          const tag = ((t.file || "").match(/\.opn([A-Z2-7]{5})\.srt$/i) ||
            [])[1];
          char = tag ? `V ${tag.toUpperCase()}` : "V";
        } else char = "S";
        map.set(t.id, char);
        n++;
      }
      map.set("off", "off");
      return map;
    },
    chksrtFilename() {
      if (!this.path) return "";
      const parts = this.path.split("/");
      const name = parts[parts.length - 1];
      return this.chksrtCount > 0 ? `(${this.chksrtCount}) ${name}` : name;
    },
    chksrtShowName() {
      if (!this.path) return null;
      const parts = this.path.split("/");
      return parts.length >= 3 ? parts[parts.length - 3] : null;
    },
    chksrtShowObj() {
      if (!this.chksrtShowName) return null;
      return (
        this.introShows.find((s) => s.name === this.chksrtShowName) ?? null
      );
    },
    startMarkLabel() {
      return fmtPos(this.startMark);
    },
    trimPosLabel() {
      return fmtPos(this.trimPos);
    },
    skipDurLabel() {
      return fmtPos(this.skipDur);
    },
    introSeasonForDisplay() {
      if (this.introSeason != null) return this.introSeason;
      return parseSeasonEpisodeFromPath(this.path).season;
    },
    introEpisodeForDisplay() {
      if (this.introEpisode != null) return this.introEpisode;
      return parseSeasonEpisodeFromPath(this.path).episode;
    },
    introSeasonEpisodeLabel() {
      if (
        this.introSeasonForDisplay == null ||
        this.introEpisodeForDisplay == null
      ) {
        return "";
      }
      return ` (s${String(this.introSeasonForDisplay).padStart(2, "0")}e${String(this.introEpisodeForDisplay).padStart(2, "0")})`;
    },
    introRemainingCount() {
      return this.introCount;
    },
    // Intro and chksrt stream windows of the original (see WINDOW_SECS); plain
    // playback still loads the whole file through /api/stream.
    windowed() {
      return this.mode === "intro" || this.mode === "chksrt";
    },
    stripStatusText() {
      const st = this.stillsStatus;
      if (!st) return "stills: starting";
      if (st.error) return `stills failed: ${st.error}`;
      if (st.queued) return `stills queued behind ${st.queuedBehind}`;
      const took =
        st.elapsedMs != null ? ` · ${(st.elapsedMs / 1000).toFixed(1)} s` : "";
      const how = st.dense == null ? "" : ` · ${st.dense ? "nokey" : "noref"} ${st.decode ?? ""}`;
      if (!st.done) return `stills ${st.count}/${st.total || "?"}${took}${how}`;
      return `ready · ${st.count} stills${took}${how}`;
    },
    testTelemetry() {
      const parts = [];
      const st = this.stillsStatus;
      if (st?.done && st.elapsedMs != null)
        parts.push(`strip ${(st.elapsedMs / 1000).toFixed(1)}s`);
      else if (st && !st.done) parts.push(`strip ${st.count}/${st.total || "?"}`);
      if (this.windowStart !== null)
        parts.push(
          `window ${fmtTime(this.windowStart * 1000)}–${fmtTime(this.windowEnd * 1000)}`,
        );
      if (this.pictureMs !== null)
        parts.push(`picture ${(this.pictureMs / 1000).toFixed(2)}s`);
      return parts.join(" · ");
    },
  },
  watch: {
    introShow(newVal) {
      if (!newVal?.name) return;
      const si = getSeasonIntro(newVal?.seasonIntros, this.introSeason);
      this.startMark = si.startMark ?? 0;
      this.trimPos = si.trimPos ?? null;
      this.skipDur = si.skipDur ?? null;
      this.introNone = si.none === true;
    },
    introSeason(newVal) {
      if (!this.introShow?.name) return;
      const si = getSeasonIntro(this.introShow?.seasonIntros, newVal);
      this.startMark = si.startMark ?? 0;
      this.trimPos = si.trimPos ?? null;
      this.skipDur = si.skipDur ?? null;
      this.introNone = si.none === true;
    },
    path(newVal) {
      this._mseStop();
      this._stopStillsPoll();
      this._chksrtSelectedSrtPath = undefined;
      this._chksrtSelectedChoice = undefined;
      this.audioTracks = [];
      this.activeAudioIndex = null;
      this.subtitleTracks = [];
      this.activeTrackId = null;
      this.firstCueSec = null;
      this.chksrtFirstCueSec = null;
      this._firstCueJumpPath = null;
      this._clearFirstCueSeek();
      this.chksrtMatch = null;
      this.errorRetries = 0;
      this.pendingSourceResumeTime = null;
      this.pendingSourceResumePlay = false;
      this.playbackRate = 1;
      // Windowed: nothing loads until a still is clicked.
      this.vidSrc = newVal && !this.windowed ? this._buildStreamUrl() : "";
      if (newVal && this.mode === "intro" && !this.windowed)
        this._seekOnLoad = true;
      this.subtitleOffset = offsetCache.get(newVal) ?? 0;
      if (newVal && !this.windowed) {
        this._fetchSubtitleList(newVal);
        this._fetchAudioList(newVal);
      } else if (newVal && this.mode === "chksrt") {
        // Windowed chksrt: the track list decides where the window opens (the
        // first cue, via _maybeJumpToFirstCue); with no text track, the start.
        this._fetchSubtitleList(newVal).then(() => {
          if (this.path === newVal && this.windowStart === null)
            this._openWindow(0, { play: true, lead: 0 });
        });
        this._fetchAudioList(newVal);
      }
      this.waitingForVideo = false;
      this.waitingForVideoTarget = null;
      this.stripOpen = false;
      this.stills = [];
      this.stripShown = STRIP_PAGE;
      this.stillsStatus = null;
      this.windowStart = null;
      this.windowEnd = null;
      this.pictureMs = null;
      this._win = null;
      if (newVal && this.windowed && this.mode === "intro") this.clickStrip();
    },
    activeTrackUrl(newVal) {
      this.firstCueSec = null;
      if (newVal) {
        this.$nextTick(() => {
          const vid = this.$refs.vid;
          if (vid) for (const tt of vid.textTracks) tt.mode = "showing";
        });
      }
    },
  },
  methods: {
    _buildStreamUrl(subIndex = null, audioIndex = this.activeAudioIndex) {
      let url = `${TV_SRVR_URL}/api/stream?path=${encodeURIComponent(this.path)}`;
      if (subIndex !== null) url += `&sub=${subIndex}`;
      if (audioIndex !== null && audioIndex !== undefined)
        url += `&audio=${audioIndex}`;
      return url;
    },
    async _fetchAudioList(filePath) {
      try {
        const resp = await fetch(
          `${TV_SRVR_URL}/api/audio-list?path=${encodeURIComponent(filePath)}`,
        );
        if (!resp.ok) return;
        const tracks = await resp.json();
        if (this.path !== filePath) return;
        this.audioTracks = Array.isArray(tracks) ? tracks : [];
        if (
          this.activeAudioIndex != null &&
          !this.audioTracks.some(
            (track) => track.index === this.activeAudioIndex,
          )
        ) {
          this.activeAudioIndex = null;
        }
      } catch (e) {
        unilog(1047, "fetch error:", e);
      }
    },
    async _fetchSubtitleList(filePath) {
      try {
        const resp = await fetch(
          `${TV_SRVR_URL}/api/subtitle-list?path=${encodeURIComponent(filePath)}`,
        );
        if (!resp.ok) return;
        const tracks = await resp.json();
        this.subtitleTracks = tracks;
        if (tracks.length > 0) {
          // Prefer a text track for the opening pick. pgs is bitmap, so showing
          // it means burning it in with ffmpeg on the original — that gives up
          // the seekable mp4 mirror and its known duration, leaving the timeline
          // with only the seconds ffmpeg has piped so far. Selecting pgs by hand
          // still switches to the burn-in stream.
          // An .mbN.srt sidecar is the embedded track already extracted by
          // the sub pipeline, so it shows at once where the embedded track
          // would first demux the whole file (30-50s cold on a 2160p mkv).
          const first =
            tracks.find(
              (t) => t.type === "srt" && /\.mb\d+\.srt$/.test(t.file || ""),
            ) ||
            tracks.find((t) => t.type !== "pgs") ||
            tracks[0];
          this.activeTrackId = first.id;
          if (first.type === "pgs" && !this.windowed) {
            this.vidSrc = this._buildStreamUrl(first.index);
          }
        }
        if (this.mode === "chksrt") {
          this._setChksrtFirstCue(tracks);
          await this._loadChksrtHistoryAndCompare(filePath);
        }
      } catch (e) {
        unilog(1048, "fetch error:", e);
      }
    },
    // chksrt: take the first cue time of any text subtitle (embedded or srt)
    // so the video can jump straight to where subtitles start. pgs is bitmap
    // and forced covers only foreign dialog, so neither says where subs begin.
    _setChksrtFirstCue(tracks) {
      // Every track's cue time arrives with the list, so take the latest of
      // them: by then every track has text, so whichever subtitle the reviewer
      // switches to is showing something.
      let best = null;
      for (const t of tracks) {
        if (t.type !== "embedded" && t.type !== "sdh" && t.type !== "srt")
          continue;
        if (typeof t.firstCue !== "number") continue;
        // A track that starts past the mirror is junk for this purpose — it
        // would drag the jump to the end of the ten minutes on offer.
        if (t.firstCue > FIRST_CUE_MAX_SEC) continue;
        if (best === null || t.firstCue > best.firstCue) best = t;
      }
      if (best === null) return;
      this.chksrtFirstCueSec = best.firstCue;
      this._maybeJumpToFirstCue();
    },
    _maybeJumpToFirstCue() {
      if (this.mode !== "chksrt") return;
      const forPath = this.path;
      if (!forPath || this._firstCueJumpPath === forPath) return;
      const sec = this.chksrtFirstCueSec;
      if (sec === null) return;
      const target = sec - FIRST_CUE_LEAD_SEC;
      if (this.windowed) {
        // No seek to confirm: the window simply starts at the first cue.
        this._firstCueJumpPath = forPath;
        this._openWindow(Math.max(0, target), { play: true, lead: 0 });
        return;
      }
      if (target < 1) return;
      const vid = this.$refs.vid;
      if (!vid || vid.readyState < 1) return; // no metadata yet
      if (
        Number.isFinite(vid.duration) &&
        target > vid.duration - FIRST_CUE_TAIL_SEC
      ) {
        return;
      }
      this._firstCueJumpPath = forPath;
      this._clearFirstCueSeek();
      vid.currentTime = target;
      // A fresh stream can silently drop the seek while it is still
      // buffering, so keep re-applying it until it takes.
      let tries = 0;
      this._firstCueSeekTimer = setInterval(() => {
        const v = this.$refs.vid;
        if (
          !v ||
          this.path !== forPath ||
          v.currentTime >= target - FIRST_CUE_SEEK_SLOP_SEC ||
          ++tries >= FIRST_CUE_SEEK_TRIES
        ) {
          this._clearFirstCueSeek();
          return;
        }
        v.currentTime = target;
      }, FIRST_CUE_SEEK_POLL_MS);
    },
    _clearFirstCueSeek() {
      if (this._firstCueSeekTimer) {
        clearInterval(this._firstCueSeekTimer);
        this._firstCueSeekTimer = null;
      }
    },
    _swapStream(subIndex = null, audioIndex = this.activeAudioIndex) {
      const vid = this.$refs.vid;
      if (this.windowed && this._win) {
        this._openWindow(vid?.currentTime || 0, {
          play: vid ? !vid.paused : true,
          lead: 0,
        });
        return;
      }
      this.pendingSourceResumeTime =
        vid && Number.isFinite(vid.currentTime) ? vid.currentTime : 0;
      this.pendingSourceResumePlay = vid ? !vid.paused : false;
      this._mseStop();
      this.errorRetries = 0;
      if (vid) vid.pause();
      this.vidSrc = this._buildStreamUrl(subIndex, audioIndex);
    },
    cycleAudioTrack() {
      if (this.audioTracks.length <= 1) return;
      const currentPos =
        this.activeAudioIndex == null
          ? 0
          : this.audioTracks.findIndex(
              (track) => track.index === this.activeAudioIndex,
            );
      const safePos = currentPos >= 0 ? currentPos : 0;
      const nextPos = (safePos + 1) % this.audioTracks.length;
      const nextAudioIndex =
        nextPos === 0 ? null : this.audioTracks[nextPos].index;
      this.activeAudioIndex = nextAudioIndex;
      this._swapStream(
        this.activeTrack?.type === "pgs" ? this.activeTrack.index : null,
        nextAudioIndex,
      );
    },
    onSubTrackLoad(e) {
      const cues = e.target.track?.cues;
      this.firstCueSec = cues && cues.length > 0 ? cues[0].startTime : null;
    },
    selectTrack(id) {
      const prevTrack = this.activeTrack;
      this.activeTrackId = id;
      const newTrack = this.subtitleTracks.find((t) => t.id === id) || null;
      const wasPgs = prevTrack?.type === "pgs";
      const isPgs = newTrack?.type === "pgs";
      if (isPgs) {
        // PGS is a bitmap track burned in by ffmpeg on the original, so a
        // windowed pane drops its window and plays the burn-in stream directly;
        // _win stays null until a text track brings the windows back.
        if (this.windowed) {
          this._mseStop();
          this._win = null;
          this.windowStart = null;
          this.windowEnd = null;
        }
        this.vidSrc = this._buildStreamUrl(newTrack.index);
      } else if (wasPgs) {
        if (this.windowed) {
          const vid = this.$refs.vid;
          this._openWindow(vid?.currentTime || 0, {
            play: vid ? !vid.paused : true,
            lead: 0,
          });
        } else {
          this.vidSrc = this.streamUrl;
        }
      }
      if (id === "off") {
        const vid = this.$refs.vid;
        if (vid) for (const tt of vid.textTracks) tt.mode = "disabled";
      }
    },
    _setOffsetFromX(clientX) {
      const rect = this.$refs.slider.getBoundingClientRect();
      const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
      const raw = (x / rect.width) * 6 - 3;
      this.subtitleOffset = Math.round(raw / 0.05) * 0.05;
      offsetCache.set(this.path, this.subtitleOffset);
    },
    sliderMouseDown(e) {
      this._setOffsetFromX(e.clientX);
      const onMove = (e) => this._setOffsetFromX(e.clientX);
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    sliderTouchStart(e) {
      this._setOffsetFromX(e.touches[0].clientX);
      const onMove = (e) => this._setOffsetFromX(e.touches[0].clientX);
      const onEnd = () => {
        window.removeEventListener("touchmove", onMove);
        window.removeEventListener("touchend", onEnd);
      };
      window.addEventListener("touchmove", onMove, { passive: true });
      window.addEventListener("touchend", onEnd);
    },
    onVideoError(e) {
      if (this.windowed && this._win) {
        // Opening clears src to "", and Chrome reports an empty src as a
        // media error. Nothing was loaded, so there is nothing to recover.
        if (!this.vidSrc) return;
        if (++this.errorRetries > 3) {
          unilog(2406, `window video error, giving up: ${e?.target?.error?.message}`);
          return;
        }
        const vid = this.$refs.vid;
        this._openWindow(vid?.currentTime || this.windowStart || 0, {
          play: this.mode === "chksrt",
          lead: 0,
        });
        return;
      }
      const vid = this.$refs.vid;
      if (!vid) return;
      if (!this.vidSrc) return;
      const err = vid.error;
      if (!err) return;
      if (this.errorRetries >= 3) {
        unilog(1759, `error code=${err.code}, giving up after ${this.errorRetries} retries`);
        return;
      }
      this.errorRetries++;
      const resumeAt = vid.currentTime;
      unilog(1760, `error code=${err.code} at ${resumeAt.toFixed(1)}s, retry ${this.errorRetries}`);
      this._mseStop();
      setTimeout(() => {
        const v = this.$refs.vid;
        if (!v) return;
        if (resumeAt > 0) {
          this._mseRecover(resumeAt);
        } else {
          v.load();
          v.play().catch(() => {});
        }
      }, 1000);
    },
    _mseStop() {
      if (this._mseAbort) {
        this._mseAbort.abort();
        this._mseAbort = null;
      }
    },
    _mseRecover(startSec) {
      const vid = this.$refs.vid;
      if (!vid) return;
      const url = `${this.streamUrl}&start=${Math.floor(startSec)}`;
      const mimeType = 'video/mp4; codecs="avc1.640028,mp4a.40.2"';
      if (!window.MediaSource || !MediaSource.isTypeSupported(mimeType)) {
        vid.load();
        vid.play().catch(() => {});
        return;
      }
      const abort = new AbortController();
      this._mseAbort = abort;
      const ms = new MediaSource();
      const blobUrl = URL.createObjectURL(ms);
      ms.addEventListener(
        "sourceopen",
        async () => {
          URL.revokeObjectURL(blobUrl);
          let sb;
          try {
            sb = ms.addSourceBuffer(mimeType);
          } catch (e) {
            if (!abort.signal.aborted) {
              vid.load();
              vid.play().catch(() => {});
            }
            return;
          }
          sb.timestampOffset = startSec;
          let res;
          try {
            res = await fetch(url, { signal: abort.signal });
            if (!res.ok) throw new Error(String(res.status));
          } catch (e) {
            if (!abort.signal.aborted) {
              vid.load();
              vid.play().catch(() => {});
            }
            return;
          }
          const reader = res.body.getReader();
          try {
            while (!abort.signal.aborted) {
              const { done, value } = await reader.read();
              if (done) {
                ms.endOfStream();
                break;
              }
              sb.appendBuffer(value);
              await new Promise((ok, fail) => {
                sb.addEventListener("updateend", ok, { once: true });
                sb.addEventListener("error", fail, { once: true });
              });
            }
          } catch (e) {
            if (!abort.signal.aborted) unilog(1051, "", e);
          }
          if (abort.signal.aborted) reader.cancel().catch(() => {});
        },
        { once: true },
      );
      this.vidSrc = blobUrl;
    },
    async _loadChksrtHistoryAndCompare(forPath) {
      this.chksrtMatch = null;
      let history;
      try {
        history = await getChksrtHistory();
      } catch (e) {
        return;
      }
      if (this.path !== forPath) return; // stale — path changed while fetching
      if (!Array.isArray(history) || history.length === 0) return;
      const pathParts = forPath.split("/");
      const videoFilename = pathParts[pathParts.length - 1];
      const showName = forPath.startsWith("/mnt/media/tv/")
        ? forPath.slice("/mnt/media/tv/".length).split("/")[0]
        : "";
      const last12 = videoFilename.slice(-12);
      for (const h of history) {
        if (h.showName !== showName) continue;
        if ((h.videoFilename || "").slice(-12) !== last12) continue;
        this.chksrtMatch = h;
        // Auto-select the previously chosen track
        let matchTrack = null;
        if (h.srtFile) {
          matchTrack =
            this.subtitleTracks.find((t) => t.file === h.srtFile) || null;
        } else if (h.embStreamIndex != null) {
          matchTrack =
            this.subtitleTracks.find((t) => t.index === h.embStreamIndex) ||
            null;
        }
        if (matchTrack) this.selectTrack(matchTrack.id);
        break;
      }
    },
    _saveChksrtHistory(choiceLabel, choice) {
      if (!this.path) return;
      const pathParts = this.path.split("/");
      const videoFilename = pathParts[pathParts.length - 1];
      const showName = this.path.startsWith("/mnt/media/tv/")
        ? this.path.slice("/mnt/media/tv/".length).split("/")[0]
        : "";
      const embeddedCounts = {};
      let openSubsCount = 0;
      for (const t of this.subtitleTracks) {
        if (t.type === "pgs")
          embeddedCounts.pgs = (embeddedCounts.pgs || 0) + 1;
        else if (t.type === "embedded" || t.type === "forced")
          embeddedCounts.text = (embeddedCounts.text || 0) + 1;
        else if (
          t.type === "srt" &&
          /\.opn[A-Z2-7]{5}\.srt$/i.test(t.file || "")
        )
          openSubsCount++;
      }
      addChksrtHistory({
        showName,
        videoFilename,
        embeddedCounts,
        openSubsCount,
        choice: choiceLabel,
        embStreamIndex:
          choice &&
          (choice.type === "embedded" ||
            choice.type === "sdh" ||
            choice.type === "forced" ||
            choice.type === "pgs")
            ? (choice.index ?? null)
            : null,
        srtFile: choice && choice.type === "srt" ? (choice.file ?? null) : null,
      }).catch((e) => unilog(1052, "addChksrtHistory error:", e));
    },
    cyclePlaybackRate() {
      const idx = SPEED_RATES.indexOf(this.playbackRate);
      const rate = SPEED_RATES[(idx + 1) % SPEED_RATES.length];
      this.playbackRate = rate;
      const vid = this.$refs.vid;
      if (vid) vid.playbackRate = rate;
    },
    onVideoLoadedMetadata() {
      this._applyIntroAudioState();
      const vid = this.$refs.vid;
      if (vid) vid.playbackRate = this.playbackRate;
      if (this.pendingSourceResumeTime !== null) {
        const resumeTime = this.pendingSourceResumeTime;
        const shouldPlay = this.pendingSourceResumePlay;
        this.pendingSourceResumeTime = null;
        this.pendingSourceResumePlay = false;
        if (vid && resumeTime > 0) {
          try {
            vid.currentTime = resumeTime;
          } catch {}
        }
        if (vid && shouldPlay) vid.play().catch(() => {});
        return;
      }
      if (this.mode !== "intro") {
        if (vid) vid.play().catch(() => {});
        if (this.mode === "chksrt") {
          this._maybeJumpToFirstCue();
          return;
        }
      }
      if (!this._seekOnLoad) return;
      this._seekOnLoad = false;
      const targetSec =
        this.mode === "intro" ? 0 : Math.max(0, (this.startMark - 3000) / 1000);
      this._seekWithConfirm(targetSec);
      if (vid) vid.play().catch(() => {});
    },
    onVideoVolumeChange() {
      const vid = this.$refs.vid;
      if (!vid) return;
      const nextMuted = !!vid.muted;
      const nextVolume = Number(vid.volume);
      const volume = Number.isFinite(nextVolume)
        ? Math.max(0, Math.min(1, nextVolume))
        : 1;
      this.playerMuted = nextMuted;
      this.playerVolume = volume;
      window.localStorage.setItem(
        PLAYER_MUTE_STORAGE_KEY,
        nextMuted ? "1" : "0",
      );
      window.localStorage.setItem(PLAYER_VOLUME_STORAGE_KEY, String(volume));
    },
    _applyIntroAudioState() {
      const vid = this.$refs.vid;
      if (!vid) return;
      vid.muted = this.playerMuted;
      vid.volume = Math.max(0, Math.min(1, Number(this.playerVolume) || 0));
    },
    _seekWithConfirm(targetSec) {
      this._cancelSeek();
      const vid = this.$refs.vid;
      if (!vid) {
        this.seekTarget = null;
        return;
      }
      if (
        this.mode === "intro" &&
        Number.isFinite(vid.duration) &&
        vid.duration > 0 &&
        targetSec > vid.duration
      ) {
        this._enterWaitingForVideo(targetSec);
        return;
      }
      this.seekTarget = targetSec;
      vid.currentTime = targetSec;
      this._seekPollInterval = setInterval(() => {
        const v = this.$refs.vid;
        if (!v || this.seekTarget === null) {
          clearInterval(this._seekPollInterval);
          this._seekPollInterval = null;
          return;
        }
        if (Math.abs(v.currentTime - this.seekTarget) < 1.0) {
          this.seekTarget = null;
          clearInterval(this._seekPollInterval);
          this._seekPollInterval = null;
        } else {
          v.currentTime = this.seekTarget;
        }
      }, 300);
    },
    _cancelSeek() {
      if (this._seekPollInterval) {
        clearInterval(this._seekPollInterval);
        this._seekPollInterval = null;
      }
      this.seekTarget = null;
    },
    clickNavBack30() {
      if (this.waitingForVideo) this._exitWaitingForVideo();
      this._cancelSeek();
      const vid = this.$refs.vid;
      if (vid) vid.currentTime = Math.max(0, vid.currentTime - 30);
    },
    clickNavBack10() {
      if (this.waitingForVideo) this._exitWaitingForVideo();
      this._cancelSeek();
      const vid = this.$refs.vid;
      if (vid) vid.currentTime = Math.max(0, vid.currentTime - 10);
    },
    clickNavBack3() {
      if (this.waitingForVideo) this._exitWaitingForVideo();
      this._cancelSeek();
      const vid = this.$refs.vid;
      if (vid) vid.currentTime = Math.max(0, vid.currentTime - 3);
    },
    clickNavFwd10() {
      if (this.waitingForVideo) this._exitWaitingForVideo();
      this._cancelSeek();
      const vid = this.$refs.vid;
      if (vid) vid.currentTime += 10;
    },
    clickNavFwd30() {
      if (this.waitingForVideo) this._exitWaitingForVideo();
      this._cancelSeek();
      const vid = this.$refs.vid;
      if (vid) vid.currentTime += 30;
    },
    clickIntroZero() {
      if (this.waitingForVideo) this._exitWaitingForVideo();
      this._cancelSeek();
      const vid = this.$refs.vid;
      if (vid) vid.currentTime = 0;
    },
    clickIntroNone() {
      // removed in trim/skip redesign
    },
    clickIntroPre() {
      if (this.waitingForVideo) this._exitWaitingForVideo();
      const vid = this.$refs.vid;
      if (!vid) return;
      this._cancelSeek();
      vid.currentTime = Math.max(0, (this.startMark - 3000) / 1000);
    },
    clickIntroStart() {
      const vid = this.$refs.vid;
      if (!vid) return;
      if (this.waitingForVideo) this._exitWaitingForVideo();
      this._cancelSeek();
      this.startMark = Math.round(vid.currentTime * 1000);
      this._persistField("startMark", this.startMark);
    },
    // Trimming (absolute video position)
    clickTrimSet() {
      const vid = this.$refs.vid;
      if (!vid) return;
      if (this.waitingForVideo) this._exitWaitingForVideo();
      this._cancelSeek();
      this.trimPos = Math.round(vid.currentTime * 1000);
      this._persistField("trimPos", this.trimPos);
    },
    clickTrimJump() {
      if (this.waitingForVideo) this._exitWaitingForVideo();
      const vid = this.$refs.vid;
      if (!vid || !this.trimPos) return;
      this._cancelSeek();
      this._seekWithConfirm(this.trimPos / 1000);
    },
    clickTrimClr() {
      // >0 -> 0, null -> 0, 0 -> null
      this.trimPos = this.trimPos === 0 ? null : 0;
      this._persistField("trimPos", this.trimPos);
    },
    // Skipping (relative duration from startMark)
    clickSkipSet() {
      const vid = this.$refs.vid;
      if (!vid) return;
      if (this.startMark == null) return;
      if (this.waitingForVideo) this._exitWaitingForVideo();
      this._cancelSeek();
      const curPos = Math.round(vid.currentTime * 1000);
      if (curPos < this.startMark) return;
      this.skipDur = curPos - this.startMark;
      this._persistField("skipDur", this.skipDur);
    },
    clickSkipTest() {
      // Seek ahead by skipDur from current video position
      if (this.waitingForVideo) this._exitWaitingForVideo();
      const vid = this.$refs.vid;
      if (!vid || !this.skipDur) return;
      this._cancelSeek();
      this._seekWithConfirm(vid.currentTime + this.skipDur / 1000);
    },
    clickSkipClr() {
      // >0 -> 0, null -> 0, 0 -> null
      this.skipDur = this.skipDur === 0 ? null : 0;
      this._persistField("skipDur", this.skipDur);
    },
    // Strip: the wall of stills. Scanning it finds the skip region by eye,
    // where scrubbing the video passes over it as often as it lands on it.
    clickStrip() {
      this.stripOpen = true;
      this.stripShown = STRIP_PAGE;
      // The video is behind the strip and nobody is watching it.
      const vid = this.$refs.vid;
      if (vid) vid.pause();
      this._stopStillsPoll();
      this._pollStills();
    },
    onStripScroll() {
      const el = this.$refs.strip;
      if (!el || this.stripShown >= this.stills.length) return;
      if (
        el.scrollTop + el.clientHeight >=
        el.scrollHeight - STRIP_SCROLL_SLOP_PX
      ) {
        this.stripShown += STRIP_PAGE;
      }
    },
    // Cue the video to the clicked still and hold it there.
    clickStill(still) {
      this.stripOpen = false;
      if (this.waitingForVideo) this._exitWaitingForVideo();
      this._cancelSeek();
      this._openWindow(still.ms / 1000);
    },
    // Windowed: poll the server's stills progress and grow the strip as the
    // images land. The Nth image is grid mark (N-1)*gap, so a count is a list.
    async _pollStills() {
      const forPath = this.path;
      if (!forPath) return;
      let st;
      try {
        st = await getStills(forPath);
      } catch (e) {
        unilog(2407, `stills status failed: ${e.message}`);
        return;
      }
      if (this.path !== forPath) return;
      this.stillsStatus = st;
      if (st.count !== this.stills.length) {
        this.stills = Array.from({ length: st.count }, (_, i) => ({
          ms: i * st.gapMs,
          url: `${st.urlBase}/${String(i + 1).padStart(5, "0")}.jpg`,
        }));
      }
      if (st.done || st.error) return;
      this._stillsPollTimer = setTimeout(() => this._pollStills(), STILLS_POLL_MS);
    },
    _stopStillsPoll() {
      if (this._stillsPollTimer) clearTimeout(this._stillsPollTimer);
      this._stillsPollTimer = null;
    },
    // Windowed: a fresh MediaSource holding WINDOW_SECS of video from `lead`
    // seconds before seekSec, placed at its absolute position, then cued to
    // seekSec (paused for a still click, playing for chksrt). The MediaSource
    // keeps the episode's full duration so the scrub bar spans the whole
    // episode; endOfStream is never called because it would shrink that to
    // the window. While playing, _appendWindow adds the next WINDOW_SECS to
    // the same buffer before this one runs out.
    _openWindow(seekSec, { play = false, lead = WINDOW_LEAD_SECS } = {}) {
      const vid = this.$refs.vid;
      if (!vid || !this.path) return;
      this._mseStop();
      this._cancelSeek();
      const start = Math.max(0, seekSec - lead);
      this.windowStart = start;
      this.windowEnd = start + WINDOW_SECS;
      this.pictureMs = null;
      this._windowClickAt = performance.now();
      const mimeType = 'video/mp4; codecs="avc1.640028,mp4a.40.2"';
      if (!window.MediaSource || !MediaSource.isTypeSupported(mimeType)) {
        unilog(2392, `MediaSource unsupported for ${mimeType}`);
        return;
      }
      const abort = new AbortController();
      this._mseAbort = abort;
      const ms = new MediaSource();
      const blobUrl = URL.createObjectURL(ms);
      const win = { ms, sb: null, abort, fetching: false, end: start + WINDOW_SECS };
      this._win = win;
      ms.addEventListener(
        "sourceopen",
        () => {
          URL.revokeObjectURL(blobUrl);
          try {
            win.sb = ms.addSourceBuffer(mimeType);
          } catch (e) {
            unilog(2393, `addSourceBuffer failed: ${e.message}`);
            return;
          }
          this._appendWindow(win, start, { seekSec, play });
        },
        { once: true },
      );
      this.vidSrc = blobUrl;
    },
    // Fetch one window from `start` into win's buffer at its absolute position.
    // On the first chunk of an opening window, cue the video; an extension
    // just lands behind the playhead.
    async _appendWindow(win, start, cue = null) {
      const vid = this.$refs.vid;
      const { ms, sb, abort } = win;
      if (!vid || !sb || abort.signal.aborted) return;
      win.fetching = true;
      win.end = start + WINDOW_SECS;
      this.windowEnd = win.end;
      let url = `${TV_SRVR_URL}/api/window?path=${encodeURIComponent(this.path)}&start=${start.toFixed(2)}`;
      if (this.activeAudioIndex != null) url += `&audio=${this.activeAudioIndex}`;
      try {
        sb.timestampOffset = start;
        const res = await fetch(url, { signal: abort.signal });
        if (!res.ok) throw new Error(String(res.status));
        const reader = res.body.getReader();
        let cued = false;
        while (!abort.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          sb.appendBuffer(value);
          await new Promise((ok, fail) => {
            sb.addEventListener("updateend", ok, { once: true });
            sb.addEventListener("error", fail, { once: true });
          });
          // Cue only once real media is buffered — the first chunk is usually
          // just the moov header. And never cue earlier than the buffered
          // start: the first video frame lands a B-frame delay (~0.08s) after
          // the window start, and a seek to the exact start would sit just
          // before it, waiting for data that never comes.
          if (cue && !cued && sb.buffered.length > 0) {
            cued = true;
            const dur = this.stillsStatus?.durationSec;
            if (dur > 0 && ms.readyState === "open") ms.duration = dur;
            vid.currentTime = Math.max(cue.seekSec, sb.buffered.start(0) + 0.01);
            if (cue.play) vid.play().catch(() => {});
            else vid.pause();
          }
        }
        if (abort.signal.aborted) reader.cancel().catch(() => {});
      } catch (e) {
        if (!abort.signal.aborted)
          unilog(2394, `window fetch/append failed at ${start}s: ${e.message}`);
      } finally {
        win.fetching = false;
      }
    },
    onVideoTimeUpdate() {
      const vid = this.$refs.vid;
      this.currentTimeSec = vid ? vid.currentTime : 0;
      const win = this._win;
      if (!this.windowed || !vid || !win || win.fetching || vid.paused) return;
      if (vid.currentTime > win.end - WINDOW_EXTEND_AT_SECS) {
        const dur = this.stillsStatus?.durationSec;
        if (dur > 0 && win.end >= dur) return;
        this._appendWindow(win, win.end);
      }
    },
    // Windowed: a seek that lands outside the current window (scrub bar,
    // ±30, Trim Jump, Skip Test) fetches a window there instead of stalling.
    onVideoSeeking() {
      if (!this.windowed || !this._win) return;
      const vid = this.$refs.vid;
      if (!vid) return;
      const t = vid.currentTime;
      if (
        this.windowStart !== null &&
        t >= this.windowStart &&
        t < (this._win?.end ?? this.windowEnd) - 1
      )
        return;
      this._openWindow(t, { play: !vid.paused });
    },
    // None: toggle "checked, no intro" so needsIntro stays false with no
    // trim/skip configured.
    clickIntroNone() {
      this.introNone = !this.introNone;
      this._persistField("none", this.introNone ? true : null);
    },
    _persistField(field, value) {
      if (!this.introShow?.name) return;
      const season = this.introSeason;
      if (season == null) return;
      // Update local reactive state for immediate UI feedback
      if (!this.introShow.seasonIntros) this.introShow.seasonIntros = {};
      if (!this.introShow.seasonIntros[season])
        this.introShow.seasonIntros[season] = {};
      this.introShow.seasonIntros[season][field] = value;
      if ((field === "trimPos" || field === "skipDur") && value != null) {
        this.introShow.needsIntro = false;
      }
      if (field === "none" && value === true) {
        this.introShow.needsIntro = false;
      }
      saveSeasonIntro(this.introShow.name, season, field, value).catch((e) =>
        unilog(1053, `saveSeasonIntro ${field} error:`, e),
      );
    },
    async clickIntroAnt() {
      if (!this.introShow?.name) return;
      const original = !!this.introShow.anticipating;
      this.introShow.anticipating = !original;
      try {
        await setTvdbFields({
          name: this.introShow.name,
          anticipating: this.introShow.anticipating,
        });
      } catch (e) {
        unilog(1054, "clickIntroAnt error:", e);
        this.introShow.anticipating = original;
      }
    },
    clickIntroSel() {
      const name = this.introShow?.name;
      this._mseStop();
      this.vidSrc = "";
      const vid = this.$refs.vid;
      if (vid) {
        vid.pause();
        vid.src = "";
      }
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      this.$emit("intro-sel", name);
    },
    async clickChksrtAnt() {
      const show = this.chksrtShowObj;
      if (!show?.name) return;
      const original = !!show.anticipating;
      show.anticipating = !original;
      try {
        await setTvdbFields({
          name: show.name,
          anticipating: show.anticipating,
        });
      } catch (e) {
        unilog(1055, `clickChksrtAnt error for ${show.name}:`, e);
        show.anticipating = original;
      }
    },
    _exitWaitingForVideo() {
      this.waitingForVideo = false;
      this.waitingForVideoTarget = null;
    },
    _enterWaitingForVideo(targetSec) {
      const vid = this.$refs.vid;
      if (!vid) return;
      this.waitingForVideo = true;
      this.waitingForVideoTarget = targetSec;
      this._waitingForVideoSetup = true;
      vid.pause();
      vid.currentTime = Math.max(0, vid.currentTime - 10);
      setTimeout(() => {
        this._waitingForVideoSetup = false;
      }, 600);
    },
    onVideoDurationChange() {
      if (!this.waitingForVideo || this.waitingForVideoTarget == null) return;
      const vid = this.$refs.vid;
      if (!vid || !Number.isFinite(vid.duration)) return;
      if (vid.duration >= this.waitingForVideoTarget) {
        const target = this.waitingForVideoTarget;
        this._exitWaitingForVideo();
        this._seekWithConfirm(target);
        vid.play().catch(() => {});
      }
    },
    onVideoSeeked() {
      if (this.waitingForVideo && !this._waitingForVideoSetup) {
        this._exitWaitingForVideo();
      }
      if (this.windowed && this.pictureMs === null && this._windowClickAt) {
        this.pictureMs = performance.now() - this._windowClickAt;
      }
    },
    onVideoPlay() {
      if (this.waitingForVideo) {
        this._exitWaitingForVideo();
      }
    },
    onVideoPause() {
      if (this.waitingForVideo && !this._waitingForVideoSetup) {
        this._exitWaitingForVideo();
      }
    },
    fmtTime(ms) {
      return fmtTime(ms);
    },
    async applySliderOffset() {
      const track = this.activeTrack;
      if (!track || track.type !== "srt" || this.subtitleOffset === 0) return;
      const offsetMs = Math.round(this.subtitleOffset * 1000);
      try {
        await applySubOffset({
          videoPath: this.path,
          srtFile: track.file,
          offsetMs,
        });
        offsetCache.set(this.path, 0);
        this.subtitleOffset = 0;
      } catch (e) {
        unilog(1056, "", e);
      }
    },
    async clickOk() {
      try {
        await chksrtOk(this.path);
        this.$emit("chksrt-next", null);
      } catch (e) {
        unilog(1057, "clickOk error:", e);
      }
    },
    async clickGenSrt() {
      const embedded = this.subtitleTracks.filter(
        (t) => t.type === "embedded" || t.type === "forced" || t.type === "pgs",
      );
      const currentIdx = embedded.findIndex((t) => t.id === this.activeTrackId);
      if (currentIdx >= 0 && currentIdx < embedded.length - 1) {
        this.selectTrack(embedded[currentIdx + 1].id);
      } else {
        try {
          await chksrtGenSrt(this.path);
          this.$emit("chksrt-next", null);
        } catch (e) {
          unilog(1058, "clickGenSrt error:", e);
        }
      }
    },
    onChoiceClick(choice, event) {
      if (this.mode === "chksrt") {
        const choiceLabel =
          this.subtitleLabelMap.get(choice.id) ?? choice.label;
        if (choice.type === "srt" && choice.file) {
          const dir = this.path.replace(/\/[^\/]+$/, "");
          this._chksrtSelectedSrtPath = dir + "/" + choice.file;
          this._chksrtSelectedChoice = { choiceLabel, choice };
          this.selectTrack(choice.id);
        } else if (
          choice.type === "embedded" ||
          choice.type === "sdh" ||
          choice.type === "forced" ||
          choice.type === "pgs"
        ) {
          this._chksrtSelectedSrtPath = null;
          this._chksrtSelectedChoice = { choiceLabel, choice };
          this.selectTrack(choice.id);
        } else {
          this.selectTrack(choice.id);
        }
      } else {
        this.selectTrack(choice.id);
      }
    },
    async _submitChksrtSelection() {
      const sel = this._chksrtSelectedChoice;
      if (sel) {
        this._saveChksrtHistory(sel.choiceLabel, sel.choice);
        await chksrtSelect(this.path, this._chksrtSelectedSrtPath);
      } else if (this.activeTrack && this.activeTrackId !== "off") {
        // Save the currently active track even if no button was clicked
        const track = this.activeTrack;
        const choiceLabel = this.subtitleLabelMap.get(track.id) ?? track.label;
        let srtPath = null;
        if (track.type === "srt" && track.file) {
          const dir = this.path.replace(/\/[^\/]+$/, "");
          srtPath = dir + "/" + track.file;
        }
        this._saveChksrtHistory(choiceLabel, track);
        await chksrtSelect(this.path, srtPath);
      } else {
        await chksrtOk(this.path);
      }
    },
    async clickChksrtNext() {
      try {
        await chksrtUnsnooze(this.path);
      } catch (e) {
        unilog(1476, "unsnooze error:", e);
      }
      try {
        await this._submitChksrtSelection();
      } catch (e) {
        unilog(1059, "next error:", e);
      }
      this.$emit("chksrt-next", null);
    },
    async clickChksrtAllOff() {
      const showName = this.chksrtShowName;
      if (!showName) return;
      if (
        !window.confirm(
          `Leave subtitles as they are for all queued episodes of ${showName}?`,
        )
      )
        return;
      try {
        await chksrtOkShow(showName);
      } catch (e) {
        unilog(1970, `chksrt all off failed for ${showName}: ${e.message}`);
        return;
      }
      this.$emit("chksrt-next", null);
    },
    async clickChksrtSnooze() {
      try {
        await chksrtSnooze(this.path);
      } catch (e) {
        unilog(1060, "snooze error:", e);
        return;
      }
      this.$emit("chksrt-next", null);
    },
    clickSel() {
      this._mseStop();
      this.vidSrc = "";
      const vid = this.$refs.vid;
      if (vid) {
        vid.pause();
        vid.src = "";
      }
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      this.$emit("chksrt-sel", this.path);
    },
    close() {
      this._mseStop();
      this._stopStillsPoll();
      this._clearFirstCueSeek();
      const vid = this.$refs.vid;
      if (vid) {
        vid.pause();
        vid.src = "";
      }
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      this.$emit("close");
    },
    toggleFullscreen() {
      const vid = this.$refs.vid;
      if (!vid) return;
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        vid.requestFullscreen().catch(() => {});
      }
    },
    onKeyDown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    },
  },
  mounted() {
    window.addEventListener("keydown", this.onKeyDown);
    const savedMuted = window.localStorage.getItem(PLAYER_MUTE_STORAGE_KEY);
    const savedVolume = window.localStorage.getItem(PLAYER_VOLUME_STORAGE_KEY);
    this.playerMuted = savedMuted === "1";
    if (savedVolume != null) {
      const n = Number(savedVolume);
      if (Number.isFinite(n)) this.playerVolume = Math.max(0, Math.min(1, n));
    }
    this.vidSrc = this.path ? this._buildStreamUrl() : "";
    this.subtitleOffset = offsetCache.get(this.path) ?? 0;
    this.chksrtFirstCueSec = null;
    if (this.path) {
      this._fetchSubtitleList(this.path);
      this._fetchAudioList(this.path);
    }
    this.$nextTick(() => {
      this._applyIntroAudioState();
    });
  },
  beforeUnmount() {
    window.removeEventListener("keydown", this.onKeyDown);
    this._clearFirstCueSeek();
  },
};
</script>
