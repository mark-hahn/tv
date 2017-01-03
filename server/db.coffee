
log = require('./utils') '  db'

fs   = require 'fs'
util = require 'util'
db   = require('nano') 'http://localhost:5984/tv'
cfg  = require('parent-config') 'apps-config.json'

{CHROOT, USER, HOME_IP, AT_HOME, SERVER_IP, SERVER_HOST, DEBUG, LOCATION, OFF_SITE} = process.env

inDev = (process.cwd().indexOf('/dev/') > -1)
tvShowsCache = (if SERVER_HOST is 'localhost' then 'tvShowsCache' else '/tmp/tvShowsCache')

tvShowsKey = null

tagList = [
  'Foreign', 'Comedy', 'Drama', 'MarkOnly', 'MarkFavs', 'LindaOnly'
  'LindaFavs', 'Kids', 'OnTheFence', 'Archive', 'Deleted', 'New', 'LessThan3', 'Watched'
]

exports.getShowList = (cb) ->
  cb null,
    try
      JSON.parse fs.readFileSync tvShowsCache, 'utf8'
    catch e
      []

exports.setField = (id, key, val, cb) ->
  if typeof val isnt 'boolean' and val isnt '' and not isNaN val then val = +val;
  exports.get id, (err, doc) ->
    if err then log 'setField get err: ' + err.message, {id, key, val}; cb? err; return
    if not doc then log 'setField doc missing: ', {id, key, val}; cb? 'doc missing'; return
    obj = doc
    for attr in key.split '.'
      if typeof obj[attr] is 'object' then obj = obj[attr]
      else obj[attr] = val
    log 'setField', {id, key, val, obj}
    exports.put doc, (err) ->
      if err then log 'setField put err: ' + err.message, {key, val}; cb? err; return
      # exports.syncPlexDB()
      cb? null, doc

exports.view = (viewName, opts, cb) ->
  db.view 'all', viewName, opts, cb

exports.get = (key, cb) ->
  db.get key, (err, doc) ->
    if err
      if err?.error is 'not_found'
        cb()
        return
      log 'db get err:', err
      cb err
      return
    cb null, doc

exports.put = (doc, cb) ->
  db.get doc._id, (err, readVal) ->
    if readVal?._rev then doc._rev = readVal._rev
    db.insert doc, (err) ->
      if err?.statusCode is 409
        exports.put doc, cb
        return
      if err then log 'db put err:', err; cb err; return
      cb()

exports.delete = (doc, cb) ->
  db.destroy doc._id, doc._rev, (err) ->
    if err?.statusCode is 409 or not doc._rev
      db.get id, (err, doc) ->
        if err
          log 'db.delete get err:', err
          cb err
          return
        exports.delete doc, cb
      return
    if err then log 'delete err', err.message
    cb?()
