
log = (args...) -> 
  console.log.apply console, ['maint:'].concat args

db = require '../server/db'

count = 0

db.view 'all', (res, data) ->
  log 'Processing', data.rows.length, 'docs.'
  do oneRow = ->
    if not (row = data.rows.shift())
      log 'Done'
      return
      
    if ++count % 100 is 0 then log count
    
    db.get row.id, (err, doc) ->
      if err then throw err
      chgd = no
      if doc.filePaths?
        for pathArr in doc.filePaths
          if pathArr[2][0..17] is '/mnt/media/videos/'
            pathArr[2] = pathArr[2].replace '/mnt/media/videos/', ''
            chgd = yes
      if chgd
        db.put doc, (err) ->
          if err then throw err
          oneRow()
      else
        oneRow()