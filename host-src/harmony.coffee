
util       = require 'util'
request    = require 'request'
XmppClient = require 'node-xmpp-client'
log        = require('debug') 'tv:hmny'

# require('request-debug') request

identity = oldClient = oldJId = null
fakeClientName = Date.now() + '/' + Math.floor(Math.random() * 1e6) + '#hahnTvApp.1.0#servr'

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

getClient = (jid, password) ->
  if jid is oldJId then return oldClient
  if oldJId then oldClient.end()
  oldJId = jid
  oldClient = new XmppClient {
    jid, password
    host: '192.168.1.5'
    port: 5222
    preferred: 'PLAIN'
  }
  
transactionCount = 0

transaction = (opts, cb) ->
  log '\n\n----- trans request -----\n', opts, '\n'

  {jid, password, from, mime, mime1, mime2, mimeCmd, cdata} = opts
  jid      ?= fakeClientName + '-' + (++transactionCount)
  password ?= identity
  from     ?= identity
  mime1    ?= 'harmony'
  mime2    ?= 'harmony.engine?' + mimeCmd
  mime     ?= "vnd.logitech.#{mime1}/vnd.logitech.#{mime2}"
  cdata    ?= ''
  xml = """
    <iq type="get" id="#{jid}" from="#{from}">
      <oa xmlns="connect.logitech.com" mime="#{mime}"> 
      #{if cdata then '  ' + cdata + '\n  ' else ''}</oa>
    </iq>
  """
  client = getClient jid, password
  client.on 'online',     -> client.send xml
  client.on 'offline',    -> log 'trans offline'
  client.on 'connect',    -> log 'trans connect'
  client.on 'reconnect',  -> log 'trans reconnect'
  client.on 'disconnect', -> log 'trans disconnect'
  client.on 'exit',       -> log 'trans exit'
  client.on 'error',  (e) -> log '\n\ntrans ERROR:', e.message, '\n' + xml + '\n'; return e.message
  
  timeout = setTimeout ->
    log '\n\nERROR, transaction timeout:\n' + xml + '\n'
    cb? 'transaction timeout'
    cb = null
  , 5000
  
  client.on 'stanza', (stanza) ->
    # log 'trans stanza:\n', xml, '\n' + util.inspect stanza, depth: null
    
    if (child = stanza.children?[0])?.name is 'oa'
      if (errCode = (child?.attrs?.errorcode isnt '200')) or stanza.attrs.id isnt jid
        log '\n\nERROR', (if errCode then ': ' + child?.attrs?.errorstring \
                                else (', bad sequence id:\n' + stanza.attrs.id + '\n' + jid)), 
            '\n\n' + xml + '\n'
        cb? 'stanza oa error'
        clearTimeout timeout
        return
      clearTimeout timeout
      results = {}
      for res in child.children[0].split ':'
        [key,val] = res.split '='
        results[key] = val
        
      log 'trans stanza jid/req/res:', jid, '\n' + xml, '\n' + util.inspect results, depth: 2
      
      cb? null, results, stanza

getIdentity = (token, cb) ->
  opts = 
    password: 'neededButIgnored'
    from:     'guest'
    mime1:    'connect'
    mime2:    'pair'
    cdata:    "token=#{token}:name=#{fakeClientName}"
  transaction opts, (err, results) ->
    if err or results.status isnt 'succeeded'
      log '\n\ngetIdentity ERROR:', err, (if not err then results else 'status not succeeded') + '\n'
      return 'getIdentity error'
    identity = results.identity
    cb? null, identity
    
getConfig = (cb) ->
  opts =  mimeCmd: 'config'
  transaction opts, (err, results, stanza) -> cb? err, stanza

irCommand = (device, key, cb) ->
  opts = 
    from:    identity
    mimeCmd: 'holdAction'
    cdata:   "action={\"command\"::\"#{key}\",\"type\"::\"IRCommand\",\"deviceId\"::\"#{device}\"}" +
             ':status=press:timestamp=42617'
  transaction opts, cb

getToken (err, token) ->
  if err then log 'getToken call err', err; return
    
  getIdentity token, (err) ->
    if err then log 'getIdentity call err', err; return
    
    # getConfig (err, stanza) ->
    #   if err then log 'getConfig call err', err; return
    #   log 'getConfig\n\n', util.inspect(stanza.children[0].children, depth: null) + '\n'
      
    irCommand '19685842', 'Display', (err) ->
      if err then log 'irCommand call err', err; return
      
