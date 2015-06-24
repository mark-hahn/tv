###
  src/insteon.coffee
###

request = require 'request'
log     = require('debug') 'tv:inst'

# hubIp   = '192.168.1.103
hubIp    = 'hahnca.com'

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
		       (if async then '?async=1&cancel=1' else '?cancel=1')
		headers: Accept: 'application/json'
	# log 'insteon hub req: ' + opts.url
	request opts, (err, resp, body) ->
		if err or resp.statusCode isnt 200
      log 'lightCmd error', opts, resp?.statusCode, err?.message
      cb? message: 'lightCmd error'
      return
    cb? null, JSON.parse body ? '{}'
	
exports.getLightLevels = (cb) ->
	i = 0; allLevels = []
	do one = ->
		exports.lightCmd ++i, 'level', 'async', (err, resp) -> 
			if err then log 'getLightLevels error', err; cb err; return
			allLevels.push resp
			# log 'light', i + ' is set to ', resp
			if i is 6 then cb null, allLevels
			else one()

# exports.getLightLevels (err, levels) -> 
# 	log 'levels', levels
exports.lightCmd 1, 'turnOn', 100, 5000
		# exports.getLightLevels (err, levels) -> 
			# log 'levels', levels

