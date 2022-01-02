/**
 *  Modify language preference by actual search results.
 *
 *  Explanation: Pelias is not a translation service. If the user searches for a
 *  Swedish version of a name in Finland, return swedish even if she has forgotten
 *  (or not realized to change) the language parameter in the client app. Language
 *  parameter is just a faint hint of preferences - the actual search string
 *  truly shows what is wanted.
 *
 *  Language selection priority:
 *
 *  1. Best match
 *  2. Api 'lang' parameter or 'default' if not given
 *  3. Peliasconfig 'languages' list order
 */

var fuzzy = require('../helper/fuzzyMatch');
var _ = require('lodash');
var logger = require('pelias-logger').get('api');
var removeNumbers = require('../helper/stringUtils').removeNumbers;
var languages = ['default'];
var languageMap = {};
var languageMatchThreshold = 0.9;

function setup(peliasConfig) {
  peliasConfig = peliasConfig || require('pelias-config').generate().api;

  if(peliasConfig) {
    languages = peliasConfig.languages || languages;
    languageMap = peliasConfig.languageMap || languageMap;
    languageMatchThreshold = peliasConfig.languageMatchThreshold || languageMatchThreshold;
  }
  return matchLanguage;
}


function matchName(text, name, i) { // compute matching score
  var name2 = removeNumbers(name);
  return {
    value: fuzzy.match(text, name2),
    index: i
  };
}

function matchNames(text, names) { // compute matching score
  if (names instanceof Array) {
    var bestScore = matchName(text, names[0], 0);
    for(var i = 1; i < names.length; i++) {
      var newScore = matchName(text, names[i], i);
      if (newScore.value > bestScore.value) {
        bestScore = newScore;
      }
    }
    return bestScore;
  } else {
    return matchName(text, names, 0);
  }
}


function matchLanguage(req, res, next) {

  // do nothing if no result data set
  if (!res || !res.data || !res.data[0]) {
    return next();
  }

  if (!req.clean || !req.clean.text) {
    return next();   // nothing to match
  }

  var currentLang = req.clean.lang; // default preference

  var name; // searched name
  if (req.clean.parsed_text) {
    if(req.clean.parsed_text.name) {
      name = req.clean.parsed_text.name;
    } else {
      name = req.clean.parsed_text.street;
    }
  }
  if(!name) {
    name = req.clean.text;
  }

  // fix street/number order problem by stripping the number part
  name = removeNumbers(name);

  var bestLang, bestScore;

  var matchDoc =  function(doc) {
    var names = doc.name;
    var _bestLang;
    var _bestScore = {
      value: -1,
      index: 0
    };

    var updateLocalBest = function(lang, score) {
      _bestScore = score;
      _bestLang = lang;
    };

    for(var lang in names) {
      if(languages.indexOf(lang)===-1) {
        continue; // accept only configured languages
      }
      var score = matchNames(name, names[lang]);
      if (score.value > _bestScore.value ) {
        updateLocalBest(lang, score);
      }
      else if (score.value === _bestScore.value && _bestLang !== currentLang) {
        // explicit lang parameter has 2nd highest priority
        if (lang === currentLang) {
          updateLocalBest(lang, score);
        }
        else {
          // judge by configured language list priority
          var i1 = languages.indexOf(lang);
          var i2 = languages.indexOf(_bestLang);
          if (i1 !== -1 && (i2 === -1 ||  i1 < i2)) {
            updateLocalBest(lang, score);
          }
        }
      }
    }
    if (_bestLang) {
      doc.altName = names[_bestLang];
      if(doc.altName instanceof Array) {
        doc.altName = doc.altName[_bestScore.index];
      }

      if(!bestLang) {
        // take global best from 1st doc which has best conf. scores
        bestScore = _bestScore;
        bestLang = _bestLang;
      }
    }
  };

  // process all docs to find best matching alt name
  _.forEach(res.data, matchDoc);

  // change lang if best hit is good enough
  if (bestLang && bestScore.value > languageMatchThreshold) {
    if (languageMap[bestLang]) {
      bestLang = languageMap[bestLang]; // map fake languages such as 'local' to real language
    }
    req.clean.lang = bestLang;
  }
  next();
}

module.exports = setup;
