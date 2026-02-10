var MongoClient = null
try { MongoClient = require('mongodb').MongoClient } catch (e) { }

module.exports.remorahqdatabasesync = function (parent) {
  var obj = {}

  obj.pluginid = 'remorahqdatabasesync'
  obj.version = '0.3.1'
  obj.hasAdminPanel = true

  function probeMongoDb(connectionString) {
    return new Promise(function (resolve) {
      if (!MongoClient) {
        return resolve({ ok: false, error: 'MongoDB driver not installed. Run: npm install mongodb' })
      }
      if (!connectionString) {
        return resolve({ ok: false, error: 'No connectionString provided' })
      }
      var client = null
      MongoClient.connect(connectionString, {
        maxPoolSize: 2,
        serverSelectionTimeoutMS: 8000,
        connectTimeoutMS: 8000
      }).then(function (c) {
        client = c
        var db = client.db()
        var dbName = db.databaseName
        return Promise.all([
          db.admin().serverStatus().catch(function () { return null }),
          db.listCollections().toArray().catch(function () { return [] }),
          db.stats().catch(function () { return null }),
          Promise.resolve(dbName)
        ])
      }).then(function (results) {
        var serverStatus = results[0]
        var collections = results[1]
        var dbStats = results[2]
        var dbName = results[3]
        var metrics = {
          connections: 0, availableConnections: 0, opcounters: null,
          uptime: 0, version: 'unknown', storageSize: 0, dataSize: 0,
          objects: 0, replicaSet: null
        }
        if (serverStatus) {
          metrics.connections = (serverStatus.connections && serverStatus.connections.current) || 0
          metrics.availableConnections = (serverStatus.connections && serverStatus.connections.available) || 0
          metrics.opcounters = serverStatus.opcounters || null
          metrics.uptime = serverStatus.uptime || 0
          metrics.version = serverStatus.version || 'unknown'
          if (serverStatus.repl) {
            metrics.replicaSet = {
              setName: serverStatus.repl.setName || null,
              ismaster: serverStatus.repl.ismaster || false,
              primary: serverStatus.repl.primary || null,
              hosts: serverStatus.repl.hosts || []
            }
          }
        }
        if (dbStats) {
          metrics.storageSize = dbStats.storageSize || 0
          metrics.dataSize = dbStats.dataSize || 0
          metrics.objects = dbStats.objects || 0
        }
        var collectionNames = collections.map(function (c) { return c.name })
        if (client) { client.close().catch(function () { }) }
        resolve({ ok: true, dbName: dbName, metrics: metrics, collections: collectionNames })
      }).catch(function (err) {
        if (client) { try { client.close() } catch (e) { } }
        resolve({ ok: false, error: err.message })
      })
    })
  }

  obj.handleAdminReq = function (req, res, user) {
    var parsedUrl = require('url').parse(req.url, true)
    var action = parsedUrl.query.action || ''
    res.setHeader('Content-Type', 'application/json')

    if (action === 'ping') {
      res.end(JSON.stringify({ result: 'ok', version: obj.version, mongo: !!MongoClient }))
      return
    }

    if (action === 'probe') {
      var body = ''
      req.on('data', function (chunk) { body += chunk.toString() })
      req.on('end', function () {
        var data = {}
        try { data = JSON.parse(body) } catch (e) { }
        var cs = data.connectionString || parsedUrl.query.cs || ''
        probeMongoDb(cs).then(function (result) {
          res.end(JSON.stringify(result))
        }).catch(function (err) {
          res.end(JSON.stringify({ ok: false, error: err.message }))
        })
      })
      return
    }

    res.end(JSON.stringify({ result: 'error', error: 'Unknown action: ' + action }))
  }

  obj.serveraction = function (command, myobj, parent) {
    var sub = command.pluginaction || command.sub || ''
    var response = {
      action: 'plugin', plugin: obj.pluginid, pluginaction: sub,
      responseid: command.responseid
    }
    var sendFn = function (data) {
      try {
        if (typeof myobj.send === 'function') { myobj.send(JSON.stringify(data)); return }
        if (myobj.ws && typeof myobj.ws.send === 'function') { myobj.ws.send(JSON.stringify(data)); return }
      } catch (e) { }
    }

    if (sub === 'ping') {
      response.result = 'ok'
      response.version = obj.version
      response.mongo = !!MongoClient
      sendFn(response)
      return
    }

    if (sub === 'probe') {
      var cs = command.connectionString || ''
      probeMongoDb(cs).then(function (res) {
        response.result = res.ok ? 'ok' : 'error'
        response.error = res.error || null
        response.metrics = res.metrics || null
        response.dbName = res.dbName || null
        response.collections = res.collections || null
        sendFn(response)
      }).catch(function (err) {
        response.result = 'error'
        response.error = err.message
        sendFn(response)
      })
      return
    }

    response.result = 'error'
    response.error = 'Unknown pluginaction: ' + sub
    sendFn(response)
  }

  obj.server_startup = function () {
    if (MongoClient) {
      console.log('[RemoraHQ-DatabaseSync] Plugin loaded v' + obj.version + ' (MongoDB driver available)')
    } else {
      console.log('[RemoraHQ-DatabaseSync] Plugin loaded v' + obj.version + ' (MongoDB driver NOT installed)')
    }
  }

  obj.server_shutdown = function () {
    console.log('[RemoraHQ-DatabaseSync] Plugin stopped')
  }

  return obj
}
