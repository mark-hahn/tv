  
lastWid = lastHgt = resizeTimeout = null

module.exports = (app) ->
  wid = Math.min  980, window.innerWidth  + 10
  hgt = Math.min 1525, window.innerHeight + 15
  if wid isnt lastWid or hgt isnt lastHgt
    lastWid = wid
    lastHgt = hgt
    if resizeTimeout
      clearTimeout resizeTimeout
    resizeTimeout = setTimeout ->
      app.trigger 'resize', {wid, hgt}
      resizeTimeout = null
    , 75
