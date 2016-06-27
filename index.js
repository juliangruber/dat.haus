#!/usr/bin/env node

'use strict'

var http = require('http')
var level = require('level')
var lru = require('lru')
var hyperdrive = require('hyperdrive')
var swarm = require('discovery-swarm')
var defaults = require('datland-swarm-defaults')
var minimist = require('minimist')
var ram = require('random-access-memory')
var hyperdriveHttp = require('hyperdrive-http')

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

var server = http.createServer()

var onrequest = hyperdriveHttp(getArchive)
server.on('request', onrequest)

server.listen(argv.port, function () {
  console.log('Server is listening on port ' + argv.port)
})

function getArchive(dat, cb) {
  var archive = cache.get(dat.discoveryKey)
  if (!archive) {
    archive = drive.createArchive(dat.key, {file: file})
    cache.set(archive.discoveryKey.toString('hex'), archive)
    sw.join(archive.discoveryKey)
  }
  cb(null, archive)
}
