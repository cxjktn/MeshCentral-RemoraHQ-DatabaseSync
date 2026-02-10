var MongoClient = null
try { MongoClient = require('mongodb').MongoClient } catch (e) { }

module.exports.remorahqdatabasesync = function (parent) {
  var obj = {}

  obj.pluginid = 'remorahqdatabasesync'
  obj.version = '0.2.0'

  var pluginConfig = (parent.config && parent.config.plugins)
    ? parent.config.plugins[obj.pluginid] || {}
    : {}

  var state = {
    connections: {},
    lastProbeResults: {}
  }

  obj.serveraction = function (command, myobj, parent) {
    var sub = command.pluginaction || command.sub
    if (!sub) {
      try { myobj.send(JSON.stringify({ action: 'plugin', plugin: obj.pluginid, result: 'error', error: 'Missing pluginaction' })) } catch (e) { }
      return
    }

    var response = {
      action: 'plugin',
      plugin: obj.pluginid,
      pluginaction: sub,
      responseid: command.responseid
    }

    if (sub === 'probe') {
      var connStr = command.connectionString
      if (!connStr || typeof connStr !== 'string') {
        response.result = 'error'
        response.error = 'Missing connectionString'
        try { myobj.send(JSON.stringify(response)) } catch (e) { }
        return
      }

      if (!MongoClient) {
        response.result = 'error'
        response.error = 'MongoDB driver (npm package "mongodb") is not installed on the MeshCentral server. Run: npm install mongodb'
        try { myobj.send(JSON.stringify(response)) } catch (e) { }
        return
      }

      probeMongoDb(connStr).then(function (res) {
        response.result = res.ok ? 'ok' : 'error'
        response.error = res.error || null
        response.metrics = res.metrics || null
        response.dbName = res.dbName || null
        response.collections = res.collections || null
        try { myobj.send(JSON.stringify(response)) } catch (e) { }
      }).catch(function (err) {
        response.result = 'error'
        response.error = err.message
        try { myobj.send(JSON.stringify(response)) } catch (e) { }
      })

      return
    }

    if (sub === 'ping') {
      response.result = 'ok'
      response.version = obj.version
      response.mongoDriverInstalled = !!MongoClient
      try { myobj.send(JSON.stringify(response)) } catch (e) { }
      return
    }

    response.result = 'error'
    response.error = 'Unknown pluginaction: ' + sub
    try { myobj.send(JSON.stringify(response)) } catch (e) { }
  }

  function probeMongoDb(connectionString) {
    return new Promise(function (resolve) {
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
          connections: 0,
          availableConnections: 0,
          opcounters: null,
          uptime: 0,
          version: 'unknown',
          storageSize: 0,
          dataSize: 0,
          objects: 0,
          replicaSet: null
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

        resolve({
          ok: true,
          dbName: dbName,
          metrics: metrics,
          collections: collectionNames
        })
      }).catch(function (err) {
        if (client) { try { client.close() } catch (e) { } }
        resolve({ ok: false, error: err.message })
      })
    })
  }

  obj.server_startup = function () {
    if (MongoClient) {
      console.log('[RemoraHQ-DatabaseSync] Plugin loaded v' + obj.version + ' (MongoDB driver available)')
    } else {
      console.log('[RemoraHQ-DatabaseSync] Plugin loaded v' + obj.version + ' (MongoDB driver NOT installed — run: npm install mongodb)')
    }
  }

  obj.server_shutdown = function () {
    console.log('[RemoraHQ-DatabaseSync] Plugin stopped')
  }

  return obj
}
