###
  src/insteon.coffee
###

request = require 'request'
log     = require('debug') 'tv:inst'

hubIp   = '192.168.1.103'
hubPort = 1342
lightIds = [
	'297EBF' # 1 tv Lft Front 
	'29802B' # 2 tv Mid Front 
	'298243' # 3 tv Rgt Front 
	'2982C1' # 4 tv Lft Rear  
	'298CDA' # 5 tv Mid Rear  
	'29814C' # 6 tv Rgt Rear  
]

exports.lightCmd = (light, cmd, args...) ->
	cb = null; argStr = ''
	for arg in args
		if arg is 'async' then async = yes; continue
		if typeof arg is 'function' then cb = arg; break
		argStr += '/' + arg
  opts =
    url: "http://#{hubIp}:#{hubPort}/light/#{cmd}/#{lightIds[light-1]}#{argStr}" + 
		     (if async then '?async=1' else '')
    headers: Accept: 'application/json'
  request opts, (err, resp, body) ->
    if err or resp.statusCode isnt 200
      log 'lightCmd error', opts, resp?.statusCode, err?.message
      cb? message: 'lightCmd error'
      return
    cb? null, JSON.parse body ? '{}'
	
i=-1
do one = ->
	exports.lightCmd 1, 'level', Math.round((++i)*25), -> if i < 4 then one()
	
	