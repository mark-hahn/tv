
exec = require('child_process').spawnSync

exports.guessit = (fileName) ->
  {stdout, stderr, status, error, output} = 
    exec 'guessit', [fileName], timeout: 60e3
  stdout = stdout?.toString()
  stderr = stderr?.toString()
  output = output?.toString()
  # console.log {stdout, stderr, status, error, output}

  resArr = output.split '\n'
  # console.log data
  res = []
  for field in resArr
    if (match = /^\s*[\d\.\[\]]+\s"([^"]+)":\s"([^"]+)/.exec field)
      [__, key, val] = match
      res.push [key, val]
  res
      
console.log exports.guessit 'about.a.boy.209.hdtv-lol.mp4'

