
util       = require 'util'
request    = require 'request'
XmppClient = require 'node-xmpp-client'
log        = require('debug') 'tv:hmny'

# require('request-debug') request

identity       = null
fakeClientName = '1vm7ATw/tN6HXGpQcCs/A5MkuvI#iOS6.0.1#iPhone'

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
      log 'req error:', opts, resp.statusCode, err.message
      cb? err
      return
    token = body.GetUserAuthTokenResult.UserAuthToken
    cb? null, token

getClient = (jid, password) ->
  new XmppClient {
    jid, password
    host: '192.168.1.5'
    port: 5222
    preferred: 'PLAIN'
  }
  
transaction = (opts, cb) ->
  log 'trans req', opts

  {jid, password, from, mime, mime1, mime2, cdata} = opts
  jid      ?= identity + '@x.com/gatorade'
  password ?= identity
  from     ?= identity
  mime     ?= "vnd.logitech.#{mime1}/vnd.logitech.#{mime2}"
  cdata    ?= ''
  
  xmppClient = getClient jid, password
  
  xmppClient.on 'online', ->
    xmppClient.send """
      <iq type="get" id="#{jid}" from="#{from}">
        <oa xmlns="connect.logitech.com" mime="#{mime}">
            #{cdata}
        </oa>
      </iq>
    """
  xmppClient.on 'error',     (e) -> log 'trans err', e; throw new Error 'trans err'
  xmppClient.on 'offline',       -> log 'trans offline'
  xmppClient.on 'connect',   (e) -> log 'trans connect', e
  xmppClient.on 'reconnect', (e) -> log 'trans reconnect', e
  xmppClient.on 'disconnect',    -> log 'trans disconnect'
  xmppClient.on 'exit',      (e) -> log 'trans exit', e
  
  xmppClient.on 'stanza', (stanza) ->
    log 'trans stanza', util.inspect stanza, depth: null
    
    if (child = stanza.children?[0])?.name is 'oa'
      if child?.attrs?.errorcode isnt '200'
        log 'trans stanza oa error:', util.inspect stanza, depth: null
        throw new Error 'trans stanza oa error'
        
      results = {}
      for res in child.children[0].split ':'
        [key,val] = res.split '='
        results[key] = val
        
      log 'trans stanza results:', util.inspect results, depth: null
      
      xmppClient.end()
      cb? null, results

getIdentity = (token, cb) ->
  opts = 
    jid:      'guest@connect.logitech.com/gatorade'
    password: 'guest'
    from:     'guest'
    mime1:    'connect'
    mime2:    'pair'
    cdata:    "token=#{token}:name=#{fakeClientName}"
  transaction opts, (err, results) ->
    if results.status isnt 'succeeded'
      log 'getIdentity error:', results
      throw new Error 'getIdentity error'
    identity = results.identity
    cb? null
    
getConfig = (cb) ->
  opts = 
    mime1: 'harmony'
    mime2: 'harmony.engine?config'
  transaction opts, (err, results) ->
    log 'getConfig', util.inspect results, depth: 2
    cb? null

irCommand = (device, key, cb) ->
  opts = 
    jid:   fakeClientName
    from:  identity
    mime1: 'harmony'
    mime2: 'harmony.engine?holdAction'
    cdata: "action={\"command\"::\"#{key}\",\"type\"::\"IRCommand\",\"deviceId\"::\"#{device}\"}" +
           ':status=press:timestamp=42617'
  transaction opts, (err, results) ->
    log 'irCommand', util.inspect results, depth: 2
    cb? null

getToken (err, token) ->
  if err then log 'getToken call err', err; return
    
  getIdentity token, (err) ->
    if err then log 'getIdentity call err', err; return
    
    irCommand '19685842', 'Display', (err) ->
      if err then log 'irCommand call err', err; return
      
  
# 
# getToken (err, token) ->
#   if err then log 'getToken call err', err; return
#     
#   getIdentity token, 'guest@connect.logitech.com/gatorade', 'guest'
#   , (err, identity) ->
#     if err then log 'getIdentity call err', err; return
#   
#     # log 'identity', identity
#     
#     xmppClient = getClient identity + '@x.com/gatorade', identity
#     
#     xmppClient.on 'online', ->
#       
#       log 'online send 2'
        
    # <oa xmlns="connect.logitech.com" 
    #      mime="vnd.logitech.harmony/vnd.logitech.harmony.engine?config">
    # </oa>
    # CDATA: action={"command"::"Display","type"::"IRCommand","deviceId"::"19685842"}:status=press:timestamp=42617
    # 88413ad726cb858#hltetmo#sm-n900t-28-19
    
      # xmppClient.send """
      #   <iq type="get" id="88413ad726cb858#hltetmo#sm-n900t-28-2"  from="#{identity}">
      #     <oa xmlns="connect.logitech.com" 
      #          mime="vnd.logitech.harmony/vnd.logitech.harmony.engine?holdAction">
      #     action={"command"::"Display","type"::"IRCommand", "deviceId"::"19685842"}:status=press:timestamp=0
      #     </oa>
      #   </iq>
      # """
      
          # IQ [id="88413ad726cb858#hltetmo#sm-n900t-28-1" type="get" from="886b47d6-b376-4c00-0dd0-7cf8f473c0f0"]
          #     id: 88413ad726cb858#hltetmo#sm-n900t-28-1
          #     type: get
          #     from: 886b47d6-b376-4c00-0dd0-7cf8f473c0f0
          #     OA [mime="vnd.logitech.connect/vnd.logitech.pair" xmlns="connect.logitech.com"]
          #         mime: vnd.logitech.connect/vnd.logitech.pair
          #         xmlns: connect.logitech.com
          #         CDATA: method=pair:name=88413ad726cb858#hltetmo#sm-n900t

          # IQ [id="88413ad726cb858#hltetmo#sm-n900t-28-2" type="get" from="886b47d6-b376-4c00-0dd0-7cf8f473c0f0"]
          #     id: 88413ad726cb858#hltetmo#sm-n900t-28-2
          #     type: get
          #     from: 886b47d6-b376-4c00-0dd0-7cf8f473c0f0
          #     OA [mime="vnd.logitech.connect/vnd.logitech.pair" xmlns="connect.logitech.com"]
          #         mime: vnd.logitech.connect/vnd.logitech.pair
          #         xmlns: connect.logitech.com
          #         CDATA: method=pair:name=88413ad726cb858#hltetmo#sm-n900t

      # xmppClient.send """
      #   <iq type="get" id="3174962747#hltetmo#sm-n900t-28-1"  from="#{identity}">
      #     <oa xmlns="connect.logitech.com" 
      #          mime="vnd.logitech.connect/vnd.logitech.pair">
      #       method=pair:name=88413ad726cb858#hltetmo#sm-n900t
      #     </oa>
      #   </iq>
      # """
      
      # xmppClient.send """
      #   <iq type="get" id="3174962747#hltetmo#sm-n900t-28-1"  from="#{identity}">
      #     <oa xmlns="connect.logitech.com" 
      #          mime="vnd.logitech.harmony/vnd.logitech.harmony.engine?holdAction">
      #     action={"command"::"Display","type"::"IRCommand", "deviceId"::"19685842"}:status=press:timestamp=12345
      #     </oa>
      #   </iq>
      # """

  ###
    <iq id="278a394f-4d9e-43cf-bc26-5dd204b837bd" type="get">
        <oa xmlns='connect.logitech.com' 
             mime='vnd.logitech.harmony/vnd.logitech.harmony.engine?holdAction' 
             errorcode='504' 
             errorstring='Insufficient Arguments'>
        </oa>
    </iq>
    
    {"name":"Volume",
     "function":[
        {"action": {"command":"Muting",    "type":"IRCommand", "deviceId":"19685842"}, "name":"Mute",      "label":"Mute"},
        {"action": {"command":"VolumeDown","type":"IRCommand", "deviceId":"19685842"}, "name":"VolumeDown","label":"Volume Down"},
        {"action": {"command":"VolumeUp",  "type":"IRCommand", "deviceId":"19685842"}, "name":"VolumeUp",  "label":"Volume Up"}
      ]
    }, 

    # xmppClient.on 'error', (e) ->
    #   log 'xmppClient err 2', e
    # 
    # xmppClient.on 'stanza', (stanza) ->
      # # log 'stanza 21', util.inspect stanza.children[0], depth: 2
      # # log 'stanza 21', util.inspect stanza.children[0].children, depth: 1
      # # log 'stanza 22', util.inspect stanza.children[0].attrs, depth: 1
      # 
      # if (child = stanza.children?[0])?.name is 'oa'
      #   if child?.attrs?.errorcode isnt '200'
      #     log 'smpp res stanza oa error 2:', util.inspect stanza, depth: null
      #     return
      #   
      #   log 'child', child.children[0]
      #   
      #   # try 
      #   #   log 'child', util.inspect JSON.parse child.children[0]
      #   # catch e
      #   #   log 'stanza parse error 2:', e.message
      #   #   return
          
    # xmppClient.on 'offline', ->
    #   log 'xmppClient offline 2'
    # 
    # xmppClient.on 'connect', (e) ->
    #   log 'xmppClient connect 2'
    # 
    # xmppClient.on 'reconnect', (e) ->
    #   log 'xmppClient reconnect 2', e
    # 
    # xmppClient.on 'disconnect', ->
    #   log 'xmppClient disconnect 2'
    # 
    # xmppClient.on 'exit', (e) ->
    #   log 'xmppClient exit 2', e
    #   
  ###
  
###
  <iq type="get" id="5e518d07-bcc2-4634-ba3d-c20f338d8927-2">
    <oa xmlns="connect.logitech.com" 
         mime="vnd.logitech.harmony/vnd.logitech.harmony.engine?holdAction">
       action={"type"::"IRCommand","deviceId"::"11586428","command"::"VolumeDown"}:status=press
    </oa>
  </iq>
###


###
    xmppClient.on 'error', (e) ->
        log 'xmppClient err', e

    xmppClient.on 'offline', ->
        log 'xmppClient offline'

    xmppClient.on 'connect', (e) ->
        log 'xmppClient connect'

    xmppClient.on 'reconnect', (e) ->
        log 'xmppClient reconnect', e

    xmppClient.on 'disconnect', ->
        log 'xmppClient disconnect'

    xmppClient.on 'exit', (e) ->
        log 'xmppClient exit', e


{ name: 'iq',
  parent: null,
  children: 
   [ { name: 'oa',
       parent: [Circular],
       children: [ 
         'serverIdentity=278a394f-4d9e-43cf-bc26-5dd204b837bd:
          hubId=97:
          identity=278a394f-4d9e-43cf-bc26-5dd204b837bd:
          status=succeeded:
          protocolVersion={XMPP="1.0", HTTP="1.0", RF="1.0"}:
          hubProfiles={Harmony="2.0"}:
          productId=Pimento:
          friendlyName=tv' 
       ],
       attrs: 
        { xmlns: 'connect.logitech.com',
          mime: 'vnd.logitech.connect/vnd.logitech.pair',
          errorcode: '200',
          errorstring: 'OK' },
       nodeType: 1,
       nodeName: 'oa' } ],
  attrs: 
   { id: '3174962747',
     to: 'guest',
     type: 'get',
     'xmlns:stream': 'http://etherx.jabber.org/streams' },
  nodeType: 1,
  nodeName: 'iq' }
###
