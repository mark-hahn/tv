// ==UserScript==
// @name         USB CP Auto-Login
// @namespace    https://hahnca.com/
// @version      1.0
// @description  Auto-login to cp.ultra.cc when a tok= param is present in the URL
// @author       hahnca
// @match        https://cp.ultra.cc/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const tok = params.get("tok");
  if (!tok) return;

  // Set the token cookie on this domain so the AngularJS app finds it
  const expires = new Date(
    Date.now() + 365 * 24 * 60 * 60 * 1000,
  ).toUTCString();
  document.cookie = `token=${encodeURIComponent(tok)}; expires=${expires}; path=/; SameSite=Lax`;

  // Remove the tok param from the URL without reloading
  params.delete("tok");
  const newSearch = params.toString();
  const newUrl =
    window.location.pathname +
    (newSearch ? "?" + newSearch : "") +
    window.location.hash;
  window.history.replaceState(null, "", newUrl);
})();
