###
  live.coffee
###

log = require('./debug') 'live'

reloadDelay = 1000
interval = 300

headers =
  Etag: 1
  "Last-Modified": 1
  "Content-Length": 1
  "Content-Type": 1

resources = {}
pendingRequests = {}
currentLinkElements = {}
oldLinkElements = {}
loaded = false
active =
  html: 1
  css: 1
  js: 1

Live =
  heartbeat: ->
    if document.body
      Live.loadresources()  unless loaded
      Live.checkForChanges()
    setTimeout Live.heartbeat, interval

  loadresources: ->
    if not tvGlobal.ajaxInit
      setTimeout Live.loadresources, 100
      return
    urls = [ "http://#{tvGlobal.serverIp}:2340/js/bundle.js" ]
    for url in urls
      Live.getHead url, (url, info) ->
        resources[url] = info
    loaded = true

  checkForChanges: -> 
    for url of resources
      if pendingRequests[url] then continue  
      Live.getHead url, (url, newInfo) ->
        oldInfo = resources[url]
        hasChanged = false
        resources[url] = newInfo
        contentType = newInfo["Content-Type"]
        for header of oldInfo
          oldValue = oldInfo[header]
          newValue = newInfo[header]
          switch header.toLowerCase()
            when "etag"
              if not newValue then break
            else
              hasChanged = oldValue isnt newValue
          if hasChanged
            Live.refreshResource url, contentType
            break
  
  refreshResource: (url, type) ->
    switch type?.toLowerCase()
      when "text/css"
        link = currentLinkElements[url]
        html = document.body.parentNode
        head = link.parentNode
        next = link.nextSibling
        newLink = document.createElement("link")
        html.className = html.className.replace(/\s*livejs\-loading/g, "") + " livejs-loading"
        newLink.setAttribute "type", "text/css"
        newLink.setAttribute "rel", "stylesheet"
        newLink.setAttribute "href", url + "?now=" + new Date() * 1
        if next then head.insertBefore newLink, next  \
                else head.appendChild newLink
        currentLinkElements[url] = newLink
        oldLinkElements[url] = link
        Live.removeoldLinkElements()
      when "text/javascript", "application/javascript", "application/x-javascript"
        setTimeout (-> document.location.reload()), reloadDelay

  removeoldLinkElements: ->
    pending = 0
    for url of oldLinkElements
      try
        link = currentLinkElements[url]
        oldLink = oldLinkElements[url]
        html = document.body.parentNode
        sheet = link.sheet or link.styleSheet
        rules = sheet.rules or sheet.cssRules
        if rules.length >= 0
          oldLink.parentNode.removeChild oldLink
          delete oldLinkElements[url]
          setTimeout ->
            html.className = html.className.replace(/\s*livejs\-loading/g, "")
          , 100
      catch _error
        e = _error
        pending++
        
      if pending 
        setTimeout Live.removeoldLinkElements, 50

  getHead: (url, cb) ->
    pendingRequests[url] = true
    xhr = (if window.XMLHttpRequest then new XMLHttpRequest() else new ActiveXObject("Microsoft.XmlHttp"))
    xhr.open "HEAD", url, true
    xhr.onreadystatechange = ->
      delete pendingRequests[url]

      if xhr.readyState is 4 and xhr.status isnt 304
        xhr.getAllResponseHeaders()
        info = {}
        for h of headers
          value = xhr.getResponseHeader(h)
          value = value.replace(/^W\//, "")  if h.toLowerCase() is "etag" and value
          if h.toLowerCase() is "content-type" and value
            value = value.replace(/^(.*?);.*?$/i, "$1")  
          info[h] = value
        cb url, info

    xhr.send()

if document.location.protocol isnt "file:"
  if not window.liveJsLoaded then Live.heartbeat()  
  window.liveJsLoaded = true
else
  console.log "Live.js doesn't support the file protocol. It needs http."  
