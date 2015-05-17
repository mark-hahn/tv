
fs         = require 'fs'
util       = require 'util'
request    = require 'request'
XmppClient = require 'node-xmpp-client'
log        = require('debug') 'tv:hmny'

# require('request-debug') request

host = '192.168.1.5'
port = 5222

fakeClientName = Date.now() + '/' + Math.floor(Math.random() * 1e6) + '#hahnTvApp.1.0#servr'
activityId = '9319436'

getToken = (cb) ->
  opts =
    url: 'https://svcs.myharmony.com/CompositeSecurityServices' +
                          '/Security.svc/json/GetUserAuthToken'
    method: 'POST'
    json: yes
    body:
      email:    'mark@hahnca.com'
      password: 'OIUnbvyui987'
      
  request opts, (err, resp, body) ->
    if err or resp.statusCode isnt 200
      log '\n\nreq ERROR:', opts, resp.statusCode, err.message, '\n'
      cb? err
      return
    token = body.GetUserAuthTokenResult.UserAuthToken
    cb? null, token
  
online   = no
identity = xml = timeout = client = transCallback = null
transactionCount = 0
startTime = Date.now()
  
transaction = (opts, transCallbackIn) ->
  transCallback = transCallbackIn
  
  if not opts.presence
    {from, mime, mime1, mime2, mimeCmd, cdata} = opts
    from     ?= identity
    mime1    ?= 'harmony'
    mime2    ?= 'harmony.engine?' + mimeCmd
    mime     ?= "vnd.logitech.#{mime1}/vnd.logitech.#{mime2}"
    
    log '\n\n----- transaction request -----\n', {from, mime, cdata}, '\n'
    
    clientJid = fakeClientName + '-' + (++transactionCount)
    xml = """
      <iq type="get" id="#{clientJid}" from="#{from}">
        <oa xmlns="connect.logitech.com" mime="#{mime}"> 
        #{if cdata then '  ' + cdata + '\n  ' else ''}</oa>
      </iq>
    """
    
    timeout = setTimeout ->
      log '\n\nERROR, transaction timeout:\n' + xml + '\n'
      oldCB = transCallback
      transCallback = null
      oldCB? 'transaction timeout'
    , 5000
    
    if client then client.send xml; return
    
  log 'new client'
  client = new XmppClient {
    jid:       'guest@connect.logitech.com/gatorade.'
    password:  'gatorade.'
    preferred: 'PLAIN'
    host, port
  }
  
  client.on 'online', -> 
    log 'transaction online'
    if not online then client.send xml
    online = yes
    
  client.on 'error', (e) -> 
    clearTimeout timeout
    log '\n\ntransaction ERROR:', e.message, '\n' + xml + '\n'
    return e.message
    
  client.on 'stanza', (stanza) ->
    if (child = stanza.children?[0])?.name is 'oa'
      clearTimeout timeout
      if (errCode = (child?.attrs?.errorcode isnt '200')) or 
          +stanza.attrs.id.split('-')[-1..-1][0] isnt transactionCount
        log '\n\nERROR',
           (if errCode then ': ' + child?.attrs?.errorstring \
            else (', bad sequence id:\n' + stanza.attrs.id + '\n' + transactionCount)), 
           '\n\n' + xml + '\n'
        transCallback? 'stanza oa error'
        return
      results = {}
      for res in child.children[0].split ':'
        [key,val] = res.split '='
        results[key] = val
      log 'transaction count/req/res:', transactionCount, 
          '\n' + xml, '\n' + util.inspect results, depth: 2
      transCallback? null, results, stanza
    # else
      # log 'non-OA stanza ignored:\n', util.inspect stanza, depth: null
      
  client.on 'offline',    -> log 'transaction offline'
  client.on 'connect',    -> log 'transaction connect'
  client.on 'reconnect',  -> log 'transaction reconnect'
  client.on 'disconnect', -> log 'transaction disconnect'
  client.on 'exit',       -> log 'transaction exit'

  if opts.presence
    xml = """
      <presence id="pI80G-2">
      </presence>
    """
    client.send xml
    return
  
newClient = ->
  client.end()
  client = null
  online = no
  
getIdentity = (token, cb) ->
  opts = 
    from:     'guest'
    mime1:    'connect'
    mime2:    'pair'
    cdata:    "token=#{token}:name=#{fakeClientName}"
  transaction opts, (err, results) ->
    if err or results.status isnt 'succeeded'
      log '\n\ngetIdentity ERROR:', (if err then err else results) + '\n'
      return 'getIdentity error'
    identity = results.identity
    cb? null, identity
    
doPair = (cb) ->
  opts = 
    mime1:    'connect'
    mime2:    'pair'
    cdata:    "method=pair:name=#{fakeClientName}"
  transaction opts, cb
    
getConfig = (cb) ->
  opts =  mimeCmd: 'config'
  transaction opts, (err, results, stanza) -> cb? err, stanza
  
###
    IQ [id="88413ad726cb858#hltetmo#sm-n900t-28-3" type="get" from="886b47d6-b376-4c00-0dd0-7cf8f473c0f0"]
        id: 88413ad726cb858#hltetmo#sm-n900t-28-3
        type: get
        from: 886b47d6-b376-4c00-0dd0-7cf8f473c0f0
        OA [mime="connect.statedigest?get" xmlns="connect.logitech.com"]
            mime: connect.statedigest?get
            xmlns: connect.logitech.com
            CDATA: format=json
###

sendPresence = -> transaction presence:yes
  
setJson = (cb) ->
  opts=
    mime:  'connect.statedigest?get'
    cdata: 'format=json'
  transaction opts, cb
  
###
    IQ [id="88413ad726cb858#hltetmo#sm-n900t-28-4" type="get" from="886b47d6-b376-4c00-0dd0-7cf8f473c0f0"]
        id: 88413ad726cb858#hltetmo#sm-n900t-28-4
        type: get
        from: 886b47d6-b376-4c00-0dd0-7cf8f473c0f0
        OA [mime="vnd.logitech.connect/vnd.logitech.deviceinfo?get" xmlns="connect.logitech.com"]
            mime: vnd.logitech.connect/vnd.logitech.deviceinfo?get
            xmlns: connect.logitech.com
###

getDeviceInfo = (cb) ->
  opts=
    mime1: 'connect'
    mime2: 'deviceinfo?get'
  transaction opts, cb
  
###
    IQ [id="88413ad726cb858#hltetmo#sm-n900t-28-6" type="get" from="886b47d6-b376-4c00-0dd0-7cf8f473c0f0"]
        id: 88413ad726cb858#hltetmo#sm-n900t-28-6
        type: get
        from: 886b47d6-b376-4c00-0dd0-7cf8f473c0f0
        OA [mime="harmony.engine?startactivity" xmlns="connect.logitech.com"]
            mime: harmony.engine?startactivity
            xmlns: connect.logitech.com
            CDATA: activityId=9319436:timestamp=3177
###

startActivity = (cb) ->
  opts=
    mime: 'harmony.engine?startactivity'
    cdata: 'activityId=' + activityId + ':timestamp=' + (Date.now() - startTime)
  transaction opts, cb
  
irCommand = (device, key, cb) ->
  opts = 
    mimeCmd: 'holdAction'
    cdata:   "action={\"command\"::\"#{key}\",\"type\"::\"IRCommand\",\"deviceId\"::\"#{device}\"}" +
             ':status=press:timestamp=' + (Date.now() - startTime)
  transaction opts, cb

getToken (err, token) ->
  if err then log 'getToken call err', err; return
  
  sendPresence()
    
  getIdentity token, (err) ->
    if err then log 'getIdentity call err', err; return
    
    doPair (err) ->
      if err then log 'doPair call err', err; return
      
      # getConfig (err, stanza) ->
      #   if err then log 'getConfig call err', err; return
        # jsonTxt = JSON.stringify stanza.children[0].children
        # todo: convert to legal json
        # fs.writeFileSync 'harmony-config.json', jsonTxt
        
      newClient()
        
      setJson (err) ->
        if err then log 'setJson call err', err; return
        
        getDeviceInfo (err) ->
          if err then log 'getDeviceInfo call err', err; return
          
          startActivity (err) ->
            if err then log 'startActivity call err', err; return
          
            irCommand '19685842', 'Muting', (err) ->
              if err then log 'irCommand call err', err; return
      