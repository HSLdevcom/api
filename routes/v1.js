var express = require('express');
var Router = require('express').Router;
var reverseQuery = require('../query/reverse');

/** ----------------------- sanitisers ----------------------- **/
var sanitisers = {
  autocomplete: require('../sanitiser/autocomplete'),
  place: require('../sanitiser/place'),
  search: require('../sanitiser/search'),
  search_fallback: require('../sanitiser/search_fallback'),
  reverse: require('../sanitiser/reverse'),
  nearby: require('../sanitiser/nearby')
};

/** ----------------------- middleware ------------------------ **/
var middleware = {
  calcSize: require('../middleware/sizeCalculator'),
  selectLanguage: require('../middleware/languageSelector')
};

/** ----------------------- controllers ----------------------- **/

var controllers = {
  mdToHTML: require('../controller/markdownToHtml'),
  place: require('../controller/place'),
  search: require('../controller/search'),
  status: require('../controller/status')
};

var queries = {
  libpostal: require('../query/search'),
  fallback_to_old_prod: require('../query/search_original')
};

/** ----------------------- controllers ----------------------- **/

var postProc = {
  matchLanguage: require('../middleware/matchLanguage'),
  trimByGranularity: require('../middleware/trimByGranularity'),
  distances: require('../middleware/distance'),
  confidenceScores: require('../middleware/confidenceScoreDT'),
  confidenceScoresFallback: require('../middleware/confidenceScoreFallback'),
  confidenceScoresReverse: require('../middleware/confidenceScoreReverse'),
  accuracy: require('../middleware/accuracy'),
  dedupe: require('../middleware/dedupe'),
  localNamingConventions: require('../middleware/localNamingConventions'),
  translate: require('../middleware/translate'),
  label: require('../middleware/label'),
  renamePlacenames: require('../middleware/renamePlacenames'),
  geocodeJSON: require('../middleware/geocodeJSON'),
  sendJSON: require('../middleware/sendJSON'),
  parseBoundingBox: require('../middleware/parseBBox'),
  normalizeParentIds: require('../middleware/normalizeParentIds')
};

/**
 * Append routes to app
 *
 * @param {object} app
 * @param {object} peliasConfig
 */
function addRoutes(app, peliasConfig) {

  var base = '/v1/';

  /** ------------------------- routers ------------------------- **/

  var routers = {
    index: createRouter([
      controllers.mdToHTML(peliasConfig, './public/apiDoc.md')
    ]),
    attribution: createRouter([
      controllers.mdToHTML(peliasConfig, './public/attribution.md')
    ]),
    search: createRouter([
      sanitisers.search.middleware,
      middleware.calcSize(),
      middleware.selectLanguage(peliasConfig),
      // 2nd parameter is `backend` which gets initialized internally
      // 3rd parameter is which query module to use, use fallback/geodisambiguation
      //  first, then use original search strategy if first query didn't return anything
      controllers.search(peliasConfig, undefined, queries.libpostal),
      sanitisers.search_fallback.middleware,
      controllers.search(peliasConfig, undefined, queries.fallback_to_old_prod),
      postProc.trimByGranularity(),
      postProc.distances('focus.point.'),
      postProc.localNamingConventions(),
      postProc.confidenceScores(peliasConfig),
      postProc.matchLanguage(peliasConfig),
      postProc.dedupe(),
      postProc.accuracy(),
      postProc.translate(),
      postProc.renamePlacenames(),
      postProc.label(),
      postProc.parseBoundingBox(),
      postProc.normalizeParentIds(),
      postProc.geocodeJSON(peliasConfig, base),
      postProc.sendJSON
    ]),
    autocomplete: createRouter([
      sanitisers.autocomplete.middleware,
      middleware.selectLanguage(peliasConfig),
      controllers.search(peliasConfig, null, require('../query/autocomplete')),
      postProc.distances('focus.point.'),
      postProc.localNamingConventions(),
      postProc.confidenceScores(peliasConfig),
      postProc.matchLanguage(peliasConfig),
      postProc.dedupe(),
      postProc.accuracy(),
      postProc.translate(),
      postProc.renamePlacenames(),
      postProc.label(),
      postProc.parseBoundingBox(),
      postProc.normalizeParentIds(),
      postProc.geocodeJSON(peliasConfig, base),
      postProc.sendJSON
    ]),
    reverse: createRouter([
      sanitisers.reverse.middleware,
      middleware.calcSize(),
      middleware.selectLanguage(peliasConfig),
      controllers.search(peliasConfig, undefined, reverseQuery),
      postProc.distances('point.'),
      // reverse confidence scoring depends on distance from origin
      //  so it must be calculated first
      postProc.confidenceScoresReverse(),
      postProc.dedupe(),
      postProc.accuracy(),
      postProc.localNamingConventions(),
      postProc.translate(),
      postProc.renamePlacenames(),
      postProc.label(),
      postProc.parseBoundingBox(),
      postProc.normalizeParentIds(),
      postProc.geocodeJSON(peliasConfig, base),
      postProc.sendJSON
    ]),
    nearby: createRouter([
      sanitisers.nearby.middleware,
      middleware.calcSize(),
      controllers.search(peliasConfig, undefined, reverseQuery),
      postProc.distances('point.'),
      // reverse confidence scoring depends on distance from origin
      //  so it must be calculated first
      postProc.confidenceScoresReverse(),
      postProc.accuracy(),
      postProc.localNamingConventions(),
      postProc.dedupe(),
      postProc.translate(),
      postProc.renamePlacenames(),
      postProc.label(),
      postProc.parseBoundingBox(),
      postProc.normalizeParentIds(),
      postProc.geocodeJSON(peliasConfig, base),
      postProc.sendJSON
    ]),
    place: createRouter([
      sanitisers.place.middleware,
      middleware.selectLanguage(peliasConfig),
      controllers.place(peliasConfig),
      postProc.accuracy(),
      postProc.localNamingConventions(),
      postProc.translate(),
      postProc.renamePlacenames(),
      postProc.label(),
      postProc.parseBoundingBox(),
      postProc.normalizeParentIds(),
      postProc.geocodeJSON(peliasConfig, base),
      postProc.sendJSON
    ]),
    status: createRouter([
      controllers.status
    ])
  };


  // static data endpoints
  app.get ( base,                  routers.index );
  app.get ( base + 'attribution',  routers.attribution );
  app.get (        '/attribution', routers.attribution );
  app.get (        '/status',      routers.status );

  // backend dependent endpoints
  app.get ( base + 'place',        routers.place );
  app.get ( base + 'autocomplete', routers.autocomplete );
  app.get ( base + 'search',       routers.search );
  app.post( base + 'search',       routers.search );
  app.get ( base + 'reverse',      routers.reverse );
  app.get ( base + 'nearby',       routers.nearby );

}

/**
 * Helper function for creating routers
 *
 * @param {[{function}]} functions
 * @returns {express.Router}
 */
function createRouter(functions) {
  var router = Router(); // jshint ignore:line
  functions.forEach(function (f) {
    router.use(f);
  });
  return router;
}


module.exports.addRoutes = addRoutes;
