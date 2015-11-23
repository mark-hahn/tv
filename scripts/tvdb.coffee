
TVDB = require 'node-tvdb/compat'
tvdb = new TVDB '2C92771D87CA8718"'

tvdb.getSeriesByName "Battle Creek", (err, response) ->
  console.log {err, response}



# TVDB
# acct id F6DF9C666C2A3259
# user id 444819
# api key 2C92771D87CA8718
