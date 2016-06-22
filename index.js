#!/usr/bin/env node

'use strict'

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
var rangeParser = require('range-parser')
var minimist = require('minimist')
var TimeoutStream = require('through-timeout')
var cbTimeout = require('callback-timeout')
var ram = require('random-access-memory')

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
var file = argv.persist === false ? ram : undefined

cache.on('evict', function (item) {
  sw.leave(Buffer(item.key, 'hex'))
  item.value.close()
})

var server = http.createServer(function (req, res) {
  var dat = parse(req.url)

  if (!dat) return onerror(404, res)

  var archive = cache.get(dat.discoveryKey)
  if (!archive) {
    archive = drive.createArchive(dat.key, {file: file})
    cache.set(archive.discoveryKey.toString('hex'), archive)
    sw.join(archive.discoveryKey)
  }

  if (!dat.filename) {
    var src = archive.list({live: false})
    var timeout = TimeoutStream({
      objectMode: true,
      duration: 10000
    }, () => {
      onerror(404, res)
      src.destroy()
    })
    var stringify = JSONStream.stringify('[', ',', ']\n', 2)
    pump(src, timeout, stringify, res)
  }

  archive.get(dat.filename, cbTimeout((err, entry) => {
    if (err && err.code === 'ETIMEOUT') return onerror(404, res)
    if (err || !entry || entry.type !== 'file') return onerror(404, res)

    var range = req.headers.range && rangeParser(entry.length, req.headers.range)[0]

    res.setHeader('Access-Ranges', 'bytes')
    res.setHeader('Content-Type', mime.lookup(dat.filename))

    if (!range || range < 0) {
      res.setHeader('Content-Length', entry.length)
      if (req.method === 'HEAD') return res.end()
      pump(archive.createFileReadStream(entry), res)
    } else {
      res.statusCode = 206
      res.setHeader('Content-Length', range.end - range.start + 1)
      res.setHeader('Content-Range', 'bytes ' + range.start + '-' + range.end + '/' + entry.length)
      if (req.method === 'HEAD') return res.end()
      pump(archive.createFileReadStream(entry, {start: range.start, end: range.end + 1}), res)
    }
  }, 10000))
})

server.listen(argv.port, function () {
  console.log('Server is listening on port ' + argv.port)
})

function onerror (status, res) {
  res.statusCode = status
  res.end()
}

function parse (url) {
  var key = url.slice(1, 65)
  if (!/^[0-9a-f]{64}$/.test(key)) return null

  var filename = url.slice(66)

  return {
    key: key,
    discoveryKey: crypto.createHmac('sha256', Buffer(key, 'hex')).update('hypercore').digest('hex'),
    filename: filename
  }
}
