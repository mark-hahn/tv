
log = require('../server/utils') 'dbup'
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
      
    #   
    #   if doc.type is 'episode' and doc.showId is '1450222381338798910984769520'
    #     db.delete doc, oneRow
    #     return
    #   
    
      if doc.filePaths?
        newPathArrays = []
        for pathArr in doc.filePaths
          if pathArr[2][0..17] is '/mnt/media/videos/'
            pathArr[2] = pathArr[2].replace '/mnt/media/videos/', ''
            chgd = yes
          isCopy = no
          for newPathArray in newPathArrays
            if pathArr[2] is newPathArray[2]
              isCopy = yes
              break
          if isCopy
            chgd = yes
            continue
          newPathArrays.push pathArr
        doc.filePaths = newPathArrays
    
      if chgd
        db.put doc, (err) ->
          if err then throw err
          oneRow()
      else
        oneRow()
          
          