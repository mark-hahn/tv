'use strict';

var normalizeBasic = function (s) {
	return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
};

var normalizeAggressive = function (s) {
	s = String(s || '');
	var idx = s.indexOf('(');
	if (idx >= 0) {
		s = s.slice(0, idx);
	}
	s = s.toLowerCase();
	s = s.replace(/\./g, ' ');
	s = s.replace(/[^a-z0-9\s]/g, ' ');
	s = s.trim().replace(/\s+/g, ' ');
	return s;
};

var coerceCandidateTitle = function (x) {
	if (typeof x === 'string') return x;
	if (x && typeof x === 'object') {
		if (typeof x.name === 'string') return x.name;
		if (typeof x.title === 'string') return x.title;
	}
	return null;
};

// smartTitleMatch(title, titleArray) => chosenName
// Strategy:
// 1) exact basic-normalized match
// 2) exact aggressive-normalized match
// 3) fallback to first non-empty candidate
var smartTitleMatch = function (title, titleArray) {
	if (!Array.isArray(titleArray) || titleArray.length === 0) {
		return null;
	}

	var wantBasic = normalizeBasic(title);
	for (var i = 0; i < titleArray.length; i++) {
		var cand = coerceCandidateTitle(titleArray[i]);
		if (!cand) continue;
		if (normalizeBasic(cand) === wantBasic) {
			return cand;
		}
	}

	var wantAgg = normalizeAggressive(title);
	for (var j = 0; j < titleArray.length; j++) {
		var cand2 = coerceCandidateTitle(titleArray[j]);
		if (!cand2) continue;
		if (normalizeAggressive(cand2) === wantAgg) {
			return cand2;
		}
	}

	for (var k = 0; k < titleArray.length; k++) {
		var cand3 = coerceCandidateTitle(titleArray[k]);
		if (cand3) return cand3;
	}
	return null;
};

module.exports = {
	smartTitleMatch: smartTitleMatch,
	normalizeBasic: normalizeBasic,
	normalizeAggressive: normalizeAggressive
};
