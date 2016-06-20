#!/usr/bin/env node

var http = require('http')
var crypto = require('crypto')
var pump = require('pump')
var level = require('level')
var lru = require('lru')
var JSONStream = require('JSONStream')
var hyperdrive = require('hyperdrive')
var swarm = require('discovery-swarm')
var defaults = require('datland-swarm-defaults')
var mime = require('mime')
var minimist = require('minimist')
var encoding = require('dat-encoding')
var ndjson = require('ndjson')
var onFinished = require('on-finished')

var argv = minimist(process.argv.slice(2), {
  alias: {port: 'p', cacheSize: 'cache-size'},
  default: {port: process.env.PORT || 8080, db: 'dat.haus.db'}
})

var db = level(argv.db)
var drive = hyperdrive(db)

var sw = swarm(defaults({
  hash: false,
  stream: function (info) {
    var stream = drive.replicate()
    if (info.channel) join(info.channel) // we already know the channel, join
    else stream.once('open', join) // wait for the remote to tell us
    return stream

    function join (discoveryKey) {
      var archive = cache.get(discoveryKey.toString('hex'))
      if (archive) archive.replicate({stream: stream})
    }
  }
}))

sw.listen(3282)
sw.once('error', function () {
  sw.listen(0)
})

var cache = lru(argv.cacheSize || 100)

cache.on('evict', function (item) {
  sw.leave(Buffer(item.key, 'hex'))
  item.value.close()
})

var server = http.createServer(function (req, res) {
  var dat = parse(req.url)

  if (!dat) return onerror(404, res)

  var archive = cache.get(dat.discoveryKey)
  if (!archive) {
    archive = drive.createArchive(dat.key)
    cache.set(archive.discoveryKey.toString('hex'), archive)
    sw.join(archive.discoveryKey)
  }

  if (dat.op === 'get') {
    if (!dat.filename) {
      pump(archive.list({live: false}), JSONStream.stringify('[', ', ', ']\n', 2), res)
      return
    }

    archive.get(dat.filename, function (err, entry) {
      if (err || !entry || entry.type !== 'file') return onerror(404, res)

      res.setHeader('Content-Type', mime.lookup(dat.filename))
      res.setHeader('Content-Length', entry.length)
      pump(archive.createFileReadStream(entry), res)
    })
  } else if (dat.op === 'changes') {
    res.setHeader('Content-Type', 'application/x-ndjson')
    var pipe = pump(
      archive.list({ live: true }),
      ndjson.serialize(),
      res
    )
    onFinished(res, () => pipe.destroy())
  }
})

server.listen(argv.port, function () {
  console.log('Server is listening on port ' + argv.port)
})

function onerror (status, res) {
  res.statusCode = status
  res.end()
}

function parse (url) {
  var key;
  var op;
  var filename;
  var m;

  if (m = /^\/([a-z0-9]+)\.changes$/.exec(url)) {
    try { key = encoding.decode(m[1]) }
    catch (_) { return null }
    op = 'changes'
  }
  else if (m = /^\/([a-z0-9]+)(?:\/(.+))?$/.exec(url)) {
    try { key = encoding.decode(m[1]) }
    catch (_) { return null }
    op = 'get'
    filename = m[2]
  }
  else return null

  return {
    key: key,
    discoveryKey: crypto.createHmac('sha256', Buffer(key, 'hex')).update('hypercore').digest('hex'),
    filename: filename,
    op: op
  }
}
