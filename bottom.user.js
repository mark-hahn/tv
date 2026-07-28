// ==UserScript==
// @name         Scroll To Bottom
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Scroll torrent listing pages to the bottom on load
// @author       You
// @match        https://www.torrentleech.org/torrent*
// @match        https://iptorrents.com/torrent.php*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  function scrollToBottom() {
    window.scrollTo(0, document.body.scrollHeight);
  }

  scrollToBottom();
  window.addEventListener("load", scrollToBottom);
})();
