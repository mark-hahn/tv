
log = require('../server/utils') 'prune'
db = require '../server/db'
fs = require 'fs-plus'

count = 0
videosPath = '/mnt/media/videos/'

db.view 'allShows', (res, showData) ->
  log {res, showData}
  log 'Processing', showData.rows.length, 'shows.'

  do oneShowRow = ->
    if not (showRow = showData.rows.shift())
      log 'Done'
      return

    if ++count % 100 is 0 then log count

    db.get showRow.id, (err, showDoc) ->
      if err then throw err

      if showDoc.tags.Deleted

        db.view 'episodeByShowId', {key: showDoc._id},  (res, epiData) ->
          log "deleting", epiData.rows.length, "episodes of \"#{showDoc.tvdbTitle}\"."

          do oneEpiRow = ->
            if not (epiRow = epiData.rows.shift())
              log "deleting show \"#{showDoc.imdbTitle ? showDoc.summary}\" from db"
              db.delete showDoc
              setImmediate oneShowRow
              return

            db.get epiRow.id, (err, epiDoc) ->
              for filePath in epiDoc.filePaths
                log "deleting file #{videosPath+filePath[2]}"
                fs.removeSync videosPath+filePath[2]

              log "deleting episode \"#{epiDoc.episodeTitle}\" from db"
              db.delete epiDoc

              setImmediate oneEpiRow

      else
        setImmediate oneShowRow
