
util = require 'util'
updt = require '../server/db-update'
tvdb = require '../server/tvdb'

guess = updt.guessit process.argv[2]
console.log 'guess:\n', util.inspect guess, depth:null

if guess[0]
  title = guess[0].title
  console.log 'title:', title

  if title
    
    tvdb.getSeriesIdByName title, (err, res, fuzzRes) ->
      
      if fuzzRes 
        console.log 'fuzzRes:\n', util.inspect fuzzRes, depth:null
      
      tvdb.getShowByName title, (err, res) ->
        console.log 'tvdb:\n', util.inspect res, depth:null

