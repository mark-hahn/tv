
db = require '../server/db'

showId = '1451431088325284033542266122'

db.view 'episodeByShowId', {key: showId} , (res, data) ->
  console.log 'Showing', data.rows.length, 'episodes.'
  console.log ''
  
  for row in data.rows
    console.log row.value
    console.log ''
